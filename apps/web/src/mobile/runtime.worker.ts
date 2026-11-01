/// <reference lib="webworker" />
import type { ChatTurn, MobileModel, Measurement } from './types';
import { CONTEXT_TOKENS } from './types';
import { conservativeTokens, fitContext, mergeTurns, validateTurns } from './context';
import type { GGUFRun } from './context';
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
type Fence={modelId:string;modelRevision:string;outputTokens:number};
type Admission=Fence&{originalRuns:number;newestUserRun:number};
type WindowPacket={admission:Fence;history?:GGUFRun[];error?:string};
let operation:{id:number;window?:{resolve:(packet:WindowPacket)=>void;reject:(error:Error)=>void}}|null=null;
const send=(id:number,type:string,data:Record<string,unknown>={})=>ctx.postMessage({id,type,...data});
const checkpoint=async(signal:AbortSignal)=>{await new Promise(resolve=>setTimeout(resolve,0));signal.throwIfAborted();};
function checkFence(value:Fence,applied:Record<string,number>) {
  if(!model||model.runtime!=='gguf'||!gguf||!value||typeof value!=='object'||Array.isArray(value)
    ||value.modelId!==model.id||value.modelRevision!==(model.distributionRevision??model.revision)||value.outputTokens!==applied.max_tokens)throw Error('Invalid GGUF admission');
}
function checkRuns(value:GGUFRun[],admission:Admission,mandatory:boolean) {
  if(!Array.isArray(value))throw Error('Invalid GGUF runs');
  let previous=-1,tail=0;
  for(let i=0;i<value.length;i++){
    const run=value[i];
    if(!Object.hasOwn(value,i)||!run||!Number.isSafeInteger(run.run)||run.run<=previous||run.run>=admission.originalRuns
      ||!['system','user','assistant'].includes(run.role)||typeof run.content!=='string')throw Error('Invalid GGUF runs');
    previous=run.run;
    const required=run.role==='system'||admission.newestUserRun<0||run.run>=admission.newestUserRun;
    if(required!==mandatory||run.role==='user'&&run.run>admission.newestUserRun)throw Error('Invalid GGUF run boundary');
    if(run.run>=admission.newestUserRun)tail++;
    if(run.run===admission.newestUserRun&&run.role!=='user')throw Error('Invalid GGUF newest user');
  }
  if(mandatory&&tail!==(admission.newestUserRun<0?admission.originalRuns:admission.originalRuns-admission.newestUserRun))throw Error('Incomplete GGUF mandatory tail');
}
function ggufChatOptions(messages:ChatTurn[],applied:Record<string,number>,responseGrammar:string|undefined,signal:AbortSignal) {
  return {messages,stream:true as const,...ggufSampling(applied),
    ...(responseGrammar?{grammar:responseGrammar,reasoning_budget_tokens:0,reasoning_format:'none' as const}:{}),
    abortSignal:signal,chat_template_kwargs:{enable_thinking:false},cache_prompt:true};
}
async function fitGGUF(id:number,mandatory:GGUFRun[],admission:Admission,applied:Record<string,number>,grammar:string|undefined,signal:AbortSignal) {
  checkFence(admission,applied);
  if(!Number.isSafeInteger(admission.originalRuns)||admission.originalRuns<1||!Number.isSafeInteger(admission.newestUserRun)
    ||admission.newestUserRun< -1||admission.newestUserRun>=admission.originalRuns)throw Error('Invalid GGUF admission boundary');
  checkRuns(mandatory,admission,true);
  const engine=gguf!;
  if(!('countChatTokens' in engine)||typeof engine.countChatTokens!=='function')throw Error('Native count SDK is required; update matched runtime assets.');
  const countChatTokens=engine.countChatTokens.bind(engine);
  const checkCount=(value:unknown)=>{
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('Invalid native token count');
    return value;
  };
  let mandatoryInputTokens:unknown,mandatoryCountError:string|undefined;
  signal.throwIfAborted();
  try{mandatoryInputTokens=await countChatTokens(ggufChatOptions(mandatory.map(({role,content})=>({role,content})),applied,grammar,signal));}
  catch(error){signal.throwIfAborted();mandatoryCountError=error instanceof Error?error.message:String(error);}
  signal.throwIfAborted();
  if(mandatoryCountError===undefined)mandatoryInputTokens=checkCount(mandatoryInputTokens);
  await checkpoint(signal);
  const packet=await new Promise<WindowPacket>((resolve,reject)=>{
    const stop=()=>reject(Error('Generation stopped'));
    operation!.window={resolve:packet=>{signal.removeEventListener('abort',stop);resolve(packet);},
      reject:error=>{signal.removeEventListener('abort',stop);reject(error);}};
    signal.addEventListener('abort',stop,{once:true});
    send(id,'admission-count',mandatoryCountError===undefined?{mandatoryInputTokens}:{mandatoryCountError});
  });
  signal.throwIfAborted();checkFence(packet.admission,applied);
  if(Object.hasOwn(packet,'history')===Object.hasOwn(packet,'error'))throw Error('Invalid GGUF window');
  if(Object.hasOwn(packet,'error')){
    if(typeof packet.error!=='string')throw Error('Invalid GGUF window error');
    throw Error(packet.error);
  }
  const history=packet.history!;
  checkRuns(history,admission,false);
  const requiredIds=new Set(mandatory.map(run=>run.run));
  if(history.some(run=>requiredIds.has(run.run)))throw Error('Overlapping GGUF runs');
  const budget=CONTEXT_TOKENS-applied.max_tokens;
  if(conservativeTokens(history)-32>budget)throw Error('Invalid GGUF history window');
  const runs=[...mandatory,...history].sort((a,b)=>a.run-b.run);
  while(true){
    signal.throwIfAborted();
    // Never re-merge systems that became adjacent after omission.
    const options=ggufChatOptions(runs.map(({role,content})=>({role,content})),applied,grammar,signal);
    const inputTokens=checkCount(await countChatTokens(options));
    signal.throwIfAborted();
    if(inputTokens<=budget){await checkpoint(signal);return {messages:options.messages,options,omitted:admission.originalRuns-runs.length,inputTokens};}
    const index=runs.findIndex(run=>run.role!=='system'&&run.run<admission.newestUserRun);
    if(index<0)throw Error('キャラ設定またはメッセージが長すぎます。短くして再送してください。');
    runs.splice(index,1);
    while(runs[index]?.role==='assistant'&&runs[index].run<admission.newestUserRun)runs.splice(index,1);
    await checkpoint(signal);
  }
}

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

