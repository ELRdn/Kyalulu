"""Lost responses and concurrent retries must create or revise an item only once."""

from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from fastapi import FastAPI
import httpx
import pytest

from python.api.library import router
from python.core.portable_schema import PortableDocument
from python.storage import library
from python.storage.db import init_db
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version
from python.cloud.config import CloudConfig


@pytest.mark.asyncio
async def test_concurrent_save_retries_and_payload_conflict(isolated):
    await init_db()
    document = PortableDocument(name="retry fixture")
    request_id = str(uuid4())
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: library.save_item(document, request_id=request_id), range(4)))
    assert len({item.id for item in results}) == 1
    with library.connect() as con:
        assert con.execute('SELECT COUNT(*) FROM library_versions').fetchone()[0] == 1
    with pytest.raises(library.LibraryConflict, match="different save"):
        library.save_item(PortableDocument(name="changed fixture"), request_id=request_id)


@pytest.mark.asyncio
async def test_http_retry_validation_and_revision_replay(isolated):
    app = FastAPI()
    app.include_router(router, prefix="/api")
    payload = {"name": "retry fixture", "data": {}}
    headers = {"Idempotency-Key": str(uuid4())}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://local.test") as client:
        assert (await client.post('/api/library', json=payload, headers={"Idempotency-Key": "invalid"})).status_code == 422
        first = await client.post('/api/library', json=payload, headers=headers)
        retry = await client.post('/api/library', json=payload, headers=headers)
        assert first.status_code == retry.status_code == 200
        assert first.json() == retry.json()
        conflict = await client.post('/api/library', json={**payload, "name": "other"}, headers=headers)
        assert conflict.status_code == 409
        item = first.json()
        edit = {"expected_revision": 1, "document": {**payload, "name": "edited"}}
        edit_headers = {"Idempotency-Key": str(uuid4())}
        updated = await client.put('/api/library/' + item['id'], json=edit, headers=edit_headers)
        retried = await client.put('/api/library/' + item['id'], json=edit, headers=edit_headers)
        assert updated.status_code == retried.status_code == 200
        assert updated.json() == retried.json() and updated.json()['revision'] == 2
    with library.connect() as con:
        assert con.execute('SELECT COUNT(*) FROM library_versions').fetchone()[0] == 2


@pytest.mark.asyncio
async def test_cloud_replay_has_no_screen_backup_or_sync_effect_and_is_owner_scoped(tmp_path, monkeypatch):
    from python.cloud.backups import Backups

    effects = []
    def screen(request):
        effects.append('screen')
        return httpx.Response(200, json={
            'choices': [{'message': {'content': '{"sfw":true}'}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 50, 'completion_tokens': 5},
        })
    original_backup = Backups.create
    def backup(self, *args, **kwargs):
        effects.append('backup')
        return original_backup(self, *args, **kwargs)
    monkeypatch.setattr(Backups, 'create', backup)
    cfg = CloudConfig(root=tmp_path / 'cloud', backup_root=tmp_path / 'offsite',
                      origin='https://cloud.test', secret='s' * 32, inference_enabled=True,
                      operator_backend='deepseek', deepseek_key='fixture')
    app = create_app(cfg, transport=httpx.MockTransport(screen))
    owners = [str(uuid4()), str(uuid4())]
    for index, owner in enumerate(owners):
        app.state.store.account(owner, consent=provider_consent_version(cfg))
        app.state.store.trial(owner)
        app.state.auth.save(f'retry-{index}', owner, {
            'access_token': 'fixture', 'refresh_token': 'fixture', 'expires_in': 3600,
        })
    bumps = []
    original_bump = app.state.sync.bump
    monkeypatch.setattr(app.state.sync, 'bump', lambda owner: (bumps.append(owner), original_bump(owner))[1])
    headers = {'Origin': cfg.origin, 'Idempotency-Key': str(uuid4())}
    payload = {'name': 'cloud retry'}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=cfg.origin,
                                headers=headers, cookies={SESSION_COOKIE: 'retry-0'}) as client:
        first = await client.post('/api/library', json=payload)
        assert first.status_code == 200, first.text
        item = first.json()
        recorded = (effects[:], bumps[:])
        replay = await client.post('/api/library', json=payload)
        assert replay.status_code == 200 and replay.json() == item
        conflict = await client.post('/api/library', json={'name': 'changed'})
        assert conflict.status_code == 409
        for invalid_key in ('invalid', ''):
            invalid = await client.post('/api/library', json=payload, headers={'Idempotency-Key': invalid_key})
            assert invalid.status_code == 422
        assert (await client.post('/api/library', json={'kind': 'invalid'})).status_code == 422
        assert (effects, bumps) == recorded
        edit_headers = {'Idempotency-Key': str(uuid4())}
        edit = {'document': {'name': 'edited'}, 'expected_revision': 1}
        updated = await client.put('/api/library/' + item['id'], json=edit, headers=edit_headers)
        recorded = (effects[:], bumps[:])
        retry = await client.put('/api/library/' + item['id'], json=edit, headers=edit_headers)
        assert updated.status_code == retry.status_code == 200
        assert updated.json() == retry.json() and retry.json()['revision'] == 2
        assert (effects, bumps) == recorded
        client.cookies.set(SESSION_COOKIE, 'retry-1')
        other = await client.post('/api/library', json=payload)
        assert other.status_code == 200 and other.json()['id'] != item['id']
        assert len(effects) == len(recorded[0]) + 2 and len(bumps) == len(recorded[1]) + 1
    restored = create_app(cfg, transport=httpx.MockTransport(lambda _: pytest.fail('replay cannot send')))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restored), base_url=cfg.origin,
                                headers=headers, cookies={SESSION_COOKIE: 'retry-0'}) as client:
        replay = await client.post('/api/library', json=payload)
        assert replay.status_code == 200 and replay.json() == item
