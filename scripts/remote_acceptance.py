"""Isolated loopback Relay soak and operator-CLI recovery verification.

Uses synthetic opaque random bytes, not a Noise/crypto acceptance test. Output
contains aggregate counters only. Never accepts a production URL or database.
"""

import argparse
import asyncio
import json
import logging
import math
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import AsyncExitStack, closing
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

ORIGIN = "https://acceptance.invalid"
QUIET = logging.getLogger("relay.acceptance.transport")
QUIET.setLevel(logging.CRITICAL)
QUIET.propagate = False
QUIET.addHandler(logging.NullHandler())


class AcceptanceError(Exception):
    """Only fixed, non-secret error codes may be used as messages."""


def require(condition, code):
    if not condition:
        raise AcceptanceError(code)


class Metrics:
    """Fixed-size histogram; memory does not grow over a 24-hour soak."""

    def __init__(self):
        self.sent = self.received = self.bytes = self.host_frames = self.opens = 0
        self.minimum = math.inf
        self.maximum = self.total = 0.0
        self.histogram = [0] * 10002  # ceil(ms), final bucket is >10 seconds
        self.per_client = {}

    def record(self, latency, size, index):
        ms = latency * 1000
        self.received += 1
        self.bytes += size
        self.total += ms
        self.minimum, self.maximum = min(self.minimum, ms), max(self.maximum, ms)
        self.histogram[min(math.ceil(ms), 10001)] += 1
        self.per_client[index] = self.per_client.get(index, 0) + 1

    def snapshot(self):
        def percentile(fraction):
            if not self.received:
                return None
            remaining = math.ceil(self.received * fraction)
            for upper, count in enumerate(self.histogram):
                remaining -= count
                if remaining <= 0:
                    return upper if upper <= 10000 else ">10000"

        return {
            "sent": self.sent,
            "roundtrips": self.received,
            "host_echo_frames": self.host_frames,
            "opened_clients": self.opens,
            "client_bytes_each_direction": self.bytes,
            "clients_with_roundtrips": len(self.per_client),
            "min_roundtrips_per_client": min(self.per_client.values(), default=0),
            "latency_ms": {
                "min": round(self.minimum, 3) if self.received else None,
                "mean": round(self.total / self.received, 3) if self.received else None,
                "max": round(self.maximum, 3) if self.received else None,
                "p50_upper": percentile(0.50),
                "p95_upper": percentile(0.95),
                "p99_upper": percentile(0.99),
                "histogram_resolution_ms": 1,
            },
        }


def seed(path, clients=5):
    """Only synthetic metadata. This runs OFFLINE, before Uvicorn starts."""
    from runtime.python.relay.store import Store

    store = Store(str(path))
    owners = []
    for _ in range(10):
        host = store.redeem_invite(store.invite(), "acceptance-host")
        phones = []
        for _ in range(clients):
            ticket = store.pairing(host["host_token"], 300)
            phone = store.redeem_pairing(
                ticket["pairing_id"], ticket["token"], "acceptance-client"
            )
            store.approve(host["host_token"], phone["device_id"])
            phones.append(phone)
        owners.append((host, phones))
    return owners


def cli(db, *args):
    # stdout can contain a newly created invitation. Never forward it to logs.
    return subprocess.run(
        [
            sys.executable,
            str(ROOT / "scripts" / "relay.py"),
            "--db",
            str(db),
            *map(str, args),
        ],
        capture_output=True,
        text=True,
        timeout=30,
        cwd=ROOT,
    )


def metadata(path):
    with closing(sqlite3.connect(path)) as db:
        require(
            db.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "db_integrity"
        )
        require(
            not db.execute("PRAGMA foreign_key_check").fetchall(), "db_foreign_keys"
        )
        return {
            table: db.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
            for table in ("owners", "devices", "tickets")
        }


