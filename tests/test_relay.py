"""Standalone Relay contract and security boundaries; no inference/crypto required."""

import asyncio
import json
import subprocess
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from runtime.python.relay.app import Hub, Limiter, Peer, create_app
from runtime.python.relay.store import Store, digest
from scripts.relay import backup

ORIGIN = "https://app.example.test"


@pytest.fixture
def env(tmp_path):
    app = create_app(str(tmp_path / "relay.db"), origins=[ORIGIN])
    with TestClient(app) as client:
        yield app.state.store, client, app.state.hub


def host(store, owner=None):
    return store.redeem_invite(store.invite(owner=owner), "host")


def device(store, owner_host):
    ticket = store.pairing(owner_host["host_token"], 300)
    return store.redeem_pairing(ticket["pairing_id"], ticket["token"], "client")


def headers(token):
    return {"Authorization": "Bearer " + token}


@contextmanager
def socket(client, role, token, origin=None):
    if origin is None and role == "client":
        origin = ORIGIN
    with client.websocket_connect(
        "/v1/socket", headers={"Origin": origin} if origin else {}
    ) as ws:
        ws.send_json(dict(role=role, token=token))
        assert ws.receive_json() == {"type": "ready"}
        yield ws


def failure(status, function, *args):
    with pytest.raises(HTTPException) as error:
        function(*args)
    assert error.value.status_code == status


