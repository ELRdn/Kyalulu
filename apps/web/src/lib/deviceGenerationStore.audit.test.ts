import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { harness } from './idbHarness.test-support';

const fixture=vi.hoisted(()=>({
  owner:'audit-owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),
  writes:0,failAt:0,switchAt:0,readParts:0,onPartRead:undefined as (()=>void)|undefined,
}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),
  appTransaction:(_stores:string[],mode:string,action:any)=>harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action,{
    write:()=>{fixture.writes++;if(fixture.writes===fixture.failAt)throw Error('Audit quota');if(fixture.writes===fixture.switchAt)fixture.owner='other-owner';},
    read:(_mode,name)=>{if(name==='parts'){fixture.readParts++;fixture.onPartRead?.();}},
  }),
}));
import { appTransaction } from './appStore';
import { canonical } from './appSyncData';
import { SYNC_INLINE_BYTES } from './appTransfers';
import { deviceExecutionLockName } from './deviceExecution';
import { JsonStream } from './jsonStream';
import { deleteGenerationReceipt, generationReceiptChunks, readGenerationReceipt, writeGenerationReceipt,
  type GenerationHeader, type GenerationHolder } from './deviceGenerationStore';

const MIB=1024*1024,owner='audit-owner',holder:GenerationHolder={kind:'conversation',id:'audit-chat'};
const encode=(text:string)=>new TextEncoder().encode(text);
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const catalogKey='generation:'+owner+':audit-gen';
const partKey=(header:GenerationHeader,name:keyof GenerationHeader['sections'],index:number)=>
  JSON.stringify([owner,'generation',header.generation_id,header.sections[name]!.token,index]);
const value=():Record<string,any>=>({generation_id:'audit-gen',session_id:holder.id,status:'completed',user_id:1,assistant_id:2,
  execution_lock:deviceExecutionLockName(owner),user_content_sha256:hash('audit input'),reply:'audit reply',full:'audit reply'});
const snapshot=()=>structuredClone({meta:[...fixture.meta],parts:[...fixture.parts]});
function resign(header:GenerationHeader){const {catalog_sha256:_,...unsigned}=header;header.catalog_sha256=hash(canonical(unsigned));}
function save(receipt=value(),input?:readonly unknown[]){
  return appTransaction<GenerationHeader>(['meta','parts'],'readwrite',(tx,done)=>writeGenerationReceipt(tx,owner,holder,receipt,input,header=>done(header)));
}
function remove(header:GenerationHeader){
  return appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>deleteGenerationReceipt(tx,header,done));
}
async function exported(){
  const chunks:Uint8Array[]=[];
  for await(const bytes of generationReceiptChunks(owner,holder,'audit-gen'))chunks.push(bytes);
  return new Uint8Array(await new Blob(chunks.map(bytes=>new Uint8Array(bytes))).arrayBuffer());
}
beforeEach(()=>{
  fixture.owner=owner;fixture.records.clear();fixture.meta.clear();fixture.parts.clear();
  fixture.writes=0;fixture.failAt=0;fixture.switchAt=0;fixture.readParts=0;fixture.onPartRead=undefined;
});

