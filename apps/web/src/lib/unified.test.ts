import { afterEach, expect, it, vi } from 'vitest';
import fixture from '../../../../tests/fixtures/unified-core.json';
import { retrieveMemories, prepareRpg, validateProposals, extractSummary, refreshSummaries, type DeviceMemory } from './deviceCore';
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
it('preserves edited summaries until source IDs change and links every source',()=>{
  const messages=Array.from({length:200},(_,i)=>({id:i+1,role:i%2?'assistant':'user',content:`turn ${i}`}));
  const first=refreshSummaries(messages,[],'chat');expect(first).toHaveLength(11);
  first[0]={...first[0],text:'edited',method:'manual',revision:2};
  const second=refreshSummaries(messages,first,'chat');expect(second[0]).toEqual(first[0]);
  expect(second.at(-1)?.source_message_ids).toHaveLength(200);expect(second.at(-1)?.text).toContain('edited');
});
it('filters age, block and moderation status before ranking favorites',()=>{
  const prefs={...preferences(),favorites:['adult','blocked','pending'],moods:['healing']};
  const items=[{id:'adult',nsfw:true},{id:'blocked',blocked:true},{id:'pending',status:'pending'},{id:'plain'},{id:'comfort',tags:['healing']}];
  expect(recommend(items,prefs).map(c=>c.id)).toEqual(['comfort','plain']);
});
it('defaults unified entry to Cloud and prevents switching during save reconciliation',()=>{
  vi.stubGlobal('location',{hostname:'app.kyalulu.com',pathname:'/',assign:vi.fn()});
  vi.stubGlobal('window',{dispatchEvent:vi.fn()});vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
  expect(executionTarget()).toBe('cloud');setGenerationBusy(true);
  expect(()=>switchTarget('device')).toThrow('Stop generation');expect(location.assign).not.toHaveBeenCalled();
});
it('checks migration revision, byte length and SHA-256 before parsing',()=>{
  const data=initialData();data.conversations=[newConversation(data.characters[0],'kyalulu-iq3m')];
  data.conversations[0].draft='未送信🌸';
  const envelope=migrationEnvelope(data);expect(parseMigration(JSON.stringify(envelope)).data).toEqual(data);
  expect(()=>parseMigration(JSON.stringify({...envelope,payload:envelope.payload+' '}))).toThrow('SHA-256');
  expect(()=>parseMigration(JSON.stringify({...envelope,revision:2}))).toThrow('format');
  expect(()=>parseMigration(JSON.stringify({...envelope,bytes:1}))).toThrow('size');
});
