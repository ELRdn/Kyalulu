import { afterEach,expect,it,vi } from 'vitest';
import { MobileRuntime } from './runtime';
import { deviceResponseGrammar } from '../lib/deviceCore';
import { MODELS } from './models';
import type { ChatTurn } from './types';
import type { GGUFRun, GGUFSourceInput, GGUFSourceRun } from './context';

afterEach(()=>vi.unstubAllGlobals());
function setup(auto=true){
  const sent:any[]=[],workers:any[]=[];
  vi.stubGlobal('Worker',class{
    onmessage:((event:any)=>void)|undefined;
    onerror:((event:any)=>void)|undefined;
    onmessageerror:((event:any)=>void)|undefined;
    constructor(){workers.push(this);}
    emit(data:any){queueMicrotask(()=>this.onmessage?.({data}));}
    postMessage(data:any){
      sent.push(structuredClone(data));
      if(!auto)return;
      if(data.type==='generate-admitted')this.emit({id:data.id,type:'admission-count',mandatoryInputTokens:70});
      else if(data.type!=='stop')this.emit({id:data.id,type:'done'});
    }
    terminate(){}
  });
  return {runtime:new MobileRuntime(),sent,workers};
}
it('holds one id and sends mandatory once, selected history only, preserving grammar and reserve',async()=>{
  const {runtime,sent}=setup(),messages:ChatTurn[]=[{role:'user',content:'Hello'}],settings={temperature:0,max_tokens:256};
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  await runtime.generate(messages,()=>{},settings,deviceResponseGrammar);
  expect(sent[1]).toMatchObject({type:'generate-admitted',mandatory:[{run:0,...messages[0]}],settings,responseGrammar:deviceResponseGrammar,
    admission:{modelId:'kyalulu-iq3m',outputTokens:256,originalRuns:1,newestUserRun:0}});
  expect(sent[2]).toEqual({id:sent[1].id,type:'admission-window',history:[],admission:{
    modelId:'kyalulu-iq3m',modelRevision:MODELS.find(model=>model.id==='kyalulu-iq3m')!.distributionRevision??MODELS.find(model=>model.id==='kyalulu-iq3m')!.revision,outputTokens:256}});
  await runtime.generate(messages,()=>{},settings);
  expect(sent[3]).not.toHaveProperty('responseGrammar');runtime.reset();
});
it.each([2400000,3*1024*1024])('never joins or transports %s obsolete bytes',async size=>{
  const {runtime,sent}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const fragments=Array.from({length:Math.ceil(size/120000)},(_,i)=>({role:'assistant' as const,content:'x'.repeat(Math.min(120000,size-i*120000))}));
  const original:ChatTurn[]=[{role:'system',content:'head'},...fragments,{role:'user',content:'latest'}];
  original.forEach(Object.freeze);Object.freeze(original);
  const join=Array.prototype.join;
  const spy=vi.spyOn(Array.prototype,'join').mockImplementation(function(this:unknown[],separator?:string){
    if(this.length>=fragments.length)throw Error('joined omitted history');return join.call(this,separator);
  });
  try{await runtime.generate(original,()=>{},{max_tokens:1024});}finally{spy.mockRestore();}
  expect(sent[1].mandatory).toEqual([{run:0,...original[0]},{run:2,...original.at(-1)}]);
  expect(sent[2].history).toEqual([]);
  expect(JSON.stringify(sent.slice(1)).length).toBeLessThan(2048);
  expect(sent[1].admission).toMatchObject({originalRuns:3,newestUserRun:2,outputTokens:1024});
  expect(original[1].content.length).toBe(120000);runtime.reset();
});
it('rejects invalid omitted originals and settings before any count or generation packet',async()=>{
  const {runtime,sent}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  await expect(runtime.generate([{role:'assistant',content:'x'.repeat(128001)},{role:'user',content:'latest'}],()=>{})).rejects.toThrow('会話データが不正');
  await expect(runtime.generate([{role:'user',content:'latest'}],()=>{},{max_tokens:2048})).rejects.toThrow('Invalid generation setting');
  expect(sent.map(message=>message.type)).toEqual(['load']);runtime.reset();
});
it('keeps complete ONNX raw input and its existing operation',async()=>{
  const {runtime,sent}=setup();await runtime.load('google-mobile-onnx',false,'https://device.test/');
  const messages:ChatTurn[]=[{role:'user',content:'old'.repeat(2000)},{role:'assistant',content:'reply'},{role:'user',content:'latest'}];
  await runtime.generate(messages,()=>{},{max_tokens:256});
  expect(sent[1]).toMatchObject({type:'generate',messages,settings:{max_tokens:256}});expect(sent[1]).not.toHaveProperty('admission');runtime.reset();
});
it('requires a successful current model after unload/reset',async()=>{
  const {runtime,sent}=setup(),messages:ChatTurn[]=[{role:'user',content:'private'}];
  await expect(runtime.generate(messages,()=>{})).rejects.toThrow('モデルを読み込んで');expect(sent).toHaveLength(0);
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');await runtime.unload();
  await expect(runtime.generate(messages,()=>{})).rejects.toThrow('モデルを読み込んで');
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');runtime.reset();
  await expect(runtime.generate(messages,()=>{})).rejects.toThrow('モデルを読み込んで');
});
it('snapshots originals/settings across count, preserves legacy selection and holds busy',async()=>{
  const {runtime,sent,workers}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  workers[0].postMessage=(data:any)=>sent.push(structuredClone(data));
  const messages:ChatTurn[]=[{role:'user',content:'old'},{role:'assistant',content:'reply'},{role:'user',content:'latest'}],settings={max_tokens:256};
  const running=runtime.generate(messages,()=>{},settings);messages[0].content='changed';settings.max_tokens=512;
  await expect(runtime.generate([],()=>{})).rejects.toThrow('処理中');await expect(runtime.load('google-mobile-onnx',false,'https://device.test/')).rejects.toThrow('処理中');
  await expect(runtime.unload()).rejects.toThrow('処理中');
  workers[0].emit({id:sent[1].id,type:'admission-count',mandatoryInputTokens:1900});
  await vi.waitFor(()=>expect(sent).toHaveLength(3));
  expect(sent[1].settings.max_tokens).toBe(256);
  expect(sent[2].history).toEqual([{run:0,role:'user',content:'old'},{run:1,role:'assistant',content:'reply'}]);
  workers[0].emit({id:sent[1].id,type:'done'});await running;runtime.reset();
});
it('rescues mandatory proxy overflow and forwards native overbudget without shortening',async()=>{
  const {runtime,sent,workers}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const messages:ChatTurn[]=[{role:'system',content:'あ'.repeat(2000)},{role:'user',content:'latest'}];
  await runtime.generate(messages,()=>{});
  expect(sent[1].mandatory[0].content).toBe(messages[0].content);expect(sent[2].history).toEqual([]);
  workers[0].postMessage=(data:any)=>sent.push(structuredClone(data));
  const running=runtime.generate(messages,()=>{}),id=sent.at(-1).id;
  workers[0].emit({id,type:'admission-count',mandatoryInputTokens:1793});
  await vi.waitFor(()=>expect(sent.at(-1).type).toBe('admission-window'));
  expect(sent.at(-1).error).toContain('長すぎ');expect(sent.at(-1)).not.toHaveProperty('history');
  workers[0].emit({id,type:'error',error:sent.at(-1).error});await expect(running).rejects.toThrow('長すぎ');runtime.reset();
});
it('keeps the cancel latch across admission and carries the stopped id, including pre-aborted signal',async()=>{
  const {runtime,sent,workers}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const controller=new AbortController();controller.abort();
  await expect(runtime.generate([{role:'user',content:'latest'}],()=>{},{},undefined,controller.signal)).rejects.toThrow();
  expect(sent).toHaveLength(1);
  workers[0].postMessage=(data:any)=>sent.push(structuredClone(data));
  const running=runtime.generate([{role:'user',content:'latest'}],()=>{}),id=sent[1].id;
  runtime.stop();workers[0].emit({id,type:'admission-count',mandatoryInputTokens:5});
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(sent.slice(2)).toEqual([{id,type:'stop'}]);
  workers[0].emit({id,type:'done',stopped:true});expect(await running).toMatchObject({stopped:true});
  runtime.reset();
});
it.each(['postMessage','onerror','onmessageerror'])('settles a broken %s channel and releases active state',async fault=>{
  const {runtime,sent,workers}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  workers[0].postMessage=()=>{if(fault==='postMessage')throw Error('clone failed');};
  const running=runtime.generate([{role:'user',content:'latest'}],()=>{});
  if(fault!=='postMessage')workers[0][fault]({});
  await expect(running).rejects.toThrow();
  runtime.reset();expect(sent[0].type).toBe('load');
});

