"""Wallet settlement and external-call removal; no paid network traffic."""
import json
import sqlite3
import time
from contextlib import closing
from uuid import uuid4

import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.generation import CloudChat
from python.cloud.store import CloudStore, CloudError
from python.storage import db as storage
from python.storage.context import CloudStorageContext, storage_context
from test_cloud_cost_accounting import config, enroll, generation_response, VALID_OUTPUT


@pytest.fixture(autouse=True)
def forbid_real_http(monkeypatch):
    def blocked(*args, **kwargs):
        pytest.fail('real HTTP is forbidden in direct generation tests')
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', blocked)


@pytest.mark.asyncio
async def test_low_balance_caps_output_without_credit_hold_and_replay(tmp_path):
    calls = []
    app = None
    owner = None
    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload['stream'] is True
        with app.state.store.transaction() as db:
            assert db.execute('SELECT COUNT(*) FROM credit_holds').fetchone()[0] == 0
        assert app.state.store.balance(owner) == 100
        assert 128 <= payload['max_tokens'] < 4096
        assert payload['max_tokens'] == quote['max_output_tokens']
        return generation_response(VALID_OUTPUT, {'prompt_tokens': 30, 'completion_tokens': 50, 'cost': 0.00001})
    app = create_app(config(tmp_path), transport=httpx.MockTransport(respond))
    owner = enroll(app)
    with app.state.store.transaction() as db:
        db.execute('UPDATE credit_lots SET remaining=100 WHERE owner=?', (owner,))
    with storage_context(CloudStorageContext.for_owner(app.state.store.config.root / 'tenants', owner)):
        await storage.init_db()
        req = CloudChat(model_id='cloud-deepseek-inferencenet', messages=[{'role': 'user', 'content': 'hello'}])
        quote = await app.state.jobs.quote(owner, req)
        assert quote['max_credits'] <= 100 and quote['credit_reservation'] is False
        assert quote['safety_screening'] is False
        req = req.model_copy(update={'quote_id': quote['quote_id'], 'max_credits': quote['max_credits']})
        result = await (await app.state.jobs.start(owner, req))
        assert result['status'] == 'completed', result
        assert result['charged_credits'] == 1 and app.state.store.balance(owner) == 99
        assert set(result['telemetry']['cloud_stages_ms']) == {'queue', 'generation', 'save'}
        replay = await (await app.state.jobs.start(owner, req))
        assert replay['reply'] == result['reply'] and replay['charged_credits'] == result['charged_credits']
        assert len(calls) == 1


def test_owner_parallel_admission_and_expiry_during_generation(tmp_path):
    store = CloudStore(config(tmp_path))
    owner = str(uuid4())
    store.account(owner, consent='fixture')
    store.admin_grant(owner, 100, 'once')
    q = store.quote(owner, 'first', 60, 1_000_000, 'cloud-standard')
    store.reserve(owner, 'first', 'first', q, 60)
    assert store.balance(owner) == 100
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM credit_holds').fetchone()[0] == 0
        assert db.execute('SELECT SUM(remaining) FROM credit_lots WHERE owner=?', (owner,)).fetchone()[0] == 100
        assert db.execute('SELECT SUM(amount) FROM fund_holds WHERE owner=?', (owner,)).fetchone()[0] == 1_000_000
    with pytest.raises(CloudError, match='generation_pending'):
        store.reserve(owner, 'first', 'first', q, 60)
    q2 = store.quote(owner, 'second', 60, 1_000_000, 'cloud-standard')
    with pytest.raises(CloudError, match='generation_pending'):
        store.reserve(owner, 'second', 'second', q2, 60)
    with store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM operations WHERE owner=? AND state='pending'", (owner,)).fetchone()[0] == 1
        assert db.execute('SELECT COUNT(*) FROM credit_holds').fetchone()[0] == 0
        assert db.execute('SELECT SUM(amount) FROM fund_holds WHERE owner=?', (owner,)).fetchone()[0] == 1_000_000
    with store.transaction() as db:
        db.execute('UPDATE credit_lots SET expires=? WHERE owner=?', (time.time() - 1, owner))
    result = store.settle(owner, 'first', 100_000, success=True)
    assert result['charged_credits'] == 6 and store.balance(owner) == 0
    assert store.public_wallet(owner)['uncovered_credits'] == 6
    store.grant(owner, 10, time.time() + 3600, 'admin', 'later')
    assert store.balance(owner) == 4
    assert store.settle(owner, 'first', 0, success=False)['charged_credits'] == 6
    assert store.balance(owner) == 4
    assert store.reserve(owner, 'first', 'first', 'expired-quote', 0)['charged_credits'] == 6
    with store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM fund_holds').fetchone()[0] == 0
        assert db.execute('SELECT COUNT(*) FROM credit_holds').fetchone()[0] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('http_status', [200, 429])
