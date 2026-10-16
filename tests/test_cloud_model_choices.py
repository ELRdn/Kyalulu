"""All traffic is mocked; route changes must preserve safety and billed-cost replay."""
import json

import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE
from python.cloud.auth import provider_consent_version
from python.cloud.contracts import TARIFF
from python.cloud.generation import CloudChat
from python.cloud.model_choices import CHOICES
from python.cloud.router import public_routes, OPENROUTER_ROUTE_TARIFFS
from python.cloud.store import CloudError
from python.providers.openrouter import OpenRouterProvider, DEEPSEEK
from python.storage import db as storage
from python.storage.context import CloudStorageContext, storage_context
from dataclasses import replace
from test_cloud_cost_accounting import config as base_config, enroll, VALID_OUTPUT

def config(tmp_path):
    return replace(base_config(tmp_path), allowed_model_routes=tuple(CHOICES))


def response(payload, provider, *, summary=None, raw=False, sfw=True):
    metadata = {"provider": provider, "model": payload['model']}
    usage = {"prompt_tokens": 30, "completion_tokens": 60, "cost": 0.000003}
    if not payload['stream']:
        return httpx.Response(200, json={**metadata, 'usage': usage, 'choices': [
            {'finish_reason': 'stop', 'message': {'content': json.dumps({'sfw': sfw})}}]})
    delta = {'content': VALID_OUTPUT}
    if raw:
        delta.update(reasoning='RAW PRIVATE THINKING', reasoning_details=[
            {'type': 'reasoning.text', 'text': 'RAW PRIVATE THINKING'},
            {'type': 'reasoning.encrypted', 'data': 'ENCRYPTED PRIVATE THINKING'}])
    if summary is not None:
        delta.setdefault('reasoning_details', []).append({'type': 'reasoning.summary', 'summary': summary})
    event = {**metadata, 'choices': [{'delta': delta, 'finish_reason': 'stop'}], 'usage': usage}
    return httpx.Response(200, text='data: ' + json.dumps(event) + '\n\ndata: [DONE]\n\n')


@pytest.mark.asyncio
@pytest.mark.parametrize('route_id', list(CHOICES))
async def test_route_quote_generation_billing_and_replay(tmp_path, route_id):
    choice = CHOICES[route_id]
    calls = []
    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        if not payload['stream']:
            assert payload['model'] == DEEPSEEK and payload['provider']['only'] == ['inference-net']
            assert payload['reasoning'] == {'enabled': False}
            return response(payload, 'InferenceNet')
        assert payload['model'] == choice['model']
        assert payload['provider']['only'] == [choice['upstream_tag']]
        assert payload['provider']['allow_fallbacks'] is False
        assert payload['provider'].get('zdr') == (True if route_id == 'cloud-claude-haiku' else None)
        assert payload['provider']['data_collection'] == ('allow' if choice.get('retains_prompts') else 'deny')
        assert payload['reasoning']['effort'] == 'low'
        assert payload['reasoning'].get('summary') == ('auto' if route_id == 'cloud-gpt-luna-flex' else None)
        assert payload['max_tokens'] == 4096
        if route_id in {'cloud-gpt-luna-flex', 'cloud-claude-haiku'}:
            assert 'temperature' not in payload
        return response(payload, choice['upstream'], summary='設定と直近の会話を確認。', raw=True)
    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    app.state.store.admin_grant(owner, 500, 'synthetic-model-tests')
    context = CloudStorageContext.for_owner(app.state.store.config.root / 'tenants', owner)
    with storage_context(context):
        await storage.init_db()
        req = CloudChat(model_id=route_id, session_id='synthetic', messages=[{'role': 'user', 'content': 'hello'}])
        quote = await app.state.jobs.quote(owner, req)
        assert quote['route']['upstream'] == choice['upstream']
        assert quote['route']['safety'] == {'enabled': False}
        assert quote['tariff'] == OPENROUTER_ROUTE_TARIFFS[route_id].version
        req = req.model_copy(update={'quote_id': quote['quote_id'], 'max_credits': quote['max_credits'],
                                     'provider_training_consent': bool(choice.get('training'))})
        result = await (await app.state.jobs.start(owner, req))
        assert result['status'] == 'completed', result
        assert result['charged_credits'] == TARIFF.credits(3000)
        assert 'PRIVATE THINKING' not in json.dumps(result)
        assert result['reasoning_summary'] == ('設定と直近の会話を確認。' if choice['reasoning_summary_supported'] else None)
        assert len(calls) == 1
        replay = await (await app.state.jobs.start(owner, req))
        assert replay['reasoning_summary'] == result['reasoning_summary']
        assert replay['charged_credits'] == result['charged_credits'] and len(calls) == 1
        restarted = create_app(app.state.store.config, transport=httpx.MockTransport(respond))
        durable = await (await restarted.state.jobs.start(owner, req))
        assert durable['reasoning_summary'] == result['reasoning_summary'] and len(calls) == 1
        if choice.get('training'):
            import aiosqlite
            async with aiosqlite.connect(context.directory / 'data.db') as db:
                stored = json.loads((await (await db.execute(
                    'SELECT result_json FROM generations WHERE generation_id=?', (req.generation_id,)
                )).fetchone())[0])
            assert stored['provider_consent']['training'] is True
            assert stored['provider_consent']['quote_id'] == quote['quote_id']
            assert stored['provider_consent']['version'] == provider_consent_version(cfg)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://cloud.test',
            cookies={SESSION_COOKIE: 'browser'}) as client:
            history = (await client.get('/api/chat/history?session_id=synthetic')).json()['history']
            assert history[-1]['reasoning_summary'] == result['reasoning_summary']