function sourceInput(bodies:GGUFRun[]=[{run:0,role:'user',content:'old'},{run:1,role:'assistant',content:'reply'},{run:2,role:'user',content:'latest'}],outputTokens=256) {
  const replay=vi.fn(async(runs:readonly GGUFSourceRun[])=>runs.map(run=>({...bodies[run.run]})));
  const source:GGUFSourceInput={format:'gguf-source@1',outputTokens,
    runs:bodies.map(({run,role,content})=>({run,role,bytes:new TextEncoder().encode(content).length})),materialize:replay};
  return {source,replay,bodies};
}
function deferred<T>() {
  let resolve!:(value:T)=>void,reject!:(reason:Error)=>void;
  const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail;});
  return {promise,resolve,reject};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));

it.each(([
  [{run:0,role:'user',content:'old'},{run:1,role:'assistant',content:'reply'},{run:2,role:'user',content:'latest'}],
  [{run:0,role:'system',content:'head'},{run:1,role:'user',content:'old'.repeat(2000)},
    {run:2,role:'system',content:'middle'},{run:3,role:'assistant',content:'orphan'},
    {run:4,role:'user',content:'latest'},{run:5,role:'assistant',content:'tail'},{run:6,role:'system',content:'end'}],
  [{run:0,role:'assistant',content:'lead'},{run:1,role:'system',content:'setting'},{run:2,role:'assistant',content:'tail'}],
] as GGUFRun[][]).map(bodies=>({bodies})))('matches array packets and replays mandatory before history for fixture %#',async({bodies})=>{
  const {runtime,sent}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const {source,replay}=sourceInput(bodies);
  await runtime.generate(bodies.map(({role,content})=>({role,content})),()=>{},{max_tokens:256},deviceResponseGrammar);
  const old=sent.slice(1).map(({id,...packet})=>packet);
  await runtime.generate(source,()=>{},{max_tokens:256},deviceResponseGrammar);
  expect(sent.slice(3).map(({id,...packet})=>packet)).toEqual(old);
  expect(replay.mock.calls[0][0].map(run=>run.run)).toEqual(sent[1].mandatory.map((run:GGUFRun)=>run.run));
  expect(replay.mock.calls[1][0].map(run=>run.run)).toEqual(sent[2].history.map((run:GGUFRun)=>run.run));runtime.reset();
});