@pytest.mark.parametrize('usage', [
    pytest.param({'prompt_tokens': -1, 'completion_tokens': 'invalid'}, id='both-invalid'),
    pytest.param({'prompt_tokens': None, 'completion_tokens': False}, id='null-and-bool'),
    pytest.param({'prompt_tokens': 10, 'completion_tokens': -1}, id='negative-completion'),
    pytest.param({'prompt_tokens': '10', 'completion_tokens': 5}, id='string-prompt'),
    pytest.param({'prompt_tokens': 10, 'completion_tokens': 5,
                  'prompt_tokens_details': {'cached_tokens': None}}, id='invalid-cache-type'),
    pytest.param({'prompt_tokens': 10, 'completion_tokens': 5,
                  'prompt_tokens_details': {'cached_tokens': 11}}, id='cache-exceeds-prompt'),
    pytest.param({'prompt_tokens': 10, 'completion_tokens': 'invalid',
                  'completion_tokens_details': {'reasoning_tokens': 0}}, id='invalid-completion-with-reasoning'),
])
async def test_invalid_counters_with_missing_bill_stay_blocked_after_restart(tmp_path, usage, http_status):
    calls = []
    def respond(request):
        calls.append(request)
        assert request.method == 'POST' and request.url.path == '/api/v1/chat/completions'
        assert 'cost' not in usage
        if http_status == 429:
            return httpx.Response(429, json={'error': {'code': 429}, 'usage': usage})
        return generation_response(VALID_OUTPUT, usage)
    app = create_app(config(tmp_path), transport=httpx.MockTransport(respond))
    owner = enroll(app)
    with storage_context(CloudStorageContext.for_owner(app.state.store.config.root / 'tenants', owner)):
        await storage.init_db()
        req = CloudChat(model_id='cloud-deepseek-inferencenet', messages=[{'role': 'user', 'content': 'hello'}])
        quote = await app.state.jobs.quote(owner, req)
        req = req.model_copy(update={'quote_id': quote['quote_id'], 'max_credits': quote['max_credits']})
        result = await (await app.state.jobs.start(owner, req))
        assert result['status'] == 'failed' and result['charged_credits'] == 0
        tenant = app.state.store.config.root / 'tenants' / owner / 'data.db'
        with closing(sqlite3.connect('file:' + tenant.as_posix() + '?mode=ro', uri=True)) as db:
            stored = json.loads(db.execute('SELECT result_json FROM generations WHERE generation_id=?',
                                           (req.generation_id,)).fetchone()[0])
        assert stored['cloud_accounting']['review_reason'] == 'invalid_usage'
        replay = await (await app.state.jobs.start(owner, req))
        assert replay == result
    assert len(calls) == 1 and app.state.store.balance(owner) == 500
    for store in (app.state.store, CloudStore(app.state.store.config)):
        store.recover()
        with store.transaction() as db:
            op = db.execute('SELECT * FROM operations WHERE owner=? AND id=?', (owner, req.generation_id)).fetchone()
            assert op['state'] == 'failed' and op['review_required'] == 1
            assert 0 < op['actual_cost'] < op['max_cost']
            assert op['charged_credits'] == 0
            assert db.execute('SELECT COUNT(*) FROM bounded_cost_retentions').fetchone()[0] == 0
            assert db.execute('SELECT COUNT(*) FROM credit_holds').fetchone()[0] == 0
            assert db.execute('SELECT COUNT(*) FROM fund_holds').fetchone()[0] == 0
        next_quote = store.quote(owner, 'next-request', 1, 1, 'cloud-standard')
        with pytest.raises(CloudError, match='operator_budget_exhausted'):
            store.reserve(owner, str(uuid4()), 'next-request', next_quote, 1)
        assert store.private_budget()['available_nano'] == 0
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_save_has_no_external_safety_call(tmp_path):
    calls = []
    app = create_app(config(tmp_path), transport=httpx.MockTransport(lambda r: calls.append(r)))
    enroll(app)
    from python.cloud.auth import SESSION_COOKIE
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=app.state.store.config.origin,
                                headers={'Origin': app.state.store.config.origin}, cookies={SESSION_COOKIE: 'browser'}) as client:
        saved = await client.post('/api/creator/world', json={'display_name': 'Synthetic world'})
        assert saved.status_code == 201, saved.text
        assert (await client.get('/api/capabilities')).json()['safety_screening'] is False
    assert calls == []
