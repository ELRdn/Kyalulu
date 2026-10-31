import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { harness } from './idbHarness.test-support';
import { Sha256 } from '../mobile/sha256';
const fixture=vi.hoisted(()=>({owner:'receipt-owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),failAt:0,switchAt:0,writes:0,readParts:0}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),appTransaction:(_stores:string[],mode:string,action:any)=>harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action,{
  write:()=>{fixture.writes++;if(fixture.writes===fixture.failAt)throw Error('Fictional quota');if(fixture.writes===fixture.switchAt)fixture.owner='other-owner';},
  read:(_mode,name)=>{if(name==='parts')fixture.readParts++;},
})}));
import { appTransaction } from './appStore';
import { deviceExecutionLockName } from './deviceExecution';
import { writeGenerationReceipt,readGenerationHeader,readGenerationReceipt,readGenerationSnapshot,generationReceiptChunks,deleteGenerationReceipt,eraseGenerationMemoryReferences,type GenerationHolder,type GenerationHeader } from './deviceGenerationStore';
const owner='receipt-owner',holder:GenerationHolder={kind:'conversation',id:'chat'};
const hash=(value:string)=>new Sha256().update(new TextEncoder().encode(value)).digest();
const value=()=>({generation_id:'gen',session_id:'chat',status:'completed',user_id:1,assistant_id:2,execution_lock:deviceExecutionLockName(owner),
  user_content_sha256:hash('Original user'),reply:'Original reply',full:'Original reply',state:{keep:1},compiled:{system_prompt:'original compiler'},
  raw_prompt:'Original raw 茶🙂\\"\n',memory:{candidates:[{id:'m',content:'private trace'}]},attempts:[{number:1,raw:'exact output'}],
  telemetry:{tokens:3,memory:{candidates:[{id:'m',content:'private trace'}]}},extension:{keep:['unknown',7]}});
const snapshot=()=>structuredClone({meta:[...fixture.meta],parts:[...fixture.parts]});
async function save(receipt:any=value(),input?:readonly unknown[],scope:GenerationHolder=holder){
  return appTransaction<{header:GenerationHeader;summary:any}>(['meta','parts'],'readwrite',(tx,done)=>writeGenerationReceipt(tx,owner,scope,receipt,input,(header,summary)=>done({header,summary})));
}
async function full(scope=holder){const chunks:Uint8Array[]=[];for await(const chunk of generationReceiptChunks(owner,scope,'gen'))chunks.push(chunk);return JSON.parse(new TextDecoder().decode(new Uint8Array(chunks.flatMap(bytes=>Array.from(bytes)))));}
beforeEach(()=>{fixture.owner=owner;fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.failAt=0;fixture.switchAt=0;fixture.writes=0;fixture.readParts=0;});
afterEach(()=>vi.unstubAllGlobals());

