import { afterEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({saved:undefined as any,sequence:0,busy:vi.fn()}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class {
  async load(){} async generate(){throw Error('fixture inference failed');} stop(){}
}}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fixture',runtime:'gguf',temperature:.8,topK:64,topP:.95}],readyModels:async()=>new Set(['fixture'])}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('./appContext',()=>({deviceOwner:()=> 'fixture-owner',setGenerationBusy:fixture.busy}));
vi.mock('./appStore',async importOriginal=>({
  ...await importOriginal<typeof import('./appStore')>(),
  allEntities:async()=>[],getMeta:async()=>undefined,openEntity:async()=>({id:'chat',owner:'fixture-owner',revision:0,payload:{settings:{},state:{turn:0},messages:[],memories:[],summaries:[]}}),
  appTransaction:async(_stores:any,_mode:any,_action:any)=>++fixture.sequence,
  saveEntity:vi.fn(async(value:any)=>{if(fixture.saved)throw Error('fixture storage failed');fixture.saved=structuredClone(value);return value;}),
}));
import { deviceFetch } from './deviceApi';
afterEach(()=>{vi.unstubAllGlobals();});
it('reports the generation and persistence failures through SSE while retaining the pending input',async()=>{
  vi.stubGlobal('location',{href:'https://device.test/device/'});
  const response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'chat',generation_id:'generation-fixture',model_id:'fixture',messages:[{role:'user',content:'未送信を残す'}]})});
  expect(response.status).toBe(200);const stream=await response.text();
  expect(stream).toContain('event: error');expect(stream).toContain('fixture inference failed');expect(stream).toContain('Device save failed');
  expect(fixture.saved.payload.pending_generation).toBe('generation-fixture');expect(fixture.saved.payload.messages.at(-1).content).toBe('未送信を残す');
  expect(fixture.busy.mock.calls.map(([value])=>value)).toEqual([true,false]);
});
