"""Hosted admission invariants; no real API calls or payments."""

import asyncio
from dataclasses import replace
import hashlib
import hmac
import json
import time
from uuid import uuid4
import httpx
import pytest
from python.cloud.app import create_app
from python.cloud.config import CloudConfig
from python.cloud.auth import provider_consent_version
from python.cloud.contracts import TARIFF
from python.cloud.store import CloudStore, CloudError
from python.cloud.meter import CostMeter
from python.cloud.sync import SyncService, export_snapshot
from python.cloud.backups import Backups
from python.storage.context import CloudStorageContext, storage_context
from python.storage import db as storage


@pytest.fixture
def config(tmp_path):
    return CloudConfig(
        root=tmp_path / "cloud",
        origin="https://cloud.test",
        secret="s" * 32,
        backup_root=tmp_path / "offsite",
        inference_enabled=True,
        operator_backend="deepseek",
        deepseek_key="sk-test",
    )


def account(store):
    owner = str(uuid4())
    store.account(owner, consent=provider_consent_version(store.config))
    assert store.trial(owner)
    return owner


def reserve(
    store, owner, operation, cost=1_000_000, credits=60, route="cloud-standard"
):
    q = store.quote(owner, operation, credits, cost, route)
    store.reserve(owner, operation, operation, q, credits)


def test_integer_aggregate_and_failed_cost(config):
    assert TARIFF.credits(1) == 1
    assert TARIFF.credits(100_001) == 7
    assert TARIFF.credits(1, False) == 0
    store = CloudStore(config)
    owner = account(store)
    assert not store.trial(owner)
    reserve(store, owner, "a")
    assert store.balance(owner) == 940
    result = store.settle(owner, "a", 100_000, success=True)
    assert result["charged_credits"] == 6
    assert store.balance(owner) == 994
    assert store.settle(owner, "a", 0, success=False)["charged_credits"] == 6
    reserve(store, owner, "b")
    store.settle(owner, "b", 200_000, success=False)
    assert store.balance(owner) == 994
    with store.transaction() as con:
        spent = con.execute("SELECT SUM(actual_cost) FROM operations").fetchone()[0]
    assert spent == 300_000


def test_reservation_expiry_order_and_quotes(config):
    store = CloudStore(config)
    owner = account(store)
    store.grant(owner, 100, time.time() + 100, "purchase", "earlier")
    reserve(store, owner, "a", credits=120, cost=2_000_000)
    with store.transaction() as db:
        assert (
            db.execute(
                "SELECT remaining FROM credit_lots WHERE source='earlier'"
            ).fetchone()[0]
            == 0
        )
    with pytest.raises(CloudError, match="quote_expired"):
        store.reserve(owner, "b", "changed", "missing", 120)
    store.settle(owner, "a", 500_000, success=True)
    assert store.balance(owner) == 1070
    with store.transaction() as db:
        assert (
            db.execute(
                "SELECT remaining FROM credit_lots WHERE source='earlier'"
            ).fetchone()[0]
            == 70
        )


def test_unfunded_trials_denied_and_byok_zero_charge(config):
    store = CloudStore(replace(config, monthly_subsidy_jpy=0))
    owner = str(uuid4())
    store.account(owner, consent="test")
    assert not store.trial(owner)
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        reserve(store, owner, "a", 1, 0, "byok-deepseek")
    store = CloudStore(replace(config, root=config.root / "funded"))
    owner = account(store)
    reserve(store, owner, "byok", 100_000, 0, "byok-deepseek")
    assert store.settle(owner, "byok", 100_000, success=True)["charged_credits"] == 0
    assert store.balance(owner) == 1000


def test_meter_failure_usage_and_recovery(config):
    meter = CostMeter(1_000_000)
    meter.begin(500_000)
    meter.finish({})
    assert meter.total == 500_000 and meter.uncertain
    with pytest.raises(CloudError):
        meter.begin(600_000)
    store = CloudStore(config)
    owner = account(store)
    reserve(store, owner, "a")
    store.recover()
    assert store.balance(owner) == 1000
    with store.transaction() as db:
        row = db.execute("SELECT state,actual_cost FROM operations").fetchone()
    assert tuple(row) == ("failed", 1_000_000)