it('snapshots the full descriptor/settings/function fence before asynchronous mandatory replay',async()=>{
  const {runtime,sent,workers}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  workers[0].postMessage=(data:any)=>sent.push(structuredClone(data));
  const {source,replay,bodies}=sourceInput(),mandatory=deferred<GGUFRun[]>(),history=deferred<GGUFRun[]>();
  replay.mockImplementationOnce(()=>mandatory.promise).mockImplementationOnce(()=>history.promise);
  const settings={max_tokens:256},running=runtime.generate(source,()=>{},settings,deviceResponseGrammar);
  expect(sent).toHaveLength(1);expect(replay.mock.calls[0][0].map(run=>run.run)).toEqual([2]);
  source.outputTokens=512;source.runs[0].bytes=9999;source.runs[2].role='system';source.runs=[];
  source.materialize=()=>{throw Error('replaced replay');};settings.max_tokens=512;
  await expect(runtime.load('google-mobile-onnx',false,'https://device.test/')).rejects.toThrow('処理中');
  await expect(runtime.unload()).rejects.toThrow('処理中');
  mandatory.resolve([bodies[2]]);await vi.waitFor(()=>expect(sent).toHaveLength(2));
  expect(sent[1]).toMatchObject({settings:{max_tokens:256},mandatory:[bodies[2]],
    admission:{outputTokens:256,originalRuns:3,newestUserRun:2}});
  expect(replay).toHaveBeenCalledTimes(1);
  workers[0].emit({id:sent[1].id,type:'admission-count',mandatoryInputTokens:1900});
  await vi.waitFor(()=>expect(replay).toHaveBeenCalledTimes(2));
  expect(sent).toHaveLength(2);expect(replay.mock.calls[1][0].map(run=>run.run)).toEqual([0,1]);
  history.resolve(bodies.slice(0,2));await vi.waitFor(()=>expect(sent).toHaveLength(3));
  expect(sent[2]).toMatchObject({history:bodies.slice(0,2),admission:{outputTokens:256}});
  workers[0].emit({id:sent[1].id,type:'done'});await running;runtime.reset();
});

