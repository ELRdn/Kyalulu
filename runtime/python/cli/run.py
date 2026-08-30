"""CLI: uv run --directory runtime python -m python.cli.run --scenario ... --model ... --runs 3"""

import argparse
import asyncio
import pathlib
import sys

from python.core.experiment import load_scenario, run_single, save_experiment

async def main_async(args):
    scenario = load_scenario(args.scenario)
    print(f"[exp] scenario: {scenario.id} v{scenario.version} ({len(scenario.turns)} turns)")
    print(f"[exp] model: {args.model}  runs: {args.runs}  temp: {args.temperature}")
    for run in range(1, args.runs + 1):
        print(f"\n[exp] --- run {run}/{args.runs} ---")
        meta, turns, raw_prompt = await run_single(
            scenario,
            model_id=args.model,
            run_number=run,
            seed=args.seed,
            temperature=args.temperature,
            extra_system_prompt=args.extra_system_prompt,
        )
        out_dir = save_experiment(meta, turns, raw_prompt)
        print(f"[exp] saved: {out_dir}")
        print(f"[exp] id: {meta.experiment_id}  elapsed example: {turns[0]['elapsed_ms']}ms")
    print("\n[exp] done")

def main():
    p = argparse.ArgumentParser(description="Kyalulu Experiment Runner")
    p.add_argument("--scenario", required=True, help="scenario id or path (e.g. mocha_daily_001 or scenarios/mocha_daily_001.yaml)")
    p.add_argument("--model", required=True, help="model id (e.g. mock-echo)")
    p.add_argument("--runs", type=int, default=3, help="number of runs (default 3)")
    p.add_argument("--temperature", type=float, default=None)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--extra-system-prompt", type=str, default=None)
    p.add_argument("--nsfw", action="store_true", help="allow NSFW scenarios (otherwise blocked)")
    args = p.parse_args()
    # NSFWガード: デフォではNSFWシナリオを弾く
    from python.core.experiment import load_scenario as _ls
    # 事前チェックで警告
    try:
        sc = _ls(args.scenario)
        if sc.nsfw and not args.nsfw:
            print(f"[error] scenario {sc.id} is NSFW (nsfw_level={sc.nsfw_level}). Use --nsfw to run.", file=sys.stderr)
            sys.exit(1)
    except SystemExit:
        raise
    except Exception:
        pass
    asyncio.run(main_async(args))

if __name__ == "__main__":
    main()
