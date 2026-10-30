import { expect, it } from 'vitest';
import { receiveConversation, receiveLibrarySnapshot, receiveCreatorSnapshot, rebindConversation, withLibrarySnapshots } from './appSyncData';
import { offlineStub, type AppEntity } from './appStore';
import sharedHistory from '../../../../tests/fixtures/unified-history.json';

const wire = () => ({storage_policy:'sync',rating:'general',settings:{session_id:'chat'},state:{session_id:'chat',turn:1},
  messages:[{id:1,uuid:'user',role:'user',content:'tea'},{id:2,uuid:'assistant',role:'assistant',content:'yes',
    before:{state:{session_id:'chat',turn:0},memories:[]},after:{state:{session_id:'chat',turn:1},memories:[{id:'memory',source_message_ids:[1]}]}}],
  memories:[{id:'memory',scope:'chat',type:'semantic',content:'tea',source_message_ids:[1]}],
  summaries:[{id:'summary',method:'extractive',text:'[1:user] tea [2:assistant] yes',source_message_ids:[1,2]}],last_generation:{user_id:1,assistant_id:2}});

it('does not carry a foreign worker pending flag into an independent sync/branch copy',()=>{
  const payload={...wire(),pending_generation:'other-document-worker',draft:'retain independent draft'};
  let number=100;const received=receiveConversation(payload,undefined,()=>++number);
  expect(received.pending_generation).toBeNull();expect(received.draft).toBe(payload.draft);
  expect(received.messages.map((m:any)=>m.content)).toEqual(payload.messages.map(m=>m.content));
  expect(payload.pending_generation).toBe('other-document-worker');
});

it('imports the same historical fixture as Python without mixing memory revisions',()=>{
  let number=500;const value=receiveConversation(sharedHistory.payload,undefined,()=>++number);
  expect(value.messages[1].after.memories[0]).toMatchObject({uuid:'stable-memory',content:'tea',version:3,source_message_ids:[501]});
  expect(value.messages[3].after.memories[0]).toMatchObject({uuid:'stable-memory',content:'coffee',version:4,source_message_ids:[503]});
  expect(value.messages[1].after.memories[0].id).toBe(value.memories[0].id);
  expect(value.messages[1].after.settings.system_prompt).toBe('OLD SYSTEM');
  expect(value.messages[1].after.settings.library_binding.character.revision).toBe(1);
});
it('uploads only the current and historical setting revisions referenced by the chat',()=>{
  const payload:any=structuredClone(sharedHistory.payload);payload.library_snapshots['unrelated@1']={name:'PRIVATE UNRELATED'};
  const outgoing=withLibrarySnapshots(payload,[]);
  expect(Object.keys(outgoing.library_snapshots).sort()).toEqual(['character@1','character@2']);
  expect(Object.keys(outgoing.creator_snapshots).sort()).toEqual(['created_'+'a'.repeat(32)+'@1','created_'+'a'.repeat(32)+'@2']);
  expect(JSON.stringify(outgoing)).not.toContain('PRIVATE UNRELATED');
});
it.each(['future_source','before_self_source','bad_turn','duplicate_memory','missing_after'])('rejects corrupt historical snapshots: %s',damage=>{
  const payload:any=structuredClone(sharedHistory.payload),message=payload.messages[1];
  if(damage==='future_source')message.after.memories[0].source_message_ids=[4];
  else if(damage==='before_self_source')message.before.memories=[{...message.after.memories[0],source_turn:0,source_message_ids:[2]}];
  else if(damage==='bad_turn')message.after.state.turn=0;
  else if(damage==='duplicate_memory')message.after.memories.push(structuredClone(message.after.memories[0]));
  else delete message.after;
  let number=0;expect(()=>receiveConversation(payload,undefined,()=>++number)).toThrow();
});