def test_model_catalog_exposes_actual_availability_and_separate_tariffs(tmp_path):
    routes = public_routes(config(tmp_path))
    assert len(routes) == 8
    by_id = {r['id']: r for r in routes}
    for key, choice in CHOICES.items():
        assert by_id[key]['available']
        assert by_id[key]['training_consent_required'] == bool(choice.get('training'))
        assert by_id[key]['upstream_tag'] == choice['upstream_tag']
        assert by_id[key]['pricing']['input_per_million'] == choice['prices'][0]
    assert len({t.version for t in OPENROUTER_ROUTE_TARIFFS.values()}) == len(CHOICES)


@pytest.mark.asyncio
async def test_official_summary_parser_drops_raw_and_refuses_bad_summary():
    def respond(request):
        payload = json.loads(request.content)
        return response(payload, 'Google', summary={'text': 'not a string'}, raw=True)
    choice = CHOICES['cloud-claude-haiku']
    provider = OpenRouterProvider(api_key='fixture', model=choice['model'], upstream=choice['upstream'],
        upstream_tag=choice['upstream_tag'], reasoning_effort='low', reasoning_summary_supported=True,
        transport=httpx.MockTransport(respond))
    with pytest.raises(RuntimeError, match='openrouter_invalid_stream'):
        _ = [e async for e in provider.stream_events(model=provider.model, messages=[{'role': 'user', 'content': 'hello'}])]


@pytest.mark.asyncio
async def test_official_summary_is_saved_without_extra_classifier(tmp_path):
    def respond(request):
        payload = json.loads(request.content)
        if payload['stream']:
            return response(payload, 'Google', summary='SFW screening fixture')
        text = payload['messages'][-1]['content'][0]['text']
        return response(payload, 'InferenceNet', sfw='SFW screening fixture' not in text)
    app = create_app(config(tmp_path), transport=httpx.MockTransport(respond))
    owner = enroll(app)
    app.state.store.admin_grant(owner, 500, 'synthetic-summary-tests')
    with storage_context(CloudStorageContext.for_owner(app.state.store.config.root / 'tenants', owner)):
        await storage.init_db()
        req = CloudChat(model_id='cloud-claude-haiku', messages=[{'role':'user', 'content':'hi'}])
        quote = await app.state.jobs.quote(owner, req)
        req = req.model_copy(update={'quote_id':quote['quote_id'], 'max_credits':quote['max_credits']})
        result = await (await app.state.jobs.start(owner, req))
        assert result['status'] == 'completed' and result['charged_credits'] == 1
        assert result['reasoning_summary'] == 'SFW screening fixture'
        from python.api.chat import chat_history
        assert (await chat_history(session_id='default'))['history'][-1]['reasoning_summary'] == result['reasoning_summary']


@pytest.mark.asyncio
async def test_changed_route_or_reasoning_conditions_require_new_quote(tmp_path, monkeypatch):
    calls = []
    def respond(request):
        calls.append(request)
        raise AssertionError('expired quote must not send')
    app = create_app(config(tmp_path), transport=httpx.MockTransport(respond))
    owner = enroll(app)
    with storage_context(CloudStorageContext.for_owner(app.state.store.config.root / 'tenants', owner)):
        await storage.init_db()
        req = CloudChat(model_id='cloud-deepseek-inferencenet', messages=[{'role':'user', 'content':'hi'}])
        quote = await app.state.jobs.quote(owner, req)
        accepted = req.model_copy(update={'quote_id':quote['quote_id'], 'max_credits':quote['max_credits']})
        with pytest.raises(CloudError, match='quote_expired'):
            await app.state.jobs.start(owner, accepted.model_copy(update={'model_id':'cloud-glm-inferencenet'}))
        monkeypatch.setitem(CHOICES['cloud-deepseek-inferencenet'], 'reasoning_summary_supported', True)
        with pytest.raises(CloudError, match='quote_expired'):
            await app.state.jobs.start(owner, accepted)
        assert calls == []


