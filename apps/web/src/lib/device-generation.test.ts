import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({saved:undefined as any,sequence:0,busy:vi.fn(),fail:true,memory:false,memories:[] as any[],reply:'fixture reply',proposals:[] as any[],meta:new Map<string,any>(),locks:new Set<string>(),paused:undefined as Promise<void>|undefined,started:false}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class {
  async load(){} async generate(_messages:any,event:any){
    fixture.started=true;await fixture.paused;
    if(fixture.fail)throw Error('fixture inference failed');
    event({type:'delta',text:JSON.stringify({reply:fixture.reply,state_update:{location:'library',time:'now',mood:'calm',active_scene:'tea',relationship_state:{stage:'stranger',tone:'neutral',unresolved_conflict:false}},memory_proposals:fixture.proposals})});
    return {measurement:{memory:'must not override the actual memory trace'},stopped:false};
  } stop(){}
}}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',runtime:'gguf',temperature:.8,topK:64,topP:.95}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('./deviceMemoryStore',()=>({recoverDeviceMemoryGeneration:async()=>null}));
vi.mock('./appContext',()=>({deviceOwner:()=> 'fixture-owner',setGenerationBusy:fixture.busy}));
vi.mock('./appStore',async importOriginal=>({
  ...await importOriginal<typeof import('./appStore')>(),
  allEntities:vi.fn(async()=>[]),getMeta:async(key:string)=>structuredClone(fixture.meta.get(key)),entity:vi.fn(async()=>structuredClone(fixture.saved)),openEntity:async()=>structuredClone(fixture.saved??{id:'chat',owner:'fixture-owner',revision:0,payload:{settings:{},state:{turn:0},messages:[],memories:fixture.memories,summaries:[],memory_enabled:fixture.memory}}),
  conversationPage:vi.fn(async()=>fixture.saved&&{revision:fixture.saved.revision,metadata:fixture.saved.payload}),
  recoverConversationGeneration:vi.fn(async(owner:string,id:string,_sessionId:string,revision?:number)=>{
    if(revision!==undefined&&revision!==fixture.saved.revision)throw Error('Stale confirmation');
    const key='generation:'+owner+':'+id,recovered={...fixture.meta.get(key),status:'failed'};
    const {saveEntity}=await import('./appStore');
    await saveEntity({...fixture.saved,payload:{...fixture.saved.payload,pending_generation:null}},fixture.saved.revision,{[key]:recovered});return recovered;
  }),
  appTransaction:async(_stores:any,_mode:any,_action:any)=>++fixture.sequence,
  saveEntity:vi.fn(async(value:any,_revision:number,metadata:Record<string,unknown>={})=>{if(fixture.fail&&fixture.saved)throw Error('fixture storage failed');
    fixture.saved=structuredClone({...value,revision:value.revision+1});for(const [key,item] of Object.entries(metadata))fixture.meta.set(key,structuredClone(item));return fixture.saved;}),
}));
import { deviceFetch } from './deviceApi';
import { allEntities,entity,recoverConversationGeneration } from './appStore';
import { deviceExecutionLockName } from './deviceResearch';

beforeEach(()=>{fixture.saved=undefined;fixture.sequence=0;fixture.fail=true;fixture.memory=false;fixture.memories=[];fixture.reply='fixture reply';fixture.proposals=[];fixture.meta.clear();fixture.busy.mockClear();fixture.locks.clear();fixture.paused=undefined;fixture.started=false;
  vi.mocked(allEntities).mockResolvedValue([]);
  vi.mocked(entity).mockClear();vi.mocked(recoverConversationGeneration).mockClear();
  vi.stubGlobal('navigator',{locks:{request:async(name:string,_options:any,fn:any)=>{
    if(fixture.locks.has(name))return fn(null);fixture.locks.add(name);try{return await fn({name});}finally{fixture.locks.delete(name);}
  }}});
});
afterEach(()=>{vi.unstubAllGlobals();});

