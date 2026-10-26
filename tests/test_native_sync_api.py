"""PC enrollment API against isolated SQLite and fake Cloud accounts only."""
import asyncio
import json
import sqlite3

import httpx
import pytest
from fastapi import FastAPI

from test_native_sync_client import pc
from test_native_sync_scopes import accounts, client
from python.api import native_sync as api
from python.remote.bridge import RemotePrincipal
from python.storage.context import CloudStorageContext, storage_context


@pytest.fixture
def native_app(accounts,pc,monkeypatch):
    cloud,_=accounts
    app=FastAPI();app.include_router(api.router,prefix='/api')
    app.state.native_sync_transport=httpx.ASGITransport(cloud)
    monkeypatch.setenv('KYALULU_UNIFIED_CLOUD_ORIGIN','https://app.test')
    for name,value in [('lock',asyncio.Lock()),('active',None),('suspended',None),('last',{'phase':'off','error':''})]:
        monkeypatch.setattr(api,name,value)
    return app


def local(app,*,host='127.0.0.1',url='http://127.0.0.1:8000',headers=None):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app,client=(host,1234)),base_url=url,headers=headers)


async def token(accounts,index=0):
    async with client(accounts[0],index) as browser:
        return (await browser.post('/api/cloud/app/devices',json={'name':'Fixture PC'})).json()['token']


async def enroll(browser,accounts,**overrides):
    value={'token':overrides.get('token') or await token(accounts),'enabled':True,'selected':['selected'],'consent':True,'expected_owner':''}
    return await browser.put('/api/local/app-sync',json={**value,**overrides})


async def manual_run(browser,owner=''):
    return await browser.post('/api/local/app-sync/run',json={'expected_owner':owner})


@pytest.mark.asyncio
async def test_pc_enrollment_selects_data_keeps_credentials_private_and_disconnects(native_app,accounts,pc):
    async with local(native_app) as browser:
        first=await browser.get('/api/local/app-sync')
        assert first.status_code==200 and not first.json()['connected']
        issued=await token(accounts)
        enrolled=await enroll(browser,accounts,token=issued)
        assert enrolled.status_code==200,enrolled.text
        assert enrolled.json()['owner']==accounts[1][0]
        for response in (enrolled,await browser.get('/api/local/app-sync')):
            assert issued not in response.text and 'token' not in response.json()
        owner=accounts[1][0]
        saved=await manual_run(browser,owner)
        assert saved.status_code==200 and saved.json()['phase']=='saved'
        assert 'NEVER UPLOAD' not in json.dumps(accounts[0].state.unified.pull(accounts[1][0]))
        off=await browser.put('/api/local/app-sync',json={'enabled':False,'selected':['selected'],'expected_owner':accounts[1][0]})
        assert off.status_code==200 and not off.json()['enabled']
        assert (await manual_run(browser,owner)).json()=={'phase':'off'}
        assert (await browser.request('DELETE','/api/local/app-sync',json={'expected_owner':owner})).json()=={'connected':False,'enabled':False}
        assert not api.path().exists()
    with sqlite3.connect(pc) as db:
        assert db.execute('SELECT content FROM chat_history ORDER BY id').fetchall()==[('SELECTED',),('NEVER UPLOAD',)]


@pytest.mark.asyncio
@pytest.mark.parametrize('host,url,headers',[
    ('192.168.1.20','http://127.0.0.1:8000',{}),
    ('127.0.0.1','https://public.test',{}),
    ('127.0.0.1','http://127.0.0.1:8000',{'Forwarded':'for=127.0.0.1'}),
    ('127.0.0.1','http://127.0.0.1:8000',{'X-Forwarded-Host':'localhost'}),
])
async def test_all_pc_sync_routes_reject_lan_public_host_and_proxy(native_app,host,url,headers):
    async with local(native_app,host=host,url=url,headers=headers) as browser:
        for method,path in [('GET',''),('PUT',''),('DELETE',''),('POST','/run'),('GET','/status?session_id=selected'),('GET','/deletions'),('POST','/deletions')]:
            response=await browser.request(method,'/api/local/app-sync'+path,json={'token':'do-not-read-or-send'})
            assert response.status_code==403,(method,path,response.text)
    assert not api.path().exists()


@pytest.mark.asyncio
async def test_admin_relay_and_cloud_tenant_cannot_register_pc_credentials(native_app,accounts,pc):
    principal=RemotePrincipal('fixture',lambda _:True,lambda _:True)
    assert principal.management()
    async def relay(scope,receive,send):
        await native_app({**scope,'kyalulu.remote':principal},receive,send)
    async with local(relay) as browser:
        assert (await browser.put('/api/local/app-sync',json={})).status_code==403
    with storage_context(CloudStorageContext(accounts[1][0],pc.parent)):
        async with local(native_app) as browser:
            assert (await browser.put('/api/local/app-sync',json={})).status_code==403
    assert not api.path().exists()


