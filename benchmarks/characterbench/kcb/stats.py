from __future__ import annotations
import math
import random
from statistics import mean
from collections import defaultdict


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    s = sorted(values)
    position = (len(s) - 1) * q
    lo, hi = int(math.floor(position)), int(math.ceil(position))
    return s[lo] + (s[hi] - s[lo]) * (position - lo)


def cluster_estimate(pairs: list[tuple[str, float]], iterations: int = 2000, seed: int = 20260927) -> dict:
    """Equal-weight macro mean across character clusters; repeated turns are not n."""
    groups = defaultdict(list)
    for cluster, value in pairs:
        groups[cluster].append(value)
    values = [mean(group) for group in groups.values()]
    if not values:
        return {"mean": None, "ci95": None, "clusters": 0, "observations": 0}
    point = mean(values)
    ci = None
    if len(values) >= 2:
        rng = random.Random(seed)
        samples = [mean(rng.choices(values, k=len(values))) for _ in range(iterations)]
        ci = [percentile(samples, 0.025), percentile(samples, 0.975)]
    return {"mean": point, "ci95": ci, "clusters": len(values), "observations": len(pairs),
            "method": "percentile bootstrap of character-cluster means",
            "warning": "Pilot interval conditional on these templates; correlated families and only 12 characters limit generalization."}


def diagnostic_macro(rows: list[dict], cluster_field: str = "character_id") -> dict:
    # First average repetitions within a character/family cell, then equally weight families per cluster.
    cells = defaultdict(list)
    for row in rows:
        if row["mode"] == "diagnostic":
            cells[(row[cluster_field], row["family"])].append(float(row["status"] == "ok" and row["evaluation"]["all_pass"]))
    values = defaultdict(list)
    for (cluster, _), cell in cells.items():
        values[cluster].append(mean(cell))
    return cluster_estimate([(cluster, mean(v)) for cluster, v in values.items()])