it.each([
  ['input-json','UTF8','🙂茶'],['input-json','escape','\n\\"'],['input-json','unicode escape','\ud800'],
  ['json-string','UTF8','🙂茶'],['json-string','escape','\n\\"'],['json-string','unicode escape','\ud800'],
])('round-trips %s %s split inside a 1MiB part',async(encoding,_name,marker)=>{
  const original=value(),prefix=encoding==='input-json'?'[{"role":"user","content":"':'"';
  const content='x'.repeat(MIB-1-encode(prefix).length)+marker+' tail';
  const input=encoding==='input-json'?[{role:'user',content}]:undefined;
  const expectedRaw=input?JSON.stringify(input):content;
  if(!input)original.raw_prompt=content;
  const header=await save(original,input),ref=header.sections.prompt!,parts=[] as Uint8Array[];
  expect(ref.chunks).toBe(2);
  for(let index=0;index<ref.chunks;index++)parts.push(fixture.parts.get(partKey(header,'prompt',index)));
  expect(parts[0].length).toBe(MIB);
  expect(parts[0][MIB-1]).toBe(_name==='UTF8'?0xf0:0x5c);
  const stored=new Uint8Array(await new Blob(parts.map(bytes=>new Uint8Array(bytes))).arrayBuffer());
  expect(hash(stored)).toBe(ref.sha256);
  expect(new TextDecoder('utf-8',{fatal:true}).decode(stored)).toBe(input?JSON.stringify(input):JSON.stringify(content));
  const raw=await exported();
  expect(JSON.parse(new TextDecoder().decode(raw))).toEqual({...original,raw_prompt:expectedRaw});
  const read=await readGenerationReceipt(owner,holder,'audit-gen');
  expect(read).toMatchObject({bytes:raw.length,sha256:hash(raw)});
  expect(read.state).toBe('inline');
  if(read.state==='inline')expect(read.value.raw_prompt).toBe(expectedRaw);
});

it('hashes and counts the exact expanded alias bytes, storing their shared source once',async()=>{
  const original=value(),trace={content:'茶🙂\\"\n\ud800'.repeat(60000)};
  original.memory=trace;original.telemetry={tokens:3,memory:structuredClone(trace)};
  const header=await save(original);
  expect(header.sections.telemetryMemory).toBeUndefined();
  expect(header.sections.memory!.chunks).toBeGreaterThan(1);
  const raw=await exported(),expected=encode(JSON.stringify(original));
  expect(raw).toEqual(expected);
  expect(raw.length).toBeGreaterThan(SYNC_INLINE_BYTES);
  expect(await readGenerationReceipt(owner,holder,'audit-gen')).toEqual({state:'stored',bytes:expected.length,sha256:hash(expected)});
});

it.each(['read','export'])('rejects unfinished final JSON at EOF after the inline cutoff (%s)',async mode=>{
  const original=value();original.attempts=[{raw:'x'.repeat(2*MIB)}];
  const header=await save(original),ref=header.sections.attempts!;
  const last=fixture.parts.get(partKey(header,'attempts',ref.chunks-1)) as Uint8Array;
  expect(last.at(-1)).toBe(0x5d);last[last.length-1]=0x20;
  const digest=createHash('sha256'),parser=new JsonStream({validateOnly:true});
  for(let index=0;index<ref.chunks;index++){
    const bytes=fixture.parts.get(partKey(header,'attempts',index));digest.update(bytes);parser.feed(bytes);
  }
  expect(()=>parser.finish()).toThrow('Invalid streamed JSON');
  ref.sha256=digest.digest('hex');resign(header);fixture.meta.set(catalogKey,structuredClone(header));
  const before=snapshot();let yielded=0;
  const result=mode==='read'?readGenerationReceipt(owner,holder,'audit-gen'):(async()=>{
    for await(const bytes of generationReceiptChunks(owner,holder,'audit-gen'))yielded+=bytes.length;
  })();
  await expect(result).rejects.toThrow('Invalid streamed JSON');
  if(mode==='export')expect(yielded).toBeGreaterThan(SYNC_INLINE_BYTES);
  expect(snapshot()).toEqual(before);
});
it.each(['read','export'])('rejects a BOM-prefixed embedded JSON section after the inline cutoff (%s)',async mode=>{
  const original=value();original.raw_prompt='x'.repeat(2*MIB);original.compiled={saved:true};
  const header=await save(original),ref=header.sections.compiled!,at=partKey(header,'compiled',0);
  const bytes=new Uint8Array([239,187,191,...fixture.parts.get(at)]);
  fixture.parts.set(at,bytes);ref.size=bytes.length;ref.sha256=hash(bytes);resign(header);fixture.meta.set(catalogKey,header);
  let error:unknown;
  try{await (mode==='read'?readGenerationReceipt(owner,holder,'audit-gen'):exported());}catch(value){error=value;}
  expect(error).toBeInstanceOf(Error);
});

