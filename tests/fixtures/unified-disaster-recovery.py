"""Fictional offline disaster probe; run with python -B, optionally --evidence-dir DIR.

Reuses test_cloud.py's retained-version scenario and test_cloud_cost_review.py's
mocked review/replay scenario. No server, provider, model, dotenv or real config.
Container: mount this repository read-only, use its Runtime dependencies and /tmp.
"""
import argparse
import asyncio
from contextlib import ExitStack, closing
from dataclasses import replace
import hashlib
import gc
import importlib.util
import json
import math
import os
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import time
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from urllib.parse import unquote

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "runtime"))


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def tables(path):
    """Order-independent row hashes, including empty tables and schema, read-only."""
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        result = {}
        for name, ddl in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name"):
            quoted = '"' + name.replace('"', '""') + '"'
            rows = sorted(json.dumps(row, ensure_ascii=False, default=lambda b: {"hex": b.hex()})
                          for row in db.execute("SELECT * FROM " + quoted))
            result[name] = {"rows": len(rows), "sha256": hashlib.sha256(
                json.dumps([ddl, rows], ensure_ascii=False).encode()).hexdigest()}
        schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").fetchall()
        return {"schema_sha256": hashlib.sha256(json.dumps(schema).encode()).hexdigest(), "tables": result}


def snapshot(store):
    # Existing recover() SQLite context managers commit but defer closing until GC.
    gc.collect()
    result = {"files": {}, "databases": {}, "directories": []}
    for label, root in (("root", store.config.root), ("backups", store.config.backup_root)):
        if root is None or not root.exists():
            continue
        result["directories"].append(label)
        for path in sorted(root.rglob("*")):
            assert not path.is_symlink()
            key = label + "/" + path.relative_to(root).as_posix()
            if path.is_dir():
                result["directories"].append(key)
            elif path.is_file():
                result["files"][key] = sha(path)
                if path.suffix == ".db":
                    result["databases"][key] = tables(path)
    return result