def test_financial_review_migrates_legacy_ledger_and_preserves_known_cost(config):
    store = CloudStore(config)
    owner = account(store)
    reserve(store, owner, "settled")
    store.settle(owner, "settled", 100_000, success=True)
    reserve(store, owner, "pending", cost=2_250_000, credits=135)
    # A populated previous-version ledger has no review column.
    with store.transaction() as db:
        db.execute("ALTER TABLE operations DROP COLUMN review_required")
    store = CloudStore(config)
    with store.transaction() as db:
        row = db.execute("SELECT state,actual_cost,review_required FROM operations WHERE id='settled'").fetchone()
        assert tuple(row) == ("completed", 100_000, 0)
    wallet = store.balance(owner)
    result = store.settle(owner, "pending", 1_003_001, success=True, review_required=True)
    assert result == {"state": "failed", "actual_cost": 1_003_001, "charged_credits": 0}
    assert store.balance(owner) == wallet + 135
    restarted = CloudStore(config)
    assert restarted.settle(owner, "pending", 0, success=False)["actual_cost"] == 1_003_001
    with restarted.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM budget_debt").fetchone()[0] == 0
        assert db.execute("SELECT review_required FROM operations WHERE id='pending'").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM fund_holds").fetchone()[0] == 0
    with pytest.raises(CloudError, match="operator_budget_exhausted"):
        reserve(restarted, owner, "next", cost=1, credits=0, route="safety")


def test_refund_disables_holds_and_replayed_receipts(config):
    store = CloudStore(config)
    owner = account(store)
    store.receipt(
        owner,
        "pi_a",
        "credits_5",
        4_000_000_000,
        time.time() + 300,
        event_id="evt_a",
        event_hash="a",
    )
    store.receipt(
        owner,
        "pi_a",
        "credits_5",
        4_000_000_000,
        time.time() + 300,
        event_id="evt_a",
        event_hash="a",
    )
    assert store.balance(owner) == 51000
    reserve(store, owner, "a")
    store.revoke_receipt("pi_a")
    store.settle(owner, "a", 0, success=False)
    assert store.balance(owner) == 1000
    with pytest.raises(CloudError, match="webhook_conflict"):
        store.receipt(
            owner,
            "pi_a",
            "credits_5",
            1,
            time.time() + 300,
            event_id="evt_a",
            event_hash="b",
        )


@pytest.mark.asyncio
async def test_tenant_isolation_sync_cas_and_backup(config):
    from python.api.chat import _save_settings

    store = CloudStore(config)
    a, b = account(store), account(store)
    context_a = CloudStorageContext.for_owner(config.root / "tenants", a)
    context_b = CloudStorageContext.for_owner(config.root / "tenants", b)
    with storage_context(context_a):
        await storage.init_db()
        await _save_settings("a", "private-a", 0.8)
        await _save_settings("b", "unselected-secret", 0.8)
        snapshot = export_snapshot(context_a.directory / "data.db", ["a"])
        assert "unselected-secret" not in json.dumps(snapshot)
    with storage_context(context_b):
        await storage.init_db()
        assert (
            export_snapshot(context_b.directory / "data.db")["tables"][
                "session_settings"
            ]
            == []
        )
        service = SyncService(store)
        service.settings(b, "selected")
        path = context_b.directory / "data.db"
        assert service.push(
            b, path, request_id="x", base_revision=0, snapshot=snapshot
        ) == {"revision": 1}
        assert service.push(
            b, path, request_id="x", base_revision=0, snapshot=snapshot
        ) == {"revision": 1}
        with pytest.raises(CloudError, match="sync_revision_conflict"):
            service.push(b, path, request_id="y", base_revision=0, snapshot=snapshot)
        with store.transaction() as db:
            db.execute(
                "UPDATE accounts SET plan='plus',plan_until=? WHERE id=?",
                (time.time() + 1000, b),
            )
        backups = Backups(store)
        bid = backups.create(b, path)
        await _save_settings("a", "after-backup", 0.8)
        backups.restore(b, bid, path)
        restored = export_snapshot(path)
        assert "private-a" in json.dumps(restored) and "after-backup" not in json.dumps(
            restored
        )
        service.delete(b, path)
        service.settings(b, "selected")
        head = service.revision(b)
        assert not head["deleted"]
        assert (
            service.push(
                b,
                path,
                request_id="new",
                base_revision=head["revision"],
                snapshot=snapshot,
            )["revision"]
            == head["revision"] + 1
        )


async def client_for(app, owner=None):
    token = "test-" + str(uuid4())
    if owner:
        app.state.auth.save(
            token,
            owner,
            {
                "access_token": "fake-access",
                "refresh_token": "fake-refresh",
                "expires_in": 3600,
            },
        )
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="https://cloud.test",
        headers={"Origin": "https://cloud.test"},
        cookies={"__Host-kyalulu_cloud": token},
    )
    return client


