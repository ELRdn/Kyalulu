"""Rejected OpenRouter responses retain operator bills; all traffic is mocked."""

import asyncio
import json
from uuid import uuid4

import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version
from python.cloud.config import CloudConfig
from python.cloud.generation import CloudChat
from python.cloud.store import CloudError, CloudStore
from python.cloud.meter import CostMeter, MeteredProvider, call_bound
from python.cloud.router import OPENROUTER_TARIFFS
from python.providers.openrouter import DEEPSEEK, OpenRouterProvider
from python.storage import db as storage
from python.storage.context import CloudStorageContext, storage_context


def config(tmp_path):
    return CloudConfig(root=tmp_path / "cloud", backup_root=tmp_path / "backups",
        origin="https://cloud.test", secret="s" * 32, private_test=True,
        allowed_emails=("owner@example.test",), signup_limit=1, trial_credits=0,
        monthly_subsidy_jpy=0, test_budget_nano=100_000_000,
        test_prior_cost_nano=49_548_721, inference_enabled=True,
        openrouter_approved=True, openrouter_key="mock-key")


def enroll(app):
    owner = str(uuid4())
    app.state.store.account(owner, consent=provider_consent_version(app.state.store.config))
    app.state.store.admin_grant(owner, 500, "once")
    app.state.auth.save("browser", owner, {"access_token": "fixture",
        "refresh_token": "fixture", "expires_in": 3600})
    return owner


async def run_job(app, owner):
    context = CloudStorageContext.for_owner(app.state.store.config.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        req = CloudChat(model_id="cloud-standard", session_id="synthetic",
            messages=[{"role": "user", "content": "hi"}])
        quote = await app.state.jobs.quote(owner, req)
        req = req.model_copy(update={"quote_id": quote["quote_id"], "max_credits": quote["max_credits"]})
        return req, await (await app.state.jobs.start(owner, req))


def generation_response(text, usage):
    event = {"provider": "InferenceNet", "model": DEEPSEEK,
        "choices": [{"delta": {"content": text}, "finish_reason": "stop"}]}
    if usage is not None:
        event["usage"] = usage
    return httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n")


VALID_OUTPUT = json.dumps({"reply": "hello", "state_update": {
    "location": "park", "time": "day", "mood": "happy", "active_scene": "talking",
    "relationship_state": {"stage": "stranger", "tone": "neutral", "unresolved_conflict": False}}})


def screened_response(cost, *, case="refusal"):
    value = {"model": DEEPSEEK, "provider": "InferenceNet",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cost": cost},
        "choices": [{"finish_reason": "stop", "message": {"content": '{"sfw":true}'}}]}
    if case == "refusal":
        value["choices"][0]["message"]["refusal"] = "synthetic private text"
    elif case == "length":
        value["choices"][0]["finish_reason"] = "length"
    elif case == "missing-content":
        value["choices"][0]["message"].pop("content")
    elif case == "provider":
        value["provider"] = "Unexpected provider"
    elif case == "model":
        value["model"] = "unexpected/model"
    elif case == "bad-counters":
        value["usage"]["prompt_tokens"] = True
    elif case == "bad-cache":
        value["usage"]["prompt_tokens_details"] = {"cached_tokens": "synthetic private text"}
    elif case == "missing-cost":
        value["usage"].pop("cost")
        value["choices"][0]["message"]["refusal"] = "synthetic private text"
    elif case == "bad-json":
        return httpx.Response(200, text="not json")
    return httpx.Response(503 if case == "http-error" else 200, json=value)


@pytest.mark.asyncio
@pytest.mark.parametrize("case,cost", [
    ("refusal", 0.00001), ("refusal", 0.02), ("length", 0.02),
    ("missing-content", 0.02), ("provider", 0.02), ("model", 0.02),
    ("http-error", 0.02), ("bad-counters", 0.02), ("refusal", 0),
    ("bad-counters", 0.00001), ("bad-cache", 0.00001),
])
async def test_rejected_save_keeps_known_bill_zero_credits_and_overrun_stop(tmp_path, case, cost):
    cfg = config(tmp_path)
    calls = []

    def respond(request):
        calls.append(request.url)
        assert request.url == "https://openrouter.ai/api/v1/chat/completions"
        return screened_response(cost, case=case)

    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    bill = 0 if cost == 0 else 10_000 if cost == 0.00001 else 20_000_000
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
        headers={"Origin": cfg.origin}, cookies={SESSION_COOKIE: "browser"}) as client:
        result = await client.post("/api/creator/world", json={"display_name": "Synthetic world"})
        assert result.status_code == 503 and "synthetic private text" not in result.text
        assert len(calls) == 1
        with app.state.store.transaction() as db:
            row = db.execute("SELECT * FROM operations").fetchone()
            assert row["state"] == "failed" and row["charged_credits"] == 0
            assert row["actual_cost"] == bill
            assert db.execute("SELECT COUNT(*) FROM fund_holds").fetchone()[0] == 0
            debt = db.execute("SELECT COALESCE(SUM(amount),0) FROM budget_debt").fetchone()[0]
            assert debt == max(0, bill - row["max_cost"])
        assert app.state.store.balance(owner) == 500
        assert app.state.store.settle(owner, row["id"], 0, success=False)["actual_cost"] == bill
        assert (await client.get("/api/creator/world")).json()["items"] == []
        restarted = CloudStore(cfg)
        assert restarted.private_budget()["available_nano"] == (
            0 if row["review_required"] else 50_451_279 - bill)
        if row["review_required"]:
            denied = await client.post("/api/creator/world", json={"display_name": "Another world"})
            assert denied.status_code == 503 and denied.json()["code"] == "operator_budget_exhausted"
            assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("case,cost", [
    ("missing-cost", None), ("refusal", None), ("refusal", True),
    ("refusal", -0.001), ("refusal", "0.00001"), ("refusal", "NaN"),
    ("refusal", float("inf")), ("refusal", 101), ("bad-json", None),
])
async def test_unverifiable_bill_is_unknown_and_retains_reserved_operator_cost(tmp_path, case, cost):
    app = create_app(config(tmp_path), transport=httpx.MockTransport(
        lambda _: screened_response(cost, case=case)))
    owner = enroll(app)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
        base_url=app.state.store.config.origin, headers={"Origin": app.state.store.config.origin},
        cookies={SESSION_COOKIE: "browser"}) as client:
        assert (await client.post("/api/creator/world",
            json={"display_name": "Synthetic world"})).status_code == 503
    with app.state.store.transaction() as db:
        row = db.execute("SELECT * FROM operations").fetchone()
        assert row["state"] == "failed" and row["charged_credits"] == 0
        assert row["actual_cost"] == row["max_cost"] > 0
    assert app.state.store.balance(owner) == 500