def verify_operations(directory):
    """Exercise the real CLI with dummy metadata and committed WAL transactions."""
    from fastapi import HTTPException
    from runtime.python.relay.store import Store

    directory = Path(directory)
    original, snapshot, restored = (
        directory / name for name in ("ops.db", "backup.db", "restore.db")
    )
    result = cli(original, "invite", "--ttl", 300)
    require(result.returncode == 0, "cli_invite")
    store = Store(str(original))
    host = store.redeem_invite(json.loads(result.stdout)["invite"], "dummy-owner")
    store.redeem_invite(store.invite(owner=host["owner_id"]), "dummy-second-host")
    clients = []
    for _ in range(2):
        ticket = store.pairing(host["host_token"], 300)
        client = store.redeem_pairing(
            ticket["pairing_id"], ticket["token"], "dummy-device"
        )
        store.approve(host["host_token"], client["device_id"])
        clients.append(client)
    store.revoke(host["host_token"], clients[1]["device_id"])
    # Keep a connection open to prevent last-close checkpointing. A backup must
    # include the ticket committed AFTER this connection was opened.
    with closing(sqlite3.connect(original)) as keeper:
        keeper.execute("PRAGMA wal_autocheckpoint=0")
        keeper.execute("BEGIN")
        keeper.execute("SELECT id FROM owners").fetchall()
        ticket = store.pairing(host["host_token"], 300)
        wal = Path(str(original) + "-wal")
        require(wal.exists() and wal.stat().st_size > 0, "wal_fixture_missing")
        expected = metadata(original)
        require(cli(original, "backup", snapshot).returncode == 0, "cli_backup")
    require(metadata(snapshot) == expected, "backup_metadata_mismatch")
    require(cli(restored, "restore", snapshot).returncode != 0, "offline_flag_required")
    require(not restored.exists(), "restore_without_flag_wrote_db")
    require(
        cli(restored, "restore", snapshot, "--offline").returncode == 0, "cli_restore"
    )
    require(metadata(restored) == expected, "restore_metadata_mismatch")
    require(
        cli(original, "backup", snapshot).returncode != 0, "backup_overwrite_allowed"
    )
    require(
        cli(restored, "restore", snapshot, "--offline").returncode != 0,
        "restore_overwrite_allowed",
    )
    require(
        metadata(snapshot) == expected and metadata(restored) == expected,
        "overwrite_changed_db",
    )
    recovered = Store(str(restored))
    recovered.authenticate(host["host_token"], "host")
    recovered.authenticate(clients[0]["device_token"], "client")
    try:
        recovered.authenticate(clients[1]["device_token"])
    except HTTPException as error:
        require(error.status_code == 401, "wrong_revocation_error")
    else:
        raise AcceptanceError("revocation_lost")
    try:
        recovered.redeem_invite(recovered.invite(owner=host["owner_id"]), "third-host")
    except HTTPException as error:
        require(error.status_code == 409, "wrong_quota_error")
    else:
        raise AcceptanceError("host_quota_lost")
    recovered.redeem_pairing(ticket["pairing_id"], ticket["token"], "wal-ticket")
    try:
        recovered.redeem_pairing(ticket["pairing_id"], ticket["token"], "replay")
    except HTTPException as error:
        require(error.status_code == 401, "wrong_replay_error")
    else:
        raise AcceptanceError("ticket_replay_allowed")
    return {
        "status": "passed",
        "owners": len(expected["owners"]),
        "devices": len(expected["devices"]),
        "tickets": len(expected["tickets"]),
        "wal_included": True,
        "revocation_preserved": True,
        "quota_preserved": True,
        "ticket_single_use_preserved": True,
        "overwrite_refused": True,
        "restore_requires_offline": True,
    }


async def http_status(port, token):
    async with asyncio.timeout(5):
        reader, writer = await asyncio.open_connection("127.0.0.1", port)
        try:
            writer.write(
                (
                    f"GET /v1/hosts HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n"
                    f"Authorization: Bearer {token}\r\nConnection: close\r\n\r\n"
                ).encode()
            )
            await writer.drain()
            head = await reader.readuntil(b"\r\n\r\n")
            # The response body contains only routing metadata, but isn't logged.
            return int(head.split(b" ", 2)[1])
        finally:
            writer.close()
            await writer.wait_closed()