@pytest.mark.asyncio
async def test_public_app_auth_origin_and_local_admin_exclusion(config):
    app = create_app(config)
    async with await client_for(app) as client:
        assert (await client.get("/api/cloud/status")).json()["cloud_mode"]
        assert (await client.get("/api/chat/history")).status_code == 401
    owner = account(app.state.store)
    async with await client_for(app, owner) as client:
        for path in (
            "/api/experiments",
            "/api/providers",
            "/api/local/cloud",
            "/api/le/install",
            "/api/remote/status",
        ):
            assert (await client.get(path)).status_code == 404
        assert (await client.get("/api/chat/history")).json()["history"] == []
        assert (
            "no-store"
            in (await client.get("/api/chat/history")).headers["cache-control"]
        )
        assert (
            await client.put(
                "/api/cloud/byok",
                json={"key": "sk-test", "consent": True},
                headers={"Origin": "https://evil.test"},
            )
        ).status_code == 403
        assert (
            await client.get("/api/cloud/account", headers={"Host": "evil.test"})
        ).status_code == 400


@pytest.mark.asyncio
async def test_safety_denied_before_save_and_budget_charged(config):
    def respond(request):
        assert request.url.host == "api.deepseek.com"
        payload = json.loads(request.content)
        assert payload["thinking"] == {"type": "disabled"}
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"sfw":false}'}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 5},
            },
        )

    app = create_app(config, transport=httpx.MockTransport(respond))
    owner = account(app.state.store)
    async with await client_for(app, owner) as client:
        response = await client.put(
            "/api/chat/settings", json={"session_id": "x", "system_prompt": "unsafe"}
        )
        assert response.status_code == 403
        assert (await client.get("/api/chat/settings?session_id=x")).json()[
            "system_prompt"
        ] == ""
        assert app.state.store.balance(owner) == 1000
        with app.state.store.transaction() as db:
            assert (
                db.execute("SELECT SUM(actual_cost) FROM operations").fetchone()[0] > 0
            )


@pytest.mark.asyncio
async def test_sync_token_is_scoped_and_revocable(config):
    app = create_app(config)
    owner = account(app.state.store)
    async with await client_for(app, owner) as client:
        result = await client.post("/api/cloud/sync/device")
        token = result.json()["token"]
        headers = {"Authorization": "Bearer " + token}
        assert (await client.get("/api/cloud/sync", headers=headers)).status_code == 200
        assert (
            await client.get("/api/chat/history", headers=headers)
        ).status_code == 403
        assert (await client.delete("/api/cloud/sync/devices")).status_code == 200
        assert (await client.get("/api/cloud/sync", headers=headers)).status_code == 401


def test_stripe_signature_replay_and_expired(config):
    from python.cloud.billing import StripeBilling

    store = CloudStore(replace(config, stripe_webhook_secret="whsec_test"))
    billing = StripeBilling(store, Backups(store))
    raw = b'{"id":"evt_x","type":"test","data":{"object":{}}}'
    stamp = str(int(time.time()))
    signature = hmac.new(
        b"whsec_test", stamp.encode() + b"." + raw, hashlib.sha256
    ).hexdigest()
    assert billing.verify(raw, "t=" + stamp + ",v1=" + signature)["id"] == "evt_x"
    with pytest.raises(CloudError, match="invalid_webhook_signature"):
        billing.verify(raw + b" ", "t=" + stamp + ",v1=" + signature)


