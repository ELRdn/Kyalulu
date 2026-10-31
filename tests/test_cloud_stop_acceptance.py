"""Cloud Stop/accounting acceptance with isolated tenants and fictional HTTP only."""

import asyncio
import json
import sqlite3
from contextlib import closing
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.auth import provider_consent_version
from python.cloud.store import CloudStore
from python.storage import generations
from python.storage.context import CloudStorageContext, storage_context
from test_cloud import client_for
from test_cloud_cost_accounting import config, enroll, generation_response, VALID_OUTPUT
from test_cloud_direct_generation import forbid_real_http as forbid_real_http


@pytest.mark.asyncio
async def test_explicit_cloud_stop_fences_late_success_and_settlement(tmp_path):
    entered, late = asyncio.Event(), asyncio.Event()
    calls = []

    class LateSuccess(httpx.AsyncByteStream):
        async def __aiter__(self):
            entered.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                late.set()  # A provider may deliver its billed success after Stop.
            yield generation_response(VALID_OUTPUT, {
                'prompt_tokens': 10, 'completion_tokens': 5, 'cost': 0.00001,
            }).content

    def respond(request):
        calls.append(request)
        assert json.loads(request.content)['stream'] is True
        return httpx.Response(200, stream=LateSuccess())

    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    body = {'model_id': 'cloud-standard', 'session_id': 'stop-session',
            'generation_id': 'stop-generation', 'messages': [{'role': 'user', 'content': 'hello'}]}
    path = '/api/chat/generations/stop-generation'
    query = {'session_id': body['session_id']}
    send = None
    try:
        async with await client_for(app, owner) as client:
            quoted = await client.post('/api/cloud/quotes', json=body)
            assert quoted.status_code == 200, quoted.text
            quote = quoted.json()
            body.update(quote_id=quote['quote_id'], max_credits=quote['max_credits'])
            send = asyncio.create_task(client.post('/api/chat', json=body))
            await asyncio.wait_for(entered.wait(), 10)
            assert (await client.get(path, params=query)).json()['status'] == 'pending'
            stopped = await asyncio.wait_for(client.post(path + '/cancel', params=query), 10)
            assert stopped.status_code == 200 and stopped.json()['status'] == 'cancelled'
            result = await asyncio.wait_for(send, 10)
            assert result.status_code == 200, result.text
            assert late.is_set()
            assert result.json()['status'] == 'cancelled' and result.json()['reply'] == ''
            assert result.json()['charged_credits'] == 0
            assert set(result.json()['telemetry']['cloud_stages_ms']) == {'queue', 'generation', 'save'}
            assert (await client.post(path + '/cancel', params=query)).json() == stopped.json()
            replay = await client.post('/api/chat', json=body)
            assert replay.status_code == 200, replay.text
            for key in ('generation_id', 'session_id', 'status', 'reply', 'error', 'charged_credits'):
                assert replay.json()[key] == result.json()[key]
            assert (await client.get('/api/chat/history', params=query)).json()['history'] == []
            assert (await client.get('/api/cloud/sync')).json()['revision'] == 0
        tenant = cfg.root / 'tenants' / owner / 'data.db'
        with closing(sqlite3.connect(tenant)) as db:
            status, saved = db.execute('SELECT status,result_json FROM generations').fetchone()
            saved = json.loads(saved)
            assert status == saved['status'] == 'cancelled' and saved['reply'] == ''
            assert saved['cloud_accounting']['cost'] == 10_000
            for table in ('chat_history', 'runtime_states', 'memories', 'memory_events'):
                assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
        for store in (app.state.store, CloudStore(cfg)):
            store.recover()
            terminal = store.settle(owner, body['generation_id'], 20_000, success=True)
            assert (terminal['state'], terminal['actual_cost'], terminal['charged_credits']) == ('failed', 10_000, 0)
            assert store.balance(owner) == 500
            with store.transaction() as db:
                assert db.execute('SELECT COUNT(*) FROM operations').fetchone()[0] == 1
                assert db.execute('SELECT COUNT(*) FROM credit_holds').fetchone()[0] == 0
                assert db.execute('SELECT COUNT(*) FROM fund_holds').fetchone()[0] == 0
        assert len(calls) == 1
    finally:
        await app.state.jobs.shutdown()
        if send is not None:
            if not send.done():
                send.cancel()
            await asyncio.gather(send, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize('boundary', ['owner', 'unaccepted', 'expired'])
async def test_cloud_quote_boundary_rejects_before_reservation_or_provider(tmp_path, boundary):
    calls = []
    cfg = replace(config(tmp_path), private_test=False, legal_approved=True,
                  signup_limit=2, monthly_subsidy_jpy=3000)
    app = create_app(cfg, transport=httpx.MockTransport(lambda request: calls.append(request)))
    owner = enroll(app)
    other = str(uuid4())
    app.state.store.account(other, consent=provider_consent_version(app.state.store.config))
    app.state.store.admin_grant(other, 500, 'other-owner')
    body = {'model_id': 'cloud-standard', 'session_id': 'quoted-session',
            'generation_id': 'quoted-generation', 'messages': [{'role': 'user', 'content': 'hello'}]}
    async with await client_for(app, owner) as client:
        quoted = await client.post('/api/cloud/quotes', json=body)
        assert quoted.status_code == 200, quoted.text
        quote = quoted.json()
        body.update(quote_id=quote['quote_id'], max_credits=quote['max_credits'])
    if boundary == 'unaccepted':
        body['max_credits'] = quote['max_credits'] - 1
    elif boundary == 'expired':
        with app.state.store.transaction() as db:
            db.execute('UPDATE quotes SET expires=0 WHERE id=?', (quote['quote_id'],))
    async with await client_for(app, other if boundary == 'owner' else owner) as client:
        rejected = await client.post('/api/chat', json=body)
        assert rejected.status_code == 409, rejected.text
        assert rejected.json()['error'] == ('quote_not_accepted' if boundary == 'unaccepted' else 'quote_expired')
        status = await client.get('/api/chat/generations/quoted-generation', params={'session_id': body['session_id']})
        assert status.status_code == 200 and status.json()['status'] == 'not_found'
    assert calls == [] and not app.state.jobs.tasks
    assert app.state.store.balance(owner) == app.state.store.balance(other) == 500
    with app.state.store.transaction() as db:
        for table in ('operations', 'credit_holds', 'fund_holds'):
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['status', 'cancel'])
@pytest.mark.parametrize('state', ['pending', 'cancelled'])
async def test_cloud_generation_session_conflict_preserves_both_tenants(tmp_path, action, state):
    cfg = replace(config(tmp_path), private_test=False, legal_approved=True,
                  signup_limit=2, monthly_subsidy_jpy=3000)
    app = create_app(cfg, transport=httpx.MockTransport(lambda _: pytest.fail('no provider requests')))
    owner = enroll(app)
    other = str(uuid4())
    app.state.store.account(other, consent=provider_consent_version(cfg))
    app.state.store.admin_grant(other, 500, 'other-owner')
    path = '/api/chat/generations/shared-generation'
    contexts, snapshots = [], []
    async with await client_for(app, owner) as client, await client_for(app, other) as other_client:
        for tenant_client, tenant, session in ((client, owner, 'original'), (other_client, other, 'other-session')):
            response = await tenant_client.get(path, params={'session_id': session})
            assert response.status_code == 200 and response.json()['status'] == 'not_found'
            context = CloudStorageContext.for_owner(cfg.root / 'tenants', tenant)
            contexts.append(context)
            with storage_context(context):
                await generations.reserve('shared-generation', session, {})
                if tenant == owner and state == 'cancelled':
                    await generations.cancel('shared-generation', session)
            with closing(sqlite3.connect(context.directory / 'data.db')) as db:
                snapshots.append(db.execute('SELECT * FROM generations').fetchall())
        response = await client.request('GET' if action == 'status' else 'POST',
            path if action == 'status' else path + '/cancel', params={'session_id': 'other-session'})
        assert response.status_code == 409, response.text
        assert response.json() == {'error': 'generation_id belongs to a different session'}
        for tenant_client, session, expected in ((client, 'original', state), (other_client, 'other-session', 'pending')):
            response = await tenant_client.get(path, params={'session_id': session})
            assert response.status_code == 200 and response.json()['status'] == expected
    for context, snapshot in zip(contexts, snapshots):
        with closing(sqlite3.connect(context.directory / 'data.db')) as db:
            assert db.execute('SELECT * FROM generations').fetchall() == snapshot
    assert app.state.store.balance(owner) == app.state.store.balance(other) == 500
    assert not app.state.jobs.tasks
    with app.state.store.transaction() as db:
        assert db.execute('SELECT COUNT(*) FROM operations').fetchone()[0] == 0
