"""Real account-scoped profile persistence, concurrent devices and access checks."""

import asyncio
from uuid import uuid4

import httpx
import pytest

from python.cloud.account_profile import AccountProfile
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version
from python.cloud.config import CloudConfig
from python.cloud.store import CloudError, CloudStore


def config(path):
    return CloudConfig(root=path, origin="https://cloud.test", secret="s" * 32,
                       supabase_url="https://supabase.test", supabase_key="anon-test",
                       legal_approved=True)


def enroll(store, owner, name="Owner"):
    store.account(owner, consent=provider_consent_version(store.config))
    store.secret(owner, "identity", '{"display_name":"' + name + '"}')


def test_profile_is_encrypted_persistent_and_preserves_custom_name_after_login(tmp_path):
    cfg = config(tmp_path)
    store = CloudStore(cfg)
    owner = str(uuid4())
    enroll(store, owner)
    profiles = AccountProfile(store)
    initial = profiles.read(owner)
    assert initial["revision"] == 0 and initial["display_name"] == "Owner"
    for change in [{"display_name": "Cyan の友達"}, {"toggle_saved": "mocha_sfw"},
                   {"toggle_pin": "chat-1"}]:
        initial = profiles.update(owner, {"revision": initial["revision"], "change": change})
    with store.transaction() as db:
        encrypted = db.execute("SELECT value FROM secrets WHERE kind='account-profile'").fetchone()[0]
        assert "Cyan" not in encrypted and "mocha_sfw" not in encrypted
    store.secret(owner, "identity", '{"display_name":"Google renamed me"}')
    restored = AccountProfile(CloudStore(cfg)).read(owner)
    assert restored == initial and restored["display_name"] == "Cyan の友達"
    assert restored["saved_characters"] == ["mocha_sfw"]
    assert restored["pinned_sessions"] == ["chat-1"]


@pytest.mark.parametrize("body", [
    {"revision": True, "change": {"display_name": "Test"}},
    {"revision": 0, "change": {"display_name": ""}},
    {"revision": 0, "change": {"display_name": "x" * 81}},
    {"revision": 0, "change": {"display_name": "One\nTwo"}},
    {"revision": 0, "change": {"email": "other@example.test"}},
    {"revision": 0, "change": {"toggle_saved": "x\x00"}},
    {"revision": 0, "change": {"display_name": "Test"}, "owner": "other"},
])
def test_profile_rejects_invalid_or_identity_mutating_input(tmp_path, body):
    store = CloudStore(config(tmp_path))
    owner = str(uuid4())
    enroll(store, owner)
    profiles = AccountProfile(store)
    with pytest.raises(CloudError):
        profiles.update(owner, body)
    assert profiles.read(owner)["revision"] == 0


@pytest.mark.asyncio
async def test_authenticated_devices_share_profile_reject_stale_edits_and_isolate_accounts(tmp_path):
    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(lambda _: pytest.fail("no external requests")))
    store = app.state.store
    owners = [str(uuid4()), str(uuid4())]
    for owner in owners:
        enroll(store, owner)
    tokens = ["device-one", "device-two", "other-owner"]
    for token, owner in zip(tokens, [owners[0], owners[0], owners[1]]):
        app.state.auth.save(token, owner, {"access_token": "fixture-access",
                            "refresh_token": "fixture-refresh", "expires_in": 3600})
    clients = [httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
                headers={"Origin": cfg.origin}, cookies={SESSION_COOKIE: token}) for token in tokens]
    first, second, other = clients
    try:
        assert (await other.get("/api/cloud/profile")).json()["revision"] == 0
        replies = await asyncio.gather(*[
            client.put("/api/cloud/profile", json={"revision": 0, "change": {"display_name": name}})
            for client, name in [(first, "Device A"), (second, "Device B")]])
        assert sorted(r.status_code for r in replies) == [200, 409]
        shared = (await second.get("/api/cloud/profile")).json()
        assert shared["revision"] == 1
        assert (await first.get("/api/cloud/profile")).json() == shared
        updated = await first.put("/api/cloud/profile", json={"revision": 1,
                                 "change": {"toggle_saved": "mocha_sfw"}})
        assert updated.status_code == 200
        assert (await second.get("/api/cloud/profile")).json()["saved_characters"] == ["mocha_sfw"]
        untouched = (await other.get("/api/cloud/profile")).json()
        assert untouched["revision"] == 0 and untouched["saved_characters"] == []
        assert (await second.get("/api/cloud/account")).json()["profile"]["revision"] == 2
        assert (await first.put("/api/cloud/profile", headers={"Origin": "https://evil.test"},
                               json={"revision": 2, "change": {"toggle_pin": "one"}})).status_code == 403
        with store.transaction() as db:
            assert db.execute("SELECT COUNT(*) FROM operations").fetchone()[0] == 0
            assert db.execute("SELECT COUNT(*) FROM credit_lots").fetchone()[0] == 0
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin) as anonymous:
            assert (await anonymous.get("/api/cloud/profile")).status_code == 401
    finally:
        for client in clients:
            await client.aclose()
