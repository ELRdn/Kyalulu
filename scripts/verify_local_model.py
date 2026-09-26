"""Bounded real-model smoke with persisted prompt/config/telemetry snapshots."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from python.core import experiment  # noqa: E402


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--scenario", default="mocha_daily_001")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--turns", type=int, default=1)
    parser.add_argument("--memory", action="store_true")
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--no-thinking", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.turns <= 20 or not 1 <= args.timeout <= 3600:
        parser.error("turns must be 1..20 and timeout 1..3600 seconds")
    scenario = experiment.load_scenario(args.scenario)
    if scenario.nsfw:
        parser.error("the verification script requires an SFW scenario")
    scenario = scenario.model_copy(update={"turns": scenario.turns[:args.turns]})
    cfg = experiment._resolve_model_cfg(args.model)
    requested = {**cfg.get("recommended_generation", {}), "max_tokens": 1024}
    if cfg["provider"]["type"] == "ollama":
        requested["num_ctx"] = cfg.get("context_length", 8192)
        if args.no_thinking:
            requested["think"] = False
    async with asyncio.timeout(args.timeout):
        meta, turns, _ = await experiment.run_single(scenario, args.model, seed=args.seed, memory=args.memory,
            replay_config={"recommended_generation": requested})
    print(json.dumps({"experiment_id": meta.experiment_id, "status": meta.status, "model": meta.model_id,
        "memory": meta.memory_enabled, "turns": len(turns), "metrics": meta.metrics,
        "telemetry": [t.get("telemetry") for t in turns], "path": str(experiment.EXPERIMENTS_DIR / meta.experiment_id)}, ensure_ascii=False, indent=2))
    if meta.status != "completed":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
