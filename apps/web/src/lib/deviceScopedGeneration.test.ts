import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { harness,decoded } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'scoped-owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),
  fail:false,reply:'架空の返信',proposals:[] as any[],inputs:[] as any[],locks:new Set<string>()}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,setGenerationBusy:vi.fn()}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',runtime:'gguf',temperature:.8,topK:64,topP:.95}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class{
  async load(){} stop(){}
  async generate(input:any,emit:any){fixture.inputs.push(input);if(fixture.fail)throw Error('Fictional inference failure');
    emit({type:'delta',text:JSON.stringify({reply:fixture.reply,state_update:{location:'library',time:'now',mood:'calm',active_scene:'tea',relationship_state:{stage:'stranger',tone:'neutral',unresolved_conflict:false}},memory_proposals:fixture.proposals})});return {measurement:{},stopped:false};}
}}));
vi.mock('./appStore',async original=>{
  const module=await original<typeof import('./appStore')>();
  const transaction=(_stores:any,mode:string,action:any)=>harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action);
  const read=async(id:string,owner=fixture.owner)=>decoded(fixture.records.get(JSON.stringify([owner,id])),fixture.parts);
  return {...module,appTransaction:transaction,entity:read,openEntity:read,
    conversationInfo:async(id:string,owner=fixture.owner)=>{const row=fixture.records.get(JSON.stringify([owner,id]));return row&&{...row,selection:module.entitySelection(row)};},
    getMeta:async(key:string)=>structuredClone(fixture.meta.get(key)),allEntities:async()=>[...fixture.records.values()].map(row=>decoded(row,fixture.parts))};
});
import { RuntimeStateSchema } from '../../../../packages/schemas/src';
import { appTransaction,newEntity,writeEntity,entity,type AppEntity } from './appStore';
import { deviceFetch } from './deviceApi';
import { scopedSessionMemory,saveScopedMemory } from './deviceScopedMemory';
import { memoryIdentity } from './deviceMemoryScopes';
import { readDeviceMemoryDomain } from './deviceMemoryStore';
import { receiveConversation } from './appSyncData';
import { conservativeTokens,mergeTurns } from '../mobile/context';
import { CONTEXT_TOKENS,OUTPUT_TOKENS } from '../mobile/types';
import catalog from '../mobile/app-catalog.generated.json';

beforeEach(()=>{
  fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.inputs=[];fixture.locks.clear();fixture.fail=false;fixture.reply='架空の返信';fixture.proposals=[];
  vi.stubGlobal('IDBKeyRange',{bound:(lower:any,upper:any)=>({lower,upper})});vi.stubGlobal('location',{href:'https://device.test/device/'});
  vi.stubGlobal('navigator',{locks:{request:async(name:string,_options:any,callback:any)=>{
    if(fixture.locks.has(name))return callback(null);fixture.locks.add(name);try{return await callback({name});}finally{fixture.locks.delete(name);}
  }}});
});
afterEach(()=>vi.unstubAllGlobals());
const identity=async(settings:Record<string,any>)=>memoryIdentity(settings,{
  character_id:(catalog.characters as any[]).find(row=>row.id===settings.character_id)?.version??null,
  persona_id:null,world_id:(catalog.worlds as any[]).find(row=>row.id===settings.world_id)?.version??null});
const source=(sid:string,messageId:number,policy='local')=>newEntity('conversation',sid,{
  storage_policy:policy,memory_scope_mode:'world',settings:{session_id:sid,character_id:'mocha_sfw',world_id:'beast_world',system_prompt:'',temperature:.8},
  messages:[{id:messageId,uuid:'message-'+sid,role:'user',content:'鮭のお寿司が好きです'}],summaries:[],state:RuntimeStateSchema.parse({session_id:sid}),memory_enabled:true,
  memories:[{id:'memory-'+sid,scope:sid,type:'semantic',content:sid==='a'?'鮭のお寿司が好きです':'お茶が好きです',origin:'user',supported:null,status:'active',version:1,
    source_session_id:sid,source_kind:'user_statement',source_message_ids:[messageId],access_count:0}],draft:'Keep draft '+sid},fixture.owner);