@pytest.mark.asyncio
async def test_selected_sync_inherits_settings_and_scoped_manual_memory(config):
    from contextlib import closing
    import sqlite3
    from python.api.chat import _save_settings
    from python.storage import memories
    from python.cloud.sync import apply_snapshot, validate_snapshot
    from python.cloud.transfers import snapshot_pages

    source = CloudStorageContext.for_owner(config.root / "tenants", str(uuid4()))
    target = CloudStorageContext.for_owner(config.root / "tenants", str(uuid4()))
    scope = memories.chat_scope("character-a", "persona-a", "selected")
    with storage_context(source):
        await storage.init_db()
        await _save_settings("__global__", "inherited prompt", 0.8)
        with closing(sqlite3.connect(source.directory / "data.db")) as db:
            db.execute("UPDATE session_settings SET character_id=?, persona_id=?", ("character-a", "persona-a"))
            db.commit()
        manual = await memories.create(scope, "semantic", "shared manual memory")
        await memories.create(scope, "semantic", "selected automatic memory", source_session_id="selected")
        excluded = await memories.create(scope, "semantic", "unselected automatic secret", source_session_id="other")
        await memories.create("char:unrelated|persona:default", "semantic", "unrelated manual secret")
        snapshot = export_snapshot(source.directory / "data.db", ["selected"])
        validate_snapshot(snapshot)
        pages = list(snapshot_pages(source.directory / "data.db", ["selected"]))
        for value in (snapshot, pages):
            assert "inherited prompt" in json.dumps(value)
            assert "shared manual memory" in json.dumps(value)
            assert "selected automatic memory" in json.dumps(value)
            assert "unselected automatic secret" not in json.dumps(value)
            assert "unrelated manual secret" not in json.dumps(value)
        assert snapshot["tables"]["session_settings"][0]["session_id"] == "selected"
    with storage_context(target):
        await storage.init_db()
        await _save_settings("other", "preserved settings", 0.7)
        local = await memories.create(scope, "semantic", "preserved unselected memory", source_session_id="other")
        previous_events = await memories.events(memory_id=local["id"])
        apply_snapshot(target.directory / "data.db", snapshot)
        assert (await memories.get(local["id"]))["content"] == "preserved unselected memory"
        assert await memories.events(memory_id=local["id"]) == previous_events
        assert (await memories.get(manual["id"]))["content"] == "shared manual memory"
        with closing(sqlite3.connect(target.directory / "data.db")) as db:
            assert db.execute("SELECT system_prompt FROM session_settings WHERE session_id='other'").fetchone()[0] == "preserved settings"
        bad = json.loads(json.dumps(snapshot))
        bad["tables"]["memories"].append(next(r for r in export_snapshot(source.directory / "data.db")["tables"]["memories"] if r["id"] == excluded["id"]))
        with pytest.raises(CloudError, match="sync_selection_mismatch"):
            validate_snapshot(bad)


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["closed", "no-consent", "allow", "deny", "missing-usage"])
async def test_image_paged_sync_gate_atomicity_and_adoption(config, mode):
    import io
    from PIL import Image
    from python.storage.library import store_assets
    from python.cloud.transfers import snapshot_pages, apply_download

    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, "PNG")
    raw = output.getvalue()
    key = hashlib.sha256(raw).hexdigest()
    config = replace(config, image_storage_enabled=mode != "closed")
    image_calls = 0
    def respond(request):
        nonlocal image_calls
        data = json.loads(request.content)
        image = any(b.get("type") == "image_url" for b in data["messages"][1]["content"])
        if image:
            image_calls += 1
            assert request.url.host == "api.deepseek.com"
        response = {"choices": [{"message": {"content": json.dumps({"sfw": not (image and mode == "deny")})}, "finish_reason": "stop"}]}
        if not (image and mode == "missing-usage"):
            response["usage"] = {"prompt_tokens": 1100 if image else 20, "completion_tokens": 5}
        return httpx.Response(200, json=response)
    app = create_app(config, transport=httpx.MockTransport(respond))
    owner = account(app.state.store)
    local = CloudStorageContext.for_owner(config.root / "local", str(uuid4()))
    hosted = CloudStorageContext.for_owner(config.root / "tenants", owner)
    with storage_context(local):
        await storage.init_db()
        store_assets({key: (raw, "image/png")})
        pages = list(snapshot_pages(local.directory / "data.db", include_assets=True))
    assert len(pages) == 1 and "assets" in pages[0]
    async with await client_for(app, owner) as client:
        await client.put("/api/cloud/sync", json={"mode": "all"})
        result = await client.post("/api/cloud/sync/transfers", json={"direction": "upload", "selected_sessions": None, "base_revision": 0, "request_id": "images", "image_consent": mode != "no-consent"})
        transfer = result.json()["transfer_id"]
        uploaded = await client.put(f"/api/cloud/sync/transfers/{transfer}/pages/0", json=pages[0])
        if mode != "allow":
            assert uploaded.status_code == {"closed": 503, "no-consent": 403, "deny": 403, "missing-usage": 503}[mode]
            assert image_calls == (0 if mode in {"closed", "no-consent"} else 1)
            assert app.state.transfers.inspect(owner, transfer)["next"] == 0
            assert not (hosted.directory / "library_assets" / key).exists()
            assert app.state.sync.revision(owner)["revision"] == 0
            assert app.state.store.balance(owner) == 1000
            return
        assert uploaded.status_code == 200
        assert not (hosted.directory / "library_assets" / key).exists()
        replay = await client.put(f"/api/cloud/sync/transfers/{transfer}/pages/0", json=pages[0])
        assert replay.status_code == 200 and image_calls == 1
        staged = app.state.transfers.file(owner, transfer).read_bytes()
        assert pages[0]["assets"][key]["base64"].encode() not in staged
        committed = await client.post(f"/api/cloud/sync/transfers/{transfer}/commit", json={"pages": 1, "chain": uploaded.json()["chain"]})
        assert committed.status_code == 200, committed.text
        assert (hosted.directory / "library_assets" / key).read_bytes() == raw
        assert app.state.store.balance(owner) == 1000
        downloaded = (await client.post("/api/cloud/sync/transfers", json={"direction": "download", "selected_sessions": None})).json()
        download_pages = [(await client.get(f"/api/cloud/sync/transfers/{downloaded['transfer_id']}/pages/{i}")).json() for i in range(downloaded["pages"])]
        apply_download(local.directory / "data.db", None, download_pages)
        assert (local.directory / "library_assets" / key).read_bytes() == raw