def test_http_contract_cors_and_hash_storage(env):
    store, client, _ = env
    invitation = store.invite()
    result = client.post(
        "/v1/invitations/redeem",
        json={"invite": invitation, "name": "first"},
        headers={"Origin": ORIGIN},
    )
    assert result.status_code == 200
    assert result.headers["access-control-allow-origin"] == ORIGIN
    assert result.headers["cache-control"] == "no-store"
    first = result.json()
    ticket = client.post(
        "/v1/pairings", json={"ttl": 300}, headers=headers(first["host_token"])
    ).json()
    enrolled = client.post(
        f"/v1/pairings/{ticket['pairing_id']}/redeem",
        json={"token": ticket["token"], "name": "phone"},
    ).json()
    assert enrolled["pending"] is True
    assert 295 < enrolled["expires_at"] - time.time() <= 300
    with store.transaction() as db:
        hashes = [r[0] for r in db.execute("SELECT hash FROM devices")]
        dump = "\n".join(db.iterdump())
    assert digest(first["host_token"]) in hashes
    assert digest(enrolled["device_token"]) in hashes
    for secret in (
        invitation,
        first["host_token"],
        ticket["token"],
        enrolled["device_token"],
    ):
        assert secret not in dump
    preflight = client.options(
        "/v1/pairings/id/redeem",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == ORIGIN
    bad = client.options(
        "/v1/pairings",
        headers={
            "Origin": "https://evil.test",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert bad.status_code == 400
    assert "access-control-allow-origin" not in bad.headers


def test_tenant_scope_and_paired_host_approval(env):
    store, client, _ = env
    a, b = host(store), host(store)
    a2 = host(store, a["owner_id"])
    phone = device(store, a)
    token = phone["device_token"]
    assert [
        h["host_id"]
        for h in client.get("/v1/hosts", headers=headers(token)).json()["hosts"]
    ] == [a["host_id"]]
    path = f"/v1/devices/{phone['device_id']}"
    assert client.delete(path, headers=headers(b["host_token"])).status_code == 404
    assert (
        client.post(path + "/approve", headers=headers(a2["host_token"])).status_code
        == 404
    )
    assert (
        client.post("/v1/pairings", json={}, headers=headers(token)).status_code == 403
    )
    assert (
        client.post(path + "/approve", headers=headers(a["host_token"])).status_code
        == 200
    )
    assert client.delete(path, headers=headers(a2["host_token"])).status_code == 204
    assert client.get("/v1/hosts", headers=headers(token)).status_code == 401


def test_owner_host_quotas_and_invite_replay(env):
    store, _, _ = env
    token = store.invite()
    a = store.redeem_invite(token, "one")
    failure(401, store.redeem_invite, token, "replay")
    host(store, a["owner_id"])
    extra = store.invite(owner=a["owner_id"])
    failure(409, store.redeem_invite, extra, "third")
    for _ in range(9):
        host(store)
    failure(409, store.redeem_invite, store.invite(), "eleventh")


def test_pending_expiry_does_not_burn_approved_quota(env):
    store, _, _ = env
    a = host(store)
    pending = [device(store, a) for _ in range(5)]
    ticket = store.pairing(a["host_token"], 300)
    failure(409, store.redeem_pairing, ticket["pairing_id"], ticket["token"], "blocked")
    with store.transaction() as db:
        db.execute(
            "UPDATE devices SET expires=? WHERE role='client'", (time.time() - 1,)
        )
    failure(401, store.authenticate, pending[0]["device_token"])
    phone = store.redeem_pairing(ticket["pairing_id"], ticket["token"], "retry")
    store.approve(a["host_token"], phone["device_id"])
    for _ in range(4):
        store.approve(a["host_token"], device(store, a)["device_id"])
    extra = device(store, a)
    failure(409, store.approve, a["host_token"], extra["device_id"])
    assert store.approve(a["host_token"], phone["device_id"])["pending"] is False
    store.revoke(a["host_token"], phone["device_id"])
    store.approve(a["host_token"], extra["device_id"])


def test_tickets_expire_and_wrong_secret_is_not_consumption(env):
    store, _, _ = env
    a = host(store)
    ticket = store.pairing(a["host_token"], 300)
    failure(401, store.redeem_pairing, ticket["pairing_id"], "wrong" * 8, "no")
    phone = store.redeem_pairing(ticket["pairing_id"], ticket["token"], "yes")
    assert phone["device_id"]
    failure(401, store.redeem_pairing, ticket["pairing_id"], ticket["token"], "replay")
    expired = store.pairing(a["host_token"], 300)
    invitation = store.invite()
    with store.transaction() as db:
        db.execute("UPDATE tickets SET expires=?", (time.time() - 1,))
    failure(
        401, store.redeem_pairing, expired["pairing_id"], expired["token"], "expired"
    )
    failure(401, store.redeem_invite, invitation, "expired")


def test_concurrent_redeem_is_single_use(env):
    store, _, _ = env
    ticket = store.pairing(host(store)["host_token"], 300)

    def redeem(_):
        try:
            return store.redeem_pairing(ticket["pairing_id"], ticket["token"], "race")[
                "device_id"
            ]
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(redeem, range(8)))
    assert results.count(401) == 7
    assert sum(isinstance(result, str) for result in results) == 1


def test_concurrent_approval_last_slot(env):
    store, _, _ = env
    a = host(store)
    for _ in range(4):
        store.approve(a["host_token"], device(store, a)["device_id"])
    phones = [device(store, a) for _ in range(2)]

    def approve(phone):
        try:
            store.approve(a["host_token"], phone["device_id"])
            return 200
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(approve, phones)) == [200, 409]


def test_mux_binary_roundtrip_and_close(env):
    store, client, _ = env
    a = host(store)
    phones = [device(store, a) for _ in range(2)]
    with socket(client, "host", a["host_token"]) as h:
        with socket(client, "client", phones[0]["device_token"]) as c1:
            one = h.receive_json()
            assert one["device_id"] == phones[0]["device_id"] and one["pending"]
            with socket(client, "client", phones[1]["device_token"]) as c2:
                two = h.receive_json()
                raw = b"\x00\xffopaque-noise" * 100
                c1.send_bytes(raw)
                assert h.receive_bytes() == uuid.UUID(one["connection_id"]).bytes + raw
                h.send_bytes(uuid.UUID(two["connection_id"]).bytes + b"noise-response")
                assert c2.receive_bytes() == b"noise-response"
                h.send_json(dict(type="close", connection_id=two["connection_id"]))
                with pytest.raises(WebSocketDisconnect):
                    c2.receive_bytes()


def test_cross_host_connection_injection_closes_attacker(env):
    store, client, _ = env
    a, b = host(store), host(store)
    phone = device(store, a)
    with (
        socket(client, "host", a["host_token"]) as ha,
        socket(client, "host", b["host_token"]) as hb,
    ):
        with socket(client, "client", phone["device_token"]) as c:
            opened = ha.receive_json()
            hb.send_bytes(uuid.UUID(opened["connection_id"]).bytes + b"injected")
            with pytest.raises(WebSocketDisconnect) as error:
                hb.receive_bytes()
            assert error.value.code == 1008
            c.send_bytes(b"still-alive")
            assert ha.receive_bytes().endswith(b"still-alive")


def test_revocation_closes_live_socket_and_survives_restart(env):
    store, client, _ = env
    a = host(store)
    phone = device(store, a)
    with socket(client, "host", a["host_token"]) as h:
        with socket(client, "client", phone["device_token"]) as c:
            h.receive_json()
            result = client.delete(
                f"/v1/devices/{phone['device_id']}", headers=headers(a["host_token"])
            )
            assert result.status_code == 204
            with pytest.raises(WebSocketDisconnect) as error:
                c.receive_bytes()
            assert error.value.code == 1008
            assert h.receive_json()["type"] == "close"
    failure(401, Store(store.path).authenticate, phone["device_token"])


def test_host_revocation_cascades_to_tickets_and_connections(env):
    store, client, _ = env
    a = host(store)
    phone = device(store, a)
    ticket = store.pairing(a["host_token"], 300)
    with (
        socket(client, "host", a["host_token"]) as h,
        socket(client, "client", phone["device_token"]) as c,
    ):
        h.receive_json()
        assert (
            client.delete(
                f"/v1/devices/{a['host_id']}", headers=headers(a["host_token"])
            ).status_code
            == 204
        )
        for ws in (h, c):
            with pytest.raises(WebSocketDisconnect):
                ws.receive_bytes()
    failure(
        401, store.redeem_pairing, ticket["pairing_id"], ticket["token"], "dead-host"
    )
    failure(401, store.authenticate, phone["device_token"])


def test_pending_socket_expires(env):
    store, client, _ = env
    a = host(store)
    phone = device(store, a)
    with (
        socket(client, "host", a["host_token"]) as h,
        socket(client, "client", phone["device_token"]) as c,
    ):
        h.receive_json()
        with store.transaction() as db:
            db.execute(
                "UPDATE devices SET expires=? WHERE id=?",
                (time.time() - 1, phone["device_id"]),
            )
        with pytest.raises(WebSocketDisconnect) as error:
            c.receive_bytes()
        assert error.value.code == 1008


def test_offline_duplicate_and_origin_rules(env):
    store, client, _ = env
    a = host(store)
    phone = device(store, a)
    with pytest.raises(WebSocketDisconnect) as error:
        with socket(client, "client", phone["device_token"]):
            pass
    assert error.value.code == 1013
    with socket(client, "host", a["host_token"]):
        with pytest.raises(WebSocketDisconnect) as error:
            with socket(client, "host", a["host_token"]):
                pass
        assert error.value.code == 1013
    for role, token, origin in [
        ("host", a["host_token"], ORIGIN),
        ("client", phone["device_token"], None),
        ("client", phone["device_token"], "https://evil.test"),
    ]:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/v1/socket", headers={"Origin": origin} if origin else {}
            ) as ws:
                ws.send_json(dict(role=role, token=token))
                ws.receive_json()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/v1/socket?token=not-allowed"):
            pass


