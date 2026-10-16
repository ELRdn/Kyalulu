"""Read-only lower bound for the complete 240-turn acceptance campaign."""
import argparse
from decimal import Decimal
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))
from python.cloud.model_choices import CHOICES
from python.cloud.release_readiness import source_fingerprint
from python.providers.openrouter import OpenRouterProvider

ROUTES = ("cloud-deepseek-inferencenet", "cloud-glm-inferencenet")


def estimate():
    rows = []
    for route in ROUTES:
        choice = CHOICES[route]
        provider = OpenRouterProvider(api_key="estimate-only", model=choice["model"],
            upstream=choice["upstream"], upstream_tag=choice["upstream_tag"],
            price_caps=choice["prices"], reasoning_effort=choice["reasoning_effort"])
        calls = 2 * 3 * 20
        cost = Decimal(choice["prices"][1]) * provider.max_output * calls / 1_000_000
        rows.append({"route": route, "calls": calls, "max_output_tokens": provider.max_output,
                     "output_upper_allowance_usd": str(cost)})
    minimum = sum((Decimal(row["output_upper_allowance_usd"]) for row in rows), Decimal(0))
    return {"source_fingerprint": source_fingerprint(), "calls_required": 240,
            "validation_cap_usd": "0.30", "beta_cap_usd": "0.70", "total_new_cap_usd": "1.00",
            "routes": rows, "output_only_upper_allowance_usd": str(minimum),
            "full_quote_includes_input_and_possible_repairs": True,
            "execute": False, "ready": False,
            "reason": "output_allowance_alone_exceeds_cap" if minimum > Decimal("0.30")
                      else "full_input_and_repair_estimate_required",
            "real_generation_requests": 0}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    encoded = json.dumps(estimate(), ensure_ascii=False, indent=2)
    if args.output:
        destination = args.output.resolve()
        if not destination.is_relative_to((ROOT / ".artifacts").resolve()):
            raise ValueError("evidence output must stay in .artifacts")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    raise SystemExit(2)