@pytest.mark.asyncio
async def test_local_images_never_leave_without_consent_and_bad_adoption_preserves_data(config, monkeypatch):
    import io
    import base64
    from PIL import Image
    from python.api import cloud_sync
    from python.api.chat import _save_settings
    from python.storage.library import store_assets
    from python.cloud.transfers import snapshot_pages, apply_download
    output = io.BytesIO()
    Image.new("RGB", (8, 8), "blue").save(output, "PNG")
    raw = output.getvalue()
    key = hashlib.sha256(raw).hexdigest()
    local = CloudStorageContext.for_owner(config.root / "local", str(uuid4()))
    with storage_context(local):
        await storage.init_db()
        await _save_settings("keep", "keep local data", 0.8)
        store_assets({key: (raw, "image/png")})
        path = local.directory / "data.db"
        before = export_snapshot(path)
        monkeypatch.setattr(storage, "DB_PATH", path)
        monkeypatch.setattr(cloud_sync, "read_config", lambda: {"mode": "all", "selected": [], "revision": 0, "image_consent": False})
        calls = []
        async def remote(config, endpoint, **kwargs):
            calls.append((endpoint, kwargs))
            return {"transfer_id": "test", "chain": "test"}
        monkeypatch.setattr(cloud_sync, "remote", remote)
        with pytest.raises(ValueError, match="画像のクラウド保存"):
            await cloud_sync.push()
        assert all(not kwargs.get("body", {}).get("assets") for _, kwargs in calls)
        pages = list(snapshot_pages(path, include_assets=True))
        image = next(p for p in pages if p["table"] == "library_assets")
        image["assets"][key]["base64"] = base64.b64encode(b"invalid image").decode()
        with pytest.raises(CloudError, match="sync_asset_hash_mismatch"):
            apply_download(path, None, pages)
        assert export_snapshot(path) == before
        assert (local.directory / "library_assets" / key).read_bytes() == raw


@pytest.mark.asyncio
@pytest.mark.parametrize("blocked_output", [False, True])
async def test_generation_quote_screened_commit_and_idempotency(config, blocked_output):
    safety_calls = 0

    def respond(request):
        nonlocal safety_calls
        payload = json.loads(request.content)
        assert payload["model"] == "deepseek-flash" and payload["thinking"] == {
            "type": "disabled"
        }
        if not payload.get("stream"):
            safety_calls += 1
            # Reject only post-generation screening in the negative case.
            decision = not (blocked_output and safety_calls == 2)
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": json.dumps({"sfw": decision})}, "finish_reason": "stop"}
                    ],
                    "usage": {"prompt_tokens": 30, "completion_tokens": 5},
                },
            )
        output = {
            "reply": "hello from a character",
            "state_update": {
                "location": "park",
                "time": "day",
                "mood": "happy",
                "active_scene": "talking",
                "relationship_state": {
                    "stage": "stranger",
                    "tone": "neutral",
                    "unresolved_conflict": False,
                },
            },
        }
        events = [
            {
                "choices": [
                    {"delta": {"content": json.dumps(output)}, "finish_reason": None}
                ]
            },
            {"choices": [{"delta": {}, "finish_reason": "stop"}]},
            {
                "choices": [],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 80,
                    "prompt_cache_hit_tokens": 0,
                },
            },
        ]
        raw = (
            "".join("data: " + json.dumps(event) + "\n\n" for event in events)
            + "data: [DONE]\n\n"
        )
        return httpx.Response(
            200, content=raw, headers={"content-type": "text/event-stream"}
        )

    app = create_app(config, transport=httpx.MockTransport(respond))
    owner = account(app.state.store)
    app.state.store.grant(owner, 10_000, time.time() + 300, "test", "test")
    body = {
        "model_id": "cloud-standard",
        "session_id": "a",
        "generation_id": "op-a",
        "messages": [{"role": "user", "content": "hello"}],
    }
    async with await client_for(app, owner) as client:
        quote = (await client.post("/api/cloud/quotes", json=body)).json()
        assert quote["max_credits"] > 0
        body.update(quote_id=quote["quote_id"], max_credits=quote["max_credits"])
        result = (await client.post("/api/chat", json=body)).json()
        history = (await client.get("/api/chat/history?session_id=a")).json()["history"]
        if blocked_output:
            assert result["status"] == "failed" and result["charged_credits"] == 0
            assert history == []
            assert app.state.store.balance(owner) == 11_000
        else:
            assert result["status"] == "completed", result
            assert len(history) == 2
            assert result["charged_credits"] == TARIFF.credits(
                2 * (30 * 300 + 5 * 1200) + 100 * 300 + 80 * 1200
            )
            assert result["charged_credits"] <= quote["max_credits"]
            assert "raw_prompt" not in result and "attempts" not in result
            replay = (await client.post("/api/chat", json=body)).json()
            assert replay["status"] == "completed"
            assert safety_calls == 2
            assert (await client.get("/api/cloud/sync")).json()["revision"] == 1


