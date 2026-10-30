import { harness, decoded } from './idbHarness.test-support';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({owner:'owner-a',records:new Map<string,any>(),parts:new Map<string,any>(),meta:new Map<string,any>(),failSave:false}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,setGenerationBusy:vi.fn()}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class{}}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',name:'Fixture',runtime:'gguf'}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('./appStore',async original=>{
  const real=await original<typeof import('./appStore')>();
  const read=async(id:string,owner=fixture.owner)=>decoded(fixture.records.get(owner+':'+id),fixture.parts);
  return {...real,
    allEntities:vi.fn(async(owner:string,kinds?:readonly string[])=>[...fixture.records.values()].filter(e=>e.owner===owner&&(!kinds||kinds.includes(e.kind))).map(value=>decoded(value,fixture.parts))),
    entity:vi.fn(read),openEntity:vi.fn(read),trimOfflineCache:vi.fn(async()=>{}),
    conversationInfo:vi.fn(async(id:string,owner=fixture.owner)=>{
      const value=fixture.records.get(owner+':'+id);return value&&{id,owner,revision:value.revision,pinned:value.pinned,opened:value.opened,deleted:value.deleted,selection:real.entitySelection(value)};
    }),
    conversationPage:vi.fn(async(id:string,owner=fixture.owner,limit=50,cursor?:any)=>{
      const value=await read(id,owner);if(!value)return;
      const {messages,...metadata}=value.payload,total=messages.length,end=cursor?.end??total,start=cursor?.start??Math.max(0,end-limit),bodyToken=fixture.records.get(owner+':'+id)?.payloadParts?.token??null;
      const position=(start:number,end:number)=>({owner,id,revision:value.revision,bodyToken,start,end});
      return {owner,id,revision:value.revision,bodyToken,metadata,messages:messages.slice(start,end),total,start,end,
        ...(start?{previous:position(Math.max(0,start-limit),start)}:{}),...(end<total?{next:position(end,Math.min(total,end+limit))}:{})};
    }),
    readConversationSummary:vi.fn(async(id:string,owner=fixture.owner)=>{
      const value=await read(id,owner);return value&&!value.deleted?real.conversationSummary(value.payload):undefined;
    }),
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
import { allEntities, appTransaction, entity, getMeta, newEntity, openEntity, conversationInfo, conversationPage, readConversationSummary, writeEntity, trimOfflineCache, saveEntity, setMeta } from './appStore';
import { deviceFetch } from './deviceApi';
import { hydrateConversation } from './appSync';

const request=async(path:string,body?:unknown,method=body?'POST':'GET')=>{
  const response=await deviceFetch(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
};
const put=(value:ReturnType<typeof newEntity>)=>fixture.records.set(value.owner+':'+value.id,value);
const saved=()=>decoded(fixture.records.get('owner-a:requested'),fixture.parts);
const segment=(value:ReturnType<typeof newEntity>)=>appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,value,'put',done));
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
  ['/api/memory/session/requested/scope-preview',{scope:'session:requested|device:local',preview_revision:expect.stringMatching(/^[a-f0-9]{64}$/),memories:[{content:'Requested history'}]}],
  ['/api/chat/context/requested',{history_revision:'3',summaries:[{text:'Requested history'}]}],
  ['/api/chat/debug?session_id=requested',{session_id:'requested',history_count:1,settings:{system_prompt:'KEEP'}}],
  ['/api/chat/intro/inject?session_id=requested',{injected:false}],
])('reads only the requested owner and conversation for %s',async(path,expected)=>{
  if(path.endsWith('/scope-preview')){const record=saved();record.payload.pending_generation=null;put(record);}
  const before=structuredClone(fixture.records),response=await request(path);
  expect(response.status).toBe(200);expect(response.body).toMatchObject(expected);
  expect(allEntities).not.toHaveBeenCalled();expect(entity).not.toHaveBeenCalled();
  if(path.startsWith('/api/chat/settings')||path.startsWith('/api/chat/context/')){
    expect(openEntity).not.toHaveBeenCalled();expect(conversationInfo).toHaveBeenCalledExactlyOnceWith('requested','owner-a');expect(conversationPage).toHaveBeenCalledExactlyOnceWith('requested','owner-a',50,undefined);
    for(const [key,value] of before){const {opened,...expected}=value;const {opened:actual,...record}=fixture.records.get(key);expect(record).toEqual(expected);if(key!=='owner-a:requested')expect(actual).toBe(opened);}
  }else{expect(openEntity).toHaveBeenCalledExactlyOnceWith('requested','owner-a');expect(fixture.records).toEqual(before);}
});

