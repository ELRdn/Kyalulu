"""Tiny deterministic oracle for explicitly specified, fictional object movements.

Location and custody are distinct; ownership is deliberately not inferred.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timedelta


def replay(events: list[dict]) -> dict:
    state = {"world": {}, "beliefs": {}}
    for event in events:
        if event["op"] != "move":
            raise ValueError(f"Unknown event operation: {event['op']}")
        obj = event["object"]
        fact = {"location": event["location"], "holder": event["holder"]}
        state["world"][obj] = fact
        for who in event.get("observers", []):
            state["beliefs"].setdefault(who, {})[obj] = deepcopy(fact)
    return state


def solve_public_task(task: dict, card: dict) -> dict:
    """Reference oracle and MOCK fixture solver, NOT an LLM evaluator."""
    kind = task["kind"]
    if kind == "identity":
        return {"name": card["name"], "role": card["role"], "first_person": card["speech"]["first_person"]}
    if kind == "state":
        result = replay(task["events"])["world"][task["object"]]
        return {"holder": result["holder"], "location": result["location"]}
    if kind == "belief":
        s = replay(task["events"])
        belief = s["beliefs"].get(card["name"], {}).get(task["object"])
        return {"world_location": s["world"][task["object"]]["location"],
                "character_belief": None if belief is None else belief["location"]}
    if kind == "time":
        dt = datetime.fromisoformat(task["original_local_time"]) + timedelta(minutes=task["delay_minutes"])
        return {"date": dt.date().isoformat(), "time": dt.strftime("%H:%M")}
    raise ValueError(f"Unknown task: {kind}")
