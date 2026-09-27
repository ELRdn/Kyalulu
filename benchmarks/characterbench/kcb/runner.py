from __future__ import annotations
import copy
import platform
import random
import sqlite3
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from pathlib import Path
from . import __version__
from .config import check_network
from .dataset import load_dataset, select_units
from .grading import evaluate
from .protocol import PROTOCOL_HASH, PROTOCOL_VERSION, messages_for
from .providers import Provider, ProviderError
from .util import KCBError, digest, dumps, load_json, now, read_jsonl, save_json, write_jsonl


class Store:
    def __init__(self, directory: str | Path):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "run.sqlite3"
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            with db:
                yield db
        finally:
            db.close()

    def put(self, row: dict) -> None:
        with self._connect() as db:
            db.execute("INSERT INTO records(key,payload) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
                       (row["key"], dumps(row)))

    def rows(self) -> list[dict]:
        import json
        with self._connect() as db:
            rows = [json.loads(r[0]) for r in db.execute("SELECT payload FROM records")]
        return sorted(rows, key=lambda r: (r["repeat"], r["unit_id"], r["turn_index"]))

    def delete(self, keys: list[str]) -> None:
        with self._connect() as db:
            db.executemany("DELETE FROM records WHERE key=?", [(k,) for k in keys])

    def export(self) -> list[dict]:
        rows = self.rows()
        write_jsonl(self.directory / "responses.jsonl", rows)
        return rows


def row_key(unit_id: str, repeat: int, turn: int) -> str:
    return f"{unit_id}::r{repeat}::t{turn}"


