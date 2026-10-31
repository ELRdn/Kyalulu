"""Reward acceptance regressions; disk fixtures and test-only signed receipts."""
import asyncio
from dataclasses import replace
import hashlib
import hmac
import json
import socket
import time
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from python.cloud.config import CloudConfig
from python.cloud.store import CloudError, CloudStore
from python.cloud.unified import UnifiedService, install_routes


class AdProvider:
    def __init__(self):
        self.inventory_calls = 0
        self.verify_calls = 0
        self.on_inventory = None

    async def inventory(self):
        self.inventory_calls += 1
        await asyncio.sleep(0)
        if self.on_inventory:
            self.on_inventory()
        return {"seconds": 15}

    def frame_url(self, offer_id):
        return "https://ads.test/" + offer_id

    def signed(self, event):
        raw = json.dumps(event, sort_keys=True).encode()
        signature = hmac.new(b"test-only-ad-key", raw, hashlib.sha256).hexdigest()
        return {"content": raw, "headers": {"x-test-signature": signature}}

    def verify(self, raw, headers):
        self.verify_calls += 1
        expected = hmac.new(b"test-only-ad-key", raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(headers.get("x-test-signature", ""), expected):
            raise CloudError("invalid_ad_signature", 401)
        return json.loads(raw)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def denied(*args, **kwargs):
        pytest.fail("Reward tests must not contact a real provider")
    monkeypatch.setattr(socket, "create_connection", denied)
    monkeypatch.setattr(socket, "getaddrinfo", denied)
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", denied)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", denied)


@pytest.fixture
def rewards(tmp_path, monkeypatch):
    clock = [1_800_000_000.0]
    monkeypatch.setattr(time, "time", lambda: clock[0])
    config = CloudConfig(root=tmp_path, origin="https://app.test", secret="s" * 32,
                         unified_enabled=True, ads_enabled=True, legal_approved=True)
    store = CloudStore(config)
    provider = AdProvider()
    service = UnifiedService(store, ad_provider=provider)
    owner = str(uuid4())
    store.account(owner, consent="test-only")
    app = FastAPI()
    install_routes(app, service)

    @app.middleware("http")
    async def identity(request: Request, call_next):
        request.state.owner = owner
        return await call_next(request)

    @app.exception_handler(CloudError)
    async def cloud_error(request, exc):
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    return SimpleNamespace(clock=clock, store=store, provider=provider,
                           service=service, owner=owner, app=app)


BLOCKS = [
    ("unified", 503, "unified_app_awaiting_acceptance"),
    ("account", 403, "consent_required"),
    ("suspended", 403, "account_unavailable"),
    ("provider", 503, "ad_provider_awaiting_acceptance"),
    ("ads", 503, "ad_provider_awaiting_acceptance"),
    ("legal", 503, "ad_provider_awaiting_acceptance"),
    ("private", 503, "ad_provider_awaiting_acceptance"),
]


def block(env, condition):
    if condition == "provider":
        env.service.ad_provider = None
    elif condition in {"account", "suspended"}:
        with env.store.transaction() as db:
            if condition == "account":
                db.execute("DELETE FROM accounts WHERE id=?", (env.owner,))
            else:
                db.execute("UPDATE accounts SET suspended=1 WHERE id=?", (env.owner,))
    else:
        changes = {
            "unified": {"unified_enabled": False},
            "ads": {"ads_enabled": False},
            "legal": {"legal_approved": False},
            "private": {"private_test": True, "ads_enabled": False, "trial_credits": 0,
                        "allowed_emails": ("fixture@example.test",), "signup_limit": 1},
        }
        env.store.config = replace(env.store.config, **changes[condition])


def assert_no_offer(env):
    with env.store.transaction() as db:
        for table in ("app_reward_offers", "app_reward_reserves", "app_free_reserves", "credit_lots"):
            assert db.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(("condition", "status", "error"), BLOCKS)
async def test_offer_rejects_before_provider_inventory(rewards, condition, status, error):
    block(rewards, condition)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(rewards.app),
                                base_url="https://app.test") as client:
        response = await client.post("/api/cloud/app/rewards")
    assert response.status_code == status
    assert response.json() == {"error": error}
    assert rewards.provider.inventory_calls == 0
    assert_no_offer(rewards)


@pytest.mark.parametrize(("condition", "status", "error"), BLOCKS)
def test_direct_offer_keeps_acceptance_defense(rewards, condition, status, error):
    block(rewards, condition)
    with pytest.raises(CloudError, match=error) as raised:
        rewards.service.offer(rewards.owner, {"seconds": 15})
    assert raised.value.status == status
    assert rewards.provider.inventory_calls == 0
    assert_no_offer(rewards)


@pytest.mark.asyncio
@pytest.mark.parametrize(("condition", "status", "error"), BLOCKS)
async def test_offer_rechecks_after_inventory_await(rewards, condition, status, error):
    rewards.provider.on_inventory = lambda: block(rewards, condition)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(rewards.app),
                                base_url="https://app.test") as client:
        response = await client.post("/api/cloud/app/rewards")
    assert response.status_code == status
    assert response.json() == {"error": error}
    assert rewards.provider.inventory_calls == 1
    assert_no_offer(rewards)


