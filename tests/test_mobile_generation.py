"""Recovery and cancellation regressions, with isolated SQLite and no model/network I/O."""
import asyncio
import json

import aiosqlite
import anyio
import anyio.lowlevel
import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from python.api import chat, mobile
from python.core.schemas import RuntimeState
from python.storage import db, generations, memories

pytestmark = pytest.mark.asyncio


def request(gid="generation", sid="session"):
    return chat.ChatRequest(model_id="mock-echo", generation_id=gid, session_id=sid,
                            messages=[{"role": "user", "content": "I like tea"}])


async def rows(sql, args=()):
    async with aiosqlite.connect(db.DB_PATH) as con:
        return await (await con.execute(sql, args)).fetchall()


async def memory_result(*args, **kwargs):
    state = kwargs["state"].model_copy(update={"turn": kwargs["state"].turn + 1})
    yield {"type": "result", "result": {
        "generation_id": kwargs["generation_id"], "status": "completed", "reply": "You like tea",
        "state": state.model_dump(), "state_before": kwargs["state"].model_dump(),
        "memory": {**kwargs["memory"]["trace"],
                   "proposals": [{"type": "semantic", "content": "I like tea"}]},
    }}


async def test_disconnect_before_meta_releases_reservation(isolated):
    response = await chat.chat_stream(request(), None)
    started = anyio.Event()

    async def send(message):
        if message["type"] == "http.response.start":
            started.set()
            await anyio.sleep_forever()  # disconnect while the headers are in flight

    async def receive():
        await started.wait()
        return {"type": "http.disconnect"}

    with anyio.fail_after(5):
        await response({"type": "http", "asgi": {"version": "3.0"}}, receive, send)
    assert await rows("SELECT status FROM generations") == [("cancelled",)]
    assert await generations.reserve("next", "session", {}) is None


async def test_header_send_failure_also_releases_reservation(isolated):
    response = await chat.chat_stream(request(), None)

    async def send(message):
        raise OSError("socket closed before headers")

    async def receive():
        await anyio.sleep_forever()

    with pytest.raises(OSError, match="socket closed"):
        await response({"type": "http", "asgi": {"version": "3.0"}}, receive, send)
    assert await rows("SELECT status FROM generations") == [("cancelled",)]


@pytest.mark.parametrize("cut", ["history", "generation"])
async def test_cancel_between_memory_and_history_rolls_back_everything(isolated, monkeypatch, cut):
    await db.init_db()
    await memories.set_session_enabled("session", True)
    initial = RuntimeState(session_id="session", turn=7).model_dump()
    async with aiosqlite.connect(db.DB_PATH) as con:
        await con.execute("INSERT INTO runtime_states VALUES(?,?)", ("session", json.dumps(initial)))
        await con.commit()
    monkeypatch.setattr(chat, "generate_events", memory_result)
    original = aiosqlite.Connection.execute

    async def interrupt_history(con, sql, parameters=None):
        if sql.startswith("INSERT INTO chat_history" if cut == "history" else "UPDATE generations SET status=?"):
            raise asyncio.CancelledError()
        return await original(con, sql, parameters)

    monkeypatch.setattr(aiosqlite.Connection, "execute", interrupt_history)
    req = request()
    with pytest.raises(asyncio.CancelledError):
        async for _ in chat.run_chat(req, await chat.prepare_generation(req)):
            pass
    assert await rows("SELECT status FROM generations") == [("cancelled",)]
    assert await rows("SELECT * FROM chat_history") == []
    assert await rows("SELECT * FROM memories") == []
    assert await rows("SELECT * FROM memory_events") == []
    assert json.loads((await rows("SELECT state_json FROM runtime_states"))[0][0]) == initial


@pytest_asyncio.fixture
async def remote(isolated):
    app = FastAPI()
    app.include_router(chat.router, prefix="/api")
    app.include_router(mobile.router, prefix="/api")
    config = mobile.Config(True, "https://home.example")
    devices = mobile.Devices()
    app.state.mobile_config, app.state.mobile_devices = config, devices
    app.add_middleware(mobile.MobileSecurity, config=config, devices=devices)
    await db.init_db()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, client=("192.0.2.1", 1234)),
        base_url=config.public_origin, headers={"Origin": config.public_origin},
    ) as client:
        url = "/api/chat/generations/unknown?session_id=session"
        assert (await client.get(url)).status_code == 401
        assert (await client.post(url.replace("?", "/cancel?"))).status_code == 401
        code = devices.issue()["code"]
        assert (await client.post("/api/mobile/pair", json={"code": code, "name": "test"})).status_code == 200
        yield client


