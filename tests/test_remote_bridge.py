"""Relay security, detached ASGI lifetime and bounded binary replay."""

import asyncio
import base64
import json
import time
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from python.api import mobile
from python.remote.bridge import MAX_BODY, MAX_REPLAY, RelayBridge, RuntimeAdapter
from starlette.responses import Response, StreamingResponse

pytestmark = pytest.mark.asyncio


def setup(handler=None):
    app = FastAPI()
    config = mobile.Config(True, "https://relay.example")
    devices = mobile.Devices()
    tokens = {"phone": "host-private-phone-token", "other": "host-private-other-token"}
    for id, token in tokens.items():
        devices.sessions[mobile.digest(token)] = {
            "id": id,
            "name": id,
            "expires_at": time.time() + 600,
        }
    app.state.mobile_config = config
    app.state.mobile_devices = devices
    app.include_router(mobile.router, prefix="/api")

    @app.get("/api/health")
    async def health(request: Request):
        assert not mobile.local_admin(request)
        return {"ok": True}

    if handler:
        app.add_api_route("/api/chat/stream", handler, methods=["POST"])
    app.add_middleware(mobile.MobileSecurity, config=config, devices=devices)

    def authorize(device_id):
        session = devices.session(tokens.get(device_id))
        return bool(session and session["id"] == device_id)

    adapter = RuntimeAdapter(app, authorize_device=authorize)
    return RelayBridge(adapter), app, devices, tokens


async def collect(iterator):
    return [event async for event in iterator]


def submit(
    bridge,
    *,
    id=None,
    method="GET",
    path="/api/health",
    headers=None,
    body=b"",
    device="phone",
):
    return bridge.request(id or str(uuid4()), method, path, headers or {}, body, device)


def payload(events):
    return b"".join(base64.b64decode(e["data"]) for e in events if e["type"] == "chunk")


async def test_remote_identity_expiry_and_revocation():
    bridge, _, devices, tokens = setup()
    events = await collect(submit(bridge, path="/api/mobile/status"))
    status = json.loads(payload(events))
    assert status["administrative"] is False
    assert status["authenticated"] is True
    for device in ("missing", ""):
        assert (await collect(submit(bridge, device=device)))[0][
            "code"
        ] == "authentication_required"
    tokens["other"] = tokens["phone"]
    assert (await collect(submit(bridge, device="other")))[0][
        "code"
    ] == "authentication_required"
    devices.sessions[mobile.digest(tokens["phone"])]["expires_at"] = 0
    assert (await collect(submit(bridge)))[0]["code"] == "authentication_required"
    await bridge.aclose()


@pytest.mark.parametrize(
    "path",
    [
        "https://localhost/api/health",
        "//localhost/api/health",
        "/api/../api/health",
        "/api/chat/generations/%2e%2e",
        "/api/chat/generations/%252e%252e",
        "/api/chat/generations/x%2fy",
        "/api/chat/generations/x%5cy",
        "/api/chat/generations/x%00y",
        "/api/chat/generations/x%3fy",
        "/api/chat/generations/x%23y",
        "/api/chat/generations/%ff",
        "/api/chat/generations/%zz",
        "/api/chat/generations/..",
        "/api//health",
        "/api/health#x",
        "/api/health\n",
        "/api\\health",
        "/api/mobile/admin/devices",
        "/api/providers",
        "/api/imports/url/resolve",
        "/openapi.json",
    ],
)
async def test_paths_fail_closed(path):
    bridge, *_ = setup()
    events = await collect(submit(bridge, path=path))
    assert events[0].get("type") == "error" or events[0].get("status") == 403
    await bridge.aclose()


@pytest.mark.parametrize(
    "name",
    [
        "Cookie",
        "Authorization",
        "Host",
        "Origin",
        "Forwarded",
        "X-Forwarded-For",
        "X-Device-Id",
        "X-HTTP-Method-Override",
        "Content-Length",
        "Connection",
    ],
)
async def test_no_header_or_cookie_forgery(name):
    bridge, *_ = setup()
    assert (await collect(submit(bridge, headers={name: "localhost"})))[0][
        "code"
    ] == "invalid_headers"
    assert not bridge._streams


