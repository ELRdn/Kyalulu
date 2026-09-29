"""Real local TCP soak, bounded reporting and CLI recovery tests."""

import asyncio
import json
import sqlite3
import subprocess
import sys
from contextlib import closing

import pytest

from scripts.remote_acceptance import (
    ROOT,
    AcceptanceError,
    Metrics,
    cli,
    metadata,
    soak,
    validate,
    verify_operations,
)


def test_live_ten_owners_fifty_clients_after_shared_ip_throttling(
    tmp_path, caplog, capsys
):
    result = asyncio.run(soak(tmp_path, duration=0.6, rate=2))
    assert result["status"] == "passed", result.get("error")
    assert result["owners"] == 10 and result["peak_connected_sockets"] == 60
    assert result["opened_clients"] == result["clients_with_roundtrips"] == 50
    assert result["roundtrips"] >= 50
    assert result["sent"] == result["roundtrips"] == result["host_echo_frames"]
    assert result["shared_ip_probe"]["http_429"] >= 1
    assert result["shared_ip_probe"]["new_ws_http_403"]
    assert result["remaining_connections"] == result["remaining_sessions"] == 0
    assert result["latency_ms"]["p99_upper"] >= result["latency_ms"]["p50_upper"]
    output = caplog.text + str(capsys.readouterr())
    assert (
        "Bearer " not in output
        and "device_token" not in output
        and "host_token" not in output
    )


def test_real_cli_wal_backup_restore_and_persistent_security(tmp_path):
    report = verify_operations(tmp_path)
    assert report["status"] == "passed"
    for flag in (
        "wal_included",
        "revocation_preserved",
        "quota_preserved",
        "ticket_single_use_preserved",
        "overwrite_refused",
        "restore_requires_offline",
    ):
        assert report[flag]
    assert (report["owners"], report["devices"], report["tickets"]) == (1, 4, 1)


def test_corrupt_backup_and_wrong_schema_refused_without_destination(tmp_path):
    corrupt, wrong, target = (
        tmp_path / name for name in ("corrupt.db", "wrong.db", "target.db")
    )
    corrupt.write_bytes(b"not a sqlite database")
    with closing(sqlite3.connect(wrong)) as db:
        db.execute("CREATE TABLE unrelated (id INTEGER)")
    for source in (corrupt, wrong):
        result = cli(target, "restore", source, "--offline")
        assert result.returncode != 0
        assert not target.exists()
        assert "Traceback" not in result.stderr


def test_backup_missing_source_does_not_create_database(tmp_path):
    source, dest = tmp_path / "missing.db", tmp_path / "backup.db"
    assert cli(source, "backup", dest).returncode != 0
    assert not source.exists() and not dest.exists()


def test_backup_overwrite_preserves_existing_bytes(tmp_path):
    db, sentinel = tmp_path / "source.db", tmp_path / "precious.db"
    assert cli(db, "invite").returncode == 0
    sentinel.write_bytes(b"original-dummy-backup")
    assert cli(db, "backup", sentinel).returncode != 0
    assert sentinel.read_bytes() == b"original-dummy-backup"


def test_report_histogram_is_bounded_and_percentiles_cover_samples():
    metrics = Metrics()
    for i in range(50000):
        metrics.record((i % 100) / 1000, 1024, i % 50)
    report = metrics.snapshot()
    assert len(metrics.histogram) == 10002 and len(metrics.per_client) == 50
    assert report["roundtrips"] == 50000
    assert report["latency_ms"]["p99_upper"] >= 98
    assert report["min_roundtrips_per_client"] == 1000
    assert "Infinity" not in json.dumps(Metrics().snapshot(), allow_nan=False)


@pytest.mark.parametrize(
    "args",
    [
        (0, 5, 2, 1024),
        (float("nan"), 5, 2, 1024),
        (86401, 5, 2, 1024),
        (60, 6, 2, 1024),
        (60, 5, 100, 1024),
        (60, 5, 20, 65536),
        (60, 5, 2, 65537),
    ],
)
def test_unsafe_load_settings_rejected(args):
    with pytest.raises(AcceptanceError):
        validate(*args)


def test_day_duration_valid_without_starting_it():
    validate(86400, 5, 2, 1024)


def test_runner_cli_operations_only_and_invalid_duration():
    command = [sys.executable, str(ROOT / "scripts" / "remote_acceptance.py")]
    bad = subprocess.run(
        [*command, "--duration", "0"], capture_output=True, text=True, timeout=10
    )
    assert bad.returncode == 1
    assert json.loads(bad.stdout)["error"] == "duration_out_of_range"
    operations = subprocess.run(
        [*command, "--operations-only"], capture_output=True, text=True, timeout=30
    )
    assert operations.returncode == 0
    report = json.loads(operations.stdout)
    assert report["status"] == "passed" and "soak" not in report
    assert "token" not in operations.stdout and "Bearer" not in operations.stdout


def test_failed_payload_check_still_stops_server(tmp_path, monkeypatch):
    async def fail(*args):
        raise AcceptanceError("payload_mismatch")

    monkeypatch.setattr("scripts.remote_acceptance.exchange", fail)
    result = asyncio.run(soak(tmp_path, duration=0.05, clients=1))
    assert result["status"] == "failed" and result["error"] == "payload_mismatch"
    assert result["remaining_connections"] == result["remaining_sessions"] == 0
    # The server released its DB; its file can still be checked after teardown.
    assert len(metadata(tmp_path / "soak.db")["owners"]) == 10


def test_cancelled_soak_closes_listener_and_sessions(tmp_path, monkeypatch):
    import uvicorn

    original = uvicorn.Server
    servers = []

    def track(config):
        instance = original(config)
        servers.append(instance)
        return instance

    monkeypatch.setattr(uvicorn, "Server", track)

    async def exercise():
        running = asyncio.create_task(soak(tmp_path, duration=60, clients=1))
        async with asyncio.timeout(10):
            while not servers or servers[0].config.app.state.hub.connections < 20:
                await asyncio.sleep(0.01)
        running.cancel()
        with pytest.raises(asyncio.CancelledError):
            await running
        assert servers[0].config.app.state.hub.connections == 0
        assert all(not listener.is_serving() for listener in servers[0].servers)

    asyncio.run(exercise())
