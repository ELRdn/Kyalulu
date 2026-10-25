import { ExperimentMetaSchema, RuntimeStateSchema, ScenarioCardSchema, MemoryOptionsSchema, BenchmarkRequestSchema } from '../../../../packages/schemas/src';
import catalog from '../mobile/app-catalog.generated.json';
import { MODELS, readyModels } from '../mobile/models';
import { sampling } from '../mobile/sampling';
import { appTransaction, getMeta, newEntity, type AppEntity } from './appStore';
import { deviceOwner, generationBusy, setGenerationBusy } from './appContext';
import { compilePortable } from './devicePrompt';
import { computeDeviceMetrics, memoryMetrics, memoryProbe, metricRound } from './deviceMetrics';
import { SSEDecoder } from './sse';

type Value=Record<string,any>;
type Prompt=ReturnType<typeof compilePortable>;
export type ResearchTurn={session:AppEntity;prompt:Prompt;requested?:Value;memoryOptions:Value;save:(session:AppEntity)=>Promise<AppEntity>};
type Generate=(body:Value,signal:AbortSignal|undefined,scope:ResearchTurn)=>Promise<Response>;
type Compile=(settings:Value,history:{role:string;content:string}[],owner:string)=>Promise<Prompt>;
type Experiment={meta:Value;turns:Value[];raw_prompt:string;session:AppEntity;revision:number;job_id?:string};
const official:Record<string,string>={mocha_daily_001:'mocha_sfw',senior_daily_001:'senior_cool',butler_daily_001:'butler'};
let active:{owner:string;request:string;controller:AbortController}|null=null;
export const deviceResearchBusy=()=>active!==null;
const prefix=(owner:string)=>'device-research:'+JSON.stringify(owner)+':';
const key=(owner:string,kind:string,id='')=>prefix(owner)+kind+':'+id;
const fail=(message:string,status=400)=>Object.assign(Error(message),{status});
const ownerCheck=(owner:string)=>{if(owner!==deviceOwner())throw fail('Account changed',409);};
const identifier=(id:unknown)=>{if(typeof id!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))throw fail('Invalid research ID');return id;};
const integer=(value:unknown,fallback:number,min:number,max:number)=>{const n=value??fallback;if(!Number.isSafeInteger(n)||(n as number)<min||(n as number)>max)throw fail('Invalid research number');return n as number;};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
async function exclusive<T>(owner:string,id:string,signal:AbortSignal|undefined,task:(controller:AbortController)=>Promise<T>) {
  if(!navigator.locks)throw fail('Web Locks are required for on-device research',503);
  return navigator.locks.request(key(owner,'lock'),{ifAvailable:true},async lock=>{
    if(!lock||generationBusy()||active)throw fail('A generation is already running',409);
    ownerCheck(owner);signal?.throwIfAborted();
    const controller=new AbortController(),abort=()=>controller.abort(),changed=()=>{if(deviceOwner()!==owner)controller.abort('account_changed');};
    active={owner,request:id,controller};setGenerationBusy(true);signal?.addEventListener('abort',abort,{once:true});
    if(typeof window!=='undefined'){window.addEventListener('kyalulu-app-context',changed);window.addEventListener('storage',changed);}
    try{return await task(controller);}
    finally{
      signal?.removeEventListener('abort',abort);
      if(typeof window!=='undefined'){window.removeEventListener('kyalulu-app-context',changed);window.removeEventListener('storage',changed);}
      active=null;setGenerationBusy(false);
    }
  });
}
async function list<T>(owner:string,kind:string) {
  const start=key(owner,kind);
  const result=await appTransaction<T[]>(['meta'],'readonly',(tx,done)=>{const r=tx.objectStore('meta').getAll(IDBKeyRange.bound(start,start+'\uffff'));r.onsuccess=()=>done(r.result);});
  ownerCheck(owner);return result;
}
async function write(owner:string,kind:string,id:string,value:Value) {
  return appTransaction<number>(['meta'],'readwrite',(tx,done)=>{
    const store=tx.objectStore('meta'),r=store.get(key(owner,kind,id));
    r.onsuccess=()=>{
      if(owner!==deviceOwner()||(r.result?.revision??0)!==value.revision){tx.abort();return;}
      const revision=value.revision+1;store.put({...value,revision},key(owner,kind,id));done(revision);
    };
  });
}
async function read(owner:string,id:string) {
  identifier(id);const record=await getMeta<Experiment>(key(owner,'experiment',id));ownerCheck(owner);
  if(!record)throw fail('Experiment not found',404);return record;
}
async function detail(owner:string,id:string) {
  const record=await read(owner,id),ratings=await getMeta<Value>(key(owner,'ratings',id));ownerCheck(owner);
  return {meta:record.meta,turns:record.turns,raw_prompt:record.raw_prompt,ratings:ratings??{},metrics:record.meta.metrics};
}
async function recover(owner:string) {
  if(!navigator.locks)throw fail('Web Locks are required for on-device research',503);
  await navigator.locks.request(key(owner,'lock'),{ifAvailable:true},async lock=>{
    if(!lock)return;
    const experiments=await list<Experiment>(owner,'experiment');
    for(const record of experiments)if(record.meta.status==='running'){
      record.meta.status='interrupted';record.meta.metrics??=computeDeviceMetrics(record.turns);record.revision=await write(owner,'experiment',record.meta.experiment_id,record);
    }
    for(const record of await list<Value>(owner,'request'))if(record.status==='running'){
      record.status='interrupted';record.revision=await write(owner,'request',record.id,record);
    }
    for(const job of await list<Value>(owner,'benchmark'))if(['queued','running'].includes(job.status)){
      const results=new Map(job.results.map((r:Value)=>[r.experiment_id,r]));
      for(const record of experiments.filter(e=>e.job_id===job.id))results.set(record.meta.experiment_id,record.meta);
      job.status='interrupted';job.finished_at=new Date().toISOString();job.results=[...results.values()];
      await updateJob(owner,job.id,()=>job);
    }
  });
}
function request(body:Value) {
  if(typeof body.scenario!=='string'||!catalog.scenarios.some(s=>s.id===body.scenario))throw fail('Choose a bundled SFW scenario',404);
  if(typeof body.model_id!=='string'||!MODELS.some(m=>m.id===body.model_id))throw fail('Unknown on-device model',404);
  if(body.allow_nsfw!==undefined&&typeof body.allow_nsfw!=='boolean'||body.memory!==undefined&&typeof body.memory!=='boolean')throw fail('Invalid research flags');
  if(body.allow_nsfw)throw fail('Adult verification required',403);
  if(body.temperature!==undefined&&(typeof body.temperature!=='number'||!Number.isFinite(body.temperature)||body.temperature<0||body.temperature>2))throw fail('Invalid temperature');
  if(body.extra_system_prompt!==undefined&&(typeof body.extra_system_prompt!=='string'||body.extra_system_prompt.length>128000))throw fail('Invalid research prompt');
  return {scenario:body.scenario,model_id:body.model_id,runs:integer(body.runs,1,1,3),memory:body.memory??false,
    ...(body.temperature===undefined?{}:{temperature:body.temperature}),...(body.seed==null?{}:{seed:integer(body.seed,0,0,2**32-1)}),
    extra_system_prompt:body.extra_system_prompt??''};
}
const modelIdentity=(model:Value)=>JSON.stringify([model.id,model.runtime,model.repo,model.revision,model.distributionRevision??null,model.files]);
async function runOne(owner:string,req:Value,number:number,signal:AbortSignal,generate:Generate,compile:Compile,source?:Experiment,progress?:(record:Experiment)=>Promise<void>) {
  const expired=()=>req.deadline_at!==undefined&&Date.now()>=req.deadline_at;
  const check=()=>{signal.throwIfAborted();if(expired())throw new DOMException('Run time limit reached','TimeoutError');};
  check();ownerCheck(owner);
  const scenario=ScenarioCardSchema.parse(source?.meta.scenario_snapshot??catalog.scenarios.find(s=>s.id===req.scenario));
  if(scenario.nsfw||scenario.turns.length>100)throw fail('Choose a bounded SFW scenario');
  const model=MODELS.find(m=>m.id===req.model_id)!;
  if(source&&modelIdentity(model)!==modelIdentity(source.meta.model_config_snapshot))throw fail('The recorded model files changed; replay is unavailable',409);
  const id=crypto.randomUUID(),settings={session_id:'exp:'+id,character_id:scenario.character,persona_id:scenario.persona,world_id:scenario.world,system_prompt:req.extra_system_prompt,temperature:req.temperature??model.temperature};
  const savedPrompt=source?.turns.find(t=>t.compiled)?.compiled.sections.portable_snapshot;
  if(source&&!savedPrompt)throw fail('A saved prompt is required for replay',409);
  const initial=source?compilePortable(savedPrompt):await compile(settings,[],owner);
  if((initial.sections.portable_snapshot.document as Value)?.nsfw)throw fail('Adult verification required',403);
  const requested=source?Object.fromEntries(Object.entries({...source.meta.generation_config.applied,...source.meta.generation_config.requested}).filter(([k])=>k!=='model_id')):undefined;
  const memoryOptions=MemoryOptionsSchema.parse(source?.meta.memory_options??req.memory_options??{});
  const historyLimit=source?.meta.history_turn_limit??req.history_turn_limit??null;
  if(historyLimit!==null)integer(historyLimit,0,1,100);
  const meta=ExperimentMetaSchema.parse({experiment_id:id,model_id:model.id,model_version:model.revision,quantization:model.runtime,provider:'browser',
    character_id:scenario.character,character_version:initial.character_version,persona_id:scenario.persona,world_id:scenario.world,prompt_version:initial.prompt_version,
    scenario_id:scenario.id,scenario_version:scenario.version,run_number:number,seed:req.seed??null,timestamp:new Date().toISOString(),turns:scenario.turns.length,status:'running',
    generation_config:sampling(model,requested??{temperature:settings.temperature,...(req.seed==null?{}:{seed:req.seed})}),
    hardware_metadata:{userAgent:navigator.userAgent,provider_backend:model.runtime},scenario_snapshot:scenario,model_config_snapshot:structuredClone(model),extra_system_prompt:req.extra_system_prompt,
    memory_enabled:req.memory,memory_options:memoryOptions,history_turn_limit:historyLimit,official:!req.memory&&!req.extra_system_prompt&&!historyLimit&&official[scenario.id]===scenario.character&&JSON.stringify(scenario)===JSON.stringify(ScenarioCardSchema.parse(catalog.scenarios.find(s=>s.id===scenario.id)))});
  let record:Experiment={meta,turns:[],raw_prompt:initial.system_prompt,revision:0,...(req.job_id?{job_id:req.job_id}:{}),session:newEntity('conversation',settings.session_id,{storage_policy:'local',rating:'general',settings,messages:[],memories:[],summaries:[],state:RuntimeStateSchema.parse(settings),memory_enabled:req.memory},owner)};
  const persist=async()=>{record.revision=await write(owner,'experiment',id,record);};
  const metrics=(target=record)=>{target.meta.metrics=computeDeviceMetrics(target.turns);if(req.memory||scenario.turns.some(t=>t.expect_recall.length||t.forbid_recall.length))target.meta.metrics.memory=memoryMetrics(target.turns);};
  metrics();await persist();await progress?.(record);
  for(const turn of [...scenario.turns].sort((a,b)=>a.turn-b.turn)) {
    let context='';const started=performance.now();
    try{
      check();ownerCheck(owner);
      if(turn.new_session)record.session={...record.session,payload:{...record.session.payload,messages:[],state:RuntimeStateSchema.parse({...settings,session_id:crypto.randomUUID()})}};
      if(historyLimit)record.session={...record.session,payload:{...record.session.payload,messages:record.session.payload.messages.slice(-historyLimit*2)}};
      context=record.session.payload.messages.map((m:Value)=>m.content).join('\n');
      const stored=structuredClone(record.session.payload.memories),history=[...record.session.payload.messages,{role:'user',content:turn.user}];
      const prompt=compilePortable(initial.sections.portable_snapshot,history);
      const generationId=crypto.randomUUID();
      const scope:ResearchTurn={session:record.session,prompt,requested,memoryOptions,save:async value=>{
        const session={...value,revision:record.session.revision+1},next={...record,session,meta:{...record.meta},turns:[...record.turns]};
        const done=value.payload.pending_generation===null?value.payload.last_generation:null;
        if(done?.generation_id===generationId&&!next.turns.some(t=>t.generation_id===generationId)){
          check();
          const result:Value={...done,turn:turn.turn,type:turn.type,user:turn.user,assistant:done.reply,status:'completed',new_session:turn.new_session,elapsed_ms:performance.now()-started};
          if(turn.expect_recall.length||turn.forbid_recall.length)result.probe=memoryProbe(turn.expect_recall,turn.forbid_recall,done.reply,context,stored,done.memory);
          next.turns.push(result);next.meta.generation_config=done.generation_config;
          if(next.turns.length===scenario.turns.length)next.meta.status='completed';
          metrics(next);
        }
        next.revision=await write(owner,'experiment',id,next);record=next;return session;
      }};
      const response=await generate({session_id:settings.session_id,generation_id:generationId,model_id:model.id,messages:[{role:'user',content:turn.user}],
        temperature:settings.temperature,...(req.seed==null?{}:{seed:req.seed})},signal,scope);
      if(!response.ok)throw Error((await response.json()).error??'Generation failed');
      const decoder=new SSEDecoder(),reader=response.body!.getReader(),utf8=new TextDecoder();let done:Value|undefined,error='';
      try{while(true){const chunk=await reader.read();for(const event of decoder.feed(utf8.decode(chunk.value,{stream:!chunk.done}),chunk.done)){
        if(event.event==='done')done=JSON.parse(event.data);if(event.event==='error')error=JSON.parse(event.data).error;
      }if(chunk.done)break;}}finally{reader.releaseLock();}
      if(!done)throw Error(error||'Generation ended without a saved result');
      check();ownerCheck(owner);
      if(!record.turns.some(t=>t.generation_id===generationId))throw Error('The research result was not saved');
    }catch(error){
      ownerCheck(owner);
      if(record.meta.status!=='completed')record.meta.status=signal.aborted||expired()?'cancelled':'failed';
      if(!record.turns.some(t=>t.turn===turn.turn))record.turns.push({turn:turn.turn,type:turn.type,user:turn.user,assistant:'',status:record.meta.status,error:String(error),elapsed_ms:performance.now()-started});
    }
    metrics();await persist();await progress?.(record);if(record.meta.status!=='running')break;
  }
  if(record.meta.status==='running')record.meta.status='completed';metrics();await persist();return {experiment_id:id,meta:record.meta};
}
async function run(owner:string,body:Value,signal:AbortSignal|undefined,generate:Generate,compile:Compile,source?:Experiment) {
  const req=request(body),id=body.request_id===undefined?crypto.randomUUID():identifier(body.request_id),fingerprint=JSON.stringify([req,source?.meta.experiment_id??null]);
  return exclusive(owner,id,signal,async controller=>{
    ownerCheck(owner);signal?.throwIfAborted();
    let receipt=await getMeta<Value>(key(owner,'request',id));ownerCheck(owner);
    if(receipt){
      if(receipt.fingerprint!==fingerprint)throw fail('Research request changed',409);
      if(receipt.status==='completed')return json({results:receipt.results});
      throw fail('This research request was interrupted; review its saved experiments before starting another',409);
    }
    if(!(await readyModels()).has(req.model_id))throw fail('Prepare this model in Settings / 設定からモデルを準備してください',409);
    ownerCheck(owner);controller.signal.throwIfAborted();
    receipt={id,fingerprint,status:'running',results:[],revision:0};receipt.revision=await write(owner,'request',id,receipt);
    for(let n=1;n<=req.runs;n++){
      const result=await runOne(owner,req,n,controller.signal,generate,compile,source);receipt.results.push(result);
      receipt.revision=await write(owner,'request',id,receipt);if(result.meta.status!=='completed'||controller.signal.aborted)break;
    }
    receipt.status='completed';receipt.revision=await write(owner,'request',id,receipt);return json({results:receipt.results});
  });
}
const benchmarkTasks=new Map<string,Promise<unknown>>();
async function updateJob(owner:string,id:string,make:(current:Value|undefined)=>Value) {
  return appTransaction<Value>(['meta'],'readwrite',(tx,done)=>{
    const store=tx.objectStore('meta'),read=store.get(key(owner,'benchmark',id));
    read.onsuccess=()=>{
      try{
        const current=read.result,next=make(current);
        if(owner!==deviceOwner()||next.id!==id||current&&JSON.stringify(current.request)!==JSON.stringify(next.request)){tx.abort();return;}
        const value={...next,revision:(current?.revision??0)+1,cancel_requested:!!(current?.cancel_requested||next.cancel_requested)};
        store.put(value,key(owner,'benchmark',id));done(value);
      }catch{tx.abort();}
    };
  });
}
async function readJob(owner:string,id:string) {
  id=identifier(id).toLowerCase();const job=await getMeta<Value>(key(owner,'benchmark',id));ownerCheck(owner);
  if(!job)throw fail('Benchmark not found',404);return job;
}
const publicJob=({revision,...job}:Value)=>job;
function prepareBenchmark(body:Value) {
  const req=BenchmarkRequestSchema.parse(body);req.request_id=req.request_id.toLowerCase();
  integer(req.seed,42,0,2**32-req.runs);
  for(const model of req.model_ids)if(!MODELS.some(m=>m.id===model))throw fail('Unknown on-device model',404);
  const scenarios=req.scenarios.map(id=>{const scenario=catalog.scenarios.find(s=>s.id===id);if(!scenario)throw fail('Scenario not found',404);return ScenarioCardSchema.parse(scenario);});
  if(scenarios.some(s=>s.nsfw||s.turns.length>100))throw fail('Choose a bounded SFW scenario');
  const arms=req.memory==='compare'?[false,true]:[req.memory==='on'];
  const matrix=req.model_ids.flatMap(model_id=>scenarios.flatMap(scenario=>Array.from({length:req.runs},(_,i)=>{
    const run=i+1;return (run%2?arms:[...arms].reverse()).map(memory=>({model_id,scenario:scenario.id,turns:scenario.turns.length,run,memory,seed:req.seed+i}));
  }).flat()));
  return {req,matrix};
}
async function startBenchmark(owner:string,body:Value,generate:Generate,compile:Compile) {
  const {req,matrix}=prepareBenchmark(body),id=req.request_id;
  await recover(owner);
  const previous=await getMeta<Value>(key(owner,'benchmark',id));ownerCheck(owner);
  if(previous){if(JSON.stringify(previous.request)!==JSON.stringify(req))throw fail('Benchmark request changed',409);return json(publicJob(previous));}
  let accept!:(response:Response)=>void,decline!:(error:unknown)=>void;
  const started=new Promise<Response>((resolve,reject)=>{accept=resolve;decline=reject;});
  const task=exclusive(owner,id,undefined,async controller=>{
    const ready=await readyModels();ownerCheck(owner);controller.signal.throwIfAborted();
    if(req.model_ids.some(id=>!ready.has(id)))throw fail('Prepare this model in Settings / 設定からモデルを準備してください',409);
    let job:Value={id,request:req,status:'running',created_at:new Date().toISOString(),planned_runs:matrix.length,
      planned_turns:matrix.reduce((n,r)=>n+r.turns,0),results:[],current:null,cancel_requested:false,
      evaluation:'keyword probes; human quality and physical local-model acceptance are separate'};
    const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(key(owner,'control'));
    if(channel)channel.onmessage=event=>{if(deviceOwner()===owner&&event.data?.id===id&&event.data?.type==='cancel')controller.abort('cancelled');};
    const save=async()=>{
      job=await updateJob(owner,id,current=>({...job,cancel_requested:!!(current?.cancel_requested||job.cancel_requested)}));
      if(job.cancel_requested)controller.abort('cancelled');
    };
    let accepted=false;
    try{
      await save();accepted=true;accept(json(publicJob(job),202));
      for(const row of matrix){
        controller.signal.throwIfAborted();ownerCheck(owner);
        job.current={model_id:row.model_id,scenario_id:row.scenario,run:row.run,memory:row.memory,turns_completed:0,turns_planned:row.turns};await save();
        const deadline=new AbortController(),stop=()=>deadline.abort(controller.signal.reason);
        controller.signal.addEventListener('abort',stop,{once:true});if(controller.signal.aborted)stop();
        let timedOut=false;const expiresAt=Date.now()+req.run_timeout_seconds*1000;
        const timer=setTimeout(()=>{timedOut=true;deadline.abort('timed_out');},req.run_timeout_seconds*1000);
        try{
          const result=await runOne(owner,{...row,temperature:req.temperature,extra_system_prompt:'',memory_options:req.memory_options,history_turn_limit:req.history_turn_limit,job_id:id,deadline_at:expiresAt},row.run,deadline.signal,generate,compile,undefined,async record=>{
            job.current={...job.current,experiment_id:record.meta.experiment_id,turns_completed:record.turns.filter(t=>t.status==='completed').length};await save();
          });
          job.results.push(result.meta);
          if(timedOut||Date.now()>=expiresAt){job.status='timed_out';break;}
          if(result.meta.status!=='completed'){job.status=controller.signal.aborted?'cancelled':'failed';break;}
        }catch(error){if(timedOut||Date.now()>=expiresAt){job.status='timed_out';break;}throw error;}
        finally{clearTimeout(timer);controller.signal.removeEventListener('abort',stop);}
      }
      if(job.status==='running')job.status=job.results.length===job.planned_runs?'completed':controller.signal.aborted?'cancelled':'failed';
    }catch(error){
      if(!accepted){decline(error);return;}
      job.status=controller.signal.aborted?'cancelled':'failed';job.error=String(error);
    }finally{
      channel?.close();
      if(accepted&&owner===deviceOwner()){
        try{
          const results=new Map(job.results.map((r:Value)=>[r.experiment_id,r]));
          for(const record of (await list<Experiment>(owner,'experiment')).filter(e=>e.job_id===id)){
            if(record.meta.status==='running'){
              record.meta.status='interrupted';record.meta.metrics??=computeDeviceMetrics(record.turns);record.revision=await write(owner,'experiment',record.meta.experiment_id,record);
            }
            results.set(record.meta.experiment_id,record.meta);
          }
          job.results=[...results.values()];job.finished_at=new Date().toISOString();await save();
        }catch{/* Keep the last durable job and experiments for recovery after storage is available. */}
      }
    }
  });
  const taskKey=key(owner,'benchmark',id);benchmarkTasks.set(taskKey,task);
  void task.catch(decline).finally(()=>benchmarkTasks.delete(taskKey));
  return started;
}
async function benchmarkRoute(path:string,method:string,body:Value,owner:string,generate:Generate,compile:Compile) {
  if(path==='/api/benchmarks'){
    if(method==='POST')return startBenchmark(owner,body,generate,compile);
    if(method!=='GET')throw fail('Benchmarks require GET or POST',405);
    await recover(owner);return json({jobs:(await list<Value>(owner,'benchmark')).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50).map(publicJob)});
  }
  const match=path.match(/^\/api\/benchmarks\/([^/]+)(?:\/(export|cancel))?$/);
  if(!match)throw fail('Benchmark route not found',404);
  const id=identifier(match[1]).toLowerCase();await recover(owner);
  let job=await readJob(owner,id);
  if(match[2]==='cancel'){
    if(method!=='POST')throw fail('Cancel requires POST',405);
    if(['queued','running'].includes(job.status)){
      job=await updateJob(owner,id,current=>({...current!,cancel_requested:['queued','running'].includes(current!.status)||current!.cancel_requested}));
      if(active?.owner===owner&&active.request===id)active.controller.abort('cancelled');
      const channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel(key(owner,'control'));
      channel?.postMessage({id,type:'cancel'});channel?.close();
      const task=benchmarkTasks.get(key(owner,'benchmark',id));if(task)await task;
      job=await readJob(owner,id);
    }
    return json(publicJob(job));
  }
  if(method!=='GET')throw fail('Benchmark requires GET',405);
  const response=json(publicJob(job));if(match[2]==='export')response.headers.set('Content-Disposition','attachment; filename="benchmark.json"');return response;
}
export async function deviceResearchRoute(path:string,method:string,body:Value,url:URL,owner:string,signal:AbortSignal|undefined,generate:Generate,compile:Compile):Promise<Response> {
  if(path==='/api/benchmarks'||path.startsWith('/api/benchmarks/'))return benchmarkRoute(path,method,body,owner,generate,compile);
  if(path==='/api/experiments/run') {if(method!=='POST')throw fail('Research run requires POST',405);return run(owner,body,signal,generate,compile);}
  const cancel=path.match(/^\/api\/experiments\/requests\/([^/]+)\/cancel$/);
  if(cancel){if(method!=='POST')throw fail('Cancel requires POST',405);identifier(cancel[1]);if(active?.owner!==owner||active.request!==cancel[1])throw fail('Research request is not running',409);active.controller.abort();return json({ok:true});}
  if(path==='/api/ratings'){
    if(method==='GET'){const id=url.searchParams.get('experiment_id')??'';const d=await detail(owner,id);return json({ratings:Object.entries(d.ratings).map(([turn,rating])=>({turn:Number(turn),...rating as Value}))});}
    if(method!=='POST')throw fail('Ratings require POST',405);
    const record=await read(owner,body.experiment_id),turn=integer(body.turn,0,1,100),score=integer(body.score,0,1,5);
    if(!record.turns.some(t=>t.turn===turn))throw fail('Experiment turn not found',404);
    if(typeof body.comment!=='string'||body.comment.length>10000||typeof body.rater!=='string'||!body.rater.trim()||body.rater.length>200)throw fail('Invalid rating');
    await appTransaction<void>(['meta'],'readwrite',(tx,finish)=>{const store=tx.objectStore('meta'),r=store.get(key(owner,'ratings',body.experiment_id));r.onsuccess=()=>{
      if(owner!==deviceOwner()){tx.abort();return;}store.put({...r.result,[turn]:{score,comment:body.comment,rater:body.rater,updated_at:new Date().toISOString()}},key(owner,'ratings',body.experiment_id));finish();
    };});return json({ok:true});
  }
  const experiment=path.match(/^\/api\/experiments\/([^/]+)(?:\/(export|rerun))?$/);
  if(experiment){
    if(experiment[2]==='rerun'){
      if(method!=='POST')throw fail('Replay requires POST',405);const source=await read(owner,experiment[1]);
      return run(owner,{scenario:source.meta.scenario_id,model_id:source.meta.model_id,runs:body.runs??1,allow_nsfw:body.allow_nsfw??false,
        memory:source.meta.memory_enabled,temperature:source.meta.generation_config.requested?.temperature,seed:source.meta.seed,
        extra_system_prompt:source.meta.extra_system_prompt,request_id:body.request_id},signal,generate,compile,source);
    }
    if(method!=='GET')throw fail('Experiment requires GET',405);
    await recover(owner);const response=json(await detail(owner,experiment[1]));
    if(experiment[2]==='export')response.headers.set('Content-Disposition','attachment; filename="experiment.json"');
    return response;
  }
  if(method!=='GET')throw fail('Research listing requires GET',405);
  await recover(owner);const experiments=await list<Experiment>(owner,'experiment');
  if(path==='/api/experiments')return json({experiments:experiments.sort((a,b)=>b.meta.timestamp.localeCompare(a.meta.timestamp)).slice(0,integer(url.searchParams.has('limit')?Number(url.searchParams.get('limit')):undefined,50,0,500)).map(e=>e.meta)});
  if(path==='/api/leaderboard'){
    const scope=url.searchParams.get('scope')==='all'?'all':'official',excluded={invalid:0,mock:0,non_official:0},groups=new Map<string,Value[]>();
    for(const e of experiments){
      if(e.meta.status!=='completed'||e.meta.metrics?.failure_rate>0){excluded.invalid++;continue;}
      if(scope==='official'&&!e.meta.official){excluded.non_official++;continue;}
      const ratings=await getMeta<Value>(key(owner,'ratings',e.meta.experiment_id));ownerCheck(owner);
      const scores=Object.values(ratings??{}).map(r=>r.score),entry={...e.meta,human:scores.length?metricRound(scores.reduce((a,b)=>a+b)/scores.length,2):null};
      groups.set(e.meta.model_id,[...groups.get(e.meta.model_id)??[],entry]);
    }
    const ranking=[...groups].map(([model_id,values])=>{
      const avg=(fn:(e:Value)=>number|null,d=3)=>{const nums=values.map(fn).filter((n):n is number=>n!==null);return nums.length?metricRound(nums.reduce((a,b)=>a+b)/nums.length,d):null;};
      const failure=avg(e=>e.metrics?.failure_rate??null),repetition=avg(e=>e.metrics?.repetition_score??null),chars=avg(e=>e.metrics?.avg_chars??null,1);
      return {model_id,runs:values.length,avg_human:avg(e=>e.human,2),auto_score:failure===null?null:metricRound(Math.max(0,Math.min(100,100-failure*50-(repetition??0)*30)),1),avg_chars:chars,avg_failure_rate:failure,avg_repetition:repetition};
    }).sort((a,b)=>Number(b.avg_human!==null)-Number(a.avg_human!==null)||(b.avg_human??0)-(a.avg_human??0)||(b.auto_score??0)-(a.auto_score??0)||b.runs-a.runs);
    return json({scope,ranking,generated_at:new Date().toISOString(),total_experiments:ranking.reduce((n,r)=>n+r.runs,0),excluded});
  }
  throw fail('Research route not found',404);
}
