"""Disposable credentials/data only. No native client or production enrollment."""
import json
import sqlite3
import time
from dataclasses import replace
from uuid import uuid4
import httpx
import pytest

from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version, digest
from python.cloud.config import CloudConfig
from python.cloud.store import CloudError, fingerprint
from python.storage import db as storage
from python.storage import entity_bridge as bridge


@pytest.fixture
def accounts(tmp_path):
    config=CloudConfig(root=tmp_path, origin='https://app.test',secret='s'*32, unified_enabled=True,
                       region_policies=(('JP',{'accepted':True,'version':'fixture'}),))
    app=create_app(config,transport=httpx.MockTransport(lambda _:pytest.fail('No providers')))
    owners=[str(uuid4()),str(uuid4())]
    for index,owner in enumerate(owners):
        app.state.store.account(owner,consent=provider_consent_version(config))
        app.state.store.secret(owner,'app-eligibility',json.dumps({'country':'JP','age_band':'adult','policy':'fixture'}))
        app.state.auth.save('fixture-session-'+str(index),owner,{'access_token':'fake','refresh_token':'fake','expires_in':3600})
    return app,owners


def client(app,index=0,**kwargs):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app),base_url='https://app.test',
        cookies={SESSION_COOKIE:'fixture-session-'+str(index)},headers={'Origin':'https://app.test'},**kwargs)


@pytest.mark.asyncio
async def test_entity_device_token_is_separate_owner_bound_and_revocable(accounts):
    app,(owner,other)=accounts
    async with client(app) as browser:
        issued=await browser.post('/api/cloud/app/devices',json={'name':'Fixture PC'})
        assert issued.status_code==200,issued.text
        issued=issued.json();token=issued['token'];headers={'Authorization':'Bearer '+token}
        with app.state.store.transaction() as db:
            row=dict(db.execute('SELECT * FROM app_sync_devices WHERE id=?',(issued['id'],)).fetchone())
            assert row['hash']==digest(token) and token not in json.dumps(row)
        identity=await browser.get('/api/cloud/app/sync/device',headers=headers)
        assert identity.json()=={'owner':owner,'device_id':issued['id'],'protocol':'entity-v1'}
        assert (await browser.get('/api/cloud/app/sync',headers=headers)).status_code==403
        scoped={**headers,'X-Kyalulu-Owner':owner}
        assert (await browser.get('/api/cloud/app/sync',headers=scoped)).status_code==200
        assert (await browser.get('/api/cloud/app/sync',headers={**scoped,'X-Kyalulu-Owner':other})).status_code==403
        for method,path in [('GET','/api/cloud/account'),('GET','/api/chat/history'),('GET','/api/cloud/sync'),
                ('POST','/api/cloud/app/devices'),('PUT','/api/cloud/app/runtime-consent'),('POST','/api/cloud/app/daily'),('GET','/api/cloud/app/devices')]:
            response=await browser.request(method,path,headers=scoped,json={} if method!='GET' else None)
            assert response.status_code in (401,403),(path,response.text)
        old=(await browser.post('/api/cloud/sync/device')).json()['token']
        assert (await browser.get('/api/cloud/app/sync/device',headers={'Authorization':'Bearer '+old})).status_code==401
        listing=(await browser.get('/api/cloud/app/devices')).json()['devices']
        assert listing[0]['id']==issued['id'] and 'hash' not in listing[0] and 'token' not in listing[0]
        async with client(app,1) as other_browser:
            assert (await other_browser.get('/api/cloud/app/devices')).json()=={'devices':[]}
            await other_browser.delete('/api/cloud/app/devices/'+issued['id'])
        assert (await browser.get('/api/cloud/app/sync/device',headers=headers)).status_code==200
        await browser.delete('/api/cloud/app/devices/'+issued['id'])
        assert (await browser.get('/api/cloud/app/sync/device',headers=headers)).status_code==401


