"""Large sync fixtures contain no production chats, models or provider calls."""
import base64
import hashlib
import json
import sqlite3
from types import SimpleNamespace

import httpx

import pytest

from test_unified_app import service, owner
from test_native_sync_scopes import accounts, client
from test_native_sync_client import pc, enrolled
from python.cloud.entity_transfers import CHUNK_BYTES, EntityTransfers, json_chunks
from python.cloud.store import CloudError


def large_body(request_id='large'):
    return {'request_id': request_id, 'changes': [{'id': 'large-chat', 'kind': 'conversation', 'base_revision': 0, 'payload': {
        'storage_policy': 'sync', 'settings': {'session_id': 'large-chat'}, 'state': {'session_id': 'large-chat'},
        'messages': [{'id': index + 1, 'uuid': 'fixture-' + str(index), 'role': 'user', 'content': 'large fixture ' * 6000} for index in range(28)],
        'memories': [], 'summaries': [],
    }}]}


def encoded(body):
    return json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode()


def test_json_byte_chunks_keep_legacy_serialization_at_unicode_and_escape_boundaries():
    value = {'text': ('茶🙂\n\t\r\b\f\x00"\\' * 130_000), 'nested': [None, True, False, 1e30, -0.0, {'b': 2, 'a': '界'}]}
    expected = encoded(value)
    chunks = list(json_chunks(value))
    assert b''.join(chunks) == expected
    assert all(len(chunk) == CHUNK_BYTES for chunk in chunks[:-1])
    assert 0 < len(chunks[-1]) <= CHUNK_BYTES


def test_json_byte_iteration_does_not_allocate_an_entire_encoded_batch():
    import tracemalloc
    text = '茶🙂' * 2000
    value = {'messages': [{'content': text, 'id': index} for index in range(6000)]}
    expected_size = len(encoded({'content': text, 'id': 0})) * 6000
    tracemalloc.start()
    try:
        size = sum(len(chunk) for chunk in json_chunks(value))
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert size > 80_000_000 and abs(size - expected_size) < 100_000
    assert peak < 8 * CHUNK_BYTES


def send_part(transfers, user, transfer, index, raw):
    return transfers.append(user, transfer, index, base64.b64encode(raw).decode(), hashlib.sha256(raw).hexdigest())


def test_large_batch_resumes_and_commits_once_after_hash_and_full_validation(service):
    user = owner(service)
    body = large_body()
    raw = encoded(body)
    assert len(raw) > 2_000_000
    with pytest.raises(CloudError, match='sync_batch_too_large'): service.push(user, body['request_id'], body['changes'])
    opened = service.transfers.begin(user, body['request_id'], len(raw), hashlib.sha256(raw).hexdigest())
    transfer = opened['transfer_id']
    send_part(service.transfers, user, transfer, 0, raw[:CHUNK_BYTES])
    assert service.pull(user)['changes'] == []
    with pytest.raises(CloudError, match='transfer_incomplete'): service.transfers.commit(user, transfer)
    restarted = EntityTransfers(service)
    assert restarted.begin(user, body['request_id'], len(raw), hashlib.sha256(raw).hexdigest())['next'] == 1
    send_part(restarted, user, transfer, 0, raw[:CHUNK_BYTES])
    for index, offset in enumerate(range(CHUNK_BYTES, len(raw), CHUNK_BYTES), 1): send_part(restarted, user, transfer, index, raw[offset:offset+CHUNK_BYTES])
    result = restarted.commit(user, transfer)
    assert result['changes'][0]['revision'] == 1
    assert restarted.begin(user, body['request_id'], len(raw), hashlib.sha256(raw).hexdigest()) == {'result': result}
    assert service.pull(user)['changes'][0]['payload'] == body['changes'][0]['payload']
    assert not restarted.pages.file(user, transfer).exists()


def test_pre_upgrade_inline_receipt_is_validated_by_the_original_request_path(service):
    user = owner(service)
    body = large_body('old-inline')
    body['changes'][0]['payload']['messages'] = body['changes'][0]['payload']['messages'][:20]
    raw = encoded(body)
    assert 1_500_000 < len(raw) < 2_000_000
    result = service.push(user, body['request_id'], body['changes'])
    assert service.transfers.begin(user, body['request_id'], len(raw), hashlib.sha256(raw).hexdigest()) == {'inline_receipt_required': True}
    assert service.push(user, body['request_id'], body['changes']) == result
    body['changes'][0]['payload']['messages'][0]['content'] = 'different'
    with pytest.raises(CloudError, match='sync_request_conflict'): service.push(user, body['request_id'], body['changes'])