async def test_exact_method_headers_and_body_bounds():
    bridge, app, *_ = setup()
    for method in ("get", "HEAD", "OPTIONS", "POST"):
        result = (await collect(submit(bridge, method=method)))[0]
        assert result.get("code") == "admin_required" or result.get("status") == 403
    for headers in ({"Accept": "x\r\nCookie: forged"}, {"Accept": "x", "accept": "y"}):
        assert (await collect(submit(bridge, headers=headers)))[0][
            "code"
        ] == "invalid_headers"

    @app.post("/api/library/assets")
    async def upload(request: Request):
        return {"length": len(await request.body())}

    events = await collect(
        submit(
            bridge,
            method="POST",
            path="/api/library/assets",
            headers={"content-type": "application/octet-stream"},
            body=b"x" * MAX_BODY,
        )
    )
    assert json.loads(payload(events))["length"] == MAX_BODY
    events = await collect(
        submit(
            bridge,
            method="POST",
            path="/api/library/assets",
            body=b"x" * (MAX_BODY + 1),
        )
    )
    assert events[0]["code"] == "request_too_large"
    await bridge.aclose()


@pytest.mark.parametrize(
    "body",
    [b"{}", b'{"session_id":"__global__"}', b"[", b"x" * (2 * 1024 * 1024 + 1)],
    ids=["missing", "reserved", "invalid-json", "oversize"],
)
async def test_existing_remote_session_validation(body):
    calls = []

    async def handler():
        calls.append(True)
        return {}

    bridge, *_ = setup(handler)
    events = await collect(
        submit(bridge, method="POST", path="/api/chat/stream", body=body)
    )
    assert events[0]["status"] in (400, 413)
    assert not calls
    await bridge.aclose()


async def test_generation_query_session_required():
    bridge, *_ = setup()
    for query in ("", "?session_id=__global__", "?session_id=a&session_id=b"):
        events = await collect(
            submit(bridge, method="POST", path="/api/chat/generations/g/cancel" + query)
        )
        assert events[0]["status"] == 400
    await bridge.aclose()


async def test_disconnect_resume_and_existing_cancellation_endpoint():
    started, finish, complete = asyncio.Event(), asyncio.Event(), asyncio.Event()
    calls = []

    async def handler():
        calls.append(True)

        async def chunks():
            yield b"event: meta\n\n"
            started.set()
            await finish.wait()
            yield b"event: done\n\n"
            complete.set()

        return StreamingResponse(chunks(), media_type="text/event-stream")

    bridge, app, *_ = setup(handler)

    @app.post("/api/chat/generations/g/cancel")
    async def cancel():
        finish.set()
        return {"cancelled": True}

    id = str(uuid4())
    stream = submit(
        bridge,
        id=id,
        method="POST",
        path="/api/chat/stream",
        body=b'{"session_id":"phone"}',
    )
    assert (await anext(stream))["type"] == "response"
    first = await anext(stream)
    await asyncio.wait_for(started.wait(), 2)
    waiting = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    waiting.cancel()  # websocket sender task is cancelled
    with pytest.raises(asyncio.CancelledError):
        await waiting
    await stream.aclose()
    assert not bridge._streams[id].task.done()
    other = await collect(bridge.resume(id, first["seq"], "other"))
    assert other[0]["code"] == "replay_gap"
    events = await collect(
        submit(
            bridge,
            method="POST",
            path="/api/chat/generations/g/cancel?session_id=phone",
        )
    )
    assert events[0]["status"] == 200
    await asyncio.wait_for(complete.wait(), 2)
    replay = await collect(bridge.resume(id, first["seq"], "phone"))
    assert replay[0]["type"] == "response" and replay[0]["replay"]
    assert b"event: done" in payload(replay)
    assert replay[-1]["type"] == "end"
    assert [e["seq"] for e in replay[1:]] == list(
        range(first["seq"] + 1, replay[-1]["seq"] + 1)
    )
    assert (await collect(submit(bridge, id=id)))[0]["code"] == "duplicate_request"
    assert len(calls) == 1
    await bridge.aclose()


async def test_binary_download_and_response_header_filtering():
    bridge, app, *_ = setup()
    data = bytes(range(256)) * 1024

    @app.get("/api/library/assets/" + "a" * 64)
    async def asset():
        return Response(
            data,
            media_type="image/png",
            headers={
                "Content-Disposition": 'attachment; filename="image.png"',
                "Set-Cookie": "secret=credential",
                "X-Internal-Secret": "hidden",
            },
        )

    events = await collect(submit(bridge, path="/api/library/assets/" + "a" * 64))
    assert payload(events) == data
    assert events[0]["headers"]["content-type"] == "image/png"
    assert "content-disposition" in events[0]["headers"]
    assert "set-cookie" not in events[0]["headers"]
    assert "x-internal-secret" not in events[0]["headers"]
    assert [e["seq"] for e in events] == list(range(len(events)))
    await bridge.aclose()