it('refuses a migration preview while the source generation is pending',async()=>{
  const before=structuredClone(fixture.records);
  expect((await request('/api/memory/session/requested/scope-preview')).status).toBe(409);
  expect(fixture.records).toEqual(before);
});

it('routes history pages separately from full history and preserves cursor fields',async()=>{
  const value=saved();value.payload.messages=Array.from({length:5},(_,i)=>({id:71-i,role:i%2?'assistant':'user',content:'Saved '+i,extension:{keep:i}}));put(value);
  const before=structuredClone(fixture.records),latest=await request('/api/chat/history/page?session_id=requested&limit=2');
  expect(latest).toEqual({status:200,body:{session_id:'requested',history:value.payload.messages.slice(3),total:5,start:3,end:5,revision:3,body_token:null,
    previous:{owner:'owner-a',id:'requested',revision:3,bodyToken:null,start:1,end:3}}});
  const cursor=latest.body.previous,older=await request('/api/chat/history/page?session_id=requested&limit=2&cursor='+encodeURIComponent(JSON.stringify(cursor)));
  expect(older.status).toBe(200);expect(older.body).toMatchObject({history:value.payload.messages.slice(1,3),total:5,start:1,end:3,
    previous:{...cursor,start:0,end:1},next:{...cursor,start:3,end:5}});
  expect(conversationPage).toHaveBeenNthCalledWith(1,'requested','owner-a',2,undefined);
  expect(conversationPage).toHaveBeenNthCalledWith(2,'requested','owner-a',2,cursor);
  for(const operation of [allEntities,entity,openEntity,saveEntity,hydrateConversation])expect(operation).not.toHaveBeenCalled();
  for(const [key,row] of before){const actual=fixture.records.get(key);expect(actual).toEqual(key==='owner-a:requested'?{...row,opened:expect.any(Number)}:row);}
});

it.each(['POST','PUT','DELETE'])('rejects %s history pages before reading or mutating storage',async method=>{
  const before=structuredClone(fixture.records);
  expect((await request('/api/chat/history/page?session_id=requested',undefined,method)).status).toBe(405);
  expect(fixture.records).toEqual(before);
  for(const operation of [conversationInfo,conversationPage,allEntities,openEntity,appTransaction])expect(operation).not.toHaveBeenCalled();
});

it('returns an empty missing page without creating or opening a conversation',async()=>{
  const before=structuredClone(fixture.records);
  expect(await request('/api/chat/history/page?session_id=missing')).toEqual({status:200,body:{session_id:'missing',history:[],total:0,start:0,end:0,revision:0,body_token:null}});
  expect(fixture.records).toEqual(before);expect(appTransaction).not.toHaveBeenCalled();expect(saveEntity).not.toHaveBeenCalled();expect(openEntity).not.toHaveBeenCalled();
});

it('shares an in-flight default page between settings, history page and an uncached sessions summary',async()=>{
  const value=saved();value.payload.messages=Array.from({length:63},(_,i)=>({id:i+1,role:'user',content:'Saved '+i,created_at:'2026-10-30T00:00:00Z'}));
  await segment(value);delete fixture.records.get('owner-a:requested').selection.summary;vi.clearAllMocks();
  const read=vi.mocked(conversationPage).getMockImplementation()!;let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(conversationPage).mockImplementationOnce(async(...args)=>{await gate;return read(...args);});
  const settings=request('/api/chat/settings?session_id=requested'),page=request('/api/chat/history/page?session_id=requested');
  await vi.waitFor(()=>expect(conversationPage).toHaveBeenCalledTimes(1));
  const sessions=request('/api/chat/sessions');await vi.waitFor(()=>expect(appTransaction).toHaveBeenCalledWith(['entities'],'readonly',expect.any(Function)));
  release();const [s,p,list]=await Promise.all([settings,page,sessions]);
  expect(s).toEqual({status:200,body:value.payload.settings});
  expect(p.status).toBe(200);expect(p.body).toMatchObject({history:value.payload.messages.slice(13),total:63,start:13,end:63});
  expect(list.status).toBe(200);expect(list.body.sessions).toContainEqual(expect.objectContaining({session_id:'requested',count:63,last_preview:'Saved 62'}));
  expect(conversationInfo).toHaveBeenCalledExactlyOnceWith('requested','owner-a');expect(conversationPage).toHaveBeenCalledExactlyOnceWith('requested','owner-a',50,undefined);
  expect(readConversationSummary).not.toHaveBeenCalled();expect(openEntity).not.toHaveBeenCalled();
  await request('/api/chat/history/page?session_id=requested');expect(conversationPage).toHaveBeenCalledTimes(2);
});

