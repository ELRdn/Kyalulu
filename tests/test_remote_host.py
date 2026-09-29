"""Host orchestration using temporary vaults, real Noise, and mocked Relay I/O."""

import asyncio
import base64
import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import unquote
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from python.api.mobile import Config, Devices, MobileSecurity
from python.remote.crypto import NoiseSession, generate_keypair
from python.remote.host import HostError, HostService, confirmation_code, exact_origin
from starlette.responses import StreamingResponse

pytestmark = pytest.mark.asyncio


class MemoryVault:
    def __init__(self, config):
        self.value = copy.deepcopy(config)
        self.writes = []

    def read(self):
        return copy.deepcopy(self.value)

    def write(self, value):
        self.value = copy.deepcopy(value)
        self.writes.append(self.read())


class Wire:
    def __init__(self):
        self.sent = asyncio.Queue()

    async def send(self, message):
        await self.sent.put(message)

    async def take(self):
        return await asyncio.wait_for(self.sent.get(), 2)


class Control:
    def __init__(self, now):
        self.now = now
        self.calls = []
        self.fail = False

    async def __call__(self, method, path, body=None):
        self.calls.append((method, path, body))
        if self.fail:
            raise HostError("relay_unavailable")
        if path == "/v1/pairings":
            return {
                "pairing_id": str(uuid4()),
                "token": "t" * 43,
                "expires_at": self.now[0] + 300,
            }
        if path.endswith("/approve"):
            return {"device_id": path.split("/")[-2], "pending": False}
        return {}


@pytest_asyncio.fixture
async def host():
    private, public = generate_keypair()
    now = [1000.0]
    config = {
        "version": 1,
        "relay": "https://relay.example",
        "app_origin": "https://app.example",
        "owner_id": str(uuid4()),
        "host_id": str(uuid4()),
        "host_token": "private-token",
        "private_key": private.hex(),
        "public_key": public.hex(),
        "devices": {},
        "pairings": {},
    }
    app = FastAPI()

    @app.get("/api/health")
    async def health():
        return {"ok": True}

    @app.post("/api/library/assets")
    async def asset(request: Request):
        return {"bytes": base64.b64encode(await request.body()).decode()}

    app.add_middleware(MobileSecurity, config=Config(False), devices=Devices())
    control, wire = Control(now), Wire()

    async def health_probe():
        return {"status": "ok", "secret": "must-not-be-in-status"}

    service = HostService(
        app,
        MemoryVault(config),
        control=control,
        clock=lambda: now[0],
        le_probe=health_probe,
    )
    service.socket, service.connected = wire, True
    yield SimpleNamespace(service=service, wire=wire, control=control, now=now, app=app)
    await service.stop()


async def pair(host):
    result = await host.service.pair()
    payload = json.loads(unquote(result["url"].split("#remote=", 1)[1]))
    return result, payload


async def handshake(
    host, secret, *, device_id=None, private=None, pending=True, name="Phone"
):
    device_id, id = device_id or str(uuid4()), str(uuid4())
    private = private or generate_keypair()[0]
    config = host.service.config
    client = NoiseSession(
        private,
        initiator=True,
        expected_peer=bytes.fromhex(config["public_key"]),
        prologue=(
            f"kyalulu-remote-v1|{config['owner_id']}|{config['host_id']}|{device_id}"
        ).encode(),
    )
    await host.service.receive(
        json.dumps(
            {
                "type": "open",
                "connection_id": id,
                "device_id": device_id,
                "pending": pending,
            }
        )
    )
    if id not in host.service.connections:
        return id, device_id, private, client
    await host.service.receive(UUID(id).bytes + client.write())
    m2 = await host.wire.take()
    assert m2[:16] == UUID(id).bytes
    client.read(m2[16:])
    await host.service.receive(
        UUID(id).bytes
        + client.write(
            json.dumps(
                {
                    "version": 1,
                    "secret": secret,
                    "name": name,
                }
            ).encode()
        )
    )
    return id, device_id, private, client


