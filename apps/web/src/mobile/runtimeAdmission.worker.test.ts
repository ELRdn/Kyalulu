import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceResponseGrammar } from '../lib/deviceCore';
import type { ChatTurn, MobileModel } from './types';

const engine=vi.hoisted(()=>({
  models:[] as MobileModel[],
  load:vi.fn(),exit:vi.fn(),debug:vi.fn(),completion:vi.fn(),count:vi.fn(),
  tokenize:vi.fn(),generate:vi.fn(),dispose:vi.fn(),reset:vi.fn(),interrupt:vi.fn(),
  tokenizerLoad:vi.fn(),onnxLoad:vi.fn(),
  trace:[] as {messages:ChatTurn[];options:Record<string,unknown>}[],
}));
vi.mock('./models',()=>({
  MODELS:engine.models,
  readyModels:async()=>new Set(engine.models.map(model=>model.id)),
  openModelFile:vi.fn(async()=>new Blob([])),
}));
vi.mock('@wllama/wllama',()=>({Wllama:class {
  loadModel=engine.load;
  exit=engine.exit;
  _getDebugInfo=engine.debug;
  createChatCompletion=engine.completion;
  countChatTokens=engine.count;
}}));
vi.mock('@huggingface/transformers',()=>({
  env:{backends:{onnx:{wasm:{}}}},
  AutoTokenizer:{from_pretrained:engine.tokenizerLoad},
  AutoModelForCausalLM:{from_pretrained:engine.onnxLoad},
  InterruptableStoppingCriteria:class {reset=engine.reset;interrupt=engine.interrupt;},
  TextStreamer:class {
    constructor(_tokenizer:unknown,public options:{callback_function:(text:string)=>void}){}
  },
}));

type Packet=Record<string,any>;
const origin='https://device.test';
const turn=(role:ChatTurn['role'],content:string):ChatTurn=>({role,content});
const admission={modelId:'fixture',modelRevision:'distribution-v1',outputTokens:256,originalRuns:1,newestUserRun:0};
const request=(overrides:Packet={}):Packet=>({
  id:2,type:'generate-admitted',mandatory:[{run:0,...turn('user','Hello')}],
  settings:{max_tokens:256},admission:{...admission},...overrides,
});
let worker:{location:{origin:string};postMessage:ReturnType<typeof vi.fn>;onmessage:(event:{data:Packet})=>Promise<void>};
let context:typeof import('./context');
const send=(data:Packet)=>worker.onmessage({data});
const events=(id:number):Packet[]=>worker.postMessage.mock.calls.map(([event])=>event).filter(event=>event.id===id);
async function boot(modelId:string|null='fixture') {
  context=await import('./context');
  vi.spyOn(context,'mergeTurns');
  vi.spyOn(context,'fitContext');
  await import('./runtime.worker');
  if(modelId!==null) {
    await send({id:1,type:'load',modelId,cpu:true,base:origin+'/'});
    expect(events(1)).toEqual([{id:1,type:'done',backend:modelId==='onnx'?'ONNX WebGPU':'WASM CPU'}]);
  }
}
async function rejected(data:Packet) {
  await run(data);
  expect(events(data.id).filter(event=>event.type!=='admission-count')).toEqual([{id:data.id,type:'error',error:expect.any(String)}]);
  expect(events(data.id)[0].error).not.toBe('未対応の推論操作');
  expect(engine.completion).not.toHaveBeenCalled();
  expect(engine.generate).not.toHaveBeenCalled();
  expect(context.mergeTurns).not.toHaveBeenCalled();
  expect(context.fitContext).not.toHaveBeenCalled();
}

