"""Hosted screening keeps the selected route, current price bounds and private errors."""

import json
from decimal import Decimal

import httpx
import pytest

from python.cloud.meter import CostMeter
from python.cloud.router import OPENROUTER_TARIFFS
from python.cloud.safety import SafetyGuard
from python.cloud.store import CloudError
from python.providers.openrouter import DEEPSEEK, PRICE_CAPS, OpenRouterProvider

from test_cloud_cost_accounting import config, enroll, generation_response, screened_response, VALID_OUTPUT
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE
from python.cloud.generation import CloudChat
from python.cloud.contracts import TARIFF
from python.cloud.store import CloudStore
from python.storage.context import CloudStorageContext, storage_context


@pytest.mark.asyncio
async def test_current_endpoint_price_is_eligible_and_screening_is_budgeted():
    calls = []
    tariff = OPENROUTER_TARIFFS[DEEPSEEK]
    prompt, completion = map(Decimal, PRICE_CAPS[DEEPSEEK])
    assert tariff.input_miss == prompt * 1000
    assert tariff.input_hit >= prompt * 1000
    assert tariff.output == completion * 1000
    assert tariff.version.endswith('2026-10-12')

    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        routing = payload['provider']
        assert routing['only'] == ['inference-net']
        assert not routing['allow_fallbacks']
        assert routing['max_price']['prompt'] >= 0.077
        assert routing['max_price']['completion'] >= 0.66
        return httpx.Response(200, json={
            'model': DEEPSEEK, 'provider': 'InferenceNet',
            'choices': [{'finish_reason': 'stop', 'message': {'content': '{"sfw":true}'}}],
            'usage': {'prompt_tokens': 300, 'completion_tokens': 8, 'cost': 0.0000263},
        })

    meter = CostMeter(200_000)
    await SafetyGuard(OpenRouterProvider(api_key='fixture', transport=httpx.MockTransport(respond)),
                      tariff=tariff).check({'text': 'Hello'}, meter=meter)
    assert len(calls) == 1
    assert meter.total == 26_300 and not meter.uncertain


@pytest.mark.asyncio
@pytest.mark.parametrize('status,code', [(404, 'safety_route_unavailable'),
    (429, 'safety_rate_limited'), (401, 'safety_provider_configuration_error'),
    (402, 'safety_provider_configuration_error'), (403, 'safety_provider_configuration_error'),
    (503, 'safety_unavailable')])
async def test_unavailable_route_has_safe_reason_and_is_not_retried(status, code, caplog):
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(status, json={'error': {'message': 'private input and key'}})
    provider = OpenRouterProvider(api_key='fixture-key', transport=httpx.MockTransport(respond))
    meter = CostMeter(200_000)
    with pytest.raises(CloudError) as exc:
        await SafetyGuard(provider, tariff=OPENROUTER_TARIFFS[DEEPSEEK]).check({'text': 'Hello'}, meter=meter)
    meter.close_pending()
    assert exc.value.code == code and len(calls) == 1
    assert meter.uncertain and meter.total > 0
    assert f'openrouter_http_{status}' in caplog.text
    assert 'private input' not in caplog.text and 'fixture-key' not in caplog.text