async function seed(record:AppEntity){
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,{...record,revision:1},'add',done));
  const stored=(await entity(record.id))!,context=await scopedSessionMemory(stored,identity);
  await saveScopedMemory(context,[stored]);return (await entity(record.id))!;
}
async function turn(id:string,generation:string,extra:Record<string,any>={}){
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:id,generation_id:generation,model_id:'fixture',messages:[{role:'user',content:'鮭のお寿司が好きです'}],...extra})});
  return {status:response.status,text:await response.text()};
}

it('creates the first default world conversation with its receipt and domain in one lifecycle',async()=>{
  const result=await turn('new-world','first-world');expect(result.status,result.text).toBe(200);expect(result.text).toContain('event: done');
  const saved=(await entity('new-world'))!;expect(saved.payload.messages.map((message:any)=>message.role)).toEqual(['user','assistant']);
  expect(saved.payload.pending_generation).toBeNull();expect(saved.payload.last_generation.status).toBe('completed');
  expect(fixture.meta.get('generation:'+fixture.owner+':first-world').status).toBe('completed');
  const domain=await readDeviceMemoryDomain(fixture.owner,'local');expect(domain.pending).toBeNull();
  expect(Object.values(domain.bindings).some(binding=>binding.entity_revision===saved.revision)).toBe(true);
});

it('roundtrips and branches an actual manually corrected generated fact after regeneration',async()=>{
  await seed(source('b',71));fixture.meta.set('message-sequence:'+fixture.owner,100);
  fixture.proposals=[{type:'semantic',content:'鮭のお寿司が好きです',source_kind:'user_statement'}];
  expect((await turn('b','original-correction')).text).toContain('event: done');
  const original=(await entity('b'))!,assistant=original.payload.messages.at(-1),fact=original.payload.memories.find((memory:any)=>memory.source_generation_id==='original-correction');
  const edited=await deviceFetch('/api/memory/'+fact.id,{method:'PATCH',body:JSON.stringify({content:'お寿司を手動で訂正しました'})});expect(edited.status).toBe(200);
  fixture.proposals=[];expect((await turn('b','regenerated-correction',{regenerate_message_id:assistant.id})).text).toContain('event: done');
  const saved=(await entity('b'))!,before=saved.payload.messages.at(-1).before;
  expect(before.state.turn).toBe(0);expect(before.memories.find((memory:any)=>memory.id===fact.id)).toMatchObject({origin:'model_edited',source_turn:1,source_generation_id:'original-correction'});
  let sequence=500;expect(()=>receiveConversation(saved.payload,undefined,()=>++sequence)).not.toThrow();
  const branch=await deviceFetch('/api/chat/sessions/b/branch',{method:'POST',body:JSON.stringify({message_id:saved.payload.messages.at(-2).id})});
  expect(branch.status,await branch.clone().text()).toBe(200);
});

it('recalls a peer fact without copying foreign source IDs into the conversation or snapshots',async()=>{
  await seed(source('a',31));await seed(source('b',71));fixture.meta.set('message-sequence:'+fixture.owner,100);
  expect((await turn('b','shared')).text).toContain('event: done');
  expect(JSON.stringify(fixture.inputs)).toContain('鮭のお寿司が好きです');
  const a=(await entity('a'))!,b=(await entity('b'))!,trace=b.payload.last_generation.memory;
  expect(trace.scope).toMatch(/^work:.*\|device:local$/);expect(trace.injected).toContain('memory-a');
  expect(a.payload.memories[0].access_count).toBe(1);
  for(const snapshot of [b.payload,...b.payload.messages.flatMap((message:any)=>[message.before,message.after]).filter(Boolean)]){
    expect(snapshot.memories.some((memory:any)=>memory.id==='memory-a')).toBe(false);
    expect(snapshot.memories.every((memory:any)=>memory.source_session_id==='b')).toBe(true);
  }
  expect(b.payload.draft).toBe('Keep draft b');
});