async def exercise_shared_ip(port, token, url):
    """Same transport IP as Caddy, without trusting any proxy header.

    Intentionally exhaust admission once; established sockets must keep routing.
    This is not a bypass or a simulated/mocked limiter.
    """
    from websockets.asyncio.client import connect
    from websockets.exceptions import InvalidStatus

    # Avoid a window rollover inside the probe. If the machine is so slow that
    # the probe crosses a window anyway, fail explicitly rather than misreport.
    remaining = 60 - time.monotonic() % 60
    if remaining < 5:
        await asyncio.sleep(remaining + 0.05)
    window = int(time.monotonic() // 60)
    statuses = [await http_status(port, token) for _ in range(121)]
    require(window == int(time.monotonic() // 60), "rate_probe_window_changed")
    require(set(statuses) <= {200, 429} and 429 in statuses, "shared_ip_limit_missing")
    try:
        async with connect(url, origin=ORIGIN, proxy=None, logger=QUIET):
            raise AcceptanceError("saturated_ws_admitted")
    except InvalidStatus as error:
        require(error.response.status_code == 403, "unexpected_ws_denial")
    return {
        "scope": "single_actual_peer_ip_no_caddy_process",
        "requests": 121,
        "http_200": statuses.count(200),
        "http_429": statuses.count(429),
        "new_ws_http_403": True,
        "limit_per_ip_per_minute": 120,
    }


async def echo_host(ws, allowed_devices, metrics):
    connections = {}
    async for message in ws:
        if isinstance(message, str):
            control = json.loads(message)
            if control["type"] == "open":
                ident = uuid.UUID(control["connection_id"]).bytes
                require(control["device_id"] in allowed_devices, "cross_owner_open")
                require(
                    ident not in connections and not control["pending"],
                    "unexpected_open",
                )
                connections[ident] = control["device_id"]
                metrics.opens += 1
            elif control["type"] == "close":
                connections.pop(uuid.UUID(control["connection_id"]).bytes, None)
            else:
                raise AcceptanceError("host_control_invalid")
        else:
            require(
                16 <= len(message) <= 65552 and message[:16] in connections,
                "host_route_invalid",
            )
            await ws.send(message)
            metrics.host_frames += 1


async def exchange(ws, index, deadline, rate, size, metrics):
    interval = 1 / rate
    while time.monotonic() < deadline:
        payload = os.urandom(size)
        started = time.perf_counter()
        async with asyncio.timeout(5):
            await ws.send(payload)
            metrics.sent += 1
            received = await ws.recv()
        # Do not format either payload into exceptions, assertions or logs.
        require(isinstance(received, bytes) and received == payload, "payload_mismatch")
        metrics.record(time.perf_counter() - started, size, index)
        await asyncio.sleep(min(interval, max(0, deadline - time.monotonic())))


def validate(duration, clients, rate, size):
    require(
        math.isfinite(duration) and 0.05 <= duration <= 86400, "duration_out_of_range"
    )
    require(type(clients) is int and 1 <= clients <= 5, "clients_out_of_range")
    require(math.isfinite(rate) and 0 < rate <= 20, "rate_out_of_range")
    require(type(size) is int and 32 <= size <= 65536, "payload_out_of_range")
    # Leave 50% headroom for timer jitter and control traffic per multiplexed host.
    require(
        clients * rate <= 128 and clients * rate * (size + 16) <= 2 * 1024 * 1024,
        "host_rate_unsafe",
    )


async def soak(directory, duration=60, clients=5, rate=2, size=1024, progress=None):
    import uvicorn
    from websockets.asyncio.client import connect
    from runtime.python.relay.app import create_app

    validate(duration, clients, rate, size)
    owners = seed(Path(directory) / "soak.db", clients)
    metrics = Metrics()
    app = create_app(str(Path(directory) / "soak.db"), origins=[ORIGIN])
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))  # Reservation stays held; no free-port race.
    port = listener.getsockname()[1]
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        workers=1,
        access_log=False,
        log_level="critical",
        proxy_headers=False,
        server_header=False,
        ws="websockets",
        ws_max_size=65552,
        ws_max_queue=32,
        ws_per_message_deflate=False,
        limit_concurrency=160,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=5,
    )
    server = uvicorn.Server(config)
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    tasks = []
    outcome = {
        "status": "failed",
        "owners": 10,
        "hosts": 10,
        "clients": 10 * clients,
        "target_duration_seconds": duration,
        "payload_bytes": size,
        "per_client_max_roundtrips_per_second": rate,
        "crypto": "synthetic_opaque_transport_only",
    }
    started = None

    async def authenticate(stack, role, token):
        ws = await stack.enter_async_context(
            connect(
                f"ws://127.0.0.1:{port}/v1/socket",
                origin=ORIGIN if role == "client" else None,
                max_size=65552,
                max_queue=32,
                compression=None,
                proxy=None,
                open_timeout=5,
                close_timeout=2,
                logger=QUIET,
            )
        )
        async with asyncio.timeout(5):
            await ws.send(json.dumps({"role": role, "token": token}))
            require(json.loads(await ws.recv()) == {"type": "ready"}, "ws_not_ready")
        return ws

    try:
        async with asyncio.timeout(10):
            while not server.started:
                require(not serving.done(), "server_start_failed")
                await asyncio.sleep(0.01)
        async with AsyncExitStack() as stack:
            try:
                hosts = []
                for host, phones in owners:
                    ws = await authenticate(stack, "host", host["host_token"])
                    hosts.append(
                        asyncio.create_task(
                            echo_host(ws, {p["device_id"] for p in phones}, metrics)
                        )
                    )
                    tasks.append(hosts[-1])
                phones = []
                # Burst is only 60 admissions, below shared-IP 120/min.
                for _, devices in owners:
                    for phone in devices:
                        phones.append(
                            await authenticate(stack, "client", phone["device_token"])
                        )
                async with asyncio.timeout(5):
                    while metrics.opens < len(phones):
                        await asyncio.sleep(0.01)
                outcome["peak_connected_sockets"] = app.state.hub.connections
                require(
                    app.state.hub.connections == 10 + len(phones),
                    "concurrency_not_reached",
                )
                outcome["shared_ip_probe"] = await exercise_shared_ip(
                    port, owners[0][0]["host_token"], f"ws://127.0.0.1:{port}/v1/socket"
                )
                started = time.monotonic()
                workers = [
                    asyncio.create_task(
                        exchange(ws, i, started + duration, rate, size, metrics)
                    )
                    for i, ws in enumerate(phones)
                ]
                tasks.extend(workers)
                complete = asyncio.gather(*workers)
                try:
                    while not complete.done():
                        done, _ = await asyncio.wait(
                            [complete, *hosts, serving],
                            timeout=30,
                            return_when=asyncio.FIRST_COMPLETED,
                        )
                        if complete in done:
                            break
                        require(not done, "host_or_server_stopped")
                        if progress:
                            progress(
                                {
                                    "status": "running",
                                    "elapsed_seconds": round(
                                        time.monotonic() - started, 3
                                    ),
                                    **metrics.snapshot(),
                                }
                            )
                    await complete
                finally:
                    if not complete.done():
                        complete.cancel()
                    await asyncio.gather(complete, return_exceptions=True)
                require(
                    metrics.sent == metrics.received == metrics.host_frames,
                    "counter_mismatch",
                )
                require(len(metrics.per_client) == 10 * clients, "idle_client")
                outcome["status"] = "passed"
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    except asyncio.CancelledError:
        outcome["error"] = "cancelled"
        raise
    except Exception as error:
        outcome["error"] = (
            str(error) if isinstance(error, AcceptanceError) else type(error).__name__
        )
    finally:
        if started is not None:
            outcome["elapsed_seconds"] = round(time.monotonic() - started, 3)
        server.should_exit = True
        try:
            await asyncio.wait_for(asyncio.shield(serving), 10)
        except Exception:
            serving.cancel()
            await asyncio.gather(serving, return_exceptions=True)
            outcome["status"], outcome["error"] = "failed", "server_shutdown_failed"
        listener.close()
        outcome["remaining_connections"] = app.state.hub.connections
        outcome["remaining_sessions"] = len(app.state.hub.sessions)
        if outcome["remaining_connections"] or outcome["remaining_sessions"]:
            outcome["status"], outcome["error"] = "failed", "session_cleanup_failed"
        outcome.update(metrics.snapshot())
    return outcome


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--duration", type=float, default=60, help="seconds, maximum 86400 (24h)"
    )
    parser.add_argument("--clients-per-owner", type=int, default=5)
    parser.add_argument(
        "--rate", type=float, default=2, help="maximum roundtrips per client/second"
    )
    parser.add_argument("--payload-bytes", type=int, default=1024)
    parser.add_argument("--operations-only", action="store_true")
    args = parser.parse_args()
    report = {"status": "failed"}

    def emit(value):
        print(json.dumps(value, sort_keys=True), flush=True)

    try:
        validate(args.duration, args.clients_per_owner, args.rate, args.payload_bytes)
        with tempfile.TemporaryDirectory(prefix="relay-acceptance-") as directory:
            report["operations"] = verify_operations(directory)
            if not args.operations_only:
                report["soak"] = asyncio.run(
                    soak(
                        directory,
                        args.duration,
                        args.clients_per_owner,
                        args.rate,
                        args.payload_bytes,
                        progress=emit,
                    )
                )
            report["status"] = (
                "passed"
                if report.get("soak", {}).get("status", "passed") == "passed"
                else "failed"
            )
    except KeyboardInterrupt:
        report["error"] = "interrupted"
    except Exception as error:
        report["error"] = (
            str(error) if isinstance(error, AcceptanceError) else type(error).__name__
        )
    emit(report)
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
