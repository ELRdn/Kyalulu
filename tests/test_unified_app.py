"""Unified contracts are tested without real ads, payments, identities or inference."""
from dataclasses import replace
import time
from uuid import uuid4
import json
from pathlib import Path

import pytest
from python.cloud.config import CloudConfig
from python.cloud.contracts import purchase_terms
from python.cloud.store import CloudStore, CloudError
from python.cloud.unified import UnifiedService


@pytest.fixture
def service(tmp_path):
    config = CloudConfig(root=tmp_path, origin="https://app.test", secret="s" * 32,
                         unified_enabled=True, ads_enabled=True, legal_approved=True)
    return UnifiedService(CloudStore(config), region_policies={"JP": {
        "accepted": True, "minimum_age": 13, "guardian_below": 18,
        "adult_accepted": True, "version": "test-1"}}, ad_provider=object())


@pytest.mark.asyncio
async def test_migration_document_is_neutral_and_device_remains_isolated(tmp_path):
    import httpx
    from python.cloud.app import create_app
    dist = tmp_path / 'web'
    for document in ('index.html', 'device/index.html', 'migration/index.html'):
        target = dist / document; target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(document, encoding='utf-8')
    config = CloudConfig(root=tmp_path, origin='https://app.test', secret='s' * 32, web_dist=dist)
    app = create_app(config, transport=httpx.MockTransport(lambda _: pytest.fail('No provider calls')))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=config.origin) as client:
        for path in ('/migration', '/migration/', '/migration/index.html'):
            response = await client.get(path)
            assert response.status_code == 200 and response.text == 'migration/index.html'
            assert response.headers['cross-origin-opener-policy'] == 'unsafe-none'
            assert response.headers['cross-origin-embedder-policy'] == 'unsafe-none'
            assert "connect-src 'none'" in response.headers['content-security-policy']
        isolated = await client.get('/device/')
        assert isolated.headers['cross-origin-opener-policy'] == 'same-origin'
        assert isolated.headers['cross-origin-embedder-policy'] == 'require-corp'
        assert "frame-src 'none'" in isolated.headers['content-security-policy']
        (dist / 'migration/index.html').unlink()
        assert (await client.get('/migration/')).status_code == 503


def owner(service):
    value = str(uuid4())
    service.store.account(value, consent="test")
    return value


def change(entity="chat", revision=0, text="hello", **kw):
    return {"id": entity, "kind": "conversation", "base_revision": revision,
            "payload": {"storage_policy": "sync", "messages": [{"content": text}], **kw}}


def test_subscription_prices_bonus_and_funding(service):
    assert purchase_terms("plus")["credits"] == 50_000
    assert purchase_terms("pro")["credits"] == 125_000
    assert purchase_terms("credits_5")["credits"] == 37_500
    assert purchase_terms("credits_10", subscriber=True)["credits"] == 90_000
    user = owner(service)
    terms = purchase_terms("pro")
    with pytest.raises(CloudError, match="payment_funding_insufficient"):
        service.store.receipt(user, "bad", "pro", 1, time.time() + 30 * 86400,
                              event_id="bad", event_hash="a", terms=terms)
    before = time.time()
    service.store.receipt(user, "paid", "pro", 5_000_000_000, before + 30 * 86400,
                          event_id="paid", event_hash="b", terms=terms)
    assert service.store.balance(user) == 125_000
    with service.store.transaction() as db:
        lot = db.execute("SELECT expires FROM credit_lots WHERE source='paid'").fetchone()
        assert before + 60 * 86400 <= lot[0] < before + 60 * 86400 + 2
    service.store.receipt(user, "paid", "pro", 5_000_000_000, before + 30 * 86400,
                          event_id="paid", event_hash="b", terms=terms)
    assert service.store.balance(user) == 125_000
    service.store.revoke_receipt("paid", owner=user)
    assert service.store.balance(user) == 0


