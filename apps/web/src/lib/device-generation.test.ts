import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({saved:undefined as any,sequence:0,busy:vi.fn(),fail:true,memory:false,memories:[] as any[],reply:'fixture reply',proposals:[] as any[],meta:new Map<string,any>()}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class {
  async load(){} async generate(_messages:any,event:any){
    if(fixture.fail)throw Error('fixture inference failed');
    event({type:'delta',text:JSON.stringify({reply:fixture.reply,state_update:{location:'library',time:'now',mood:'calm',active_scene:'tea',relationship_state:{stage:'stranger',tone:'neutral',unresolved_conflict:false}},memory_proposals:fixture.proposals})});
    return {measurement:{memory:'must not override the actual memory trace'},stopped:false};
  } stop(){}
}}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',runtime:'gguf',temperature:.8,topK:64,topP:.95}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('./appContext',()=>({deviceOwner:()=> 'fixture-owner',setGenerationBusy:fixture.busy}));
vi.mock('./appStore',async importOriginal=>({
  ...await importOriginal<typeof import('./appStore')>(),
  allEntities:async()=>[],getMeta:async(key:string)=>structuredClone(fixture.meta.get(key)),openEntity:async()=>structuredClone(fixture.saved??{id:'chat',owner:'fixture-owner',revision:0,payload:{settings:{},state:{turn:0},messages:[],memories:fixture.memories,summaries:[],memory_enabled:fixture.memory}}),
  appTransaction:async(_stores:any,_mode:any,_action:any)=>++fixture.sequence,
  saveEntity:vi.fn(async(value:any,_revision:number,metadata:Record<string,unknown>={})=>{if(fixture.fail&&fixture.saved)throw Error('fixture storage failed');
    fixture.saved=structuredClone({...value,revision:value.revision+1});for(const [key,item] of Object.entries(metadata))fixture.meta.set(key,structuredClone(item));return fixture.saved;}),
}));
import { deviceFetch } from './deviceApi';

beforeEach(()=>{fixture.saved=undefined;fixture.sequence=0;fixture.fail=true;fixture.memory=false;fixture.memories=[];fixture.reply='fixture reply';fixture.proposals=[];fixture.meta.clear();fixture.busy.mockClear();});
afterEach(()=>{vi.unstubAllGlobals();});
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
  expect(debug.generation.raw_prompt).toContain('サーモンのお寿司が好き');expect(debug.compiled).toEqual(p.last_generation.compiled);
  expect(debug.generation.raw_prompt).toContain('source: user_statement; story events are fictional, not user biography');
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
