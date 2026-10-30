import { harness, decoded } from './idbHarness.test-support';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({owner:'owner-a',records:new Map<string,any>(),parts:new Map<string,any>(),meta:new Map<string,any>(),failSave:false}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,setGenerationBusy:vi.fn()}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class{}}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',name:'Fixture',runtime:'gguf'}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('./appStore',async original=>{
  const read=async(id:string,owner=fixture.owner)=>decoded(fixture.records.get(owner+':'+id),fixture.parts);
  return {...await original<typeof import('./appStore')>(),
    allEntities:vi.fn(async(owner:string)=>[...fixture.records.values()].filter(e=>e.owner===owner).map(value=>decoded(value,fixture.parts))),
    entity:vi.fn(read),openEntity:vi.fn(read),trimOfflineCache:vi.fn(async()=>{}),
    getMeta:vi.fn(async(key:string)=>structuredClone(fixture.meta.get(key))),
    setMeta:vi.fn(async(key:string,value:unknown)=>{fixture.meta.set(key,structuredClone(value));}),
    saveEntity:vi.fn(async(value:any,_revision:number,metadata:Record<string,unknown>={})=>{
      if(fixture.failSave)throw Error('Fictional storage failure');
      // Metadata is committed together with the entity by the real IndexedDB save.
      const saved=structuredClone({...value,revision:value.revision+1});fixture.records.set(value.owner+':'+value.id,saved);
      for(const [key,item] of Object.entries(metadata))fixture.meta.set(key,structuredClone(item));
      return saved;
    }),
    appTransaction:vi.fn((_stores:string[],mode:string,action:any)=>harness(fixture.records,fixture.meta,fixture.parts,key=>key.join(':'),mode,action)),
  };
});

import { PortableDocumentSchema, RuntimeStateSchema } from '../../../../packages/schemas/src';
import { allEntities, appTransaction, entity, getMeta, newEntity, openEntity, saveEntity, setMeta } from './appStore';
import { deviceFetch } from './deviceApi';
import { hydrateConversation } from './appSync';

