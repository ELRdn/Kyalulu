"""Shared device decisions against real Python commit and temporary SQLite storage."""
import json
from pathlib import Path

import aiosqlite
import pytest

from python.core import memory as logic
from python.storage import db, memories

FIXTURE = json.loads((Path(__file__).parent / "fixtures/unified-memory-provenance.json").read_text(encoding="utf-8"))


@pytest.mark.asyncio
@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
async def test_memory_commit_provenance(case, tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "memory.db")
    scope = "session:provenance"
    for item in case["existing"]:
        await memories.create(scope, item["type"], item["content"], origin=item["origin"],
                              supported=item["supported"], source_kind=item["source_kind"])
        if item["confirmation"] == "user_confirmed":
            # Match a user-confirmed unsupported row without changing its source kind/content.
            async with aiosqlite.connect(db.DB_PATH) as connection:
                await connection.execute("UPDATE memories SET confirmation=? WHERE scope=? AND content=?",
                                         (item["confirmation"], scope, item["content"]))
                await connection.commit()
    before = await memories.list_memories(scope)
    result = {"status": "completed", "reply": case["reply"],
              "memory": {"proposals": case["proposals"], "candidates": [], "injected": [], "injected_tokens": 0}}
    await memories.commit(scope, result, session_id="provenance", turn=7,
                          evidence_text=case["user_text"], source_revision=case["source_revision"])
    decisions = result["memory"]["decisions"]
    assert [{key: value for key, value in decision.items() if key != "memory_id"}
            for decision in decisions] == case["expected"]
    after = await memories.list_memories(scope)
    assert after[:len(before)] == before
    created = after[len(before):]
    expected = [decision for decision in case["expected"] if decision["action"] == "store"]
    assert len(created) == len(expected)
    assert [item["id"] for item in created] == [d["memory_id"] for d in decisions if d["action"] == "store"]
    for item, decision in zip(created, expected):
        assert {key: item[key] for key in decision if key != "action"} == {
            key: value for key, value in decision.items() if key != "action"}
        assert item["origin"] == "model"
        assert item["source_message_ids"] == []


@pytest.mark.parametrize("case", FIXTURE["evidence"], ids=lambda case: case["name"])
def test_reply_evidenced(case):
    assert logic.evidenced(case["content"], case["reply"]) is case["expected"]


@pytest.mark.parametrize("case", FIXTURE["render"], ids=lambda case: case["name"])
def test_memory_block_sources(case):
    assert logic.render_block(case["memories"]) == case["expected"]