it.each(['policy','world','branch'])('keeps shared recall out of a different %s realm',async boundary=>{
  await seed(source('a',31));const other=source('b',71,boundary==='policy'?'sync':'local');
  if(boundary==='world')other.payload.settings.world_id=undefined;
  if(boundary==='branch')other.payload.branch_of='origin';
  await seed(other);fixture.meta.set('message-sequence:'+fixture.owner,100);
  expect((await turn('b','isolated')).text).toContain('event: done');
  expect((await entity('b'))!.payload.last_generation.memory.injected).not.toContain('memory-a');
});

it('keeps the accepted reply on failed regeneration and retains later manual facts on success',async()=>{
  await seed(source('b',71));fixture.meta.set('message-sequence:'+fixture.owner,100);
  fixture.reply='また明日ここで会おう';fixture.proposals=[{type:'episodic',content:'また明日ここで会おう',source_kind:'story_event'}];
  expect((await turn('b','original')).text).toContain('event: done');
  let before=(await entity('b'))!,assistant=before.payload.messages.at(-1);
  const context=await scopedSessionMemory(before,identity),pool=context.domain.pools[context.scope];
  pool.memories.push({id:'later-manual',type:'semantic',content:'辛い食べ物が苦手です',origin:'user',supported:null,status:'active',version:1,
    scope:context.scope,source_session_id:'b',source_message_ids:[],source_generation_id:null});pool.holders[JSON.stringify('later-manual')]='b';
  await saveScopedMemory(context);before=(await entity('b'))!;
  const acceptedPool=(await readDeviceMemoryDomain(fixture.owner,'local')).pools;
  fixture.fail=true;
  expect((await turn('b','failed',{regenerate_message_id:assistant.id})).text).toContain('event: error');
  let after=(await entity('b'))!;expect(after.payload.messages).toEqual(before.payload.messages);expect(after.payload.memories).toEqual(before.payload.memories);
  expect((await readDeviceMemoryDomain(fixture.owner,'local')).pools).toEqual(acceptedPool);
  fixture.fail=false;fixture.proposals=[];fixture.reply='新しい架空の返信';
  expect((await turn('b','replacement',{regenerate_message_id:assistant.id})).text).toContain('event: done');
  after=(await entity('b'))!;
  expect(after.payload.messages.at(-1).content).toBe('新しい架空の返信');
  expect(after.payload.memories.some((memory:any)=>memory.id==='later-manual')).toBe(true);
  expect(after.payload.memories.some((memory:any)=>memory.source_generation_id==='original')).toBe(false);
});

it('requires explicit asset-version migration before inference even when memory is off',async()=>{
  const record=source('b',71);record.payload.memory_enabled=false;
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,{...record,revision:1},'add',done));
  const stored=(await entity('b'))!,context=await scopedSessionMemory(stored,async settings=>{
    const value=await identity(settings);value.versions.character_id='old-version';return value;
  });await saveScopedMemory(context,[stored]);
  const before=(await entity('b'))!,result=await turn('b','version-change');
  expect(result.status).toBe(409);expect(result.text).toContain('Asset version changed');
  expect(await entity('b')).toEqual(before);expect(fixture.inputs).toEqual([]);
});

it('keeps each conversation source when an independently repeated fact matches a recalled peer',async()=>{
  await seed(source('a',31));await seed(source('b',71));fixture.meta.set('message-sequence:'+fixture.owner,100);
  fixture.proposals=[{type:'semantic',content:'鮭のお寿司が好きです',source_kind:'user_statement'}];
  expect((await turn('b','independent')).text).toContain('event: done');
  const before=(await entity('b'))!,own=before.payload.memories.find((memory:any)=>memory.source_generation_id==='independent');
  expect(own).toMatchObject({source_session_id:'b',source_message_ids:[101]});
  expect(before.payload.last_generation.memory.injected).toContain('memory-a');
  expect((await deviceFetch('/api/chat/sessions/a/data',{method:'DELETE'})).status).toBe(200);
  expect((await entity('b'))!.payload.memories.some((memory:any)=>memory.id===own.id)).toBe(true);
  expect((await turn('b','repeat')).text).toContain('event: done');
  expect((await entity('b'))!.payload.last_generation.memory.decisions[0]).toMatchObject({action:'skip',reason:'duplicate'});
});

