"""Compare a backend reached directly with the same backend reached through LE.

Runs the same scenario (structured reply + state JSON, the normal research
pipeline) against two registered models, e.g. ``qwen3.5-9b-ollama`` and
``le:ollama/qwen3.5:9b``, and records per arm:
reply start / total time, tok/s, State JSON success, retries, stability over
N turns, cancel latency with a follow-up health request, reloads of the LE
engine, and inference-process RAM. VRAM is taken from LE's device list when
LE has a llama-server configured, otherwise it stays null with a reason.

    uv run --package kyalulu-runtime python scripts/compare_le_direct.py \
        --direct qwen3.5-9b-ollama --le le:ollama/qwen3.5:9b --turns 20 --runs 1

Each run is also saved as a normal experiment. Output: .artifacts/le-compare.json
"""
import argparse
import asyncio
import json
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import psutil

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))

from python.core import experiment  # noqa: E402
from python.core.registry import find_model  # noqa: E402
from python.providers.factory import get_provider_for_model  # noqa: E402
from python.providers.le import LEProvider  # noqa: E402

OUT = ROOT / ".artifacts" / "le-compare.json"
SERVER_PROCESSES = ("ollama", "llama-server", "le-daemon", "lm studio", "lms")
CANCEL_PROMPT = "Count from 1 to 400, one number per line."


def _median(values):
    values = [v for v in values if isinstance(v, (int, float))]
    return round(statistics.median(values), 2) if values else None


class ServerMemory:
    """Peak RSS of inference server processes (sum) and lowest available system RAM."""

    def __init__(self):
        self.peak_rss = 0
        self.min_available = psutil.virtual_memory().available
        self.names = set()
        self.task = None

    def _sample(self):
        total = 0
        for p in psutil.process_iter(["name", "memory_info"]):
            name = (p.info["name"] or "").lower()
            if any(name.startswith(s) for s in SERVER_PROCESSES) and p.info["memory_info"]:
                total += p.info["memory_info"].rss
                self.names.add(p.info["name"])
        self.peak_rss = max(self.peak_rss, total)
        self.min_available = min(self.min_available, psutil.virtual_memory().available)

    async def __aenter__(self):
        async def loop():
            while True:
                await asyncio.to_thread(self._sample)
                await asyncio.sleep(1)
        self.task = asyncio.create_task(loop())
        return self

    async def __aexit__(self, *exc):
        self.task.cancel()
        try:
            await self.task
        except asyncio.CancelledError:
            pass

    def summary(self):
        return {"server_peak_rss_bytes": self.peak_rss or None, "server_processes": sorted(self.names),
                "system_min_available_bytes": self.min_available}


async def le_snapshot() -> dict:
    """Engine load time and per-device free VRAM as LE sees them (best effort)."""
    le = LEProvider()
    if not le.api_key:
        return {"available": False}
    try:
        async with asyncio.timeout(10):
            resource_status, res = await le.call("GET", "resources")
            status, dev = await le.call("GET", "engine/devices")
    except Exception as e:
        return {"available": False, "error": type(e).__name__}
    engine = res.get("engine") or {}
    return {"available": resource_status == 200, "engine_model": engine.get("model_id"), "engine_loaded_at": engine.get("loaded_at"),
            "devices": dev.get("devices") if status == 200 else None,
            "vram_unavailable_reason": None if status == 200 else (dev.get("error") or {}).get("code")}


def _vram_used(before: dict, after: dict) -> dict | None:
    if not (before.get("devices") and after.get("devices")):
        return None
    free_before = {d["id"]: d["free_bytes"] for d in before["devices"] if isinstance(d.get("free_bytes"), int)}
    measured = {d["id"]: free_before[d["id"]] - d["free_bytes"] for d in after["devices"]
                if d["id"] in free_before and isinstance(d.get("free_bytes"), int)}
    return measured or None


async def cancel_probe(model_id: str) -> dict:
    """Stream, cancel after the first chunk, then check the backend still answers."""
    cfg = find_model(model_id)
    provider = get_provider_for_model(cfg)
    model = cfg["provider"]["model"]
    messages = [{"role": "user", "content": CANCEL_PROMPT}]
    start = time.perf_counter()
    first = None
    stream = provider.stream_events(model=model, messages=messages, max_tokens=800)
    try:
        async with asyncio.timeout(120):
            async for event in stream:
                if event.get("type") == "delta" and event.get("text"):
                    first = round((time.perf_counter() - start) * 1000, 1)
                    break
    finally:
        closing = time.perf_counter()
        await stream.aclose()
        cancel_ms = round((time.perf_counter() - closing) * 1000, 1)
    follow = time.perf_counter()
    try:
        async with asyncio.timeout(120):
            text = await provider.generate(model=model, messages=[{"role": "user", "content": "Reply with OK."}],
                                           max_tokens=16)
        follow_ok, follow_error = True, None
    except Exception as e:
        text, follow_ok, follow_error = "", False, type(e).__name__
    return {"first_chunk_ms": first, "cancel_close_ms": cancel_ms, "follow_up_ok": follow_ok,
            "follow_up_ms": round((time.perf_counter() - follow) * 1000, 1), "follow_up_error": follow_error,
            "follow_up_chars": len(text or "")}


