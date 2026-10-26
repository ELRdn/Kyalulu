import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({saved:undefined as any,sequence:0,busy:vi.fn(),fail:true}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class {
  async load(){} async generate(_messages:any,event:any){
    if(fixture.fail)throw Error('fixture inference failed');
    event({type:'delta',text:JSON.stringify({reply:'fixture reply',state_update:{location:'library',time:'now',mood:'calm',active_scene:'tea',relationship_state:{stage:'stranger',tone:'neutral',unresolved_conflict:false}},memory_proposals:[]})});
    return {measurement:{},stopped:false};
  } stop(){}
}}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',runtime:'gguf',temperature:.8,topK:64,topP:.95}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('./appContext',()=>({deviceOwner:()=> 'fixture-owner',setGenerationBusy:fixture.busy}));
vi.mock('./appStore',async importOriginal=>({
  ...await importOriginal<typeof import('./appStore')>(),
  allEntities:async()=>[],getMeta:async()=>undefined,openEntity:async()=>({id:'chat',owner:'fixture-owner',revision:0,payload:{settings:{},state:{turn:0},messages:[],memories:[],summaries:[]}}),
  appTransaction:async(_stores:any,_mode:any,_action:any)=>++fixture.sequence,
  saveEntity:vi.fn(async(value:any)=>{if(fixture.fail&&fixture.saved)throw Error('fixture storage failed');fixture.saved=structuredClone(value);return value;}),
}));
import { deviceFetch } from './deviceApi';

beforeEach(()=>{fixture.saved=undefined;fixture.sequence=0;fixture.fail=true;fixture.busy.mockClear();});
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
