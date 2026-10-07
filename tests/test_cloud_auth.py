"""Verified OAuth/email identity, invitation, offline credits and budget limits."""

from dataclasses import replace
import asyncio
import hashlib
import base64
import json
import time
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4
import httpx
import pytest
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, SupabaseAuth, provider_consent_version
from python.cloud.config import CloudConfig
from python.cloud.store import CloudError, CloudStore, digest


def config(tmp_path, **kwargs):
    return replace(CloudConfig(root=tmp_path / "cloud", origin="https://cloud.test",
        secret="s" * 32, supabase_url="https://supabase.test", supabase_key="anon-test",
        private_test=True, allowed_emails=("owner@example.test",), signup_limit=1,
        trial_credits=0, monthly_subsidy_jpy=0, test_budget_nano=100_000_000,
        test_prior_cost_nano=49_548_721), **kwargs)


@pytest.mark.parametrize("suffix", ["/auth/v1", "/rest/v1", "/dashboard"])
def test_supabase_requires_project_origin(tmp_path, suffix):
    with pytest.raises(ValueError, match="Supabase HTTPS endpoint"):
        config(tmp_path, supabase_url="https://supabase.test" + suffix)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["google", None])
async def test_verified_login_pkce_account_identity_grant_and_logout(tmp_path, provider):
    cfg = config(tmp_path)
    owner = str(uuid4())
    calls = []
    def respond(request):
        calls.append(request)
        if request.url.path.endswith("/otp"):
            payload = json.loads(request.content)
            assert payload["code_challenge_method"] == "s256"
            return httpx.Response(200, json={})
        if request.url.path.endswith("/token"):
            payload = json.loads(request.content)
            assert payload["auth_code"] == "fake-code" and len(payload["code_verifier"]) >= 43
            challenge = base64.urlsafe_b64encode(hashlib.sha256(payload["code_verifier"].encode()).digest()).rstrip(b"=").decode()
            if provider == "google":
                assert challenge == parse_qs(urlsplit(login["url"]).query)["code_challenge"][0]
            else:
                assert challenge == json.loads(calls[0].content)["code_challenge"]
            return httpx.Response(200, json={"access_token":"private-access","refresh_token":"private-refresh","expires_in":3600})
        assert request.url.path.endswith("/user")
        return httpx.Response(200, json={"id":owner,"email":"owner@example.test",
            "email_confirmed_at":"2026-10-04", "user_metadata":{"full_name":"Owner"}})
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=cfg.origin,
                                headers={"Origin":cfg.origin},follow_redirects=False) as client:
        version = provider_consent_version(cfg)
        result = await client.post("/api/cloud/auth/login",json={"provider":provider,
            "email":"owner@example.test","adult":True,"consent":True,"operator_backend":"openrouter",
            "provider_consent_version":version,"provider_disclosure_version":version})
        assert result.status_code == 200
        login = result.json()
        assert "HttpOnly" in result.headers["set-cookie"] and "Secure" in result.headers["set-cookie"]
        assert "private-access" not in result.text and "private-refresh" not in result.text
        if provider == "google":
            query = parse_qs(urlsplit(login["url"]).query)
            assert query["provider"] == ["google"] and query["redirect_to"] == [cfg.origin+"/auth/callback"]
        callback = await client.get("/auth/callback?code=fake-code")
        assert callback.status_code == 303 and callback.headers["location"] == cfg.origin+"/#/"
        assert SESSION_COOKIE in callback.headers["set-cookie"]
        assert (await client.get("/api/cloud/status")).json()["authenticated"]
        account = (await client.get("/api/cloud/account")).json()
        assert account["identity"] == {"id":owner,"email":"owner@example.test","display_name":"Owner"}
        assert account["wallet"]["credits"] == 0 and not account["billing_available"]
        assert app.state.store.admin_grant(owner,500,"owner-initial-500")["granted"]
        assert app.state.store.balance(owner) == 500
        assert not app.state.store.admin_grant(owner,500,"owner-initial-500")["granted"]
        assert app.state.store.balance(owner) == 500
        await client.post("/api/cloud/auth/logout")
        assert (await client.get("/api/cloud/account")).status_code == 401
        assert not (await client.get("/api/cloud/status")).json()["authenticated"]
        assert "private-access" not in app.state.store.path.read_bytes().decode(errors="ignore")


