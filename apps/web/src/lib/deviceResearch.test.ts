import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({owner:'research-a',busy:0,metadata:new Map<string,any>(),locks:new Set<string>(),turns:[] as any[],calls:0,failAt:0,paused:false,stopped:false,release:null as (()=>void)|null,ready:true,quota:false,readyWait:null as Promise<void>|null,readyStarted:false,onPut:null as ((value:any)=>void)|null,transactions:Promise.resolve() as Promise<unknown>,pauseLoad:false,loadReject:null as ((error:Error)=>void)|null}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,generationBusy:()=>fixture.busy>0,setGenerationBusy:(value:boolean)=>{fixture.busy+=value?1:-1;}}));
vi.mock('../mobile/models',()=>({MODELS:['fixture','mock-echo','fixture-load'].map(id=>({id,name:id,runtime:'gguf',revision:'pinned',files:[],temperature:.8,topK:64,topP:.95})),readyModels:async()=>{fixture.readyStarted=true;await fixture.readyWait;return new Set(fixture.ready?['fixture','mock-echo','fixture-load']:[]);}}));
vi.mock('../mobile/runtime',()=>({MobileRuntime:class{
  async load(){if(fixture.pauseLoad)await new Promise<void>((_resolve,reject)=>{fixture.loadReject=reject;});}
  reset(){fixture.loadReject?.(Error('Model load stopped'));fixture.loadReject=null;this.stop();}
  stop(){fixture.stopped=true;fixture.release?.();}
  async generate(messages:any[],event:any){
    fixture.calls++;fixture.turns.push(structuredClone(messages));
    if(fixture.failAt===fixture.calls)throw Error('Fixture inference failure');
    if(fixture.paused)await new Promise<void>(resolve=>{fixture.release=resolve;});
    const user=messages.filter(m=>m.role==='user').at(-1).content;
    event({type:'delta',text:JSON.stringify({reply:'記憶の試験応答',state_update:{location:'図書館',time:'昼',mood:'calm',active_scene:'読書',relationship_state:{stage:'stranger',tone:'neutral',unresolved_conflict:false}},memory_proposals:[{type:'semantic',content:user.slice(0,100),source_kind:'user_statement'}]})});
    return {stopped:fixture.stopped,measurement:{generationMs:5}};
  }
}}));
vi.mock('./appSync',()=>({hydrateConversation:vi.fn()}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),
  allEntities:async()=>[],entity:async()=>undefined,getMeta:async(key:string)=>structuredClone(fixture.metadata.get(key)),
  saveEntity:vi.fn(()=>{throw Error('Research must never use conversation storage');}),
  appTransaction:async(_stores:string[],_mode:string,action:any)=>{
    const result=fixture.transactions.then(()=>new Promise((resolve,reject)=>{
    const pending=new Map(fixture.metadata);let aborted=false;
    const tx={abort:()=>{aborted=true;reject(Error('Owner or revision changed'));},objectStore:()=>({
      get:(key:string)=>{const r={result:undefined as any,onsuccess:null as any};queueMicrotask(()=>{if(aborted)return;r.result=structuredClone(pending.get(key));try{r.onsuccess?.();}catch(e){aborted=true;reject(e);}});return r;},
      getAll:(range:any)=>{const r={result:undefined as any,onsuccess:null as any};queueMicrotask(()=>{if(aborted)return;r.result=[...pending].filter(([k])=>k>=range.lower&&k<=range.upper).map(([,v])=>structuredClone(v));try{r.onsuccess?.();}catch(e){aborted=true;reject(e);}});return r;},
      put:(value:any,key:string)=>{if(fixture.quota)throw Error('Quota exceeded');pending.set(key,structuredClone(value));fixture.onPut?.(value);},
    })};
    action(tx,(value:any)=>{if(!aborted){fixture.metadata=pending;resolve(value);}});
    }));fixture.transactions=result.catch(()=>undefined);return result;
  },
}));
// Route tests retain their in-memory store; the new storage boundary is exercised in real IndexedDB.
vi.mock('./deviceResearchStore',async()=>{
  const {appTransaction}=await import('./appStore');
  const start=(owner:string)=>'device-research:'+JSON.stringify(owner)+':experiment:';
  return {
    readResearchExperiment:async(owner:string,id:string)=>structuredClone(fixture.metadata.get(start(owner)+id)),
    listResearchExperiments:async(owner:string)=>[...fixture.metadata].filter(([key])=>key.startsWith(start(owner))).map(([,value])=>({meta:structuredClone(value.meta),revision:value.revision,...(value.job_id?{job_id:value.job_id}:{})})),
    writeResearchExperiment:(owner:string,id:string,value:any)=>appTransaction(['meta'],'readwrite',(tx,done)=>{
      const store=tx.objectStore('meta'),read=store.get(start(owner)+id);
      read.onsuccess=()=>{
        if(owner!==fixture.owner||(read.result?.revision??0)!==value.revision){tx.abort();return;}
        const revision=value.revision+1;store.put({...value,revision},start(owner)+id);done(revision);
      };
    }),
  };
});
import { deviceFetch } from './deviceApi';
import { saveEntity } from './appStore';
import reference from '../../../../tests/fixtures/device-research.json';
const id='10000000-0000-4000-8000-000000000001';
const request=(overrides={})=>({scenario:'mocha_memory_001',model_id:'fixture',runs:1,memory:true,seed:42,request_id:id,...overrides});
const post=(path:string,body:any)=>deviceFetch(path,{method:'POST',body:JSON.stringify(body)});
const records=()=>[...fixture.metadata.entries()].filter(([k])=>k.includes(':experiment:')).map(([,v])=>v);
beforeEach(()=>{
  fixture.owner='research-a';fixture.busy=0;fixture.metadata.clear();fixture.locks.clear();fixture.turns=[];fixture.calls=0;fixture.failAt=0;fixture.paused=false;fixture.stopped=false;fixture.release=null;fixture.ready=true;fixture.quota=false;
  fixture.readyWait=null;fixture.readyStarted=false;fixture.onPut=null;
  fixture.transactions=Promise.resolve();fixture.pauseLoad=false;fixture.loadReject=null;
  vi.stubGlobal('location',{href:'https://device.test/device/'});
  vi.stubGlobal('IDBKeyRange',{bound:(lower:string,upper:string)=>({lower,upper})});
  vi.stubGlobal('navigator',{userAgent:'Fixture',locks:{request:async(name:string,_options:any,fn:any)=>{
    if(fixture.locks.has(name))return fn(null);fixture.locks.add(name);try{return await fn({name});}finally{fixture.locks.delete(name);}
  }}});
  vi.mocked(saveEntity).mockClear();
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it('executes the shared generator, isolates experiment memories, and keeps successful requests idempotent',async()=>{
  const first=await post('/api/experiments/run',request({runs:2}));expect(first.status,await first.clone().text()).toBe(200);
  const data=await first.json();expect(data.results,JSON.stringify(records().map(r=>r.turns))).toHaveLength(2);
  expect(records()).toHaveLength(2);expect(records().map(r=>r.meta.status)).toEqual(['completed','completed']);
  expect(records()[0].session.payload.memories[0].scope).not.toBe(records()[1].session.payload.memories[0].scope);
  expect(fixture.turns[0][0].content).not.toContain('\nRelevant memories;');
  expect(fixture.turns[8][0].content).not.toContain('\nRelevant memories;');
  expect(fixture.turns[4].filter((m:any)=>m.role==='user')).toHaveLength(1);
  expect(fixture.turns[4][0].content).toContain(records()[0].session.payload.memories[0].content);
  expect(fixture.turns[4][0].content).toContain('source: user_statement');
  expect(fixture.turns[4][0].content).toContain('Story events are fiction, not user facts');
  expect(records()[0].turns.map((t:any)=>t.user_id)).toEqual([1,3,5,7,9,11,13,15]);
  expect(records()[0].turns[4].state_before.session_id).not.toBe(records()[0].turns[0].state_before.session_id);
  expect(records()[0].session.payload.memories[4].source_message_ids).toEqual([9]);
  expect(records()[0].session.payload.memories[4].source_session_id).toBe(records()[0].turns[4].state_before.session_id);
  expect(records()[0].turns[0]).toMatchObject({user:expect.any(String),assistant:'記憶の試験応答',compiled:expect.any(Object),generation_config:{requested:{seed:42}}});
  const count=fixture.calls;expect(await (await post('/api/experiments/run',request({runs:2}))).json()).toEqual(data);expect(fixture.calls).toBe(count);
  expect((await post('/api/experiments/run',request({runs:3}))).status).toBe(409);
  expect(saveEntity).not.toHaveBeenCalled();expect(fixture.busy).toBe(0);
});
it('scopes ratings and exports by owner, without syncing sessions',async()=>{
  const data=await (await post('/api/experiments/run',request())).json(),experiment=data.results[0].experiment_id;
  expect((await post('/api/ratings',{experiment_id:experiment,turn:1,score:4,comment:'日本語の評価',rater:'local'})).status).toBe(200);
  const result=await (await deviceFetch('/api/experiments/'+experiment+'/export')).json();expect(result.ratings['1'].comment).toBe('日本語の評価');expect(result.session).toBeUndefined();
  expect((await deviceFetch('/api/experiments/'+experiment,{method:'DELETE'})).status).toBe(405);
  fixture.owner='research-b';expect((await deviceFetch('/api/experiments/'+experiment)).status).toBe(404);
  expect((await (await deviceFetch('/api/experiments')).json()).experiments).toEqual([]);
  expect((await post('/api/ratings',{experiment_id:experiment,turn:1,score:5,comment:'wrong owner',rater:'local'})).status).toBe(404);
  expect(saveEntity).not.toHaveBeenCalled();
});
it('keeps failure diagnostics and partial turns out of the official leaderboard',async()=>{
  fixture.failAt=2;const data=await (await post('/api/experiments/run',request())).json();
  expect(data.results[0].meta.status).toBe('failed');expect(records()[0].turns).toHaveLength(2);
  expect(records()[0].turns[1].error).toContain('Fixture inference failure');
  expect((await (await deviceFetch('/api/leaderboard')).json()).ranking).toEqual([]);
  expect(fixture.busy).toBe(0);
});
it('rejects missing model files, adult requests, invalid run counts and fabricated ratings',async()=>{
  fixture.ready=false;expect((await post('/api/experiments/run',request())).status).toBe(409);fixture.ready=true;
  expect((await post('/api/experiments/run',request({allow_nsfw:true}))).status).toBe(403);
  expect((await post('/api/experiments/run',request({runs:0}))).status).toBe(400);
  expect((await post('/api/experiments/run',request({request_id:'../unsafe'}))).status).toBe(400);
  expect((await deviceFetch('/api/experiments/run')).status).toBe(405);expect(fixture.calls).toBe(0);expect(records()).toEqual([]);
});
it('rejects parallel generations and stops only the active owner/request',async()=>{
  fixture.paused=true;const pending=post('/api/experiments/run',request());
  await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  expect((await post('/api/experiments/run',request({request_id:crypto.randomUUID()}))).status).toBe(409);
  expect((await (await deviceFetch('/api/experiments')).json()).experiments[0].status).toBe('running');
  expect((await post('/api/chat/stream',{session_id:'chat',generation_id:'chat',model_id:'fixture',messages:[{role:'user',content:'do not start'}]})).status).toBe(409);
  expect((await post('/api/experiments/requests/'+crypto.randomUUID()+'/cancel',{})).status).toBe(409);
  expect((await post('/api/experiments/requests/'+id+'/cancel',{})).status).toBe(200);
  const data=await (await pending).json();expect(data.results[0].meta.status).toBe('cancelled');expect(fixture.calls).toBe(1);expect(fixture.busy).toBe(0);
});
it('fences an account change before result persistence and recovers the old pending experiment as interrupted',async()=>{
  fixture.paused=true;const pending=post('/api/experiments/run',request());await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  fixture.owner='research-b';fixture.release!();expect((await pending).status).toBe(409);
  expect(records()[0].meta.status).toBe('running');expect(records()[0].turns).toEqual([]);expect(fixture.busy).toBe(0);
  expect((await (await deviceFetch('/api/experiments')).json()).experiments).toEqual([]);
  fixture.owner='research-a';expect((await (await deviceFetch('/api/experiments')).json()).experiments[0].status).toBe('interrupted');
  expect((await post('/api/experiments/run',request())).status).toBe(409);
});
it('replays saved settings into a new experiment without updating the source',async()=>{
  const first=await (await post('/api/experiments/run',request())).json(),source=structuredClone(records()[0]);
  const replay=await (await post('/api/experiments/'+first.results[0].experiment_id+'/rerun',{runs:1})).json();
  expect(replay.results[0].experiment_id).not.toBe(source.meta.experiment_id);expect(records()[0]).toEqual(source);
  expect(records()[1].meta.scenario_snapshot).toEqual(source.meta.scenario_snapshot);
  expect(records()[1].meta.memory_options).toEqual({top_k:5,budget_tokens:300,min_score:.12,fill_recent:true});
  expect(records()[1].turns[0].generation_config.applied).toEqual(source.turns[0].generation_config.applied);
});
it('keeps a pending input when storage fills and never reports a successful result',async()=>{
  fixture.paused=true;const pending=post('/api/experiments/run',request());await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  fixture.quota=true;fixture.release!();const response=await pending;expect(response.status).toBe(400);
  expect(records()[0].turns).toEqual([]);expect(records()[0].session.payload.pending_generation).toBeTruthy();
  expect(records()[0].session.payload.messages.at(-1).role).toBe('user');expect(fixture.busy).toBe(0);
  fixture.quota=false;expect((await (await deviceFetch('/api/experiments')).json()).experiments[0].status).toBe('interrupted');
});
it('honors stop during model-readiness checks before starting any generation',async()=>{
  let release!:()=>void;fixture.readyWait=new Promise<void>(resolve=>{release=resolve;});
  const controller=new AbortController(),pending=deviceFetch('/api/experiments/run',{method:'POST',body:JSON.stringify(request()),signal:controller.signal});
  await vi.waitFor(()=>expect(fixture.readyStarted).toBe(true));controller.abort();release();
  expect((await pending).status).toBe(400);expect(fixture.calls).toBe(0);expect(records()).toEqual([]);expect(fixture.busy).toBe(0);
});
it('retains an atomically committed final result when stop arrives before its response',async()=>{
  const controller=new AbortController();fixture.onPut=value=>{if(value.meta?.status==='completed')controller.abort();};
  const response=await deviceFetch('/api/experiments/run',{method:'POST',body:JSON.stringify(request()),signal:controller.signal});
  expect(response.status).toBe(200);const data=await response.json();expect(data.results[0].meta.status).toBe('completed');
  expect(records()[0].turns).toHaveLength(8);expect(records()[0].session.payload.messages.at(-1).role).toBe('assistant');
  expect(new Set(records()[0].turns.map((t:any)=>t.turn)).size).toBe(8);expect(fixture.busy).toBe(0);
});

const benchmark=(overrides={})=>({model_ids:['fixture'],scenarios:['mocha_memory_001'],runs:1,memory:'compare',seed:42,request_id:id,...overrides});
async function finishedJob(id_:string=id){
  let job:any;
  await vi.waitFor(async()=>{const response=await deviceFetch('/api/benchmarks/'+id_);expect(response.status).toBe(200);job=await response.json();expect(['queued','running']).not.toContain(job.status);},{timeout:10000});
  await vi.waitFor(()=>expect(fixture.busy).toBe(0));return job;
}
it('runs paired matrices with alternating arm order, equal seeds, and the requested history/memory limits',async()=>{
  const response=await post('/api/benchmarks',benchmark({runs:2,history_turn_limit:1,memory_options:{top_k:1,budget_tokens:80,fill_recent:false}}));
  expect(response.status,await response.clone().text()).toBe(202);
  const job=await finishedJob();expect(job.status).toBe('completed');expect(job.planned_runs).toBe(4);expect(job.planned_turns).toBe(32);
  expect(job.results.map((r:any)=>[r.run_number,r.memory_enabled,r.seed])).toEqual([[1,false,42],[1,true,42],[2,true,43],[2,false,43]]);
  expect(job.results.every((r:any)=>r.history_turn_limit===1&&r.memory_options.top_k===1)).toBe(true);
  expect(fixture.turns.every(messages=>messages.filter((m:any)=>m.role==='user').length<=2)).toBe(true);
  expect(records()).toHaveLength(4);expect(new Set(records().map(r=>r.session.id)).size).toBe(4);
  expect(records().every(r=>r.job_id===id)).toBe(true);
  const exported=await deviceFetch('/api/benchmarks/'+id+'/export');expect(exported.headers.get('Content-Disposition')).toContain('benchmark.json');
  expect((await exported.json()).revision).toBeUndefined();expect(saveEntity).not.toHaveBeenCalled();
});
it('keeps in-flight benchmark requests idempotent, normalizes UUID case, and cancels only the owned job',async()=>{
  fixture.paused=true;expect((await post('/api/benchmarks',benchmark())).status).toBe(202);await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  expect((await post('/api/benchmarks',benchmark())).status).toBe(200);
  expect((await post('/api/benchmarks',benchmark({runs:2}))).status).toBe(409);
  expect((await post('/api/benchmarks',benchmark({request_id:crypto.randomUUID()}))).status).toBe(409);
  expect((await deviceFetch('/api/benchmarks/'+id)).status).toBe(200);expect(records()[0].meta.status).toBe('running');
  expect((await post('/api/benchmarks/'+crypto.randomUUID()+'/cancel',{})).status).toBe(404);
  const cancelled=await post('/api/benchmarks/'+id.toUpperCase()+'/cancel',{});expect(cancelled.status).toBe(200);
  expect((await cancelled.json()).status).toBe('cancelled');expect((await finishedJob()).results[0].status).toBe('cancelled');expect(fixture.calls).toBe(1);
});
it('retains the failed run and stops the remaining matrix instead of reporting completion',async()=>{
  fixture.failAt=2;expect((await post('/api/benchmarks',benchmark())).status).toBe(202);
  const job=await finishedJob();expect(job.status).toBe('failed');expect(job.results).toHaveLength(1);expect(job.results[0].status).toBe('failed');expect(fixture.calls).toBe(2);
});
it('keeps all three selected models in order with independent memories and matching seeds',async()=>{
  const model_ids=['fixture','mock-echo','fixture-load'];
  expect((await post('/api/benchmarks',benchmark({model_ids,memory:'on',seed:11}))).status).toBe(202);
  const job=await finishedJob();expect(job.status).toBe('completed');expect(job.results.map((r:any)=>r.model_id)).toEqual(model_ids);
  expect(job.results.map((r:any)=>r.seed)).toEqual([11,11,11]);expect(job.planned_turns).toBe(24);
  expect(new Set(records().map(r=>r.session.payload.memories[0].scope)).size).toBe(3);
});
it.each(['generation','load'])('enforces the per-run timeout during %s and retains the partial experiment',async stage=>{
  vi.useFakeTimers();fixture.paused=stage==='generation';fixture.pauseLoad=stage==='load';
  expect((await post('/api/benchmarks',benchmark({model_ids:[stage==='load'?'fixture-load':'fixture'],run_timeout_seconds:10}))).status).toBe(202);
  await vi.waitFor(()=>expect(stage==='load'?fixture.loadReject:fixture.release).not.toBeNull());
  await vi.advanceTimersByTimeAsync(10000);
  const job=await finishedJob();expect(job.status).toBe('timed_out');expect(job.results).toHaveLength(1);expect(job.results[0].status).toBe('cancelled');
  expect(records()[0].turns[0].user).toBeTruthy();expect(fixture.calls).toBe(stage==='load'?0:1);
});
it('rejects a late result after wall time expires even before a throttled timeout callback runs',async()=>{
  vi.useFakeTimers();fixture.paused=true;
  expect((await post('/api/benchmarks',benchmark({run_timeout_seconds:10}))).status).toBe(202);
  await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  vi.setSystemTime(Date.now()+11000);fixture.release!();
  const job=await finishedJob();expect(job.status).toBe('timed_out');expect(records()[0].turns[0].assistant).toBe('');
  expect(records()[0].session.payload.memories).toEqual([]);
});
it('isolates owners and recovers an abandoned benchmark with its saved experiment',async()=>{
  fixture.paused=true;await post('/api/benchmarks',benchmark());await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  fixture.owner='research-b';fixture.release!();await vi.waitFor(()=>expect(fixture.busy).toBe(0));
  expect((await (await deviceFetch('/api/benchmarks')).json()).jobs).toEqual([]);
  expect((await deviceFetch('/api/benchmarks/'+id+'/export')).status).toBe(404);
  fixture.owner='research-a';const recovered=await finishedJob();expect(recovered.status).toBe('interrupted');expect(recovered.results[0].status).toBe('interrupted');
  expect((await post('/api/benchmarks',benchmark())).status).toBe(200);expect(fixture.calls).toBe(1);
});
it('preserves pending input and a recoverable job when checkpoint storage fills',async()=>{
  fixture.paused=true;await post('/api/benchmarks',benchmark());await vi.waitFor(()=>expect(fixture.release).not.toBeNull());
  fixture.quota=true;fixture.release!();await vi.waitFor(()=>expect(fixture.busy).toBe(0));
  expect(records()[0].session.payload.pending_generation).toBeTruthy();expect(records()[0].turns).toEqual([]);
  fixture.quota=false;const recovered=await finishedJob();expect(recovered.status).toBe('interrupted');expect(recovered.results[0].status).toBe('interrupted');
});
it('reconciles a transient job-checkpoint failure with the saved partial experiment',async()=>{
  fixture.onPut=value=>{if(value.request&&value.current?.turns_completed===1){fixture.onPut=null;throw Error('Transient job checkpoint failure');}};
  expect((await post('/api/benchmarks',benchmark())).status).toBe(202);
  const job=await finishedJob();expect(job.status).toBe('failed');expect(job.results[0].status).toBe('interrupted');
  expect(records()[0].meta.status).toBe('interrupted');expect(records()[0].turns).toHaveLength(1);expect(fixture.calls).toBe(1);
});
it('rejects duplicate models, unavailable files, invalid seeds and arbitrary benchmark routes without generating',async()=>{
  expect((await post('/api/benchmarks',benchmark({model_ids:['fixture','fixture']}))).status).toBe(400);
  expect((await post('/api/benchmarks',benchmark({seed:-1}))).status).toBe(400);
  expect((await post('/api/benchmarks',benchmark({seed:2**32-1,runs:2}))).status).toBe(400);
  expect((await post('/api/benchmarks',benchmark({scenarios:['missing']}))).status).toBe(404);
  expect((await post('/api/benchmarks',benchmark({allow_nsfw:true}))).status).toBe(400);
  fixture.ready=false;expect((await post('/api/benchmarks',benchmark())).status).toBe(409);
  expect((await deviceFetch('/api/benchmarks',{method:'DELETE'})).status).toBe(405);
  expect((await post('/api/benchmarks/'+id+'/export',{})).status).toBe(404);expect(fixture.calls).toBe(0);expect(records()).toEqual([]);
});
it('matches Native benchmark defaults, paired run order, seeds and planned counts',async()=>{
  const expected=reference.benchmark;
  expect((await post('/api/benchmarks',expected.request)).status).toBe(202);
  const job=await finishedJob(expected.request.request_id);
  expect(job.request).toEqual(expected.request);expect(job.planned_runs).toBe(expected.planned_runs);expect(job.planned_turns).toBe(expected.planned_turns);
  expect(job.results.map((r:any)=>[r.model_id,r.scenario_id,r.run_number,r.memory_enabled,r.seed])).toEqual(expected.matrix);
});
it('finishes the 100-turn catalog scenario with bounded history and stable source message IDs',async()=>{
  expect((await post('/api/benchmarks',benchmark({scenarios:['advanced_mocha_sfw_100'],memory:'on',history_turn_limit:2,memory_options:{top_k:3,budget_tokens:200}}))).status).toBe(202);
  const job=await finishedJob();expect(job.status).toBe('completed');expect(job.planned_turns).toBe(100);expect(job.current.turns_completed).toBe(100);
  expect(fixture.calls).toBe(100);expect(fixture.turns.every(messages=>messages.filter((m:any)=>m.role==='user').length<=3)).toBe(true);
  expect(records()[0].turns.map((t:any)=>t.user_id)).toEqual(Array.from({length:100},(_,i)=>2*i+1));
},20000);