beforeEach(()=>{
  vi.resetModules();vi.resetAllMocks();
  const model:MobileModel={id:'fixture',name:'fixture',runtime:'gguf',repo:'test/fixture',revision:'source-v1',
    distributionRevision:'distribution-v1',source:'fixture',license:'test',files:[],temperature:.7,topK:64,topP:.95,note:''};
  const {distributionRevision:_,...sourceOnly}=model;
  engine.models.splice(0,engine.models.length,model,{...sourceOnly,id:'source-only'},
    {...sourceOnly,id:'onnx',runtime:'onnx'});
  engine.trace=[];
  engine.count.mockResolvedValue(7);
  engine.load.mockResolvedValue(undefined);engine.exit.mockResolvedValue(undefined);
  engine.debug.mockResolvedValue({plePresent:false});
  engine.completion.mockImplementation(async()=>(async function*(){
    yield {choices:[{delta:{content:'fictional output'}}],usage:{completion_tokens:3}};
  })());
  engine.tokenize.mockImplementation((messages:ChatTurn[],options:Record<string,unknown>)=>{
    // fitContext mutates its candidate array; snapshot each tokenizer call at the boundary.
    engine.trace.push({messages:messages.map(message=>({...message})),options:{...options}});
    if(options.return_dict)return {input_ids:{dims:[1,7]},attention_mask:{dims:[1,7]}};
    return Array(messages.some(message=>message.content==='old-1')?1801:
      messages.some(message=>message.content==='old-2')?1793:7).fill(0);
  });
  engine.tokenizerLoad.mockResolvedValue({apply_chat_template:engine.tokenize});
  engine.onnxLoad.mockResolvedValue({generate:engine.generate,dispose:engine.dispose});
  engine.generate.mockImplementation(async(options:Packet)=>{
    options.streamer.options.callback_function('fictional output');return {dims:[1,10]};
  });
  worker={location:{origin},postMessage:vi.fn(),onmessage:undefined!};
  vi.stubGlobal('self',worker);
  vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})},userAgent:'worker-unit-test'});
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,text:async()=>''})));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

async function run(data:Packet,history:Packet[]=[]){
  const running=send(data);
  await vi.waitFor(()=>expect(events(data.id).some(event=>['admission-count','error','done'].includes(event.type))).toBe(true));
  if(events(data.id).some(event=>event.type==='admission-count'))
    await send({id:data.id,type:'admission-window',admission:data.admission,history});
  await running;
}
const wire=(run:number,role:ChatTurn['role'],content:string)=>({run,role,content});