def test_daily_is_atomic_bounded_and_durable(service):
    user = owner(service)
    assert service.daily(user)["granted"]
    assert not service.daily(user)["granted"]
    assert service.store.balance(user) == 100
    reopened = UnifiedService(CloudStore(service.store.config))
    assert not reopened.daily(user)["granted"]
    assert reopened.store.balance(user) == 100
    exhausted = UnifiedService(CloudStore(replace(service.store.config, root=service.store.config.root / "empty",
                                               monthly_subsidy_jpy=0)))
    with pytest.raises(CloudError, match="free_budget_exhausted"):
        exhausted.daily(owner(exhausted))


def test_initial_grant_is_backed_for_thirty_days_and_cannot_repeat(service):
    user = str(uuid4())
    before = time.time()
    service.store.account(user, consent='test', enroll=True)
    assert service.store.balance(user) == 1000
    assert not service.store.trial(user)
    with service.store.transaction() as db:
        lot = db.execute("SELECT expires FROM credit_lots WHERE source=?", ('trial:' + user,)).fetchone()
        fund = db.execute("SELECT expires FROM funds WHERE id=?", ('reward:trial:' + user,)).fetchone()
        assert lot[0] == fund[0] and lot[0] >= before + 30 * 86400


def test_rewards_need_trusted_completion_and_replay_is_once(service, monkeypatch):
    user = owner(service)
    start = time.time()
    offer = service.offer(user, {"seconds": 15})
    assert offer["credits"] == 150
    with pytest.raises(CloudError, match="reward_already_pending"):
        service.offer(user, {"seconds": 15})
    event = {"event_id": "verified-provider-event", "offer_id": offer["id"], "seconds": 15,
             "completed_at": start + 16}
    with pytest.raises(CloudError, match="ad_receipt_not_completed"):
        service.complete_reward(event)
    monkeypatch.setattr(time, "time", lambda: start + 17)
    assert service.complete_reward(event)["granted"]
    assert not service.complete_reward(event)["granted"]
    assert service.store.balance(user) == 150
    # No daily cap: a completed offer permits the next funded offer.
    assert service.offer(user, {"seconds": 30})["credits"] == 300
    with pytest.raises(CloudError, match="reward_not_found"):
        service.reward(owner(service), offer["id"])


def test_interrupted_ads_release_only_their_original_funds(service, monkeypatch):
    user = owner(service)
    start = time.time()
    offer = service.offer(user, {"seconds": 15})
    monkeypatch.setattr(time, "time", lambda: start + 86401)
    assert service.reward(user, offer["id"])["state"] == "expired"
    assert service.store.balance(user) == 0
    assert service.offer(user, {"seconds": 15})


def test_sync_conflicts_branch_and_deletions_never_resurrect(service):
    user, other = owner(service), owner(service)
    first = service.push(user, "first", [change()])
    assert service.push(user, "first", [change()]) == first
    with pytest.raises(CloudError, match="sync_request_conflict"):
        service.push(user, "first", [change(text="different")])
    branch = service.push(user, "offline", [change(text="another continuation")])["changes"][0]
    assert branch["branched"] and branch["id"] != "chat"
    assert len(service.pull(user)["changes"]) == 2
    assert service.pull(other)["changes"] == []
    service.push(user, "delete", [{**change(revision=1), "deleted": True, "delete_confirmed": True}])
    assert service.push(user, "late", [change(revision=1)])["changes"][0]["deleted"]
    with pytest.raises(CloudError, match="device_only_data_not_uploadable"):
        service.push(user, "private", [change(entity="private", storage_policy="local")])