async def run_arm(label: str, model_id: str, scenario, runs: int) -> dict:
    if not find_model(model_id):
        raise SystemExit(f"model {model_id} is not registered (models/*.yaml or LE)")
    arm = {"label": label, "model_id": model_id, "runs": []}
    for n in range(1, runs + 1):
        before = await le_snapshot()
        async with ServerMemory() as mem:
            started = time.perf_counter()
            meta, turns, _ = await experiment.run_single(scenario, model_id, run_number=n, seed=42 + n)
            wall = round(time.perf_counter() - started, 1)
        after = await le_snapshot()
        tel = [t.get("telemetry") or {} for t in turns]
        arm["runs"].append({
            "experiment_id": meta.experiment_id, "status": meta.status, "wall_seconds": wall,
            "turns_completed": sum(1 for t in turns if t.get("status") == "completed"),
            "turns_planned": len(scenario.turns),
            "state_json_ok": sum(1 for t in turns if (t.get("validation") or {}).get("ok")),
            "retries": sum((t.get("validation") or {}).get("retries", 0) for t in turns),
            "ttft_ms_median": _median(x.get("ttft_ms") for x in tel),
            "first_reply_ms_median": _median(x.get("first_reply_ms") for x in tel),
            "elapsed_ms_median": _median(x.get("elapsed_ms") for x in tel),
            "tokens_per_second_median": _median(x.get("tokens_per_second") for x in tel),
            "engine_reloaded": (before["engine_loaded_at"] != after["engine_loaded_at"])
                               if before.get("engine_loaded_at") and after.get("engine_loaded_at") else None,
            "vram_delta_bytes": _vram_used(before, after),
            "memory": mem.summary(),
        })
    try:
        arm["cancel"] = await cancel_probe(model_id)
    except Exception as exc:
        arm["cancel"] = {"error": type(exc).__name__, "follow_up_ok": False}
    runs_ = arm["runs"]
    planned = sum(r["turns_planned"] for r in runs_)
    arm["summary"] = {
        "state_json_success_rate": round(sum(r["state_json_ok"] for r in runs_) / planned, 3) if planned else None,
        "retries": sum(r["retries"] for r in runs_),
        "stable_runs": sum(1 for r in runs_ if r["turns_completed"] == r["turns_planned"]),
        "ttft_ms_median": _median(r["ttft_ms_median"] for r in runs_),
        "first_reply_ms_median": _median(r["first_reply_ms_median"] for r in runs_),
        "elapsed_ms_median": _median(r["elapsed_ms_median"] for r in runs_),
        "tokens_per_second_median": _median(r["tokens_per_second_median"] for r in runs_),
        "engine_reloads": sum(1 for r in runs_ if r["engine_reloaded"])
                          if any(r["engine_reloaded"] is not None for r in runs_) else None,
    }
    return arm


def _delta(direct, via):
    if direct is None or via is None:
        return None
    return round(via - direct, 2)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--direct", required=True, help="model id reached directly (models/*.yaml)")
    ap.add_argument("--le", required=True, help="model id through LE, e.g. le:ollama/qwen3.5:9b")
    ap.add_argument("--scenario", default="mocha_daily_001")
    ap.add_argument("--turns", type=int, default=20)
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    scenario = experiment.load_scenario(args.scenario)
    if not 1 <= args.turns <= len(scenario.turns) or not 1 <= args.runs <= 3:
        ap.error("turns must fit the scenario and runs must be 1..3")
    scenario = scenario.model_copy(update={"turns": sorted(scenario.turns, key=lambda t: t.turn)[:args.turns]})
    result = {"started_at": datetime.now(UTC).isoformat(), "scenario": scenario.id,
              "turns": len(scenario.turns), "runs": args.runs, "arms": []}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    for label, model_id in (("direct", args.direct), ("le", args.le)):
        print(f"[{label}] {model_id}: {len(scenario.turns)} turns x {args.runs}", flush=True)
        result["arms"].append(await run_arm(label, model_id, scenario, args.runs))
        out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    d, v = (a["summary"] for a in result["arms"])
    result["le_minus_direct"] = {k: _delta(d[k], v[k]) for k in
                                 ("ttft_ms_median", "first_reply_ms_median", "elapsed_ms_median",
                                  "tokens_per_second_median", "state_json_success_rate")}
    result["finished_at"] = datetime.now(UTC).isoformat()
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"direct": d, "le": v, "le_minus_direct": result["le_minus_direct"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