it('rejects non-GGUF sources, output reserve mismatches and invalid descriptors before replay or packets',async()=>{
  const {runtime,sent}=setup(),{source,replay}=sourceInput();
  await runtime.load('google-mobile-onnx',false,'https://device.test/');
  await expect(runtime.generate(source,()=>{})).rejects.toThrow('GGUF source requires');
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  await expect(runtime.generate(source,()=>{},{max_tokens:512})).rejects.toThrow('reserve mismatch');
  source.runs[0].bytes=-1;
  await expect(runtime.generate(source,()=>{})).rejects.toThrow('Invalid GGUF source runs');
  expect(sent.map(packet=>packet.type)).toEqual(['load','load']);expect(replay).not.toHaveBeenCalled();runtime.reset();
});

it.each(['throw','reject','invalid'])('releases preparation after mandatory materialization %s without sending a packet',async fault=>{
  const {runtime,sent}=setup(),{source,replay}=sourceInput();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  if(fault==='throw')replay.mockImplementationOnce(()=>{throw Error('read failed');});
  else if(fault==='reject')replay.mockRejectedValueOnce(Error('read failed'));
  else replay.mockResolvedValueOnce([{run:2,role:'user',content:'wrong bytes'}]);
  await expect(runtime.generate(source,()=>{})).rejects.toThrow();expect(sent).toHaveLength(1);
  await runtime.generate(source,()=>{});expect(sent[1].type).toBe('generate-admitted');runtime.reset();
});

it.each(['reject','invalid'])('forwards asynchronous history %s as a window error and drains the worker',async fault=>{
  const {runtime,sent,workers}=setup(),{source,replay}=sourceInput();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const post=workers[0].postMessage.bind(workers[0]);
  workers[0].postMessage=(data:any)=>{
    if(data.type==='admission-window'&&data.error){sent.push(structuredClone(data));workers[0].emit({id:data.id,type:'error',error:data.error});}
    else post(data);
  };
  replay.mockImplementationOnce(async runs=>runs.map(run=>({run:run.run,role:run.role,content:'latest'})));
  if(fault==='reject')replay.mockRejectedValueOnce(Error('revision changed'));
  else replay.mockResolvedValueOnce([]);
  await expect(runtime.generate(source,()=>{})).rejects.toThrow(fault==='reject'?'revision changed':'Invalid GGUF materialization');
  expect(sent[2]).toMatchObject({type:'admission-window',error:expect.any(String)});expect(sent[2]).not.toHaveProperty('history');
  await runtime.generate(source,()=>{});runtime.reset();
});

it('resets a failed asynchronous window post without an unhandled rejection or stranded operation',async()=>{
  const {runtime,sent,workers}=setup(),{source}=sourceInput();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const post=workers[0].postMessage.bind(workers[0]);
  workers[0].postMessage=(data:any)=>{if(data.type==='admission-window')throw Error('window clone failed');post(data);};
  const terminate=vi.spyOn(workers[0],'terminate');
  await expect(runtime.generate(source,()=>{})).rejects.toThrow('window clone failed');expect(terminate).toHaveBeenCalledTimes(1);
  await expect(runtime.generate(source,()=>{})).rejects.toThrow('モデルを読み込んで');
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');await runtime.generate(source,()=>{});
  expect(sent.at(-1).type).toBe('admission-window');runtime.reset();
});

