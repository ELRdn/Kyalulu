from __future__ import annotations
import re
from .util import strict_object, judge_object


def exact_equal(a, b) -> bool:
    """JSON equality with type checks: True is not 1; 1 is not 1.0."""
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(exact_equal(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(exact_equal(x, y) for x, y in zip(a, b))
    return a == b


def evaluate(text: str, checks: list[dict]) -> dict:
    outcomes = []
    for rule in checks:
        kind = rule["type"]
        note = ""
        if kind == "nonempty":
            passed = bool(text.strip())
        elif kind == "max_chars":
            passed = len(text) <= rule["value"]
            note = f"Unicode codepoints={len(text)}, limit={rule['value']}"
        elif kind == "no_headings":
            passed = not bool(re.search(r"(?m)^\s*(?:#{1,6}\s|[-*+]\s|[0-9]+[.)]\s|```|[・●•○■◆]\s*\S)", text))
            note = "Literal heading/list contract, including common Japanese bullet markers; not a naturalness score."
        elif kind == "contains":
            passed = rule["value"] in text
            note = "Literal inclusion only; not evidence of semantic/persona correctness."
        elif kind == "json_exact":
            try:
                actual = strict_object(text)
                passed = exact_equal(actual, rule["expected"])
                note = "Exact keys, values, and JSON types; key order ignored."
            except (ValueError, TypeError) as exc:
                passed, note = False, f"Invalid strict JSON: {exc}"
        else:
            raise ValueError(f"Unknown check: {kind}")
        outcomes.append({"type": kind, "passed": passed, "note": note})
    loose_json = None
    exact_rule = next((r for r in checks if r["type"] == "json_exact"), None)
    if exact_rule:
        try:
            loose_json = exact_equal(judge_object(text), exact_rule["expected"])
        except (ValueError, TypeError):
            loose_json = False
    return {"checks": outcomes, "all_pass": bool(outcomes) and all(c["passed"] for c in outcomes),
            "diagnostic_loose_json": loose_json,
            "surface_flags": {"possible_thinking_tag": bool(re.search(r"</?think(?:ing)?>", text, re.I))}}
