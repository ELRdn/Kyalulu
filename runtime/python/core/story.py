"""Declarative cast and server-owned RPG actions; never evaluate imported scripts."""
import json
import secrets
from collections import Counter

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CastMember(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    display_name: str = Field(min_length=1, max_length=120)
    personality: str = Field(default="", max_length=2000)
    speaking_style: str = Field(default="", max_length=1000)
    knowledge: str = Field(default="", max_length=2000)
    relationships: str = Field(default="", max_length=2000)


class RuleAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    trigger: str = Field(min_length=1, max_length=120)
    skill: str = Field(default="", max_length=80)
    difficulty: int = Field(default=10, ge=1, le=100)
    hp_delta: int = Field(default=0, ge=-10000, le=10000)
    inventory_add: list[str] = Field(default_factory=list, max_length=20)
    inventory_remove: list[str] = Field(default_factory=list, max_length=20)


class RPGOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    initial_hp: int = Field(default=100, ge=1, le=100000)
    initial_inventory: list[str] = Field(default_factory=list, max_length=100)
    skills: dict[str, int] = Field(default_factory=dict, max_length=50)
    actions: list[RuleAction] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_rules(self):
        if any(not key.strip() or len(key) > 80 or not -20 <= value <= 20 for key, value in self.skills.items()):
            raise ValueError("skills must have bounded names and modifiers (-20..20)")
        if len({a.id for a in self.actions}) != len(self.actions) or len({a.trigger.casefold() for a in self.actions}) != len(self.actions):
            raise ValueError("action IDs and triggers must be unique")
        if any(a.skill and a.skill not in self.skills for a in self.actions):
            raise ValueError("action skill is not declared")
        items = self.initial_inventory + [item for a in self.actions for item in a.inventory_add + a.inventory_remove]
        if any(not isinstance(item, str) or not item.strip() or len(item) > 120 for item in items):
            raise ValueError("inventory names must be nonempty and bounded")
        return self


def configuration(compiled):
    snapshot = compiled.sections.get("portable_snapshot", {})
    world = compiled.sections.get("story") or snapshot.get("world") or {}
    cast = [CastMember.model_validate(member) for member in world.get("cast", [])]
    if len(cast) > 12 or len({member.id for member in cast}) != len(cast):
        raise ValueError("cast must have at most 12 distinct IDs")
    rpg = RPGOptions.model_validate(world["rpg"]) if world.get("rpg") else None
    return cast, rpg


def prepare(compiled, state, messages, generation_id):
    """Determine outcomes once before provider retries; only successful finish persists them."""
    cast, options = configuration(compiled)
    instruction = ""
    if cast:
        instruction += ("\nCast: label each speaker by name; keep their knowledge and relationships separate. "
                        "Never choose the user's thoughts or actions.\n" +
                        json.dumps([c.model_dump() for c in cast], ensure_ascii=False))
    rpg = dict(state.rpg or {})
    if options is None:
        return instruction, rpg
    if not rpg:
        rpg = {"hp": options.initial_hp, "inventory": list(options.initial_inventory),
               "skills": dict(options.skills), "rolls": []}
    latest = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    rolls = list(rpg.get("rolls", []))
    if not any(roll.get("generation_id") == generation_id for roll in rolls):
        for action in options.actions:
            # Explicit trigger only: mentioning or rejecting an action must not mutate state.
            if action.trigger.casefold().strip() != latest.casefold().strip():
                continue
            inventory = list(rpg["inventory"])
            counts = Counter(inventory)
            eligible = all(counts[item] >= count for item, count in Counter(action.inventory_remove).items())
            die = secrets.randbelow(20) + 1 if eligible else None
            modifier = options.skills.get(action.skill, 0)
            success = eligible and die + modifier >= action.difficulty
            roll = {"generation_id": generation_id, "action_id": action.id, "die": die,
                    "modifier": modifier, "difficulty": action.difficulty, "success": success,
                    "reason": "rolled" if eligible else "missing_inventory"}
            if success:
                for item in action.inventory_remove:
                    inventory.remove(item)
                inventory.extend(action.inventory_add)
                if len(inventory) > 100:
                    raise ValueError("RPG inventory capacity exceeded")
                rpg["inventory"] = inventory
                rpg["hp"] = max(0, min(options.initial_hp, rpg["hp"] + action.hp_delta))
            rolls.append(roll)
    rpg["rolls"] = rolls[-20:]
    instruction += ("\nServer-owned RPG outcome: narrate these results; never invent rolls or change HP, "
                    "skills or inventory. Reject actions forbidden by the world rules.\n" +
                    json.dumps(rpg, ensure_ascii=False))
    return instruction, rpg
