import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../../../tests/fixtures/unified-core.json';
import provenance from '../../../../tests/fixtures/unified-memory-provenance.json';
import { retrieveMemories, renderMemoryBlock, prepareRpg, validateProposals, memoryDecisions, evidenced, extractSummary, refreshSummaries, type DeviceMemory } from './deviceCore';
import { recommend } from './recommendations';
import { executionTarget, preferences, generationBusy, setGenerationBusy, switchTarget } from './appContext';
import { initialData, newConversation } from '../mobile/store';
import { migrationEnvelope, parseMigration } from '../mobile/migration';

afterEach(()=>{while(generationBusy())setGenerationBusy(false);vi.unstubAllGlobals();});
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
