"""Logical restores stop Native sends until reviewed, without replacing Cloud data."""
import sqlite3
import httpx
import pytest
from test_native_sync_client import pc, enrolled, LostReceipt
from test_native_sync_scopes import accounts
from test_native_sync_api import native_app, local, enroll, manual_run
from python.api import native_sync as api
from python.cloud.store import CloudError
from python.cloud.sync import export_snapshot, apply_snapshot


def restore(pc, selected=None):
    snapshot = export_snapshot(pc, ['selected'] if selected is None else selected)
    for row in snapshot['tables']['chat_history']:
        if row['session_id'] == 'selected': row['content'] = 'RESTORED-FIXTURE'
    apply_snapshot(pc, snapshot)


@pytest.mark.asyncio
async def test_restore_is_offline_until_confirmation_then_saves_an_independent_copy(accounts, pc):
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    await sync.run()
    cloud, owners = accounts
    cloud.state.store.admin_grant(owners[0], 321, 'native-restore-preservation-fixture')
    balance = cloud.state.store.balance(owners[0])
    assert balance >= 321
    original = cloud.state.unified.pull(owners[0])['changes'][0]
    restore(pc)
    status = sync.status()
    assert not status['enabled'] and set(status['restores']) == {'selected'}
    transport = sync.transport
    sync.transport = httpx.MockTransport(lambda _: pytest.fail('A restored workspace must not send before review'))
    assert await sync.run() == {'phase': 'off'}
    with pytest.raises(CloudError, match='restored_session_confirmation_required'):
        sync.configure(['selected'], True, consent=True)
    with pytest.raises(CloudError, match='restored_session_confirmation_required'):
        sync.configure(['selected'], True, consent=True, restore_confirmations={'selected': 'stale'})
    sync.configure(['selected'], True, consent=True, restore_confirmations=status['restores'])
    assert not sync.status()['restores']
    sync.transport = transport
    await sync.run()
    changes = cloud.state.unified.pull(owners[0])['changes']
    assert len(changes) == 2 and len({change['id'] for change in changes}) == 2
    assert next(change for change in changes if change['id'] == original['id'])['payload']['messages'][0]['content'] == 'SELECTED'
    assert any(change['payload']['messages'][0]['content'] == 'RESTORED-FIXTURE' for change in changes)
    assert cloud.state.store.balance(owners[0]) == balance
    assert sync.stage() is None


