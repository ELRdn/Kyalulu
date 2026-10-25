"""Disposable stage recovery uses fake accounts; durable history/credits are retained."""
import asyncio
import hashlib
import json
import os
import sqlite3
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest

from test_unified_app import service, owner
from test_unified_runtime_bridge import change
from test_unified_entity_transfers import send_part, LostPart, large_body
from test_native_sync_client import accounts, pc, enrolled
from python.cloud.app import create_app
from python.cloud.entity_transfers import EntityTransfers
from python.cloud.store import CloudError
from python.cloud.transfers import Transfers, connection
from python.storage.native_sync import NativeSync


def stage(service, user, request_id, entity_id=None):
    item = change()
    if entity_id: item['id'] = entity_id
    body = {'request_id': request_id, 'changes': [item]}
    raw = json.dumps(body, ensure_ascii=False).encode()
    digest = hashlib.sha256(raw).hexdigest()
    transfer = service.transfers.begin(user, request_id, len(raw), digest)['transfer_id']
    return transfer, raw, digest


def expire(service, user, transfer):
    with connection(service.transfers.pages.file(user, transfer)) as db:
        meta = service.transfers.pages.meta(db)
        meta['expires'] = 1
        service.transfers.pages.update_meta(db, meta)


def test_expiry_releases_only_stage_bytes_and_same_request_restarts_from_its_outbox(service):
    user, other = owner(service), owner(service)
    old, raw, digest = stage(service, user, 'expired')
    active, active_raw, _ = stage(service, other, 'active')
    send_part(service.transfers, other, active, 0, active_raw)
    expire(service, user, old)
    legacy = Transfers(service.store, None)
    legacy_id = legacy.create(user, direction='upload', selected=[], revision=0)
    with connection(legacy.file(user, legacy_id)) as db:
        meta = legacy.meta(db); meta['expires'] = 1; legacy.update_meta(db, meta)
    with service.store.transaction() as db:
        before = db.execute('SELECT * FROM app_transfer_manifests ORDER BY owner,request_id').fetchall()
        durable = list(db.iterdump())
    balances = [service.store.balance(account) for account in (user, other)]
    restarted = EntityTransfers(service)
    assert restarted.cleanup() == {'removed': 1, 'retained': 1, 'unreadable': 0}
    with service.store.transaction() as db: assert list(db.iterdump()) == durable
    assert legacy.file(user, legacy_id).exists()
    assert restarted.begin(other, 'active', len(active_raw), hashlib.sha256(active_raw).hexdigest())['next'] == 1
    opened = restarted.begin(user, 'expired', len(raw), digest)
    assert opened['transfer_id'] != old and opened['next'] == 0
    send_part(restarted, user, opened['transfer_id'], 0, raw)
    assert restarted.commit(user, opened['transfer_id'])['changes'][0]['revision'] == 1
    assert [service.store.balance(account) for account in (user, other)] == balances
    with service.store.transaction() as db:
        assert db.execute('SELECT * FROM app_transfer_manifests ORDER BY owner,request_id').fetchall() == before


@pytest.mark.parametrize('canceled', [False, True])
def test_recovery_reaps_crash_leftovers_but_preserves_receipts_and_cancellation_fences(service, monkeypatch, canceled):
    user = owner(service)
    transfer, raw, digest = stage(service, user, 'crashed')
    send_part(service.transfers, user, transfer, 0, raw)
    original = service.transfers.pages.delete
    monkeypatch.setattr(service.transfers.pages, 'delete', lambda *args: None)
    if canceled: service.cancel_sync_request(user, 'crashed')
    else: receipt = service.transfers.commit(user, transfer)
    monkeypatch.setattr(service.transfers.pages, 'delete', original)
    restarted = EntityTransfers(service)
    assert restarted.cleanup()['removed'] == 1
    assert not restarted.pages.file(user, transfer).exists()
    if canceled:
        with pytest.raises(CloudError, match='sync_request_canceled'):
            restarted.begin(user, 'crashed', len(raw), digest)
        assert service.pull(user)['changes'] == []
    else:
        assert restarted.begin(user, 'crashed', len(raw), digest) == {'result': receipt}
        assert service.read_entity(user, change()['id'])['revision'] == 1


