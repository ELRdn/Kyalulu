"""Native SQLite + real in-process Cloud routes; all accounts and bodies are fake."""
import json
import sqlite3
from copy import deepcopy
from uuid import uuid4
import httpx
import pytest

from test_native_sync_scopes import accounts, client
from python.storage import db as storage
from python.storage.native_sync import NativeSync
from python.cloud.store import CloudError


@pytest.fixture
def pc(tmp_path,monkeypatch):
    path=tmp_path/'pc/data.db';path.parent.mkdir()
    with sqlite3.connect(path) as db:
        db.executescript(storage.DDL)
        for statement in storage.MIGRATIONS:db.execute(statement)
        for sid,content in [('selected','SELECTED'),('private','NEVER UPLOAD')]:
            db.execute('INSERT INTO session_settings(session_id) VALUES(?)',(sid,))
            db.execute("INSERT INTO chat_history(session_id,role,content) VALUES(?,'user',?)",(sid,content))
    monkeypatch.setattr(storage,'DB_PATH',path)
    return path


async def enrolled(accounts,pc,index=0,transport=None):
    app,owners=accounts
    async with client(app,index) as browser:
        token=(await browser.post('/api/cloud/app/devices',json={'name':'Fixture PC'})).json()['token']
    service=NativeSync(pc,'https://app.test',None,token,transport=transport or httpx.ASGITransport(app))
    await service.verify();assert service.owner==owners[index]
    return service


@pytest.mark.asyncio
async def test_selected_native_data_roundtrips_without_replacing_ids_or_exporting_private_sessions(accounts,pc):
    service=await enrolled(accounts,pc);service.configure(['selected'],True,consent=True)
    with sqlite3.connect(pc) as db:before=db.execute('SELECT id,session_id,content FROM chat_history ORDER BY id').fetchall()
    result=await service.run();assert result['phase']=='saved' and not result['pending']
    app,owners=accounts;changes=app.state.unified.pull(owners[0])['changes']
    assert len(changes)==1 and 'NEVER UPLOAD' not in json.dumps(changes)
    with sqlite3.connect(pc) as db:assert db.execute('SELECT id,session_id,content FROM chat_history ORDER BY id').fetchall()==before
    assert (await service.run())['pending'] is False
    assert app.state.unified.pull(owners[0])['cursor']==1
    service.configure(['selected'],False)
    service.transport=httpx.MockTransport(lambda _:pytest.fail('Disabled synchronization must not connect'))
    assert await service.run()=={'phase':'off'}


class LostReceipt(httpx.AsyncBaseTransport):
    def __init__(self,app):self.inner=httpx.ASGITransport(app);self.lost=False;self.requests=[]
    async def handle_async_request(self,request):
        response=await self.inner.handle_async_request(request)
        if request.method=='POST' and request.url.path=='/api/cloud/app/sync':
            self.requests.append(json.loads(request.content)['request_id'])
            if not self.lost:self.lost=True;raise httpx.ReadError('fixture receipt lost',request=request)
        return response


@pytest.mark.asyncio
async def test_restart_reuses_durable_outbox_after_server_commit_and_retains_new_native_edits(accounts,pc):
    app,owners=accounts;transport=LostReceipt(app)
    first=await enrolled(accounts,pc,transport=transport);first.configure(['selected'],True,consent=True)
    with pytest.raises(httpx.ReadError):await first.run()
    assert first.status()['pending']
    with sqlite3.connect(pc) as db:db.execute("UPDATE chat_history SET content='EDITED AFTER UPLOAD' WHERE session_id='selected'")
    restarted=NativeSync(pc,first.origin,first.owner,first.token,transport=transport)
    await restarted.run();assert transport.requests[0]==transport.requests[1]
    await restarted.run()
    returned=app.state.unified.pull(owners[0])['changes'][-1]['payload']
    assert returned['messages'][0]['content']=='EDITED AFTER UPLOAD'
    assert 'NEVER UPLOAD' not in json.dumps(returned)
    assert len({change['id'] for change in app.state.unified.pull(owners[0])['changes']})==1


@pytest.mark.asyncio
async def test_withdrawn_selection_cancels_queued_data_without_uploading_its_body(accounts,pc):
    service=await enrolled(accounts,pc);service.configure(['selected'],True,consent=True)
    pending=service.stage();service.configure([],False)
    assert await service.run()=={'phase':'off'}
    await service.settle_withdrawn()
    assert not service.status()['pending']
    app,owners=accounts
    assert app.state.unified.pull(owners[0])['changes']==[]
    # A delayed original POST cannot pass the durable cancellation fence.
    with pytest.raises(CloudError,match='sync_request_canceled'):
        await service.remote('/sync',body={key:pending[key] for key in ('request_id','changes')})
    with sqlite3.connect(pc) as db:assert db.execute("SELECT content FROM chat_history WHERE session_id='selected'").fetchone()[0]=='SELECTED'


@pytest.mark.asyncio
async def test_withdrawal_reconciles_an_already_applied_request_without_resending_data(accounts,pc):
    app,owners=accounts;transport=LostReceipt(app)
    service=await enrolled(accounts,pc,transport=transport);service.configure(['selected'],True,consent=True)
    with pytest.raises(httpx.ReadError):await service.run()
    service.configure([],False);await service.settle_withdrawn()
    assert not service.status()['pending'] and service.status()['selected']==[]
    assert len(transport.requests)==1
    assert len(app.state.unified.pull(owners[0])['changes'])==1


