"""Research memory grounding through a synthetic provider and isolated SQLite."""
from copy import deepcopy
import json

import pytest

from python.core import experiment
from python.core.schemas import CompiledPrompt, ScenarioCard
from python.providers.mock import MockProvider
from python.storage import memories


@pytest.mark.asyncio
async def test_research_binds_only_current_user_evidence_and_keeps_history_and_scope(isolated, monkeypatch):
    prior = "サーモンのお寿司が好きです。"
    current = "猫を三匹飼っています。"
    resumed = "紅茶が好きです。"
    scenario = ScenarioCard(id="fictional-user-evidence", turns=[
        {"turn": 1, "user": prior},
        {"turn": 2, "user": current, "expect_recall": ["サーモン"]},
        {"turn": 3, "user": resumed, "new_session": True, "expect_recall": ["猫"]},
    ])

    class SyntheticProvider(MockProvider):
        def __init__(self):
            self.messages = []

        async def stream_events(self, prompt="", **kwargs):
            self.messages.append(deepcopy(kwargs["messages"]))
            assert "memory_proposals" in kwargs["response_schema"]["properties"]
            index = len(self.messages) - 1
            proposals = ([], [current, prior], [resumed])[index]
            output = {"reply": f"Fictional reply {index + 1}.", "state_update": {
                "location": "library", "time": "day", "mood": "calm", "active_scene": "chat",
                "relationship_state": {"stage": "friend", "tone": "warm", "unresolved_conflict": False}},
                "memory_proposals": [{"type": "semantic", "content": value, "source_kind": "user_statement"}
                                     for value in proposals]}
            yield {"type": "delta", "text": json.dumps(output, ensure_ascii=False)}
            yield {"type": "usage", "usage": {"completion_tokens": 1}}

    provider = SyntheticProvider()
    monkeypatch.setattr(experiment, "_resolve_model_cfg", lambda model_id: {
        "id": model_id, "provider": {"type": "mock", "model": "fictional-user-evidence"}})
    monkeypatch.setattr(experiment, "get_provider_for_model", lambda cfg: provider)
    meta, turns, _ = await experiment.run_single(scenario, "fictional-user-evidence", memory=True,
        compiled_snapshot=CompiledPrompt(system_prompt="Fictional research prompt").model_dump())

    assert meta.status == "completed" and meta.memory_enabled and not meta.official
    assert meta.scenario_snapshot == scenario.model_dump()
    assert len(provider.messages) == len(turns) == 3
    assert all(turn["validation"]["ok"] and turn["validation"]["retries"] == 0 for turn in turns)
    assert [[m["content"] for m in messages if m["role"] == "user"] for messages in provider.messages] == [
        [prior], [prior, current], [resumed]]
    assert [m["content"] for m in provider.messages[1] if m["role"] == "assistant"] == ["Fictional reply 1."]
    assert turns[1]["probe"]["in_context"] is True and turns[2]["probe"]["in_context"] is False
    assert [turn["state"]["turn"] for turn in turns] == [1, 2, 1]
    session = turns[1]["state"]["session_id"]
    assert turns[0]["state"]["session_id"] == session != turns[2]["state"]["session_id"]

    exact, unsupported = turns[1]["memory"]["decisions"]
    assert [d["action"] for d in (exact, unsupported)] == ["store", "store"]
    assert [d["supported"] for d in (exact, unsupported)] == [True, False]
    assert [d["source_quote"] for d in (exact, unsupported)] == [current, current]
    scope = "exp:" + meta.experiment_id
    rows = await memories.list_memories(scope)
    assert len(rows) == 3 and {m["scope"] for m in rows} == {scope}
    for row, decision in zip(rows[:2], (exact, unsupported)):
        assert row["id"] == decision["memory_id"] and row["content"] == decision["content"]
        assert row["supported"] is decision["supported"] and row["source_quote"] == current
        assert row["source_session_id"] == session and row["source_turn"] == 2
        assert row["source_generation_id"] == turns[1]["generation_id"]
        assert row["source_kind"] == "user_statement" and row["confirmation"] == "unverified"
        assert row["source_message_ids"] == [] and row["source_revision"] is None
    assert turns[2]["memory"]["scope"] == scope
    assert turns[2]["memory"]["injected"] == [exact["memory_id"]]
    assert next(c for c in turns[2]["memory"]["candidates"] if c["id"] == unsupported["memory_id"])["decision"] == "unverified"
    assert rows[2]["supported"] is True and rows[2]["source_quote"] == resumed
    assert rows[2]["source_session_id"] == turns[2]["state"]["session_id"] and rows[2]["source_turn"] == 3
    saved = experiment.EXPERIMENTS_DIR / meta.experiment_id
    assert json.loads((saved / "meta.json").read_text(encoding="utf-8")) == meta.model_dump()
    assert json.loads((saved / "turns.json").read_text(encoding="utf-8")) == turns