const request=async(path:string,body?:unknown,method=body?'POST':'GET')=>{
  const response=await deviceFetch(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
};
const put=(value:ReturnType<typeof newEntity>)=>fixture.records.set(value.owner+':'+value.id,value);
const saved=()=>decoded(fixture.records.get('owner-a:requested'),fixture.parts);
const remote={source:'github',source_id:'fixture/card.json',sha256:'a'.repeat(64),document_index:0,content_rating:'sfw'};
const document=PortableDocumentSchema.parse({name:'Saved character',source:{remote},data:{description:'Known character'}});
const creatorId='created_'+'a'.repeat(32);

beforeEach(()=>{
  vi.clearAllMocks();fixture.owner='owner-a';fixture.records.clear();fixture.parts.clear();fixture.meta.clear();fixture.failSave=false;
  vi.stubGlobal('IDBKeyRange',{bound:(lower:unknown,upper:unknown)=>({lower,upper})});
  vi.stubGlobal('indexedDB',{open:vi.fn(()=>{throw Error('Storage unavailable');})});
  vi.stubGlobal('location',{href:'https://device.test/device/',origin:'https://device.test'});
  for(const [owner,id,content,messageId] of [['owner-a','requested','Requested history',71],['owner-a','unrelated','Unrelated history',900],['owner-b','requested','Foreign history',5000]] as const){
    put({...newEntity('conversation',id,{storage_policy:'local',settings:{session_id:id,system_prompt:'KEEP',temperature:.8},
      messages:[{id:messageId,role:'user',content,created_at:'2026-10-29T00:00:00Z'}],
      memories:[{id:'memory-'+id,content,type:'semantic',status:'active',version:1}],
      summaries:[{id:'summary',text:content,revision:1}],state:RuntimeStateSchema.parse({session_id:id}),memory_enabled:true,
      draft:'Unsent draft',pending_generation:'pending-'+id},owner),revision:3});
  }
  for(const owner of ['owner-a','owner-b'])put({...newEntity('character','saved',{document:{...document,name:owner==='owner-a'?document.name:'Foreign character'},versions:{'1':document}},owner),revision:1});
  put({...newEntity('character','deleted',{document,versions:{'1':document}},'owner-a'),deleted:true});
  put({...newEntity('world',creatorId,{creator:{display_name:'Saved world'},versions:{'1':{display_name:'Saved world'}}},'owner-a'),revision:1});
  put(newEntity('preset','preset',{name:'Saved preset',content:'Preset text'},'owner-a'));
  fixture.meta.set('generation:owner-a:done',{generation_id:'done',session_id:'requested',status:'completed',reply:'Saved reply'});
});
afterEach(()=>vi.unstubAllGlobals());

it.each([
  ['/api/mobile/status',{device_mode:true,authenticated:true}],
  ['/api/health',{status:'ok',runtime:'browser'}],
  ['/api/capabilities',{schema_version:1,mode:'local',features:{branch:true,regenerate:true}}],
  ['/api/providers/health',{health:[{id:'browser',provider:'browser',status:'ok'}]}],
  ['/api/diagnostics',{ready:true}],['/api/commands',{commands:[]}],
  ['/api/models',{models:[{id:'fixture',available:true}]}],
  ['/api/scenarios',{scenarios:expect.any(Array)}],
  ['/api/local/cloud/status',{mode:'off',connected:false}],['/api/remote/status',{connected:false}],
])('serves %s without opening device storage',async(path,expected)=>{
  const response=await request(path);expect(response.status).toBe(200);expect(response.body).toMatchObject(expected);
  for(const operation of [allEntities,entity,openEntity,getMeta,setMeta,saveEntity,appTransaction,indexedDB.open])expect(operation).not.toHaveBeenCalled();
});

it.each([
  ['/api/chat/history?session_id=requested',{history:[{id:71,content:'Requested history'}]}],
  ['/api/chat/settings?session_id=requested',{session_id:'requested',system_prompt:'KEEP'}],
  ['/api/memory?scope=requested',{memories:[{content:'Requested history'}]}],
  ['/api/memory/session/requested',{scope:'requested',enabled:true}],
  ['/api/memory/session/requested/scope-preview',{scope:'requested',preview_revision:'3',memories:[{content:'Requested history'}]}],
  ['/api/chat/context/requested',{history_revision:'3',summaries:[{text:'Requested history'}]}],
  ['/api/chat/debug?session_id=requested',{session_id:'requested',history_count:1,settings:{system_prompt:'KEEP'}}],
  ['/api/chat/intro/inject?session_id=requested',{injected:false}],
])('reads only the requested owner and conversation for %s',async(path,expected)=>{
  const before=structuredClone(fixture.records),response=await request(path);
  expect(response.status).toBe(200);expect(response.body).toMatchObject(expected);
  expect(allEntities).not.toHaveBeenCalled();expect(entity).not.toHaveBeenCalled();
  expect(openEntity).toHaveBeenCalledExactlyOnceWith('requested','owner-a');expect(fixture.records).toEqual(before);
});

it('preserves immutable bindings, pending generation and unsent input when saving settings',async()=>{
  const before=structuredClone(saved().payload);
  const response=await request('/api/chat/settings',{session_id:'requested',system_prompt:'Updated',temperature:.5,character_id:'saved'},'PUT');
  expect(response).toEqual({status:200,body:{ok:true}});
  expect(saved().payload.settings).toMatchObject({system_prompt:'Updated',library_binding:{character:{id:'saved',revision:1}}});
  for(const key of ['messages','memories','summaries','state','draft','pending_generation'])expect(saved().payload[key]).toEqual(before[key]);
  expect(saveEntity).toHaveBeenCalledWith(expect.objectContaining({id:'requested',owner:'owner-a'}),3);
  expect(openEntity).toHaveBeenCalledExactlyOnceWith('requested','owner-a');
  expect(vi.mocked(entity).mock.calls.every(([id,owner])=>id==='saved'&&owner==='owner-a')).toBe(true);
  expect(allEntities).not.toHaveBeenCalled();
});

it('uses a single conversation for manual memory writes',async()=>{
  const before=structuredClone(saved().payload);
  const response=await request('/api/memory',{scope:'requested',type:'semantic',content:'New memory'});
  expect(response.status).toBe(200);expect(response.body).toMatchObject({scope:'requested',content:'New memory',origin:'user',status:'active',supported:null,
    source_kind:'user_statement',source_quote:'New memory',source_revision:'manual:1',confirmation:'user_confirmed',source_message_ids:[]});
  expect(saved().payload.memories).toEqual([...before.memories,response.body]);
  expect(saved().payload.messages).toEqual(before.messages);expect(saved().payload.draft).toBe(before.draft);
  expect(openEntity).toHaveBeenCalledExactlyOnceWith('requested','owner-a');expect(allEntities).not.toHaveBeenCalled();
});

it.each([
  ['/api/library/saved',{id:'saved',document:{name:'Saved character'}}],
  ['/api/library/saved/revisions',{items:[{revision:1,document:{name:'Saved character'}}]}],
  ['/api/library/saved/export?revision=1',{filename:expect.any(String),bytes:expect.any(Number)}],
  ['/api/creator/world/'+creatorId+'@1',{item:{display_name:'Saved world',revision:1}}],
])('reads only its Library or creator item for %s',async(path,expected)=>{
  const response=await request(path);expect(response.status).toBe(200);expect(response.body).toMatchObject(expected);
  expect(entity).toHaveBeenCalledExactlyOnceWith(path.includes('/creator/')?creatorId:'saved','owner-a');
  expect(allEntities).not.toHaveBeenCalled();expect(openEntity).not.toHaveBeenCalled();
});

it('keeps Library revisions immutable without reading conversations',async()=>{
  const response=await request('/api/library/saved',{expected_revision:1,document:{...document,name:'Updated'}},'PUT');
  expect(response.status).toBe(200);expect(response.body).toMatchObject({id:'saved',revision:2,document:{name:'Updated'}});
  expect(decoded(fixture.records.get('owner-a:saved'),fixture.parts).payload.versions['1']).toEqual(document);
  expect(decoded(fixture.records.get('owner-b:saved'),fixture.parts).payload.document.name).toBe('Foreign character');
  expect(entity).toHaveBeenCalledExactlyOnceWith('saved','owner-a');expect(allEntities).not.toHaveBeenCalled();expect(openEntity).not.toHaveBeenCalled();
});

it('reads generation status from owner metadata without reading entities',async()=>{
  expect(await request('/api/chat/generations/done?session_id=requested')).toEqual({status:200,body:{generation_id:'done',session_id:'requested',status:'completed',reply:'Saved reply'}});
  expect(getMeta).toHaveBeenCalledExactlyOnceWith('generation:owner-a:done');
  expect(allEntities).not.toHaveBeenCalled();expect(entity).not.toHaveBeenCalled();expect(openEntity).not.toHaveBeenCalled();
});

it.each([
  ['/api/chat/sessions','sessions',{session_id:'requested',count:1,last_preview:'Requested history'}],
  ['/api/library','items',{id:'saved',document:expect.objectContaining({name:'Saved character'})}],
  ['/api/characters','characters',{id:'saved',display_name:'Saved character'}],
  ['/api/worlds','worlds',{asset_id:creatorId,display_name:'Saved world'}],
  ['/api/creator/world','items',{asset_id:creatorId,display_name:'Saved world'}],
  ['/api/prompts/presets','presets',{id:'preset',content:'Preset text'}],
])('retains the live owner list for %s',async(path,key,expected)=>{
  const response=await request(path);expect(response.status).toBe(200);expect(response.body[key]).toContainEqual(expect.objectContaining(expected));
  expect(JSON.stringify(response.body)).not.toMatch(/Foreign|deleted/);
  expect(allEntities).toHaveBeenCalledExactlyOnceWith('owner-a');expect(openEntity).not.toHaveBeenCalled();
});

it.each([
  ['/api/chat/history/900',{content:'Edited message'},'PUT','messages'],
  ['/api/memory/memory-unrelated',{content:'Edited memory'},'PUT','memories'],
])('retains owner-wide ID lookup for %s',async(path,body,method,key)=>{
  const response=await request(path,body,method);expect(response.status).toBe(200);
  expect(decoded(fixture.records.get('owner-a:unrelated'),fixture.parts).payload[key][0].content).toBe(body.content);
  expect(saved().payload.messages[0].content).toBe('Requested history');
  expect(allEntities).toHaveBeenCalledExactlyOnceWith('owner-a');expect(openEntity).toHaveBeenCalledExactlyOnceWith('unrelated','owner-a');
});

it('retains duplicate detection and owner-wide message IDs when importing histories',async()=>{
  const source={...document,histories:[{name:'Imported',messages:[{role:'user',content:'Imported user'},{role:'assistant',content:'Imported reply'}]}]};
  const preview=await request('/api/imports/text/preview',{filename:'card.json',text:JSON.stringify(source)});
  expect(preview.status).toBe(200);expect(preview.body.duplicates['0']).toEqual([{id:'saved',revision:1,name:'Saved character'}]);
  expect(allEntities).toHaveBeenCalledExactlyOnceWith('owner-a');vi.mocked(allEntities).mockClear();
  const imported=await request('/api/imports/'+preview.body.preview_id+'/commit',{request_id:'read-test',selections:[{index:0,document:preview.body.documents[0],history_indices:[0],duplicate_action:'copy'}]});
  expect(imported.status).toBe(200);expect(imported.body.items).toHaveLength(1);expect(imported.body.sessions).toHaveLength(1);
  const history=decoded(fixture.records.get('owner-a:'+imported.body.sessions[0].session_id),fixture.parts);
  expect(history.payload.messages.map((message:any)=>[message.id,message.content])).toEqual([[901,'Imported user'],[902,'Imported reply']]);
  expect(saved().payload.draft).toBe('Unsent draft');expect(allEntities).toHaveBeenCalledExactlyOnceWith('owner-a');
});

it.each([
  ['/api/health',undefined,'GET'],['/api/chat/sessions',undefined,'GET'],
  ['/api/chat/settings',{session_id:'requested',system_prompt:'Must not save',temperature:.8},'PUT'],
  ['/api/library/saved',undefined,'GET'],
  ['/api/imports/text/preview',{text:'{"name":"Must not save"}'},'POST'],
])('rejects an owner switch during %s without responding or saving the old data',async(path,body,method)=>{
  const before=structuredClone(fixture.records),metadata=structuredClone(fixture.meta);
  const pending=request(path,body,method);fixture.owner='owner-b';
  expect(await pending).toEqual({status:409,body:{error:expect.stringContaining('Account changed')}});
  expect(fixture.records).toEqual(before);expect(fixture.meta).toEqual(metadata);
  expect(saveEntity).not.toHaveBeenCalled();expect(setMeta).not.toHaveBeenCalled();expect(appTransaction).not.toHaveBeenCalled();
});

it('hydrates only the requested evicted conversation',async()=>{
  const original=structuredClone(saved());const evicted=saved();evicted.payload.cache_evicted=true;fixture.records.set('owner-a:requested',evicted);
  vi.mocked(hydrateConversation).mockResolvedValueOnce(original);
  const response=await request('/api/chat/history?session_id=requested');
  expect(response.status).toBe(200);expect(response.body.history[0].content).toBe('Requested history');
  expect(hydrateConversation).toHaveBeenCalledExactlyOnceWith('requested','owner-a');expect(allEntities).not.toHaveBeenCalled();
});

it('keeps correction and deletion provenance and ordered operation history without accepting forged identity',async()=>{
  const original=saved();original.payload.memories[0]={...original.payload.memories[0],origin:'model',supported:true,source_kind:'story_event',source_quote:'Original story',
    source_generation_id:'original-generation',source_message_ids:[71],confirmation:'unverified'};put(original);
  const path='/api/memory/memory-requested';
  const updated=await request(path,{content:'  Corrected\n memory ',id:'foreign',scope:'unrelated',source_kind:'work_setting',source_generation_id:'forged',version:999},'PATCH');
  expect(updated.status).toBe(200);expect(updated.body).toMatchObject({id:'memory-requested',scope:'requested',content:'Corrected memory',version:2,origin:'model_edited',supported:null,
    source_kind:'user_correction',source_quote:'Corrected memory',source_revision:'manual:2',confirmation:'user_confirmed',source_generation_id:'original-generation',source_message_ids:[71]});
  const before=structuredClone(fixture.records),events=structuredClone(fixture.meta);
  expect((await request(path,{type:'semantic'},'PATCH')).body).toEqual(updated.body);
  expect(fixture.records).toEqual(before);expect(fixture.meta).toEqual(events);
  const removed=await request(path,undefined,'DELETE');expect(removed.status).toBe(200);
  expect(removed.body).toMatchObject({...updated.body,status:'deleted',version:2,updated_at:expect.any(String)});
  expect((await request('/api/memory?scope=requested')).body.memories).toEqual([]);
  expect((await request('/api/memory?scope=requested&include_deleted=true')).body.memories).toHaveLength(1);
  const detail=await request(path);expect(detail.status).toBe(200);expect(detail.body.id).toBe('memory-requested');
  expect(detail.body.events.map((e:any)=>e.op)).toEqual(['delete','update']);
  expect(detail.body.events[1].detail).toMatchObject({before:{content:'Requested history',version:1},after:{content:'Corrected memory'}});
  expect((await request(path,{content:'Must not resurrect'},'PATCH')).status).toBe(404);
  expect((await request(path,undefined,'DELETE')).status).toBe(404);
  expect((await request('/api/memory/scopes')).body.scopes).toContainEqual(expect.objectContaining({scope:'requested',active:0,total:1}));
  expect(JSON.stringify((await request('/api/memory/scopes')).body)).not.toContain('Foreign');
});

it('previews retrieval without saving access counts or operation history',async()=>{
  const before=structuredClone(fixture.records),meta=structuredClone(fixture.meta);
  const search=await request('/api/memory/search',{scope:'requested',query:'Requested history',top_k:1,budget_tokens:40});
  expect(search.status).toBe(200);expect(search.body).toMatchObject({scope:'requested',stored_count:1,injected:['memory-requested'],retrieval_ms:expect.any(Number)});
  expect(search.body.block).toContain('- [semantic] Requested history');
  expect(search.body.candidates[0]).toMatchObject({id:'memory-requested',decision:'injected'});
  expect(fixture.records).toEqual(before);expect(fixture.meta).toEqual(meta);expect(allEntities).not.toHaveBeenCalled();
});

it('retains source fields on create and keeps paged event queries scoped to the active owner',async()=>{
  const created=await request('/api/memory',{scope:'requested',type:'episodic',content:'Explicit story correction',source_kind:'story_event',source_quote:'Quoted story',source_revision:'published:3'});
  expect(created.status).toBe(200);expect(created.body).toMatchObject({source_kind:'story_event',source_quote:'Quoted story',source_revision:'published:3',confirmation:'user_confirmed'});
  const log=await request('/api/memory/events?scope=requested&limit=1');
  expect(log.body.events).toHaveLength(1);expect(log.body.events[0]).toMatchObject({id:1,scope:'requested',op:'create',memory_id:created.body.id});
  fixture.owner='owner-b';
  expect((await request('/api/memory/events?scope=requested')).body.events).toEqual([]);
  expect((await request('/api/memory/'+created.body.id)).status).toBe(404);
});

it('erases scope history together with the memories and preserves unrelated owner evidence',async()=>{
  await request('/api/memory',{scope:'requested',type:'semantic',content:'Private note'});
  fixture.meta.set('memory-events:'+JSON.stringify(['owner-b','requested']),[{id:1,scope:'requested',op:'create',detail:'Foreign private note'}]);
  const cleared=await request('/api/memory/session/requested/data',undefined,'DELETE');
  expect(cleared.body).toEqual({ok:true,scope:'requested',affects_shared_sessions:false});
  expect((await request('/api/memory/events?scope=requested')).body.events).toEqual([]);
  expect((await request('/api/memory?scope=requested&include_deleted=true')).body.memories).toEqual([]);
  expect(saved().payload.messages[0].content).toBe('Requested history');expect(saved().payload.draft).toBe('Unsent draft');
  expect(fixture.meta.get('memory-events:'+JSON.stringify(['owner-b','requested']))[0].detail).toBe('Foreign private note');
});

it('keeps the memory and event history when the atomic save fails',async()=>{
  const before=structuredClone(fixture.records),meta=structuredClone(fixture.meta);fixture.failSave=true;
  const failure=await request('/api/memory/memory-requested',{content:'Must not commit'},'PATCH');
  expect(failure.status).toBe(400);expect(fixture.records).toEqual(before);expect(fixture.meta).toEqual(meta);
});

it.each([
  ['/api/memory/search',{scope:'requested',query:'x',top_k:0},'POST'],
  ['/api/memory/search',{scope:'requested',query:'x',budget_tokens:4001},'POST'],
  ['/api/memory',{scope:'requested',content:'x',type:'invented'},'POST'],
  ['/api/memory',{scope:'requested',content:'x',type:'semantic',source_kind:'invented'},'POST'],
  ['/api/memory',{scope:'requested',content:'🌸'.repeat(201),type:'semantic'},'POST'],
  ['/api/memory/session/requested',{enabled:'yes'},'PUT'],
])('rejects invalid memory input without changes: %s',async(path,body,method)=>{
  const before=structuredClone(fixture.records),meta=structuredClone(fixture.meta);
  expect((await request(path,body,method)).status).toBe(400);expect(fixture.records).toEqual(before);expect(fixture.meta).toEqual(meta);
});

it('rejects ambiguous legacy memory IDs without choosing a different conversation',async()=>{
  const other=decoded(fixture.records.get('owner-a:unrelated'),fixture.parts);other.payload.memories[0].id='memory-requested';put(other);
  const before=structuredClone(fixture.records);
  expect((await request('/api/memory/memory-requested',{content:'Must not edit either'},'PATCH')).status).toBe(409);
  expect(fixture.records).toEqual(before);expect(saveEntity).not.toHaveBeenCalled();
});

it('does not confuse account and session IDs containing the metadata separator',async()=>{
  await request('/api/memory',{scope:'child:chat',type:'semantic',content:'Owned only by the first account'});
  expect((await request('/api/memory/events?scope=child:chat')).body.events).toHaveLength(1);
  fixture.owner='owner-a:child';
  expect((await request('/api/memory/events?scope=chat')).body.events).toEqual([]);
});

it.each([
  ['/api/memory',{},'PUT'],['/api/memory/search',undefined,'GET'],
  ['/api/memory/events',{},'POST'],['/api/memory/scopes',{},'POST'],
  ['/api/memory/session/requested/data',{},'POST'],['/api/memory/session/requested/scope-preview',{},'POST'],
])('rejects the wrong HTTP method before editing memory: %s',async(path,body,method)=>{
  const before=structuredClone(fixture.records),meta=structuredClone(fixture.meta);
  expect((await request(path,body,method)).status).toBe(405);
  expect(fixture.records).toEqual(before);expect(fixture.meta).toEqual(meta);expect(saveEntity).not.toHaveBeenCalled();
});