def test_an_inline_variant_cannot_claim_the_receipt_reserved_for_a_chunked_request(service):
    user = owner(service)
    body = large_body()
    raw = encoded(body)
    opened = service.transfers.begin(user, 'large', len(raw), hashlib.sha256(raw).hexdigest())
    variant = large_body()['changes']
    variant[0]['payload']['messages'] = variant[0]['payload']['messages'][:1]
    with pytest.raises(CloudError, match='sync_transfer_required'): service.push(user, 'large', variant)
    assert service.pull(user)['changes'] == []
    assert service.transfers.begin(user, 'large', len(raw), hashlib.sha256(raw).hexdigest())['transfer_id'] == opened['transfer_id']


def test_inline_client_can_reconcile_an_identical_receipt_committed_by_a_new_chunked_client(service):
    user = owner(service)
    body = large_body('rollback-compatible')
    body['changes'][0]['payload']['messages'] = body['changes'][0]['payload']['messages'][:20]
    raw = encoded(body)
    transfer = service.transfers.begin(user, body['request_id'], len(raw), hashlib.sha256(raw).hexdigest())['transfer_id']
    for index, offset in enumerate(range(0, len(raw), CHUNK_BYTES)): send_part(service.transfers, user, transfer, index, raw[offset:offset+CHUNK_BYTES])
    result = service.transfers.commit(user, transfer)
    assert service.push(user, body['request_id'], body['changes']) == result


def test_plan_downgrade_blocks_new_writes_but_preserves_existing_receipts_and_downloads(service, monkeypatch):
    user = owner(service)
    body = large_body()
    raw = encoded(body)
    digest = hashlib.sha256(raw).hexdigest()
    transfer = service.transfers.begin(user, 'large', len(raw), digest)['transfer_id']
    for index, offset in enumerate(range(0, len(raw), CHUNK_BYTES)): send_part(service.transfers, user, transfer, index, raw[offset:offset+CHUNK_BYTES])
    receipt = service.transfers.commit(user, transfer)
    monkeypatch.setattr(service.store, 'entitlements', lambda _: SimpleNamespace(storage_bytes=1_000_000))
    assert service.transfers.begin(user, 'large', len(raw), digest) == {'result': receipt}
    ref = service.pull(user, paged=True)['changes'][0]['payload_ref']
    downloaded = b''.join(base64.b64decode(service.transfers.part(user, ref['transfer_id'], index)['data']) for index in range(ref['chunks']))
    assert json.loads(downloaded) == body['changes'][0]['payload']
    with pytest.raises(CloudError, match='cloud_storage_full'): service.transfers.begin(user, 'new', len(raw), digest)


def test_corrupt_pages_final_hash_and_cancellation_never_create_a_conversation(service):
    user = owner(service)
    body = large_body()
    raw = encoded(body)
    transfer = service.transfers.begin(user, body['request_id'], len(raw), '0' * 64)['transfer_id']
    with pytest.raises(CloudError, match='transfer_hash_mismatch'):
        service.transfers.append(user, transfer, 0, base64.b64encode(raw[:CHUNK_BYTES]).decode(), '0' * 64)
    for index, offset in enumerate(range(0, len(raw), CHUNK_BYTES)): send_part(service.transfers, user, transfer, index, raw[offset:offset+CHUNK_BYTES])
    with pytest.raises(CloudError, match='transfer_hash_mismatch'): service.transfers.commit(user, transfer)
    service.cancel_sync_request(user, body['request_id'])
    with pytest.raises(CloudError, match='transfer_not_found'): service.transfers.commit(user, transfer)
    with pytest.raises(CloudError, match='sync_request_canceled'): service.transfers.begin(user, body['request_id'], len(raw), '0' * 64)
    assert service.pull(user)['changes'] == []
    other = large_body('next')
    next_raw = encoded(other)
    assert service.transfers.begin(user, 'next', len(next_raw), hashlib.sha256(next_raw).hexdigest())['next'] == 0
    assert not service.transfers.pages.file(user, transfer).exists()