@pytest.mark.parametrize(
    "payload", [b"x" * 65537, "plaintext is not allowed"], ids=["oversize", "text"]
)
def test_client_invalid_frames(env, payload):
    store, client, _ = env
    a = host(store)
    phone = device(store, a)
    with (
        socket(client, "host", a["host_token"]) as h,
        socket(client, "client", phone["device_token"]) as c,
    ):
        h.receive_json()
        if isinstance(payload, bytes):
            c.send_bytes(payload)
        else:
            c.send_text(payload)
        with pytest.raises(WebSocketDisconnect) as error:
            c.receive_bytes()
        assert error.value.code == (1009 if isinstance(payload, bytes) else 1008)


def test_validation_never_echoes_secret_and_http_bounds(env):
    _, client, _ = env
    secret = "DO-NOT-ECHO-THIS-SECRET"
    result = client.post("/v1/invitations/redeem", json={"invite": secret, "name": ""})
    assert result.status_code == 422 and secret not in result.text
    assert client.post("/v1/pairings", content=b"x" * 4097).status_code == 413
    for ttl in (0, 301, True, "300"):
        assert client.post("/v1/pairings", json={"ttl": ttl}).status_code == 422
    assert client.get("/v1/hosts?token=secret").status_code == 400


def test_rate_limit_bounded_and_http_throttles(env):
    _, client, _ = env
    limiter = Limiter()
    assert all(limiter.allow("same-ip") for _ in range(120))
    assert not limiter.allow("same-ip")
    for i in range(3000):
        limiter.allow(str(i))
    assert len(limiter.ips) <= 2048
    assert not limiter.allow("fresh-ip")
    codes = [client.get("/healthz").status_code for _ in range(121)]
    assert codes[-1] == 429


