/// <reference lib="webworker" />
import type { ChatTurn, MobileModel, Measurement } from './types';
import { CONTEXT_TOKENS } from './types';
import { fitContext, mergeTurns } from './context';
import { MODELS, openModelFile, readyModels } from './models';
import { sampling, ggufSampling } from './sampling';

const ctx=self as unknown as DedicatedWorkerGlobalScope;
let model:MobileModel|null=null;
let gguf:import('@wllama/wllama').Wllama|null=null;
let onnx:any=null;
let tokenizer:any=null;
let stopper:any=null;
let abort:AbortController|null=null;
let busy=false;
let backend='';
let runtimeVariant='';
let loadMs=0;
let pleLazy:boolean|null=null;
const send=(id:number,type:string,data:Record<string,unknown>={})=>ctx.postMessage({id,type,...data});

async function unload() {
  abort?.abort();stopper?.interrupt();
  if(gguf)await gguf.exit();if(onnx)await onnx.dispose();
  gguf=null;onnx=null;tokenizer=null;model=null;stopper=null;pleLazy=null;
}
async function load(modelId:string,cpu:boolean,base:string) {
  await unload();
  if(new URL(base).origin!==ctx.location.origin)throw Error('実行ファイルの配布元が不正です。');
  const candidate=MODELS.find(m=>m.id===modelId);
  if(!candidate||!(await readyModels()).has(modelId))throw Error('先にモデルをダウンロードして保存してください。');
  const start=performance.now();
  if(candidate.runtime==='gguf') {
    const {Wllama}=await import('@wllama/wllama');
    let memory64=false;
    try {new WebAssembly.Memory({address:'i64',initial:1n} as any);memory64=true;}catch{}
    const compat=!(typeof (WebAssembly as any).Suspending==='function'&&memory64);
    runtimeVariant=compat?'compat':'standard';
    const root=new URL(`runtime/${compat?'compat':'standard'}/`,base);
    const js=await fetch(new URL('wllama.js',root),{cache:'no-cache'});
    if(!js.ok)throw Error('推論の実行ファイルが保存されていません。オンラインでアプリを更新してください。');
    const code=await js.text();
    gguf=new Wllama({default:new URL('wllama.wasm',root).href},{allowOffline:true,logger:{debug:()=>{},log:()=>{},warn:console.warn,error:console.error}});
    // Custom JS and Wasm must match; the npm-embedded JS cannot load a rebuilt binary.
    gguf.getWorkerResources=()=>({wasmPath:new URL('wllama.wasm',root).href,jsPath:{code},compat});
    const blobs:File[]=[];
    for(const file of candidate.files)blobs.push(await openModelFile(candidate,file));
    const gpu=await (navigator as any).gpu?.requestAdapter();
    backend=cpu||!gpu?'WASM CPU':'WebGPU';
    await gguf.loadModel(blobs,{n_ctx:CONTEXT_TOKENS,n_parallel:1,n_batch:128,n_ubatch:64,n_gpu_layers:backend==='WebGPU'?99999:0,
      n_threads:1,reasoning:false,jinja:true,default_template_kwargs:{enable_thinking:false},ctx_shift:false});
    const debug=await gguf._getDebugInfo();
    pleLazy=debug?.pleLazy===true;
    if(debug?.plePresent!==false&&!pleLazy)throw Error('PLEの行読み込みを確認できません。重み全体を常駐させる経路は使用しません。');
  } else {
    const adapter=await (navigator as any).gpu?.requestAdapter();
    if(!adapter?.features.has('shader-f16'))throw Error('Mobile ONNX版にはWebGPUとshader-f16が必要です。GGUF版を選んでください。');
    const t=await import('@huggingface/transformers');
    t.env.allowLocalModels=true;t.env.allowRemoteModels=false;t.env.useBrowserCache=false;t.env.useFSCache=false;t.env.useCustomCache=true;
    t.env.customCache={
      async match(url:string) {
        const f=candidate.files.find(f=>f.url===url||url.endsWith(`/${candidate.repo}/${f.path}`)||url===`${candidate.repo}/${f.path}`);
        if(!f)return undefined;
        const file=await openModelFile(candidate,f);
        return new Response(file.stream(),{headers:{'Content-Length':String(file.size),'Content-Type':f.path.endsWith('.json')?'application/json':'application/octet-stream'}});
      },
      async put(){throw Error('モデルは検証済みの端末保存からのみ読み込みます。');},
    };
    // The build copies all required ORT files here; no runtime CDN download.
    t.env.backends.onnx.wasm!.wasmPaths=new URL('ort/',base).href;
    t.env.backends.onnx.wasm!.numThreads=1;
    tokenizer=await t.AutoTokenizer.from_pretrained(candidate.repo,{revision:candidate.revision,local_files_only:true});
    const template=candidate.files.find(f=>f.path==='chat_template.jinja');
    if(template)tokenizer.chat_template=await (await openModelFile(candidate,template)).text();
    onnx=await t.AutoModelForCausalLM.from_pretrained(candidate.repo,{revision:candidate.revision,local_files_only:true,device:'webgpu',
      dtype:{embed_tokens:'q2f16',decoder_model_merged:'q2f16'}});
    stopper=new t.InterruptableStoppingCriteria();backend='ONNX WebGPU';runtimeVariant='onnx';
  }
  model=candidate;loadMs=performance.now()-start;
}