it.each(['clear','delete','edit'])('keeps generation and sync usable after history %s while retaining manual facts',async operation=>{
  await seed(source('b',71));fixture.meta.set('message-sequence:'+fixture.owner,100);
  fixture.reply='鮭のお寿司を食べた';fixture.proposals=[{type:'semantic',content:'鮭のお寿司が好きです',source_kind:'user_statement'},
    {type:'episodic',content:'鮭のお寿司を食べた',source_kind:'story_event'}];
  expect((await turn('b','source-turn')).text).toContain('event: done');
  const before=(await entity('b'))!;expect(before.payload.memories.filter((memory:any)=>memory.origin==='model')).toHaveLength(2);
  const response=await deviceFetch(operation==='clear'?'/api/chat/history?session_id=b':'/api/chat/history/101',
    operation==='edit'?{method:'PUT',body:JSON.stringify({content:'新しい内容'})}:{method:'DELETE'});
  expect(response.status,await response.clone().text()).toBe(200);
  const after=(await entity('b'))!;
  expect(after.payload.memories.some((memory:any)=>memory.origin==='model')).toBe(false);
  expect(after.payload.memories.find((memory:any)=>memory.id==='memory-b').content).toBe('お茶が好きです');
  if(operation==='clear')expect(after.payload.memories[0].source_message_ids).toEqual([]);
  let sequence=1000;expect(()=>receiveConversation(after.payload,undefined,()=>++sequence)).not.toThrow();
  fixture.proposals=[];
  expect((await turn('b','after-edit')).text).toContain('event: done');
});

it('stores a fresh source after explicit new evidence matches a previously forgotten fact',async()=>{
  await seed(source('b',71));fixture.meta.set('message-sequence:'+fixture.owner,100);
  const state=await (await deviceFetch('/api/memory/session/b')).json();
  const added=await (await deviceFetch('/api/memory',{method:'POST',body:JSON.stringify({scope:state.scope,type:'semantic',content:'鮭のお寿司が好きです',source_session_id:'b'})})).json();
  expect((await deviceFetch('/api/memory/'+added.id,{method:'DELETE'})).status).toBe(200);
  fixture.proposals=[{type:'semantic',content:added.content,source_kind:'user_statement'}];
  expect((await turn('b','new-evidence')).text).toContain('event: done');
  const rows=(await entity('b'))!.payload.memories;
  expect(rows.find((row:any)=>row.id===added.id).status).toBe('deleted');
  expect(rows.find((row:any)=>row.source_generation_id==='new-evidence')).toMatchObject({status:'active',source_session_id:'b',source_message_ids:[101]});
});

it('fits the default character, one shared fact and JSON contract within the bounded Device context',async()=>{
  const a=source('a',31),b=source('b',71);delete a.payload.settings.world_id;delete b.payload.settings.world_id;b.payload.memories=[];
  await seed(a);await seed(b);fixture.meta.set('message-sequence:'+fixture.owner,100);
  expect((await turn('b','budget')).text).toContain('event: done');
  expect(conservativeTokens(mergeTurns(fixture.inputs[0]))).toBeLessThanOrEqual(CONTEXT_TOKENS-OUTPUT_TOKENS);
  const system=fixture.inputs[0].filter((message:any)=>message.role==='system').map((message:any)=>message.content).join('\n');
  expect(system).toContain('relationship_state');expect(system).toContain('Never invent user facts');expect(system).not.toContain('state_version');
  expect(system).toContain('Story events are fiction, not user facts');expect(system).toContain('source: user_statement');
});

it('retains narrative summaries while excluding runtime bookkeeping from the response shape',async()=>{
  const record=source('b',71);record.payload.state.last_summary='An authored chapter summary.';await seed(record);
  fixture.meta.set('message-sequence:'+fixture.owner,100);
  expect((await turn('b','summary')).text).toContain('event: done');
  expect(fixture.inputs[0][0].content).toContain('Prior conversation summary: An authored chapter summary.');
  expect((await entity('b'))!.payload.state.last_summary).toBe('An authored chapter summary.');
});