def test_retention_training_policy_requires_new_login_agreement(tmp_path):
    cfg = config(tmp_path)
    assert provider_consent_version(cfg) == '2026-10-03-provider-routing-v2-openrouter-model-choices-v6-region'
    assert provider_consent_version(cfg) != '2026-10-03-provider-routing-v2-openrouter-model-choices-v3'
    routes = {r['id']: r for r in public_routes(cfg)}
    assert routes['cloud-gpt-luna-flex']['available']
    assert routes['cloud-deepseek-baidu']['retains_prompts']
    assert routes['cloud-deepseek-decart']['available']
    assert routes['cloud-deepseek-baidu']['available']
    assert routes['cloud-deepseek-baidu']['training_consent_required']
    assert not routes['cloud-gpt-luna-flex']['training_consent_required']


@pytest.mark.asyncio
async def test_baidu_without_training_consent_never_reserves_or_sends(tmp_path):
    calls = []
    def respond(request):
        calls.append(request)
        raise AssertionError('unaccepted training route must not send')
    app = create_app(config(tmp_path), transport=httpx.MockTransport(respond))
    owner = enroll(app)
    with storage_context(CloudStorageContext.for_owner(app.state.store.config.root / 'tenants', owner)):
        await storage.init_db()
        req = CloudChat(model_id='cloud-deepseek-baidu', messages=[{'role':'user', 'content':'hi'}])
        quote = await app.state.jobs.quote(owner, req)
        assert quote['route']['training_consent_required'] is True
        assert quote['route']['retains_prompts'] is True
        accepted = req.model_copy(update={'quote_id':quote['quote_id'], 'max_credits':quote['max_credits']})
        with pytest.raises(CloudError, match='provider_training_consent_required'):
            await app.state.jobs.start(owner, accepted)
        with app.state.store.transaction() as db:
            assert db.execute('SELECT COUNT(*) FROM operations').fetchone()[0] == 0
        assert calls == []


@pytest.mark.parametrize('value', ['true', 1, None])
def test_training_consent_requires_boolean(value):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        CloudChat(model_id='cloud-deepseek-baidu', messages=[{'role':'user','content':'hi'}],
                  provider_training_consent=value)


@pytest.mark.asyncio
@pytest.mark.parametrize('action', ['cancel', 'cancel_pending', 'restart'])
async def test_training_record_survives_interruption_without_restoring_reply(tmp_path, action):
    from uuid import uuid4
    from python.storage import generations
    import aiosqlite
    with storage_context(CloudStorageContext.for_owner(tmp_path, str(uuid4()))) as context:
        await storage.init_db()
        gid = str(uuid4())
        await generations.reserve(gid, 'synthetic', {})
        agreement = {'training': True, 'quote_id': 'accepted-quote', 'version': 'v4'}
        async with generations.transaction() as db:
            await db.execute('UPDATE generations SET result_json=? WHERE generation_id=?',
                             (json.dumps({'provider_consent': agreement}), gid))
        if action == 'cancel':
            await generations.cancel(gid, 'synthetic')
        elif action == 'cancel_pending':
            await generations.cancel_pending(gid)
        else:
            await generations.recover_interrupted()
        # Late completion can preserve the bill but never commit its reply.
        terminal = await generations.finish(gid, {'status': 'completed', 'reply': 'uncommitted reply',
            'cloud_accounting': {'cost': 123, 'review_required': True}}, None, 'cloud-deepseek-baidu')
        assert terminal['status'] == 'cancelled' and terminal['reply'] == ''
        assert terminal['provider_consent'] == agreement
        async with aiosqlite.connect(context.directory / 'data.db') as db:
            stored = json.loads((await (await db.execute(
                'SELECT result_json FROM generations WHERE generation_id=?', (gid,)
            )).fetchone())[0])
            assert stored['provider_consent'] == agreement
            assert stored['cloud_accounting'] == {'cost': 123, 'review_required': True}
            assert (await (await db.execute('SELECT COUNT(*) FROM chat_history')).fetchone())[0] == 0