@pytest.mark.asyncio
async def test_callback_cancellation_missing_flow_and_raw_error_are_safe(tmp_path):
    cfg=config(tmp_path)
    app=create_app(cfg,transport=httpx.MockTransport(lambda _:pytest.fail("no provider sends")))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=cfg.origin) as client:
        cancel=await client.get("/auth/callback?error=access_denied&error_description=private-text")
        assert cancel.headers["location"].endswith("login_error=login_cancelled")
        assert "private-text" not in cancel.text
        missing=await client.get("/auth/callback?code=private-code")
        assert missing.headers["location"].endswith("login_error=authentication_flow_expired")


@pytest.mark.asyncio
async def test_invitation_and_unverified_identity_cannot_create_account(tmp_path):
    cfg=config(tmp_path)
    store=CloudStore(cfg)
    auth=SupabaseAuth(cfg,store)
    with pytest.raises(CloudError,match="account_not_allowed"):
        await auth.begin(email="other@example.test",adult=True,consent=True)
    for email,verified in [("other@example.test",True),("owner@example.test",False)]:
        with pytest.raises(CloudError):
            auth.verified_owner({"id":str(uuid4()),"email":email,"email_confirmed_at":"date" if verified else None})
    with store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0


@pytest.mark.asyncio
async def test_expired_refresh_changed_identity_revokes_session(tmp_path):
    cfg=config(tmp_path)
    store=CloudStore(cfg)
    owner=str(uuid4());store.account(owner,consent=provider_consent_version(cfg))
    def respond(request):
        if request.url.path.endswith("/token"):
            return httpx.Response(200,json={"access_token":"new","refresh_token":"new-refresh","expires_in":3600})
        return httpx.Response(200,json={"id":str(uuid4()),"email":"owner@example.test","email_confirmed_at":"date"})
    auth=SupabaseAuth(cfg,store,httpx.MockTransport(respond))
    auth.save("browser-token",owner,{"access_token":"old","refresh_token":"old-refresh","expires_in":1})
    with pytest.raises(CloudError,match="authentication_failed"):
        await auth.owner("browser-token")
    with store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


def test_credits_settlement_restart_and_prior_cost_cannot_refill(tmp_path):
    cfg=config(tmp_path)
    store=CloudStore(cfg);owner=str(uuid4());store.account(owner,consent="test")
    store.admin_grant(owner,500,"once")
    quote=store.quote(owner,"hash",120,2_000_000,"cloud-standard")
    store.reserve(owner,"first","hash",quote,120)
    assert store.balance(owner) == 380
    assert store.public_wallet(owner)["reserved_credits"] == 120
    assert store.private_budget()["available_nano"] == 48_451_279
    store.settle(owner,"first",1_000_000,success=True)
    assert store.balance(owner) == 440
    wallet=store.public_wallet(owner)
    assert wallet["used_credits"] == 60 and wallet["reserved_credits"] == 0
    assert wallet["usage"][0]["charged_credits"] == 60
    restarted=CloudStore(replace(cfg,test_prior_cost_nano=0))
    assert restarted.private_budget()["available_nano"] == 49_451_279
    assert restarted.balance(owner) == 440
    assert not restarted.admin_grant(owner,500,"once")["granted"]
    with pytest.raises(CloudError,match="admin_grant_conflict"):
        restarted.admin_grant(owner,501,"once")


