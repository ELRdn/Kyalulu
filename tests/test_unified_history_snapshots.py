"""Historical state/memory interchange uses disposable SQLite, never providers."""
import json
import sqlite3
from copy import deepcopy
from pathlib import Path

import pytest

from test_unified_runtime_bridge import bridge, accept
from test_native_sync_client import pc
from python.storage import conversation, generations, entity_bridge
from python.storage.context import CloudStorageContext, storage_context


def history():
    return json.loads((Path(__file__).parent/'fixtures/unified-history.json').read_text(encoding='utf-8'))


@pytest.mark.asyncio
async def test_synced_snapshots_branch_from_historical_memory_and_regenerate_with_exact_prior_state(bridge):
    service,owner,path=bridge;accept(service,owner)
    incoming=history();sid=service.push(owner,'history',[incoming],runtime_path=path)['changes'][0]['runtime_session_id']
    with sqlite3.connect(path) as db:
        messages=db.execute('SELECT id,role FROM chat_history WHERE session_id=? ORDER BY id',(sid,)).fetchall()
        assert db.execute('SELECT COUNT(*) FROM generations WHERE session_id=?',(sid,)).fetchone()[0]==2
        memory=db.execute('SELECT content,source_generation_id FROM memories WHERE scope=?',('session:'+sid,)).fetchone()
        assert memory[0]=='coffee' and memory[1]
    with storage_context(CloudStorageContext(owner,path.parent)):
        prior=await generations.state_before(sid,messages[3][0],{})
        assert prior.turn==1 and prior.location=='library'
        copied=(await conversation.branch(sid,messages[1][0]))['session_id']
    with sqlite3.connect(path) as db:
        db.row_factory=sqlite3.Row
        assert db.execute('SELECT COUNT(*) FROM chat_history WHERE session_id=?',(copied,)).fetchone()[0]==2
        state=json.loads(db.execute('SELECT state_json FROM runtime_states WHERE session_id=?',(copied,)).fetchone()[0])
        assert state['turn']==1 and state['location']=='library'
        memories=db.execute('SELECT * FROM memories WHERE scope=?',('session:'+copied,)).fetchall()
        assert len(memories)==1 and memories[0]['content']=='tea' and memories[0]['version']==3
        assert memories[0]['source_generation_id']
        copied_user=db.execute("SELECT id FROM chat_history WHERE session_id=? AND role='user'",(copied,)).fetchone()[0]
        assert json.loads(memories[0]['source_message_ids'])==[copied_user]
        assert db.execute("SELECT content FROM memories WHERE scope=?",('session:'+sid,)).fetchone()[0]=='coffee'
        saved=json.loads(db.execute('SELECT result_json FROM generations WHERE session_id=?',(copied,)).fetchone()[0])
        assert saved['sync_snapshots']['after']['state']['session_id']==copied
        assert saved['sync_snapshots']['after']['memories'][0]['source_message_ids']==[copied_user]
        assert saved['sync_snapshots']['after']['memories'][0]['id']==memories[0]['id']
        assert 'coffee' not in json.dumps(saved['sync_snapshots'])
    with storage_context(CloudStorageContext(owner,path.parent)):
        async with generations.transaction() as db:
            await generations.invalidate(db,copied,saved['assistant_id'])
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT status FROM memories WHERE scope=?',('session:'+copied,)).fetchone()[0]=='deleted'
        assert db.execute('SELECT status FROM memories WHERE scope=?',('session:'+sid,)).fetchone()[0]=='active'


def test_snapshot_roundtrip_retains_uuid_versions_and_private_generation_details_stay_local(bridge):
    service,owner,path=bridge;accept(service,owner);incoming=history()
    sid=service.push(owner,'history',[incoming],runtime_path=path)['changes'][0]['runtime_session_id']
    with sqlite3.connect(path) as db:
        db.row_factory=sqlite3.Row
        mapping=json.loads(db.execute('SELECT mapping FROM unified_runtime_links WHERE session_id=?',(sid,)).fetchone()[0])
        db.execute('ATTACH DATABASE ? AS runtime',(str(path),))
        returned=entity_bridge.export_session(db,sid,incoming['id'],mapping)
    assert [message['uuid'] for message in returned['messages']]==['user-uuid','reply-uuid','user-2','assistant-2']
    for index in (1,3):
        before,after=returned['messages'][index]['before'],returned['messages'][index]['after']
        assert before['state']['turn']==index//2 and after['state']['turn']==index//2+1
        memory=after['memories'][0]
        assert memory['uuid']=='stable-memory' and memory['version']==(3 if index==1 else 4)
        assert memory['source_message_ids']==[index]
    assert returned['messages'][1]['after']['memories'][0]['content']=='tea'
    entity_bridge.validate(returned)