async def take_frame(host, client, id):
    message = await host.wire.take()
    assert isinstance(message, bytes) and message[:16] == UUID(id).bytes
    return json.loads(client.decrypt(message[16:]))


async def approved(host):
    _, link = await pair(host)
    id, device, private, client = await handshake(host, link["secret"])
    notice = await take_frame(host, client, id)
    assert notice["type"] == "approval_required"
    await host.service.approve(device, notice["code"])
    assert await take_frame(host, client, id) == {"type": "ready", "version": 1}
    return id, device, private, client


async def send_frame(host, id, client, frame):
    await host.service.receive(
        UUID(id).bytes + client.encrypt(json.dumps(frame).encode())
    )


async def test_qr_secret_is_single_use_and_approval_is_two_phase(host):
    result, link = await pair(host)
    assert base64.b64decode(result["qr"].split(",", 1)[1]).startswith(b"\x89PNG")
    assert link["expires"] == host.now[0] + 300
    assert link["secret"] not in str(host.service.vault.read())
    id, device, _, client = await handshake(host, link["secret"])
    notice = await take_frame(host, client, id)
    assert notice["code"] == confirmation_code(client.handshake_hash)
    assert not host.service.authorized(device)
    assert not host.service.config["pairings"]
    assert host.service.status()["pending"] == [{"device_id": device, "name": "Phone"}]
    with pytest.raises(HostError, match="invalid_confirmation"):
        await host.service.approve(device, "xxxxxx")
    assert not any(path.endswith("/approve") for _, path, _ in host.control.calls)
    host.control.fail = True
    with pytest.raises(HostError):
        await host.service.approve(device, notice["code"])
    assert not host.service.authorized(device)
    assert host.service.vault.read()["devices"][device]["approved"] is False
    host.control.fail = False
    await host.service.approve(device, notice["code"])
    assert (await take_frame(host, client, id))["type"] == "ready"
    assert host.service.authorized(device)
    other, *_ = await handshake(host, link["secret"])
    assert json.loads(await host.wire.take())["type"] == "close"
    assert other not in host.service.connections
    status = json.dumps(host.service.status())
    assert link["secret"] not in status and "private-token" not in status


async def test_cloud_pending_never_authorizes_application(host):
    _, link = await pair(host)
    id, device, _, client = await handshake(host, link["secret"])
    await take_frame(host, client, id)
    await send_frame(
        host,
        id,
        client,
        {
            "type": "request",
            "id": str(uuid4()),
            "method": "GET",
            "path": "/api/health",
            "headers": {},
            "body": "",
        },
    )
    assert not host.service.bridge._streams
    assert id not in host.service.connections
    assert not host.service.authorized(device)


async def test_expired_secret_and_unknown_cloud_approved_device_are_rejected(host):
    _, link = await pair(host)
    host.now[0] += 301
    id, *_ = await handshake(host, link["secret"])
    assert id not in host.service.connections
    await host.wire.take()
    id, *_ = await handshake(host, None, pending=False)
    assert id not in host.service.connections
    assert json.loads(await host.wire.take())["type"] == "close"


async def test_reconnect_pins_peer_and_wrong_key_fails(host):
    id, device, private, _ = await approved(host)
    await host.service.receive(json.dumps({"type": "close", "connection_id": id}))
    id, _, _, client = await handshake(
        host, None, device_id=device, private=private, pending=False
    )
    assert (await take_frame(host, client, id))["type"] == "ready"
    await host.service.receive(json.dumps({"type": "close", "connection_id": id}))
    wrong, *_ = await handshake(host, None, device_id=device, pending=False)
    assert wrong not in host.service.connections
    assert json.loads(await host.wire.take())["type"] == "close"