@pytest.mark.asyncio
async def test_stale_owner_and_unconfirmed_account_switch_do_not_change_settings(native_app,accounts):
    async with local(native_app) as browser:
        assert (await enroll(browser,accounts)).status_code==200
        before=api.path().read_bytes();owner=accounts[1][0];other=accounts[1][1];new_token=await token(accounts,1)
        stale=await browser.put('/api/local/app-sync',json={'enabled':False,'selected':[],'expected_owner':''})
        assert stale.json()['error']=='sync_account_changed'
        assert api.path().read_bytes()==before
        change={'token':new_token,'enabled':True,'selected':[],'consent':True,'expected_owner':owner}
        assert (await browser.put('/api/local/app-sync',json=change)).json()['error']=='sync_account_switch_confirmation_required'
        assert api.path().read_bytes()==before
        assert (await browser.put('/api/local/app-sync',json={**change,'replace_account':True})).json()['owner']==other
        assert (await manual_run(browser,owner)).json()['error']=='sync_account_changed'
        assert (await browser.request('DELETE','/api/local/app-sync',json={'expected_owner':owner})).json()['error']=='sync_account_changed'
        assert (await browser.get('/api/local/app-sync')).json()['owner']==other
        stale=await browser.post('/api/local/app-sync/deletions',json={'confirmed':True,'expected_owner':owner})
        assert stale.json()['error']=='sync_account_changed'
        no_confirmation=await browser.post('/api/local/app-sync/deletions',json={'expected_owner':other})
        assert no_confirmation.json()['error']=='sync_delete_confirmation_required'


@pytest.mark.asyncio
async def test_origin_change_and_corrupt_config_never_forward_old_credentials(native_app,accounts,monkeypatch):
    async with local(native_app) as browser:
        assert (await enroll(browser,accounts)).status_code==200
        native_app.state.native_sync_transport=httpx.MockTransport(lambda _:pytest.fail('Must not send an old token'))
        monkeypatch.setenv('KYALULU_UNIFIED_CLOUD_ORIGIN','https://other.test')
        assert not (await browser.get('/api/local/app-sync')).json()['connected']
        assert (await manual_run(browser)).json()=={'phase':'off'}
        monkeypatch.setenv('KYALULU_UNIFIED_CLOUD_ORIGIN','https://app.test')
        api.path().write_text('{broken',encoding='utf-8')
        assert not (await browser.get('/api/local/app-sync')).json()['connected']
        assert (await manual_run(browser)).json()=={'phase':'off'}


@pytest.mark.asyncio
async def test_unresolved_withdrawal_survives_disconnect_without_resending_payload(native_app,accounts):
    async with local(native_app) as browser:
        assert (await enroll(browser,accounts)).status_code==200
        service=api.service(native_app);service.stage()
        def unavailable(request):raise httpx.ConnectError('fixture offline',request=request)
        native_app.state.native_sync_transport=httpx.MockTransport(unavailable)
        off=await browser.put('/api/local/app-sync',json={'enabled':False,'selected':[],'expected_owner':service.owner})
        assert off.status_code==200 and off.json()['pending'] and off.json()['error']=='sync_pending_receipt_retained'
        assert (await browser.request('DELETE','/api/local/app-sync',json={'expected_owner':service.owner})).status_code==200
        assert not api.path().exists() and service.status()['pending']
        native_app.state.native_sync_transport=httpx.ASGITransport(accounts[0])
        assert (await enroll(browser,accounts,enabled=False,selected=[])).status_code==200
        assert not service.status()['pending']
        assert accounts[0].state.unified.pull(accounts[1][0])['changes']==[]


@pytest.mark.asyncio
async def test_revoked_token_suspends_retries_and_new_enrollment_recovers(native_app,accounts):
    async with local(native_app) as browser:
        assert (await enroll(browser,accounts)).status_code==200
        value=api.config()
        async with client(accounts[0]) as cloud_browser:
            await cloud_browser.delete('/api/cloud/app/devices/'+value['device_id'])
        assert (await manual_run(browser,value['owner'])).status_code==401
        native_app.state.native_sync_transport=httpx.MockTransport(lambda _:pytest.fail('Do not retry revoked token'))
        assert (await manual_run(browser,value['owner'])).json()['phase']=='error'
        native_app.state.native_sync_transport=httpx.ASGITransport(accounts[0])
        assert (await enroll(browser,accounts,expected_owner=value['owner'])).status_code==200
        assert (await manual_run(browser,value['owner'])).json()['phase']=='saved'


@pytest.mark.asyncio
async def test_per_chat_header_status_never_claims_unselected_or_unstaged_data_is_synced(native_app,accounts):
    async with local(native_app) as browser:
        assert (await enroll(browser,accounts)).status_code==200
        async def status(sid):return (await browser.get('/api/local/app-sync/status',params={'session_id':sid})).json()
        selected=await status('selected');assert selected['selected'] and selected['enabled'] and not selected['pending']
        assert 'saved' not in selected and 'token' not in selected
        assert not (await status('private'))['selected']
        api.service(native_app).stage()
        assert (await status('selected'))['pending'] and not (await status('private'))['pending']


@pytest.mark.asyncio
async def test_background_without_enrollment_makes_no_connections_and_cancels_cleanly(native_app,monkeypatch):
    native_app.state.native_sync_transport=httpx.MockTransport(lambda _:pytest.fail('No enrollment'))
    waiting=asyncio.Event()
    async def interval(_seconds):
        waiting.set();await asyncio.Event().wait()
    monkeypatch.setattr(api.asyncio,'sleep',interval)
    task=asyncio.create_task(api.background(native_app))
    await asyncio.wait_for(waiting.wait(),2)
    task.cancel();result=await asyncio.gather(task,return_exceptions=True)
    assert isinstance(result[0],asyncio.CancelledError) and api.active is None