@pytest.mark.asyncio
@pytest.mark.parametrize('already_applied', [False, True])
async def test_old_outbox_is_settled_by_id_without_resending_body_after_restore(accounts, pc, already_applied):
    cloud, owners = accounts
    sync = await enrolled(accounts, pc, transport=LostReceipt(cloud) if already_applied else None)
    sync.configure(['selected'], True, consent=True)
    if already_applied:
        with pytest.raises(httpx.ReadError): await sync.run()
    else:
        sync.stage()
    restore(pc)
    confirmations = sync.status()['restores']
    with sync.transaction() as db:
        pending = sync.meta(db, 'outbox')
        assert pending['withdrawn'] is True and pending['changes'][0]['payload']['messages'][0]['content'] == 'SELECTED'
    with pytest.raises(CloudError, match='restore_receipt_pending'):
        sync.configure(['selected'], True, consent=True, restore_confirmations=confirmations)
    requests = []
    class ReceiptOnly(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            requests.append((request.url.path, request.content))
            assert '/sync/cancel/' in request.url.path and request.content == b'{}'
            return await httpx.ASGITransport(cloud).handle_async_request(request)
    sync.transport = ReceiptOnly()
    await sync.settle_withdrawn()
    assert len(requests) == 1 and not sync.status()['pending']
    with sqlite3.connect(pc) as db:
        assert db.execute("SELECT content FROM chat_history WHERE session_id='selected'").fetchone()[0] == 'RESTORED-FIXTURE'
    sync.configure(['selected'], True, consent=True, restore_confirmations=confirmations)
    sync.transport = httpx.ASGITransport(cloud)
    await sync.run()
    values = cloud.state.unified.pull(owners[0])['changes']
    assert len(values) == (2 if already_applied else 1)
    assert sum(change['payload']['messages'][0]['content'] == 'RESTORED-FIXTURE' for change in values) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('full', [False, True])
async def test_second_restore_rejects_stale_confirmation_and_only_affects_restored_accounts(accounts, pc, full):
    first, other = await enrolled(accounts, pc), await enrolled(accounts, pc, 1)
    first.configure(['selected'], True, consent=True)
    other.configure(['private'], True, consent=True)
    if full: apply_snapshot(pc, export_snapshot(pc))
    else: restore(pc)
    earlier = first.status()['restores']
    if full: apply_snapshot(pc, export_snapshot(pc))
    else: restore(pc)
    assert first.status()['restores'] != earlier
    with pytest.raises(CloudError, match='restored_session_confirmation_required'):
        first.configure(['selected'], True, consent=True, restore_confirmations=earlier)
    assert other.status()['enabled'] is not full
    assert set(other.status()['restores']) == ({'private'} if full else set())
    with pytest.raises(CloudError, match='sync_account_copy_required'):
        other.configure(['selected'], True, consent=True)


@pytest.mark.asyncio
async def test_restore_after_stage_stops_the_next_inline_send(accounts, pc, monkeypatch):
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    original = sync.stage
    def stage_then_restore():
        staged = original()
        restore(pc)
        return staged
    monkeypatch.setattr(sync, 'stage', stage_then_restore)
    with pytest.raises(CloudError, match='sync_request_canceled'):
        await sync.run()
    assert accounts[0].state.unified.pull(accounts[1][0])['changes'] == []
    assert sync.status()['pending'] and not sync.status()['enabled']


@pytest.mark.asyncio
async def test_invalid_pending_record_rolls_back_the_restore_and_its_fence(accounts, pc):
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    with sync.transaction() as db:
        sync.save(db, 'outbox', [])
    with pytest.raises(CloudError, match='invalid_sync_outbox'):
        restore(pc)
    assert sync.status()['enabled'] and not sync.status()['restores']
    with sqlite3.connect(pc) as db:
        assert db.execute("SELECT content FROM chat_history WHERE session_id='selected'").fetchone()[0] == 'SELECTED'


@pytest.mark.asyncio
@pytest.mark.parametrize('pending', [False, True])
async def test_pc_api_requires_current_owner_and_restore_token_before_resuming(native_app, accounts, pc, pending):
    async with local(native_app) as browser:
        response = await enroll(browser, accounts)
        assert response.status_code == 200
        owner = response.json()['owner']
        if pending: api.service(native_app).stage()
        else: assert (await manual_run(browser, owner)).status_code == 200
        restore(pc)
        status = (await browser.get('/api/local/app-sync')).json()
        assert not status['enabled'] and status['restores']['selected']
        body = {'enabled': True, 'selected': ['selected'], 'consent': True, 'expected_owner': owner}
        assert (await browser.put('/api/local/app-sync', json=body)).status_code == 409
        assert (await browser.put('/api/local/app-sync', json={**body, 'expected_owner': 'other'})).status_code == 403
        requests=[]
        class Trace(httpx.AsyncBaseTransport):
            async def handle_async_request(self, request):
                requests.append(request.url.path)
                return await httpx.ASGITransport(accounts[0]).handle_async_request(request)
        native_app.state.native_sync_transport=Trace()
        stale=await browser.put('/api/local/app-sync',json={**body,'restore_confirmations':{'selected':'stale'}})
        assert stale.status_code==409 and not any('/sync/cancel/' in path for path in requests)
        resumed = await browser.put('/api/local/app-sync', json={**body, 'restore_confirmations': status['restores']})
        assert resumed.status_code == 200 and not resumed.json()['restores'], resumed.text
        assert (await manual_run(browser, owner)).status_code == 200
        assert len(accounts[0].state.unified.pull(owner)['changes']) == (1 if pending else 2)