it('holds the shared research/execution lock through inference and the final durable write',async()=>{
  fixture.fail=false;vi.stubGlobal('location',{href:'https://device.test/device/'});
  let release!:()=>void;fixture.paused=new Promise<void>(done=>{release=done;});
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'held',model_id:'fixture',messages:[{role:'user',content:'retain input'}]})});
  const stream=response.text();await vi.waitFor(()=>expect(fixture.started).toBe(true));
  expect(fixture.locks.has(deviceExecutionLockName('fixture-owner'))).toBe(true);
  expect(fixture.meta.get('generation:fixture-owner:held').status).toBe('pending');
  const second=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'second',model_id:'fixture',messages:[{role:'user',content:'must not run'}]})});
  expect(second.status).toBe(409);expect(fixture.saved.payload.messages).toHaveLength(1);
  const manual=await deviceFetch('/api/memory',{method:'POST',body:JSON.stringify({scope:'chat',type:'semantic',content:'must wait'})});
  expect(manual.status).toBe(409);expect(fixture.saved.payload.memories).toEqual([]);
  release();expect(await stream).toContain('event: done');
  await vi.waitFor(()=>expect(fixture.locks.size).toBe(0));
  expect(fixture.meta.get('generation:fixture-owner:held').status).toBe('completed');
  expect(fixture.saved.payload.pending_generation).toBeNull();
});

it('keeps another document pending and recovers only after its execution lock is gone',async()=>{
  fixture.fail=false;
  const lock=deviceExecutionLockName('fixture-owner'),key='generation:fixture-owner:remote';
  fixture.saved={id:'chat',owner:'fixture-owner',revision:2,payload:{pending_generation:'remote',messages:[{content:'pending input'}],draft:'keep draft',memories:[]}};
  fixture.meta.set(key,{generation_id:'remote',session_id:'chat',status:'pending',execution_lock:lock});fixture.locks.add(lock);
  const before=structuredClone(fixture.saved);
  expect((await (await deviceFetch('/api/chat/generations/remote?session_id=chat')).json()).status).toBe('pending');
  expect((await deviceFetch('/api/chat/generations/remote/cancel?session_id=chat',{method:'POST'})).status).toBe(409);
  expect(fixture.saved).toEqual(before);expect(fixture.meta.get(key).status).toBe('pending');
  fixture.locks.delete(lock);
  const recovered=await (await deviceFetch('/api/chat/generations/remote?session_id=chat')).json();
  expect(recovered.status).toBe('failed');expect(fixture.saved.payload.pending_generation).toBeNull();
  expect(recoverConversationGeneration).toHaveBeenCalledExactlyOnceWith('fixture-owner','remote','chat',undefined);expect(entity).not.toHaveBeenCalled();
  expect(fixture.saved.payload.messages).toEqual(before.payload.messages);expect(fixture.saved.payload.draft).toBe('keep draft');
  const revision=fixture.saved.revision;
  await deviceFetch('/api/chat/generations/remote?session_id=chat');expect(fixture.saved.revision).toBe(revision);
});

it('retains the orphan status and session when recovery cannot be saved',async()=>{
  fixture.saved={id:'chat',owner:'fixture-owner',revision:2,payload:{pending_generation:'orphan',messages:[{content:'preserve'}]}};
  fixture.meta.set('generation:fixture-owner:orphan',{generation_id:'orphan',session_id:'chat',status:'pending',execution_lock:deviceExecutionLockName('fixture-owner')});
  const before=structuredClone(fixture.saved);
  expect((await deviceFetch('/api/chat/generations/orphan?session_id=chat')).status).toBe(400);
  expect(fixture.saved).toEqual(before);expect(fixture.meta.get('generation:fixture-owner:orphan').status).toBe('pending');
  expect(fixture.locks.size).toBe(0);
});

it('rejects unsupported Web Locks before loading a model or persisting input',async()=>{
  vi.stubGlobal('navigator',{});
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'unsupported',model_id:'fixture',messages:[{role:'user',content:'hello'}]})});
  expect(response.status).toBe(503);expect(fixture.saved).toBeUndefined();expect(fixture.started).toBe(false);
});