def test_age_policy_and_publication_boundaries(service):
    user = owner(service)
    service.store.secret(user, 'app-eligibility', json.dumps(service.general_eligibility('JP', 20)))
    with pytest.raises(CloudError, match="region_policy_pending"):
        service.general_eligibility("XX", 20)
    with pytest.raises(CloudError, match="minimum_age_required"):
        service.general_eligibility("JP", 12)
    with pytest.raises(CloudError, match="verified_guardian_consent_required"):
        service.general_eligibility("JP", 15)
    assert service.general_eligibility("JP", 20)["age_band"] == "adult"
    doc = {"name": "Character", "data": {"personality": "hello", "memories": "private"}}
    with pytest.raises(CloudError, match="adult_verification_required"):
        service.submit(user, doc, "adult")
    service.record_age_result(user, country="JP", adult=True, expires=time.time() + 60,
                              receipt="provider-receipt", policy="test-1")
    service.publications.consent(user, True)
    submission = service.submit(user, doc, "adult")
    assert submission["status"] == "pending"
    with service.store.transaction() as db:
        assert "private" not in db.execute("SELECT payload FROM app_publications").fetchone()[0]
    with pytest.raises(CloudError, match="moderator_required"):
        service.review(user, submission["id"], 1, "approved", "reviewed")


def test_revenue_is_idempotent_and_does_not_consume_operator_allowance(service):
    service.revenue('settled-net-1', 1_000_000_000)
    service.revenue('settled-net-1', 1_000_000_000)
    with pytest.raises(CloudError, match='ad_revenue_conflict'):
        service.revenue('settled-net-1', 2_000_000_000)
    with service.store.transaction() as db:
        assert db.execute("SELECT SUM(remaining) FROM funds WHERE kind='ad-revenue'").fetchone()[0] == 1_000_000_000
        assert db.execute('SELECT COUNT(*) FROM operator_fundings').fetchone()[0] == 0


def test_sync_credentials_hidden_adult_and_malformed_changes_are_rejected(service):
    user = owner(service)
    for payload in ({'api_key': 'secret'}, {'settings': {'refresh_token': 'secret'}}):
        with pytest.raises(CloudError, match='credentials_not_syncable'):
            service.push(user, 'secret', [change(**payload)])
    with pytest.raises(CloudError, match='adult_cloud_storage_awaiting_acceptance'):
        service.push(user, 'adult', [change(character={'nsfw': True})])
    with pytest.raises(CloudError, match='invalid_sync_entity'):
        service.push(user, 'broken', [{'id': 'broken'}])


def test_ads_are_closed_without_legal_acceptance(service):
    service.store.config = replace(service.store.config, legal_approved=False)
    with pytest.raises(CloudError, match='ad_provider_awaiting_acceptance'):
        service.offer(owner(service), {'seconds': 15})


def test_browser_core_shared_fixtures(monkeypatch):
    from python.core.memory import retrieve
    from python.core import story
    from python.core.schemas import RuntimeState, CompiledPrompt
    from python.storage.conversation import _extract
    fixture = json.loads((Path(__file__).parent / 'fixtures/unified-core.json').read_text(encoding='utf-8'))
    memory = fixture['memory']
    result = retrieve(memory['memories'], memory['query'])
    assert result['injected'] == memory['injected']
    assert result['injected_tokens'] == memory['tokens']
    assert {c['id']: c['decision'] for c in result['candidates']} == memory['decisions']
    rpg = fixture['rpg']
    monkeypatch.setattr(story.secrets, 'randbelow', lambda _: rpg['die'] - 1)
    _, state = story.prepare(CompiledPrompt(system_prompt='', sections={'story': {'rpg': rpg['options']}}),
                             RuntimeState(), [{'role': 'user', 'content': rpg['input']}], rpg['generation_id'])
    assert state == rpg['expected']
    assert _extract(fixture['summary']['messages']) == fixture['summary']['expected']


