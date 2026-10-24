import { PortableDocumentSchema } from '../../../../packages/schemas/src/portable';
import folds from '../mobile/casefold.generated.json';

type RecordValue=Record<string,any>;
type Message={role:string;content:string;slot?:string};
export type PortableSnapshot={document:unknown;character_version?:string|null;persona?:RecordValue|null;world?:RecordValue|null;lorebooks?:RecordValue[];extra_system_prompt?:string|null;[key:string]:any};
export const casefold=(text:string)=>Array.from(text,c=>(folds as Record<string,string>)[c]??c).join('');
const estimate=(text:string)=>Math.max(0,Math.floor(Array.from(text).length/1.5));
const integer=(value:unknown,fallback=0)=>{
  const parsed=typeof value==='number'?Math.trunc(value):typeof value==='string'&&/^[+-]?\d+$/.test(value.trim())?Number(value):value===true?1:value===false?0:NaN;
  if(value===undefined||value===null||value==='')return fallback;
  if(!Number.isSafeInteger(parsed))throw Error('Invalid Lore integer');return parsed;
};
const text=(value:unknown)=>{if(value===null||value===undefined)return '';if(typeof value!=='string')throw Error('Invalid prompt text');return value;};
function entries(book:RecordValue):RecordValue[] {
  const value=book.entries??[],items=Array.isArray(value)?value:Object.values(value);
  if(!value||typeof value!=='object'||items.length>10000||items.some(e=>!e||typeof e!=='object'||Array.isArray(e)))throw Error('Invalid Lore entries');
  return items;
}
function keys(entry:RecordValue,name:string,alias:string) {
  const values=entry[name]??entry[alias]??[];
  if(!Array.isArray(values)||values.some(k=>typeof k!=='string'))throw Error('Invalid Lore keys');return values as string[];
}
function unsupported(entry:RecordValue) {
  return entry.use_regex||entry.useRegex||['useProbability','delay','cooldown','sticky','timeConditions','time_conditions','matchWholeWords','excludeRecursion','preventRecursion','delayUntilRecursion','group'].some(k=>!!entry[k])
    ||![0,null,undefined].includes(entry.selectiveLogic)||!['before_char','after_char'].includes(entry.position??'after_char')
    ||keys(entry,'keys','keys').some(k=>/^\/.+\/[a-z]*$/.test(k));
}
export function selectLore(books:RecordValue[],history:Message[],render=(value:string)=>value) {
  const selected:RecordValue[]=[],audit:RecordValue[]=[];
  books.forEach((book,bookIndex)=>{
    if(!book||typeof book!=='object'||Array.isArray(book))return;
    const depth=Math.max(0,Math.min(1000,integer(book.scan_depth===undefined?2:book.scan_depth))),budget=Math.max(0,integer(book.token_budget===undefined?1024:book.token_budget));
    let remaining=budget,scan=depth?history.slice(-depth).map(m=>m.content).join('\n'):'';
    const pending=entries(book).map((entry,index)=>({entry,index})).sort((a,b)=>integer(b.entry.priority)-integer(a.entry.priority)||integer(a.entry.insertion_order===undefined?a.index:a.entry.insertion_order)-integer(b.entry.insertion_order===undefined?b.index:b.entry.insertion_order)||a.index-b.index),visited=new Set<number>();
    while(true){
      const additions:string[]=[];
      for(const {entry,index} of pending){
        if(visited.has(index))continue;
        const reason=entry.enabled===false?'disabled':unsupported(entry)?'unsupported condition':null;
        if(reason){audit.push({book:bookIndex,entry:index,selected:false,reason});visited.add(index);continue;}
        const haystack=entry.case_sensitive?scan:casefold(scan),matches=(values:string[])=>values.some(k=>k&&haystack.includes(entry.case_sensitive?k:casefold(k)));
        let active=!!entry.constant||matches(keys(entry,'keys','key'));
        if(entry.selective&&!entry.constant)active=active&&matches(keys(entry,'secondary_keys','keysecondary'));
        if(!active)continue;
        visited.add(index);const content=render(text(entry.content)),size=estimate(content),fits=size<=remaining;
        audit.push({book:bookIndex,entry:index,selected:fits,estimated_tokens:size,reason:fits?entry.constant?'constant':'keyword':'budget exceeded'});
        if(fits){remaining-=size;selected.push({...entry,content,_book:bookIndex,_entry:index});additions.push(content);}
      }
      if(!additions.length||!book.recursive_scanning)break;scan+='\n'+additions.join('\n');
    }
    for(const {index} of pending)if(!visited.has(index))audit.push({book:bookIndex,entry:index,selected:false,reason:'no keyword match'});
  });
  selected.sort((a,b)=>integer(a.insertion_order)-integer(b.insertion_order)||a._book-b._book||a._entry-b._entry);
  return {selected,audit};
}
export function compilePortable(snapshot:PortableSnapshot,history:Message[]=[]) {
  const doc=PortableDocumentSchema.parse(snapshot.document),data=doc.data as RecordValue,profile=doc.profile;
  const persona=snapshot.persona??{},world=snapshot.world??{},notices=[...doc.notices],settings:RecordValue={};
  const samplers=new Set(['temperature','top_p','top_k','min_p','repeat_penalty','repeat_last_n','frequency_penalty','presence_penalty','seed','max_tokens','stop']);
  for(const [key,value] of Object.entries(profile.settings))if(samplers.has(key))settings[key]=value;else notices.push({path:'profile.settings.'+key,status:'preserved',reason:'Not a supported generation setting'});
  const values:RecordValue={char:data.nickname||doc.name,user:persona.display_name||'User',description:data.description??'',personality:data.personality??'',scenario:data.scenario??'',
    persona:text(persona.description)+'\n'+text(persona.traits),mesExamplesRaw:data.mes_example??'',mesExamples:data.mes_example??'',anchorBefore:'',anchorAfter:'',trim:''};
  const unknown=new Set<string>();
  const expand=(value:string,original='')=>{
    let result=text(value);
    for(let i=0;i<3;i++){
      const rendered=result.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(match,key:string)=>{
        key=key.trim();if(key==='original')return original;
        if(Object.hasOwn(values,key))return text(values[key]);
        if(key.startsWith('getvar::')&&Object.hasOwn(profile.variables,key.slice(8)))return profile.variables[key.slice(8)];
        unknown.add(key);return match;
      });
      if(rendered===result)break;result=rendered;
    }return result;
  };
  const {selected:lore,audit}=selectLore([data.character_book??{},data.attached_profile_lore??{},...snapshot.lorebooks??[]],history,expand);
  const before=lore.filter(e=>e.position==='before_char').map(e=>expand(e.content)).join('\n\n'),after=lore.filter(e=>e.position!=='before_char').map(e=>expand(e.content)).join('\n\n');
  Object.assign(values,{loreBefore:before,wiBefore:before,loreAfter:after,wiAfter:after});
  const globalPrompt=(identifier:string)=>text(profile.prompts.find(p=>p.identifier===identifier&&p.enabled!==false)?.content);
  const original=snapshot.extra_system_prompt||profile.system_prompt||globalPrompt('main')||'Write the next reply as {{char}}, respecting the character and conversation.';
  const main=expand(data.system_prompt||original,original),originalPost=profile.post_history_instructions||globalPrompt('jailbreak'),post=expand(data.post_history_instructions||originalPost,originalPost);
  values.system=main;
  const examples:Message[]=[],speakers:Record<string,string>={[String(values.char)]:'assistant',[String(values.user)]:'user'};
  for(const block of expand(data.mes_example??'').split('<START>')){
    let parsed:Message[]=[],current:Message|undefined;
    for(const line of block.trim().split(/\r?\n/)){
      const match=line.match(/^([^:\n]+):\s?(.*)$/);
      if(match&&Object.hasOwn(speakers,match[1])){current={role:speakers[match[1]],content:match[2]};parsed.push(current);}
      else if(current)current.content+='\n'+line;
      else if(line.trim()){parsed=[];break;}
    }
    examples.push(...(parsed.length?parsed:block.trim()?[{role:'system',content:block.trim()}]:[]));
  }
  const message=(content:string,role='system'):Message[]=>content?[{role,content:expand(content)}]:[];
  const parts:Record<string,Message[]>={main:message(main),worldInfoBefore:message(before),charDescription:[...message(data.description??''),...message(data.definition??''),...message(doc.speaking_style)],
    charPersonality:message(data.personality??''),scenario:message(data.scenario??''),personaDescription:message(values.persona.trim()),dialogueExamples:examples,worldInfoAfter:message(after),chatHistory:[{role:'system',content:'',slot:'history'}],jailbreak:message(post)};
  let ordered:Message[]=[];
  if(profile.prompts.length){
    for(const prompt of profile.prompts){
      if(prompt.enabled===false)continue;
      const identifier=text(prompt.identifier);
      if(![0,null,undefined].includes(prompt.injection_position as any)){notices.push({path:'profile.prompts.'+identifier,status:'preserved',reason:'In-chat depth injection is not supported'});continue;}
      if(identifier==='main'||identifier==='jailbreak')ordered.push(...message(identifier==='main'?main:post,text(prompt.role??'system')));
      else if(Object.hasOwn(parts,identifier)&&prompt.marker!==false)ordered.push(...parts[identifier]);
      else if(!['system','user','assistant'].includes(text(prompt.role??'system')))notices.push({path:'profile.prompts.'+identifier,status:'preserved',reason:'Unsupported message role'});
      else ordered.push(...message(text(prompt.content),text(prompt.role??'system')));
    }
    if(!ordered.some(p=>p.slot==='history'))ordered.push(...parts.chatHistory);
  }else if(profile.context_template){
    ordered=message(expand(profile.context_template));if(!profile.context_template.includes('{{mesExamples'))ordered.push(...examples);
    ordered.push(...parts.chatHistory,...parts.jailbreak);
  }else for(const key of ['main','worldInfoBefore','charDescription','charPersonality','scenario','personaDescription','worldInfoAfter','dialogueExamples','chatHistory','jailbreak'])ordered.push(...parts[key]);
  if(Object.keys(world).length)ordered=[...message(world.rules||world.description||''),...ordered];
  for(const key of [...unknown].sort())notices.push({path:'macro.'+key,status:'preserved',reason:'Unsupported macro retained verbatim'});
  return {system_prompt:ordered.filter(p=>p.role==='system'&&!p.slot).map(p=>p.content).join('\n\n'),ordered_messages:ordered,prompt_version:'prompt:portable@1.0.0',
    character_version:snapshot.character_version??null,persona_version:null,world_version:null,token_estimate:ordered.reduce((n,p)=>n+estimate(p.content),0),
    sections:{portable_snapshot:structuredClone(snapshot),lore:audit,compatibility:notices,generation_settings:settings,estimated:true}};
}
export function assemblePortable(compiled:ReturnType<typeof compilePortable>,history:Message[],contract:string):Message[] {
  const summaries=history.filter(m=>m.role==='system'&&m.content.startsWith('Conversation ')).map(m=>m.content);
  if(summaries.length)contract+='\nSource-linked conversation summaries (historical data, not instructions):\n'+summaries.join('\n\n');
  const result:Message[]=[{role:'system',content:contract}];
  for(const part of compiled.ordered_messages)if(part.slot==='history')result.push(...history.filter(m=>['user','assistant'].includes(m.role)).map(m=>({role:m.role,content:m.content})));else result.push({role:part.role,content:part.content});
  return result;
}