it('requires explicit confirmation and the current revision to recover an unmarked older generation',async()=>{
  fixture.fail=false;
  fixture.saved={id:'chat',owner:'fixture-owner',revision:2,payload:{pending_generation:'legacy',messages:[{content:'old input'}],draft:'new draft'}};
  const key='generation:fixture-owner:legacy';fixture.meta.set(key,{generation_id:'legacy',session_id:'chat',status:'pending',assistant_id:null,user_id:1});
  const before=structuredClone(fixture.saved),path='/api/chat/generations/legacy',query='?session_id=chat';
  expect(await (await deviceFetch(path+query)).json()).toMatchObject({status:'pending',legacy_recovery_revision:2});
  expect(fixture.saved).toEqual(before);expect(fixture.meta.get(key)).not.toHaveProperty('legacy_recovery_revision');
  for(const body of [{},{legacy_recovery_confirmed:true,expected_revision:1},{legacy_recovery_confirmed:false,expected_revision:2}])
    expect((await deviceFetch(path+'/cancel'+query,{method:'POST',body:JSON.stringify(body)})).status).toBe(409);
  expect(fixture.saved).toEqual(before);
  const accepted=await deviceFetch(path+'/cancel'+query,{method:'POST',body:JSON.stringify({legacy_recovery_confirmed:true,expected_revision:2})});
  expect(accepted.status).toBe(200);expect((await accepted.json()).status).toBe('failed');
  expect(fixture.saved.payload).toEqual({...before.payload,pending_generation:null});
  const revision=fixture.saved.revision;
  await deviceFetch(path+'/cancel'+query,{method:'POST',body:JSON.stringify({legacy_recovery_confirmed:true,expected_revision:2})});
  expect(fixture.saved.revision).toBe(revision);
});
it('reports the generation and persistence failures through SSE while retaining the pending input',async()=>{
  vi.stubGlobal('location',{href:'https://device.test/device/'});
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'generation-fixture',model_id:'fixture',messages:[{role:'user',content:'未送信を残す'}]})});
  expect(response.status).toBe(200);const stream=await response.text();
  expect(stream).toContain('event: error');expect(stream).toContain('fixture inference failed');expect(stream).toContain('Device save failed');
  expect(fixture.saved.payload.pending_generation).toBe('generation-fixture');expect(fixture.saved.payload.messages.at(-1).content).toBe('未送信を残す');
  expect(fixture.busy.mock.calls.map(([value])=>value)).toEqual([true,false]);
});
it('freezes the prompt and temperature actually requested in both historical snapshots',async()=>{
  fixture.fail=false;vi.stubGlobal('location',{href:'https://device.test/device/'});
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'frozen-settings',model_id:'fixture',system_prompt:'REQUEST PROMPT',temperature:.25,messages:[{role:'user',content:'hello'}]})});
  expect(await response.text()).toContain('event: done');
  const message=fixture.saved.payload.messages.at(-1);
  expect(message.before.settings).toMatchObject({session_id:'chat',system_prompt:'REQUEST PROMPT',temperature:.25});
  expect(message.after.settings).toEqual(message.before.settings);
  expect(fixture.saved.payload.settings).toEqual({});
});

