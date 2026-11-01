import { afterEach,expect,it,vi } from 'vitest';
import { MobileRuntime } from './runtime';
import { deviceResponseGrammar } from '../lib/deviceCore';
import { MODELS } from './models';
import type { ChatTurn } from './types';

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