async def test_replay_byte_bound_age_gap_no_resubmit_and_revocation():
    bridge, app, devices, tokens = setup()
    now = [1000.0]
    bridge.clock = lambda: now[0]

    @app.get("/api/library/assets/" + "b" * 64)
    async def asset():
        return Response(b"z" * (MAX_REPLAY * 2))

    id = str(uuid4())
    events = await collect(
        submit(bridge, id=id, path="/api/library/assets/" + "b" * 64)
    )
    assert len(payload(events)) == MAX_REPLAY * 2
    record = bridge._streams[id]
    assert record.size + record.response_size <= MAX_REPLAY
    replay = await collect(bridge.resume(id, 0, "phone"))
    assert replay[0]["type"] == "response"
    assert replay[-1]["code"] == "replay_gap"
    now[0] += 301
    replay = await collect(bridge.resume(id, events[-2]["seq"], "phone"))
    assert replay[-1]["code"] == "replay_gap"
    assert not record.frames
    bridge._expire(record)
    assert record.response is None
    assert (await collect(submit(bridge, id=id)))[0]["code"] == "duplicate_request"
    devices.sessions.pop(mobile.digest(tokens["phone"]))
    assert (await collect(bridge.resume(id, 0, "phone")))[0][
        "code"
    ] == "authentication_required"
    await bridge.aclose()


async def test_real_chat_commits_after_iterator_close(isolated):
    import aiosqlite
    from python.api import chat
    from python.storage import db

    bridge, app, *_ = setup()
    app.include_router(chat.router, prefix="/api")
    id = str(uuid4())
    stream = submit(
        bridge,
        id=id,
        method="POST",
        path="/api/chat/stream",
        headers={"content-type": "application/json"},
        body=json.dumps(
            {
                "model_id": "mock-echo",
                "generation_id": id,
                "session_id": "relay-session",
                "messages": [{"role": "user", "content": "hello"}],
            }
        ).encode(),
    )
    assert (await anext(stream))["status"] == 200
    await stream.aclose()
    await asyncio.wait_for(asyncio.shield(bridge._streams[id].task), 10)
    async with aiosqlite.connect(db.DB_PATH) as conn:
        status = await (
            await conn.execute(
                "SELECT status FROM generations WHERE generation_id=?", (id,)
            )
        ).fetchone()
        history = await (
            await conn.execute(
                "SELECT role FROM chat_history WHERE session_id=?", ("relay-session",)
            )
        ).fetchall()
    assert status == ("completed",)
    assert history == [("user",), ("assistant",)]
    replay = await collect(bridge.resume(id, 0, "phone"))
    assert b"event: done" in payload(replay)
    await bridge.aclose()


async def test_204_end_initial_resume_and_no_consumer_backpressure():
    started, finish = asyncio.Event(), asyncio.Event()

    async def handler():
        started.set()
        await finish.wait()
        return Response(status_code=204)

    bridge, *_ = setup(handler)
    id = str(uuid4())
    iterator = submit(
        bridge,
        id=id,
        method="POST",
        path="/api/chat/stream",
        body=b'{"session_id":"phone"}',
    )
    reader = asyncio.create_task(anext(iterator))
    await asyncio.wait_for(started.wait(), 2)
    resume = asyncio.create_task(collect(bridge.resume(id, -1, "phone")))
    reader.cancel()
    with pytest.raises(asyncio.CancelledError):
        await reader
    finish.set()
    events = await asyncio.wait_for(resume, 2)
    assert [(e["type"], e["seq"]) for e in events] == [("response", 0), ("end", 1)]
    assert events[0]["status"] == 204
    await bridge.aclose()


async def test_idle_retention_timer_expires_without_resume(monkeypatch):
    from python.remote import bridge as module

    monkeypatch.setattr(module, "RETENTION", 0.02)
    bridge, *_ = setup()
    id = str(uuid4())
    await collect(submit(bridge, id=id))
    record = bridge._streams[id]
    assert record.frames
    await asyncio.sleep(0.06)
    assert not record.frames and record.response is None
    assert (await collect(bridge.resume(id, -1, "phone")))[0]["code"] == "replay_gap"
    await bridge.aclose()


