import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { deviceResponseGrammar } from '../lib/deviceCore';
const fixture=vi.hoisted(()=>({loads:[] as any[],completions:[] as any[]}));
vi.mock('./models',()=>({MODELS:[{id:'fixture',runtime:'gguf',temperature:0,topK:64,topP:1,revision:'fixture',files:[{}]}],
  readyModels:async()=>new Set(['fixture']),openModelFile:async()=>new Blob([])}));
vi.mock('@wllama/wllama',()=>({Wllama:class{
  async exit(){}
  async loadModel(_files:any,options:any){fixture.loads.push(options);}
  async _getDebugInfo(){return {plePresent:false,pleLazy:false};}
  async createChatCompletion(options:any){fixture.completions.push(options);return (async function*(){
    yield {choices:[{delta:{content:'fictional output'}}],usage:{completion_tokens:3}};
  })();}
}}));
beforeEach(()=>{vi.resetModules();fixture.loads=[];fixture.completions=[];
  vi.stubGlobal('self',{location:{origin:'https://device.test'},postMessage:vi.fn()});
  vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>null},userAgent:'fixture'});
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,text:async()=>''})));
});
afterEach(()=>vi.unstubAllGlobals());
it('disables native reasoning budget and applies structured grammar without changing plain Mobile requests',async()=>{
  await import('./runtime.worker');
  const worker=self as any;
  await worker.onmessage({data:{id:1,type:'load',modelId:'fixture',cpu:true,base:'https://device.test/'}});
  expect(fixture.loads[0]).toMatchObject({n_ctx:2048,n_gpu_layers:0,reasoning:false,
    default_template_kwargs:{enable_thinking:false}});
  const data={type:'generate',messages:[{role:'user',content:'Hello'}],settings:{temperature:0,max_tokens:256,seed:42}};
  await worker.onmessage({data:{...data,id:2,responseGrammar:deviceResponseGrammar}});
  expect(fixture.completions[0]).toMatchObject({max_tokens:256,seed:42,grammar:deviceResponseGrammar,reasoning_budget_tokens:0,reasoning_format:'none'});
  expect(worker.postMessage.mock.calls.find(([event]:any)=>event.id===2&&event.type==='done')[0].measurement.structuredOutput).toBe('grammar');
  await worker.onmessage({data:{...data,id:3}});
  expect(fixture.completions[1]).not.toHaveProperty('grammar');
  expect(fixture.completions[1]).not.toHaveProperty('reasoning_budget_tokens');expect(fixture.completions[1]).not.toHaveProperty('reasoning_format');
  expect(worker.postMessage.mock.calls.find(([event]:any)=>event.id===3&&event.type==='done')[0].measurement.structuredOutput).toBe('text');
});