@pytest.mark.asyncio
async def test_a_purged_session_never_resends_an_older_staged_payload_after_restart(accounts,pc):
    from python.storage.conversation import purge
    service=await enrolled(accounts,pc);service.configure(['selected'],True,consent=True)
    pending=service.stage();await purge('selected')
    restarted=NativeSync(pc,service.origin,service.owner,service.token,transport=service.transport)
    await restarted.run()
    app,owners=accounts;assert app.state.unified.pull(owners[0])['changes']==[]
    with pytest.raises(CloudError,match='sync_request_canceled'):
        await restarted.remote('/sync',body={key:pending[key] for key in ('request_id','changes')})
    assert not restarted.status()['pending']


@pytest.mark.asyncio
async def test_account_change_cannot_claim_or_upload_another_native_binding(accounts,pc):
    first=await enrolled(accounts,pc);first.configure(['selected'],True,consent=True);await first.run()
    second=await enrolled(accounts,pc,1)
    with pytest.raises(CloudError,match='sync_account_copy_required'):second.configure(['selected'],True,consent=True)
    assert not second.status()['enabled']
    second.configure([],True,consent=True);await second.run()
    app,owners=accounts;assert app.state.unified.pull(owners[1])['changes']==[]
    with first.transaction() as db:pending=first.meta(db,'outbox')
    assert pending is None and first.status()['selected']==['selected']


@pytest.mark.asyncio
async def test_remote_import_is_replay_safe_and_corrupt_dependency_keeps_cursor_and_rows(accounts,pc):
    service=await enrolled(accounts,pc);service.configure([],True,consent=True)
    payload={'storage_policy':'sync','settings':{'session_id':'remote'},'messages':[{'id':1,'uuid':'remote-message','role':'user','content':'REMOTE'}],
             'memories':[],'summaries':[],'state':{'session_id':'remote'}}
    page={'cursor':3,'changes':[{'id':'remote','kind':'conversation','revision':1,'deleted':False,'payload':payload}]}
    service.receive(page);selected=service.status()['selected'];assert len(selected)==1
    service.receive(page);assert service.status()['selected']==selected
    broken=deepcopy(page);broken['cursor']=4;broken['changes'][0]['id']='other'
    broken['changes'][0]['payload']['settings']['library_binding']={'character':{'id':'missing','revision':1}}
    with sqlite3.connect(pc) as db:before=db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0]
    with pytest.raises(CloudError,match='sync_library_revision_missing'):service.receive(broken)
    assert service.status()['cursor']==3
    with sqlite3.connect(pc) as db:assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0]==before
    with pytest.raises(CloudError,match='stale_sync_page'):service.receive({'cursor':2,'changes':[]})


@pytest.mark.asyncio
async def test_confirmed_native_erasure_reconfirms_new_cloud_revision_and_replays_once(accounts,pc):
    from python.storage.conversation import purge
    service=await enrolled(accounts,pc);service.configure(['selected'],True,consent=True);await service.run()
    app,owners=accounts;current=app.state.unified.pull(owners[0])['changes'][-1]
    updated=deepcopy(current['payload']);updated['messages'][0]['content']='CLOUD CHANGED'
    app.state.unified.push(owners[0],'cloud-edit',[{'id':current['id'],'kind':'conversation','base_revision':1,'payload':updated}])
    await purge('selected')
    with pytest.raises(CloudError,match='sync_delete_reconfirmation_required'):await service.run()
    reviews=await service.deletion_reviews();assert reviews[0]['revision']==2
    app.state.unified.push(owners[0],'cloud-edit-again',[{'id':current['id'],'kind':'conversation','base_revision':2,'payload':updated}])
    with pytest.raises(CloudError,match='sync_delete_reconfirmation_required'):await service.confirm_deletion(current['id'],2)
    with service.transaction() as db:old=service.meta(db,'outbox')['request_id']
    await service.confirm_deletion(current['id'],3)
    with service.transaction() as db:assert service.meta(db,'outbox')['request_id']!=old
    await service.run();assert not service.status()['pending']
    assert app.state.unified.read_entity(owners[0],current['id'])['deleted']
    await service.run()
    with sqlite3.connect(pc) as db:assert not db.execute("SELECT 1 FROM chat_history WHERE session_id='selected'").fetchone()


@pytest.mark.asyncio
async def test_withdrawn_deletion_cannot_be_reconfirmed(accounts,pc):
    from python.storage.conversation import purge
    service=await enrolled(accounts,pc);service.configure(['selected'],True,consent=True);await service.run()
    app,owners=accounts;current=app.state.unified.pull(owners[0])['changes'][-1]
    await purge('selected');pending=service.stage();service.configure([],False)
    with pytest.raises(CloudError,match='sync_outbox_withdrawn'):
        await service.confirm_deletion(current['id'],current['revision'])
    with service.transaction() as db:assert service.meta(db,'outbox')['request_id']==pending['request_id']
    assert not app.state.unified.read_entity(owners[0],current['id'])['deleted']