it.each(['stop','abort'])('settles %s during mandatory replay without requiring the read to finish or sending stop to an idle worker',async action=>{
  const {runtime,sent}=setup(),{source,replay}=sourceInput(),gate=deferred<GGUFRun[]>(),controller=new AbortController();
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');replay.mockImplementationOnce(()=>gate.promise);
  const running=runtime.generate(source,()=>{},{},undefined,controller.signal);
  if(action==='stop')runtime.stop();else controller.abort();
  await expect(running).resolves.toMatchObject({type:'done',stopped:true});expect(sent).toHaveLength(1);
  await runtime.generate(source,()=>{});const before=sent.length;
  gate.reject(Error('late owner change'));await flush();expect(sent).toHaveLength(before);runtime.reset();
});

it.each(['stop','abort'])('drains %s during history replay and ignores its late result across a new generation',async action=>{
  const {runtime,sent,workers}=setup(),{source,replay,bodies}=sourceInput(),gate=deferred<GGUFRun[]>(),controller=new AbortController();
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  replay.mockImplementationOnce(async()=>[bodies[2]]).mockImplementationOnce(()=>gate.promise);
  const running=runtime.generate(source,()=>{},{},undefined,controller.signal);
  await vi.waitFor(()=>expect(replay).toHaveBeenCalledTimes(2));const id=sent[1].id;
  if(action==='stop')runtime.stop();else controller.abort();
  expect(sent.at(-1)).toEqual({id,type:'stop'});
  await expect(runtime.generate(source,()=>{})).rejects.toThrow('処理中');
  workers[0].emit({id,type:'done',stopped:true});await expect(running).resolves.toMatchObject({stopped:true});
  await runtime.generate(source,()=>{});const before=sent.length;
  gate.resolve(bodies.slice(0,2));await flush();expect(sent).toHaveLength(before);runtime.reset();
});

it.each(['mandatory','history'])('handles stale and duplicate admission counts during %s replay without a late window',async phase=>{
  // A count cannot legitimately precede the mandatory packet; old ids must simply be ignored there.
  const {runtime,sent,workers}=setup(),{source,replay,bodies}=sourceInput(),gate=deferred<GGUFRun[]>();
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  if(phase==='mandatory')replay.mockImplementationOnce(()=>gate.promise);
  else replay.mockImplementationOnce(async()=>[bodies[2]]).mockImplementationOnce(()=>gate.promise);
  const running=runtime.generate(source,()=>{});
  const outcome=running.then(value=>({value}),error=>({error}));
  if(phase==='mandatory') {
    workers[0].emit({id:sent[0].id,type:'admission-count',mandatoryInputTokens:70});await flush();
    expect(sent).toHaveLength(1);gate.resolve([bodies[2]]);await running;
  }else {
    await vi.waitFor(()=>expect(replay).toHaveBeenCalledTimes(2));const id=sent[1].id;
    workers[0].emit({id,type:'admission-count',mandatoryInputTokens:70});
    const result=await outcome;expect('error' in result&&result.error.message).toBe('Duplicate admission count');
    expect(sent.filter(packet=>packet.type==='admission-window')).toHaveLength(0);
    await runtime.load('kyalulu-iq3m',false,'https://device.test/');await runtime.generate(source,()=>{});
    const before=sent.length;gate.reject(Error('late failure'));await flush();expect(sent).toHaveLength(before);
  }
  runtime.reset();
});

it.each(['reset','onerror','onmessageerror'])('fences %s during mandatory and history replay, including late failure after a replacement model loads',async fault=>{
  for(const phase of ['mandatory','history']) {
    const {runtime,sent,workers}=setup(),{source,replay,bodies}=sourceInput(),gate=deferred<GGUFRun[]>();
    await runtime.load('kyalulu-iq3m',false,'https://device.test/');
    if(phase==='mandatory')replay.mockImplementationOnce(()=>gate.promise);
    else replay.mockImplementationOnce(async()=>[bodies[2]]).mockImplementationOnce(()=>gate.promise);
    const running=runtime.generate(source,()=>{}),outcome=running.then(()=>null,error=>error as Error);
    if(phase==='history')await vi.waitFor(()=>expect(replay).toHaveBeenCalledTimes(2));
    if(fault==='reset')runtime.reset('account/model changed');else workers[0][fault]({});
    expect(await outcome).toBeInstanceOf(Error);
    await runtime.load('google-mobile-onnx',false,'https://device.test/');
    await runtime.generate([{role:'user',content:'new model'}],()=>{});
    const before=sent.length;gate.reject(Error('late source owner changed'));await flush();expect(sent).toHaveLength(before);runtime.reset();
  }
});