@pytest.mark.asyncio
async def test_lot_reservations_are_atomic(config):
    from concurrent.futures import ThreadPoolExecutor

    store = CloudStore(config)
    owner = account(store)
    quotes = [
        store.quote(owner, str(i), 600, 10_000_000, "cloud-standard") for i in range(2)
    ]

    def attempt(i):
        try:
            store.reserve(owner, str(i), str(i), quotes[i], 600)
            return "ok"
        except CloudError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    assert sorted(results) == ["insufficient_credits", "ok"]
    assert store.balance(owner) == 400


@pytest.mark.asyncio
async def test_stripe_funded_purchase_replay_and_refund(config):
    from python.cloud.billing import StripeBilling

    store = CloudStore(
        replace(config, stripe_key="sk_test_fake", stripe_webhook_secret="whsec_test")
    )
    owner = account(store)
    with store.transaction() as db:
        db.execute("UPDATE accounts SET customer='cus_test' WHERE id=?", (owner,))
    refunded = False

    def respond(request):
        if request.url.path.endswith("checkout/sessions/cs_test"):
            return httpx.Response(
                200,
                json={
                    "mode": "payment",
                    "payment_status": "paid",
                    "metadata": {"sku": "credits_5"},
                    "payment_intent": "pi_test",
                },
            )
        charge = {
            "customer": "cus_test",
            "payment_intent": "pi_test",
            "refunded": refunded,
            "amount_refunded": 500 if refunded else 0,
            "disputed": False,
            "billing_details": {"address": {"country": "US"}},
            "balance_transaction": {
                "currency": "usd",
                "status": "available",
                "net": 460,
            },
        }
        if "payment_intents" in request.url.path:
            return httpx.Response(
                200,
                json={
                    "status": "succeeded",
                    "customer": "cus_test",
                    "latest_charge": charge,
                },
            )
        if "charges" in request.url.path:
            return httpx.Response(200, json=charge)
        raise AssertionError(request.url.path)

    billing = StripeBilling(store, Backups(store), httpx.MockTransport(respond))

    def signed(event):
        raw = json.dumps(event).encode()
        stamp = str(int(time.time()))
        sig = hmac.new(
            b"whsec_test", stamp.encode() + b"." + raw, hashlib.sha256
        ).hexdigest()
        return raw, "t=" + stamp + ",v1=" + sig

    event = {
        "id": "evt_purchase",
        "type": "checkout.session.completed",
        "data": {"object": {"id": "cs_test"}},
    }
    raw, sig = signed(event)
    await billing.webhook(raw, sig)
    assert store.balance(owner) == 1000
    assert await billing.work_once()
    assert store.balance(owner) == 51000
    await billing.webhook(raw, sig)
    assert not await billing.work_once()
    with store.transaction() as db:
        db.execute("UPDATE funds SET remaining=0 WHERE kind='subsidy'")
    reserve(store, owner, "a", 1_000_000, 60)
    store.settle(owner, "a", 500_000, success=True)
    refunded = True
    raw, sig = signed(
        {
            "id": "evt_refund",
            "type": "charge.refunded",
            "data": {"object": {"id": "ch_test"}},
        }
    )
    await billing.webhook(raw, sig)
    assert await billing.work_once()
    assert store.balance(owner) == 970  # earlier trial lot paid for the successful turn
    with store.transaction() as db:
        assert (
            db.execute("SELECT SUM(amount) FROM budget_debt").fetchone()[0] == 500_000
        )


@pytest.mark.asyncio
async def test_queue_fairness_and_cancelled_waiters():
    from python.cloud.queue import GenerationQueue

    queue = GenerationQueue(concurrency=1)
    order = []
    held = asyncio.Event()
    release = asyncio.Event()

    async def blocker():
        async with queue.slot():
            held.set()
            await release.wait()

    async def job(name, weight):
        async with queue.slot(weight):
            order.append(name)

    block = asyncio.create_task(blocker())
    await held.wait()
    tasks = [
        asyncio.create_task(job(name, weight))
        for name, weight in [("p1", 2), ("p2", 2), ("n1", 1), ("p3", 2), ("n2", 1)]
    ]
    await asyncio.sleep(0)
    release.set()
    await asyncio.gather(block, *tasks)
    assert order.index("n1") < order.index("p3")
    assert order[-1] == "n2" and queue.active == 0


