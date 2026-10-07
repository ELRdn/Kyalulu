"""Synthetic local storage benchmark. No auth, API inference or SFW acceptance.

Writes only generated ASCII conversations in temporary directories under this
workspace. Encrypted page staging, quota preview, atomic commit and replay are
real; classifier/network/VPS capacity and quality are expressly untested.
"""

import argparse
import asyncio
from contextlib import closing
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import threading
import time
from uuid import uuid4
import psutil

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))
from python.cloud.config import CloudConfig
from python.cloud.store import CloudStore
from python.cloud.sync import SyncService
from python.cloud.transfers import Transfers, snapshot_pages
from python.storage.context import CloudStorageContext, storage_context
from python.storage import db as storage
from python.api.chat import _save_settings


def contents_hash(path):
    digest = hashlib.sha256()
    with closing(sqlite3.connect(path)) as db:
        for row in db.execute("SELECT role,content,model_id FROM chat_history ORDER BY id"):
            digest.update(json.dumps(row).encode())
    return digest.hexdigest()


async def benchmark(quota, plan, temporary_root):
    start = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="sync-volume-", dir=temporary_root) as directory:
        directory = Path(directory).resolve()
        if not directory.is_relative_to(temporary_root.resolve()):
            raise ValueError("temporary directory escaped workspace")
        cfg = CloudConfig(root=directory / "cloud", origin="https://synthetic.invalid", secret="benchmark-only-secret-" * 2)
        store = CloudStore(cfg)
        owner = str(uuid4())
        store.account(owner, consent="synthetic-storage-only")
        with store.transaction() as db:
            db.execute("UPDATE accounts SET plan=?,plan_until=? WHERE id=?", (plan,time.time()+3600,owner))
        source = CloudStorageContext.for_owner(directory / "source", str(uuid4()))
        target = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
        with storage_context(source):
            await storage.init_db()
            await _save_settings("volume", "Synthetic ASCII storage benchmark", 0.8)
        with storage_context(target):
            await storage.init_db()
        source_db, target_db = source.directory / "data.db", target.directory / "data.db"
        row_bytes = 36_000
        rows = int(quota * 0.9) // row_bytes
        pattern = hashlib.sha256(b"synthetic-only-no-user-content").hexdigest()
        text = (pattern * (row_bytes // len(pattern) + 1))[:row_bytes]
        with closing(sqlite3.connect(source_db)) as db:
            db.executemany("INSERT INTO chat_history(session_id,role,content,model_id) VALUES('volume','user',?,'synthetic')",
                           ((text,) for _ in range(rows)))
            db.commit()
        expected = contents_hash(source_db)
        service = SyncService(store)
        service.settings(owner, "all")
        transfers = Transfers(store, service)
        transfer = transfers.create(owner, direction="upload", selected=None, revision=0, request_id="volume")
        t0 = time.perf_counter()
        count = 0
        for count, page in enumerate(snapshot_pages(source_db), start=1):
            transfers.validate_page(owner, transfer, page, target_db)
            # Pure storage benchmark: production separately screens every row.
            transfers.append(owner, transfer, count-1, page)
        upload = time.perf_counter()-t0
        meta = transfers.inspect(owner, transfer)
        print(json.dumps({"quota":quota,"stage":"encrypted-pages","pages":count,"seconds":round(upload,3)}),flush=True)
        t0 = time.perf_counter()
        transfers.check_capacity(owner, transfer, target_db)
        preview = time.perf_counter()-t0
        t0 = time.perf_counter()
        committed = transfers.commit(owner, transfer, target_db, pages=count, chain=meta["chain"])
        commit = time.perf_counter()-t0
        assert committed["revision"] == 1
        assert transfers.commit(owner, transfer, target_db, pages=count, chain=meta["chain"]) == committed
        assert contents_hash(target_db) == expected
        assert target_db.stat().st_size <= quota
        staging_bytes = transfers.file(owner,transfer).stat().st_size
        transfers.delete(owner, transfer)
        return {"plan":plan,"quota_bytes":quota,"source_bytes":source_db.stat().st_size,
                "target_bytes":target_db.stat().st_size,"rows":rows,"pages":count,
                "staging_bytes":staging_bytes,"upload_seconds":round(upload,3),
                "quota_preview_seconds":round(preview,3),"commit_seconds":round(commit,3),
                "total_seconds":round(time.perf_counter()-start,3),"content_hash":expected,
                "replay_did_not_advance_revision":True,"sfw_acceptance":False}


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sizes", nargs="+", choices=("250MB","1GB"), default=["250MB","1GB"])
    parser.add_argument("--output", type=Path, default=ROOT / ".artifacts/cloud-sync-volume/benchmark.json")
    args = parser.parse_args()
    output = args.output.resolve()
    if not output.is_relative_to(ROOT / ".artifacts"):
        raise ValueError("benchmark output must stay under workspace .artifacts")
    output.parent.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(output.parent).free < 8_000_000_000:
        raise ValueError("benchmark requires 8GB free working space")
    peak = [psutil.Process().memory_info().rss]
    stopped = threading.Event()
    def sample():
        while not stopped.wait(0.05):
            peak[0] = max(peak[0],psutil.Process().memory_info().rss)
    worker = threading.Thread(target=sample,daemon=True)
    worker.start()
    try:
        results = []
        for size in args.sizes:
            quota,plan = (250_000_000,"plus") if size=="250MB" else (1_000_000_000,"pro")
            results.append(await benchmark(quota,plan,output.parent))
        report = {"environment":"developer Windows, synthetic storage only","real_inference_attempts":0,
                  "sfw_checks":0,"vps_or_relay_acceptance":False,"peak_process_rss_bytes":peak[0],"results":results}
        output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
        print(json.dumps(report),flush=True)
    finally:
        stopped.set()
        worker.join(timeout=2)


if __name__=="__main__":
    asyncio.run(main())
