"""The live verification utility cannot silently spend past its saved budget."""

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("live_smoke", Path(__file__).parents[1] / "scripts/verify_openrouter_live.py")
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


def payload():
    return {"model": "fixture", "messages": [{"role": "user", "content": "hello"}],
            "max_tokens": 768, "provider": {"only": ["fixed-provider"]}}


def test_insufficient_budget_prevents_a_request(tmp_path):
    run = smoke.Run(tmp_path, "unique-test-secret", smoke.Decimal("0.000001"))
    with pytest.raises(RuntimeError, match="smoke_budget_exhausted"):
        run.reserve(payload(), ("0.1", "0.2"), "test")
    assert not run.data["requests"]


def test_unknown_cost_and_pending_requests_survive_restarts(tmp_path):
    run = smoke.Run(tmp_path, "unique-test-secret", smoke.Decimal("0.02"))
    record = run.reserve(payload(), ("0.1", "0.2"), "test")
    run.finish(record, {"status": "passed", "usage": {}})
    reloaded = smoke.Run(tmp_path, "unique-test-secret", smoke.Decimal("0.02"))
    assert reloaded.data["requests"][0]["status"] == "failed"
    assert reloaded.data["accounted_cost_usd"] == record["reserved_usd"]
    pending = reloaded.reserve(payload(), ("0.1", "0.2"), "interrupted")
    latest = smoke.Run(tmp_path, "unique-test-secret", smoke.Decimal("0.02"))
    assert latest.data["requests"][-1]["reserved_usd"] == pending["reserved_usd"]


def test_overrun_halts_future_spending(tmp_path):
    run = smoke.Run(tmp_path, "unique-test-secret", smoke.Decimal("0.02"))
    record = run.reserve(payload(), ("0.1", "0.2"), "test")
    run.finish(record, {"status": "passed", "usage": {"cost": smoke.Decimal("0.03")}})
    assert run.data["accounted_cost_usd"] == "0.03"
    with pytest.raises(RuntimeError, match="smoke_budget_exhausted"):
        run.reserve(payload(), ("0.1", "0.2"), "another")


def test_secret_cannot_be_written_to_evidence(tmp_path):
    run = smoke.Run(tmp_path, "unique-test-secret", smoke.Decimal("0.02"))
    run.data["accidental_echo"] = "unique-test-secret"
    with pytest.raises(RuntimeError, match="secret_in_evidence"):
        run.save()
    assert not (tmp_path / "evidence.json").exists()


def test_reasoning_diagnostics_do_not_retain_thinking_text():
    fixture = {"reasoning": "private-thinking-fixture", "reasoning_details": [
        {"type": "reasoning.encrypted", "data": "opaque-signature"}]}
    result = smoke.reasoning_observation(fixture)
    assert result["reasoning_text_returned"]
    assert result["reasoning_detail_types"] == ["reasoning.encrypted"]
    assert "private-thinking-fixture" not in str(result)
    encrypted_only = smoke.reasoning_observation({"reasoning_details": fixture["reasoning_details"]})
    assert not encrypted_only["reasoning_text_returned"]