@pytest.mark.asyncio
async def test_large_paged_sync_atomic_commit_and_selected_adoption(config):
    import sqlite3
    from python.cloud.transfers import Transfers, apply_download

    store = CloudStore(config)
    owner = account(store)
    context = CloudStorageContext.for_owner(config.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
    path = context.directory / "data.db"
    with sqlite3.connect(path) as db:
        db.executemany(
            "INSERT INTO chat_history(session_id,role,content) VALUES('large','user',?)",
            [("persistent-memory-" + "x" * 4096,)] * 4300,
        )
    with pytest.raises(CloudError, match="sync_batch_too_large"):
        export_snapshot(path)
    service = SyncService(store)
    service.settings(owner, "all")
    transfers = Transfers(store, service)
    download = transfers.download(owner, path, None)
    upload = transfers.create(
        owner, direction="upload", selected=None, revision=0, request_id="large-test"
    )
    with sqlite3.connect(path) as db:
        db.execute("DELETE FROM chat_history")
    for i in range(download["pages"]):
        page = transfers.page(owner, download["transfer_id"], i)
        if i == 0:
            with pytest.raises(CloudError, match="transfer_page_order"):
                transfers.has_page(owner, upload, 1, page)
        transfers.validate_page(owner, upload, page, path)
        transfers.append(owner, upload, i, page)
        assert transfers.has_page(owner, upload, i, page)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0] == 0
    meta = transfers.inspect(owner, upload)
    with pytest.raises(CloudError, match="transfer_incomplete"):
        transfers.commit(
            owner, upload, path, pages=meta["next"] - 1, chain=meta["chain"]
        )
    transfers.check_capacity(owner, upload, path)
    result = transfers.commit(
        owner, upload, path, pages=meta["next"], chain=meta["chain"]
    )
    assert result == {"revision": 1}
    assert (
        transfers.commit(owner, upload, path, pages=meta["next"], chain=meta["chain"])
        == result
    )
    assert b"persistent-memory" not in transfers.file(owner, upload).read_bytes()
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0] == 4300
        db.execute(
            "INSERT INTO chat_history(id,session_id,role,content) VALUES(99999,'other','user','retain-other')"
        )
        db.execute("DELETE FROM chat_history WHERE session_id='large'")
    # A selected adoption preserves unrelated local sessions.
    pages = (
        transfers.page(owner, download["transfer_id"], i)
        for i in range(download["pages"])
    )
    apply_download(path, ["large"], pages)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0] == 4301
    with pytest.raises(CloudError, match="transfer_not_found"):
        transfers.inspect(str(uuid4()), upload)


@pytest.mark.asyncio
async def test_sync_pages_screened_replay_and_export_without_secrets(config):
    import io
    import zipfile
    from python.api.chat import _save_settings
    from python.cloud.transfers import snapshot_pages

    calls = 0

    def respond(request):
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": '{"sfw":true}'}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 5},
            },
        )

    app = create_app(config, transport=httpx.MockTransport(respond))
    owner = account(app.state.store)
    context = CloudStorageContext.for_owner(config.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        await _save_settings("a", "remember-the-character", 0.8)
        page = next(snapshot_pages(context.directory / "data.db", ["a"]))
    app.state.store.secret(owner, "deepseek", "sk-must-never-export")
    async with await client_for(app, owner) as client:
        await client.put("/api/cloud/sync", json={"mode": "selected"})
        response = await client.post(
            "/api/cloud/sync/transfers",
            json={
                "direction": "upload",
                "selected_sessions": ["a"],
                "base_revision": 0,
                "request_id": "test-pages",
            },
        )
        assert response.status_code == 200, response.text
        transfer = response.json()["transfer_id"]
        route = f"/api/cloud/sync/transfers/{transfer}"
        first = await client.put(route + "/pages/0", json=page)
        assert first.status_code == 200, first.text
        assert (await client.put(route + "/pages/0", json=page)).status_code == 200
        assert calls == 1
        committed = await client.post(
            route + "/commit", json={"pages": 1, "chain": first.json()["chain"]}
        )
        assert committed.status_code == 200, committed.text
        export = await client.get("/api/cloud/export")
        assert export.status_code == 200
        with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
            raw = b"".join(archive.read(name) for name in archive.namelist())
            assert (
                b"remember-the-character" in raw and b"sk-must-never-export" not in raw
            )
        assert not list((config.root / "exports" / owner).iterdir())


def test_pending_tariff_stays_fixed_and_old_quotes_are_rejected(config, monkeypatch):
    import python.cloud.store as ledger

    store = CloudStore(config)
    owner = account(store)
    reserve(store, owner, "fixed-rate", 1_000_000, 60)
    quote = store.quote(owner, "unaccepted", 60, 1_000_000, "cloud-standard")
    monkeypatch.setattr(ledger, "TARIFF", replace(TARIFF, version="new", markup=12))
    assert (
        store.settle(owner, "fixed-rate", 500_000, success=True)["charged_credits"]
        == 30
    )
    with pytest.raises(CloudError, match="quote_expired"):
        store.reserve(owner, "new", "unaccepted", quote, 60)


@pytest.mark.asyncio
async def test_missing_safety_usage_prevents_hosted_save(config):
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"choices": [{"message": {"content": '{"sfw":true}'}}]}
        )
    )
    app = create_app(config, transport=transport)
    owner = account(app.state.store)
    async with await client_for(app, owner) as client:
        result = await client.put(
            "/api/chat/settings",
            json={"session_id": "a", "system_prompt": "must-not-persist"},
        )
        assert (
            result.status_code == 503
            and result.json()["error"] == "provider_usage_unavailable"
        )
        assert (await client.get("/api/chat/settings?session_id=a")).json()[
            "system_prompt"
        ] == ""
        assert app.state.store.balance(owner) == 1000