async def test_multipart_upload_and_scoped_http_frames(host):
    id, _, _, client = await approved(host)
    request_id = str(uuid4())
    data = bytes(range(256)) * 150
    await send_frame(
        host,
        id,
        client,
        {
            "type": "request_start",
            "id": request_id,
            "method": "POST",
            "path": "/api/library/assets",
            "headers": {"content-type": "image/png"},
            "size": len(data),
        },
    )
    for offset in range(0, len(data), 24 * 1024):
        await send_frame(
            host,
            id,
            client,
            {
                "type": "request_chunk",
                "id": request_id,
                "data": base64.b64encode(data[offset : offset + 24 * 1024]).decode(),
            },
        )
    await send_frame(host, id, client, {"type": "request_end", "id": request_id})
    events = []
    while not events or events[-1]["type"] != "end":
        events.append(await take_frame(host, client, id))
    assert events[0]["status"] == 200
    assert [e["seq"] for e in events] == list(range(len(events)))
    body = b"".join(base64.b64decode(e["data"]) for e in events if e["type"] == "chunk")
    assert base64.b64decode(json.loads(body)["bytes"]) == data
    await send_frame(
        host,
        id,
        client,
        {
            "type": "request",
            "id": str(uuid4()),
            "method": "GET",
            "path": "/api/mobile/admin/devices",
            "headers": {},
            "body": "",
        },
    )
    assert (await take_frame(host, client, id))["status"] == 403


async def test_socket_disconnect_detaches_generation_and_reconnect_resumes(host):
    gate, started = asyncio.Event(), asyncio.Event()

    @host.app.post("/api/chat/stream")
    async def stream():
        async def body():
            yield b"event: meta\n\n"
            started.set()
            await gate.wait()
            yield b"event: done\n\n"

        return StreamingResponse(body(), media_type="text/event-stream")

    id, device, private, client = await approved(host)
    request_id = str(uuid4())
    await send_frame(
        host,
        id,
        client,
        {
            "type": "request",
            "id": request_id,
            "method": "POST",
            "path": "/api/chat/stream",
            "headers": {},
            "body": base64.b64encode(b'{"session_id":"remote"}').decode(),
        },
    )
    assert (await take_frame(host, client, id))["seq"] == 0
    first = await take_frame(host, client, id)
    await asyncio.wait_for(started.wait(), 2)
    await host.service.receive(json.dumps({"type": "close", "connection_id": id}))
    record = host.service.bridge._streams[request_id]
    assert not record.task.done()
    gate.set()
    await asyncio.wait_for(asyncio.shield(record.task), 2)
    id, _, _, client = await handshake(
        host, None, device_id=device, private=private, pending=False
    )
    await take_frame(host, client, id)
    await send_frame(
        host,
        id,
        client,
        {"type": "resume", "id": request_id, "after_seq": first["seq"]},
    )
    assert (await take_frame(host, client, id))["replay"] is True
    rest = []
    while not rest or rest[-1]["type"] != "end":
        rest.append(await take_frame(host, client, id))
    assert b"event: done" in b"".join(
        base64.b64decode(f["data"]) for f in rest if f["type"] == "chunk"
    )


async def test_revoke_self_ack_after_persistence_even_when_cloud_fails(host):
    id, device, private, client = await approved(host)
    host.control.fail = True
    await send_frame(host, id, client, {"type": "revoke_self"})
    assert host.service.vault.read()["devices"][device]["revoked"] is True
    assert not host.service.authorized(device)
    assert await take_frame(host, client, id) == {"type": "revoked"}
    assert json.loads(await host.wire.take())["type"] == "close"
    assert id not in host.service.connections
    reconnect, *_ = await handshake(
        host, None, device_id=device, private=private, pending=False
    )
    assert reconnect not in host.service.connections


@pytest.mark.parametrize("mode", ["time", "bytes"])
async def test_session_budgets_force_fresh_noise(host, mode):
    from python.remote.host import MAX_CONNECTION_BYTES, MAX_CONNECTION_SECONDS

    id, _, _, client = await approved(host)
    connection = host.service.connections[id]
    if mode == "time":
        connection.created -= MAX_CONNECTION_SECONDS
    else:
        connection.bytes_used = MAX_CONNECTION_BYTES
    await send_frame(
        host, id, client, {"type": "resume", "id": str(uuid4()), "after_seq": -1}
    )
    assert id not in host.service.connections
    assert json.loads(await host.wire.take())["type"] == "close"


