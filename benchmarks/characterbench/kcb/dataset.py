from __future__ import annotations
from collections import Counter
from pathlib import Path
from .util import ROOT, KCBError, digest, load_json, read_jsonl

DIMENSIONS = {"preference", "persona", "agency", "style", "robustness", "emotion", "japanese", "continuity"}
CHECK_TYPES = {"nonempty", "max_chars", "no_headings", "contains", "json_exact"}


def load_dataset(directory: str | Path | None = None) -> dict:
    base = Path(directory) if directory else ROOT / "data"
    cards = load_json(base / "characters.json")
    units = read_jsonl(base / "cases.jsonl")
    if not isinstance(cards, list) or not cards or not units:
        raise KCBError("Dataset must have nonempty characters and cases")
    by_id = {}
    for card in cards:
        if not isinstance(card, dict) or not isinstance(card.get("id"), str) or not card.get("id"):
            raise KCBError("Every character needs a string id")
        if card["id"] in by_id:
            raise KCBError(f"Duplicate character: {card['id']}")
        for field in ("name", "role", "speech", "traits", "behavior_range"):
            if field not in card:
                raise KCBError(f"Character {card['id']} missing {field}")
        by_id[card["id"]] = card
    ids = set()
    for unit in units:
        uid = unit.get("id")
        if not isinstance(uid, str) or not uid or uid in ids:
            raise KCBError(f"Missing/duplicate unit id: {uid}")
        ids.add(uid)
        if unit.get("character_id") not in by_id:
            raise KCBError(f"Unknown character in {uid}")
        if unit.get("mode") not in ("diagnostic", "natural", "dialogue"):
            raise KCBError(f"Unknown mode in {uid}")
        if not isinstance(unit.get("family"), str) or not unit["family"]:
            raise KCBError(f"Missing family in {uid}")
        turns = unit.get("turns")
        if not isinstance(turns, list) or not turns:
            raise KCBError(f"No turns in {uid}")
        if unit["mode"] != "dialogue" and len(turns) != 1:
            raise KCBError(f"Single-turn unit has multiple turns: {uid}")
        for turn in turns:
            if not isinstance(turn.get("user"), str) or not turn["user"].strip():
                raise KCBError(f"Empty user message: {uid}")
            ev = turn.get("eval", {})
            if not isinstance(ev.get("checks"), list) or not ev["checks"]:
                raise KCBError(f"Missing checks in {uid}")
            if not set(ev.get("dimensions", [])).issubset(DIMENSIONS):
                raise KCBError(f"Unknown rubric dimension in {uid}")
            for c in ev["checks"]:
                if c.get("type") not in CHECK_TYPES:
                    raise KCBError(f"Unknown checker in {uid}: {c}")
                if c["type"] == "max_chars" and (type(c.get("value")) is not int or c["value"] <= 0):
                    raise KCBError(f"Invalid max_chars in {uid}")
                if c["type"] == "contains" and (not isinstance(c.get("value"), str) or not c["value"]):
                    raise KCBError(f"Invalid literal in {uid}")
                if c["type"] == "json_exact" and not isinstance(c.get("expected"), dict):
                    raise KCBError(f"Invalid JSON oracle in {uid}")
            if unit["mode"] == "diagnostic" and not any(c["type"] == "json_exact" for c in ev["checks"]):
                raise KCBError(f"Diagnostic requires an oracle: {uid}")
            if unit["mode"] != "diagnostic" and not ev.get("dimensions"):
                raise KCBError(f"Natural text requires rubric dimensions: {uid}")
    return {"characters": by_id, "units": units, "hash": digest({"characters": cards, "units": units}), "path": str(base)}


def select_units(data: dict, suite: str) -> list[dict]:
    units = data["units"]
    if suite == "all":
        # The runner may shuffle its selection, never the hashed source corpus.
        return list(units)
    if suite == "single":
        return [u for u in units if u["mode"] != "dialogue"]
    if suite == "dialogue":
        return [u for u in units if u["mode"] == "dialogue"]
    if suite == "diagnostic":
        return [u for u in units if u["mode"] == "diagnostic"]
    if suite == "natural":
        return [u for u in units if u["mode"] != "diagnostic"]
    if suite == "smoke":
        families = sorted({u["family"] for u in units if u["mode"] != "dialogue"})
        selected = []
        for n, family in enumerate(families):
            candidates = [u for u in units if u["family"] == family]
            selected.append(candidates[n % len(candidates)])
        selected += next(([u] for u in units if u["mode"] == "dialogue"), [])
        return selected
    raise KCBError(f"Unknown suite: {suite}")


def overview(data: dict) -> dict:
    return {"characters": len(data["characters"]), "units": len(data["units"]),
            "generations_per_repeat": sum(len(u["turns"]) for u in data["units"]),
            "modes": dict(Counter(u["mode"] for u in data["units"])),
            "families": dict(Counter(u["family"] for u in data["units"])),
            "dataset_sha256": data["hash"], "status": "synthetic_public_pilot_not_human_validated"}
