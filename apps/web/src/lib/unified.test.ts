import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../../../tests/fixtures/unified-core.json';
import provenance from '../../../../tests/fixtures/unified-memory-provenance.json';
import { retrieveMemories, renderMemoryBlock, prepareRpg, validateProposals, memoryDecisions, evidenced, extractSummary, refreshSummaries, summaryRefresh, type DeviceMemory, type DeviceSummary } from './deviceCore';
import { recommend } from './recommendations';
import { executionTarget, preferences, generationBusy, setGenerationBusy, switchTarget } from './appContext';
import { initialData, newConversation } from '../mobile/store';
import { migrationEnvelope, parseMigration } from '../mobile/migration';

afterEach(()=>{while(generationBusy())setGenerationBusy(false);vi.unstubAllGlobals();});

// Keep the previous array algorithm as the compatibility oracle.
function previousExtractSummary(messages:{id:number|string;role:string;content:string}[]) {
  if(!messages.length)return '';
  const quota=Math.max(1,Math.floor((4000-messages.length*24)/messages.length));
  return Array.from(messages.map(m=>{const chars=Array.from(m.content);return `[${m.id}:${m.role}] ${chars.length<=quota?m.content:chars.slice(0,quota).join('')+'… [excerpt]'}`;}).join('\n')).slice(0,4000).join('');
}
function previousRefreshSummaries(messages:Parameters<typeof refreshSummaries>[0],existing:DeviceSummary[],sessionId:string) {
  const summaries:DeviceSummary[]=[];
  const put=(kind:DeviceSummary['kind'],ordinal:number,ids:number[],text:string)=>{
    const old=existing.find(s=>s.kind===kind&&s.ordinal===ordinal),unchanged=old&&JSON.stringify(old.source_message_ids)===JSON.stringify(ids);
    const preserve=unchanged&&(kind==='chapter'||old.method!=='extractive'||old.text===text);
    summaries.push(preserve?old:{id:old?.id??`${sessionId}:${kind}:${ordinal}`,kind,ordinal,text,source_message_ids:ids,method:'extractive',revision:(old?.revision??0)+1});
  };
  for(let i=0;i<Math.floor(messages.length/20);i++){const source=messages.slice(i*20,(i+1)*20);put('chapter',i,source.map(m=>m.id),previousExtractSummary(source));}
  const chapters=[...summaries];
  for(let i=0;i<Math.floor(chapters.length/10);i++){const source=chapters.slice(i*10,(i+1)*10);put('arc',i,source.flatMap(s=>s.source_message_ids),previousExtractSummary(source.map(s=>({id:s.id,role:'chapter',content:s.text}))));}
  return summaries;
}
const summaryMessages=(length:number)=>Array.from({length},(_,i)=>({id:1000+i*3,role:i%2?'assistant':'user',content:`turn ${i}\n${'猫🌸é'.repeat(i%3?2:300)}`}));

it('reads only a bounded Unicode prefix when extracting a summary from a huge message',()=>{
  const content='茶🙂é'.repeat(250000),original=String.prototype[Symbol.iterator];let reads=0;
  const spy=vi.spyOn(String.prototype,Symbol.iterator).mockImplementation(function(this:string){
    const iterator=original.call(this),next=iterator.next.bind(iterator),tracked=String(this)===content;
    iterator.next=()=>{if(tracked)reads++;return next();};return iterator;
  });
  let result:string;try{result=extractSummary([{id:1,role:'user',content}]);}finally{spy.mockRestore();}
  expect(result!).toBe(previousExtractSummary([{id:1,role:'user',content:'茶🙂é'.repeat(1100)}]));
  expect(reads).toBeLessThanOrEqual(4001);
});

