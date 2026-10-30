import { RPGOptionsSchema, type RPGOptions } from '../../../../packages/schemas/src/story';
import { casefold } from './devicePrompt';
import { MemoryOptionsSchema } from '../../../../packages/schemas/src';

export const normalizeMemory = (text:string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
export function memoryBigrams(text:string) {
  const chars=Array.from(normalizeMemory(text));
  return new Set(chars.length<2?chars:chars.slice(1).map((c,i)=>chars[i]+c));
}
export function evidenced(memoryContent:string,reply:string) {
  const grams=memoryBigrams(memoryContent),evidence=memoryBigrams(reply);
  return grams.size>=2&&[...grams].filter(g=>evidence.has(g)).length/grams.size>=.3;
}
export function estimateTokens(text:string) {
  const chars=Array.from(text),cjk=chars.filter(c=>c.codePointAt(0)!>0x2e80).length;
  return Math.max(1,Math.ceil(cjk/1.5+(chars.length-cjk)/4));
}
export type DeviceMemory={id:string;type:'semantic'|'episodic'|'relationship';content:string;
  origin:string;supported:boolean|null;status:string;source_kind?:string;[key:string]:any};
export function renderMemoryBlock(memories:DeviceMemory[]) {
  return memories.length?'\nRelevant memory (remembered from earlier conversation; use it naturally when it fits, do not recite it, and never invent memories that are not listed):\n'
    +memories.map(m=>`- [${m.type}] ${m.content}`+(m.source_kind?` (source: ${m.source_kind}; story events are fictional, not user biography)`:'')).join('\n'):'';
}
export function retrieveMemories(memories:DeviceMemory[],query:string,options:unknown={}) {
  const {top_k,budget_tokens,min_score,fill_recent}=MemoryOptionsSchema.parse(options);
  const q=memoryBigrams(query);
  const ranked=memories.filter(m=>m.status==='active').map((m,i)=>{
    const grams=memoryBigrams(m.content);
    const overlap=[...grams].filter(g=>q.has(g)).length;
    const score=Math.round(Math.max(Math.min(1,grams.size?overlap/Math.sqrt(grams.size)/2:0),m.type==='relationship'?.2:0)*10000)/10000;
    return {...m,recency:i,score,decision:''};
  }).sort((a,b)=>b.score-a.score||a.recency-b.recency);
  let used=0;const injected:string[]=[];
  for(const m of ranked) {
    const tokens=estimateTokens(m.content)+4;
    m.decision=m.supported===false&&m.origin==='model'?'unverified':m.score<min_score?'below_threshold':injected.length>=top_k?'over_top_k':used+tokens>budget_tokens?'over_budget':'injected';
    if(m.decision==='injected'){used+=tokens;injected.push(m.id);}
  }
  for(const m of ranked.filter(m=>fill_recent&&m.decision==='below_threshold').sort((a,b)=>b.recency-a.recency)) {
    const tokens=estimateTokens(m.content)+4;
    if(injected.length>=top_k||used+tokens>budget_tokens)continue;
    m.decision='recent_fill';used+=tokens;injected.push(m.id);
  }
  return {query,candidates:ranked,injected,injected_tokens:used,top_k,budget_tokens,min_score,fill_recent};
}
export function prepareRpg(raw:unknown, state:Record<string,any>, input:string, generationId:string,
  roll=()=>crypto.getRandomValues(new Uint32Array(1))[0]) {
  const options:RPGOptions=RPGOptionsSchema.parse(raw);
  if(new Set(options.actions.map(a=>casefold(a.trigger))).size!==options.actions.length)throw Error('RPG action triggers must be unique');
  const rpg=structuredClone(Object.keys(state).length?state:{hp:options.initial_hp,inventory:options.initial_inventory,skills:options.skills,rolls:[]});
  if((rpg.rolls??[]).some((r:any)=>r.generation_id===generationId))return rpg;
  for(const action of options.actions) {
    if(casefold(action.trigger.trim())!==casefold(input.trim()))continue;
    const inventory=[...rpg.inventory] as string[];
    const eligible=action.inventory_remove.every(item=>inventory.filter(v=>v===item).length>=action.inventory_remove.filter(v=>v===item).length);
    let die:number|null=null;
    if(eligible){let n=roll();while(n>=4294967280)n=roll();die=n%20+1;}
    const modifier=options.skills[action.skill]??0;
    const success=eligible&&die!==null&&die+modifier>=action.difficulty;
    if(success) {
      for(const item of action.inventory_remove)inventory.splice(inventory.indexOf(item),1);
      inventory.push(...action.inventory_add);
      if(inventory.length>100)throw Error('RPG inventory capacity exceeded');
      rpg.inventory=inventory;rpg.hp=Math.max(0,Math.min(options.initial_hp,rpg.hp+action.hp_delta));
    }
    rpg.rolls=[...(rpg.rolls??[]),{generation_id:generationId,action_id:action.id,die,modifier,difficulty:action.difficulty,success,reason:eligible?'rolled':'missing_inventory'}].slice(-20);
  }
  return rpg;
}

type Proposal={type:DeviceMemory['type'];content:string;source_kind:string};
export function validateProposals(proposals:Proposal[],existing:DeviceMemory[],evidenceText:string) {
  const overlap=(a:Set<string>,b:Set<string>)=>b.size?[...b].filter(g=>a.has(g)).length/b.size:0;
  const seen=existing.filter(m=>m.supported!==false||m.confirmation==='user_confirmed').map(m=>({grams:memoryBigrams(m.content),kind:m.source_kind??'user_statement'}));
  const evidence=memoryBigrams(evidenceText);
  return proposals.slice(0,3).map(p=>{
    const content=p.content.trim().replace(/\s+/gu,' '),grams=memoryBigrams(content),item={...p,content};
    if(Array.from(normalizeMemory(content)).length<2)return {...item,action:'skip' as const,reason:'too_short'};
    if(seen.some(s=>s.kind===p.source_kind&&overlap(s.grams,grams)>=.8&&overlap(grams,s.grams)>=.8))return {...item,action:'skip' as const,reason:'duplicate'};
    seen.push({grams,kind:p.source_kind});return {...item,action:'store' as const,supported:overlap(evidence,grams)>=.3};
  });
}
export function memoryDecisions(proposals:Proposal[],existing:DeviceMemory[],userText:string,reply:string,sourceRevision:string|null) {
  return validateProposals(proposals,existing,userText).map(d=>{
    if(d.action!=='store')return d;
    const quote=d.source_kind==='story_event'?reply:userText;
    const supported=d.source_kind==='work_setting'?false:d.source_kind==='story_event'?evidenced(d.content,reply):d.supported;
    return {...d,supported,confirmation:'unverified',source_quote:Array.from(quote).slice(0,2000).join(''),source_revision:sourceRevision};
  });
}
type Message={id:number;role:string;content:string};
export type DeviceSummary={id:string;kind:'chapter'|'arc';ordinal:number;text:string;revision:number;source_message_ids:number[];method:string};
export function extractSummary(messages:{id:number|string;role:string;content:string}[]) {
  if(!messages.length)return '';
  const quota=Math.max(1,Math.floor((4000-messages.length*24)/messages.length));
  return Array.from(messages.map(m=>{const chars=Array.from(m.content);return `[${m.id}:${m.role}] ${chars.length<=quota?m.content:chars.slice(0,quota).join('')+'… [excerpt]'}`;}).join('\n')).slice(0,4000).join('');
}
export function refreshSummaries(messages:Message[],existing:DeviceSummary[],sessionId:string) {
  const summaries:DeviceSummary[]=[];
  const put=(kind:DeviceSummary['kind'],ordinal:number,ids:number[],text:string)=>{
    const old=existing.find(s=>s.kind===kind&&s.ordinal===ordinal),unchanged=old&&JSON.stringify(old.source_message_ids)===JSON.stringify(ids);
    const preserve=unchanged&&(kind==='chapter'||old.method!=='extractive'||old.text===text);
    summaries.push(preserve?old:{id:old?.id??`${sessionId}:${kind}:${ordinal}`,kind,ordinal,text,source_message_ids:ids,method:'extractive',revision:(old?.revision??0)+1});
  };
  for(let i=0;i<Math.floor(messages.length/20);i++){const source=messages.slice(i*20,(i+1)*20);put('chapter',i,source.map(m=>m.id),extractSummary(source));}
  const chapters=[...summaries];
  for(let i=0;i<Math.floor(chapters.length/10);i++){const source=chapters.slice(i*10,(i+1)*10);put('arc',i,source.flatMap(s=>s.source_message_ids),extractSummary(source.map(s=>({id:s.id,role:'chapter',content:s.text}))));}
  return summaries;
}
