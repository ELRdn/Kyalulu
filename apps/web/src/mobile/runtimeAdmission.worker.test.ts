import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceResponseGrammar } from '../lib/deviceCore';
import type { ChatTurn, MobileModel } from './types';

const engine=vi.hoisted(()=>({
  models:[] as MobileModel[],
  load:vi.fn(),exit:vi.fn(),debug:vi.fn(),completion:vi.fn(),
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
const admission={modelId:'fixture',modelRevision:'distribution-v1',outputTokens:256,omitted:0};
const request=(overrides:Packet={}):Packet=>({
  id:2,type:'generate-admitted',messages:[turn('user','Hello')],
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
  await send(data);
  expect(events(data.id)).toEqual([{id:data.id,type:'error',error:expect.any(String)}]);
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

describe('generate-admitted worker protocol',()=>{
  it('consumes admitted messages once, keeping newly adjacent systems, grammar and sampling unchanged',async()=>{
    await boot();
    const messages=[turn('system','first system'),turn('system','system after omitted history'),
      turn('user','latest 😀'),turn('assistant','prefill')];
    const settings={temperature:.25,top_k:17,top_p:.82,max_tokens:384,min_p:.07,
      repeat_penalty:1.12,repeat_last_n:80,frequency_penalty:.2,presence_penalty:-.1,seed:42};
    const data=request({messages,settings,responseGrammar:deviceResponseGrammar,
      admission:{...admission,outputTokens:384,omitted:4}});
    const original=structuredClone(data);
    messages.forEach(Object.freeze);Object.freeze(messages);Object.freeze(settings);Object.freeze(data.admission);Object.freeze(data);
    await send(data);
    expect(engine.load).toHaveBeenCalledWith([] ,expect.objectContaining({n_ctx:2048,n_gpu_layers:0,reasoning:false,
      default_template_kwargs:{enable_thinking:false}}));
    expect(engine.completion).toHaveBeenCalledExactlyOnceWith({messages,stream:true,temperature:.25,top_k:17,top_p:.82,
      max_tokens:384,min_p:.07,penalty_repeat:1.12,penalty_last_n:80,penalty_freq:.2,penalty_present:-.1,seed:42,
      grammar:deviceResponseGrammar,reasoning_budget_tokens:0,reasoning_format:'none',
      abortSignal:expect.any(AbortSignal),chat_template_kwargs:{enable_thinking:false},cache_prompt:true});
    expect(engine.completion.mock.calls[0][0].messages).toEqual(original.messages);
    expect(context.mergeTurns).not.toHaveBeenCalled();expect(context.fitContext).not.toHaveBeenCalled();
    expect(engine.tokenize).not.toHaveBeenCalled();expect(engine.generate).not.toHaveBeenCalled();
    expect(events(2)).toEqual([
      {id:2,type:'context',omitted:4},{id:2,type:'delta',text:'fictional output'},
      {id:2,type:'done',measurement:expect.objectContaining({modelId:'fixture',revision:'distribution-v1',
        outputTokens:3,structuredOutput:'grammar'})},
    ]);
    expect(data).toEqual(original);
  });

  it.each([0,Number.MAX_SAFE_INTEGER])('accepts safe omitted=%s with default reserve and no grammar',async omitted=>{
    await boot();
    await send(request({settings:undefined,admission:{...admission,omitted}}));
    expect(engine.completion).toHaveBeenCalledTimes(1);
    expect(engine.completion.mock.calls[0][0]).toMatchObject({max_tokens:256,temperature:.7,top_k:64,top_p:.95});
    for(const key of ['grammar','reasoning_budget_tokens','reasoning_format'])expect(engine.completion.mock.calls[0][0]).not.toHaveProperty(key);
    expect(events(2)[0]).toEqual({id:2,type:'context',omitted});
    expect(events(2).at(-1)).toMatchObject({type:'done',measurement:{structuredOutput:'text'}});
  });

  it('uses source revision when no distribution revision exists',async()=>{
    await boot('source-only');
    await send(request({admission:{...admission,modelId:'source-only',modelRevision:'source-v1'}}));
    expect(engine.completion).toHaveBeenCalledTimes(1);
    expect(events(2).at(-1)).toMatchObject({type:'done',measurement:{modelId:'source-only',revision:'source-v1'}});
  });

  it.each([
    ['missing',undefined],['null',null],['boolean',false],['string','admission'],['array',[]],['empty',{}],
    ['array with matching fields',Object.assign([],{...admission})],
    ['missing model',{modelRevision:admission.modelRevision,outputTokens:256,omitted:0}],
    ['missing revision',{modelId:'fixture',outputTokens:256,omitted:0}],
    ['missing reserve',{modelId:'fixture',modelRevision:admission.modelRevision,omitted:0}],
    ['missing omitted',{modelId:'fixture',modelRevision:admission.modelRevision,outputTokens:256}],
    ['foreign model',{...admission,modelId:'source-only'}],
    ['foreign revision',{...admission,modelRevision:'other-revision'}],
    ['source instead of distribution revision',{...admission,modelRevision:'source-v1'}],
    ['negative omitted',{...admission,omitted:-1}],['fractional omitted',{...admission,omitted:.5}],
    ['unsafe omitted',{...admission,omitted:Number.MAX_SAFE_INTEGER+1}],
    ['NaN omitted',{...admission,omitted:NaN}],['infinite omitted',{...admission,omitted:Infinity}],
    ['string omitted',{...admission,omitted:'0'}],
    ['reserve mismatch',{...admission,outputTokens:255}],['string reserve',{...admission,outputTokens:'256'}],
    ['fractional reserve',{...admission,outputTokens:256.5}],['NaN reserve',{...admission,outputTokens:NaN}],
  ])('rejects %s admission before inference',async(_name,value)=>{
    await boot();await rejected(request({admission:value}));
  });

  it.each([
    ['null',null],['string','messages'],['array-like object',{0:turn('user','latest'),length:1}],
    ['null turn',[null]],['scalar turn',[17]],['tuple turn',[['user','latest']]],
    ['foreign role',[{role:'tool',content:'latest'}]],['missing role',[{content:'latest'}]],
    ['missing content',[{role:'user'}]],['numeric content',[{role:'user',content:17}]],
    ['boxed content',[{role:'user',content:new String('latest')}]],
    ['hole',Array(1)],['leading hole',[,turn('user','latest')]],['trailing hole',[turn('user','latest'),,]],
    ['overbudget scalar',[turn('user','x'.repeat(1633))]],
    ['UTF-8 overflow',[turn('user','あ'.repeat(545))]],
    ['oversized content',[turn('user','x'.repeat(128001))]],
    ['overbudget array',Array.from({length:14},()=>turn('system',''))],
  ])('rejects %s messages without fitting, dropping or truncating them',async(_name,messages)=>{
    await boot();await rejected(request({messages}));
  });

  it('rejects a prototype-provided array position',async()=>{
    await boot();
    const messages=Array<ChatTurn>(1);
    Object.setPrototypeOf(messages,Object.assign(Object.create(Array.prototype),{0:turn('user','latest')}));
    await rejected(request({messages}));
  });

  it('accepts the exact conservative byte boundary without changing the output reserve',async()=>{
    await boot();
    const messages=[turn('user','x'.repeat(1632))]; // 32 + 128 + 1632 + 256 = 2048.
    await send(request({messages}));
    expect(engine.completion).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({messages,max_tokens:256}));
    expect(events(2).at(-1)).toMatchObject({type:'done'});
  });

  it('compares admission against the requested reserve rather than the default',async()=>{
    await boot();await rejected(request({settings:{max_tokens:512}}));
  });

  it.each([null,[],{max_tokens:0},{max_tokens:1025},{max_tokens:256.5},{temperature:NaN},{seed:-1}])(
    'revalidates settings %j before inference',async settings=>{
      await boot();await rejected(request({settings}));
    });

  it('rejects an admission before a model is loaded',async()=>{
    await boot(null);await rejected(request());
  });

  it('rejects the GGUF admission operation on a loaded ONNX model',async()=>{
    await boot('onnx');
    await rejected(request({admission:{...admission,modelId:'onnx',modelRevision:'source-v1'}}));
    expect(engine.tokenize).not.toHaveBeenCalled();
  });

  it('rejects a stale admission after switching the loaded model',async()=>{
    await boot();
    await send({id:3,type:'load',modelId:'source-only',cpu:true,base:origin+'/'});
    expect(events(3)).toEqual([{id:3,type:'done',backend:'WASM CPU'}]);
    expect(engine.exit).toHaveBeenCalledTimes(1);
    await rejected(request());
  });

  it('unloads the GGUF and rejects further admissions until another load',async()=>{
    await boot();await send({id:3,type:'unload'});
    expect(engine.exit).toHaveBeenCalledTimes(1);expect(events(3)).toEqual([{id:3,type:'done'}]);
    await rejected(request());
    await send({id:4,type:'load',modelId:'fixture',cpu:true,base:origin+'/'});
    await send(request({id:5}));
    expect(engine.completion).toHaveBeenCalledTimes(1);expect(events(5).at(-1)).toMatchObject({type:'done'});
  });

  it('blocks concurrent operations, stops an admitted stream and clears busy for the next request',async()=>{
    await boot();
    let release!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    engine.completion.mockImplementationOnce(async(options:Packet)=>(async function*(){
      yield {choices:[{delta:{content:'partial'}}]};
      await gate;options.abortSignal.throwIfAborted();
      yield {choices:[{delta:{content:'should not escape'}}]};
    })());
    const running=send(request());
    try {
      await vi.waitFor(()=>expect(events(2)).toContainEqual({id:2,type:'delta',text:'partial'}),{timeout:1000});
      for(const [index,type] of ['generate','generate-admitted','load','unload'].entries()) {
        const id=10+index;await send(request({id,type,modelId:'source-only',cpu:true,base:origin+'/'}));
        expect(events(id)).toEqual([{id,type:'error',error:'処理中です。停止してから操作してください。'}]);
      }
      expect(engine.load).toHaveBeenCalledTimes(1);expect(engine.exit).not.toHaveBeenCalled();
      expect(engine.completion).toHaveBeenCalledTimes(1);
      await send({type:'stop'});
      expect(engine.completion.mock.calls[0][0].abortSignal.aborted).toBe(true);
    } finally {release();await running;}
    expect(events(2)).toEqual([{id:2,type:'context',omitted:0},{id:2,type:'delta',text:'partial'},
      {id:2,type:'done',stopped:true}]);
    await send(request({id:20}));
    expect(engine.completion).toHaveBeenCalledTimes(2);expect(events(20).at(-1)).toMatchObject({type:'done',measurement:{outputTokens:3}});
  });

  it('recovers after a rejected admission without changing the next valid request',async()=>{
    await boot();await rejected(request({admission:{...admission,omitted:-1}}));
    await send(request({id:3}));
    expect(engine.completion).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({messages:[turn('user','Hello')],max_tokens:256}));
    expect(events(3).at(-1)).toMatchObject({type:'done'});
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