@pytest.mark.asyncio
async def test_native_finish_freezes_attributable_memories_and_does_not_export_prompts_or_shared_private_data(pc):
    from python.storage.native_sync import NativeSync
    with sqlite3.connect(pc) as db:
        db.execute("INSERT INTO session_scopes VALUES('selected','shared','legacy','{}')")
        for mid,sid,text in [('own','selected','tea'),('other','private','PRIVATE OTHER'),('unknown',None,'UNATTRIBUTED')]:
            db.execute("INSERT INTO memories(id,scope,type,content,source_session_id,source_message_ids) VALUES(?,'shared','semantic',?,?,?)",(mid,text,sid,'[1]' if sid=='selected' else '[]'))
    await generations.reserve('fixture-gen','selected',{'session_id':'selected'})
    result={'status':'completed','reply':'saved reply','state_before':{'session_id':'selected','turn':0},
            'state':{'session_id':'selected','turn':1,'location':'library'},'raw_prompt':'PRIVATE RAW PROMPT',
            'compiled':{'sections':{'private':'PRIVATE COMPILED'}},'mode':'immersion'}
    await generations.finish('fixture-gen',result,{'content':'tea'},'fixture-model')
    with sqlite3.connect(pc) as db:
        db.execute("UPDATE memories SET content='coffee',version=2 WHERE id='own'")
    sync=NativeSync(pc,'https://app.test','11111111-1111-1111-1111-111111111111','fixture-token-at-least-twenty')
    sync.configure(['selected'],True,consent=True);batch=sync.stage();exported=batch['changes'][0]['payload']
    assert exported['memories'][0]['content']=='coffee'
    saved=exported['messages'][-1]['after'];assert saved['memories'][0]['content']=='tea'
    assert saved['memories'][0]['source_message_ids']==[1]
    assert all(text not in json.dumps(exported) for text in ('PRIVATE OTHER','UNATTRIBUTED','PRIVATE RAW PROMPT','PRIVATE COMPILED'))
    entity_bridge.validate(exported)


@pytest.mark.asyncio
@pytest.mark.parametrize('point,turn,count,memories',[(0,0,1,[]),(2,1,3,['tea'])])
async def test_branch_at_user_message_uses_that_turns_before_snapshot(bridge,point,turn,count,memories):
    service,owner,path=bridge;accept(service,owner)
    sid=service.push(owner,'user-point',[history()],runtime_path=path)['changes'][0]['runtime_session_id']
    with sqlite3.connect(path) as db:message=db.execute('SELECT id FROM chat_history WHERE session_id=? ORDER BY id',(sid,)).fetchall()[point][0]
    with storage_context(CloudStorageContext(owner,path.parent)):copy=(await conversation.branch(sid,message))['session_id']
    with sqlite3.connect(path) as db:
        state=json.loads(db.execute('SELECT state_json FROM runtime_states WHERE session_id=?',(copy,)).fetchone()[0])
        assert state['turn']==turn
        assert db.execute('SELECT COUNT(*) FROM chat_history WHERE session_id=?',(copy,)).fetchone()[0]==count
        assert [row[0] for row in db.execute('SELECT content FROM memories WHERE scope=?',('session:'+copy,))]==memories


@pytest.mark.parametrize('damage',['future_source','future_turn','before_self_source','only_before','wrong_role','bad_turn','duplicate_memory','bad_memory_type'])
def test_corrupt_snapshots_roll_back_projection_and_receipt(bridge,damage):
    service,owner,path=bridge;accept(service,owner);incoming=history();message=incoming['payload']['messages'][1]
    if damage=='future_source':message['after']['memories'][0]['source_message_ids']=[4]
    elif damage=='future_turn':message['after']['memories'][0]['source_turn']=2
    elif damage=='before_self_source':message['before']['memories']=[{**deepcopy(message['after']['memories'][0]),'source_turn':0,'source_message_ids':[2]}]
    elif damage=='only_before':message.pop('after')
    elif damage=='wrong_role':message['role']='user'
    elif damage=='bad_turn':message['after']['state']['turn']=0
    elif damage=='duplicate_memory':message['after']['memories']*=2
    else:message['after']['memories'][0]['type']='unknown'
    with pytest.raises(Exception) as error:
        service.push(owner,'corrupt',[incoming],runtime_path=path)
    from python.cloud.store import CloudError
    assert isinstance(error.value,CloudError)
    with service.store.transaction() as db:
        assert not db.execute("SELECT 1 FROM app_sync_requests WHERE id='corrupt'").fetchone()
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0]==1
        assert db.execute('SELECT COUNT(*) FROM generations').fetchone()[0]==0