def test_paged_download_is_owner_scoped_and_fenced_by_revision_and_deletion(service):
    user, other = owner(service), owner(service)
    body = large_body()
    service.push(user, 'first', body['changes'], verified_transfer=True)
    page = service.pull(user, paged=True)
    entity = page['changes'][0]
    ref = entity['payload_ref']
    assert 'payload' not in entity
    raw = b''.join(base64.b64decode(service.transfers.part(user, ref['transfer_id'], index)['data']) for index in range(ref['chunks']))
    assert len(raw) == ref['size'] and hashlib.sha256(raw).hexdigest() == ref['sha256']
    assert json.loads(raw) == body['changes'][0]['payload']
    with pytest.raises(CloudError, match='transfer_not_found'): service.transfers.part(other, ref['transfer_id'], 0)
    changed = body['changes'][0]
    changed['base_revision'] = 1
    service.push(user, 'updated', [changed], verified_transfer=True)
    with pytest.raises(CloudError, match='transfer_source_changed'): service.transfers.part(user, ref['transfer_id'], 0)
    latest_page = service.pull(user, paged=True)
    assert len(latest_page['changes']) == 1 and latest_page['cursor'] == 2
    latest = latest_page['changes'][0]['payload_ref']
    service.push(user, 'erase', [{'id': 'large-chat', 'kind': 'conversation', 'base_revision': 2, 'payload': {}, 'deleted': True, 'delete_confirmed': True}])
    with pytest.raises(CloudError, match='transfer_source_changed'): service.transfers.part(user, latest['transfer_id'], 0)


def test_paged_pull_bounds_the_total_inline_response_instead_of_only_individual_chats(service):
    user = owner(service)
    changes = []
    for index in range(10):
        change = large_body()['changes'][0]
        change['id'] = 'small-' + str(index)
        change['payload']['messages'] = change['payload']['messages'][:3]
        changes.append(change)
    service.push(user, 'many', changes, verified_transfer=True)
    page = service.pull(user, paged=True)
    assert len(encoded(page)) < 2_000_000
    assert len(page['changes']) == 10 and any('payload_ref' in value for value in page['changes'])


@pytest.mark.parametrize('capacity', [250_000_000, 1_000_000_000])
def test_declared_transfer_size_uses_the_plan_capacity_without_allocating_its_body(service, monkeypatch, capacity):
    user = owner(service)
    monkeypatch.setattr(service.store, 'entitlements', lambda _: SimpleNamespace(storage_bytes=capacity))
    monkeypatch.setattr('python.cloud.transfers.shutil.disk_usage', lambda _: SimpleNamespace(free=10_000_000_000))
    opened = service.transfers.begin(user, 'capacity', capacity, '0' * 64)
    assert opened['next'] == 0
    service.transfers.begin(user, 'second', capacity, '0' * 64)
    with pytest.raises(CloudError, match='transfer_capacity_not_available'): service.transfers.begin(user, 'third', 1, '0' * 64)
    service.cancel_sync_request(user, 'capacity')
    assert service.transfers.begin(user, 'third', 1, '0' * 64)['next'] == 0
    with pytest.raises(CloudError, match='cloud_storage_full'): service.transfers.begin(user, 'too-large', capacity + 1, '0' * 64)
    assert service.pull(user)['changes'] == []


def test_two_offline_devices_can_stage_together_and_commit_in_reverse_order_as_branches(service):
    user = owner(service)
    service.push(user, 'seed', large_body()['changes'], verified_transfer=True)
    staged = []
    for name in ('first', 'second'):
        body = large_body(name)
        body['changes'][0]['base_revision'] = 1
        body['changes'][0]['payload']['messages'][-1]['content'] = name
        raw = encoded(body)
        transfer = service.transfers.begin(user, name, len(raw), hashlib.sha256(raw).hexdigest())['transfer_id']
        for index, offset in enumerate(range(0, len(raw), CHUNK_BYTES)): send_part(service.transfers, user, transfer, index, raw[offset:offset+CHUNK_BYTES])
        staged.append(transfer)
    second = service.transfers.commit(user, staged[1])['changes'][0]
    first = service.transfers.commit(user, staged[0])['changes'][0]
    assert second['revision'] == 2 and first['branched']
    assert first['lineage']['status'] == 'verified' and first['lineage']['common_messages'] == 27
    assert service.read_entity(user, second['id'])['payload']['messages'][-1]['content'] == 'second'
    assert service.read_entity(user, first['id'])['payload']['messages'][-1]['content'] == 'first'