async def test_relay_runner_authentication_and_shutdown_without_user_data(host):
    from contextlib import asynccontextmanager

    class Socket(Wire):
        async def recv(self):
            return '{"type":"ready"}'

        def __aiter__(self):
            return self

        async def __anext__(self):
            await asyncio.Event().wait()

    socket = Socket()
    urls = []

    @asynccontextmanager
    async def connector(url):
        urls.append(url)
        yield socket

    host.service.connector = connector
    await host.service.start()
    auth = json.loads(await socket.take())
    assert auth == {"role": "host", "token": "private-token"}
    for _ in range(20):
        if host.service.status()["le"]["status"] == "ok":
            break
        await asyncio.sleep(0)
    assert urls == ["wss://relay.example/v1/socket"]
    assert host.service.status()["le"] == {"status": "ok"}
    await host.service.stop()
    assert not host.service.runtime and not host.service.connected


def load_cli():
    path = Path(__file__).resolve().parents[1] / "scripts/remote_host.py"
    spec = importlib.util.spec_from_file_location("test_remote_host_cli", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def test_runtime_lock_releases_and_refuses_unowned_existing_database(tmp_path):
    cli = load_cli()
    with cli.RuntimeLock(tmp_path):
        with (
            pytest.raises(ValueError, match="already_running"),
            cli.RuntimeLock(tmp_path),
        ):
            pass
        cli.validate_directory(tmp_path)
    with cli.RuntimeLock(tmp_path):
        (tmp_path / "data.db").write_bytes(b"untouched user database")
        with pytest.raises(ValueError, match="empty_data_directory"):
            cli.validate_directory(tmp_path)
        with pytest.raises(ValueError, match="not_owned"):
            cli.validate_directory(tmp_path, str(uuid4()))
    assert (tmp_path / "data.db").read_bytes() == b"untouched user database"


async def test_cli_registration_uses_temporary_vault_and_never_starts_autostart(
    tmp_path, monkeypatch
):
    import httpx
    from python.remote import vault as vault_module

    records = {}

    class TestVault:
        def __init__(self, path):
            self.path = path

        def write(self, value):
            records[self.path] = copy.deepcopy(value)
            self.path.write_bytes(b"test vault marker; no secrets on disk")

        def read(self):
            return copy.deepcopy(records[self.path])

    monkeypatch.setattr(vault_module, "Vault", TestVault)

    cli = load_cli()
    calls = []
    host_id, owner_id = str(uuid4()), str(uuid4())

    async def post(_self, url, **kwargs):
        calls.append((url, kwargs))
        return httpx.Response(
            200,
            json={
                "owner_id": owner_id,
                "host_id": host_id,
                "host_token": "secret-token",
            },
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    args = SimpleNamespace(
        relay="https://relay.example",
        app_origin="https://app.example",
        vault=tmp_path / "host.vault",
        data_dir=tmp_path / "data",
        name="Test",
    )
    result = await cli.register(args, "private-invitation")
    assert result == {"registered": True, "host_id": host_id}
    config = TestVault(args.vault).read()
    assert config["host_token"] == "secret-token"
    assert "private-invitation" not in str(config)
    cli.load_config(args)
    assert calls[0][0] == "https://relay.example/v1/invitations/redeem"
    assert calls[0][1]["json"] == {"invite": "private-invitation", "name": "Test"}
    with pytest.raises(ValueError, match="vault_already_exists"):
        await cli.register(args, "unused")


@pytest.mark.parametrize(
    "origin",
    [
        "http://public.example",
        "https://host/path",
        "https://host/",
        "https://user:pass@host",
        "https://host?token=x",
        "https://host\\evil",
    ],
)
async def test_non_tls_or_non_origin_relay_is_rejected(origin):
    with pytest.raises((HostError, ValueError)):
        exact_origin(origin)


async def test_explicit_adoption_backs_up_committed_wal_without_moving_source(
    tmp_path, monkeypatch
):
    import hashlib
    import sqlite3
    from contextlib import closing

    cli = load_cli()
    monkeypatch.setattr(cli, "refuse_legacy_runtime", lambda: None)
    source = tmp_path / "data.db"
    with closing(sqlite3.connect(source)) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("CREATE TABLE chat_history(content TEXT)")
        conn.execute("INSERT INTO chat_history VALUES('existing conversation')")
        conn.commit()
        # The committed row is still in WAL; copying only data.db would lose it.
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        with cli.RuntimeLock(tmp_path):
            with pytest.raises(ValueError, match="empty_data_directory"):
                cli.prepare_directory(tmp_path, False)
            backup = cli.prepare_directory(tmp_path, True)
        assert source.is_file()
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before
        with closing(sqlite3.connect(backup)) as saved:
            assert saved.execute("SELECT content FROM chat_history").fetchall() == [
                ("existing conversation",)
            ]
        assert not (tmp_path / ".remote-host-owner").exists()


async def test_legacy_runtime_scan_refuses_known_processes_and_unknown_python(
    monkeypatch,
):
    import psutil

    cli = load_cli()
    for name, command in (
        ("python.exe", ["python", "-m", "uvicorn", "python.api.main:app"]),
        ("python.exe", None),
    ):
        monkeypatch.setattr(
            psutil,
            "process_iter",
            lambda _attrs, name=name, command=command: [
                SimpleNamespace(info={"pid": -1, "name": name, "cmdline": command})
            ],
        )
        with pytest.raises(ValueError):
            cli.refuse_legacy_runtime()
    monkeypatch.setattr(psutil, "process_iter", lambda _attrs: [])
    cli.refuse_legacy_runtime()


async def test_all_runtime_lifespans_lock_before_recovery_and_release(
    tmp_path, monkeypatch
):
    from python.api import benchmarks, main
    from python.core import benchmark
    from python.storage import db, generations

    calls = []

    async def initialize():
        calls.append("initialize")

    async def recover():
        calls.append("recover")

    async def noop(*_args):
        pass

    monkeypatch.setattr(db, "DB_PATH", tmp_path / "data.db")
    monkeypatch.setattr(main, "init_db", initialize)
    monkeypatch.setattr(main, "load_yaml_registry", list)
    monkeypatch.setattr(main, "sync_to_db", noop)
    monkeypatch.setattr(generations, "recover_interrupted", recover)
    monkeypatch.setattr(benchmark, "recover_jobs", lambda: None)
    monkeypatch.setattr(benchmarks, "shutdown", noop)
    async with main.lifespan(main.app):
        with pytest.raises(ValueError, match="already_running"):
            async with main.lifespan(main.app):
                pytest.fail("second runtime entered")
        assert calls == ["initialize", "recover"]
    async with main.lifespan(main.app):
        assert calls == ["initialize", "recover", "initialize", "recover"]


async def test_autostart_is_hidden_opt_in_and_not_started(tmp_path, monkeypatch):
    import os
    import subprocess
    import sys

    if os.name != "nt":
        pytest.skip("Windows Task Scheduler registration format")
    cli = load_cli()
    monkeypatch.setattr(cli, "load_config", lambda _args: None)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "python.exe"))
    (tmp_path / "pythonw.exe").write_bytes(b"fixture")
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(subprocess, "run", run)
    args = SimpleNamespace(
        vault=tmp_path / "host.vault", data_dir=tmp_path / "data", port=8766
    )
    result = cli.install_autostart(args)
    assert result["autostart"]
    command, options = calls[0]
    script = base64.b64decode(command[-1]).decode("utf-16-le")
    assert "Register-ScheduledTask" in script
    assert "Start-ScheduledTask" not in script
    assert "pythonw.exe" in script
    assert "-RunLevel Limited" in script
    assert options["creationflags"] == subprocess.CREATE_NO_WINDOW