it('clears a failed in-flight page so settings and history can retry',async()=>{
  vi.mocked(conversationPage).mockRejectedValueOnce(Error('Fictional corrupt body'));
  const responses=await Promise.all([request('/api/chat/settings?session_id=requested'),request('/api/chat/history/page?session_id=requested')]);
  for(const response of responses)expect(response).toEqual({status:400,body:{error:'Fictional corrupt body'}});
  expect(conversationPage).toHaveBeenCalledTimes(1);
  expect((await request('/api/chat/settings?session_id=requested')).status).toBe(200);expect(conversationPage).toHaveBeenCalledTimes(2);
});

it('does not share the old owner page or update opened after an account switch',async()=>{
  const before=structuredClone(fixture.records),read=vi.mocked(conversationPage).getMockImplementation()!;let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(conversationPage).mockImplementationOnce(async(...args)=>{await gate;return read(...args);});
  const pending=request('/api/chat/history/page?session_id=requested');await vi.waitFor(()=>expect(conversationPage).toHaveBeenCalledTimes(1));
  fixture.owner='owner-b';const foreign=await request('/api/chat/history/page?session_id=requested');release();const stale=await pending;
  expect(foreign.status).toBe(200);expect(foreign.body.history).toEqual([expect.objectContaining({content:'Foreign history'})]);
  expect(stale.status).toBeGreaterThanOrEqual(400);expect(JSON.stringify(stale.body)).not.toMatch(/Requested history|Foreign history/);
  expect(conversationPage).toHaveBeenNthCalledWith(2,'requested','owner-b',50,undefined);
  expect(fixture.records.get('owner-a:requested')).toEqual(before.get('owner-a:requested'));
  expect(fixture.records.get('owner-b:requested')).toEqual({...before.get('owner-b:requested'),opened:expect.any(Number)});
});

it('serves token-matched sessions summaries without reading missing conversation parts',async()=>{
  const value=saved();Object.assign(value.payload,{title:'Recovered chat',recovery_from:'source'});
  Object.assign(value.payload.settings,{character_id:'saved',world_id:'world@2'});value.payload.messages[0].content='茶🙂'.repeat(100);
  await segment(value);fixture.parts.clear();vi.clearAllMocks();const before=structuredClone(fixture.records);
  const response=await request('/api/chat/sessions');expect(response.status).toBe(200);
  expect(response.body.sessions).toContainEqual(expect.objectContaining({session_id:'requested',count:1,last_preview:value.payload.messages[0].content.slice(0,160),
    character_id:'saved',character_name:'Saved character',world_id:'world@2',sync_recovery:true,offline_available:true}));
  expect(allEntities).toHaveBeenCalledExactlyOnceWith('owner-a',['character']);
  for(const operation of [readConversationSummary,conversationInfo,conversationPage,openEntity,hydrateConversation])expect(operation).not.toHaveBeenCalled();
  expect(fixture.records).toEqual(before);expect(fixture.parts.size).toBe(0);
});

it.each(['token','missing','count','preview'])('falls back to a bounded sessions summary for an invalid cached %s',async field=>{
  const value=saved();await segment(value);const row=fixture.records.get('owner-a:requested');
  if(field==='token')row.selection.summary.token='stale-token';
  if(field==='missing')delete row.selection.summary;
  if(field==='count')row.selection.summary.count=-1;
  if(field==='preview')row.selection.summary.last_preview='x'.repeat(161);
  vi.clearAllMocks();const before=structuredClone(fixture.records),response=await request('/api/chat/sessions');
  expect(response.status).toBe(200);expect(response.body.sessions).toContainEqual(expect.objectContaining({session_id:'requested',count:1,last_preview:'Requested history'}));
  expect(readConversationSummary).toHaveBeenCalledExactlyOnceWith('requested','owner-a');expect(fixture.records).toEqual(before);
  for(const operation of [conversationPage,openEntity,hydrateConversation,saveEntity])expect(operation).not.toHaveBeenCalled();
});