@pytest.mark.parametrize('deleted', [False, True])
def test_obsolete_downloads_are_reaped_but_current_revision_and_entities_are_preserved(service, deleted):
    user = owner(service)
    original = change()
    service.push(user, 'first', [original])
    stale = service.transfers.download(user, service.read_entity(user, original['id']), inline_limit=0)['payload_ref']
    service.push(user, 'next', [{**change('new revision', base=1), **({'payload': {}, 'deleted': True, 'delete_confirmed': True} if deleted else {})}])
    if not deleted:
        fresh = service.transfers.download(user, service.read_entity(user, original['id']), inline_limit=0)['payload_ref']
        # Recreate a crash-leftover old revision after the normal download path replaced it.
        stale_id = service.transfers.pages.create(user, direction='app-download:stale', selected=[], revision=1)
        with connection(service.transfers.pages.file(user, stale_id)) as db:
            meta = service.transfers.pages.meta(db); meta['direction'] = 'app-download:' + original['id']
            service.transfers.pages.update_meta(db, meta)
    else: stale_id = stale['transfer_id']
    before = service.read_entity(user, original['id'])
    result = service.transfers.cleanup()
    assert result['removed'] == 1 and result['unreadable'] == 0
    assert not service.transfers.pages.file(user, stale_id).exists()
    assert service.read_entity(user, original['id']) == before
    if not deleted:
        assert result['retained'] == 1
        assert service.transfers.part(user, fresh['transfer_id'], 0)['data']


def test_unknown_corrupt_and_unreadable_stages_are_retained_without_sensitive_logs(service, caplog):
    user = owner(service)
    transfer, _, _ = stage(service, user, 'private-fixture-request')
    unknown = service.transfers.pages.create(user, direction='unrecognized', selected=[], revision=0)
    expire(service, user, unknown)
    file = service.transfers.pages.file(user, transfer)
    with connection(file) as db: db.execute('UPDATE meta SET payload=?', ('SECRET-MUST-NOT-BE-LOGGED',))
    corrupt = file.with_name(str(uuid4()) + '.db'); corrupt.write_bytes(b'corrupt-private-fixture')
    assert service.transfers.cleanup() == {'removed': 0, 'retained': 0, 'unreadable': 3}
    assert file.exists() and corrupt.exists() and service.transfers.pages.file(user, unknown).exists()
    assert 'entity_transfer_cleanup_unreadable count=3' in caplog.text
    assert all(value not in caplog.text for value in (user, transfer, 'private-fixture-request', 'SECRET', 'corrupt-private'))


def test_cleanup_rejects_linked_directories_and_files_without_reading_or_removing_targets(service, tmp_path):
    user = owner(service)
    root = service.store.config.root / 'entity-transfers'
    root.mkdir(exist_ok=True)
    outside = tmp_path / 'outside'; outside.mkdir()
    sentinel = outside / (str(uuid4()) + '.db'); sentinel.write_bytes(b'private-outside')
    link = root / user
    try: link.symlink_to(outside, target_is_directory=True)
    except OSError:
        if os.name == 'nt': pytest.skip('Windows symlink privilege unavailable')
        raise
    assert service.transfers.cleanup()['unreadable'] == 1
    assert sentinel.read_bytes() == b'private-outside'
    link.unlink()
    link.mkdir()
    file_link = link / (str(uuid4()) + '.db'); file_link.symlink_to(sentinel)
    assert service.transfers.cleanup()['unreadable'] == 1
    assert sentinel.read_bytes() == b'private-outside'


@pytest.mark.asyncio
@pytest.mark.parametrize('enabled', [False, True])
async def test_lifespan_reaps_before_serving_and_cancels_only_its_maintenance_task(service, monkeypatch, enabled):
    user = owner(service)
    expired, _, _ = stage(service, user, 'before-start')
    expire(service, user, expired)
    started, canceled = asyncio.Event(), asyncio.Event()
    async def worker(self):
        started.set()
        try: await asyncio.Event().wait()
        finally: canceled.set()
    monkeypatch.setattr(EntityTransfers, 'worker', worker)
    config = replace(service.store.config, private_test=True, ads_enabled=False, operator_backend='openrouter',
                     allowed_emails=('fixture@example.test',), signup_limit=1, trial_credits=0, unified_enabled=enabled)
    app = create_app(config, transport=httpx.MockTransport(lambda _: pytest.fail('No external calls')))
    unrelated = asyncio.create_task(asyncio.Event().wait())
    try:
        async with app.router.lifespan_context(app):
            assert not service.transfers.pages.file(user, expired).exists()
            await asyncio.wait_for(started.wait(), 1)
        assert canceled.is_set() and not unrelated.done()
    finally:
        unrelated.cancel(); await asyncio.gather(unrelated, return_exceptions=True)


