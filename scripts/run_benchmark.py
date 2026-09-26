"""Run a reproducible SFW model/memory matrix without a browser.

Example: python scripts/run_benchmark.py --models mock-echo \
    --scenarios advanced_mocha_sfw_30 advanced_librarian_sfw_100 --memory compare
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from python.core import benchmark  # noqa: E402


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--scenarios", nargs="+", default=["mocha_memory_001"])
    parser.add_argument("--memory", choices=["off", "on", "compare"], default="compare")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--history-turn-limit", type=int)
    parser.add_argument("--timeout", type=int, default=3600)
    args = parser.parse_args()
    request = benchmark.BenchmarkRequest(model_ids=args.models, scenarios=args.scenarios,
        memory=args.memory, runs=args.runs, seed=args.seed, history_turn_limit=args.history_turn_limit,
        run_timeout_seconds=args.timeout)
    job, matrix = benchmark.prepare_job(request)
    print(f"{job['planned_runs']} runs / {job['planned_turns']} turns; {benchmark.job_path(job['id'])}", flush=True)
    await benchmark.execute_job(job, matrix, request)
    print(json.dumps({"id": job["id"], "status": job["status"], "completed_runs": len(job["results"])}, ensure_ascii=False))
    if job["status"] != "completed":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