async def probe(temp, report):
    import httpx

    blocked = []

    def forbidden(*args, **kwargs):
        blocked.append("blocked")
        raise AssertionError("Network/config access forbidden")

    with ExitStack() as guards:
        for name in ("connect", "connect_ex"):
            guards.enter_context(patch.object(socket.socket, name, forbidden))
        guards.enter_context(patch.object(socket, "create_connection", forbidden))
        guards.enter_context(patch.object(socket, "getaddrinfo", forbidden))
        guards.enter_context(patch.object(socket.socket, "sendto", forbidden))
        guards.enter_context(patch.object(httpx.HTTPTransport, "handle_request", forbidden))
        guards.enter_context(patch.object(httpx.AsyncHTTPTransport, "handle_async_request", forbidden))
        # model_choices imports provider constants, whose classes import real Settings.
        fake_config = ModuleType("python.core.config")
        fake_config.settings = SimpleNamespace()
        guards.enter_context(patch.dict(sys.modules, {"python.core.config": fake_config}))
        from cryptography.fernet import InvalidToken
        from python.cloud.config import CloudConfig
        from python.cloud.store import CloudStore
        from python.cloud.backups import Backups
        from python.storage.context import CloudStorageContext, storage_context
        from python.storage import db as storage, generations, memories, conversation
        from python.storage.native_sync import NativeSync
        from python.storage.runtime_lock import RuntimeLock
        from python.core.schemas import RuntimeState
        from python.providers.openai_compat import OpenAICompatibleProvider
        guards.enter_context(patch.object(OpenAICompatibleProvider, "__init__", forbidden))
        guards.enter_context(patch.object(CloudConfig, "from_env", forbidden))
        spec = importlib.util.spec_from_file_location("fictional_disaster_admin", REPO / "scripts/cloud_admin.py")
        admin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(admin)
        config = CloudConfig(root=temp / "source", backup_root=temp / "retained",
                             origin="https://fictional.invalid", secret="FICTIONAL-ONLY-" + "x" * 40,
                             monthly_subsidy_jpy=0, trial_credits=0, signup_limit=2)
        source = CloudStore(config)
        source.add_funds(50_000_000, "fictional-funding")
        owners = [str(uuid4()), str(uuid4())]
        for owner in owners:
            source.account(owner, consent="fictional-consent")
            source.admin_grant(owner, 500, "fictional-grant-" + owner)
            with patch("time.time", return_value=time.time() - 2 * 86400):
                source.grant(owner, 17, time.time() + 86400, "fixture-expired", "expired-" + owner)
        with source.transaction() as db:
            # Same entitlement fixture as test_cloud.py; no public plan-setting API.
            db.execute("UPDATE accounts SET plan='plus',plan_until=?", (time.time() + 86400 * 30,))

        def reserve(store, owner, cost, credits=60):
            operation = str(uuid4())
            quote = store.quote(owner, operation, credits, cost, "cloud-standard")
            store.reserve(owner, operation, operation, quote, credits)
            return operation

        completed = reserve(source, owners[0], 1_000_000)
        source.settle(owners[0], completed, 100_000, success=True)
        review = reserve(source, owners[0], 1_000_000)
        pending = reserve(source, owners[1], 2_000_000)
        # Positive debt and unresolved review are created through settlement, after admission.
        source.settle(owners[0], review, 1_100_000, success=False, review_required=True)
        source.receipt(owners[0], "fictional-receipt", "credits_5", 5_000_000_000,
                       time.time() + 86400 * 180, event_id="fictional-webhook", event_hash="fixture-hash")
        source.revoke_receipt("fictional-receipt")

        versions = {}
        for owner in owners:
            context = CloudStorageContext.for_owner(config.root / "tenants", owner)
            with storage_context(context):
                await storage.init_db()
                for sid in ("fictional-live", "fictional-erased"):
                    operation = str(uuid4())
                    await generations.reserve(operation, sid, {"fictional": sid})
                    state = RuntimeState(session_id=sid).model_dump(mode="json")
                    await generations.finish(operation, {"status": "completed", "reply": "fictional reply",
                                                        "state": state}, {"content": "fictional message"}, "fictional-model")
                    await memories.create("session:" + sid, "semantic", "fictional memory",
                                          source_session_id=sid)
                removed = await memories.create("session:fictional-live", "episodic", "fictional soft deletion")
                await memories.delete(removed["id"])
                sync = NativeSync(context.directory / "data.db", config.origin, owner, "fictional-token-" + "x" * 30)
                sync.configure(["fictional-live", "fictional-erased"], True, consent=True)
                staged = sync.stage()
                assert staged and len(staged["changes"]) == 2
                sync.acknowledge(staged, {"changes": [{"id": c["id"], "revision": 1} for c in staged["changes"]]})
                sync.receive({"cursor": 3, "changes": [{"id": "fictional-remote-erased", "kind": "conversation",
                                                      "revision": 3, "deleted": True}]})
                await conversation.purge("fictional-erased")
                Backups(source).record_erasure(owner, "fictional-erased")
                staged = sync.stage()
                assert staged and any(c.get("deleted") for c in staged["changes"])
                with sync.transaction() as db:
                    assert sync.meta(db, "outbox")["request_id"] == staged["request_id"]
                    assert db.execute("SELECT COUNT(*) FROM runtime.native_sync_outbox_sources").fetchone()[0] > 0
                    assert db.execute("SELECT COUNT(*) FROM runtime.native_sync_received WHERE deleted=1").fetchone()[0] == 1
                    assert db.execute("SELECT COUNT(*) FROM runtime.session_deletions").fetchone()[0] == 1
                    assert db.execute("SELECT COUNT(*) FROM runtime.chat_history WHERE session_id='fictional-erased'").fetchone()[0] == 0
                    assert db.execute("SELECT COUNT(*) FROM runtime.memories WHERE status='active'").fetchone()[0] > 0
                    assert db.execute("SELECT COUNT(*) FROM runtime.memories WHERE status='deleted'").fetchone()[0] == 1
            assets = context.directory / "library_assets"
            assets.mkdir()
            (assets / "fictional.bin").write_bytes(b"FICTIONAL-MEDIA-ONLY\x00\x01")
            versions[owner] = Backups(source).create(owner, context.directory / "data.db")
            assert versions[owner]

        with source.transaction() as db:
            assert db.execute("SELECT COUNT(*) FROM operations WHERE state='completed'").fetchone()[0] == 1
            assert db.execute("SELECT COUNT(*) FROM operations WHERE review_required=1").fetchone()[0] == 1
            assert db.execute("SELECT SUM(amount) FROM budget_debt").fetchone()[0] > 0
            assert db.execute("SELECT SUM(amount) FROM fund_holds").fetchone()[0] == 2_000_000
            assert db.execute("SELECT COUNT(*) FROM credit_holds").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM receipts WHERE revoked=1").fetchone()[0] == 1
            assert db.execute("SELECT COUNT(*) FROM receipt_revocations").fetchone()[0] == 1
            assert db.execute("SELECT COUNT(*) FROM credit_lots WHERE expires>0 AND expires<?", (time.time(),)).fetchone()[0] == 2
        with closing(sqlite3.connect(config.root / "community.db")) as db:
            db.execute('CREATE TABLE legacy_works(payload TEXT)')
            db.execute('INSERT INTO legacy_works VALUES (?)', ('fictional published work',))
            db.commit()
        from python.cloud.transfers import Transfers
        pending_transfers = []
        for entity in (False, True):
            pages = Transfers(source, None, entity=entity)
            transfer = pages.create(owners[0], direction='upload', selected=['fictional-live'],
                                    revision=1, request_id='fictional-pending-'+str(entity))
            pending_transfers.append((entity, transfer, pages.inspect(owners[0], transfer)))
        with RuntimeLock(config.root):
            pass
        before = snapshot(source)
        report["source"] = before
        archive = temp / "disaster.kybackup"
        archive_sha = admin.disaster_backup(source, archive)
        assert archive_sha == sha(archive) and b"fictional memory" not in archive.read_bytes()
        assert snapshot(source) == before
        report["archive_sha256"] = archive_sha
        report["checks"].append("backup-source-tables-and-file-sha-unchanged")

        def target(name, **changes):
            result = CloudStore(replace(config, root=temp / name, backup_root=temp / (name + "-backups"), **changes))
            with RuntimeLock(result.config.root):
                pass
            return result

        restored = target("restored")
        report["empty_destination"] = snapshot(restored)
        admin.disaster_restore(restored, archive)
        after = snapshot(restored)
        report["restored"] = after
        assert snapshot(source) == before and sha(archive) == archive_sha
        assert before["databases"]["root/control.db"]["schema_sha256"] == after["databases"]["root/control.db"]["schema_sha256"]
        changed = {name for name, value in before["databases"]["root/control.db"]["tables"].items()
                   if after["databases"]["root/control.db"]["tables"][name] != value}
        assert changed == {"operations", "fund_holds"}, changed
        for key, value in before["files"].items():
            if key not in {"root/control.db", "root/community.db"}:
                assert after["files"][key] == value, key
        assert before["directories"] == after["directories"]
        assert set(before["files"]) == set(after["files"])
        for key, value in before["databases"].items():
            if key != "root/control.db":
                assert after["databases"][key] == value, key
        with closing(sqlite3.connect(source.path)) as original, closing(sqlite3.connect(restored.path)) as db:
            original.row_factory = db.row_factory = sqlite3.Row
            old = {r["id"]: dict(r) for r in original.execute("SELECT * FROM operations")}
            new = {r["id"]: dict(r) for r in db.execute("SELECT * FROM operations")}
            assert new == {**old, pending: {**old[pending], "state": "failed", "actual_cost": 2_000_000,
                                          "charged_credits": 0, "review_required": 1}}
            assert db.execute("SELECT COUNT(*) FROM fund_holds").fetchone()[0] == 0
        report["recover_changes"] = {"operation": pending, "state": ["pending", "failed"],
                                     "actual_cost": [0, 2_000_000], "review_required": [0, 1],
                                     "fund_holds": "pending operation released; full bound remains spent",
                                     "unchanged": "all other tables, settled operations, wallet lots/expiry, debt, tenant DBs and files"}
        assert [restored.balance(o) for o in owners] == [source.balance(o) for o in owners]
        for owner in owners:
            assert versions[owner] in {v["id"] for v in Backups(restored).list(owner)}
        for entity, transfer, metadata in pending_transfers:
            assert Transfers(restored, None, entity=entity).inspect(owners[0], transfer) == metadata
        stable = snapshot(restored)
        restored.recover()
        assert snapshot(restored) == stable
        CloudStore(restored.config)
        assert snapshot(restored) == stable
        report["checks"].extend(["independent-empty-root-restore", "exact-recover-transient-delta",
                                 "wallet-expiry-debt-review-preserved", "outbox-received-deletions-preserved",
                                 "retained-versions-and-media-sha-preserved", "recover-and-reopen-idempotent",
                                 "community-and-unfinished-transfer-databases-preserved"])

        def reject(name, store, file, errors, message=None):
            previous, file_sha = snapshot(store), sha(file)
            try:
                admin.disaster_restore(store, file)
            except errors as error:
                if message:
                    assert message in str(error), (name, str(error))
            else:
                raise AssertionError("Restore unexpectedly accepted: " + name)
            assert snapshot(store) == previous, name
            assert snapshot(source) == before and sha(file) == file_sha and sha(archive) == archive_sha
            report["checks"].append(name)

        reject("reject-existing-tenant-destination", restored, archive, ValueError, "empty")
        occupied = target("occupied-control")
        occupied.account(str(uuid4()), consent="fictional-existing")
        reject("reject-existing-control-destination", occupied, archive, ValueError, "empty")
        occupied = target("occupied-funds-without-account")
        occupied.add_funds(1_000_000, "fictional-control-funds")
        reject("reject-funded-control-without-accounts", occupied, archive, ValueError, "empty")
        occupied = target("occupied-quoted-extension")
        with occupied.transaction() as db:
            db.execute('CREATE TABLE "sqliteX""budget" (value TEXT)')
            db.execute('INSERT INTO "sqliteX""budget" VALUES (?)', ('fictional-extension',))
        reject("reject-quoted-extension-without-accounts", occupied, archive, ValueError, "empty")
        occupied = target("occupied-backups")
        occupied.config.backup_root.mkdir()
        (occupied.config.backup_root / "sentinel").write_bytes(b"fictional existing backup")
        reject("reject-existing-backup-destination", occupied, archive, ValueError, "empty")
        reject("reject-wrong-secret", target("wrong-key", secret="FICTIONAL-WRONG-" + "z" * 40), archive, InvalidToken)
        io_target = target("prepublication-io")
        with patch.object(admin.tarfile, "open", side_effect=OSError("fictional prepublication I/O failure")):
            reject("reject-prepublication-io-failure", io_target, archive, OSError, "fictional prepublication")
            failed_backup = temp / "failed-backup.kybackup"
            try:
                admin.disaster_backup(source, failed_backup)
            except OSError as error:
                assert "fictional prepublication" in str(error)
            else:
                raise AssertionError("Injected backup failure was ignored")
        assert not failed_backup.exists() and snapshot(source) == before and sha(archive) == archive_sha
        report["checks"].append("backup-prepublication-failure-source-unchanged")
        raw = archive.read_bytes()
        for name, damaged in (("bad-magic", b"!" + raw[1:]), ("truncated", raw[:-7]),
                              ("tampered-ciphertext", raw[:100] + bytes([raw[100] ^ 1]) + raw[101:]),
                              ("trailing-data", raw + b"fictional-trailing")):
            corrupt = temp / (name + ".kybackup")
            corrupt.write_bytes(damaged)
            reject("reject-" + name, target(name), corrupt, (ValueError, InvalidToken))
        locked = target("locked")
        locked_before = snapshot(locked)
        with RuntimeLock(locked.config.root):
            try:
                admin.disaster_restore(locked, archive)
            except ValueError as error:
                assert "runtime_already_running" in str(error)
            else:
                raise AssertionError("Locked runtime accepted restore")
        assert snapshot(locked) == locked_before and snapshot(source) == before and sha(archive) == archive_sha
        report["checks"].append("reject-locked-runtime")
        existing_sha = sha(archive)
        try:
            admin.disaster_backup(source, archive)
        except ValueError as error:
            assert "already exists" in str(error)
        else:
            raise AssertionError("Existing backup overwritten")
        assert sha(archive) == existing_sha and snapshot(source) == before
        report["checks"].append("reject-backup-overwrite")

        # Independently reuse the private-test mocked audit scenario, without pytest.
        reviewed = CloudStore(replace(config, root=temp / "review-source", backup_root=temp / "review-backups",
                                     private_test=True, signup_limit=1, allowed_emails=("fixture@example.invalid",),
                                     test_budget_nano=100_000_000, test_prior_cost_nano=49_548_721,
                                     openrouter_key="FICTIONAL-MOCK-KEY"))
        owner = str(uuid4())
        reviewed.account(owner, consent="fictional")
        reviewed.admin_grant(owner, 500, "fictional-review-grant")
        operation = str(uuid4())
        quote = reviewed.quote(owner, "failed-request", 400, 5_430_562, "cloud-deepseek-baidu")
        reviewed.reserve(owner, operation, "failed-request", quote, 400)
        with storage_context(CloudStorageContext.for_owner(reviewed.config.root / "tenants", owner)):
            await storage.init_db()
            await generations.reserve(operation, "fictional-review", {"fictional": True})
            await generations.finish(operation, {"status": "failed", "error": "provider_usage_unavailable",
                "cloud_accounting": {"cost": 1_178_569, "review_required": True}}, None, "fictional-model")
        reviewed.settle(owner, operation, 1_178_569, success=False, review_required=True)
        with reviewed.transaction() as db:
            created = db.execute("SELECT created FROM operations WHERE id=?", (operation,)).fetchone()[0]
        evidence = {"operation": operation, "generation_id_transcribed": f"gen-{math.ceil(created)}-ABC123",
                    "http_status": 429, "attempts": 1, "screenshot_sha256": "a" * 64,
                    "expected_cost_nano": 1_178_569, "expected_max_cost_nano": 5_430_562,
                    "expected_fingerprint": "failed-request"}
        mock_calls = []

        def billing(request):
            assert request.method == "GET" and str(request.url) == "https://openrouter.ai/api/v1/key"
            assert request.headers["authorization"] == "Bearer FICTIONAL-MOCK-KEY"
            mock_calls.append("synthetic-billing")
            return httpx.Response(200, text='{"data":{"usage":0.050727290}}')

        transport = httpx.MockTransport(billing)
        assert admin.retain_failed_reservation(reviewed, operation, evidence, transport=transport)["replayed"] is False
        assert mock_calls == ["synthetic-billing"]
        with RuntimeLock(reviewed.config.root):
            pass
        review_before = snapshot(reviewed)
        review_archive = temp / "review.kybackup"
        admin.disaster_backup(reviewed, review_archive)
        review_target = CloudStore(replace(reviewed.config, root=temp / "review-target",
                                          backup_root=temp / "review-target-backups"))
        with RuntimeLock(review_target.config.root):
            pass
        admin.disaster_restore(review_target, review_archive)
        assert snapshot(reviewed) == review_before
        review_after = snapshot(review_target)
        assert review_after["databases"] == review_before["databases"]
        assert review_after["directories"] == review_before["directories"]
        assert set(review_after["files"]) == set(review_before["files"])
        assert all(review_after["files"][k] == v for k, v in review_before["files"].items() if k != "root/control.db")
        mock_calls.clear()
        assert admin.retain_failed_reservation(review_target, operation, evidence, transport=transport) == {
            "reviewed": True, "replayed": True, "retained_cost_nano": 5_430_562}
        assert mock_calls == [] and snapshot(review_target) == review_after
        report["review_source"] = review_before
        report["review_restored"] = snapshot(review_target)
        report["checks"].append("provider-review-audit-and-no-request-replay-preserved")
        assert not blocked
        report.update(network_attempts=0, mock_billing_requests=1, production_data_used=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path)
    args = parser.parse_args()
    if args.evidence_dir:
        args.evidence_dir = args.evidence_dir.resolve()
        args.evidence_dir.mkdir(parents=True, exist_ok=True)
    report = {"ok": False, "checks": [], "fixture_sha256": sha(Path(__file__)), "limits": [
        "Local fictional probe, not production backup acceptance or a container run.",
        "No live provider, model, SMTP, billing verification or offsite transfer.",
        "Credit holds have no current reservation API writer; empty table preservation only. Positive credit debt not seeded.",
        "Pending recovery covers absent tenant accounting (full-bound failed/review); other recovery branches not covered.",
        "Pre-publication rejection preserves destinations. Publication failures have no rollback guarantee in the existing API.",
        "Retained versions/media are byte-checked and listed; individual retained-version restore is not exercised.",
        "No concurrent-writer/power-loss, large-data capacity, OS permissions or production-secret recovery claim."]}
    try:
        with tempfile.TemporaryDirectory(prefix="kyalulu-fictional-disaster-", dir=args.evidence_dir) as temporary:
            temporary = str(Path(temporary).resolve())

            def audit(event, values):
                if event == "open" and isinstance(values[0], (str, bytes, os.PathLike)):
                    name = Path(os.fsdecode(values[0])).name.lower()
                    assert not (name == ".env" or name.startswith(".env.")), "dotenv read forbidden"
                if event == "import":
                    assert values[0] != "python.core.config", "real config import forbidden"
                if event == "sqlite3.connect" and str(values[0]) != ":memory:":
                    value = str(values[0])
                    if value.startswith("file:"):
                        value = unquote(value[5:].split("?", 1)[0])
                        if os.name == "nt":
                            value = value.lstrip("/")
                    assert Path(value).resolve().is_relative_to(temporary), "database outside disposable root"

            sys.addaudithook(audit)
            # Replace the environment object before importing Runtime; never load real app settings.
            with patch.object(os, "environ", {"KYALULU_DATA_DIR": temporary, "TMPDIR": temporary,
                                               "TEMP": temporary, "TMP": temporary}):
                asyncio.run(probe(Path(temporary), report))
        report["ok"] = True
    except Exception as error:
        report["error"] = type(error).__name__ + ": " + str(error)
        raise
    finally:
        if args.evidence_dir:
            args.evidence_dir.mkdir(parents=True, exist_ok=True)
            (args.evidence_dir / "evidence.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({key: report[key] for key in ("ok", "checks", "limits", "network_attempts",
                         "mock_billing_requests", "production_data_used", "error") if key in report}))


if __name__ == "__main__":
    if not __debug__:
        raise SystemExit("Run without -O; assertions are the probe's acceptance checks")
    main()