it('keeps only referenced creator revisions and rejects immutable or owner conflicts',()=>{
  const id='created_'+'a'.repeat(32),first=receiveCreatorSnapshot(undefined,'owner',id+'@1','world',{display_name:'Old',rules:'pinned'});
  const second=receiveCreatorSnapshot(first,'owner',id+'@2','world',{display_name:'New',rules:'latest'});
  expect(second.payload.creator.display_name).toBe('New');
  const payload={...wire(),settings:{session_id:'chat',world_id:id+'@1'}};
  const outgoing=withLibrarySnapshots(payload,[second]);expect(outgoing.creator_snapshots[id+'@1'].document.rules).toBe('pinned');
  expect(JSON.stringify(outgoing)).not.toContain('latest');
  expect(()=>receiveCreatorSnapshot(second,'owner',id+'@1','world',{display_name:'Changed'})).toThrow('Immutable');
  expect(()=>receiveCreatorSnapshot(second,'other',id+'@1','world',{display_name:'Old',rules:'pinned'})).toThrow('identity');
  expect(()=>withLibrarySnapshots(payload,[])).toThrow('missing');
});

it('allocates device IDs and remaps summaries, historical memories and generation references together',()=>{
  const payload=wire();let sequence=100;
  const copy=receiveConversation(payload,undefined,()=>++sequence);
  expect(copy.messages.map((m:any)=>m.id)).toEqual([101,102]);
  expect(copy.memories[0]).toMatchObject({uuid:'memory',source_message_ids:[101]});
  expect(copy.messages[1].after.memories[0].id).toBe(copy.memories[0].id);
  expect(copy.summaries[0]).toMatchObject({source_message_ids:[101,102],text:'[101:user] tea [102:assistant] yes'});
  expect(copy.last_generation).toEqual({user_id:101,assistant_id:102});
  expect(payload.messages[0].id).toBe(1);
});
it('retains local identity by UUID when another device renumbers the same history',()=>{
  let sequence=20;const saved=receiveConversation(wire(),undefined,()=>++sequence),next=wire();
  next.messages[0].id=88;next.messages[1].id=99;next.memories[0].source_message_ids=[88];
  next.messages[1].after!.memories[0].source_message_ids=[88];next.summaries[0].source_message_ids=[88,99];
  next.last_generation={user_id:88,assistant_id:99};
  const updated=receiveConversation(next,saved,()=>{throw Error('must not allocate');});
  expect(updated.messages.map((m:any)=>m.id)).toEqual([21,22]);expect(updated.memories[0].id).toBe(saved.memories[0].id);
});
it('gives a branch independent numeric and memory IDs while retaining source UUIDs',()=>{
  let n=0;const first=receiveConversation(wire(),undefined,()=>++n),branch=receiveConversation(first,undefined,()=>++n);
  expect(branch.messages.map((m:any)=>m.id)).toEqual([3,4]);
  expect(branch.memories[0].id).not.toBe(first.memories[0].id);expect(branch.memories[0].uuid).toBe(first.memories[0].uuid);
  const rebound=rebindConversation(branch,'fork');
  expect(rebound.state.session_id).toBe('fork');expect(rebound.messages[1].after.state.session_id).toBe('fork');expect(rebound.memories[0].scope).toBe('fork');
});

it('rebinds attributable memory ownership for an independent branch/recovery and retains original provenance',()=>{
  const payload=wire();payload.memories[0]=Object.assign(payload.memories[0],{source_session_id:'chat',source_generation_id:'original-generation'});
  payload.messages[1].after!.memories=structuredClone(payload.memories);
  const copy=rebindConversation(payload,'recovery');
  for(const memory of [copy.memories[0],copy.messages[1].after.memories[0]])expect(memory).toMatchObject({source_session_id:'recovery',original_source_session_id:'chat',source_generation_id:'original-generation'});
  expect((payload.memories[0] as any).source_session_id).toBe('chat');
});