@pytest.mark.asyncio
async def test_login_requires_server_issued_eligibility_not_local_age(service):
    from python.cloud.auth import SupabaseAuth
    cfg = replace(service.store.config, supabase_url='https://supabase.test', supabase_key='test', region_policies=tuple(service.regions.items()))
    auth = SupabaseAuth(cfg, service.store)
    with pytest.raises(CloudError, match='eligibility_confirmation_required'):
        await auth.begin(provider='google', consent=True, country='JP', eligibility_ticket='age=25')
    ticket = service.eligibility_ticket('JP', 25)['ticket']
    assert service.verify_eligibility_ticket(ticket, 'JP')['age_band'] == 'adult'
    with pytest.raises(CloudError, match='eligibility_confirmation_required'):
        service.verify_eligibility_ticket(ticket, 'US')
    flow, result = await auth.begin(provider='google', consent=True, country='JP', eligibility_ticket=ticket)
    assert flow and result['url'].startswith('https://supabase.test/')
    user = owner(service)
    with pytest.raises(CloudError, match='eligibility_confirmation_required'):
        service.require_general(user)
    value = service.verify_eligibility_ticket(ticket, 'JP')
    service.store.secret(user, 'app-eligibility', json.dumps(value))
    service.require_general(user)


@pytest.mark.asyncio
async def test_checkout_retries_keep_original_price_bonus_and_expiry(service, monkeypatch):
    from python.cloud.billing import StripeBilling
    from types import SimpleNamespace
    service.store.config = replace(service.store.config, billing_enabled=True, inference_enabled=True,
        openrouter_approved=True, openrouter_key='test-only', stripe_prices=(('credits_5', 'price-old'),))
    user = owner(service)
    with service.store.transaction() as db:
        db.execute("UPDATE accounts SET plan='plus',plan_until=?,customer='cus-test' WHERE id=?", (time.time() + 86400, user))
    billing = StripeBilling(service.store, SimpleNamespace(admission=lambda *args, **kwargs: None))
    calls = []
    async def call(path, **kwargs):
        assert path == 'checkout/sessions'
        calls.append(kwargs['data'])
        return {'url': 'https://checkout.stripe.com/test-fixture'}
    monkeypatch.setattr(billing, 'call', call)
    await billing.checkout(user, 'credits_5', 'same-request')
    with service.store.transaction() as db:
        db.execute("UPDATE accounts SET plan='free',plan_until=0 WHERE id=?", (user,))
        terms = json.loads(db.execute('SELECT terms FROM checkout_terms').fetchone()[0])
    assert terms['credits'] == 45_000
    billing.config = replace(service.store.config, stripe_prices=(('credits_5', 'price-new'),))
    await billing.checkout(user, 'credits_5', 'same-request')
    assert calls[0] == calls[1]
    assert calls[1]['line_items[0][price]'] == 'price-old'


def test_malformed_untrusted_values_fail_closed(service):
    user = owner(service)
    for country in ([], {}, None):
        with pytest.raises(CloudError, match='region_policy_pending'):
            service.general_eligibility(country, 25)
    with pytest.raises(CloudError, match='invalid_preferences'):
        service.preferences(user, {'language': []})
    with pytest.raises(CloudError, match='invalid_publication'):
        service.submit(user, {}, [])
    with pytest.raises(CloudError, match='invalid_sync_entity'):
        service.push(user, 'nan', [change(value=float('nan'))])


@pytest.mark.asyncio
async def test_unified_http_guest_and_provider_boundaries(service):
    import httpx
    from python.cloud.app import create_app
    cfg = replace(service.store.config, region_policies=tuple(service.regions.items()))
    def no_external(request):
        pytest.fail('Boundary fixtures must not call external providers')
    app = create_app(cfg, transport=httpx.MockTransport(no_external))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url=cfg.origin,
                                headers={'Origin': cfg.origin}) as client:
        result = await client.post('/api/cloud/app/eligibility', json={'country': 'JP', 'age': 25})
        assert result.status_code == 200 and result.json()['ticket']
        assert (await client.post('/api/cloud/app/eligibility', json={'country': [], 'age': 25})).status_code == 403
        assert (await client.get('/api/cloud/app/preferences')).status_code == 401
        assert (await client.post('/api/cloud/app/rewards/webhook', json={'seconds': 15, 'completed': True})).status_code == 503
        status = (await client.get('/api/cloud/status')).json()
        assert not status['authenticated'] and status['app_commercial']['subscriber'] is False
    with service.store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM accounts').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM credit_lots').fetchone()[0] == 0