async function generate(id:number,turns:ChatTurn[],settings:Record<string,unknown>={},responseGrammar?:string,admitted=false,admission?:Admission) {
  if(!model)throw Error('モデルを読み込んでください。');
  abort=new AbortController();
  operation={id};
  if(model.runtime==='gguf'&&!admitted)throw Error('GGUF requires native admission');
  if(!admitted)validateTurns(turns);
  const active=model,start=performance.now();let first:number|null=null,outputTokens:number|null=null;
  const {applied}=sampling(active,settings);
  const count=tokenizer?(messages:ChatTurn[])=>tokenizer.apply_chat_template(messages,{tokenize:true,add_generation_prompt:true,enable_thinking:false}).length:undefined;
  let fitted:{messages:ChatTurn[];omitted:number},options:ReturnType<typeof ggufChatOptions>|undefined;
  if(admitted){
    const native=await fitGGUF(id,turns as GGUFRun[],admission!,applied,responseGrammar,abort.signal);
    fitted=native;options=native.options;
  }else fitted=await fitContext(mergeTurns(turns),count,applied.max_tokens);
  abort.signal.throwIfAborted();
  send(id,'context',{omitted:fitted.omitted});
  if(gguf) {
    const stream=await gguf.createChatCompletion(options!);
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
    contextTokens:CONTEXT_TOKENS,structuredOutput:responseGrammar?(gguf?'grammar':'prompt'):'text',loadMs,firstTokenMs:first,generationMs,outputTokens,tokensPerSecond:outputTokens===null?null:outputTokens/(generationMs/1000),
    wasmBytes:debug?.wasmBytes??null,gpuBytes:null,kvBytes:null,physicalBytes:null,residentWeightBytes:null,pleLazy,
    weightBufferBytes:debug?.weightBufferBytes??null,pleBytesRead:debug?.pleBytesRead??null};
  return {measurement};
}
ctx.onmessage=async({data})=>{
  if(data.type==='stop'){
    if(operation&&(data.id===operation.id||data.id===undefined&&model?.runtime==='onnx')){abort?.abort();stopper?.interrupt();}
    return;
  }
  const {id,type}=data;
  if(type==='admission-window'){
    const current=operation;
    if(current&&current.id===id&&current.window){const waiter=current.window;current.window=undefined;waiter.resolve(data);}
    return;
  }
  if(busy){send(id,'error',{error:'処理中です。停止してから操作してください。'});return;}
  busy=true;
  try {
    let result:Record<string,unknown>={};
    if(type==='load'){await load(data.modelId,data.cpu,data.base);result={backend};}
    else if(type==='unload')await unload();
    else if(type==='generate'||type==='generate-admitted')result=await generate(id,type==='generate-admitted'?data.mandatory:data.messages,data.settings,data.responseGrammar,type==='generate-admitted',data.admission);
    else throw Error('未対応の推論操作');
    send(id,'done',result);
  } catch(e) {
    if(type==='load')await unload().catch(()=>{});
    if(abort?.signal.aborted&&(type==='generate'||type==='generate-admitted'))send(id,'done',{stopped:true});
    else send(id,'error',{error:e instanceof Error?e.message:String(e)});
  } finally {
    operation?.window?.reject(Error('Generation ended'));operation=null;abort=null;busy=false;
  }
};
