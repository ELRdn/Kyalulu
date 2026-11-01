import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { harness,decoded } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'source-owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),read:undefined as (()=>void)|undefined}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),
  appTransaction:(_stores:string[],mode:string,action:any)=>harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action,{read:(_mode,name)=>{if(name==='parts')fixture.read?.();}})}));
import { appTransaction,newEntity,writeEntity } from './appStore';
import { readMemorySource,readDeviceGenerationSource } from './deviceMemoryStore';
import { prepareDeviceGenerationSource } from './deviceGenerationSource';
import { visitConversationGenerationInput } from './deviceGenerationInput';
import { assemblePortable,compilePortable } from './devicePrompt';
import { PortableDocumentSchema } from '../../../../packages/schemas/src';
import { estimateTokens,refreshSummaries } from './deviceCore';
import type { GGUFSourceRun } from '../mobile/context';
const snapshot=()=>structuredClone({records:[...fixture.records],meta:[...fixture.meta],parts:[...fixture.parts]});
const original=()=>decoded(fixture.records.get(JSON.stringify(['source-owner','chat'])),fixture.parts);
beforeEach(()=>{fixture.owner='source-owner';fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.read=undefined;
  vi.stubGlobal('IDBKeyRange',{bound:(lower:unknown,upper:unknown)=>({lower,upper})});});
