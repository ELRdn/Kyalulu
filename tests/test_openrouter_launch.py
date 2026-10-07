"""Initial OpenRouter, rollout and billing-access tests. All network I/O mocked."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from decimal import Decimal
import json
import time
from uuid import uuid4
import httpx
import pytest
from python.cloud.app import create_app
from python.cloud.auth import provider_consent_version
from python.cloud.config import CloudConfig
from python.cloud.contracts import TARIFF
from python.cloud.generation import CloudChat
from python.cloud.meter import CostMeter
from python.cloud.router import (backend_block, OPENROUTER_TARIFFS,
                                 public_route, require_current_consent)
from python.cloud.store import CloudStore, CloudError
from python.cloud.backups import Backups
from python.cloud.contracts import PlanEntitlements
from python.providers.openrouter import OpenRouterProvider, DEEPSEEK, MIMO, billed_nano
from python.storage.context import CloudStorageContext, storage_context
from python.storage import db as storage


def config(tmp_path, **kwargs):
    return replace(CloudConfig(root=tmp_path / "cloud", backup_root=tmp_path / "backups",
        origin="https://cloud.test", secret="s" * 32, operator_backend="openrouter",
        openrouter_key="mock-key", inference_enabled=True, openrouter_approved=True), **kwargs)


def test_initial_backend_defaults_to_openrouter_and_stays_closed(tmp_path, monkeypatch):
    for key, value in {"KYALULU_CLOUD_MODE": "1", "KYALULU_CLOUD_DATA_DIR": str(tmp_path),
                       "KYALULU_CLOUD_ORIGIN": "https://cloud.test", "KYALULU_CLOUD_SECRET": "s" * 32}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("KYALULU_OPERATOR_BACKEND", raising=False)
    monkeypatch.delenv("KYALULU_OPENROUTER_APPROVED", raising=False)
    cfg = CloudConfig.from_env()
    assert cfg.operator_backend == "openrouter"
    assert CloudConfig(root=tmp_path, origin=cfg.origin, secret=cfg.secret).operator_backend == "openrouter"
    assert backend_block(cfg) == "openrouter_not_accepted"
    route = public_route(cfg)
    assert route["provider"] == "openrouter" and route["upstream"] == "InferenceNet"
    assert not route["available"] and not route["contributor_available"]


def response(payload, text, *, cost="0.0000030001"):
    metadata = {"model": payload["model"], "provider": "InferenceNet"}
    usage = {"prompt_tokens": 30, "completion_tokens": 5, "cost": Decimal(cost)}
    # Manual decimal serialization keeps the upstream digits intact.
    encoded = json.dumps({k: v for k, v in usage.items() if k != "cost"})[:-1] + ', "cost": ' + cost + '}'
    if not payload["stream"]:
        value = {**metadata, "choices": [{"finish_reason": "stop", "message": {"content": text}}]}
        return httpx.Response(200, text=json.dumps(value)[:-1] + ', "usage": ' + encoded + '}')
    events = [{**metadata, "choices": [{"delta": {"content": text}, "finish_reason": "stop"}]}]
    wire = "".join("data: " + json.dumps(e) + "\n\n" for e in events)
    return httpx.Response(200, text=wire + 'data: {"choices": [], "usage": ' + encoded + '}\n\ndata: [DONE]\n\n')


@pytest.mark.parametrize("model", [DEEPSEEK])
@pytest.mark.asyncio
async def test_pinned_route_and_actual_decimal_cost(tmp_path, model):
    def respond(request):
        assert request.url == "https://openrouter.ai/api/v1/chat/completions"
        payload = json.loads(request.content)
        assert payload["provider"]["only"] == ["inference-net"]
        assert payload["provider"]["allow_fallbacks"] is False
        assert payload["provider"]["data_collection"] == "deny"
        assert payload["provider"]["require_parameters"] is True
        assert payload["provider"]["max_price"] == {"prompt": 0.02, "completion": 0.45}
        assert payload["reasoning"] == {"enabled": False}
        assert payload["response_format"] == {"type": "json_object"}
        assert "models" not in payload and "tools" not in payload
        return response(payload, '{"reply":"safe"}')
    provider = OpenRouterProvider(model=model, api_key="mock-key", transport=httpx.MockTransport(respond))
    events = [e async for e in provider.stream_events(model=model,
        messages=[{"role": "user", "content": "hi"}], response_schema={"type": "object"})]
    assert events[-1]["usage"]["cost_usd"] == "0.0000030001"
    assert OPENROUTER_TARIFFS[model].cost(events[-1]["usage"]) == 3001
    text, usage = await provider.screen_json([{"role": "user", "content": "hi"}], {"type": "object"}, 128)
    assert text == '{"reply":"safe"}' and billed_nano(usage) == 3001


@pytest.mark.parametrize("value", [None, "NaN", "Infinity", "-1", "101", True, 0.1])
def test_bad_cost_cannot_become_an_estimated_customer_charge(value):
    usage = {"prompt_tokens": 3, "completion_tokens": 2, "cost_usd": value}
    meter = CostMeter(100_000)
    meter.begin(100_000, OPENROUTER_TARIFFS[DEEPSEEK])
    meter.finish(usage)
    assert meter.uncertain and meter.total == 100_000


@pytest.mark.asyncio
@pytest.mark.parametrize("case", ["provider", "model", "reasoning", "refusal", "incomplete", "missing-route", "redirect"])
async def test_invalid_routes_and_outputs_never_fallback(case):
    calls = []
    def respond(request):
        calls.append(request)
        if case == "redirect":
            return httpx.Response(307, headers={"Location": "https://other.test/key"})
        event = {"provider": "InferenceNet", "model": DEEPSEEK,
                 "choices": [{"delta": {"content": "safe"}, "finish_reason": "stop"}]}
        if case == "provider": event["provider"] = "Unknown"
        if case == "model": event["model"] = MIMO
        if case == "missing-route": event.pop("provider")
        if case in {"reasoning", "refusal"}: event["choices"][0]["delta"][case] = "private payload"
        if case == "incomplete": event["choices"][0]["finish_reason"] = "length"
        return httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n")
    provider = OpenRouterProvider(api_key="mock-key", model=DEEPSEEK, transport=httpx.MockTransport(respond))
    with pytest.raises(RuntimeError) as error:
        _ = [e async for e in provider.stream_events(model=DEEPSEEK, messages=[{"role": "user", "content": "hi"}])]
    assert len(calls) == 1 and "private payload" not in str(error.value)


@pytest.mark.asyncio
@pytest.mark.parametrize("cost", ["0.0000030001", None])
async def test_selected_model_generation_settlement_and_replay(tmp_path, cost):
    cfg = config(tmp_path)
    calls = []
    output = {"reply": "hello", "state_update": {"location": "park", "time": "day", "mood": "happy",
        "active_scene": "talking", "relationship_state": {
            "stage": "stranger", "tone": "neutral", "unresolved_conflict": False}}}
    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload["model"])
        if payload["stream"]:
            assert any("Do not invent the user's past" in m.get("content", "")
                       for m in payload["messages"] if isinstance(m.get("content"), str))
        text = json.dumps(output) if payload["stream"] else '{"sfw":true}'
        result = response(payload, text)
        if cost is None:
            result = httpx.Response(200, text=result.text.replace(', "cost": 0.0000030001', ''))
        return result
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = str(uuid4())
    app.state.store.account(owner, consent=provider_consent_version(cfg))
    app.state.store.grant(owner, 10_000, time.time() + 300, "test", "test")
    context = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        req = CloudChat(model_id="cloud-standard", messages=[{"role": "user", "content": "hi"}])
        quote = await app.state.jobs.quote(owner, req)
        assert quote["route"]["model"] == DEEPSEEK and quote["route"]["upstream"] == "InferenceNet"
        assert quote["max_credits"] <= 1000
        structured = await app.state.jobs.quote(owner, req.model_copy(update={"route_profile": "structured"}))
        assert structured["route"]["model"] == DEEPSEEK
        with pytest.raises(CloudError, match="cloud_route_profile_not_available"):
            await app.state.jobs.quote(owner, req.model_copy(update={"route_profile": "contributor"}))
        req = req.model_copy(update={"quote_id": quote["quote_id"], "max_credits": quote["max_credits"]})
        result = await (await app.state.jobs.start(owner, req))
        if cost:
            assert result["status"] == "completed", result
            assert result["charged_credits"] == TARIFF.credits(3 * 3001)
            assert calls == [DEEPSEEK, DEEPSEEK, DEEPSEEK]
        else:
            assert result["status"] == "failed" and result["charged_credits"] == 0
            assert calls == [DEEPSEEK]
        replay = await (await app.state.jobs.start(owner, req))
        assert replay["status"] == result["status"]
        assert replay["charged_credits"] == result["charged_credits"]
        assert len(calls) == (3 if cost else 1)


def test_acceptance_gates_and_distinct_consent(tmp_path):
    cfg = config(tmp_path)
    assert backend_block(replace(cfg, openrouter_approved=False)) == "openrouter_not_accepted"
    assert backend_block(replace(cfg, openrouter_key="")) == "provider_key_not_configured"
    assert backend_block(replace(cfg, inference_enabled=False)) == "inference_awaiting_acceptance"
    store = CloudStore(cfg)
    owner = str(uuid4())
    go = replace(cfg, operator_backend="opencode-go")
    store.account(owner, consent=provider_consent_version(go))
    with pytest.raises(CloudError, match="provider_consent_renewal_required"):
        require_current_consent(store, owner)
    store.account(owner, consent=provider_consent_version(cfg))
    require_current_consent(store, owner)
    assert public_route(cfg)["routing"]["conversation"] == DEEPSEEK
    with pytest.raises(ValueError, match="openrouter_model_not_allowed"):
        OpenRouterProvider(api_key="mock-key", model=MIMO)
    store.config = go
    with pytest.raises(CloudError, match="provider_consent_renewal_required"):
        require_current_consent(store, owner)


@pytest.mark.asyncio
async def test_old_ui_cannot_authorize_new_provider_by_echoing_status(tmp_path):
    cfg = config(tmp_path, legal_approved=True, supabase_url="https://auth.test",supabase_key="mock")
    app = create_app(cfg,transport=httpx.MockTransport(lambda _:pytest.fail("no real sends")))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=cfg.origin) as client:
        status=(await client.get("/api/cloud/status")).json()
        stale={"provider":"google","adult":True,"consent":True,
               "operator_backend":status["operator_route"]["provider"],
               "provider_consent_version":status["provider_consent_version"]}
        rejected=await client.post("/api/cloud/auth/login",json=stale,headers={"Origin":cfg.origin})
        assert rejected.status_code==403
        accepted=await client.post("/api/cloud/auth/login",json={**stale,
            "provider_disclosure_version":provider_consent_version(cfg)},headers={"Origin":cfg.origin})
        assert accepted.status_code==200


def test_known_bill_above_bound_is_recorded_and_halts_new_sends(tmp_path):
    cfg = config(tmp_path)
    store = CloudStore(cfg)
    owner = str(uuid4())
    store.account(owner, consent=provider_consent_version(cfg))
    store.trial(owner)
    quote = store.quote(owner, "a", 60, 1_000_000, "cloud-standard")
    store.reserve(owner, "a", "a", quote, 60)
    meter = CostMeter(1_000_000)
    meter.begin(500_000, OPENROUTER_TARIFFS[DEEPSEEK])
    with pytest.raises(CloudError, match="provider_usage_exceeded_bound"):
        meter.finish({"prompt_tokens": 1, "completion_tokens": 1, "cost_usd": "0.002"})
    assert meter.total == 2_000_000
    result = store.settle(owner, "a", meter.total, success=False)
    assert result["charged_credits"] == 0 and result["actual_cost"] == 2_000_000
    assert store.balance(owner) == 1000
    replay = store.settle(owner, "a", 0, success=False)
    assert replay["actual_cost"] == 2_000_000
    with store.transaction() as db:
        assert db.execute("SELECT SUM(amount) FROM budget_debt").fetchone()[0] == 1_000_000
    quote = store.quote(owner, "b", 1, 1, "cloud-standard")
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        store.reserve(owner, "b", "b", quote, 1)


def test_atomic_initial_ten_accounts_and_existing_access(tmp_path):
    store = CloudStore(config(tmp_path))
    owners = [str(uuid4()) for _ in range(20)]
    def signup(owner):
        try:
            return store.account(owner, consent="test")["id"]
        except CloudError as error:
            assert error.code == "cloud_registration_capacity_reached"
            return None
    with ThreadPoolExecutor(max_workers=8) as pool:
        accepted = [o for o in pool.map(signup, owners) if o]
    assert len(accepted) == 10
    store.config = replace(store.config, signup_limit=0)
    assert signup(accepted[0]) == accepted[0]
    assert signup(str(uuid4())) is None
    store.config = replace(store.config, signup_limit=100)
    assert signup(str(uuid4()))


def test_concurrent_checkout_capacity_cannot_sell_same_disk_twice(tmp_path, monkeypatch):
    from collections import namedtuple
    store = CloudStore(config(tmp_path))
    backups = Backups(store)
    plan = PlanEntitlements("test", 5, 1, 100, 7, 1)
    monkeypatch.setattr("python.cloud.backups.shutil.disk_usage",
                        lambda _: namedtuple("Disk", "total used free")(2500, 0, 2500))
    owners = [str(uuid4()), str(uuid4())]
    def admit(owner):
        try:
            backups.admission(owner, plan, hold_until=time.time() + 1800)
            return True
        except CloudError as error:
            assert error.code == "backup_capacity_not_available"
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(admit, owners)) == 1
    with store.transaction() as db:
        db.execute("UPDATE backup_capacity SET expires=?", (time.time() - 1,))
    assert admit(owners[1])


def test_active_paid_storage_counts_without_checkout_hold(tmp_path, monkeypatch):
    from collections import namedtuple
    store = CloudStore(config(tmp_path))
    owner = str(uuid4())
    store.account(owner, consent="test")
    with store.transaction() as db:
        db.execute("UPDATE accounts SET plan='plus',plan_until=? WHERE id=?", (time.time() + 300, owner))
    monkeypatch.setattr("python.cloud.backups.shutil.disk_usage",
        lambda _: namedtuple("Disk", "total used free")(5_000_000_000, 0, 5_000_000_000))
    backups = Backups(store)
    from python.cloud.contracts import PLANS
    # A downgrade retains the stronger existing promise, including legacy
    # accounts that predate persistent capacity holds.
    backups.admission(owner, PLANS["free"], hold_until=time.time()+1800)
    with store.transaction() as db:
        db.execute("UPDATE accounts SET plan='free',plan_until=0 WHERE id=?", (owner,))
    with pytest.raises(CloudError, match="backup_capacity_not_available"):
        backups.admission(str(uuid4()), PLANS["plus"], hold_until=time.time()+1800)


@pytest.mark.asyncio
async def test_portal_survives_generation_and_sales_shutdown(tmp_path):
    cfg = config(tmp_path, openrouter_approved=False, billing_enabled=False, stripe_key="sk_test_mock")
    def respond(request):
        assert request.url == "https://api.stripe.com/v1/billing_portal/sessions"
        return httpx.Response(200, json={"url": "https://billing.stripe.com/p/session"})
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = str(uuid4())
    app.state.store.account(owner, consent=provider_consent_version(cfg))
    with app.state.store.transaction() as db:
        db.execute("UPDATE accounts SET customer='cus_mock' WHERE id=?", (owner,))
    async def authenticated(_): return owner
    app.state.auth.owner = authenticated
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin) as client:
        account = (await client.get("/api/cloud/account")).json()
        assert account["billing_available"] is False and account["billing_portal_available"] is True
        portal = await client.post("/api/cloud/billing/portal", headers={"Origin": cfg.origin})
        assert portal.status_code == 200
        assert portal.json()["url"].startswith("https://billing.stripe.com/")
