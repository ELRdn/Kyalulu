"""Prepared routing and honest Go wire protocol; all upstreams are mocks."""

from dataclasses import replace
import json
from uuid import uuid4
import httpx
import pytest
from python.cloud.app import create_app
from python.cloud.auth import CONSENT_VERSION
from python.cloud.config import CloudConfig
from python.cloud.contracts import TARIFF
from python.cloud.generation import CloudChat
from python.cloud.meter import CostMeter
from python.cloud.router import (GO_TARIFFS, backend_block, operator_provider,
                                 public_route, require_current_consent, select_model)
from python.cloud.safety import SafetyGuard
from python.cloud.store import CloudStore, CloudError
from python.providers.opencode_go import OpenCodeGoProvider, DEEPSEEK, MIMO, MUSE
from python.storage.context import CloudStorageContext, storage_context
from python.storage import db as storage


def config(tmp_path, **kwargs):
    return CloudConfig(root=tmp_path / "cloud", origin="https://cloud.test",
                       secret="s" * 32, operator_backend="opencode-go",
                       opencode_go_key="test-key", **kwargs)


def test_routing_and_separate_training_consent():
    assert select_model() == MIMO
    assert select_model(context_bytes=16_000) == DEEPSEEK
    assert select_model("structured") == DEEPSEEK
    for consent, region, error in [(False, True, "muse_training_consent_required"),
                                    (True, False, "muse_geographic_use_not_accepted")]:
        with pytest.raises(CloudError, match=error):
            select_model("contributor", training_consent=consent, region_approved=region)
    assert select_model("contributor", training_consent=True, region_approved=True) == MUSE


def test_shared_hosting_gates_cannot_be_enabled_by_key_alone(tmp_path):
    cfg = config(tmp_path, inference_enabled=True, billing_enabled=True)
    assert backend_block(cfg) == "opencode_go_hosting_permission_required"
    with pytest.raises(CloudError, match="opencode_go_hosting_permission_required"):
        operator_provider(cfg, session="owner:conversation")
    cfg = replace(cfg, go_hosting_permission_reference="mock-permission-evidence")
    assert backend_block(cfg) == "opencode_go_cost_attribution_not_accepted"
    route = public_route(cfg)
    assert route["available"] is False and route["provider"] == "opencode-go"
    assert route["routing"]["conversation"] == MIMO
    assert len(route["models"]) == 3
    assert route["cost_basis"] == "subscription_allowance_reference"


def test_explicit_go_stays_closed(tmp_path, monkeypatch):
    for key, value in {"KYALULU_CLOUD_MODE": "1", "KYALULU_CLOUD_DATA_DIR": str(tmp_path),
                       "KYALULU_CLOUD_ORIGIN": "https://cloud.test", "KYALULU_CLOUD_SECRET": "s" * 32}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("KYALULU_OPERATOR_BACKEND", "opencode-go")
    monkeypatch.delenv("KYALULU_GO_HOSTING_PERMISSION_REFERENCE", raising=False)
    cfg = CloudConfig.from_env()
    assert cfg.operator_backend == "opencode-go"
    assert backend_block(cfg) == "opencode_go_hosting_permission_required"


def test_provider_change_requires_renewed_consent(tmp_path):
    store = CloudStore(config(tmp_path))
    owner = str(uuid4())
    store.account(owner, consent="old-deepseek-only")
    with pytest.raises(CloudError, match="provider_consent_renewal_required"):
        require_current_consent(store, owner)
    store.account(owner, consent=CONSENT_VERSION)
    require_current_consent(store, owner)
    assert store.account(owner)["consent_version"] == CONSENT_VERSION


def test_decimal_cache_rate_and_per_call_tariffs():
    usage = {"prompt_tokens": 1, "prompt_cache_hit_tokens": 1, "completion_tokens": 0}
    assert GO_TARIFFS[MIMO].cost(usage) == 3  # $0.0028/M, ceil only after aggregation.
    meter = CostMeter(10_000)
    for model in [MIMO, DEEPSEEK, MUSE]:
        meter.begin(1000, GO_TARIFFS[model])
        meter.finish(usage)
    assert meter.total == 3 + 6 + 2
    assert TARIFF.cost(usage) == 6