@pytest.mark.asyncio
@pytest.mark.parametrize("case", [
    "refusal", "provider", "model", "bad-json-after-usage", "http-error",
    "disconnect-after-usage", "missing-done", "repeated-usage", "invalid-usage-after-known-bill",
    "cancel-after-usage", "decreasing-usage", "increasing-usage", "upstream-error",
])
async def test_failed_generation_retains_known_stream_bill_once_and_replay_is_free(tmp_path, case):
    cfg = config(tmp_path)
    calls = []
    usage = {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.02}
    metadata = {"provider": "InferenceNet", "model": DEEPSEEK}

    class Disconnect(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield ("data: " + json.dumps({**metadata, "usage": usage, "choices": []}) + "\n\n").encode()
            if case == "cancel-after-usage":
                raise asyncio.CancelledError()
            raise httpx.ReadError("synthetic disconnect")

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload["provider"]["only"] == ["inference-net"]
        assert payload["provider"]["allow_fallbacks"] is False
        if not payload["stream"]:
            return screened_response(0.000003001, case="valid")
        if case == "http-error":
            return screened_response(0.02, case="http-error")
        if case in {"disconnect-after-usage", "cancel-after-usage"}:
            return httpx.Response(200, stream=Disconnect())
        event = {**metadata, "usage": usage, "choices": []}
        if case == "provider":
            event["provider"] = "Unexpected provider"
        elif case == "model":
            event["model"] = "unexpected/model"
        elif case == "upstream-error":
            event["error"] = {"message": "synthetic private text"}
        elif case == "increasing-usage":
            event["usage"] = {**usage, "cost": 0.01}
        wire = "data: " + json.dumps(event) + "\n\n"
        if case == "bad-json-after-usage":
            wire += "data: {broken\n\n"
        elif case == "repeated-usage":
            wire += "data: " + json.dumps(event) + "\n\n"
        elif case == "invalid-usage-after-known-bill":
            wire += 'data: {"usage": {"cost": null}, "choices": []}\n\n'
        elif case in {"decreasing-usage", "increasing-usage"}:
            cost = 0.01 if case == "decreasing-usage" else 0.02
            wire += "data: " + json.dumps({"usage": {**usage, "cost": cost}, "choices": []}) + "\n\n"
        if case not in {"missing-done", "provider", "model", "bad-json-after-usage"}:
            wire += 'data: {"choices":[{"delta":{"refusal":"synthetic private text"}}]}\n\n'
        if case != "missing-done":
            wire += "data: [DONE]\n\n"
        return httpx.Response(200, text=wire)

    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    context = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        req = CloudChat(model_id="cloud-standard", session_id="synthetic",
            messages=[{"role": "user", "content": "hi"}])
        quote = await app.state.jobs.quote(owner, req)
        req = req.model_copy(update={"quote_id": quote["quote_id"], "max_credits": quote["max_credits"]})
        result = await (await app.state.jobs.start(owner, req))
        assert result["status"] == ("cancelled" if case == "cancel-after-usage" else "failed")
        assert result["charged_credits"] == 0
        assert "synthetic private text" not in json.dumps(result)
        assert len(calls) == 2
        with app.state.store.transaction() as db:
            row = db.execute("SELECT * FROM operations WHERE route='cloud-standard'").fetchone()
            assert row["actual_cost"] == 20_003_001
            assert row["state"] == "failed" and row["charged_credits"] == 0
            assert db.execute("SELECT SUM(amount) FROM budget_debt").fetchone()[0] == (
                20_003_001 - row["max_cost"])
            assert db.execute("SELECT COUNT(*) FROM credit_holds").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM fund_holds").fetchone()[0] == 0
        assert app.state.store.balance(owner) == 500
        assert CloudStore(cfg).private_budget()["available_nano"] == 0
        replay = await (await app.state.jobs.start(owner, req))
        assert replay == result and len(calls) == 2
        next_quote = app.state.store.quote(owner, "next", 0, 1, "safety")
        with pytest.raises(CloudError, match="operator_budget_exhausted"):
            app.state.store.reserve(owner, "next", "next", next_quote, 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("final_cost,expected,uncertain", [
    (0.00001, 10_000, False), (0.00002, 20_000, False),
    (0.000005, 10_000, True), (None, None, True),
])
async def test_cumulative_usage_is_not_added_and_unknown_final_retains_reservation(final_cost, expected, uncertain):
    messages = [{"role": "user", "content": "hi"}]
    tariff = OPENROUTER_TARIFFS[DEEPSEEK]
    bound = call_bound(messages, tariff=tariff)
    usage = {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.00001}
    frames = [
        {"provider": "InferenceNet", "model": DEEPSEEK, "usage": usage,
         "choices": [{"delta": {"content": "safe"}, "finish_reason": "stop"}]},
        {"usage": {**usage, "cost": final_cost}, "choices": []},
    ]
    wire = "".join("data: " + json.dumps(frame) + "\n\n" for frame in frames) + "data: [DONE]\n\n"
    provider = OpenRouterProvider(api_key="mock-key", transport=httpx.MockTransport(
        lambda _: httpx.Response(200, text=wire)))
    meter = CostMeter(bound)
    events = [event async for event in MeteredProvider(provider, meter, tariff=tariff).stream_events(
        model=DEEPSEEK, messages=messages)]
    assert sum(event["type"] == "usage" for event in events) == 1
    assert meter.pending is None and meter.uncertain is uncertain
    assert meter.total == (bound if expected is None else expected)


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["cancel", "read-error", "runtime-error"])
async def test_screen_client_exit_failure_retains_received_bill_and_stops_next_operation(tmp_path, fault):
    calls = []
    closing = asyncio.Event()

    class FailingClose(httpx.MockTransport):
        async def aclose(self):
            await super().aclose()
            if fault == "cancel":
                closing.set()
                await asyncio.Event().wait()
            if fault == "read-error":
                raise httpx.ReadError("synthetic private text")
            raise RuntimeError("synthetic private text")

    def respond(request):
        calls.append(request.url)
        return screened_response(0.02, case="valid")

    cfg = config(tmp_path)
    app = create_app(cfg, transport=FailingClose(respond))
    owner = enroll(app)
    if fault == "cancel":
        task = asyncio.create_task(run_job(app, owner))
        await asyncio.wait_for(closing.wait(), 3)
        task.cancel()
        _, result = await task
    else:
        _, result = await run_job(app, owner)
    assert result["status"] == ("cancelled" if fault == "cancel" else "failed")
    assert result["charged_credits"] == 0 and "synthetic private text" not in json.dumps(result)
    assert len(calls) == 1 and app.state.store.balance(owner) == 500
    with app.state.store.transaction() as db:
        row = db.execute("SELECT * FROM operations WHERE route='cloud-standard'").fetchone()
        assert row["actual_cost"] == 20_000_000 and row["charged_credits"] == 0
        assert db.execute("SELECT SUM(amount) FROM budget_debt").fetchone()[0] == 20_000_000 - row["max_cost"]
        assert db.execute("SELECT COUNT(*) FROM fund_holds").fetchone()[0] == 0
    restarted = CloudStore(cfg)
    q = restarted.quote(owner, "next", 0, 1, "safety")
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        restarted.reserve(owner, "next", "next", q, 0)
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["missing-cost", "missing-usage", "bad-counters"])
@pytest.mark.parametrize("valid_schema", [True, False])
async def test_uncertain_generation_stops_schema_repairs_and_output_safety(tmp_path, fault, valid_schema):
    calls = []

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if not payload["stream"]:
            return screened_response(0.000003001, case="valid")
        usage = {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.00001}
        if fault == "missing-cost":
            usage.pop("cost")
        elif fault == "missing-usage":
            usage = None
        else:
            usage["prompt_tokens"] = True
        # Without the accounting stop, two invalid schemas repair successfully
        # on attempt three and then send an unnecessary output safety request.
        repaired = sum(call["stream"] for call in calls) == 3
        return generation_response(VALID_OUTPUT if valid_schema or repaired else '{"reply":"invalid"}', usage)

    app = create_app(config(tmp_path), transport=httpx.MockTransport(respond))
    owner = enroll(app)
    _, result = await run_job(app, owner)
    assert result["status"] == "failed" and result["charged_credits"] == 0
    assert len(calls) == 2 and [payload["stream"] for payload in calls] == [False, True]
    with app.state.store.transaction() as db:
        row = db.execute("SELECT * FROM operations WHERE route='cloud-standard'").fetchone()
        assert row["state"] == "failed" and row["charged_credits"] == 0
        assert row["review_required"] == 1
        assert 3001 < row["actual_cost"] < row["max_cost"]
        if fault == "bad-counters":
            assert row["actual_cost"] == 13_001
        assert db.execute("SELECT COUNT(*) FROM credit_holds").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM fund_holds").fetchone()[0] == 0
    assert app.state.store.balance(owner) == 500
    restarted = CloudStore(app.state.store.config)
    q = restarted.quote(owner, "next", 0, 1, "safety")
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        restarted.reserve(owner, "next", "next", q, 0)