def run_benchmark(config: dict, out: str | Path, *, dataset_dir=None, suite="all",
                  repeats=1, seed=17, workers=1, warmup=0, limit_units=None,
                  resume=False, retry_errors=False, retry_workers=None, allow_remote=False, quiet=False) -> dict:
    from .report import build_report
    if type(repeats) is not int or repeats < 1 or not 1 <= workers <= 16 or warmup < 0:
        raise KCBError("repeats >= 1, 1 <= workers <= 16, warmup >= 0 required")
    if limit_units is not None and limit_units <= 0:
        raise KCBError("limit-units must be positive")
    if retry_errors and not resume:
        raise KCBError("--retry-errors requires --resume")
    if retry_workers is not None and (not retry_errors or type(retry_workers) is not int or not 1 <= retry_workers <= 16):
        raise KCBError("retry-workers must be 1..16 and requires --resume --retry-errors")
    effective_workers = retry_workers if retry_workers is not None else workers
    config = copy.deepcopy(config)
    check_network(config, allow_remote)
    provider = Provider(config)
    provider.resolve_model()
    data = load_dataset(dataset_dir)
    units = select_units(data, suite)
    random.Random(seed).shuffle(units)
    if limit_units:
        units = units[:limit_units]
    if not units:
        raise KCBError("No selected units")
    out = Path(out)
    spec = {"version": __version__, "dataset_hash": data["hash"], "protocol_hash": PROTOCOL_HASH,
            "config": config, "suite": suite, "unit_ids": [u["id"] for u in units],
            "repeats": repeats, "seed": seed, "workers": workers, "warmup": warmup}
    fingerprint = digest(spec)
    if (out / "manifest.json").exists():
        if not resume:
            raise KCBError(f"Run already exists: {out}. Use --resume or a NEW output directory.")
        manifest = load_json(out / "manifest.json")
        if manifest.get("fingerprint") != fingerprint:
            raise KCBError("Resume refused: dataset, model/settings, suite, seed, or protocol changed. Use a new output directory.")
    else:
        if out.exists() and any(out.iterdir()):
            raise KCBError("Output directory is nonempty but has no manifest; use an empty directory")
        out.mkdir(parents=True, exist_ok=True)
        manifest = {"run_id": uuid.uuid4().hex, "created_at": now(), "fingerprint": fingerprint,
                    "spec": spec, "protocol_version": PROTOCOL_VERSION,
                    "grading_version": __version__, "regrade_events": [],
                    "expected_generations": sum(len(u["turns"]) for u in units) * repeats,
                    "expected_units": len(units) * repeats, "status": "created",
                    "mock": config["provider"] == "mock", "python": sys.version.split()[0],
                    "platform": platform.platform(), "retry_events": [],
                    "validation_status": "engineering_pilot_no_human_calibration"}
        save_json(out / "manifest.json", manifest)
        save_json(out / "dataset/characters.json", list(data["characters"].values()))
        write_jsonl(out / "dataset/cases.jsonl", data["units"])
    store = Store(out)
    previous = store.rows()
    if retry_errors:
        remove = []
        for unit in units:
            for repeat in range(repeats):
                part = [r for r in previous if r["unit_id"] == unit["id"] and r["repeat"] == repeat]
                failed = [r["turn_index"] for r in part if r["status"] != "ok"]
                if failed:
                    cut = min(failed)
                    remove += [r["key"] for r in part if r["turn_index"] >= cut]
        if remove:
            archive_path = out / "retry_attempts.jsonl"
            retry_batch_id = uuid.uuid4().hex
            archived_at = now()
            removed_keys = set(remove)
            prior_attempts = read_jsonl(archive_path) if archive_path.exists() else []
            write_jsonl(archive_path, prior_attempts + [
                {"retry_batch_id": retry_batch_id, "archived_at": archived_at, "record": row}
                for row in previous if row["key"] in removed_keys
            ])
            store.delete(remove)
            manifest["retry_events"].append({"at": archived_at, "retry_batch_id": retry_batch_id,
                                             "archive": archive_path.name, "removed_records": len(remove),
                                             "retry_workers": effective_workers,
                                             "note": "Explicit retry may incur additional unrecorded/partial API usage. Not best-of-k sampling."})
    existing = {r["key"]: r for r in store.rows()}
    manifest["status"] = "running"
    save_json(out / "manifest.json", manifest)
    if warmup and not (out / "warmup.json").exists():
        warm_records = []
        for warm_index in range(warmup):
            ctx = {"session_id": f"{manifest['run_id']}:warmup:{warm_index}", "reset": True, "turn_index": 1, "character": {}}
            warm_records.append(provider.generate([{"role": "user", "content": "接続確認です。確認、とだけ返してください。"}], session_context=ctx).record())
        save_json(out / "warmup.json", {"excluded_from_benchmark": True, "calls": warm_records})
    stop_event = threading.Event()
    print_lock = threading.Lock()
    counter = [len(existing)]

    def process(unit, repeat):
        client = Provider(copy.deepcopy(config))
        history = []
        blocked = False
        card = data["characters"][unit["character_id"]]
        session_id = f"{manifest['run_id']}:{unit['id']}:r{repeat}"
        for index, turn in enumerate(unit["turns"], 1):
            if stop_event.is_set():
                return
            key = row_key(unit["id"], repeat, index)
            if key in existing:
                old = existing[key]
                if old["status"] == "ok":
                    history += [{"role": "user", "content": turn["user"]}, {"role": "assistant", "content": old["text"]}]
                else:
                    blocked = True
                continue
            seed_for_call = int(digest({"seed": seed, "key": key})[:8], 16) & 0x7fffffff
            messages = messages_for(card, history, turn["user"], config["system_prompt_extra"])
            row = {"key": key, "unit_id": unit["id"], "character_id": unit["character_id"],
                   "family": unit["family"], "mode": unit["mode"], "repeat": repeat, "turn_index": index,
                   "unit_length": len(unit["turns"]), "seed": seed_for_call, "created_at": now(),
                   "request_messages": messages, "request_hash": digest(messages), "text": "",
                   "status": "skipped_dependency" if blocked else "pending", "error": None,
                   "evaluation": None, "latency_seconds": None, "ttft_seconds": None, "usage": None,
                   "finish_reason": None, "server_model": None, "mock": manifest["mock"],
                   "streamed": False, "reasoning_chars": 0, "system_replayed_response": False}
            if not blocked:
                start = time.perf_counter()
                try:
                    allowed = ("name", "role", "setting", "age_group", "traits", "behavior_range", "speech", "preferences", "knowledge_boundary", "scope")
                    context = {"session_id": session_id, "reset": index == 1, "turn_index": index,
                               "character": {k: card[k] for k in allowed if k in card}}
                    result = client.generate(messages, seed_for_call, context)
                    row.update(result.record())
                    if result.finish_reason in ("length", "max_tokens"):
                        row["status"] = "truncated"
                        row["error"] = "Generation reached its token limit. Partial content was saved but not graded."
                        blocked = True
                    elif config["provider"] == "openai" and result.finish_reason != "stop":
                        row["status"] = "error"
                        row["error"] = f"Generation did not finish normally (finish_reason={result.finish_reason!r}). Content was saved but not graded."
                        blocked = True
                    else:
                        row["status"] = "ok"
                        row["evaluation"] = evaluate(result.text, turn["eval"]["checks"])
                        history += [{"role": "user", "content": turn["user"]}, {"role": "assistant", "content": result.text}]
                except ProviderError as exc:
                    row["status"] = "error"
                    row["error"] = str(exc)
                    row["latency_seconds"] = time.perf_counter() - start
                    blocked = True
            else:
                row["error"] = "Earlier turn failed; no fabricated replacement added to history."
            store.put(row)
            with print_lock:
                counter[0] += 1
                if not quiet:
                    print(f"[{counter[0]}/{manifest['expected_generations']}] {key}: {row['status']}", flush=True)

    try:
        jobs = [(unit, repeat) for repeat in range(repeats) for unit in units]
        if effective_workers == 1:
            for unit, repeat in jobs:
                process(unit, repeat)
        else:
            pool = ThreadPoolExecutor(max_workers=effective_workers)
            futures = [pool.submit(process, unit, repeat) for unit, repeat in jobs]
            try:
                for future in as_completed(futures):
                    future.result()
            except BaseException:
                stop_event.set()
                for future in futures:
                    future.cancel()
                pool.shutdown(wait=True, cancel_futures=True)
                raise
            else:
                pool.shutdown(wait=True)
        rows = store.export()
        manifest["mock"] = manifest["mock"] or any(r.get("mock", False) for r in rows)
        manifest["status"] = "complete" if all(r["status"] == "ok" for r in rows) else "complete_with_errors"
    except BaseException:
        rows = store.export()
        manifest["mock"] = manifest["mock"] or any(r.get("mock", False) for r in rows)
        manifest["status"] = "interrupted"
        save_json(out / "manifest.json", manifest)
        build_report(out)
        raise
    manifest["finished_at"] = now()
    save_json(out / "manifest.json", manifest)
    summary = build_report(out)
    if not quiet:
        print(f"Report: {out / 'report.html'}")
    return summary