it('stores canonical sections once, retains exact legacy JSON values and returns a compact summary',async()=>{
  const original=value(),saved=await save(original);
  expect(Object.keys(saved.header.sections).sort()).toEqual(['attempts','compiled','memory','prompt','receipt','telemetry']);
  expect(saved.summary).toMatchObject({generation_id:'gen',status:'completed',device_diagnostics:{state:'stored',holder}});
  for(const key of ['reply','full','state','compiled','raw_prompt','memory','attempts','telemetry','extension'])expect(saved.summary[key]).toBeUndefined();
  expect(JSON.stringify(saved.header)).not.toContain('private trace');expect(JSON.stringify(saved.header)).not.toContain('Original reply');
  expect(await full()).toEqual(original);
  const read=await readGenerationReceipt(owner,holder,'gen');expect(read.state).toBe('inline');if(read.state==='inline')expect(read.value).toEqual(original);
});
it.each(['absent','null','different'])('preserves the %s memory alias without manufacturing or losing fields',async kind=>{
  const original:any=value();if(kind==='absent'){delete original.memory;delete original.telemetry.memory;}
  if(kind==='null'){original.memory=null;original.telemetry.memory=null;}
  if(kind==='different')original.telemetry.memory={different:'original telemetry trace'};
  const saved=await save(original);expect(!!saved.header.sections.telemetryMemory).toBe(kind==='different');
  expect(await full()).toEqual(original);
});
it('writes exact pre-fit input bytes without constructing an aggregate raw_prompt',async()=>{
  const original:any=value();delete original.raw_prompt;
  const input=[{role:'system',content:'Quoted \\" 茶🙂\n\u0000\ud800'},{role:'user',content:'x'.repeat(2*1024*1024)}];
  const expectedRaw=JSON.stringify(input),stringify=JSON.stringify;
  const spy=vi.spyOn(JSON,'stringify').mockImplementation(((value:any,...args:any[])=>{if(value===input)throw Error('Aggregate raw prompt');return stringify(value,...args);}) as typeof JSON.stringify);
  let saved!:Awaited<ReturnType<typeof save>>;
  try{saved=await save(original,input);}finally{spy.mockRestore();}
  const ref=saved.header.sections.prompt!,bytes=[] as Uint8Array[];
  for(let index=0;index<ref.chunks;index++)bytes.push(fixture.parts.get(JSON.stringify([owner,'generation','gen',ref.token,index])));
  const raw=new Blob(bytes.map(bytes=>new Uint8Array(bytes)));expect(await raw.text()).toBe(expectedRaw);
  expect(bytes.every(bytes=>bytes.length<=1024*1024)).toBe(true);
  const inline=await readGenerationReceipt(owner,holder,'gen');expect(inline.state).toBe('stored');expect(inline.bytes).toBeGreaterThan(1_500_000);
  const exported=[] as Uint8Array[];for await(const bytes of generationReceiptChunks(owner,holder,'gen'))exported.push(bytes);
  expect(JSON.parse(await new Blob(exported.map(bytes=>new Uint8Array(bytes))).text())).toEqual({...original,raw_prompt:expectedRaw});
});
it('counts both expanded trace aliases at the inline boundary',async()=>{
  const original=value(),trace={candidates:[],content:'x'.repeat(800000)};original.memory=trace as any;original.telemetry.memory=trace as any;
  const saved=await save(original);expect(saved.header.sections.telemetryMemory).toBeUndefined();
  const read=await readGenerationReceipt(owner,holder,'gen');expect(read.state).toBe('stored');expect(read.bytes).toBeGreaterThan(1_500_000);
});
it.each(['quota','owner'])('rolls back section/header writes on %s failure',async fault=>{
  const before=snapshot();if(fault==='quota')fixture.failAt=3;else fixture.switchAt=3;
  await expect(save()).rejects.toThrow();expect(snapshot()).toEqual(before);
});
it('does not overwrite an already completed or foreign pending receipt',async()=>{
  await save();let before=snapshot();await expect(save()).rejects.toThrow();expect(snapshot()).toEqual(before);
  fixture.meta.set('generation:'+owner+':gen',{...value(),status:'pending',session_id:'other'});before=snapshot();
  await expect(save()).rejects.toThrow();expect(snapshot()).toEqual(before);
});
it('rejects embedded local references rather than exporting a dangling diagnostic graph',async()=>{
  const before=snapshot();await expect(save({...value(),device_diagnostics:{generation_id:'foreign'}})).rejects.toThrow();expect(snapshot()).toEqual(before);
});
it.each(['owner','holder','catalog','missing','checksum'])('rejects %s mismatch before accepting a saved result',async fault=>{
  const {header}=await save();
  if(fault==='owner')fixture.owner='other-owner';
  if(fault==='holder')holder.id='other-chat';
  if(fault==='catalog')fixture.meta.get('generation:'+owner+':gen').reply_sha256='0'.repeat(64);
  if(fault==='missing')fixture.parts.delete(JSON.stringify([owner,'generation','gen',header.sections.prompt!.token,0]));
  if(fault==='checksum')fixture.parts.get(JSON.stringify([owner,'generation','gen',header.sections.prompt!.token,0]))[1]^=1;
  try{await expect(readGenerationReceipt(owner,holder,'gen')).rejects.toThrow();}finally{holder.id='chat';}
});
it('stops a pinned export if the catalog changes after a yielded prefix',async()=>{
  await save();const iterator=generationReceiptChunks(owner,holder,'gen');expect((await iterator.next()).done).toBe(false);
  fixture.meta.get('generation:'+owner+':gen').status='deleted';
  await expect((async()=>{for await(const _ of iterator){/* Require a validated EOF. */}})()).rejects.toThrow();
});
it('reads a legacy receipt without rewriting it or touching parts',async()=>{
  const original=value();fixture.meta.set('generation:'+owner+':gen',original);const before=snapshot();
  const read=await readGenerationReceipt(owner,holder,'gen');expect(read.state).toBe('inline');if(read.state==='inline')expect(read.value).toEqual(original);
  expect(snapshot()).toEqual(before);expect(fixture.readParts).toBe(0);
});
it('physically removes only the selected receipt closure and retains a scoped tombstone',async()=>{
  const {header}=await save();fixture.parts.set('unrelated',new Uint8Array([7]));
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>deleteGenerationReceipt(tx,header,done));
  expect([...fixture.parts]).toEqual([['unrelated',new Uint8Array([7])]]);
  expect(await readGenerationHeader(owner,holder,'gen')).toEqual({generation_id:'gen',session_id:'chat',status:'deleted'});
});
it('loads only the exact saved compiler snapshot for replay',async()=>{
  const original:any=value(),snapshot={document:{name:'Original character',data:{description:'authored'}},version:3};
  original.compiled={system_prompt:'x'.repeat(2*1024*1024),ordered_messages:[{role:'user',content:'Ignored history'}],sections:{portable_snapshot:snapshot,ignored:{content:'trace'}}};
  await save(original);expect(await readGenerationSnapshot(owner,holder,'gen')).toEqual(snapshot);
});
it.each(['conversation','research'] as const)('erases referenced diagnostics for an older %s holder without deleting its authored output',async kind=>{
  const scope:GenerationHolder={kind,id:kind==='research'?'experiment':'chat'},original:any=value();
  original.session_id=kind==='research'?'exp:experiment':'chat';original.memory.candidates[0].source_session_id='source-chat';
  original.telemetry.memory=original.memory;original.validation={ok:true,errors:['private error']};
  const {header}=await save(original,undefined,scope),old=structuredClone(header.sections);
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>eraseGenerationMemoryReferences(tx,header,'source-chat',new Set(),updated=>{
    expect(updated?.diagnostics_state).toBe('erased');done();
  }));
  const result=await full(scope);expect(result.reply).toBe(original.reply);expect(result.full).toBe(original.full);expect(result.extension).toEqual(original.extension);
  expect(result.memory.candidates).toEqual([]);expect(result.telemetry.memory).toEqual(result.memory);expect(result.validation.errors).toEqual([]);
  expect(result.erased_memory_source).toBe('source-chat');
  for(const name of ['raw_prompt','compiled','attempts'])expect(result[name]).toBeUndefined();
  const updated=(await readGenerationHeader(owner,scope,'gen')) as GenerationHeader;
  expect(updated.sections.telemetry?.token).toBe(old.telemetry?.token);
  for(const name of ['receipt','prompt','memory','compiled','attempts'] as const)expect([...fixture.parts.keys()].some(key=>key.includes(old[name]!.token))).toBe(false);
});
it('preserves all original sections when erasure fails and leaves unrelated traces byte-identical',async()=>{
  const {header}=await save(),before=snapshot();
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>eraseGenerationMemoryReferences(tx,header,'unrelated',new Set(),updated=>{expect(updated).toBeUndefined();done();}));
  expect(snapshot()).toEqual(before);
  fixture.failAt=fixture.writes+3;
  await expect(appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>eraseGenerationMemoryReferences(tx,header,'source',new Set(['m']),()=>done()))).rejects.toThrow();
  expect(snapshot()).toEqual(before);
});