@pytest.mark.asyncio
async def test_worker_reaps_after_the_next_interval_without_touching_a_live_upload(service, monkeypatch):
    user = owner(service)
    old, _, _ = stage(service, user, 'idle')
    active, _, _ = stage(service, user, 'still-live')
    intervals = []
    async def advance(seconds):
        intervals.append(seconds)
        if len(intervals) > 1: raise asyncio.CancelledError
        expire(service, user, old)
    with monkeypatch.context() as local:
        local.setattr('python.cloud.entity_transfers.asyncio.sleep', advance)
        with pytest.raises(asyncio.CancelledError): await service.transfers.worker()
    assert intervals == [60, 60]
    assert not service.transfers.pages.file(user, old).exists()
    assert service.transfers.pages.file(user, active).exists()


@pytest.mark.asyncio
async def test_native_restart_reuses_its_unchanged_outbox_after_server_stage_expiry(accounts, pc):
    app, users = accounts
    transport = LostPart(app)
    sender = await enrolled(accounts, pc, transport=transport)
    with sqlite3.connect(pc) as db:
        for message in large_body()['changes'][0]['payload']['messages']:
            db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user',?)", (message['content'],))
        before = db.execute('SELECT id,session_id,role,content FROM chat_history ORDER BY id').fetchall()
    sender.configure(['selected'], True, consent=True)
    with pytest.raises(httpx.ReadError): await sender.run()
    pending = sender.stage()
    transfer = transport.parts[0].split('/')[-3]
    expire(app.state.unified, users[0], transfer)
    assert EntityTransfers(app.state.unified).cleanup()['removed'] == 1
    assert sender.stage() == pending
    restarted = NativeSync(pc, sender.origin, sender.owner, sender.token, transport=transport)
    await restarted.run()
    assert not restarted.status()['pending']
    assert sum(path.endswith('/parts/0') for path in transport.parts) == 2
    assert len(app.state.unified.pull(users[0])['changes']) == 1
    with sqlite3.connect(pc) as db:
        assert db.execute('SELECT id,session_id,role,content FROM chat_history ORDER BY id').fetchall() == before


@pytest.mark.parametrize('field,value', [('expires', float('nan')), ('expires', True), ('direction', None)])
def test_invalid_authenticated_metadata_is_retained_for_recovery(service, field, value):
    user = owner(service)
    transfer, _, _ = stage(service, user, 'malformed-metadata')
    file = service.transfers.pages.file(user, transfer)
    with connection(file) as db:
        meta = service.transfers.pages.meta(db); meta[field] = value; service.transfers.pages.update_meta(db, meta)
    assert service.transfers.cleanup() == {'removed': 0, 'retained': 0, 'unreadable': 1}
    assert file.exists()


def test_unlink_failure_preserves_the_stage_and_retries_without_blocking_other_accounts(service, monkeypatch, caplog):
    first, second = owner(service), owner(service)
    locked, _, _ = stage(service, first, 'locked')
    disposable, _, _ = stage(service, second, 'expired')
    for user, transfer in [(first, locked), (second, disposable)]: expire(service, user, transfer)
    original = service.transfers.pages.delete
    def delete(user, transfer):
        if transfer == locked: raise PermissionError('PRIVATE-FILE-PATH')
        original(user, transfer)
    with monkeypatch.context() as local:
        local.setattr(service.transfers.pages, 'delete', delete)
        assert service.transfers.cleanup() == {'removed': 1, 'retained': 0, 'unreadable': 1}
    assert service.transfers.pages.file(first, locked).exists()
    assert not service.transfers.pages.file(second, disposable).exists()
    assert 'PRIVATE-FILE-PATH' not in caplog.text
    assert service.transfers.cleanup() == {'removed': 1, 'retained': 0, 'unreadable': 0}