def test_failed_unknown_cost_counts_budget_returns_credits_and_limits_grants(tmp_path):
    store=CloudStore(config(tmp_path));owner=str(uuid4());store.account(owner,consent="test")
    with pytest.raises(CloudError,match="account_unavailable"):
        store.admin_grant(str(uuid4()),500,"missing")
    with pytest.raises(CloudError,match="operator_budget_exhausted"):
        store.admin_grant(owner,4000,"unfunded")
    store.admin_grant(owner,500,"initial")
    quote=store.quote(owner,"request",200,10_000_000,"cloud-standard")
    store.reserve(owner,"uncertain","request",quote,200)
    store.settle(owner,"uncertain",0,success=False,uncertain=True)
    assert store.balance(owner) == 500
    assert store.private_budget()["available_nano"] == 40_451_279
    quote=store.quote(owner,"next",1,40_451_280,"cloud-standard")
    with pytest.raises(CloudError,match="operator_budget_exhausted"):
        store.reserve(owner,"next","next",quote,1)


@pytest.mark.parametrize("change", [dict(allowed_emails=()),dict(signup_limit=2),dict(trial_credits=1000),
    dict(billing_enabled=True),dict(stripe_key="test"),dict(ads_enabled=True),
    dict(test_budget_nano=100_000_001),dict(test_prior_cost_nano=100_000_001)])
def test_private_config_cannot_open_registration_or_sales(tmp_path,change):
    with pytest.raises(ValueError):
        config(tmp_path,**change)


@pytest.mark.asyncio
async def test_private_billing_routes_do_not_send_to_stripe(tmp_path):
    cfg=config(tmp_path)
    app=create_app(cfg,transport=httpx.MockTransport(lambda _:pytest.fail("no Stripe requests")))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=cfg.origin) as client:
        for path in ("checkout", "portal", "webhook"):
            assert (await client.post("/api/cloud/billing/"+path)).status_code == 404


@pytest.mark.asyncio
async def test_google_callback_denies_other_email_before_account_creation(tmp_path):
    cfg=config(tmp_path)
    def respond(request):
        if request.url.path.endswith("/token"):
            return httpx.Response(200,json={"access_token":"other-access","refresh_token":"other-refresh","expires_in":3600})
        return httpx.Response(200,json={"id":str(uuid4()),"email":"other@example.test","email_confirmed_at":"date"})
    app=create_app(cfg,transport=httpx.MockTransport(respond))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url=cfg.origin,
                                headers={"Origin":cfg.origin}) as client:
        version=provider_consent_version(cfg)
        result=await client.post("/api/cloud/auth/login",json={"provider":"google","adult":True,"consent":True,
            "operator_backend":"openrouter","provider_consent_version":version,"provider_disclosure_version":version})
        assert result.status_code == 200
        callback=await client.get("/auth/callback?code=other-code")
        assert callback.headers["location"].endswith("login_error=account_not_allowed")
        assert "other-access" not in callback.text
        with app.state.store.transaction() as db:
            assert db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("refresh", [False, True])