def ledger(env):
    with env.store.transaction() as db:
        return {
            table: [tuple(row) for row in db.execute("SELECT * FROM " + table + " ORDER BY rowid")]
            for table in ("funds", "credit_lots", "app_reward_offers",
                          "app_reward_reserves", "app_free_reserves", "app_reward_events")
        }


@pytest.mark.asyncio
@pytest.mark.parametrize("poll", [False, True])
@pytest.mark.parametrize("arrival_offset", [-1, 0, 1])
async def test_completion_deadline_is_independent_of_poll(rewards, poll, arrival_offset):
    env = rewards
    with env.store.transaction() as db:
        env.store._available_funds(db)
    original_funds = ledger(env)["funds"]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(env.app),
                                base_url="https://app.test") as client:
        response = await client.post("/api/cloud/app/rewards")
        assert response.status_code == 200
        offer = response.json()
        assert offer["credits"] == 150 and offer["expires"] == env.clock[0] + 86400
        assert offer["frame_url"].startswith("https://ads.test/")
        event = {"event_id": "verified-event", "offer_id": offer["id"], "seconds": 15,
                 "completed_at": env.clock[0] + 16}
        env.clock[0] = offer["expires"] + arrival_offset
        if poll:
            response = await client.get("/api/cloud/app/rewards/" + offer["id"])
            assert response.json()["state"] == ("pending" if arrival_offset < 0 else "expired")
        response = await client.post("/api/cloud/app/rewards/webhook", **env.provider.signed(event))
        state = ledger(env)
        assert state["app_reward_reserves"] == state["app_free_reserves"] == []
        if arrival_offset < 0:
            assert response.status_code == 200
            assert response.json() == {"granted": True, "credits": 150}
            assert env.store.balance(env.owner) == 150
            with env.store.transaction() as db:
                credit_expiry = db.execute("SELECT expires FROM credit_lots WHERE source=?",
                                           (offer["id"],)).fetchone()[0]
                backing_expiry = db.execute("SELECT expires FROM funds WHERE id=?",
                                            ("reward:" + offer["id"],)).fetchone()[0]
            assert credit_expiry == backing_expiry == env.clock[0] + 30 * 86400
            env.clock[0] = offer["expires"] + 10
            response = await client.post("/api/cloud/app/rewards/webhook", **env.provider.signed(event))
            assert response.status_code == 200 and response.json() == {"granted": False}
            response = await client.post("/api/cloud/app/rewards/webhook",
                                         **env.provider.signed({**event, "seconds": 30}))
            assert response.status_code == 409 and response.json()["error"] == "ad_receipt_conflict"
        else:
            assert response.status_code == 409
            assert response.json()["error"] == "ad_receipt_not_completed"
            assert state["funds"] == original_funds
            assert state["credit_lots"] == state["app_reward_events"] == []
            assert env.service.reward(env.owner, offer["id"])["state"] == "expired"
            reopened = UnifiedService(CloudStore(env.store.config), ad_provider=env.provider)
            assert reopened.reward(env.owner, offer["id"])["state"] == "expired"
            response = await client.post("/api/cloud/app/rewards/webhook", **env.provider.signed(event))
            assert response.status_code == 409
        assert ledger(env) == state


@pytest.mark.asyncio
async def test_rejected_completion_commits_expiry_release(rewards):
    env = rewards
    with env.store.transaction() as db:
        env.store._available_funds(db)
    original_funds = ledger(env)["funds"]
    offer = env.service.offer(env.owner, {"seconds": 15})
    event = {"event_id": "wrong-duration", "offer_id": offer["id"], "seconds": 30,
             "completed_at": env.clock[0] + 31}
    env.clock[0] = offer["expires"]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(env.app),
                                base_url="https://app.test") as client:
        response = await client.post("/api/cloud/app/rewards/webhook", **env.provider.signed(event))
    assert response.status_code == 409
    state = ledger(env)
    assert state["app_reward_offers"][0][4] == "expired"
    assert state["app_reward_reserves"] == state["app_free_reserves"] == []
    assert state["funds"] == original_funds


@pytest.mark.asyncio
async def test_unverified_completion_cannot_grant_or_release_reserve(rewards):
    env = rewards
    offer = env.service.offer(env.owner, {"seconds": 15})
    event = {"event_id": "unverified", "offer_id": offer["id"], "seconds": 15,
             "completed_at": env.clock[0] + 16}
    env.clock[0] = offer["expires"] + 1
    before = ledger(env)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(env.app),
                                base_url="https://app.test") as client:
        response = await client.post("/api/cloud/app/rewards/webhook", json=event)
    assert response.status_code == 401 and response.json()["error"] == "invalid_ad_signature"
    assert ledger(env) == before
