import { afterEach,expect,it,vi } from 'vitest';
import { MobileRuntime } from './runtime';
import { deviceResponseGrammar } from '../lib/deviceCore';
import { MODELS } from './models';
import type { ChatTurn } from './types';

afterEach(()=>vi.unstubAllGlobals());
function setup(){
  const sent:any[]=[];
  vi.stubGlobal('Worker',class{
    onmessage:((event:any)=>void)|undefined;
    postMessage(data:any){sent.push(data);queueMicrotask(()=>this.onmessage?.({data:{id:data.id,type:'done'}}));}
    terminate(){}
  });
  return {runtime:new MobileRuntime(),sent};
}
it('forwards the response contract only for structured requests and retains sampling unchanged',async()=>{
  const {runtime,sent}=setup(),messages=[{role:'user' as const,content:'Hello'}],settings={temperature:0,max_tokens:256};
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  await runtime.generate(messages,()=>{},settings,deviceResponseGrammar);
  await runtime.generate(messages,()=>{},settings);
  expect(sent[1]).toMatchObject({type:'generate-admitted',messages,settings,responseGrammar:deviceResponseGrammar,
    admission:{modelId:'kyalulu-iq3m',outputTokens:256,omitted:0}});
  expect(sent[2]).toMatchObject({type:'generate-admitted',messages,settings});expect(sent[2]).not.toHaveProperty('responseGrammar');
  runtime.reset();
});
it('sends only admitted GGUF runs and pins the loaded model and applied reserve, retaining the original input',async()=>{
  const {runtime,sent}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  const original:ChatTurn[]=[{role:'system',content:'head'},...Array.from({length:20},()=>({role:'assistant' as const,content:'x'.repeat(120000)})),{role:'user',content:'latest'}];
  original.forEach(Object.freeze);Object.freeze(original);
  await runtime.generate(original,()=>{},{max_tokens:1024});
  const message=sent[1],model=MODELS.find(model=>model.id==='kyalulu-iq3m')!;
  expect(message.messages).toEqual([original[0],original.at(-1)]);
  expect(message.admission).toEqual({modelId:model.id,modelRevision:model.distributionRevision??model.revision,outputTokens:1024,omitted:1});
  expect(JSON.stringify(message).length).toBeLessThan(2048);
  expect(original).toHaveLength(22);expect(original[1].content.length).toBe(120000);runtime.reset();
});
it('rejects an invalid original even when it would otherwise be omitted, before posting any generation',async()=>{
  const {runtime,sent}=setup();await runtime.load('kyalulu-iq3m',false,'https://device.test/');
  await expect(runtime.generate([{role:'assistant',content:'x'.repeat(128001)},{role:'user',content:'latest'}],()=>{})).rejects.toThrow('会話データが不正');
  await expect(runtime.generate([{role:'user',content:'latest'}],()=>{},{max_tokens:2048})).rejects.toThrow('Invalid generation setting');
  expect(sent.map(message=>message.type)).toEqual(['load']);runtime.reset();
});
it('keeps the complete original ONNX input on its exact-tokenizer path',async()=>{
  const {runtime,sent}=setup();await runtime.load('google-mobile-onnx',false,'https://device.test/');
  const messages:ChatTurn[]=[{role:'user',content:'old'.repeat(2000)},{role:'assistant',content:'old reply'},{role:'user',content:'latest'}];
  await runtime.generate(messages,()=>{},{max_tokens:256});
  expect(sent[1]).toMatchObject({type:'generate',messages,settings:{max_tokens:256}});expect(sent[1].messages).toBe(messages);
  expect(sent[1]).not.toHaveProperty('admission');runtime.reset();
});
it('requires a successful current load after unload or reset, without posting private input',async()=>{
  const {runtime,sent}=setup(),messages:ChatTurn[]=[{role:'user',content:'private input'}];
  await expect(runtime.generate(messages,()=>{})).rejects.toThrow('モデルを読み込んで');expect(sent).toHaveLength(0);
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');await runtime.unload();
  await expect(runtime.generate(messages,()=>{})).rejects.toThrow('モデルを読み込んで');expect(sent).toHaveLength(2);
  await runtime.load('kyalulu-iq3m',false,'https://device.test/');runtime.reset();
  await expect(runtime.generate(messages,()=>{})).rejects.toThrow('モデルを読み込んで');expect(sent).toHaveLength(3);
});