@pytest.mark.asyncio
@pytest.mark.parametrize("inside_backup_root", [False, True])
async def test_encrypted_disaster_restore_new_environment_keeps_retained_versions(
    config,
    inside_backup_root,
):
    import importlib.util
    from pathlib import Path
    from python.api.chat import _save_settings

    spec = importlib.util.spec_from_file_location(
        "cloud_admin_test", Path(__file__).parents[1] / "scripts/cloud_admin.py"
    )
    admin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(admin)
    source = CloudStore(config)
    owner = account(source)
    with source.transaction() as db:
        db.execute(
            "UPDATE accounts SET plan='plus',plan_until=? WHERE id=?",
            (time.time() + 1000, owner),
        )
    context = CloudStorageContext.for_owner(config.root / "tenants", owner)
    with storage_context(context):
        await storage.init_db()
        await _save_settings("a", "disaster-restored-memory", 0.8)
        version = Backups(source).create(owner, context.directory / "data.db")
    destination = (config.backup_root if inside_backup_root else config.root.parent) / "disaster.kybackup"
    admin.disaster_backup(source, destination)
    assert b"disaster-restored-memory" not in destination.read_bytes()
    target = CloudStore(
        replace(
            config,
            root=config.root.parent / "new-runtime",
            backup_root=config.root.parent / "new-backups",
        )
    )
    admin.disaster_restore(target, destination)
    assert target.balance(owner) == 1000
    assert version in {r["id"] for r in Backups(target).list(owner)}
    assert "disaster-restored-memory" in json.dumps(
        export_snapshot(target.config.root / "tenants" / owner / "data.db")
    )
    with pytest.raises(ValueError, match="empty"):
        admin.disaster_restore(target, destination)


@pytest.mark.asyncio
async def test_cloud_text_card_import_and_tenant_isolation(config):
    response = {
        "choices": [{"message": {"content": '{"sfw":true}'}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 5},
    }
    app = create_app(
        config,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(200, json=response)
        ),
    )
    owner, other = account(app.state.store), account(app.state.store)
    card = {
        "spec": "chara_card_v2",
        "spec_version": "2.0",
        "data": {
            "name": "Cyan",
            "description": "a friendly guide",
            "personality": "curious",
            "scenario": "a town",
            "first_mes": "hello",
            "mes_example": "",
            "creator_notes": "",
            "tags": [],
        },
    }
    async with await client_for(app, owner) as client:
        preview = await client.post(
            "/api/imports/preview",
            files={
                "file": (
                    "character.json",
                    json.dumps(card).encode(),
                    "application/json",
                )
            },
        )
        assert preview.status_code == 200, preview.text
        value = preview.json()
        result = await client.post(
            "/api/imports/" + value["preview_id"] + "/commit",
            json={
                "request_id": "import-a",
                "selections": [
                    {
                        "index": 0,
                        "document": value["documents"][0],
                        "history_indices": [],
                    }
                ],
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["items"][0]["document"]["name"] == "Cyan"
        assert app.state.store.balance(owner) == 1000
        denied = await client.post(
            "/api/imports/preview",
            files={"file": ("card.png", b"\x89PNG\r\n\x1a\n", "image/png")},
        )
        assert denied.status_code == 503
    async with await client_for(app, other) as client:
        assert (await client.get("/api/library")).json()["items"] == []


@pytest.mark.asyncio
async def test_absolute_session_expiry_revokes_sync_access(config):
    app = create_app(config)
    owner = account(app.state.store)
    async with await client_for(app, owner) as client:
        token = (await client.post("/api/cloud/sync/device")).json()["token"]
        with app.state.store.transaction() as db:
            db.execute(
                "UPDATE sessions SET valid_until=? WHERE owner=?",
                (time.time() - 1, owner),
            )
        assert (await client.get("/api/cloud/account")).status_code == 401
        assert (
            await client.get(
                "/api/cloud/sync", headers={"Authorization": "Bearer " + token}
            )
        ).status_code == 401