it.each(['inline','segmented'])('lists an old %s evicted stub without hydration or changing opened',async storage=>{
  const value=saved();Object.assign(value.payload,{messages:[],cache_evicted:true,cache_preview:{count:103,last_at:'2026-10-31T00:00:00Z',last_preview:'Remote preview'},title:'Old stub'});
  if(storage==='segmented'){await segment(value);delete fixture.records.get('owner-a:requested').selection.summary;}else put(value);
  vi.clearAllMocks();const before=structuredClone(fixture.records),parts=structuredClone(fixture.parts),response=await request('/api/chat/sessions');
  expect(response.status).toBe(200);expect(response.body.sessions[0]).toMatchObject({session_id:'requested',count:103,last_at:'2026-10-31T00:00:00Z',last_preview:'Remote preview',character_name:'Old stub',offline_available:false});
  expect(fixture.records).toEqual(before);expect(fixture.parts).toEqual(parts);
  for(const operation of [conversationInfo,conversationPage,openEntity,hydrateConversation,trimOfflineCache,saveEntity])expect(operation).not.toHaveBeenCalled();
  expect(vi.mocked(readConversationSummary).mock.calls).toEqual(storage==='segmented'?[['requested','owner-a']]:[]);
});

it('preserves immutable bindings, pending generation and unsent input when saving settings',async()=>{
  const before=structuredClone(saved().payload);
  const response=await request('/api/chat/settings',{session_id:'requested',system_prompt:'Updated',temperature:.5,character_id:'saved'},'PUT');
  expect(response).toEqual({status:200,body:{ok:true}});
  expect(saved().payload.settings).toMatchObject({system_prompt:'Updated',library_binding:{character:{id:'saved',revision:1}}});
  for(const key of ['messages','memories','summaries','state','draft','pending_generation'])expect(saved().payload[key]).toEqual(before[key]);
  expect(saveEntity).not.toHaveBeenCalled();expect(openEntity).not.toHaveBeenCalled();
  expect(conversationPage).toHaveBeenCalledExactlyOnceWith('requested','owner-a',50,undefined);
  expect(vi.mocked(entity).mock.calls.every(([id,owner])=>id==='saved'&&owner==='owner-a')).toBe(true);
  expect(allEntities).not.toHaveBeenCalled();
});

it('updates only the selected summary and retains complete history and summary extensions',async()=>{
  const value=saved();value.payload.messages=Array.from({length:120},(_,i)=>({id:i+1,content:'Keep '+i,before:{state:{turn:i}}}));
  value.payload.summaries[0].extension={keep:true};put(value);await segment(value);vi.clearAllMocks();
  const response=await request('/api/chat/context/requested/summaries/summary',{expected_revision:1,text:'Manual update'},'PUT');
  expect(response).toEqual({status:200,body:{...value.payload.summaries[0],text:'Manual update',revision:2,method:'manual'}});
  const result=saved();expect(result.payload).toEqual({...value.payload,summaries:[response.body]});expect(result.revision).toBe(4);
  expect(conversationPage).toHaveBeenCalledExactlyOnceWith('requested','owner-a',50,undefined);
  expect(openEntity).not.toHaveBeenCalled();expect(saveEntity).not.toHaveBeenCalled();
});