@pytest.mark.asyncio
@pytest.mark.parametrize("model", [DEEPSEEK, MIMO, MUSE])
async def test_chat_and_responses_streams_use_correct_endpoint_and_private_session(model):
    seen = []
    def respond(request):
        seen.append(request)
        assert request.url.host == "opencode.ai"
        assert request.headers["user-agent"].startswith("Kyalulu/")
        assert len(request.headers["x-opencode-session"]) == 64
        assert "private-owner" not in request.headers["x-opencode-session"]
        payload = json.loads(request.content)
        assert payload["model"] == model
        if model == MUSE:
            assert request.url.path.endswith("/responses")
            assert payload["store"] is False and payload["reasoning"]["effort"] == "minimal"
            assert payload["text"]["format"]["type"] == "json_object"
            events = [{"type": "response.output_text.delta", "delta": '{"reply":"hello"}'},
                      {"type": "response.completed", "response": {"status": "completed", "usage": {
                          "input_tokens": 20, "output_tokens": 4,
                          "input_tokens_details": {"cached_tokens": 10}}}}]
        else:
            assert request.url.path.endswith("/chat/completions")
            assert payload["thinking"] == {"type": "disabled"}
            assert payload["response_format"] == {"type": "json_object"}
            events = [{"choices": [{"delta": {"content": '{"reply":"hello"}'}, "finish_reason": "stop"}]},
                      {"usage": {"prompt_tokens": 20, "completion_tokens": 4,
                                 "prompt_tokens_details": {"cached_tokens": 10}}, "choices": []}]
        return httpx.Response(200, text="".join("data: " + json.dumps(e) + "\n\n" for e in events)
                              + ("data: [DONE]\n\n" if model != MUSE else ""))
    provider = OpenCodeGoProvider(model=model, session="private-owner:session", api_key="test-key",
                                  contributor_consent=model == MUSE, transport=httpx.MockTransport(respond))
    events = [e async for e in provider.stream_events(model=model, messages=[{"role": "user", "content": "hi"}],
                                                      response_schema={"type": "object"})]
    assert events[-1]["usage"] == {"prompt_tokens": 20, "completion_tokens": 4, "prompt_cache_hit_tokens": 10}
    assert len(seen) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("model", [DEEPSEEK, MIMO, MUSE])
async def test_vision_is_preserved_in_both_protocols(model):
    import io
    from PIL import Image
    from python.providers.deepseek_images import image_block
    image = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(image, "PNG")
    block = image_block(image.getvalue(), "image/png")
    provider = OpenCodeGoProvider(model=model, session="test", api_key="test-key", contributor_consent=model == MUSE)
    payload = provider.request_payload([{"role": "user", "content": [{"type": "text", "text": "hi"}, block]}])
    content = payload["input" if model == MUSE else "messages"][0]["content"]
    assert content[1]["image_url"] == (
        block["image_url"]["url"] if model == MUSE else block["image_url"])
    with pytest.raises(ValueError, match="inline_images_only"):
        provider.request_payload([{"role": "user", "content": [{"type": "image_url", "image_url": {"url": "https://private.test/a"}}]}])


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [429, 500, 302])
async def test_errors_do_not_fallback_or_leak_upstream(status):
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(status, text="PRIVATE_PROMPT_OR_KEY", headers={"Location": "https://other.test"})
    provider = OpenCodeGoProvider(model=MIMO, session="test", api_key="test-key", transport=httpx.MockTransport(respond))
    with pytest.raises(RuntimeError, match=f"opencode_go_http_{status}") as error:
        await provider.generate(model=MIMO, messages=[{"role": "user", "content": "hi"}])
    assert len(calls) == 1 and "PRIVATE" not in str(error.value)


@pytest.mark.asyncio
async def test_safety_remains_deepseek_and_uses_go_endpoint():
    def respond(request):
        payload = json.loads(request.content)
        assert payload["model"] == DEEPSEEK and request.url.host == "opencode.ai"
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": '{"sfw":true}'}}],
                                        "usage": {"prompt_tokens": 20, "completion_tokens": 4}})
    provider = OpenCodeGoProvider(model=DEEPSEEK, session="test", api_key="test-key", transport=httpx.MockTransport(respond))
    meter = CostMeter(2_000_000)
    await SafetyGuard(provider, tariff=GO_TARIFFS[DEEPSEEK]).check({"text": "hi"}, meter=meter)
    assert meter.total == 20 * 300 + 4 * 1200


