import { afterEach,expect,it,vi } from 'vitest';
import { MobileRuntime } from './runtime';
import { deviceResponseGrammar } from '../lib/deviceCore';

afterEach(()=>vi.unstubAllGlobals());
it('forwards the response contract only for structured requests and retains sampling unchanged',async()=>{
  const sent:any[]=[];
  vi.stubGlobal('Worker',class{
    onmessage:((event:any)=>void)|undefined;
    postMessage(data:any){sent.push(data);queueMicrotask(()=>this.onmessage?.({data:{id:data.id,type:'done'}}));}
    terminate(){}
  });
  const runtime=new MobileRuntime(),messages=[{role:'user' as const,content:'Hello'}],settings={temperature:0,max_tokens:256};
  await runtime.generate(messages,()=>{},settings,deviceResponseGrammar);
  await runtime.generate(messages,()=>{},settings);
  expect(sent[0]).toMatchObject({type:'generate',messages,settings,responseGrammar:deviceResponseGrammar});
  expect(sent[1]).toMatchObject({type:'generate',messages,settings});expect(sent[1]).not.toHaveProperty('responseGrammar');
  runtime.reset();
});