async def test_unknown_status_is_read_only_and_explicit_cancel_fences_late_post(remote):
    url = "/api/chat/generations/generation"
    query = {"session_id": "session"}
    response = await remote.get(url, params=query)
    assert response.status_code == 200
    assert response.json() == {"generation_id": "generation", "session_id": "session",
                               "status": "not_found", "user_id": None, "assistant_id": None}
    assert "no-store" in response.headers["cache-control"]
    assert await rows("SELECT * FROM generations") == []
    for _ in range(2):
        response = await remote.post(url + "/cancel", params=query)
        assert response.status_code == 200 and response.json()["status"] == "cancelled"
    for path in ["/api/chat", "/api/chat/stream"]:
        assert (await remote.post(path, json=request().model_dump())).status_code == 409
    assert await rows("SELECT status,valid FROM generations") == [("cancelled", 0)]
    assert await rows("SELECT * FROM chat_history") == []
    # Cancelling an unknown ID must not cancel an unrelated running turn in the same session.
    assert await generations.reserve("other", "session", {}) is None
    assert (await remote.post(url + "/cancel", params=query)).status_code == 200
    assert (await generations.status("other", "session"))["status"] == "pending"


async def test_session_mismatch_and_missing_query_cannot_cancel(remote):
    await generations.reserve("generation", "session", {})
    url = "/api/chat/generations/generation"
    for method, path in [("GET", url), ("POST", url + "/cancel")]:
        assert (await remote.request(method, path)).status_code == 400
        assert (await remote.request(method, path, params={"session_id": ""})).status_code == 400
        response = await remote.request(method, path, params={"session_id": "other"})
        assert response.status_code == 409
        assert "assistant_id" not in response.json()
    assert (await generations.status("generation", "session"))["status"] == "pending"


async def test_cancel_before_delayed_post_reservation(remote, monkeypatch):
    entered, release = asyncio.Event(), asyncio.Event()
    original = chat._load_settings

    async def delayed(sid):
        entered.set()
        await release.wait()
        return await original(sid)

    monkeypatch.setattr(chat, "_load_settings", delayed)
    send = asyncio.create_task(remote.post("/api/chat/stream", json=request().model_dump()))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        response = await remote.post("/api/chat/generations/generation/cancel?session_id=session")
        assert response.json()["status"] == "cancelled"
    finally:
        release.set()
    assert (await asyncio.wait_for(send, 3)).status_code == 409
    assert await rows("SELECT * FROM chat_history") == []


async def test_completed_status_uses_row_ids_and_cancel_preserves_result(remote):
    result = await remote.post("/api/chat/stream", json=request().model_dump())
    assert result.status_code == 200 and "event: done" in result.text
    url = "/api/chat/generations/generation"
    status = (await remote.get(url, params={"session_id": "session"})).json()
    assert set(status) == {"generation_id", "session_id", "status", "user_id", "assistant_id"}
    assert status["status"] == "completed" and status["user_id"] and status["assistant_id"]
    assert (await remote.post(url + "/cancel", params={"session_id": "session"})).json() == status
    # Old/startup-generated result_json may omit the IDs; status still uses the row.
    async with aiosqlite.connect(db.DB_PATH) as con:
        await con.execute("UPDATE generations SET result_json='{}'")
        await con.commit()
    assert (await remote.get(url, params={"session_id": "session"})).json() == status
    assert len(await rows("SELECT * FROM chat_history")) == 2
    assert chat._running == {}


async def test_restart_and_invalid_immersion_status(isolated):
    await generations.reserve("restart", "session", {})
    await generations.recover_interrupted()
    assert await generations.status("restart", "session") == {
        "generation_id": "restart", "session_id": "session", "status": "cancelled",
        "user_id": None, "assistant_id": None,
    }
    await generations.reserve("invalid", "session", {})
    await generations.finish("invalid", {"status": "invalid", "mode": "immersion", "reply": "partial"},
                             {"content": "hello"}, "mock-echo")
    status = await generations.status("invalid", "session")
    assert status["status"] == "invalid" and status["assistant_id"] and status["user_id"]
    assert await generations.cancel("invalid", "session") == status


@pytest.mark.parametrize("ignore_cancel,close_failure", [(False, False), (True, False), (False, True)])
async def test_explicit_cancel_stops_producer_and_fences_late_result(remote, monkeypatch, ignore_cancel, close_failure):
    entered, closed = asyncio.Event(), asyncio.Event()

    async def slow(*args, **kwargs):
        try:
            entered.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                if not ignore_cancel:
                    raise
            async for event in memory_result(*args, **kwargs):
                yield event  # provider that suppresses cancellation still cannot commit
        finally:
            closed.set()
            if close_failure:
                raise RuntimeError("provider close failed")

    monkeypatch.setattr(chat, "generate_events", slow)
    await memories.set_session_enabled("session", True)
    send = asyncio.create_task(remote.post("/api/chat/stream", json=request().model_dump()))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        result = await remote.post("/api/chat/generations/generation/cancel?session_id=session")
        assert result.status_code == 200 and result.json()["status"] == "cancelled"
        await asyncio.wait_for(closed.wait(), 3)
        assert chat._running == {}
        assert await rows("SELECT * FROM chat_history") == []
        assert await rows("SELECT * FROM memories") == []
        assert await rows("SELECT * FROM memory_events") == []
        assert await rows("SELECT * FROM runtime_states") == []
    finally:
        if not send.done():
            send.cancel()
        await asyncio.gather(send, return_exceptions=True)