it.each([
  [{expected_revision:0,text:'Stale'},409],
  [{expected_revision:1,text:' '},400],
])('retains canonical data when a manual summary edit is invalid: %j',async(body,status)=>{
  const before=saved().payload,response=await request('/api/chat/context/requested/summaries/summary',body,'PUT');
  expect(response.status).toBe(status);expect(saved().payload).toEqual(before);expect(saved().revision).toBe(3);
  expect(saveEntity).not.toHaveBeenCalled();expect(openEntity).not.toHaveBeenCalled();
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

it('attributes explicit manual sources only to the existing idle conversation',async()=>{
  const source=saved();source.payload.pending_generation=null;put(source);
  const result=await request('/api/memory',{scope:'requested',type:'semantic',content:'Attributed fact',source_session_id:'requested'});
  expect(result.status).toBe(200);expect(result.body.source_session_id).toBe('requested');expect(result.body.source_message_ids).toEqual([]);
  const before=structuredClone(saved());
  expect((await request('/api/memory',{scope:'requested',type:'semantic',content:'forged',source_session_id:'foreign'})).status).toBe(409);
  expect((await request('/api/memory',{scope:'absent',type:'semantic',content:'missing',source_session_id:'absent'})).status).toBe(404);
  expect(saved()).toEqual(before);expect(fixture.records.has('owner-a:absent')).toBe(false);
  source.payload.pending_generation='orphan';put(source);
  expect((await request('/api/memory',{scope:'requested',type:'semantic',content:'wait',source_session_id:'requested'})).status).toBe(409);
});

it('distinguishes an unavailable generation prompt from a current-settings preview after sync',async()=>{
  const source=saved();source.payload.last_generation={generation_id:'synced-summary',status:'completed',reply:'Saved reply'};put(source);
  const result=await request('/api/chat/debug?session_id=requested');
  expect(result.status).toBe(200);expect(result.body.prompt_source).toBe('unavailable');
  expect(result.body.generation.raw_prompt).toBeUndefined();expect(result.body.compiled).toBeTruthy();
});

it.each([['/api/chat/sessions/requested/data','GET'],['/api/chat/sessions/requested/branch','DELETE']])('requires the explicit mutation method for conversation operations: %s',async(path,method)=>{
  const before=structuredClone(saved());expect((await request(path,undefined,method)).status).toBe(405);expect(saved()).toEqual(before);
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
  ['/api/characters',['character']],['/api/personas',['persona']],['/api/worlds',['world']],
  ['/api/creator/persona',['persona']],['/api/creator/world',['world']],
  ['/api/library',['character','preset']],['/api/prompts/presets',['preset']],
])('opens %s without decoding unrelated conversation bodies',async(path,kinds)=>{
  const value=fixture.records.get('owner-a:unrelated');
  const {payload,...header}=value;
  fixture.records.set('owner-a:unrelated',{...header,payloadParts:{token:crypto.randomUUID(),chunks:1,size:100,sha256:'0'.repeat(64)}});
  const before=structuredClone(fixture.records);
  expect((await request(path as string)).status).toBe(200);
  expect(allEntities).toHaveBeenCalledExactlyOnceWith('owner-a',kinds);
  expect(fixture.records).toEqual(before);
});

it.each([
  ['/api/chat/sessions','sessions',{session_id:'requested',count:1,last_preview:'Requested history'},['character']],
  ['/api/library','items',{id:'saved',document:expect.objectContaining({name:'Saved character'})},['character','preset']],
  ['/api/characters','characters',{id:'saved',display_name:'Saved character'},['character']],
  ['/api/worlds','worlds',{asset_id:creatorId,display_name:'Saved world'},['world']],
  ['/api/creator/world','items',{asset_id:creatorId,display_name:'Saved world'},['world']],
  ['/api/prompts/presets','presets',{id:'preset',content:'Preset text'},['preset']],
])('retains the live owner list for %s',async(path,key,expected,kinds)=>{
  const response=await request(path);expect(response.status).toBe(200);expect(response.body[key]).toContainEqual(expect.objectContaining(expected));
  expect(JSON.stringify(response.body)).not.toMatch(/Foreign|deleted/);
  expect(allEntities).toHaveBeenCalledExactlyOnceWith(...(kinds?['owner-a',kinds]:['owner-a']));expect(openEntity).not.toHaveBeenCalled();
});

it.each([
  ['/api/chat/history/900',{content:'Edited message'},'PUT','messages'],
  ['/api/memory/memory-unrelated',{content:'Edited memory'},'PUT','memories'],
])('retains owner-wide ID lookup for %s',async(path,body,method,key)=>{
  if(path.startsWith('/api/chat/history/')){const record=decoded(fixture.records.get('owner-a:unrelated'),fixture.parts);record.payload.pending_generation=null;put(record);}
  const response=await request(path,body,method);expect(response.status).toBe(200);
  expect(decoded(fixture.records.get('owner-a:unrelated'),fixture.parts).payload[key][0].content).toBe(body.content);
  expect(saved().payload.messages[0].content).toBe('Requested history');
  expect(allEntities).toHaveBeenCalledExactlyOnceWith('owner-a');expect(openEntity).toHaveBeenCalledExactlyOnceWith('unrelated','owner-a');
});

it('keeps history and memory references while a legacy pending result needs recovery',async()=>{
  const before=structuredClone(fixture.records);
  expect((await request('/api/chat/history/900',{content:'Must wait'},'PUT')).status).toBe(409);
  expect((await request('/api/chat/history?session_id=requested',undefined,'DELETE')).status).toBe(409);
  expect(fixture.records).toEqual(before);
});

it.each(['GET','POST'])('rejects %s as an individual history mutation before loading private records',async method=>{
  const before=structuredClone(fixture.records);
  expect((await request('/api/chat/history/900',{content:'Must not edit'},method)).status).toBe(405);
  expect(fixture.records).toEqual(before);expect(allEntities).not.toHaveBeenCalled();
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
