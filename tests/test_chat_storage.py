import sqlite3
import httpx
import pytest
from python.api.main import app
from python.storage import db, generations

pytestmark = pytest.mark.asyncio


async def test_migrate_legacy_and_idempotent(isolated):
    with sqlite3.connect(db.DB_PATH) as conn:
        conn.execute("CREATE TABLE session_settings(session_id TEXT PRIMARY KEY,system_prompt TEXT,temperature REAL,extra_json TEXT,updated_at TEXT)")
        conn.execute("INSERT INTO session_settings VALUES('legacy','keep',0.8,NULL,'old')")
    await db.init_db()
    await db.init_db()
    with sqlite3.connect(db.DB_PATH) as conn:
        assert conn.execute("SELECT system_prompt FROM session_settings").fetchone()[0] == "keep"


async def test_chat_save_before_done_replay_and_edit(isolated):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        body = {"model_id": "mock-echo", "session_id": "test", "generation_id": "unique",
                "messages": [{"role": "user", "content": "hello"}]}
        response = await client.post("/api/chat/stream", json=body)
        assert response.status_code == 200
        assert "event: done" in response.text
        history = (await client.get("/api/chat/history?session_id=test")).json()["history"]
        assert len(history) == 2
        replay = await client.post("/api/chat", json=body)
        assert replay.status_code == 200
        assert len((await client.get("/api/chat/history?session_id=test")).json()["history"]) == 2
        assert (await client.get("/api/chat/debug?session_id=test")).json()["state"]["turn"] == 1
        assert (await client.put(f'/api/chat/history/{history[0]["id"]}', json={"content": "edited"})).status_code == 200
        assert (await client.get("/api/chat/debug?session_id=test")).json()["state"]["turn"] == 0
        assert (await client.post("/api/chat", json=body)).status_code == 409


async def test_regeneration_replaces_only_latest_assistant(isolated):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        body = {"model_id": "mock-echo", "session_id": "regen", "generation_id": "original",
                "messages": [{"role": "user", "content": "hello"}]}
        assert (await client.post("/api/chat", json=body)).status_code == 200
        history = (await client.get("/api/chat/history?session_id=regen")).json()["history"]
        body.update(generation_id="replacement", regenerate_message_id=history[-1]["id"])
        assert (await client.post("/api/chat", json=body)).status_code == 200
        after = (await client.get("/api/chat/history?session_id=regen")).json()["history"]
        assert len(after) == 2 and after[-1]["id"] == history[-1]["id"]
        assert (await client.get("/api/chat/debug?session_id=regen")).json()["state"]["turn"] == 1


async def test_cancelled_preview_does_not_enter_history(isolated):
    from python.api.chat import ChatRequest, prepare_generation, run_chat
    req = ChatRequest(model_id="mock-echo", session_id="cancel", messages=[{"role": "user", "content": "hello"}])
    source = run_chat(req, await prepare_generation(req))
    await anext(source)
    await source.aclose()
    result = await generations.latest("cancel")
    assert result["status"] == "cancelled" and result["attempts"]
    assert result['attempts'][0]['errors'] == ['cancelled']
    assert result['attempts'][0]['elapsed_ms'] > 0
    with sqlite3.connect(db.DB_PATH) as conn:
        assert conn.execute("SELECT count(*) FROM chat_history").fetchone()[0] == 0


async def test_reservation_conflicts_and_recovery(isolated):
    assert await generations.reserve("id1", "same", {}) is None
    with pytest.raises(generations.Conflict):
        await generations.reserve("id2", "same", {})
    with pytest.raises(generations.Conflict):
        await generations.reserve("id1", "same", {"changed": True})
    await generations.recover_interrupted()
    assert (await generations.reserve("id1", "same", {}))["status"] == "cancelled"


async def test_disconnect_after_meta_releases_reservation(isolated):
    from python.api.chat import ChatRequest, chat_stream
    req = ChatRequest(model_id='mock-echo', session_id='meta-only', messages=[{'role':'user','content':'hello'}])
    response = await chat_stream(req, None)
    assert (await anext(response.body_iterator))['event'] == 'meta'
    await response.body_iterator.aclose()
    assert (await generations.latest('meta-only'))['status'] == 'cancelled'
    assert await generations.reserve('another', 'meta-only', {}) is None
