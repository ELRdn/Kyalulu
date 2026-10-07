"""Paid evaluation safeguards and production resilience without network spending."""

from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import sys

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
spec = importlib.util.spec_from_file_location("quality", Path(__file__).parents[1] / "scripts/verify_openrouter_quality.py")
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)

from python.cloud.meter import CostMeter
from python.cloud.router import OPENROUTER_TARIFFS
from python.cloud.safety import SafetyGuard
from python.cloud.store import CloudError
from python.core.generation import generate_events
from python.core.schemas import CompiledPrompt, RuntimeState
from python.providers.openrouter import DEEPSEEK, OpenRouterProvider


def run_fixture(tmp_path, monkeypatch, budget="0.05"):
    monkeypatch.setattr(quality, "ROOT", tmp_path)
    # Fingerprinting uses the repository paths too; provide only those fixture files.
    for relative in ("scripts/openrouter_quality_fixtures.py", "scripts/verify_openrouter_quality.py",
                     "runtime/python/core/memory.py", "runtime/python/storage/memories.py"):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("fixture", encoding="utf-8")
    prior = tmp_path / "prior.json"
    prior.write_text(json.dumps({"requests": [{"reserved_usd": "0.004", "actual_cost_usd": "0.001"},
                                             {"reserved_usd": "0.002"}]}), encoding="utf-8")
    return quality.QualityRun(tmp_path / "out", "unique-quality-secret", Decimal(budget), prior)


def test_campaign_counts_prior_pending_reservations(tmp_path, monkeypatch):
    run = run_fixture(tmp_path, monkeypatch, "0.0031")
    assert run.prior_cost == Decimal("0.003")
    payload = quality.payload_for(quality.PROFILES[0], [{"role": "user", "content": "hi"}])
    with pytest.raises(RuntimeError, match="smoke_budget_exhausted"):
        run.reserve(payload, quality.PROFILES[0][4:6], "new")
    assert not run.data["requests"]


def test_large_image_reservation_is_not_base64_tokenization(tmp_path, monkeypatch):
    run = run_fixture(tmp_path, monkeypatch)
    raw = quality.image_cases()[0][1][0]
    block = quality.image_block(raw, "image/png")
    payload = quality.payload_for(quality.PROFILES[0], [{"role": "user", "content": [block]}])
    record = run.reserve(payload, quality.PROFILES[0][4:6], "image")
    assert record["input_token_bound"] >= 65536
    assert Decimal(record["reserved_usd"]) < Decimal("0.005")
    with pytest.raises(RuntimeError, match="duplicate_request_label"):
        run.reserve(payload, quality.PROFILES[0][4:6], "image")


@pytest.mark.asyncio
async def test_failed_call_is_not_repeated_or_fallbacked(tmp_path, monkeypatch):
    run = run_fixture(tmp_path, monkeypatch)
    calls = []
    def fail(request):
        calls.append(request)
        return httpx.Response(429, json={"error": {"message": "rate limit"}})
    async with httpx.AsyncClient(transport=httpx.MockTransport(fail)) as client:
        profile = quality.PROFILES[0]
        args = (run, client, profile, "fixture", [{"role": "user", "content": "hi"}], {"phase": "safety"})
        record = await quality.request(*args, expected={"sfw": True})
        assert record["status"] == "failed" and record["cost_unknown"]
        await quality.request(*args, expected={"sfw": True})
        skipped = await quality.request(run, client, profile, "other", args[4], args[5])
        assert skipped["status"] == "skipped"
    assert len(calls) == 1