async def test_authorizer_failure_is_closed_and_shutdown_bounds_admission():
    bridge, *_ = setup()

    def broken(_device):
        raise RuntimeError("private authorizer detail")

    bridge.adapter.authorize_device = broken
    events = await collect(submit(bridge))
    assert events[0]["code"] == "authentication_required"
    assert "private" not in str(events)
    bridge.adapter.authorize_device = lambda device: device == "phone"
    bridge.max_requests = 1
    await collect(submit(bridge))
    assert (await collect(submit(bridge)))[0]["status"] == 200
    await bridge.aclose()
    assert (await collect(submit(bridge)))[0]["code"] == "host_shutdown"


async def test_encoded_version_identifier_matches_same_authorized_path():
    bridge, app, *_ = setup()
    route = "/api/creator/persona/created_" + "a" * 32 + "@1"

    @app.get(route)
    async def version(request: Request):
        return {
            "path": request.scope["path"],
            "raw": request.scope["raw_path"].decode(),
        }

    events = await collect(submit(bridge, path=route.replace("@", "%40")))
    assert events[0]["status"] == 200
    assert json.loads(payload(events)) == {
        "path": route,
        "raw": route.replace("@", "%40"),
    }
    await bridge.aclose()


async def test_live_device_and_global_limits_release_after_completion():
    gate = asyncio.Event()

    async def handler():
        await gate.wait()
        return Response(status_code=204)

    bridge, *_ = setup(handler)
    bridge.max_requests = 3
    bridge.max_device_requests = 2

    def start(device):
        return asyncio.create_task(
            collect(
                submit(
                    bridge,
                    device=device,
                    method="POST",
                    path="/api/chat/stream",
                    body=b'{"session_id":"phone"}',
                )
            )
        )

    readers = [start("phone"), start("phone")]
    await asyncio.sleep(0)
    assert (await collect(submit(bridge)))[0]["code"] == "bridge_capacity"
    readers.append(start("other"))
    await asyncio.sleep(0)
    assert (await collect(submit(bridge, device="other")))[0][
        "code"
    ] == "bridge_capacity"
    gate.set()
    await asyncio.wait_for(asyncio.gather(*readers), 2)
    assert (await collect(submit(bridge)))[0]["status"] == 200
    await bridge.aclose()


async def test_global_buffer_budget_and_bounded_expiring_tombstones():
    bridge, app, *_ = setup()
    bridge.max_replay_bytes = 100 * 1024
    bridge.max_completed = 2
    bridge.max_tombstones = 2
    now = [1000.0]
    bridge.clock = lambda: now[0]

    @app.get("/api/library/assets/" + "c" * 64)
    async def asset():
        return Response(b"x" * 60_000)

    ids = []
    for _ in range(6):
        id = str(uuid4())
        ids.append(id)
        events = await collect(
            submit(bridge, id=id, path="/api/library/assets/" + "c" * 64)
        )
        assert len(payload(events)) == 60_000
        assert bridge.retained_bytes <= bridge.max_replay_bytes
        assert len(bridge._streams) <= 2
        assert len(bridge._tombstones) <= 2
        now[0] += 1
    gap = await collect(bridge.resume(ids[-2], 0, "phone"))
    assert gap[-1]["code"] == "replay_gap"
    now[0] += 301
    bridge._maintain()
    assert not bridge._streams
    assert bridge.retained_bytes == 0
    assert (await collect(submit(bridge, id=ids[-1])))[0]["code"] == "duplicate_request"
    now[0] += 301
    # ID reuse is allowed only as a fresh explicit request, never an auto-retry.
    assert (await collect(submit(bridge, id=ids[-1])))[0]["status"] == 200
    await bridge.aclose()


async def test_desktop_mode_principal_still_restricted_and_models_projected(
    monkeypatch,
):
    from python.core import registry

    bridge, app, *_ = setup()
    # Replace middleware config before Starlette builds the stack.
    app.user_middleware[0].kwargs["config"] = mobile.Config(False)
    app.state.mobile_config = mobile.Config(False)

    async def models():
        return [{"id": "safe", "display_name": "Safe", "api_key": "private"}]

    async def no_le():
        return []

    monkeypatch.setattr(registry, "list_models_from_db", models)
    monkeypatch.setattr(registry, "list_le_models", no_le)
    status = json.loads(
        payload(await collect(submit(bridge, path="/api/mobile/status")))
    )
    assert status["authenticated"] and not status["administrative"]
    forbidden = await collect(submit(bridge, path="/api/mobile/admin/devices"))
    assert forbidden[0]["status"] == 403
    events = await collect(submit(bridge, path="/api/models"))
    assert json.loads(payload(events)) == {
        "models": [{"id": "safe", "display_name": "Safe"}]
    }
    await bridge.aclose()


