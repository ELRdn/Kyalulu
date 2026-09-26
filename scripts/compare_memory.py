"""Memory off vs on under identical conditions (same model, scenario, seed, prompt).

Each condition is saved as a normal experiment; the summary separates what the
model did (recall with the facts still in context) from what the memory system
did (stored / retrieved / injected across a session break), using the failure
taxonomy: not_stored, not_retrieved, retrieved_but_ignored, hallucinated.

    uv run --package kyalulu-runtime python scripts/compare_memory.py --model mock-echo
    uv run --package kyalulu-runtime python scripts/compare_memory.py --model qwen3.5-9b-ollama --runs 3

Output: .artifacts/memory-compare.json
"""
import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))

from python.core import experiment  # noqa: E402

OUT = ROOT / ".artifacts" / "memory-compare.json"


def _total(summaries: list[dict]) -> dict:
    out = {"probes": 0, "recalled": 0, "hallucinated": 0, "stored": 0, "unsupported_stored": 0, "outcomes": {}}
    for s in summaries:
        for key in ("probes", "recalled", "hallucinated", "stored", "unsupported_stored"):
            out[key] += s.get(key) or 0
        for k, v in (s.get("outcomes") or {}).items():
            out["outcomes"][k] = out["outcomes"].get(k, 0) + v
    out["recall_rate"] = round(out["recalled"] / out["probes"], 3) if out["probes"] else None
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--scenario", default="mocha_memory_001")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    scenario = experiment.load_scenario(args.scenario)
    result = {"started_at": datetime.now(UTC).isoformat(), "model": args.model, "scenario": scenario.id,
              "runs": args.runs, "seed": args.seed, "conditions": {}}
    for label, enabled in (("memory_off", False), ("memory_on", True)):
        runs = []
        for n in range(1, args.runs + 1):
            print(f"[{label}] run {n}/{args.runs}", flush=True)
            meta, _, _ = await experiment.run_single(scenario, args.model, run_number=n, seed=args.seed + n,
                                                     memory=enabled)
            runs.append({"experiment_id": meta.experiment_id, "status": meta.status,
                         "memory": (meta.metrics or {}).get("memory") or {}})
        result["conditions"][label] = {"runs": runs, "total": _total([r["memory"] for r in runs])}
    off, on = result["conditions"]["memory_off"]["total"], result["conditions"]["memory_on"]["total"]
    result["recall_rate_delta"] = (round(on["recall_rate"] - off["recall_rate"], 3)
                                   if on["recall_rate"] is not None and off["recall_rate"] is not None else None)
    result["finished_at"] = datetime.now(UTC).isoformat()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"memory_off": off, "memory_on": on, "recall_rate_delta": result["recall_rate_delta"]},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