describe('held native admission protocol',()=>{
  it('counts and generates the identical final options without remerging newly adjacent systems',async()=>{
    await boot();
    const mandatory=[wire(0,'system','head'),wire(3,'system','middle'),wire(4,'user','latest 😀'),wire(5,'assistant','prefill')];
    const settings={temperature:.25,top_k:17,top_p:.82,max_tokens:384,min_p:.07,
      repeat_penalty:1.12,repeat_last_n:80,frequency_penalty:.2,presence_penalty:-.1,seed:42};
    const data=request({mandatory,settings,responseGrammar:deviceResponseGrammar,
      admission:{...admission,outputTokens:384,originalRuns:6,newestUserRun:4}});
    const original=structuredClone(data);mandatory.forEach(Object.freeze);Object.freeze(mandatory);
    await run(data);
    const options=engine.completion.mock.calls[0][0];
    expect(options).toEqual({messages:mandatory.map(({role,content})=>({role,content})),stream:true,temperature:.25,top_k:17,top_p:.82,
      max_tokens:384,min_p:.07,penalty_repeat:1.12,penalty_last_n:80,penalty_freq:.2,penalty_present:-.1,seed:42,
      grammar:deviceResponseGrammar,reasoning_budget_tokens:0,reasoning_format:'none',
      abortSignal:expect.any(AbortSignal),chat_template_kwargs:{enable_thinking:false},cache_prompt:true});
    expect(engine.count).toHaveBeenCalledTimes(2);
    expect(engine.count.mock.calls.at(-1)![0]).toBe(options);
    expect(context.mergeTurns).not.toHaveBeenCalled();expect(context.fitContext).not.toHaveBeenCalled();
    expect(events(2)).toEqual([{id:2,type:'admission-count',mandatoryInputTokens:7},{id:2,type:'context',omitted:2},
      {id:2,type:'delta',text:'fictional output'},{id:2,type:'done',measurement:expect.objectContaining({outputTokens:3,structuredOutput:'grammar'})}]);
    expect(data).toEqual(original);
  });
  it('rescues intact mandatory text beyond proxy budget and beyond the merged original cap',async()=>{
    await boot();
    const content='あ'.repeat(128000)+'\n\n'+'😀'.repeat(64000);
    await run(request({mandatory:[wire(0,'system',content),wire(1,'user','latest')],admission:{...admission,originalRuns:2,newestUserRun:1}}));
    expect(engine.completion).toHaveBeenCalledTimes(1);
    expect(engine.completion.mock.calls[0][0].messages[0].content).toBe(content);
  });
  it('recounts nonmonotone whole candidates and drops entire units with system barriers',async()=>{
    await boot();
    engine.count.mockResolvedValueOnce(25).mockResolvedValueOnce(1900).mockResolvedValueOnce(1950).mockResolvedValueOnce(1700);
    const data=request({mandatory:[wire(0,'system','head'),wire(3,'system','barrier'),wire(6,'user','latest')],
      admission:{...admission,originalRuns:7,newestUserRun:6}});
    await run(data,[wire(1,'user','old1'),wire(2,'assistant','reply1'),wire(4,'user','old2'),wire(5,'assistant','reply2')]);
    expect(engine.count.mock.calls.map(([o])=>o.messages.map((m:ChatTurn)=>m.content))).toEqual([
      ['head','barrier','latest'],['head','old1','reply1','barrier','old2','reply2','latest'],
      ['head','barrier','old2','reply2','latest'],['head','barrier','latest']]);
    expect(events(2)).toContainEqual({id:2,type:'context',omitted:4});
    expect(engine.completion.mock.calls[0][0]).toBe(engine.count.mock.calls.at(-1)![0]);
  });
  it.each([1792,1793])('uses exact final native boundary %s with default output256',async count=>{
    await boot();engine.count.mockResolvedValue(count);
    await run(request({settings:undefined}));
    expect(engine.completion).toHaveBeenCalledTimes(count===1792?1:0);
    expect(events(2).at(-1)).toMatchObject({type:count===1792?'done':'error'});
    if(count===1792)expect(engine.completion.mock.calls[0][0].max_tokens).toBe(256);
  });
  it('does not reject an old valid window when mandatory-only count overflows or fails to parse',async()=>{
    await boot();
    for(const [i,value] of [1900,new Error('mandatory template')].entries()){
      engine.count.mockReset();
      if(value instanceof Error)engine.count.mockRejectedValueOnce(value);else engine.count.mockResolvedValueOnce(value);
      engine.count.mockResolvedValueOnce(100);
      await run(request({id:10+i,mandatory:[wire(2,'user','latest')],admission:{...admission,originalRuns:3,newestUserRun:2}}),
        [wire(0,'user','old'),wire(1,'assistant','reply')]);
      expect(events(10+i).at(-1)).toMatchObject({type:'done'});
    }
    expect(engine.completion).toHaveBeenCalledTimes(2);
  });
  it.each([undefined,null,false,'admission',[],{}, {...admission,modelId:'other'},{...admission,modelRevision:'source-v1'},
    {...admission,outputTokens:255},{...admission,outputTokens:'256'},{...admission,originalRuns:-1},
    {...admission,originalRuns:1.5},{...admission,newestUserRun:1},{...admission,newestUserRun:-2}])('rejects malformed/stale fence %j',async value=>{
    await boot();await rejected(request({admission:value}));
  });
  it.each([null,'messages',[null],Array(1),[{run:0,role:'tool',content:'x'}],[wire(-1,'user','x')],
    [wire(0,'user','x'),wire(0,'user','x')],[wire(0,'system','missing latest')],
    [{run:0,role:'user',content:17}]])('rejects malformed mandatory sequence %j',async mandatory=>{
    await boot();await rejected(request({mandatory}));
  });
  it.each([NaN,Infinity,-1,1.5,'7',undefined])('rejects malformed public count %s before generation',async count=>{
    await boot();engine.count.mockResolvedValue(count);await rejected(request());
  });
  it('fails explicitly if the loaded engine lacks public native count',async()=>{
    await boot();engine.count=undefined as any;
    // The loaded instance retains its own field; boot another instance with no method.
    await send({id:3,type:'load',modelId:'fixture',cpu:true,base:origin+'/'});
    await rejected(request());expect(events(2)[0].error).toContain('SDK is required');
    engine.count=vi.fn();
  });
  it.each([null,[],{max_tokens:0},{max_tokens:1025},{max_tokens:256.5},{temperature:NaN},{seed:-1}])('revalidates settings %j',async settings=>{
    await boot();await rejected(request({settings}));
  });
  it('rejects missing model, ONNX admission and raw GGUF bypass',async()=>{
    await boot(null);await rejected(request());
    await send({id:1,type:'load',modelId:'onnx',cpu:true,base:origin+'/'});
    await rejected(request({id:3}));
    await send({id:4,type:'load',modelId:'fixture',cpu:true,base:origin+'/'});
    await rejected({id:5,type:'generate',messages:[turn('user','raw')]});
  });
  it('pins source revision when distribution revision is absent and recovers from errors',async()=>{
    await boot('source-only');await rejected(request());
    await run(request({id:3,admission:{...admission,modelId:'source-only',modelRevision:'source-v1'}}));
    expect(events(3).at(-1)).toMatchObject({type:'done'});
  });
  it('rejects malformed continuation once and ignores stale/duplicate continuations',async()=>{
    await boot();
    const running=send(request());
    await vi.waitFor(()=>expect(events(2)[0]?.type).toBe('admission-count'));
    await send({id:99,type:'admission-window',history:[]});
    await send({id:2,type:'admission-window',admission:{...admission,outputTokens:512},history:[]});
    await running;expect(events(2).filter(e=>e.type==='error')).toHaveLength(1);
    await send({id:2,type:'admission-window',admission,history:[]});
    await run(request({id:3}));expect(events(3).at(-1)).toMatchObject({type:'done'});
  });
  it.each([{}, {history:[],error:'both'}, {history:null}, {history:[wire(0,'user','overlap')]},
    {history:[wire(0,'system','hidden system')]}, {error:17}])('rejects invalid continuation body %j',async body=>{
    await boot();const running=send(request());
    await vi.waitFor(()=>expect(events(2)[0]?.type).toBe('admission-count'));
    await send({id:2,type:'admission-window',admission,...body});await running;
    expect(events(2).at(-1)?.type).toBe('error');expect(engine.completion).not.toHaveBeenCalled();
  });
  it('retains streaming stop and then allows another admitted request',async()=>{
    await boot();let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    engine.completion.mockImplementationOnce(async(options:Packet)=>(async function*(){
      yield {choices:[{delta:{content:'partial'}}]};await gate;options.abortSignal.throwIfAborted();
      yield {choices:[{delta:{content:'must not escape'}}]};
    })());
    const running=run(request());
    await vi.waitFor(()=>expect(events(2)).toContainEqual({id:2,type:'delta',text:'partial'}));
    await send({id:2,type:'stop'});release();await running;
    expect(events(2).at(-1)).toEqual({id:2,type:'done',stopped:true});
    expect(events(2).filter(e=>e.type==='delta')).toHaveLength(1);
    await run(request({id:3}));expect(events(3).at(-1)).toMatchObject({type:'done'});
  });
  it('rejects optional history that impersonates a mandatory system run id',async()=>{
    await boot();
    await run(request({mandatory:[wire(0,'system','keep'),wire(2,'user','latest')],
      admission:{...admission,originalRuns:3,newestUserRun:2}}),[wire(0,'assistant','overlap')]);
    expect(events(2).at(-1)).toMatchObject({type:'error',error:'Overlapping GGUF runs'});
    expect(engine.completion).not.toHaveBeenCalled();
  });
  it.each(['mandatory','window','final'])('holds busy and drains stop at %s boundary without generating',async phase=>{
    await boot();
    let release!:(value:number)=>void;
    const gate=new Promise<number>(resolve=>{release=resolve;});
    if(phase==='mandatory')engine.count.mockReturnValueOnce(gate);
    if(phase==='final')engine.count.mockResolvedValueOnce(7).mockReturnValueOnce(gate);
    const running=send(request());
    if(phase!=='mandatory'){
      await vi.waitFor(()=>expect(events(2)[0]?.type).toBe('admission-count'));
      if(phase==='final')await send({id:2,type:'admission-window',admission,history:[]});
    }else await vi.waitFor(()=>expect(engine.count).toHaveBeenCalledTimes(1));
    for(const [i,type] of ['generate','generate-admitted','load','unload'].entries()){
      await send({id:10+i,type});
      expect(events(10+i)[0]).toMatchObject({type:'error',error:'処理中です。停止してから操作してください。'});
    }
    await send({id:999,type:'stop'});
    expect(events(2).at(-1)?.type).not.toBe('done');
    await send({id:2,type:'stop'});
    if(phase!=='window'){
      await send({id:30,type:'unload'});expect(events(30)[0].type).toBe('error');
      release(7);
    }
    await running;expect(events(2).at(-1)).toEqual({id:2,type:'done',stopped:true});
    expect(engine.completion).not.toHaveBeenCalled();
    await send({id:2,type:'admission-window',admission,history:[]});
    engine.count.mockResolvedValue(7);await run(request({id:40}));
    expect(events(40).at(-1)).toMatchObject({type:'done'});
  });
});