@pytest.mark.asyncio
async def test_single_call_overrun_within_operation_reservation_persists_stop_without_fake_debt(tmp_path):
    calls = []

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if not payload["stream"]:
            return screened_response(0.000003001, case="valid")
        return generation_response(VALID_OUTPUT,
            {"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001})

    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    req, result = await run_job(app, owner)
    assert result["status"] == "failed" and result["charged_credits"] == 0 and len(calls) == 2
    with app.state.store.transaction() as db:
        row = db.execute("SELECT * FROM operations WHERE route='cloud-standard'").fetchone()
        assert row["actual_cost"] == 1_003_001 < row["max_cost"]
        assert db.execute("SELECT COALESCE(SUM(amount),0) FROM budget_debt").fetchone()[0] == 0
        assert row["review_required"] == 1
        assert db.execute("SELECT COUNT(*) FROM budget_debt").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM fund_holds").fetchone()[0] == 0
    assert app.state.store.balance(owner) == 500
    restarted = CloudStore(cfg)
    assert restarted.private_budget()["available_nano"] == 0
    assert restarted.settle(owner, req.generation_id, 0, success=False)["actual_cost"] == 1_003_001
    q = restarted.quote(owner, "next", 0, 1, "safety")
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        restarted.reserve(owner, "next", "next", q, 0)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
        headers={"Origin": cfg.origin}, cookies={SESSION_COOKIE: "browser"}) as client:
        denied = await client.post("/api/creator/world", json={"display_name": "Another world"})
        assert denied.status_code == 503 and denied.json()["code"] == "operator_budget_exhausted"
    assert len(calls) == 2