it.each([false,true])('preserves mandatory native-count fallback for source proxy overflow=%s',async overflow=>{
  const bodies:GGUFRun[]=[{run:0,role:'system',content:overflow?'あ'.repeat(2000):'head'},
    {run:1,role:'user',content:'old'},{run:2,role:'assistant',content:'reply'},{run:3,role:'user',content:'latest'}];
  const {runtime,sent,workers}=setup(),{source,replay}=sourceInput(bodies);await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  workers[0].postMessage=(data:any)=>{
    sent.push(structuredClone(data));
    if(data.type==='generate-admitted')workers[0].emit({id:data.id,type:'admission-count',mandatoryCountError:'native count failed'});
    if(data.type==='admission-window')workers[0].emit({id:data.id,type:data.error?'error':'done',...(data.error?{error:data.error}:{})});
  };
  const running=runtime.generate(source,()=>{});
  if(overflow){await expect(running).rejects.toThrow('native count failed');expect(replay).toHaveBeenCalledTimes(1);}
  else {await running;expect(sent[2].history).toEqual(bodies.slice(1,3));expect(replay).toHaveBeenCalledTimes(2);}
  runtime.reset();
});

it('does not materialize or transport enormous omitted descriptor history',async()=>{
  const {runtime,sent}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const replay=vi.fn(async(runs:readonly GGUFSourceRun[])=>runs.map(run=>{
    if(run.run===1)throw Error('obsolete body must stay on storage');
    return {run:run.run,role:run.role,content:run.run===0?'head':'latest'};
  }));
  const source:GGUFSourceInput={format:'gguf-source@1',outputTokens:256,runs:[
    {run:0,role:'system',bytes:4},{run:1,role:'assistant',bytes:Number.MAX_SAFE_INTEGER},{run:2,role:'user',bytes:6}],materialize:replay};
  await runtime.generate(source,()=>{});
  expect(replay.mock.calls.map(([runs])=>runs.map(run=>run.run))).toEqual([[0,2],[]]);expect(sent[2].history).toEqual([]);runtime.reset();
});

it('does not reapply the original-message cap to a merged mandatory source run',async()=>{
  const {runtime,sent}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const {source}=sourceInput([{run:0,role:'system',content:'x'.repeat(256002)},{run:1,role:'user',content:'latest'}]);
  await runtime.generate(source,()=>{});expect(sent[1].mandatory[0].content.length).toBe(256002);runtime.reset();
});

it.each(['stop','reset'])('fences a mandatory completion racing with %s before its first packet',async action=>{
  const {runtime,sent}=setup(),{source,replay,bodies}=sourceInput(),gate=deferred<GGUFRun[]>();
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');replay.mockImplementationOnce(()=>gate.promise);
  const running=runtime.generate(source,()=>{}),outcome=running.then(value=>({value}),error=>({error}));
  gate.resolve([bodies[2]]);
  queueMicrotask(()=>{if(action==='stop')runtime.stop();else runtime.reset('owner changed');});
  const result=await outcome;
  if(action==='stop')expect(result).toMatchObject({value:{stopped:true}});
  else expect('error' in result&&result.error.message).toBe('owner changed');
  expect(sent).toHaveLength(1);runtime.reset();
});

it('ignores a late history success when the worker completed while it was pending',async()=>{
  const {runtime,sent,workers}=setup(),{source,replay,bodies}=sourceInput(),gate=deferred<GGUFRun[]>();
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  replay.mockImplementationOnce(async()=>[bodies[2]]).mockImplementationOnce(()=>gate.promise);
  const running=runtime.generate(source,()=>{});await vi.waitFor(()=>expect(replay).toHaveBeenCalledTimes(2));
  workers[0].emit({id:sent[1].id,type:'done'});await running;
  gate.resolve(bodies.slice(0,2));await flush();expect(sent).toHaveLength(2);
  await runtime.generate(source,()=>{});runtime.reset();
});
