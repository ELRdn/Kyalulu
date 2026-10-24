import { expect, it } from 'vitest';
import { MODELS } from './models';
import { sampling, ggufSampling } from './sampling';
import { fitContext, mergeTurns } from './context';
it('binds GGUF settings to native names and reports unsupported fields',()=>{
  const result=sampling(MODELS.find(m=>m.runtime==='gguf')!,{temperature:.2,top_p:.8,top_k:7,max_tokens:512,repeat_penalty:1.2,repeat_last_n:100,frequency_penalty:.1,presence_penalty:.2,seed:42,stop:['done']});
  expect(result.applied).toMatchObject({temperature:.2,top_p:.8,top_k:7,max_tokens:512,seed:42});expect(result.unsupported).toEqual(['stop']);
  expect(ggufSampling(result.applied)).toMatchObject({penalty_repeat:1.2,penalty_last_n:100,penalty_freq:.1,penalty_present:.2});
});
it('does not claim ONNX supports the GGUF-only samplers and rejects unsafe bounds',()=>{
  const model=MODELS.find(m=>m.runtime==='onnx')!;
  const result=sampling(model,{temperature:0,seed:42,min_p:.1,repeat_penalty:1.1});
  expect(result.applied.temperature).toBe(0);expect(result.unsupported).toEqual(['seed','min_p','repeat_penalty']);
  for(const request of [{temperature:NaN},{top_k:1.2},{max_tokens:1025},{seed:-1},{top_p:2}])expect(()=>sampling(model,request)).toThrow('Invalid generation');
});
it('preserves every system part and the latest input while pruning history and reserving output space',async()=>{
  const turns=[{role:'system' as const,content:'contract'},{role:'system' as const,content:'world'}, {role:'user' as const,content:'old'},{role:'assistant' as const,content:'reply'}, {role:'user' as const,content:'new'},{role:'system' as const,content:'post'}];
  const result=await fitContext(turns,m=>m.length*300,512);
  expect(result.messages).toEqual([turns[0],turns[1],turns[4],turns[5]]);expect(result.omitted).toBe(2);
  await expect(fitContext(result.messages,()=>2048,512)).rejects.toThrow('長すぎ');expect(turns).toHaveLength(6);
  expect(mergeTurns(result.messages)).toEqual([{role:'system',content:'contract\n\nworld'},turns[4],turns[5]]);
  expect(result.messages[0].content).toBe('contract');
});
