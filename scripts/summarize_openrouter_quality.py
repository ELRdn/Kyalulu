"""Recompute verified counts, retaining contract versions and repair attempts."""

import argparse
from collections import Counter, defaultdict
from decimal import Decimal
import hashlib
import json
from pathlib import Path


def summarize(path):
    raw = path.read_bytes()
    evidence = json.loads(raw)
    rows = evidence["requests"]
    assert len({r["label"] for r in rows}) == len(rows), "duplicate dispatch label"
    prior = Decimal(evidence["prior_cost_usd"])
    actual = sum((Decimal(r["actual_cost_usd"]) for r in rows if "actual_cost_usd" in r), Decimal(0))
    unknown = sum((Decimal(r["reserved_usd"]) for r in rows if "actual_cost_usd" not in r), Decimal(0))
    assert actual + unknown + prior <= Decimal(evidence["budget_usd"]), "campaign budget exceeded"
    by_candidate = {}
    for candidate in ("ling", "deepseek", "glm", "muse"):
        subset = [r for r in rows if r.get("candidate") == candidate]
        groups = defaultdict(list)
        for row in subset:
            if row.get("phase") == "conversation":
                groups[(row.get("contract", "compact-v1"), row["language"], row["repetition"])].append(row)
        conversations = []
        for (contract, language, repetition), turns in sorted(groups.items()):
            successful = {r["turn"]: r for r in turns if r["status"] == "passed"}
            # A repaired successful turn is counted once; failed paid attempts
            # stay in cost/retry totals, not as extra successful dialogue turns.
            probes = [r for r in successful.values() if r.get("keyword_probe_passed") is not None]
            conversations.append({"contract": contract, "language": language, "repetition": repetition,
                                  "validated_turns": len(successful), "complete_20_turns": set(successful) == set(range(1, 21)),
                                  "attempts": len(turns), "repairs": sum(bool(r.get("retry_of")) for r in turns),
                                  "keyword_matched": sum(r["keyword_probe_passed"] is True for r in probes),
                                  "keyword_count": len(probes),
                                  "cost_usd": str(sum((Decimal(r["actual_cost_usd"]) for r in turns if "actual_cost_usd" in r), Decimal(0)))})
        fixture_groups = {}
        for phase in ("safety", "vision", "long"):
            values = [r for r in subset if r.get("phase") == phase]
            completed = [r for r in values if r["status"] == "passed"]
            fixture_groups[phase] = {"valid_responses": len(completed), "matches": sum(r.get("fixture_passed") is True for r in completed),
                                     "mismatches": [r["label"] for r in completed if r.get("fixture_passed") is False],
                                     "failed_attempts": len(values) - len(completed)}
        by_candidate[candidate] = {"requests": len(subset), "statuses": dict(Counter(r["status"] for r in subset)),
                                   "errors": dict(Counter(r.get("error", "unknown") for r in subset if r["status"] != "passed")),
                                   "actual_usd": str(sum((Decimal(r["actual_cost_usd"]) for r in subset if "actual_cost_usd" in r), Decimal(0))),
                                   "conversations": conversations, "fixtures": fixture_groups}
    result = {"evidence_sha256": hashlib.sha256(raw).hexdigest(), "campaign_requests": len(rows),
              "statuses": dict(Counter(r["status"] for r in rows)), "campaign_actual_usd": str(actual),
              "prior_actual_usd": str(prior), "cumulative_actual_usd": str(actual + prior),
              "unknown_reserved_usd": str(unknown), "cumulative_accounted_usd": str(actual + unknown + prior),
              "budget_usd": evidence["budget_usd"], "human_review": "pending", "cloud_acceptance": False,
              "candidates": by_candidate, "stopped": evidence.get("stopped"),
              "blocked_candidates": evidence.get("blocked_candidates", {})}
    output = path.parent / "summary-verified.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "candidates"}, ensure_ascii=False))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    summarize(parser.parse_args().evidence)