it('keeps local retrieval diagnostics and worker leases out of the synchronized generation summary',()=>{
  const payload:any=wire();payload.last_generation={...payload.last_generation,status:'completed',reply:'authored reply',
    raw_prompt:'FOREIGN SECRET',compiled:{system_prompt:'FOREIGN SECRET'},attempts:['FOREIGN SECRET'],memory:{candidates:['FOREIGN SECRET']},
    execution_lock:'owner lock',validation:{ok:true,retries:1,errors:['FOREIGN SECRET']},telemetry:{elapsed_ms:10,memory:{candidates:['FOREIGN SECRET']}}};
  const outgoing=withLibrarySnapshots(payload,[]);
  expect(JSON.stringify(outgoing)).not.toContain('FOREIGN SECRET');expect(outgoing.last_generation).toEqual({user_id:1,assistant_id:2,status:'completed',reply:'authored reply',validation:{ok:true,retries:1,errors:[]},telemetry:{elapsed_ms:10}});
  let id=100;expect(JSON.stringify(receiveConversation(payload,undefined,()=>++id))).not.toContain('FOREIGN SECRET');
  expect(payload.last_generation.raw_prompt).toBe('FOREIGN SECRET');
});
it('remaps memory objects shared by current and historical snapshots only once',()=>{
  const payload=wire();payload.messages[1].after!.memories=payload.memories;
  let n=40;const received=receiveConversation(payload,undefined,()=>++n);
  expect(received.memories[0].source_message_ids).toEqual([41]);
  expect(received.messages[1].after.memories[0].source_message_ids).toEqual([41]);
});
it('rejects duplicate identities and dangling source links before adopting a conversation',()=>{
  let n=0;const duplicate=wire();duplicate.messages[1].id=1;
  expect(()=>receiveConversation(duplicate,undefined,()=>++n)).toThrow('identity');
  const broken=wire();broken.memories[0].source_message_ids=[999];
  expect(()=>receiveConversation(broken,undefined,()=>++n)).toThrow('Missing message source');
});
it('preserves immutable library revisions and refuses changed content or adult/media snapshots',()=>{
  const first=receiveLibrarySnapshot(undefined,'owner','character',1,{name:'Tea',data:{a:1,b:2}});
  expect(receiveLibrarySnapshot(first,'owner','character',1,{data:{b:2,a:1},name:'Tea'}).payload.document.name).toBe('Tea');
  const next=receiveLibrarySnapshot(first,'owner','character',2,{name:'Coffee'});
  expect(next.payload.versions['1']).toEqual(first.payload.document);expect(next.payload.document.name).toBe('Coffee');
  expect(()=>receiveLibrarySnapshot(first,'owner','character',1,{name:'Changed'})).toThrow('Immutable');
  expect(()=>receiveLibrarySnapshot(first,'owner','character',3,{name:'Adult',nsfw:true})).toThrow('Unsupported');
});
it('adds a referenced revision without changing the current editable local library document',()=>{
  const first=receiveLibrarySnapshot(undefined,'owner','character',1,{name:'Local'});
  first.payload={...first.payload,snapshot_only:false};first.dirty=true;
  const next=receiveLibrarySnapshot(first,'owner','character',4,{name:'Referenced'});
  expect(next.payload.document.name).toBe('Local');expect(next.payload.current_revision).toBe(1);expect(next.revision).toBe(first.revision+1);expect(next.dirty).toBe(true);
  expect(next.payload.versions['4'].name).toBe('Referenced');
});
it('uploads only the exact referenced library revision, excluding other private library data',()=>{
  const character=receiveLibrarySnapshot(undefined,'owner','character',1,{name:'Referenced'});
  const privateCharacter=receiveLibrarySnapshot(undefined,'owner','private',1,{name:'PRIVATE-DO-NOT-UPLOAD'});
  const payload={...wire(),settings:{session_id:'chat',library_binding:{character:{id:'character',revision:1}}}};
  const outgoing=withLibrarySnapshots(payload,[character,privateCharacter]);
  expect(Object.keys(outgoing.library_snapshots)).toEqual(['character@1']);expect(JSON.stringify(outgoing)).not.toContain('PRIVATE');
});
it('retains only cache list metadata and stable identities when archiving an acknowledged body',()=>{
  const record={id:'chat',owner:'owner',kind:'conversation',revision:2,serverRevision:1,payload:wire(),dirty:false,deleted:false,pinned:false,opened:1} as AppEntity;
  const stub=offlineStub(record);
  expect(stub.payload.messages).toEqual([{id:1,uuid:'user'},{id:2,uuid:'assistant'}]);
  expect(stub.payload.memories[0].content).toBeUndefined();expect(stub.payload.state).toBeUndefined();
  expect(stub.payload.cache_preview).toMatchObject({count:2,last_preview:'yes'});
  let sequence=100;const restored=receiveConversation(wire(),stub.payload,()=>++sequence);
  expect(restored.messages.map((m:any)=>m.id)).toEqual([1,2]);expect(restored.memories[0].id).toBe('memory');
});