it.each([0,1,19,20,21,199,200,201,219,220,399,400,419,420,439,600,621])('streams %i messages with the exact previous chapter/arc output',length=>{
  const messages=summaryMessages(length),before=structuredClone(messages),refresh=summaryRefresh([],'chat');
  for(const message of messages)refresh.push(message);
  const expected=previousRefreshSummaries(messages,[],'chat');
  expect(refresh.finish()).toEqual(expected);
  expect(refreshSummaries(messages,[],'chat')).toEqual(expected);
  expect(messages).toEqual(before);
  expect(expected.map(s=>s.kind)).toEqual([
    ...Array(Math.floor(length/20)).fill('chapter'),...Array(Math.floor(length/200)).fill('arc')
  ]);
});
it.each(['unchanged','content','source IDs'] as const)('preserves previous summary metadata and revisions with %s changes and incomplete tails',change=>{
  const messages=summaryMessages(439);
  const existing=previousRefreshSummaries(summaryMessages(620),[],'original').map(s=>({
    ...s,id:`custom:${s.kind}:${s.ordinal}`,revision:7,extra:{kept:s.ordinal},
    ...(s.kind==='chapter'&&[0,2].includes(s.ordinal)||s.kind==='arc'&&s.ordinal===1?{text:'手動🌸',method:'manual'}:{})
  }));
  const arc=existing.find(s=>s.kind==='arc'&&s.ordinal===0)!;
  arc.text='outdated extraction';
  if(change==='content')messages[40].content='changed content with the same source ID';
  if(change==='source IDs')messages[40].id=-1;
  const before=structuredClone({messages,existing}),refresh=summaryRefresh(existing,'chat');
  for(const message of messages)refresh.push(message);
  const result=refresh.finish(),expected=previousRefreshSummaries(messages,existing,'chat');
  expect(result).toEqual(expected);
  expect(refreshSummaries(messages,existing,'chat')).toEqual(expected);
  expect({messages,existing}).toEqual(before);
  expect(result).toHaveLength(23);
  for(const ordinal of [0,1,20])expect(result[ordinal]).toBe(existing[ordinal]);
  expect(result[2].revision).toBe(change==='source IDs'?8:7);
  expect(result[2].method).toBe(change==='source IDs'?'extractive':'manual');
  expect(result[21]).toMatchObject({id:'custom:arc:0',revision:8,method:'extractive'});
  expect(result[21]).not.toHaveProperty('extra');
  expect(result[22]).toBe(existing.find(s=>s.kind==='arc'&&s.ordinal===1));
});
it('matches shared Python memory and story fixtures',()=>{
  const m=fixture.memory,result=retrieveMemories(m.memories as DeviceMemory[],m.query);
  expect(result.injected).toEqual(m.injected);expect(result.injected_tokens).toEqual(m.tokens);
  expect(Object.fromEntries(result.candidates.map(c=>[c.id,c.decision]))).toEqual(m.decisions);
  const r=fixture.rpg,state=prepareRpg(r.options,{},r.input,r.generation_id,()=>r.die-1);
  expect(state).toEqual(r.expected);
  expect(prepareRpg(r.options,state,r.input,r.generation_id,()=>{throw Error('must not reroll');})).toEqual(state);
  expect(extractSummary(fixture.summary.messages)).toEqual(fixture.summary.expected);
});
it('does not promote invented memories or duplicate proposals',()=>{
  const out=validateProposals([{type:'semantic',content:'cats are nice',source_kind:'user_statement'},{type:'semantic',content:'cats are nice',source_kind:'user_statement'}],[],'I like tea');
  expect(out[0]).toMatchObject({supported:false,action:'store'});expect(out[1]).toMatchObject({reason:'duplicate'});
});
it.each(provenance.cases)('matches Python memory commit provenance: $name',test=>{
  const proposals=test.proposals as Parameters<typeof memoryDecisions>[0],existing=test.existing as DeviceMemory[];
  const before=structuredClone({proposals,existing});
  const decisions=memoryDecisions(proposals,existing,test.user_text,test.reply,test.source_revision);
  expect(decisions).toEqual(test.expected);
  expect({proposals,existing}).toEqual(before);
  const original=validateProposals(proposals,existing,test.user_text);
  expect(decisions.map(({type,content,source_kind,action})=>({type,content,source_kind,action})))
    .toEqual(original.map(({type,content,source_kind,action})=>({type,content,source_kind,action})));
  decisions.forEach((decision,index)=>{if(decision.action==='skip')expect(decision).toEqual(original[index]);});
});
it.each(provenance.evidence)('matches Python reply evidence: $name',test=>{
  expect(evidenced(test.content,test.reply)).toBe(test.expected);
});
it.each(provenance.render)('matches Python prompt memory source labels: $name',test=>{
  expect(renderMemoryBlock(test.memories as DeviceMemory[])).toBe(test.expected);
});
it('preserves edited summaries until source IDs change and links every source',()=>{
  const messages=Array.from({length:200},(_,i)=>({id:i+1,role:i%2?'assistant':'user',content:`turn ${i}`}));
  const first=refreshSummaries(messages,[],'chat');expect(first).toHaveLength(11);
  first[0]={...first[0],text:'edited',method:'manual',revision:2};
  const second=refreshSummaries(messages,first,'chat');expect(second[0]).toEqual(first[0]);
  expect(second.at(-1)?.source_message_ids).toHaveLength(200);expect(second.at(-1)?.text).toContain('edited');
});
it('filters age, block and moderation status before ranking favorites',()=>{
  const prefs={...preferences(),favorites:['adult','rated','blocked','pending','dismissed'],dismissed:['dismissed'],moods:['healing']};
  const items=[{id:'adult',nsfw:true},{id:'rated',rating:'adult' as const,nsfw:false},{id:'blocked',blocked:true},{id:'pending',status:'pending'},{id:'dismissed',official:true},{id:'plain'},{id:'comfort',tags:['healing']}];
  expect(recommend(items,prefs).map(c=>c.id)).toEqual(['comfort','plain']);
  expect(recommend(items,prefs,true).map(c=>c.id)).toEqual(['adult','rated','comfort','plain']);
});
it('ranks existing tag aliases without reading conversations or authored content',()=>{
  const items=[{id:'plain'},{id:'school',tags:['academy']},{id:'comfort',tags:['癒し']}];
  for(const item of items)Object.defineProperty(item,'messages',{get:()=>{throw Error('Conversation text must not be read');}});
  const prefs={...preferences(),genres:['school'],moods:['healing'],favorites:['plain']};
  expect(recommend(items,prefs).map(c=>c.id)).toEqual(['plain','school','comfort']);
  expect(recommend(items,{...prefs,dismissed:['plain']}).map(c=>c.id)).toEqual(['school','comfort']);
  expect(recommend(items,{...prefs,favorites:[],genres:[]}).map(c=>c.id)).toEqual(['comfort','plain','school']);
});
it('defaults unified entry to Cloud and prevents switching during save reconciliation',()=>{
  vi.stubGlobal('location',{hostname:'app.kyalulu.com',pathname:'/',assign:vi.fn()});
  vi.stubGlobal('window',{dispatchEvent:vi.fn()});vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
  expect(executionTarget()).toBe('cloud');setGenerationBusy(true);
  expect(()=>switchTarget('device')).toThrow('Stop generation');expect(location.assign).not.toHaveBeenCalled();
});
it.each([
  ['pc','/','',true],['cloud','/','',true],['device','/device/','',true],
  ['device','/','',false],['cloud','/device/','',false],['cloud','/','?fixture=1',false],
] as const)('replaces the execution context for %s from %s%s', (target,pathname,search,reload)=>{
  vi.stubGlobal('window',{});vi.stubGlobal('navigator',{userAgent:'Chromium'});
  const setItem=vi.fn();vi.stubGlobal('localStorage',{setItem});
  vi.stubGlobal('location',{protocol:'https:',pathname,search,hash:'/chats/fixture',assign:vi.fn(),reload:vi.fn()});
  switchTarget(target);
  expect(setItem).toHaveBeenCalledWith('kyalulu-execution-target',target);
  expect(location.reload).toHaveBeenCalledTimes(reload?1:0);
  if(reload){expect(location.hash).toBe('/');expect(location.assign).not.toHaveBeenCalled();}
  else expect(location.assign).toHaveBeenCalledWith((target==='device'?'/device/':'/')+'#/');
});
it('checks migration revision, byte length and SHA-256 before parsing',()=>{
  const data=initialData();data.conversations=[newConversation(data.characters[0],'kyalulu-iq3m')];
  data.conversations[0].draft='未送信🌸';
  const envelope=migrationEnvelope(data);expect(parseMigration(JSON.stringify(envelope)).data).toEqual(data);
  expect(()=>parseMigration(JSON.stringify({...envelope,payload:envelope.payload+' '}))).toThrow('SHA-256');
  expect(()=>parseMigration(JSON.stringify({...envelope,revision:2}))).toThrow('format');
  expect(()=>parseMigration(JSON.stringify({...envelope,bytes:1}))).toThrow('size');
});