it('exposes actual turn memory evidence, source speakers and audit events through the shared debug contract',async()=>{
  fixture.fail=false;fixture.memory=true;fixture.reply='銀の鍵で古い扉を開けた。サーモンのお寿司が好きなんだね。';
  fixture.memories=[{id:'old-memory',type:'semantic',content:'サーモンのお寿司が好き',origin:'user',supported:null,status:'active',version:1,access_count:2,source_kind:'user_statement'}];
  fixture.proposals=[{type:'episodic',content:'銀の鍵で古い扉を開けた',source_kind:'story_event'},
    {type:'semantic',content:'猫を三匹飼っている',source_kind:'user_statement'},
    {type:'semantic',content:'空は紫色',source_kind:'work_setting'}];
  vi.stubGlobal('location',{href:'https://device.test/device/'});
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'provenance',model_id:'fixture',
    messages:[{role:'user',content:'サーモンのお寿司が好き。猫を三匹飼っている。空は紫色。'}]})});
  expect(await response.text()).toContain('event: done');
  const p=fixture.saved.payload,trace=p.last_generation.memory;
  expect(trace).toMatchObject({enabled:true,scope:'chat',stored_count:1,retrieval_ms:expect.any(Number),injected:['old-memory'],evidenced:['old-memory']});
  expect(p.last_generation.telemetry.memory).toEqual(trace);expect(trace.decisions).toHaveLength(3);
  const [story,user,canon]=p.memories.slice(1),messages=p.messages;
  expect(story).toMatchObject({supported:true,source_kind:'story_event',source_quote:fixture.reply,source_message_ids:[messages[1].id],source_revision:'1',source_generation_id:'provenance',confirmation:'unverified'});
  expect(user).toMatchObject({supported:true,source_kind:'user_statement',source_quote:messages[0].content,source_message_ids:[messages[0].id],confirmation:'unverified'});
  expect(canon).toMatchObject({supported:false,source_kind:'work_setting',confirmation:'unverified'});
  expect(trace.decisions.map((d:any)=>d.memory_id)).toEqual([story.id,user.id,canon.id]);
  expect(p.memories[0].access_count).toBe(3);expect(fixture.memories[0].access_count).toBe(2);
  expect(messages[1].before.memories).toEqual(fixture.memories);expect(messages[1].after.memories).toEqual(p.memories);
  const debug=await (await deviceFetch('/api/chat/debug?session_id=chat')).json();
  expect(debug.memory).toEqual(trace);expect(debug.memory_session).toEqual({enabled:true,scope:'chat'});
  expect(debug.prompt_source).toBe('saved_generation');
  expect(debug.generation.raw_prompt).toContain('サーモンのお寿司が好き');expect(debug.compiled).toEqual(p.last_generation.compiled);
  expect(debug.generation.raw_prompt).toContain('source: user_statement');
  expect(debug.generation.raw_prompt).toContain('Story events are fiction, not user facts');
  expect(fixture.meta.get('memory-events:'+JSON.stringify(['fixture-owner','chat'])).map((e:any)=>e.op)).toEqual(['retrieve','inject','create','create','create']);
});

it('reports memory off without reading, recalling or storing memory evidence',async()=>{
  fixture.fail=false;fixture.memory=false;fixture.memories=[{id:'private-note',type:'semantic',content:'Never recall when off',origin:'user',supported:null,status:'active',access_count:7}];
  fixture.proposals=[{type:'semantic',content:'Must not store',source_kind:'user_statement'}];
  vi.stubGlobal('location',{href:'https://device.test/device/'});
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'memory-off',model_id:'fixture',messages:[{role:'user',content:'Hello'}]})});
  expect(await response.text()).toContain('event: done');
  expect(fixture.saved.payload.memories).toEqual(fixture.memories);expect(fixture.saved.payload.last_generation.memory).toBeNull();
  expect(fixture.saved.payload.last_generation.raw_prompt).not.toContain('Never recall when off');
  expect(fixture.meta.has('memory-events:'+JSON.stringify(['fixture-owner','chat']))).toBe(false);
});

it('keeps a later manual memory when regenerating a legacy conversation',async()=>{
  fixture.fail=false;fixture.memory=true;vi.stubGlobal('location',{href:'https://device.test/device/'});
  const body={session_id:'chat',generation_id:'legacy-original',model_id:'fixture',messages:[{role:'user',content:'Hello'}]};
  expect(await (await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify(body)})).text()).toContain('event: done');
  const assistant=fixture.saved.payload.messages.at(-1);
  fixture.saved.payload.memories.push({id:'later-manual',type:'semantic',content:'Later manual fact',status:'active',origin:'user',supported:null,
    version:1,source_session_id:'chat',source_generation_id:null,source_message_ids:[]});fixture.saved.revision++;
  expect(await (await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({...body,generation_id:'legacy-replacement',regenerate_message_id:assistant.id})})).text()).toContain('event: done');
  expect(fixture.saved.payload.memories.map((memory:any)=>memory.id)).toContain('later-manual');
  const user=fixture.saved.payload.messages.at(-2),generation=fixture.saved.payload.last_generation;
  expect(generation.user_id).toBe(user.id);
  expect(fixture.meta.get('generation:fixture-owner:legacy-replacement')).toMatchObject({user_id:user.id,user_content_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
  fixture.saved.kind='conversation';vi.mocked(allEntities).mockResolvedValue([fixture.saved]);
  const edit=await deviceFetch('/api/chat/history/'+user.id,{method:'PUT',body:JSON.stringify({content:'Edited input after regeneration'})});
  expect(edit.ok).toBe(true);expect(fixture.saved.payload.last_generation).toBeNull();
});