@pytest.mark.asyncio
async def test_butler_cloud_start_and_talk_keep_screening_and_settlement(tmp_path):
    calls = []
    def respond(request):
        payload = json.loads(request.content)
        calls.append(payload)
        assert payload['provider']['max_price'] == {'prompt': 0.077, 'completion': 0.66}
        if payload['stream']:
            return generation_response(VALID_OUTPUT, {
                'prompt_tokens': 40, 'completion_tokens': 40, 'cost': 0.000001})
        return screened_response(0.000001, case='valid')

    cfg = config(tmp_path)
    app = create_app(cfg, transport=httpx.MockTransport(respond))
    owner = enroll(app)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
            headers={'Origin': cfg.origin}, cookies={SESSION_COOKIE: 'browser'}) as client:
        saved = await client.put('/api/chat/settings', json={
            'session_id': 'butler-onboarding', 'character_id': 'butler', 'system_prompt': '',
            'intro': 'おかえりなさいませ。', 'temperature': 0.8})
        assert saved.status_code == 200, saved.text
        injected = await client.post('/api/chat/intro/inject?session_id=butler-onboarding')
        assert injected.status_code == 200 and injected.json()['injected']
    assert app.state.store.balance(owner) == 500
    with storage_context(CloudStorageContext.for_owner(cfg.root / 'tenants', owner)):
        req = CloudChat(model_id='cloud-standard', session_id='butler-onboarding',
                        messages=[{'role': 'user', 'content': 'こんにちは'}])
        quote = await app.state.jobs.quote(owner, req)
        with app.state.store.transaction() as db:
            row = db.execute('select q.*, p.version as provider_tariff from quotes q '
                             'join quote_provider_tariffs p on q.id=p.id where q.id=?', (quote['quote_id'],)).fetchone()
            assert row['provider_tariff'] == quote['tariff'] == OPENROUTER_TARIFFS[DEEPSEEK].version
            assert row['tariff'] == quote['credit_tariff'] == TARIFF.version
        req = req.model_copy(update={'quote_id': quote['quote_id'], 'max_credits': quote['max_credits']})
        result = await (await app.state.jobs.start(owner, req))
        assert result['status'] == 'completed' and result['reply'] == 'hello', result
    # Settings, compiled character and intro all screen before the talk's input/output checks.
    assert sum(not p['stream'] for p in calls) == 0
    assert sum(p['stream'] for p in calls) == 1
    with app.state.store.transaction() as db:
        assert db.execute('select sum(actual_cost) from operations').fetchone()[0] == 1000
        assert db.execute("select count(*) from operations where state='pending'").fetchone()[0] == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('decision,code,status', [
    ({'sfw': True, 'extra': 'bypass'}, 'safety_unavailable', 503),
    ({'sfw': 'true'}, 'safety_unavailable', 503), ({}, 'safety_unavailable', 503),
    ({'sfw': False}, 'cloud_sfw_only', 403),
])
async def test_invalid_decision_is_not_misreported_as_rejected_content(decision, code, status):
    class Provider:
        async def screen_json(self, messages, schema, output):
            return json.dumps(decision), {'prompt_tokens': 10, 'completion_tokens': 3, 'cost_usd': '0.000001'}
    meter = CostMeter(200_000)
    with pytest.raises(CloudError) as exc:
        await SafetyGuard(Provider(), tariff=OPENROUTER_TARIFFS[DEEPSEEK]).check({'text': 'Hello'}, meter=meter)
    assert (exc.value.code, exc.value.status) == (code, status)
    assert meter.total == 1000 and not meter.uncertain


def test_legacy_quotes_migrate_and_changed_provider_tariff_requires_a_new_quote(tmp_path):
    import sqlite3
    cfg = config(tmp_path)
    cfg.root.mkdir()
    with sqlite3.connect(cfg.root / 'control.db') as db:
        db.execute('CREATE TABLE quotes(id TEXT PRIMARY KEY, owner TEXT, fingerprint TEXT, '
                   'max_credits INTEGER,max_cost INTEGER,expires REAL,route TEXT,tariff TEXT)')
    app = create_app(cfg)
    owner = enroll(app)
    old_quote = app.state.store.quote(owner, 'legacy', 0, 1000, 'cloud-standard')
    restarted = CloudStore(cfg)
    with pytest.raises(CloudError, match='quote_expired'):
        restarted.reserve(owner, 'legacy-send', 'legacy', old_quote, 0, provider_tariff='updated-provider')
    restarted.reserve(owner, 'legacy-send', 'legacy', old_quote, 0)
    restarted.settle(owner, 'legacy-send', 0, success=False)
    quote = restarted.quote(owner, 'current', 0, 1000, 'cloud-standard', provider_tariff='current-provider')
    with pytest.raises(CloudError, match='quote_expired'):
        restarted.reserve(owner, 'changed-send', 'current', quote, 0, provider_tariff='new-provider')
    with restarted.transaction() as db:
        assert db.execute("select count(*) from operations where id='changed-send'").fetchone()[0] == 0
        # The deployed older runtime uses an eight-value insert when rolling back.
        db.execute('INSERT INTO quotes VALUES(?,?,?,?,?,?,?,?)',
                   ('rollback-quote', owner, 'rollback', 0, 1000, 253402300799, 'cloud-standard', TARIFF.version))
    restarted.reserve(owner, 'rollback-send', 'rollback', 'rollback-quote', 0)
    restarted.settle(owner, 'rollback-send', 0, success=False)
    with restarted.transaction() as db:
        db.execute('DELETE FROM quotes WHERE id=?', (quote,))
        assert db.execute('select count(*) from quote_provider_tariffs where id=?', (quote,)).fetchone()[0] == 0