def test_slow_peer_queue_is_bounded_and_cascades(env):
    store, _, _ = env
    a = host(store)
    phone = device(store, a)
    hub = Hub(store)
    h = Peer(None, store.authenticate(a["host_token"]))
    c = Peer(None, store.authenticate(phone["device_token"]))
    hub.attach(h)
    hub.attach(c)
    for _ in range(40):
        h.put(b"noise")
    assert h.queue.qsize() == 32 and h.stopped.is_set() and h.code == 1013
    hub.detach(h)
    assert c.stopped.is_set()
    hub.detach(c)
    assert not hub.sessions and not hub.peers


def test_slow_send_times_out(monkeypatch):
    monkeypatch.setattr("runtime.python.relay.app.SEND_TIMEOUT", 0.02)

    class SlowSocket:
        async def send_bytes(self, value):
            await asyncio.Event().wait()

    async def exercise():
        peer = Peer(SlowSocket(), {})
        peer.put(b"opaque")
        await asyncio.wait_for(peer.writer(), 1)
        assert peer.stopped.is_set() and peer.code == 1013

    asyncio.run(exercise())


def test_backup_restore_preserves_quota_and_revocation(env, tmp_path):
    store, _, _ = env
    a = host(store)
    phone = device(store, a)
    store.revoke(a["host_token"], phone["device_id"])
    snapshot = tmp_path / "snapshot.db"
    restored = tmp_path / "restored.db"
    backup(Path(store.path), snapshot)
    backup(snapshot, restored)
    recovered = Store(str(restored))
    failure(401, recovered.authenticate, phone["device_token"])
    assert recovered.authenticate(a["host_token"])["owner"] == a["owner_id"]
    host(recovered, a["owner_id"])
    failure(
        409, recovered.redeem_invite, recovered.invite(owner=a["owner_id"]), "third"
    )
    with pytest.raises(FileExistsError):
        backup(snapshot, restored)


def test_auth_deadline_and_malformed_first_frames(env, monkeypatch):
    _, client, hub = env
    monkeypatch.setattr("runtime.python.relay.app.AUTH_TIMEOUT", 0.02)
    with client.websocket_connect("/v1/socket") as ws:
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 1008
    for payload in ("{}", "[]", "not-json", "x" * 1025):
        with client.websocket_connect("/v1/socket") as ws:
            ws.send_text(payload)
            with pytest.raises(WebSocketDisconnect) as error:
                ws.receive_json()
            assert error.value.code == 1008
    assert hub.connections == 0