describe('legacy raw generate',()=>{
  it.each([0,.25])('retains the ONNX candidate-removal trace and final tokenizer call at temperature %s',async temperature=>{
    await boot('onnx');
    const messages=[turn('system','first'),turn('user','old-1'),turn('assistant','reply-1'),turn('system','middle'),
      turn('user','old-2'),turn('assistant','reply-2'),turn('user','latest'),turn('user','fragment'),turn('assistant','tail')];
    const original=structuredClone(messages);
    messages.forEach(Object.freeze);Object.freeze(messages);
    const settings=Object.freeze({temperature,top_k:19,top_p:.81,max_tokens:256});
    await send({id:2,type:'generate',messages,settings});
    const merged=[...messages.slice(0,6),turn('user','latest\n\nfragment'),messages[8]];
    const second=[merged[0],...merged.slice(3)],final=[merged[0],merged[3],...merged.slice(6)];
    const options={tokenize:true,add_generation_prompt:true,enable_thinking:false};
    expect(context.mergeTurns).toHaveBeenCalledExactlyOnceWith(messages);
    expect(context.fitContext).toHaveBeenCalledExactlyOnceWith(merged,expect.any(Function),256);
    expect(engine.trace).toEqual([
      {messages:merged,options},{messages:second,options},{messages:final,options},
      {messages:final,options:{...options,return_dict:true}},
    ]);
    expect(engine.generate).toHaveBeenCalledExactlyOnceWith({
      input_ids:{dims:[1,7]},attention_mask:{dims:[1,7]},max_new_tokens:256,do_sample:temperature>0,
      ...(temperature>0?{temperature,top_k:19,top_p:.81}:{}),stopping_criteria:expect.anything(),streamer:expect.anything(),
    });
    expect(engine.reset).toHaveBeenCalledTimes(1);expect(engine.completion).not.toHaveBeenCalled();
    expect(events(2)).toEqual([{id:2,type:'context',omitted:4},{id:2,type:'delta',text:'fictional output'},
      {id:2,type:'done',measurement:expect.objectContaining({modelId:'onnx',revision:'source-v1',outputTokens:3,structuredOutput:'text'})}]);
    expect(messages).toEqual(original);expect(settings).toEqual({temperature,top_k:19,top_p:.81,max_tokens:256});
  });
});