@pytest.mark.asyncio
async def test_device_expiry_session_revocation_names_and_limit(accounts):
    app,(owner,_)=accounts
    async with client(app) as browser:
        assert (await browser.get('/api/cloud/app/sync/device')).status_code==403
        for name in ('',[], 'x'*81,'bad\nname'):
            assert (await browser.post('/api/cloud/app/devices',json={'name':name})).status_code==400
        records=[(await browser.post('/api/cloud/app/devices',json={'name':'PC '+str(i)})).json() for i in range(5)]
        assert (await browser.post('/api/cloud/app/devices',json={'name':'extra'})).status_code==429
        with app.state.store.transaction() as db:
            db.execute('UPDATE app_sync_devices SET expires=? WHERE id=?',(time.time()-1,records[0]['id']))
        headers={'Authorization':'Bearer '+records[0]['token']}
        assert (await browser.get('/api/cloud/app/sync/device',headers=headers)).status_code==401
        with app.state.store.transaction() as db:
            db.execute('DELETE FROM sessions WHERE hash=?',(digest('fixture-session-0'),))
        assert (await browser.get('/api/cloud/app/sync/device',headers={'Authorization':'Bearer '+records[1]['token']})).status_code==401
        app.state.auth.save('fixture-replacement',owner,{'access_token':'fake','refresh_token':'fake','expires_in':3600})
        browser.cookies.set(SESSION_COOKIE,'fixture-replacement')
        assert (await browser.get('/api/cloud/app/devices')).json()['devices']==[]
        assert (await browser.post('/api/cloud/app/devices',json={'name':'Replacement PC'})).status_code==200


@pytest.fixture
def native(tmp_path):
    path=tmp_path/'data.db'
    with sqlite3.connect(path) as source:
        source.executescript(storage.DDL)
        for statement in storage.MIGRATIONS:source.execute(statement)
        source.execute("INSERT INTO session_settings(session_id) VALUES('local')")
        source.execute("INSERT INTO chat_history(session_id,role,content) VALUES('local','user','PRIVATE NATIVE')")
    with sqlite3.connect(':memory:') as db:
        db.row_factory=sqlite3.Row;db.execute('ATTACH DATABASE ? AS runtime',(str(path),))
        yield db


def payload():
    return {'storage_policy':'sync','settings':{'session_id':'entity'},'messages':[{'id':1,'uuid':'message','role':'user','content':'fixture'}],
            'memories':[],'summaries':[],'state':{'session_id':'entity'}}


def test_native_links_are_namespaced_and_never_reexport_a_different_account(native):
    first=fingerprint(['https://app.test',str(uuid4())]);second=fingerprint(['https://app.test',str(uuid4())])
    bridge.prepare(native,first);bridge.prepare(native,second)
    selected=bridge.capture(native,['local'],first)[0]
    bridge.acknowledge_capture(native,selected,selected['id'],1,first)
    assert bridge.Links(native,second).session('local') is None
    with pytest.raises(CloudError,match='sync_account_copy_required'):
        bridge.capture(native,['local'],second)
    # The same wire ID in two accounts remains two independent native copies.
    a=bridge.import_copy(native,'entity',1,payload(),{},first)
    b=bridge.import_copy(native,'entity',1,payload(),{},second)
    assert a!=b and bridge.import_copy(native,'entity',1,payload(),{},first)==a
    assert bridge.Links(native,first).version('entity',1)['session_id']==a
    assert bridge.Links(native,second).version('entity',1)['session_id']==b


def test_scoped_tombstone_keeps_other_account_and_unsent_edits(native):
    first='a'*64;second='b'*64
    bridge.prepare(native,first);bridge.prepare(native,second)
    a=bridge.import_copy(native,'entity',1,payload(),{},first)
    b=bridge.import_copy(native,'entity',1,payload(),{},second)
    native.execute('UPDATE runtime.chat_history SET content=? WHERE session_id=?',('UNSENT',a))
    deleted,recovered=bridge.apply_tombstones(native,[{'id':'entity'}],first)
    assert deleted==[] and recovered==[a]
    assert native.execute('SELECT content FROM runtime.chat_history WHERE session_id=?',(a,)).fetchone()[0]=='UNSENT'
    assert native.execute('SELECT content FROM runtime.chat_history WHERE session_id=?',(b,)).fetchone()[0]=='fixture'
    deleted,recovered=bridge.apply_tombstones(native,[{'id':'entity'}],second)
    assert deleted==[b] and recovered==[]
    assert native.execute('SELECT 1 FROM runtime.session_deletions WHERE session_id=?',(b,)).fetchone()
    assert native.execute('SELECT content FROM runtime.chat_history WHERE session_id=?',(a,)).fetchone()[0]=='UNSENT'