async function generate(id:number,turns:ChatTurn[],settings:Record<string,unknown>={}) {
  if(!model)throw Error('モデルを読み込んでください。');
  abort=new AbortController();
  if(!Array.isArray(turns)||turns.some(t=>!t||!['system','user','assistant'].includes(t.role)||typeof t.content!=='string'||t.content.length>128000))throw Error('会話データが不正です。');
  const active=model,start=performance.now();let first:number|null=null,outputTokens:number|null=null;
  const {applied}=sampling(active,settings);
  const count=tokenizer?(messages:ChatTurn[])=>tokenizer.apply_chat_template(messages,{tokenize:true,add_generation_prompt:true,enable_thinking:false}).length:undefined;
  const fitted=await fitContext(mergeTurns(turns),count,applied.max_tokens);
  abort.signal.throwIfAborted();
  send(id,'context',{omitted:fitted.omitted});
  if(gguf) {
    const stream=await gguf.createChatCompletion({messages:fitted.messages,stream:true,...ggufSampling(applied),
      abortSignal:abort.signal,chat_template_kwargs:{enable_thinking:false},cache_prompt:true});
    for await(const chunk of stream) {
      const text=chunk.choices?.[0]?.delta?.content;
      if(text){first??=performance.now()-start;send(id,'delta',{text});}
      if(chunk.usage)outputTokens=chunk.usage.completion_tokens;
      if(chunk.timings)outputTokens=chunk.timings.predicted_n;
    }
  } else {
    const {TextStreamer}=await import('@huggingface/transformers');
    stopper.reset();
    const inputs=tokenizer.apply_chat_template(fitted.messages,{tokenize:true,return_dict:true,add_generation_prompt:true,enable_thinking:false});
    const streamer=new TextStreamer(tokenizer,{skip_prompt:true,skip_special_tokens:true,callback_function:(text:string)=>{
      if(text){first??=performance.now()-start;send(id,'delta',{text});}
    }});
    const out=await onnx.generate({...inputs,max_new_tokens:applied.max_tokens,do_sample:applied.temperature>0,...(applied.temperature>0?{temperature:applied.temperature,top_k:applied.top_k,top_p:applied.top_p}:{}),
      stopping_criteria:stopper,streamer});
    outputTokens=out.dims[1]-inputs.input_ids.dims[1];
  }
  const debug=gguf?await gguf._getDebugInfo():null;
  const generationMs=performance.now()-start;
  const measurement:Measurement={modelId:active.id,revision:active.distributionRevision??active.revision,backend,runtimeVariant,userAgent:navigator.userAgent,
    contextTokens:CONTEXT_TOKENS,loadMs,firstTokenMs:first,generationMs,outputTokens,tokensPerSecond:outputTokens===null?null:outputTokens/(generationMs/1000),
    wasmBytes:debug?.wasmBytes??null,gpuBytes:null,kvBytes:null,physicalBytes:null,residentWeightBytes:null,pleLazy,
    weightBufferBytes:debug?.weightBufferBytes??null,pleBytesRead:debug?.pleBytesRead??null};
  return {measurement};
}
ctx.onmessage=async({data})=>{
  if(data.type==='stop'){abort?.abort();stopper?.interrupt();return;}
  const {id,type}=data;
  if(busy){send(id,'error',{error:'処理中です。停止してから操作してください。'});return;}
  busy=true;
  try {
    let result:Record<string,unknown>={};
    if(type==='load'){await load(data.modelId,data.cpu,data.base);result={backend};}
    else if(type==='unload')await unload();
    else if(type==='generate')result=await generate(id,data.messages,data.settings);
    else throw Error('未対応の推論操作');
    send(id,'done',result);
  } catch(e) {
    if(type==='load')await unload().catch(()=>{});
    if(abort?.signal.aborted&&type==='generate')send(id,'done',{stopped:true});
    else send(id,'error',{error:e instanceof Error?e.message:String(e)});
  } finally {busy=false;}
};