it.each(['owner','holder kind','holder id'])('rejects a resigned manifest with a foreign %s',async fault=>{
  const header=await save();
  if(fault==='owner')header.owner='other-owner';
  if(fault==='holder kind')header.holder.kind='research';
  if(fault==='holder id')header.holder.id='other-chat';
  resign(header);fixture.meta.set(catalogKey,header);
  await expect(readGenerationReceipt(owner,holder,'audit-gen')).rejects.toThrow();
  expect(fixture.readParts).toBe(0);
});

it.each(['owner','catalog'])('rejects a %s change between prefix and the next section',async fault=>{
  const original=value();original.attempts=[1];await save(original);
  const iterator=generationReceiptChunks(owner,holder,'audit-gen');expect((await iterator.next()).done).toBe(false);
  if(fault==='owner')fixture.owner='other-owner';
  else{const header=fixture.meta.get(catalogKey);header.reply_sha256=hash('other reply');resign(header);}
  await expect((async()=>{for await(const _ of iterator){/* Require validated EOF. */}})()).rejects.toThrow();
});

it.each([
  ['deleted','part'],['resigned','part'],['deleted','closing brace'],['resigned','closing brace'],
])('rejects a %s catalog change after the final %s is yielded',async(fault,stage)=>{
  await save();const iterator=generationReceiptChunks(owner,holder,'audit-gen');
  expect((await iterator.next()).done).toBe(false);
  if(stage==='closing brace')expect(new TextDecoder().decode((await iterator.next()).value)).toBe('}');
  if(fault==='deleted')fixture.meta.delete(catalogKey);
  else{const header=fixture.meta.get(catalogKey);header.reply_sha256=hash('other reply');resign(header);}
  await expect((async()=>{for await(const _ of iterator){/* A valid prefix is not successful EOF. */}})()).rejects.toThrow();
});

it.each(['before','during','after final part','after closing brace'])('rejects an aborted signal %s reading',async timing=>{
  await save();const controller=new AbortController(),before=snapshot();
  if(timing==='before')controller.abort();
  if(timing==='during')fixture.onPartRead=()=>controller.abort();
  if(timing==='after final part'||timing==='after closing brace'){
    const iterator=generationReceiptChunks(owner,holder,'audit-gen',controller.signal);
    expect((await iterator.next()).done).toBe(false);
    if(timing==='after closing brace')expect(new TextDecoder().decode((await iterator.next()).value)).toBe('}');
    controller.abort();
    await expect(iterator.next()).rejects.toThrow();
  }else await expect(readGenerationReceipt(owner,holder,'audit-gen',controller.signal)).rejects.toThrow();
  if(timing==='before')expect(fixture.readParts).toBe(0);
  expect(snapshot()).toEqual(before);
});

it.each(['quota','owner'])('rolls back every deletion write on %s failure, including the tombstone',async fault=>{
  const original=value();original.attempts=[1];const header=await save(original);
  fixture.parts.set('unrelated',new Uint8Array([9]));
  const before=snapshot(),writes=Object.values(header.sections).reduce((count,ref)=>count+ref.chunks,1);
  for(let at=1;at<=writes;at++){
    fixture.owner=owner;fixture.writes=0;fixture.failAt=fault==='quota'?at:0;fixture.switchAt=fault==='owner'?at:0;
    await expect(remove(header)).rejects.toThrow();expect(snapshot()).toEqual(before);
  }
});

it('rejects stale-header deletion without removing any parts',async()=>{
  const header=await save(),changed=fixture.meta.get(catalogKey);changed.reply_sha256=hash('new reply');resign(changed);
  const before=snapshot();await expect(remove(header)).rejects.toThrow();expect(snapshot()).toEqual(before);
});