async def test_vault_failure_never_grants_approval(host, monkeypatch):
    _, link = await pair(host)
    id, device, _, client = await handshake(host, link["secret"])
    notice = await take_frame(host, client, id)

    def fail(_value):
        raise OSError("test storage failure")

    monkeypatch.setattr(host.service.vault, "write", fail)
    with pytest.raises(OSError):
        await host.service.approve(device, notice["code"])
    assert not host.service.authorized(device)
    assert not any(path.endswith("/approve") for _, path, _ in host.control.calls)


async def test_immediate_disconnect_after_complete_request_still_submits_once(host):
    id, _, _, client = await approved(host)
    request_id = str(uuid4())
    await send_frame(
        host,
        id,
        client,
        {
            "type": "request",
            "id": request_id,
            "method": "GET",
            "path": "/api/health",
            "headers": {},
            "body": "",
        },
    )
    await host.service.receive(json.dumps({"type": "close", "connection_id": id}))
    record = host.service.bridge._streams[request_id]
    await asyncio.wait_for(asyncio.shield(record.task), 2)
    assert record.done
    assert record.frames[-1][2]["type"] == "end"


async def test_global_wire_pacing_serializes_devices_and_accounts_bytes(host):
    from itertools import pairwise

    from python.remote.host import OUTGOING_BYTES_PER_SECOND, OUTGOING_FRAMES_PER_SECOND

    now = [100.0]
    sent = []
    host.service.monotonic = lambda: now[0]

    async def sleep(delay):
        now[0] += delay
        await asyncio.sleep(0)

    async def send(message):
        sent.append(
            (
                now[0],
                len(message.encode()) if isinstance(message, str) else len(message),
            )
        )

    host.service._pace_sleep = sleep
    host.wire.send = send
    messages = [b"x" * 65535, "端末", b"small", b"x" * 65535] * 80
    await asyncio.gather(*(host.service._wire_send(message) for message in messages))
    for previous, current in pairwise(sent):
        assert (
            current[0] - previous[0]
            >= max(
                previous[1] / OUTGOING_BYTES_PER_SECOND,
                1 / OUTGOING_FRAMES_PER_SECOND,
            )
            - 1e-9
        )
    assert (
        sum(size for _, size in sent[:-1]) / (sent[-1][0] - sent[0][0])
        <= OUTGOING_BYTES_PER_SECOND
    )
    assert (len(sent) - 1) / (sent[-1][0] - sent[0][0]) <= OUTGOING_FRAMES_PER_SECOND