def load_run(directory: str | Path) -> tuple[dict, list[dict], dict]:
    directory = Path(directory)
    manifest = load_json(directory / "manifest.json")
    if not (directory / "run.sqlite3").exists():
        raise KCBError("Missing run.sqlite3; this is not a complete run directory")
    rows = Store(directory).rows()
    data = load_dataset(directory / "dataset")
    if data["hash"] != manifest["spec"]["dataset_hash"]:
        raise KCBError("Run dataset snapshot hash mismatch")
    return manifest, rows, data


def regrade_run(directory: str | Path) -> dict:
    """Explicitly re-evaluate stored text; never make a model request or hide old scores."""
    from .report import build_report
    directory = Path(directory)
    manifest, rows, data = load_run(directory)
    if manifest["status"] not in ("complete", "complete_with_errors"):
        raise KCBError("Regrade requires a finished run; resume or finish it first")
    old_version = manifest.get("grading_version", manifest["spec"]["version"])
    if old_version == __version__:
        raise KCBError(f"Run is already graded with {__version__}; no regrade needed")
    units = {u["id"]: u for u in data["units"]}
    stamp, batch_id = now(), uuid.uuid4().hex
    changed = []
    for row in rows:
        if row["status"] != "ok":
            continue
        checks = units[row["unit_id"]]["turns"][row["turn_index"] - 1]["eval"]["checks"]
        updated = evaluate(row["text"], checks)
        if updated != row["evaluation"]:
            changed.append({"batch_id": batch_id, "at": stamp, "key": row["key"],
                            "from_version": old_version, "to_version": __version__,
                            "old_evaluation": row["evaluation"], "new_evaluation": updated})
            row["evaluation"] = updated
    archive = directory / "regrade_history.jsonl"
    prior = read_jsonl(archive) if archive.exists() else []
    write_jsonl(archive, prior + changed)
    store = Store(directory)
    for row in rows:
        if any(c["key"] == row["key"] for c in changed):
            store.put(row)
    store.export()
    manifest["grading_version"] = __version__
    manifest.setdefault("regrade_events", []).append({"batch_id": batch_id, "at": stamp,
                                                       "from_version": old_version, "to_version": __version__,
                                                       "changed_records": len(changed), "archive": archive.name})
    save_json(directory / "manifest.json", manifest)
    return build_report(directory)