def test_staged_bytes_remain_encrypted_and_credential_validation_still_precedes_commit(service):
    user = owner(service)
    body = large_body()
    body['changes'][0]['payload']['api_key'] = 'FIXTURE-CREDENTIAL-NEVER-ACCEPT'
    raw = encoded(body)
    transfer = service.transfers.begin(user, 'large', len(raw), hashlib.sha256(raw).hexdigest())['transfer_id']
    for index, offset in enumerate(range(0, len(raw), CHUNK_BYTES)): send_part(service.transfers, user, transfer, index, raw[offset:offset+CHUNK_BYTES])
    assert b'FIXTURE-CREDENTIAL-NEVER-ACCEPT' not in service.transfers.pages.file(user, transfer).read_bytes()
    with pytest.raises(CloudError, match='credentials_not_syncable'): service.transfers.commit(user, transfer)
    assert service.pull(user)['changes'] == []
    with service.store.transaction() as db: assert not db.execute('SELECT 1 FROM app_sync_requests WHERE owner=?', (user,)).fetchone()


@pytest.mark.asyncio
async def test_native_token_can_transfer_entities_but_not_read_other_account_parts(accounts):
    app, owners = accounts
    body = large_body()
    raw = encoded(body)
    async with client(app) as browser:
        issued = (await browser.post('/api/cloud/app/devices', json={'name': 'Fixture PC'})).json()
        token = issued['token']
        headers = {'Authorization': 'Bearer ' + token, 'X-Kyalulu-Owner': owners[0]}
        assert (await browser.post('/api/cloud/app/sync', headers=headers, json={**body, 'verified_transfer': True})).status_code == 413
        manifest = {'request_id': 'large', 'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
        begin = await browser.post('/api/cloud/app/sync/transfers', headers=headers, json=manifest)
        assert begin.status_code == 200, begin.text
        transfer = begin.json()['transfer_id']
        for index, offset in enumerate(range(0, len(raw), CHUNK_BYTES)):
            part = raw[offset:offset+CHUNK_BYTES]
            response = await browser.post(f'/api/cloud/app/sync/transfers/{transfer}/parts/{index}', headers=headers,
                json={'data': base64.b64encode(part).decode(), 'sha256': hashlib.sha256(part).hexdigest()})
            assert response.status_code == 200, response.text
        result = await browser.post(f'/api/cloud/app/sync/transfers/{transfer}/commit', headers=headers, json={})
        assert result.status_code == 200, result.text
        page = await browser.get('/api/cloud/app/sync?paged=1', headers=headers)
        assert page.status_code == 200
        ref = page.json()['changes'][0]['payload_ref']
        assert (await browser.get(f"/api/cloud/app/sync/transfers/{ref['transfer_id']}/parts/0", headers=headers)).status_code == 200
        assert (await browser.get(f"/api/cloud/app/sync/transfers/{ref['transfer_id']}/parts/0", headers={'Authorization': 'Bearer ' + token})).status_code == 403
        assert (await browser.get('/api/cloud/account', headers=headers)).status_code == 403
        legacy = (await browser.post('/api/cloud/sync/device')).json()['token']
        assert (await browser.get(f"/api/cloud/app/sync/transfers/{ref['transfer_id']}/parts/0", headers={'Authorization': 'Bearer ' + legacy, 'X-Kyalulu-Owner': owners[0]})).status_code == 401
        await browser.delete(f"/api/cloud/sync/transfers/{ref['transfer_id']}")
        assert (await browser.get(f"/api/cloud/app/sync/transfers/{ref['transfer_id']}/parts/0", headers=headers)).status_code == 200
        await browser.delete('/api/cloud/app/devices/' + issued['id'])
        assert (await browser.get(f"/api/cloud/app/sync/transfers/{ref['transfer_id']}/parts/0", headers=headers)).status_code == 401
    async with client(app, 1) as other:
        response = await other.get(f"/api/cloud/app/sync/transfers/{ref['transfer_id']}/parts/0", headers={'X-Kyalulu-Owner': owners[1]})
        assert response.status_code == 404


class LostPart(httpx.AsyncBaseTransport):
    def __init__(self, app): self.inner, self.lost, self.parts = httpx.ASGITransport(app), False, []
    async def handle_async_request(self, request):
        response = await self.inner.handle_async_request(request)
        if request.method == 'POST' and '/parts/' in request.url.path:
            self.parts.append(request.url.path)
            if not self.lost:
                self.lost = True
                raise httpx.ReadError('fixture part receipt lost', request=request)
        return response


@pytest.mark.asyncio
async def test_native_outbox_resumes_large_chat_after_restart_and_downloads_it_to_a_second_pc(accounts, pc, tmp_path):
    from python.storage.native_sync import NativeSync
    from python.storage import db as storage
    transport = LostPart(accounts[0])
    sender = await enrolled(accounts, pc, transport=transport)
    with sqlite3.connect(pc) as db:
        for message in large_body()['changes'][0]['payload']['messages']:
            db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user',?)", (message['content'],))
    sender.configure(['selected'], True, consent=True)
    with pytest.raises(httpx.ReadError): await sender.run()
    assert sender.status()['pending']
    assert accounts[0].state.unified.pull(accounts[1][0])['changes'] == []
    restarted = NativeSync(pc, sender.origin, sender.owner, sender.token, transport=transport)
    await restarted.run()
    assert not restarted.status()['pending']
    assert sum(path.endswith('/parts/0') for path in transport.parts) == 1
    second = tmp_path / 'second-pc.db'
    with sqlite3.connect(second) as db:
        db.executescript(storage.DDL)
        for statement in storage.MIGRATIONS: db.execute(statement)
    receiver = NativeSync(second, sender.origin, sender.owner, sender.token, transport=httpx.ASGITransport(accounts[0]))
    receiver.configure([], True, consent=True)
    await receiver.run()
    with sqlite3.connect(second) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 29
    assert receiver.status()['cursor'] > 0
    assert receiver.stage() is None
    inner = httpx.ASGITransport(accounts[0])
    class NoRepeatedParts(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            assert '/parts/' not in request.url.path
            return await inner.handle_async_request(request)
    receiver.transport = NoRepeatedParts()
    receiver.receive(await receiver.remote('/sync?cursor=0'))


@pytest.mark.asyncio
async def test_native_consent_withdrawal_between_parts_stops_the_remaining_body(accounts, pc):
    sender = await enrolled(accounts, pc)
    with sqlite3.connect(pc) as db:
        for message in large_body()['changes'][0]['payload']['messages']:
            db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user',?)", (message['content'],))
    sender.configure(['selected'], True, consent=True)
    inner = httpx.ASGITransport(accounts[0])
    sent = []
    class Withdraw(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            response = await inner.handle_async_request(request)
            if request.method == 'POST' and '/parts/' in request.url.path:
                sent.append(request.url.path)
                sender.configure([], False)
            return response
    sender.transport = Withdraw()
    with pytest.raises(CloudError, match='sync_request_canceled'): await sender.run()
    assert len(sent) == 1
    assert accounts[0].state.unified.pull(accounts[1][0])['changes'] == []
    await sender.settle_withdrawn()
    assert not sender.status()['pending']


@pytest.mark.asyncio
@pytest.mark.parametrize('large', [False, True])
async def test_native_withdrawal_while_hashing_stops_before_any_body_upload(accounts, pc, monkeypatch, large):
    from python.cloud import entity_transfers
    sender = await enrolled(accounts, pc)
    if large:
        with sqlite3.connect(pc) as db:
            for message in large_body()['changes'][0]['payload']['messages']:
                db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user',?)", (message['content'],))
    sender.configure(['selected'], True, consent=True)
    original = entity_transfers.json_chunks
    withdrawn = False
    def chunks(value):
        nonlocal withdrawn
        for chunk in original(value):
            if isinstance(value, dict) and 'request_id' in value and not withdrawn:
                withdrawn = True
                sender.configure([], False)
            yield chunk
    monkeypatch.setattr(entity_transfers, 'json_chunks', chunks)
    inner = httpx.ASGITransport(accounts[0])
    class NoManifest(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            assert '/transfers' not in request.url.path and not (request.method == 'POST' and request.url.path == '/api/cloud/app/sync')
            return await inner.handle_async_request(request)
    sender.transport = NoManifest()
    with pytest.raises(CloudError, match='sync_request_canceled'):
        await sender.run()
    assert withdrawn and sender.status()['pending']
    assert accounts[0].state.unified.pull(accounts[1][0])['changes'] == []
    with sqlite3.connect(pc) as db:
        assert db.execute("SELECT COUNT(*) FROM chat_history WHERE session_id='selected'").fetchone()[0] == (29 if large else 1)