afterEach(()=>vi.unstubAllGlobals());
const merge=(messages:{role:string;content:string}[])=>{
  const runs:{run:number;role:string;content:string}[]=[];
  for(const message of messages){const last=runs.at(-1);if(last?.role===message.role)last.content+='\n\n'+message.content;else runs.push({run:runs.length,role:message.role,content:message.content});}
  return runs;
};
async function seed(count=47){
  const messages=Array.from({length:count},(_,index)=>({id:index+1,uuid:'id-'+index,role:index%3?'assistant':'user',
    content:`${index} 茶🙂\\"\n\u0000\ud800 `+'Original '.repeat(100),
    imported_state:index===2?'stopped':index===4?'interrupted':undefined,
    before:{state:{turn:index},memories:[],unknown:'Original before'},after:{state:{turn:index+1}},unknown:{keep:index}}));
  messages[5]={...messages[5],role:'system',content:'Conversation first source summary'};
  messages[9]={...messages[9],role:'system',content:'Conversation second source summary'};
  const entity={...newEntity('conversation','chat',{storage_policy:'local',summaries:[],pending_generation:'gen',messages}),revision:7};
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,entity,'put',done));
  return (await readMemorySource('chat','source-owner'))!;
}
it.each([false,true])('replays every original run/canonical byte and full summaries across repeated slots (regenerate=%s)',async regenerate=>{
  const source=await seed(),stored=original(),replaced=regenerate?stored.payload.messages.at(-1).id:undefined;
  const history=stored.payload.messages.filter((message:any)=>message.id!==replaced),ordered=[
    {role:'system',content:'Static before'},{role:'system',content:'',slot:'history'},
    {role:'assistant',content:'Static between'},{role:'system',content:'',slot:'history'},{role:'system',content:'Static after'}];
  const compiled={ordered_messages:ordered} as any,expected=assemblePortable(compiled,history.filter((m:any)=>!['stopped','interrupted'].includes(m.imported_state)),'Contract');
  const before=snapshot(),prepared=await prepareDeviceGenerationSource(source,compiled,'Contract',256,replaced);
  expect(prepared.tokenEstimate).toBe(expected.reduce((n,m)=>n+estimateTokens(m.content),0));
  const reference=merge(expected),actual=await prepared.runtime.materialize(prepared.runtime.runs);
  expect(actual).toEqual(reference);
  expect(prepared.runtime.runs).toEqual(reference.map(({run,role,content})=>({run,role,bytes:new TextEncoder().encode(content).length})));
  expect(await prepared.runtime.materialize(prepared.runtime.runs.filter((_,index)=>index%3===0))).toEqual(reference.filter((_,index)=>index%3===0));
  const canonical:any[]=[];await appTransaction<void>(['entities','parts'],'readonly',(tx,done)=>
    visitConversationGenerationInput(tx,'source-owner','chat',prepared.canonical,message=>canonical.push(message),done));
  expect(JSON.stringify(canonical)).toBe(JSON.stringify(expected));
  const reply={id:1001,role:'assistant',content:'New reply'};prepared.summaries.push(reply);
  expect(prepared.summaries.finish()).toEqual(refreshSummaries([...history,reply],source.metadata.summaries,'chat'));
  expect(snapshot()).toEqual(before);
});
it('keeps at most the requested actor tail while verifying all older bodies and source metadata',async()=>{
  await seed(2050);const stored=original(),source=await readDeviceGenerationSource('chat','source-owner',1001);
  expect(source!.messages).toEqual(stored.payload.messages.slice(-1001).map(({id,uuid,role,content,imported_state}:any)=>({id,uuid,role,content,imported_state})));
  expect(source!.latest).toEqual(stored.payload.messages.at(-1));
  const document=PortableDocumentSchema.parse({name:'Lore boundary',data:{character_book:{scan_depth:1000,token_budget:1000,entries:[
    {keys:['1048 茶'],content:'Outside the regeneration Lore window'},
    {keys:['1049 茶'],content:'Inside the regeneration Lore window'}]}}});
  const full=compilePortable({document},stored.payload.messages.slice(0,-1));
  expect(compilePortable({document},source!.messages.slice(0,-1))).toEqual(full);
  expect(full.system_prompt).toContain('Inside the regeneration Lore window');
  expect(full.system_prompt).not.toContain('Outside the regeneration Lore window');
  const prepared=await prepareDeviceGenerationSource(source!.source,{ordered_messages:[{role:'system',content:'',slot:'history'}]} as any,'Contract',256);
  expect(prepared.canonical.contract).toContain('Conversation first source summary');
  expect(prepared.canonical.contract).toContain('Conversation second source summary');
  prepared.summaries.push({id:3000,role:'assistant',content:'Reply'});
  expect(prepared.summaries.finish()).toEqual(refreshSummaries([...stored.payload.messages,{id:3000,role:'assistant',content:'Reply'}],[],'chat'));
  await expect(readDeviceGenerationSource('chat','source-owner',1)).rejects.toThrow();
});
it('pins compiled order and complete existing summary objects before the first asynchronous read',async()=>{
  await seed();const stored=original();stored.payload.summaries=refreshSummaries(stored.payload.messages,[],'chat');
  stored.payload.summaries[0].text='Preserved authored chapter';
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,stored,'put',done));
  const source=(await readMemorySource('chat','source-owner'))!,existing=structuredClone(source.metadata.summaries);
  const compiled={ordered_messages:[{role:'system',content:'Fixed compiler'}, {role:'system',content:'',slot:'history'}]} as any;
  fixture.read=()=>{fixture.read=undefined;compiled.ordered_messages[0].content='Changed compiler';compiled.ordered_messages.length=1;
    source.metadata.summaries[0].text='Changed authored chapter';source.metadata.summaries.length=0;};
  const prepared=await prepareDeviceGenerationSource(source,compiled,'Contract',256);
  expect(prepared.canonical.ordered).toEqual([{role:'system',content:'Fixed compiler'}, {role:'system',content:'',slot:'history'}]);
  expect((await prepared.runtime.materialize(prepared.runtime.runs))[0].content).toContain('Fixed compiler');
  expect(prepared.summaries.finish()).toEqual(existing);
  expect(original().payload.summaries[0].text).toBe('Preserved authored chapter');
});
it('uses the validated selection snapshot after an asynchronous read',async()=>{
  const source=await seed(),prepared=await prepareDeviceGenerationSource(source,{ordered_messages:[{role:'system',content:'',slot:'history'}]} as any,'Contract',256);
  const selected=[{...prepared.runtime.runs[0]}];
  fixture.read=()=>{fixture.read=undefined;selected[0].role='assistant';selected[0].run=1;selected.length=0;};
  expect(await prepared.runtime.materialize(selected)).toEqual([{run:0,role:'system',content:prepared.canonical.contract}]);
});
it.each(['owner','revision','body','checksum','abort'])('publishes no prepared context after %s failure',async fault=>{
  const source=await seed(),controller=new AbortController();
  if(fault==='owner')fixture.owner='foreign';if(fault==='revision')source.revision++;if(fault==='body')source.bodyToken=crypto.randomUUID();
  if(fault==='abort')fixture.read=()=>controller.abort();
  if(fault==='checksum'){const header=fixture.records.get(JSON.stringify(['source-owner','chat'])),ref=header.payloadParts;
    fixture.parts.get(JSON.stringify(['source-owner','entity','chat',ref.token,ref.chunks-1]))[ref.size-1]^=1;}
  const before=snapshot();await expect(prepareDeviceGenerationSource(source,{ordered_messages:[]} as any,'Contract',256,undefined,controller.signal)).rejects.toThrow();
  expect(snapshot()).toEqual(before);
});
it.each(['revision','body','checksum','owner','abort','selection'])('rejects stale or invalid %s materialization, including an empty selection',async fault=>{
  const source=await seed(),controller=new AbortController(),prepared=await prepareDeviceGenerationSource(source,{ordered_messages:[{role:'system',content:'',slot:'history'}]} as any,'Contract',256,undefined,controller.signal);
  let selected:readonly GGUFSourceRun[]=[];const header=fixture.records.get(JSON.stringify(['source-owner','chat']));
  if(fault==='revision')header.revision++;if(fault==='body')header.payloadParts.token=crypto.randomUUID();
  if(fault==='owner')fixture.owner='foreign';if(fault==='abort')fixture.read=()=>controller.abort();
  if(fault==='selection')selected=[{...prepared.runtime.runs[0],bytes:0}];
  if(fault==='checksum'){const ref=header.payloadParts;fixture.parts.get(JSON.stringify(['source-owner','entity','chat',ref.token,ref.chunks-1]))[ref.size-1]^=1;}
  const before=snapshot();await expect(prepared.runtime.materialize(selected)).rejects.toThrow();expect(snapshot()).toEqual(before);
});