@pytest.mark.asyncio
async def test_public_status_and_checkout_stay_closed(tmp_path):
    cfg = config(tmp_path, inference_enabled=True, billing_enabled=True, legal_approved=True)
    app = create_app(cfg, transport=httpx.MockTransport(lambda r: pytest.fail("no upstream requests allowed")))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin) as client:
        status = (await client.get("/api/cloud/status")).json()
        assert status["inference_available"] is False
        assert status["billing_available"] is False
        assert status["operator_route"]["provider"] == "opencode-go"
        models = (await client.get("/api/models")).json()
        # This endpoint requires authentication. Public status alone exposes routing facts.
        assert models["error"] == "authentication_required"
    with pytest.raises(CloudError, match="opencode_go_hosting_permission_required"):
        await app.state.billing.checkout(str(uuid4()), "plus", "test")


@pytest.mark.asyncio
async def test_old_login_page_cannot_consent_to_new_backend(tmp_path):
    cfg = config(tmp_path, legal_approved=True, supabase_url="https://auth.test", supabase_key="test")
    app = create_app(cfg, transport=httpx.MockTransport(lambda r: pytest.fail("no sends")))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin) as client:
        body = {"provider": "google", "adult": True, "consent": True}
        headers = {"Origin": cfg.origin}
        result = await client.post("/api/cloud/auth/login", json=body, headers=headers)
        assert result.status_code == 403 and result.json()["error"] == "provider_consent_renewal_required"
        body.update(operator_backend="opencode-go", provider_consent_version=CONSENT_VERSION,
                    provider_disclosure_version=CONSENT_VERSION)
        result = await client.post("/api/cloud/auth/login", json=body, headers=headers)
        assert result.status_code == 200 and result.json()["url"].startswith("https://auth.test/")


@pytest.mark.asyncio
async def test_generation_prepare_pins_model_and_tariff_and_denies_missing_muse_consent(tmp_path):
    cfg = config(tmp_path, inference_enabled=True,
                 go_hosting_permission_reference="MOCK_PERMISSION_NOT_REAL",
                 go_accounting_approved=True, go_muse_region_approved=True)
    app = create_app(cfg, transport=httpx.MockTransport(lambda r: pytest.fail("prepare must not send")))
    owner = str(uuid4())
    app.state.store.account(owner, consent=CONSENT_VERSION)
    context = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        req = CloudChat(model_id="cloud-standard", messages=[{"role": "user", "content": "hi"}])
        prepared = await app.state.jobs.prepare(owner, req)
        assert prepared["model"] == MIMO
        assert prepared["safety_provider"].model == DEEPSEEK
        structured = await app.state.jobs.prepare(owner, req.model_copy(update={"route_profile": "structured"}))
        assert structured["model"] == DEEPSEEK
        assert structured["hash"] != prepared["hash"]
        with pytest.raises(CloudError, match="muse_training_consent_required"):
            await app.state.jobs.prepare(owner, req.model_copy(update={"route_profile": "contributor"}))
        muse = await app.state.jobs.prepare(owner, req.model_copy(update={"route_profile": "contributor", "contributor_training_consent": True}))
        assert muse["model"] == MUSE and muse["tariff"] == GO_TARIFFS[MUSE]