async def test_paced_live_large_binary_response_matches_upload_hash(host):
    import hashlib

    from python.remote.bridge import MAX_REPLAY

    id, _, _, client = await approved(host)
    data = bytes(range(256)) * (3 * 1024 * 1024 // 256)
    request_id = str(uuid4())
    await send_frame(
        host,
        id,
        client,
        {
            "type": "request_start",
            "id": request_id,
            "method": "POST",
            "path": "/api/library/assets",
            "headers": {"content-type": "image/png"},
            "size": len(data),
        },
    )
    for offset in range(0, len(data), 24 * 1024):
        await send_frame(
            host,
            id,
            client,
            {
                "type": "request_chunk",
                "id": request_id,
                "data": base64.b64encode(data[offset : offset + 24 * 1024]).decode(),
            },
        )
    await send_frame(host, id, client, {"type": "request_end", "id": request_id})
    response = bytearray()
    seq = 0
    while True:
        frame = await take_frame(host, client, id)
        assert frame["type"] != "error"
        assert frame["seq"] == seq
        seq += 1
        if frame["type"] == "chunk":
            response.extend(base64.b64decode(frame["data"]))
        if frame["type"] == "end":
            break
        record = host.service.bridge._streams[request_id]
        assert record.size + record.response_size <= MAX_REPLAY
    assert len(response) > MAX_REPLAY
    actual = base64.b64decode(json.loads(response)["bytes"])
    assert hashlib.sha256(actual).digest() == hashlib.sha256(data).digest()
    assert id in host.service.connections


async def test_paced_send_never_uses_closed_connection(host):
    id, _, _, _ = await approved(host)
    connection = host.service.connections[id]
    host.service._next_send_at = host.service.monotonic() + 0.1

    async def disappear(_delay):
        await host.service._close_connection(id)

    host.service._pace_sleep = disappear
    with pytest.raises(HostError, match="connection_closed"):
        await host.service._send_frame(connection, {"type": "ready", "version": 1})
    assert host.wire.sent.empty()