async def test_finish_wins_concurrent_cancel_atomically(isolated, monkeypatch):
    await db.init_db()
    await memories.set_session_enabled("session", True)
    monkeypatch.setattr(chat, "generate_events", memory_result)
    entered, release, cancel_started = asyncio.Event(), asyncio.Event(), asyncio.Event()
    original_commit = memories.commit
    original_execute = aiosqlite.Connection.execute

    async def hold_transaction(*args, **kwargs):
        await original_commit(*args, **kwargs)
        entered.set()
        await release.wait()

    async def observe_cancel(con, sql, parameters=None):
        if sql == "BEGIN IMMEDIATE" and asyncio.current_task().get_name() == "cancel-race":
            cancel_started.set()
        return await original_execute(con, sql, parameters)

    monkeypatch.setattr(memories, "commit", hold_transaction)
    monkeypatch.setattr(aiosqlite.Connection, "execute", observe_cancel)
    prepared = await chat.prepare_generation(request())
    # Initialization is already complete; keep migration DDL out of the controlled lock race.
    async def initialized():
        pass
    monkeypatch.setattr(db, "init_db", initialized)

    async def consume():
        return [event async for event in chat.run_chat(request(), prepared)]

    finish = asyncio.create_task(consume())
    cancel = None
    try:
        await asyncio.wait_for(entered.wait(), 3)
        # Nothing from the uncommitted memory transaction is externally visible.
        assert await rows("SELECT * FROM memories") == []
        assert (await generations.status("generation", "session"))["status"] == "pending"
        cancel = asyncio.create_task(generations.cancel("generation", "session"), name="cancel-race")
        await asyncio.wait_for(cancel_started.wait(), 3)
    finally:
        release.set()
        await asyncio.wait_for(finish, 3)
    result = await asyncio.wait_for(cancel, 3)
    assert result["status"] == "completed" and result["assistant_id"]
    assert len(await rows("SELECT * FROM chat_history")) == 2
    assert len(await rows("SELECT * FROM memories")) == 1
    assert json.loads((await rows("SELECT state_json FROM runtime_states"))[0][0])["turn"] == 1


async def test_cancellation_after_commit_does_not_overwrite_completed_turn(isolated, monkeypatch):
    await db.init_db()
    await memories.set_session_enabled("session", True)
    monkeypatch.setattr(chat, "generate_events", memory_result)
    original = generations.finish

    async def interrupt_after_commit(*args, **kwargs):
        await original(*args, **kwargs)
        raise asyncio.CancelledError()

    monkeypatch.setattr(generations, "finish", interrupt_after_commit)
    req = request()
    with pytest.raises(asyncio.CancelledError):
        async for _ in chat.run_chat(req, await chat.prepare_generation(req)):
            pass
    result = await generations.status("generation", "session")
    assert result["status"] == "completed" and result["assistant_id"]
    assert len(await rows("SELECT * FROM memories")) == 1
    assert len(await rows("SELECT * FROM chat_history")) == 2
    assert json.loads((await rows("SELECT state_json FROM runtime_states"))[0][0])["turn"] == 1


async def test_sse_cancel_scope_during_final_transaction_commits_all_or_none(isolated, monkeypatch):
    await db.init_db()
    await memories.set_session_enabled("session", True)
    monkeypatch.setattr(chat, "generate_events", memory_result)
    original = memories.commit
    req = request()
    prepared = await chat.prepare_generation(req)
    with anyio.CancelScope() as disconnect:
        async def cancel_after_memory(*args, **kwargs):
            await original(*args, **kwargs)
            disconnect.cancel()  # sse-starlette uses level cancellation, not Task.cancel()
            await anyio.lowlevel.checkpoint()

        monkeypatch.setattr(memories, "commit", cancel_after_memory)
        async for _ in chat.run_chat(req, prepared):
            pass
    # The short final transaction is shielded: a disconnect at this boundary
    # preserves the entire committed turn and recovery sees its message IDs.
    status = await generations.status("generation", "session")
    assert status["status"] == "completed" and status["assistant_id"]
    assert len(await rows("SELECT * FROM memories")) == 1
    assert len(await rows("SELECT * FROM chat_history")) == 2
    assert json.loads((await rows("SELECT state_json FROM runtime_states"))[0][0])["turn"] == 1
    assert chat._running == {}