@pytest.mark.asyncio
@pytest.mark.parametrize("profile", ["auto", "structured", "contributor"])
async def test_mock_generation_safety_and_final_settlement(tmp_path, profile):
    import time

    calls = []
    output = {"reply": "hello", "state_update": {"location": "park", "time": "day",
        "mood": "happy", "active_scene": "talking", "relationship_state": {
            "stage": "stranger", "tone": "neutral", "unresolved_conflict": False}}}
    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload["model"])
        if not payload.get("stream"):
            assert payload["model"] == DEEPSEEK
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop",
                "message": {"content": '{"sfw":true}'}}],
                "usage": {"prompt_tokens": 30, "completion_tokens": 5}})
        if payload["model"] == MUSE:
            events = [{"type": "response.output_text.delta", "delta": json.dumps(output)},
                {"type": "response.completed", "response": {"status": "completed", "usage": {
                    "input_tokens": 100, "output_tokens": 80, "input_tokens_details": {"cached_tokens": 0}}}}]
        else:
            events = [{"choices": [{"delta": {"content": json.dumps(output)}, "finish_reason": "stop"}]},
                      {"choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 80}}]
        return httpx.Response(200, text="".join("data: " + json.dumps(e) + "\n\n" for e in events)
            + ("data: [DONE]\n\n" if payload["model"] != MUSE else ""))
    cfg = config(tmp_path, inference_enabled=True, go_accounting_approved=True,
                 go_hosting_permission_reference="MOCK_PERMISSION_NOT_REAL", go_muse_region_approved=True)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = str(uuid4())
    app.state.store.account(owner, consent=CONSENT_VERSION)
    app.state.store.grant(owner, 10_000, time.time() + 300, "test", "test")
    context = CloudStorageContext.for_owner(cfg.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        req = CloudChat(model_id="cloud-standard", route_profile=profile,
                        contributor_training_consent=profile == "contributor",
                        messages=[{"role": "user", "content": "hi"}])
        quote = await app.state.jobs.quote(owner, req)
        model = quote["route"]["model"]
        assert model == {"auto": MIMO, "structured": DEEPSEEK, "contributor": MUSE}[profile]
        req = req.model_copy(update={"quote_id": quote["quote_id"], "max_credits": quote["max_credits"]})
        result = await (await app.state.jobs.start(owner, req))
        assert result["status"] == "completed", result
        cost = 2 * TARIFF.cost({"prompt_tokens": 30, "completion_tokens": 5})
        cost += GO_TARIFFS[model].cost({"prompt_tokens": 100, "completion_tokens": 80})
        assert result["charged_credits"] == TARIFF.credits(cost)
        assert calls == [DEEPSEEK, model, DEEPSEEK]
        replay = await (await app.state.jobs.start(owner, req))
        assert replay["status"] == "completed" and len(calls) == 3


@pytest.mark.asyncio
async def test_login_flow_binds_provider_consent_before_redirect(tmp_path):
    from python.cloud.auth import SupabaseAuth
    from python.cloud.store import digest

    cfg = config(tmp_path, legal_approved=True, supabase_url="https://auth.test", supabase_key="test")
    store = CloudStore(cfg)
    auth = SupabaseAuth(cfg, store, httpx.MockTransport(lambda r: pytest.fail("no sends")))
    flow, _ = await auth.begin(provider="google", adult=True, consent=True)
    changed = SupabaseAuth(replace(cfg, operator_backend="deepseek"), store,
                           httpx.MockTransport(lambda r: pytest.fail("no sends")))
    with pytest.raises(CloudError, match="provider_consent_renewal_required"):
        await changed.finish(flow, "code")
    with store.transaction() as db:
        row = db.execute("SELECT verifier FROM flows WHERE hash=?", (digest(flow),)).fetchone()
    agreement = json.loads(store.decrypt(row["verifier"]))
    assert agreement["consent"] == CONSENT_VERSION and agreement["backend"] == "opencode-go"


def test_training_consent_requires_json_boolean():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        CloudChat(model_id="cloud-standard", messages=[], contributor_training_consent="true")


@pytest.mark.asyncio
@pytest.mark.parametrize("model,case", [(MIMO, "reasoning"), (MIMO, "refusal"),
    (MIMO, "unfinished"), (MUSE, "refusal"), (MUSE, "unfinished"), (MUSE, "empty")])
async def test_unaccepted_outputs_never_become_success(model, case):
    if model == MIMO:
        events = [{"choices": [{"delta": {"reasoning_content": "private thoughts"}
            if case == "reasoning" else {"refusal": "no"}
            if case == "refusal" else {"content": "partial"}, "finish_reason": None}]}]
    else:
        events = [{"type": "response.refusal.delta", "delta": "no"}] if case == "refusal" else [
            {"type": "response.completed", "response": {"status": "incomplete" if case == "unfinished" else "completed",
                "usage": {"input_tokens": 20, "output_tokens": 4}}}]
    raw = "".join("data: " + json.dumps(e) + "\n\n" for e in events)
    provider = OpenCodeGoProvider(model=model, session="test", api_key="test-key", contributor_consent=model == MUSE,
                                  transport=httpx.MockTransport(lambda r: httpx.Response(200, text=raw)))
    with pytest.raises(RuntimeError, match="opencode_go_"):
        await provider.generate(model=model, messages=[{"role": "user", "content": "hi"}])