def test_fixture_resume_rejects_changed_inputs(tmp_path, monkeypatch):
    run = run_fixture(tmp_path, monkeypatch)
    run.save()
    path = tmp_path / "scripts/openrouter_quality_fixtures.py"
    path.write_text("changed", encoding="utf-8")
    with pytest.raises(RuntimeError, match="fixture_or_harness_changed"):
        quality.QualityRun(run.directory, run.key, Decimal("0.05"), tmp_path / "prior.json")


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["429", "503", "price-rejected", "timeout", "disconnect", "mid-stream"])
async def test_production_transport_failures_do_not_retry(fault):
    calls = []
    def fail(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if fault == "timeout":
            raise httpx.ReadTimeout("private-body", request=request)
        if fault == "disconnect":
            raise httpx.ReadError("private-body", request=request)
        if fault == "mid-stream":
            event = {"provider": "InferenceNet", "model": DEEPSEEK,
                     "choices": [{"delta": {"content": '{"reply":"hello'}, "finish_reason": None}]}
            return httpx.Response(200, text="data: " + json.dumps(event) + "\n\n")
        return httpx.Response(422 if fault == "price-rejected" else int(fault), json={"error": {"message": "private-body"}})
    provider = OpenRouterProvider(api_key="mock-secret", transport=httpx.MockTransport(fail))
    events = [e async for e in generate_events(provider, model=DEEPSEEK,
        messages=[{"role": "user", "content": "hello"}], compiled=CompiledPrompt(system_prompt="fixture"),
        state=RuntimeState(), requested={"max_tokens": 256})]
    result = events[-1]["result"]
    assert result["status"] == "failed" and result["reply"] == ""
    assert len(calls) == 1
    # Check outside the transport: generate_events deliberately sanitizes all
    # provider exceptions, including a stale assertion inside a mock callback.
    assert calls[0]["provider"]["only"] == ["inference-net"]
    assert calls[0]["provider"]["allow_fallbacks"] is False
    assert calls[0]["provider"]["max_price"] == {"prompt": 0.02, "completion": 0.45}
    expected_error = {"timeout": "ReadTimeout", "disconnect": "ReadError"}.get(fault, "RuntimeError")
    assert result["error"].startswith(expected_error)
    assert "private-body" not in result["error"] and "mock-secret" not in result["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("eventually_valid", [True, False])
async def test_schema_repairs_stop_at_three_and_keep_every_cost(eventually_valid):
    calls = []
    correct = {"reply": "hello", "state_update": {"location": "library", "time": "evening", "mood": "calm",
        "active_scene": "greeting", "relationship_state": {"stage": "acquaintance", "tone": "warm", "unresolved_conflict": False}}}
    def respond(request):
        calls.append(json.loads(request.content))
        text = json.dumps(correct) if eventually_valid and len(calls) == 3 else '{"reply":"invalid"}'
        event = {"provider": "InferenceNet", "model": DEEPSEEK,
                 "choices": [{"delta": {"content": text}, "finish_reason": "stop"}],
                 "usage": {"prompt_tokens": 50, "completion_tokens": 20, "cost": 0.00001}}
        return httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n")
    provider = OpenRouterProvider(api_key="mock-secret", transport=httpx.MockTransport(respond))
    events = [e async for e in generate_events(provider, model=DEEPSEEK,
        messages=[{"role": "user", "content": "hello"}], compiled=CompiledPrompt(system_prompt="fixture"),
        state=RuntimeState(), requested={"max_tokens": 256})]
    result = events[-1]["result"]
    assert result["status"] == ("completed" if eventually_valid else "invalid")
    assert len(calls) == len(result["attempts"]) == 3
    assert sum(Decimal(a["usage"]["cost_usd"]) for a in result["attempts"]) == Decimal("0.00003")
    assert result["validation"]["retries"] == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("decision", [{"sfw": True, "extra": "bypass"}, {"sfw": "true"}, {}, {"sfw": False}])
async def test_safety_ambiguous_or_extra_decisions_fail_closed(decision):
    class Provider:
        async def screen_json(self, messages, schema, output):
            return json.dumps(decision), {"prompt_tokens": 10, "completion_tokens": 3, "cost_usd": "0.00001"}
    meter = CostMeter(1_000_000)
    with pytest.raises(CloudError):
        await SafetyGuard(Provider(), tariff=OPENROUTER_TARIFFS[DEEPSEEK]).check({"text": "fixture"}, meter=meter)
    assert meter.total == 10_000 and not meter.uncertain


def test_fixtures_use_multiple_repetitions_and_mark_history_reset():
    first = quality.conversation("ja", 1)
    second = quality.conversation("ja", 2)
    assert len(first) == 20 and first[15]["new_session"]
    assert first[0]["user"] != second[0]["user"]
    assert len(quality.image_cases()[1][1]) == 4


@pytest.mark.asyncio
async def test_full_schema_control_resets_history_but_retrieves_actual_saved_memory(tmp_path, monkeypatch):
    import verify_openrouter_quality_controls as controls
    from python.storage import db
    from python.storage.context import storage_context
    run = run_fixture(tmp_path, monkeypatch)
    seen = []
    async def fake_request(run, client, profile, label, messages, metadata):
        assert '"$defs"' in messages[0]["content"]  # Full Pydantic response contract, not just state.
        seen.append((metadata["turn"], messages, metadata))
        output = {"reply": "fixture", "state_update": metadata["state_before"], "memory_proposals": (
            [{"type": "semantic", "content": "葵は真鍮の羅針盤をなくした。"}] if metadata["turn"] == 1 else [])}
        record = {"label": label, **metadata, "status": "passed", "reply": output["reply"], "parsed_output": output}
        run.data["requests"].append(record)
        return record
    monkeypatch.setattr(controls.quality, "request", fake_request)
    with storage_context(run.context):
        await db.init_db()
        await controls.strict_dialogue(run, None, quality.PROFILES[0], "ja", 1)
    before, after = seen[14], seen[15]
    assert len(before[1]) > 20 and len(after[1]) == 2
    assert "真鍮の羅針盤" in after[2]["memory_block"]
    assert after[2]["state_before"]["active_scene"] == "greeting"
    assert after[2]["memory_trace"]["stored_count"] >= 1


def test_human_review_preserves_raw_content_and_escapes_embedded_html(tmp_path):
    import render_openrouter_review as renderer
    text = 'original </script><script>alert("fixture")</script>'
    evidence = tmp_path / "evidence.json"
    evidence.write_text(json.dumps({"storage_owner": "fixture-owner", "requests": [
        {"label": "x", "candidate": "ling", "phase": "conversation", "status": "passed", "output": text, "reply": text}]}), encoding="utf-8")
    renderer.render(evidence)
    html = (tmp_path / "human-review.html").read_text(encoding="utf-8")
    embedded = html.split('<script id="evidence" type="application/json">', 1)[1].split('</script>', 1)[0]
    assert "<script>" not in embedded
    assert json.loads(embedded)["rows"][0]["reply"] == text


@pytest.mark.asyncio
@pytest.mark.parametrize("failure,attempt_count,expected_calls", [("ValidationError", 1, 2), ("http_429", 1, 0), ("ValidationError", 3, 0)])
async def test_live_repair_pattern_only_retries_schema_errors_within_total_limit(tmp_path, monkeypatch, failure, attempt_count, expected_calls):
    import verify_openrouter_quality_repairs as repairs
    run = run_fixture(tmp_path, monkeypatch)
    base = "strict-dialogue:ling:ja:r1:t01"
    original = {"label": base, "status": "failed", "error": failure, "finish_reason": "stop", "output": "{}"}
    run.data["requests"].append(original)
    for number in range(2, attempt_count + 1):
        run.data["requests"].append({**original, "label": base + f":repair-{number}", "retry_of": base})
    calls = []
    async def prepare(scope, query):
        return {"block": "", "trace": {"scope": scope}}
    async def fail_again(run, client, profile, label, messages, metadata):
        calls.append(messages)
        assert "Previous output failed validation" in messages[0]["content"]
        record = {**original, **metadata, "label": label}
        run.data["requests"].append(record)
        return record
    monkeypatch.setattr(repairs.memories, "prepare", prepare)
    monkeypatch.setattr(repairs.quality, "request", fail_again)
    await repairs.repair_dialogue(run, None, quality.PROFILES[0], "ja", 1)
    assert len(calls) == expected_calls
    assert run.data["requests"][0] == original
    assert not any(r.get("memory_committed") for r in run.data["requests"])


def test_summary_counts_repaired_turn_once_and_keeps_failed_cost_and_unknown_reserve(tmp_path):
    import summarize_openrouter_quality as summary
    base = {"candidate": "glm", "phase": "conversation", "contract": "full-schema-v2", "language": "ja", "repetition": 1,
            "turn": 1, "reserved_usd": "0.003", "actual_cost_usd": "0.001"}
    rows = [dict(base, label="original", status="failed", error="ValidationError"),
            dict(base, label="repair", status="passed", retry_of="original", keyword_probe_passed=True),
            {**base, "label": "interrupted", "turn": 2, "status": "failed", "error": "timeout"}]
    rows[2].pop("actual_cost_usd")
    path = tmp_path / "evidence.json"
    path.write_text(json.dumps({"requests": rows, "prior_cost_usd": "0.001", "budget_usd": "0.01"}), encoding="utf-8")
    result = summary.summarize(path)
    assert Decimal(result["cumulative_actual_usd"]) == Decimal("0.003")
    assert Decimal(result["cumulative_accounted_usd"]) == Decimal("0.006")
    conversation = result["candidates"]["glm"]["conversations"][0]
    assert conversation["validated_turns"] == conversation["repairs"] == 1
    assert not conversation["complete_20_turns"]
    assert result["human_review"] == "pending"