@pytest.mark.parametrize(
    "forged", [None, {}, {"device_id": "phone", "authorized": True}]
)
async def test_scope_marker_never_confers_admin_or_authentication(forged):
    bridge, app, *_ = setup()
    scope = bridge.adapter.prepare("GET", "/api/health", {}, b"", "phone")
    scope["kyalulu.remote"] = forged
    scope["client"] = ("127.0.0.1", 1234)
    scope["headers"] = [(b"host", b"localhost")]
    assert not mobile.local_admin(Request(scope))
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app(scope, receive, send)
    assert messages[0]["status"] == 401
    await bridge.aclose()


async def test_host_shutdown_cancels_runtime_and_wakes_waiting_consumer():
    started, cancelled = asyncio.Event(), asyncio.Event()

    async def handler():
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    bridge, *_ = setup(handler)
    reader = asyncio.create_task(
        collect(
            submit(
                bridge,
                method="POST",
                path="/api/chat/stream",
                body=b'{"session_id":"phone"}',
            )
        )
    )
    await asyncio.wait_for(started.wait(), 2)
    await bridge.aclose()
    events = await asyncio.wait_for(reader, 2)
    assert cancelled.is_set()
    assert events[-1]["code"] == "host_shutdown"
    assert bridge.retained_bytes == 0


async def test_slow_live_16mib_download_backpressures_without_replay_gap():
    import hashlib

    from python.remote.bridge import CHUNK_SIZE, LIVE_WINDOW

    bridge, app, *_ = setup()
    data = bytes(range(256)) * (16 * 1024 * 1024 // 256)

    @app.get("/api/library/assets/" + "d" * 64)
    async def asset():
        return Response(data)

    id = str(uuid4())
    iterator = submit(bridge, id=id, path="/api/library/assets/" + "d" * 64)
    assert (await anext(iterator))["type"] == "response"
    for _ in range(40):
        await asyncio.sleep(0)
    record = bridge._streams[id]
    assert not record.task.done()
    assert record.size <= LIVE_WINDOW + CHUNK_SIZE * 2
    digest = hashlib.sha256()
    count = 0
    async for frame in iterator:
        assert frame["type"] != "error"
        if frame["type"] == "chunk":
            chunk = base64.b64decode(frame["data"])
            digest.update(chunk)
            count += len(chunk)
            await asyncio.sleep(0.001)
        assert record.size + record.response_size <= MAX_REPLAY
    assert count == len(data)
    assert digest.digest() == hashlib.sha256(data).digest()
    assert not record.followers
    await bridge.aclose()


async def test_generation_does_not_wait_for_stalled_attached_follower():
    data = b"x" * (MAX_REPLAY * 2)

    async def handler():
        return Response(data, media_type="text/event-stream")

    bridge, *_ = setup(handler)
    id = str(uuid4())
    iterator = submit(
        bridge,
        id=id,
        method="POST",
        path="/api/chat/stream",
        body=b'{"session_id":"phone"}',
    )
    assert (await anext(iterator))["type"] == "response"
    record = bridge._streams[id]
    await asyncio.wait_for(asyncio.shield(record.task), 2)
    assert record.done and record.size + record.response_size <= MAX_REPLAY
    assert (await anext(iterator))["code"] == "replay_gap"
    await iterator.aclose()
    assert not record.followers
    await bridge.aclose()


async def test_download_disconnect_releases_backpressure_without_leaking_subscriber():
    bridge, app, *_ = setup()

    @app.get("/api/library/assets/" + "e" * 64)
    async def asset():
        return Response(b"y" * (MAX_REPLAY * 2))

    id = str(uuid4())
    iterator = submit(bridge, id=id, path="/api/library/assets/" + "e" * 64)
    await anext(iterator)
    for _ in range(40):
        await asyncio.sleep(0)
    record = bridge._streams[id]
    assert not record.task.done()
    await iterator.aclose()
    assert not record.followers
    await asyncio.wait_for(asyncio.shield(record.task), 2)
    assert record.done
    await bridge.aclose()
