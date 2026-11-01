"""General-use policy checks on the local server, without Cloud stores or providers."""
import httpx
import pytest
from fastapi import FastAPI
from python.api.mobile import Config, Devices, MobileSecurity
from python.api.onboarding import router
from python.cloud.unified import general_eligibility

ORIGIN = 'http://127.0.0.1:8000'
POLICY = {'accepted': True, 'minimum_age': 13, 'guardian_below': 18,
          'version': 'FICTIONAL-NOT-REGIONAL-APPROVAL'}


def application(policies=(('JP', POLICY),)):
    app = FastAPI()
    config = Config(region_policies=policies)
    app.state.mobile_config = config
    app.state.mobile_devices = Devices()
    app.include_router(router, prefix='/api')
    app.add_middleware(MobileSecurity, config=config, devices=app.state.mobile_devices)
    return app


@pytest.mark.asyncio
async def test_local_confirmation_is_offline_general_receipt(monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError('External provider not allowed')
    monkeypatch.setattr(httpx.HTTPTransport, 'handle_request', forbidden)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, 'handle_async_request', forbidden)
    app = application()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 1)), base_url=ORIGIN) as client:
        response = await client.post('/api/local/eligibility', json={'country': 'JP', 'age': 25}, headers={'Origin': ORIGIN})
    assert response.status_code == 200
    result = response.json()
    ticket = result.pop('ticket')
    assert result == general_eligibility({'JP': POLICY}, 'JP', 25)
    assert ticket.startswith('native:') and len(ticket) > 32
    assert set(app.state._state) == {'mobile_config', 'mobile_devices'}
    assert 'adult_verified' not in result


@pytest.mark.asyncio
@pytest.mark.parametrize('country,age,error', [
    ('XX', 25, 'region_policy_pending'), ('jp', 25, 'region_policy_pending'),
    ('JP', 12, 'minimum_age_required'), ('JP', True, 'minimum_age_required'),
    ('JP', 25.0, 'minimum_age_required'), ('JP', 121, 'minimum_age_required'),
    ('JP', 15, 'verified_guardian_consent_required'),
])
async def test_native_uses_same_region_and_age_denials(country, age, error):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application(), client=('127.0.0.1', 1)), base_url=ORIGIN) as client:
        response = await client.post('/api/local/eligibility', json={'country': country, 'age': age}, headers={'Origin': ORIGIN})
    assert response.status_code == 403 and response.json()['error'] == error


@pytest.mark.asyncio
async def test_unconfigured_native_does_not_guess_country_policy():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application(()), client=('127.0.0.1', 1)), base_url=ORIGIN) as client:
        response = await client.post('/api/local/eligibility', json={'country': 'JP', 'age': 25}, headers={'Origin': ORIGIN})
    assert response.status_code == 403 and response.json()['error'] == 'region_policy_pending'


@pytest.mark.asyncio
@pytest.mark.parametrize('body', [None, [], {'country': 'JP', 'age': 25, 'guardian': True}, {'country': 'JP'}])
async def test_native_rejects_broader_claims(body):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application(), client=('127.0.0.1', 1)), base_url=ORIGIN) as client:
        response = await client.post('/api/local/eligibility', json=body, headers={'Origin': ORIGIN})
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize('headers', [{}, {'Origin': 'https://app.kyalulu.com'},
    {'Origin': ORIGIN, 'Forwarded': 'for=127.0.0.1'}, {'Origin': ORIGIN, 'X-Forwarded-For': '127.0.0.1'}])
async def test_local_confirmation_cannot_be_borrowed_by_another_origin(headers):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application(), client=('127.0.0.1', 1)), base_url=ORIGIN) as client:
        response = await client.post('/api/local/eligibility', json={'country': 'JP', 'age': 25}, headers=headers)
    assert response.status_code == 403


def test_native_config_validates_explicit_policy_without_cloud_secrets(monkeypatch):
    import json
    monkeypatch.setenv('KYALULU_REGION_POLICIES', json.dumps({'JP': POLICY}))
    monkeypatch.delenv('KYALULU_CLOUD_SECRET', raising=False)
    assert dict(Config.from_env().region_policies) == {'JP': POLICY}
    monkeypatch.setenv('KYALULU_REGION_POLICIES', json.dumps({'JP': dict(POLICY, minimum_age=True)}))
    with pytest.raises(ValueError, match='regional policy'):
        Config.from_env()
