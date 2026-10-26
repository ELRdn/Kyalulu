import { normalizeMemory } from './deviceCore';

// Match Python round on the exact binary float, including halfway values.
export function metricRound(value:number,digits:number) {
  if(!Number.isFinite(value))throw Error('Invalid metric');
  if(value===0)return 0;
  const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,Math.abs(value));
  const raw=bits.getBigUint64(0),exponent=Number((raw>>52n)&2047n);
  let numerator=(raw&((1n<<52n)-1n))+(exponent?1n<<52n:0n);
  const shift=(exponent?exponent-1023: -1022)-52+digits;
  numerator*=5n**BigInt(digits);
  const denominator=shift<0?1n<<BigInt(-shift):1n;
  if(shift>0)numerator<<=BigInt(shift);
  let rounded=numerator/denominator;
  const remainder=numerator%denominator;
  if(remainder*2n>denominator||remainder*2n===denominator&&rounded%2n)rounded++;
  return rounded===0n?0:Math.sign(value)*Number(rounded)/10**digits;
}
const average=(values:number[],digits=1)=>values.length?metricRound(values.reduce((a,b)=>a+b,0)/values.length,digits):null;
type Turn=Record<string,any>;
export function memoryProbe(expect:string[],forbid:string[],reply:string,context:string,stored:Turn[],trace:Turn|null) {
  const hit=(keys:string[],text:string)=>keys.some(k=>normalizeMemory(k)&&normalizeMemory(text).includes(normalizeMemory(k)));
  const result={expect,recalled:!!expect.length&&hit(expect,reply),in_context:!!expect.length&&hit(expect,context),
    stored:!!expect.length&&stored.some(m=>hit(expect,m.content)),
    injected:!!expect.length&&(trace?.candidates??[]).some((m:Turn)=>['injected','recent_fill'].includes(m.decision)&&hit(expect,m.content)),
    hallucinated:!!forbid.length&&hit(forbid,reply)};
  return {...result,outcome:!expect.length?null:result.recalled?'recalled':!trace?result.in_context?'missed_in_context':'no_memory':result.injected?'retrieved_but_ignored':result.stored?'not_retrieved':result.in_context?'missed_in_context':'not_stored'};
}
export function memoryMetrics(turns:Turn[]) {
  const probes=turns.map(t=>t.probe).filter(p=>p?.outcome),traces=turns.map(t=>t.memory).filter(Boolean);
  const decisions=traces.flatMap(t=>t.decisions??[]),stored=decisions.filter(d=>d.action==='store'),outcomes:Record<string,number>={};
  for(const p of probes)outcomes[p.outcome]=(outcomes[p.outcome]??0)+1;
  const avg=(key:string)=>average(traces.map(t=>t[key]).filter(v=>typeof v==='number'),2);
  return {probes:probes.length,recalled:outcomes.recalled??0,recall_rate:probes.length?metricRound((outcomes.recalled??0)/probes.length,3):null,outcomes,
    hallucinated:turns.filter(t=>t.probe?.hallucinated).length,stored:stored.length,unsupported_stored:stored.filter(d=>d.supported===false).length,
    skipped_proposals:decisions.filter(d=>d.action==='skip').length,avg_injected_tokens:avg('injected_tokens'),avg_retrieval_ms:avg('retrieval_ms')};
}
export function computeDeviceMetrics(turns:Turn[]) {
  const texts=turns.map(t=>String(t.assistant??'')),counts=texts.map(t=>Array.from(t).length),n=turns.length;
  const normalized=texts.map(t=>t.normalize('NFKC').trim()),tokens=normalized.flatMap(t=>t.split(/[。、，！？!?「」『』（）()\[\]…ー―\-—\s]+/u).filter(Boolean).flatMap(p=>Array.from(p).length>8&&/[\u3040-\u9fff]/u.test(p)?Array.from(p):[p]));
  const duplicates=(values:string[])=>values.length-new Set(values).size;
  const grams=tokens.slice(2).map((_,i)=>JSON.stringify(tokens.slice(i,i+3))),heads=normalized.filter(Boolean).map(t=>Array.from(t).slice(0,10).join(''));
  const sorted=(key:string)=>turns.map(t=>t.telemetry?.[key]).filter(v=>typeof v==='number').sort((a,b)=>a-b);
  const first=sorted('first_reply_ms'),speeds=sorted('tokens_per_second'),median=(a:number[])=>a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null;
  const structured=turns.filter(t=>t.validation),budgets=turns.map(t=>t.token_budget?.total_prompt_tokens).filter(v=>typeof v==='number');
  const result:Turn={turn_count:n,char_count:counts.reduce((a,b)=>a+b,0),avg_chars:average(counts)??0,max_chars:Math.max(0,...counts),
    repetition_score:n>=5&&tokens.length>=10?metricRound(Math.min(1,duplicates(grams)/grams.length*.7+duplicates(heads)/n*.3),3):null,
    failure_rate:n?metricRound(turns.filter(t=>(t.status??'completed')!=='completed'||String(t.assistant??'').includes('[error:')).length/n,3):0,
    empty_rate:n?metricRound(texts.filter(t=>!t.trim()).length/n,3):0,avg_elapsed_ms:average(turns.map(t=>t.elapsed_ms).filter(v=>typeof v==='number'))};
  if(n)Object.assign(result,{first_reply_ms_median:median(first),first_reply_ms_p95:first.length?first[Math.ceil(first.length*.95)-1]:null,tokens_per_second_median:median(speeds),
    first_attempt_success_rate:structured.length?metricRound(structured.filter(t=>t.validation.ok&&t.validation.retries===0).length/structured.length,3):null,
    validation_retries:structured.reduce((sum,t)=>sum+(t.validation.retries??0),0),peak_estimated_prompt_tokens:budgets.length?Math.max(...budgets):null});
  return result;
}
