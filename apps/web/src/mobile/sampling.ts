import type { MobileModel } from './types';
import { CONTEXT_TOKENS, OUTPUT_TOKENS } from './types';
export function sampling(model:MobileModel,requested:Record<string,unknown>={}) {
  if(!requested||typeof requested!=='object'||Array.isArray(requested))throw Error('Invalid generation settings');
  const applied:Record<string,number>={temperature:model.temperature,top_k:model.topK,top_p:model.topP,max_tokens:OUTPUT_TOKENS},unsupported:string[]=[];
  if(model.runtime==='gguf')Object.assign(applied,{min_p:model.id==='kyalulu-iq3m'?.05:0,repeat_penalty:model.id==='kyalulu-iq3m'?1.1:1});
  const bounds:Record<string,[number,number,boolean?]>={temperature:[0,2],top_p:[0,1],top_k:[0,1000,true],max_tokens:[1,Math.floor(CONTEXT_TOKENS/2),true],
    min_p:[0,1],repeat_penalty:[.1,3],repeat_last_n:[0,CONTEXT_TOKENS,true],frequency_penalty:[-2,2],presence_penalty:[-2,2],seed:[0,2**32-1,true]};
  const common=new Set(['temperature','top_k','top_p','max_tokens']);
  for(const [key,value] of Object.entries(requested)){
    const limit=bounds[key];
    if(limit&&(typeof value!=='number'||!Number.isFinite(value)||value<limit[0]||value>limit[1]||limit[2]&&!Number.isInteger(value)))throw Error('Invalid generation setting: '+key);
    if(!limit||model.runtime==='onnx'&&!common.has(key)){unsupported.push(key);continue;}
    applied[key]=value as number;
  }
  return {requested,applied,unsupported};
}
export function ggufSampling(applied:Record<string,number>) {
  const names:Record<string,string>={repeat_penalty:'penalty_repeat',repeat_last_n:'penalty_last_n',frequency_penalty:'penalty_freq',presence_penalty:'penalty_present'};
  return Object.fromEntries(Object.entries(applied).map(([key,value])=>[names[key]??key,value]));
}
