"""Offline operations. No management API is exposed to cloud users."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import sys
import tarfile
import tempfile
from contextlib import closing
from decimal import Decimal, ROUND_CEILING
import re
import time
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from python.cloud.config import CloudConfig
from python.cloud.store import CloudStore
from python.cloud.backups import MAGIC, CHUNK
from python.storage.runtime_lock import RuntimeLock


def retain_failed_reservation(store, operation, evidence, *, transport=None):
    """Offline private-test recovery: retain the full estimate, never declare a missing bill zero."""
    import httpx
    from python.cloud.store import fingerprint
    from python.cloud.contracts import ROUTES

    UUID(operation)
    native_429 = isinstance(evidence, dict) and evidence.get("http_status") == 429 and "failure_record_sha256" in evidence
    hash_field = ("failure_record_sha256"
                  if native_429 or isinstance(evidence, dict) and evidence.get("http_status") == 404
                  else "screenshot_sha256")
    if (not isinstance(evidence, dict) or not store.config.private_test or store.config.operator_backend != "openrouter"
            or evidence.get("operation") != operation or type(evidence.get("http_status")) is not int or evidence["http_status"] not in {404, 429}
            or type(evidence.get("attempts")) is not int or evidence["attempts"] != 1
            or type(evidence.get("expected_cost_nano")) is not int or type(evidence.get("expected_max_cost_nano")) is not int
            or not isinstance(evidence.get("expected_fingerprint"), str) or not 1 <= len(evidence["expected_fingerprint"]) <= 128
            or not isinstance(evidence.get(hash_field), str)
            or not re.fullmatch(r"[0-9a-f]{64}", evidence.get(hash_field, ""))):
        raise ValueError("private_failed_request_evidence_required")
    request_id = "" if native_429 else evidence.get("generation_id_transcribed", "")
    match = re.fullmatch(r"gen-(\d+)-[A-Za-z0-9]+", request_id) if isinstance(request_id, str) else None
    if evidence["http_status"] == 429 and not native_429 and not match:
        raise ValueError("provider_request_id_required")
    evidence_hash = fingerprint(evidence)
    with RuntimeLock(store.config.root):
        with store.transaction() as db:
            op = db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchall()
            if len(op) != 1 or (match and not 0 <= int(match[1]) - op[0]["created"] <= 5):
                raise ValueError("provider_request_operation_mismatch")
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='provider_cost_reviews'").fetchone():
                previous = db.execute("SELECT * FROM provider_cost_reviews WHERE operation=?", (operation,)).fetchone()
                if previous:
                    op = db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchall()
                    if (len(op) != 1 or previous["evidence_hash"] != evidence_hash
                            or op[0]["actual_cost"] != previous["retained_cost"] or op[0]["review_required"]
                            or op[0]["state"] != "failed" or op[0]["charged_credits"] != 0
                            or op[0]["fingerprint"] != previous["operation_fingerprint"]
                            or op[0]["max_cost"] != previous["retained_cost"]):
                        raise ValueError("provider_review_conflict")
                    if native_429:
                        tenant = store.config.root / "tenants" / str(UUID(op[0]["owner"])) / "data.db"
                        if not tenant.is_file():
                            raise ValueError("failed_generation_evidence_missing")
                        with closing(sqlite3.connect("file:" + tenant.as_posix() + "?mode=ro", uri=True)) as con:
                            record = con.execute("SELECT status,result_json FROM generations WHERE generation_id=?", (operation,)).fetchone()
                        if not record or record[0] != "failed" or fingerprint(json.loads(record[1] or "{}")) != evidence["failure_record_sha256"]:
                            raise ValueError("provider_review_conflict")
                    return {"reviewed": True, "replayed": True, "retained_cost_nano": previous["retained_cost"]}
            if (op[0]["actual_cost"] != evidence["expected_cost_nano"]
                    or op[0]["max_cost"] != evidence["expected_max_cost_nano"]
                    or op[0]["fingerprint"] != evidence["expected_fingerprint"]):
                raise ValueError("failed_reservation_not_reviewable")
        with httpx.Client(timeout=20, follow_redirects=False, transport=transport) as client:
            response = client.get("https://openrouter.ai/api/v1/key",
                headers={"Authorization": "Bearer " + store.config.openrouter_key})
            if response.status_code != 200:
                raise ValueError("provider_billing_snapshot_unavailable")
            body = json.loads(response.text, parse_float=Decimal)
            data = body.get("data") if isinstance(body, dict) else None
            if not isinstance(data, dict):
                raise ValueError("provider_billing_snapshot_invalid")
        usage = data.get("usage")
        if (not isinstance(usage, (int, Decimal)) or isinstance(usage, bool)
                or not Decimal(usage).is_finite() or usage < 0):
            raise ValueError("provider_billing_snapshot_invalid")
        total = int((Decimal(usage) * 1_000_000_000).to_integral_value(rounding=ROUND_CEILING))
        with store.transaction() as db:
            op = db.execute("SELECT * FROM operations WHERE id=?", (operation,)).fetchall()
            if len(op) != 1 or (match and not 0 <= int(match[1]) - op[0]["created"] <= 5):
                raise ValueError("provider_request_operation_mismatch")
            op = op[0]
            db.execute("CREATE TABLE IF NOT EXISTS provider_cost_reviews(operation TEXT PRIMARY KEY, "
                       "evidence_hash TEXT NOT NULL, old_cost INTEGER NOT NULL, retained_cost INTEGER NOT NULL, "
                       "provider_total INTEGER NOT NULL, created REAL NOT NULL, operation_fingerprint TEXT NOT NULL, "
                       "key_fingerprint TEXT NOT NULL, basis TEXT NOT NULL)")
            if (op["state"] != "failed" or op["charged_credits"] != 0 or op["review_required"] != 1
                    or op["route"] not in ROUTES or ROUTES[op["route"]].payer != "operator"
                    or (evidence["http_status"] == 429 and not native_429 and op["route"] != "cloud-deepseek-baidu")
                    or not 0 <= op["actual_cost"] <= op["max_cost"]
                    or op["max_cost"] <= 0 or op["actual_cost"] != evidence.get("expected_cost_nano")
                    or op["max_cost"] != evidence.get("expected_max_cost_nano")
                    or op["fingerprint"] != evidence.get("expected_fingerprint")):
                raise ValueError("failed_reservation_not_reviewable")
            if (db.execute("SELECT 1 FROM operations WHERE state='pending' LIMIT 1").fetchone()
                    or db.execute("SELECT 1 FROM fund_holds LIMIT 1").fetchone()
                    or db.execute("SELECT 1 FROM credit_holds LIMIT 1").fetchone()
                    or db.execute("SELECT 1 FROM budget_debt WHERE amount>0 LIMIT 1").fetchone()):
                raise ValueError("unsettled_liability_blocks_review")
            tenant = store.config.root / "tenants" / str(UUID(op["owner"])) / "data.db"
            if not tenant.is_file():
                raise ValueError("failed_generation_evidence_missing")
            with closing(sqlite3.connect("file:" + tenant.as_posix() + "?mode=ro", uri=True)) as con:
                record = con.execute("SELECT status,result_json FROM generations WHERE generation_id=?", (operation,)).fetchone()
            result = json.loads(record[1] or "{}") if record else {}
            accounting = result.get("cloud_accounting", {}) if isinstance(result, dict) else {}
            errors = {"provider_usage_unavailable", "provider_rate_limited"} if evidence["http_status"] == 429 else {"safety_route_unavailable"}
            if (not record or record[0] != "failed" or not isinstance(result, dict) or not isinstance(accounting, dict)
                    or result.get("error") not in errors or type(accounting.get("cost")) is not int
                    or accounting.get("cost") != op["actual_cost"] or accounting.get("review_required") is not True
                    or accounting.get("review_reason") not in {None, "missing_cost", "missing_usage"}
                    or (evidence["http_status"] == 429 and accounting.get("review_reason") and accounting.get("provider_error") != "provider_rate_limited")
                    or (hash_field == "failure_record_sha256" and fingerprint(result) != evidence["failure_record_sha256"])
                    or (native_429 and (result.get("error") != "provider_rate_limited"
                        or accounting.get("provider_error") != "provider_rate_limited"
                        or accounting.get("review_reason") not in {"missing_cost", "missing_usage"}))):
                raise ValueError("failed_generation_not_a_missing_429_bill")
            prior = db.execute("SELECT prior_cost FROM private_budgets WHERE id='initial'").fetchone()
            if not prior:
                raise ValueError("private_budget_baseline_missing")
            spent = db.execute("SELECT COALESCE(SUM(actual_cost),0) FROM operations").fetchone()[0]
            accounted = prior[0] + spent + op["max_cost"] - op["actual_cost"]
            if total > accounted or accounted >= store.config.test_budget_nano:
                raise ValueError("provider_billing_exceeds_retained_budget")
            db.execute("INSERT INTO provider_cost_reviews VALUES(?,?,?,?,?,?,?,?,?)",
                (operation, evidence_hash, op["actual_cost"], op["max_cost"], total, time.time(),
                 op["fingerprint"], hashlib.sha256(store.config.openrouter_key.encode()).hexdigest(),
                 str(evidence["http_status"]) + "_full_reservation_retained_receipt_unavailable"))
            db.execute("UPDATE operations SET actual_cost=max_cost,review_required=0 WHERE owner=? AND id=?",
                (op["owner"], operation))
            return {"reviewed": True, "replayed": False, "cost_basis": "worst_case_reservation",
                    "retained_cost_nano": op["max_cost"], "provider_total_nano": total,
                    "accounted_nano": accounted, "remaining_nano": store.config.test_budget_nano - accounted}


def disaster_backup(store, destination):
    if destination.exists():
        raise ValueError("Destination already exists")
    with (
        RuntimeLock(store.config.root),
        tempfile.TemporaryDirectory(dir=destination.parent) as tmp,
    ):
        tmp = Path(tmp)
        databases = []
        for name in ("control.db", "community.db"):
            path = store.path if name == "control.db" else store.config.root / name
            if name == "community.db" and not path.exists() and not path.is_symlink():
                continue
            if path.is_symlink() or not path.is_file():
                raise ValueError("Invalid disaster database path")
            with (
                closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as original,
                closing(sqlite3.connect(tmp / name)) as copied,
            ):
                original.backup(copied)
            databases.append(name)
        with tarfile.open(tmp / "snapshot.tar", "w") as archive:
            for name in databases:
                archive.add(tmp / name, arcname=name)
            for name in ("tenants", "transfers", "entity-transfers"):
                directory_root = store.config.root / name
                if directory_root.is_symlink():
                    raise ValueError("Invalid disaster directory")
                if directory_root.exists():
                    for directory in directory_root.iterdir():
                        if directory.is_symlink() or not directory.is_dir():
                            raise ValueError("Invalid disaster owner directory")
                        UUID(directory.name)
                        archive.add(
                            directory,
                            arcname=name + "/" + directory.name,
                            filter=lambda i: None if i.issym() or i.islnk() else i,
                        )
            # Retained user restore points must survive a Runtime disaster too.
            if store.config.backup_root and store.config.backup_root.exists():
                import re

                for directory in store.config.backup_root.iterdir():
                    # The current backup's own staging directory lives here when
                    # the destination is inside the configured backup root.
                    if directory == tmp:
                        continue
                    if not directory.is_dir() or directory.is_symlink():
                        continue
                    UUID(directory.name)
                    for file in directory.glob("*.kybackup"):
                        if not file.is_symlink() and re.fullmatch(
                            r"[0-9a-f]{32}\.kybackup", file.name
                        ):
                            archive.add(
                                file,
                                arcname="backups/" + directory.name + "/" + file.name,
                            )
        with (
            (tmp / "snapshot.tar").open("rb") as source,
            destination.open("xb") as output,
        ):
            output.write(MAGIC)
            index = 0
            while raw := source.read(CHUNK):
                token = store.cipher.encrypt(struct.pack("!Q", index) + raw)
                output.write(struct.pack("!I", len(token)) + token)
                index += 1
            token = store.cipher.encrypt(
                json.dumps({"kind": "disaster", "chunks": index}).encode()
            )
            output.write(struct.pack("!I", len(token)) + token)
    return hashlib.file_digest(destination.open("rb"), "sha256").hexdigest()


def disaster_restore(store, source):
    if any((store.config.root / name).exists() or (store.config.root / name).is_symlink()
           for name in ("tenants", "community.db", "transfers", "entity-transfers")):
        raise ValueError(
            "Restore only into a new empty destination; preserve the original"
        )
    with store.transaction() as db:
        # Shared funding/review rows can exist before the first account.
        for (table,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*'"):
            quoted = '"' + table.replace('"', '""') + '"'
            if db.execute('SELECT 1 FROM ' + quoted + ' LIMIT 1').fetchone():
                raise ValueError("Destination control plane is not empty")
    if (
        store.config.backup_root
        and store.config.backup_root.exists()
        and any(store.config.backup_root.iterdir())
    ):
        raise ValueError("Destination backup store is not empty")
    with (
        RuntimeLock(store.config.root),
        tempfile.TemporaryDirectory(dir=store.config.root) as tmp,
    ):
        tmp = Path(tmp)
        with source.open("rb") as input, (tmp / "snapshot.tar").open("wb") as output:
            if input.read(len(MAGIC)) != MAGIC:
                raise ValueError("Invalid encrypted backup")
            index = 0
            while True:
                prefix = input.read(4)
                if len(prefix) != 4:
                    raise ValueError("Truncated encrypted backup")
                length = struct.unpack("!I", prefix)[0]
                if not 0 < length < CHUNK * 2:
                    raise ValueError("Invalid encrypted chunk")
                raw = store.cipher.decrypt(input.read(length))
                if raw.startswith(b"{"):
                    if json.loads(raw) != {
                        "kind": "disaster",
                        "chunks": index,
                    } or input.read(1):
                        raise ValueError("Invalid backup footer")
                    break
                if struct.unpack("!Q", raw[:8])[0] != index:
                    raise ValueError("Invalid chunk order")
                output.write(raw[8:])
                index += 1
        with tarfile.open(tmp / "snapshot.tar") as archive:
            for member in archive:
                parts = Path(member.name).parts
                if member.name not in {"control.db", "community.db"}:
                    if len(parts) < 2 or parts[0] not in {"tenants", "backups", "transfers", "entity-transfers"}:
                        raise ValueError("Invalid backup member")
                    UUID(parts[1])
                if (
                    member.issym()
                    or member.islnk()
                    or member.name.startswith("/")
                    or ".." in parts
                ):
                    raise ValueError("Unsafe backup member")
            archive.extractall(tmp / "restored", filter="data")
        for database in (tmp / "restored").rglob("*.db"):
            with closing(sqlite3.connect(database)) as con:
                if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Invalid database integrity")
        for item in (tmp / "restored").iterdir():
            if item.name == "backups":
                if store.config.backup_root is None:
                    raise ValueError("Restore requires a configured backup store")
                store.config.backup_root.parent.mkdir(parents=True, exist_ok=True)
                if store.config.backup_root.exists():
                    store.config.backup_root.rmdir()
                import shutil

                shutil.move(str(item), store.config.backup_root)
            else:
                item.replace(store.config.root / item.name)
        store.recover()


def upload(file):
    import httpx
    from urllib.parse import urlsplit

    destination = os.environ["KYALULU_OFFSITE_UPLOAD_URL"]
    if urlsplit(destination).scheme != "https":
        raise ValueError("Offsite upload requires HTTPS")
    with (
        file.open("rb") as data,
        httpx.Client(timeout=300, follow_redirects=False) as client,
    ):
        response = client.put(destination, content=iter(lambda: data.read(CHUNK), b""))
        if not response.is_success:
            raise ValueError("Offsite upload failed")
    print(
        json.dumps(
            {
                "uploaded": True,
                "sha256": hashlib.file_digest(file.open("rb"), "sha256").hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("backup", "restore", "upload", "budget", "fund", "grant", "retain-failed-reservation"))
    parser.add_argument("--file", type=Path)
    parser.add_argument("--owner", help="Account UUID shown after a verified Web login")
    parser.add_argument("--credits", type=int)
    parser.add_argument("--nano-usd", type=int, help="Verified single contribution; campaign cap 700000000 nano USD")
    parser.add_argument("--source", help="Stable grant ID; reuse to avoid duplicate issuance")
    parser.add_argument("--days", type=int)
    parser.add_argument("--operation", help="Failed generation UUID to review offline")
    parser.add_argument("--evidence", type=Path, help="Upstream screenshot 429 or persisted native 429/safety 404 evidence; missing cost remains reserved")
    args = parser.parse_args()
    if args.command == "upload":
        upload(args.file)
    else:
        store = CloudStore(CloudConfig.from_env())
        if args.command == "retain-failed-reservation":
            if not args.operation or not args.evidence:
                parser.error("retain-failed-reservation requires --operation and --evidence")
            print(json.dumps(retain_failed_reservation(store, args.operation,
                json.loads(args.evidence.read_text(encoding="utf-8")))))
        elif args.command == "fund":
            if not args.source or not args.nano_usd:
                parser.error("fund requires --nano-usd and --source; verify real upstream funding first")
            print(json.dumps(store.add_funds(args.nano_usd, args.source, days=args.days if args.days is not None else 45)))
        elif args.command == "grant":
            if not args.owner or not args.credits or not args.source:
                parser.error("grant requires --owner, --credits and --source")
            print(json.dumps(store.admin_grant(args.owner, args.credits, args.source, days=args.days if args.days is not None else 30)))
        elif args.command == "backup":
            print(json.dumps({"sha256": disaster_backup(store, args.file)}))
        elif args.command == "restore":
            disaster_restore(store, args.file)
            print('{"restored":true}')
        else:
            with store.transaction() as db:
                print(
                    json.dumps(
                        {
                            "available_nano_usd": store._available_funds(db),
                            "budget_debt_nano_usd": db.execute("SELECT COALESCE(SUM(amount),0) FROM budget_debt").fetchone()[0],
                            "provider_overrun_incidents": db.execute("SELECT COUNT(*) FROM budget_debt WHERE source LIKE 'provider-overrun:%' AND amount>0").fetchone()[0],
                            "operations": [
                                dict(r)
                                for r in db.execute(
                                    "SELECT state,COUNT(*) AS count,SUM(actual_cost) AS cost FROM operations GROUP BY state"
                                )
                            ],
                        }
                    )
                )