async def test_logout_during_identity_check_cannot_restore_browser_or_sync_session(tmp_path, refresh):
    cfg = config(tmp_path)
    store = CloudStore(cfg)
    owner = str(uuid4())
    store.account(owner, consent=provider_consent_version(cfg))
    entered, release = asyncio.Event(), asyncio.Event()

    async def respond(request):
        entered.set()
        await release.wait()
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "new-access",
                "refresh_token": "new-refresh", "expires_in": 3600})
        return httpx.Response(200, json={"id": owner, "email": "owner@example.test",
            "email_confirmed_at": "date"})

    auth = SupabaseAuth(cfg, store, httpx.MockTransport(respond))
    auth.save("browser", owner, {"access_token": "old-access", "refresh_token": "old-refresh",
        "expires_in": 1 if refresh else 3600})
    with store.transaction() as db:
        db.execute("UPDATE sessions SET checked=0")
        db.execute("INSERT INTO sync_devices VALUES(?,?,?,?)",
                   (digest("device"), owner, time.time() + 3600, digest("browser")))
    task = asyncio.create_task(auth.owner("browser"))
    try:
        await asyncio.wait_for(entered.wait(), timeout=2)
        auth.logout("browser")
        release.set()
        with pytest.raises(CloudError, match="authentication_required"):
            await task
        with store.transaction() as db:
            assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM sync_devices").fetchone()[0] == 0
        with pytest.raises(CloudError, match="authentication_required"):
            await auth.owner("device", session_hash=digest("browser"))
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_concurrent_valid_refresh_rotates_once_without_extending_session_lifetime(tmp_path):
    cfg = config(tmp_path)
    store = CloudStore(cfg)
    owner = str(uuid4())
    store.account(owner, consent=provider_consent_version(cfg))
    calls = []

    async def respond(request):
        calls.append(request.url.path)
        await asyncio.sleep(0)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "new-access",
                "refresh_token": "new-refresh", "expires_in": 3600})
        return httpx.Response(200, json={"id": owner, "email": "owner@example.test",
            "email_confirmed_at": "date"})

    auth = SupabaseAuth(cfg, store, httpx.MockTransport(respond))
    auth.save("browser", owner, {"access_token": "old-access", "refresh_token": "old-refresh",
        "expires_in": 1})
    with store.transaction() as db:
        valid_until = db.execute("SELECT valid_until FROM sessions").fetchone()[0]
    assert await asyncio.gather(auth.owner("browser"), auth.owner("browser")) == [owner, owner]
    assert calls == ["/auth/v1/token", "/auth/v1/user"]
    with store.transaction() as db:
        row = db.execute("SELECT access,refresh,valid_until FROM sessions").fetchone()
        assert store.decrypt(row["access"]) == "new-access"
        assert store.decrypt(row["refresh"]) == "new-refresh"
        assert row["valid_until"] == valid_until


@pytest.mark.asyncio
async def test_http_logout_revokes_local_session_and_devices_during_supabase_outage(tmp_path):
    cfg = config(tmp_path)
    owner = str(uuid4())
    calls = []
    available = False

    def respond(request):
        calls.append(request.url.path)
        if not available:
            raise httpx.ConnectError("synthetic outage", request=request)
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "new-access",
                "refresh_token": "new-refresh", "expires_in": 3600})
        return httpx.Response(200, json={"id": owner, "email": "owner@example.test",
            "email_confirmed_at": "date"})

    app = create_app(cfg, transport=httpx.MockTransport(respond))
    store = app.state.store
    store.account(owner, consent=provider_consent_version(cfg))
    app.state.auth.save("browser", owner, {"access_token": "old-access",
        "refresh_token": "old-refresh", "expires_in": 1})
    with store.transaction() as db:
        db.execute("INSERT INTO sync_devices VALUES(?,?,?,?)",
                   (digest("device"), owner, time.time() + 3600, digest("browser")))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
                                headers={"Origin": cfg.origin}) as client:
        client.cookies.set(SESSION_COOKIE, "browser", domain="cloud.test", path="/")
        failed = await client.get("/api/cloud/account")
        assert failed.status_code == 503 and failed.json()["code"] == "authentication_unavailable"
        assert len(calls) == 1
        assert (await client.post("/api/cloud/auth/logout",
            headers={"Origin": "https://other.test"})).status_code == 403
        with store.transaction() as db:
            assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 1
            assert db.execute("SELECT COUNT(*) FROM sync_devices").fetchone()[0] == 1

        logged_out = await client.post("/api/cloud/auth/logout")
        assert logged_out.status_code == 200 and logged_out.json() == {"ok": True}
        cookie = logged_out.headers["set-cookie"]
        assert SESSION_COOKIE in cookie and "Max-Age=0" in cookie
        assert "Secure" in cookie and "HttpOnly" in cookie
        assert SESSION_COOKIE not in client.cookies
        assert len(calls) == 1  # Logout must not depend on another provider call.
        with store.transaction() as db:
            assert db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM sync_devices").fetchone()[0] == 0

        available = True
        stale = await client.get("/api/cloud/account", headers={"Cookie": SESSION_COOKIE + "=browser"})
        assert stale.status_code == 401 and stale.json()["code"] == "authentication_required"
        device = await client.get("/api/cloud/sync", headers={"Authorization": "Bearer device"})
        assert device.status_code == 401
        assert len(calls) == 1
        assert (await client.post("/api/cloud/auth/logout")).status_code == 200