def test_host_disconnect_closes_clients_and_cleans_hub(env):
    store, client, hub = env
    a = host(store)
    phone = device(store, a)
    with socket(client, "host", a["host_token"]) as h:
        with socket(client, "client", phone["device_token"]) as c:
            h.receive_json()
            h.close()
            with pytest.raises(WebSocketDisconnect) as error:
                c.receive_bytes()
            assert error.value.code == 1001
    assert not hub.peers and not hub.sessions


def test_maximum_binary_frame_roundtrip(env):
    store, client, _ = env
    a = host(store)
    phone = device(store, a)
    with (
        socket(client, "host", a["host_token"]) as h,
        socket(client, "client", phone["device_token"]) as c,
    ):
        connection = uuid.UUID(h.receive_json()["connection_id"]).bytes
        payload = bytes(range(256)) * 256
        c.send_bytes(payload)
        assert h.receive_bytes() == connection + payload
        h.send_bytes(connection + payload)
        assert c.receive_bytes() == payload
        h.send_bytes(connection + payload + b"!")
        with pytest.raises(WebSocketDisconnect) as error:
            h.receive_bytes()
        assert error.value.code == 1009


def test_ticket_count_is_bounded_and_can_recover(env):
    store, _, _ = env
    a = host(store)
    for _ in range(10):
        store.pairing(a["host_token"], 300)
    failure(409, store.pairing, a["host_token"], 300)
    with store.transaction() as db:
        db.execute("UPDATE tickets SET expires=?", (time.time() - 1,))
    assert store.pairing(a["host_token"], 300)["token"]


def test_no_secret_or_body_logs(env, caplog, capsys):
    store, client, _ = env
    a = host(store)
    phone = device(store, a)
    secret_text = "noise-body-must-never-appear-in-logs"
    with (
        socket(client, "host", a["host_token"]) as h,
        socket(client, "client", phone["device_token"]) as c,
    ):
        h.receive_json()
        c.send_bytes(secret_text.encode())
        h.receive_bytes()
    output = caplog.text + str(capsys.readouterr())
    for secret in (secret_text, a["host_token"], phone["device_token"]):
        assert secret not in output


def test_operator_cli_invite_backup_restore(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "relay.py"
    original, snapshot, restored = (
        tmp_path / name for name in ("original.db", "snapshot.db", "restored.db")
    )

    def run(db, *args):
        return subprocess.run(
            [sys.executable, str(script), "--db", str(db), *map(str, args)],
            capture_output=True,
            text=True,
            timeout=15,
        )

    invitation = run(original, "invite", "--ttl", 60)
    assert invitation.returncode == 0
    a = Store(str(original)).redeem_invite(
        json.loads(invitation.stdout)["invite"], "cli-host"
    )
    assert run(original, "backup", snapshot).returncode == 0
    assert run(restored, "restore", snapshot).returncode != 0
    assert run(restored, "restore", snapshot, "--offline").returncode == 0
    assert Store(str(restored)).authenticate(a["host_token"])["id"] == a["host_id"]
    assert run(restored, "restore", snapshot, "--offline").returncode != 0


def test_slow_client_does_not_stop_other_owner_sessions(env):
    store, _, _ = env
    a = host(store)
    phones = [device(store, a) for _ in range(2)]
    hub = Hub(store)
    h = Peer(None, store.authenticate(a["host_token"]))
    clients = [Peer(None, store.authenticate(p["device_token"])) for p in phones]
    hub.attach(h)
    for client in clients:
        hub.attach(client)
    for _ in range(33):
        clients[0].put(b"noise")
    assert clients[0].stopped.is_set()
    hub.detach(clients[0])
    assert not h.stopped.is_set() and not clients[1].stopped.is_set()
    assert clients[1].connection in hub.sessions
