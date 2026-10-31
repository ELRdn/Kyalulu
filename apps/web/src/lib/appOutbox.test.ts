import { beforeEach,expect,it,vi } from 'vitest';
import { createHash } from 'node:crypto';
import { harness } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'owner',busy:false,entities:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>()}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,generationBusy:()=>fixture.busy}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),appTransaction:(_stores:string[],mode:string,action:any)=>
  harness(fixture.entities,fixture.meta,fixture.parts,JSON.stringify,mode,action)}));
import { appTransaction,writeOutbox,type StoredOutbox } from './appStore';
import { outboxSyncSource } from './appOutbox';
import { uploadSync,SYNC_INLINE_BYTES } from './appTransfers';
import { Sha256 } from '../mobile/sha256';
import { decodeBytes } from './remoteRpc';
import { streamParts } from './segmentedStorage';
const key='sync:owner:outbox',transfer='10000000-0000-4000-8000-000000000001';
const body=(repeat=25000)=>({request_id:'fixed',changes:[{id:'chat',kind:'conversation' as const,base_revision:2,deleted:false,
  payload:{messages:Array.from({length:8},(_,id)=>({id:id+1,content:'茶🙂'.repeat(repeat)})),extension:{keep:true}}}]});
const sha=(bytes:Uint8Array)=>new Sha256().update(bytes).digest();
const seed=async(value=body())=>{
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>writeOutbox(tx,'owner',value,done));
  return structuredClone(fixture.meta.get(key)) as StoredOutbox;
};
beforeEach(()=>{fixture.owner='owner';fixture.busy=false;fixture.entities.clear();fixture.meta.clear();fixture.parts.clear();});
it.each([17,1024*1024,2*1024*1024+17])('finishes streamed storage after prior part writes drain (%i bytes)',async size=>{
  const bytes=new Uint8Array(size).fill(0x72);let completed=0;
  const ref=await appTransaction<any>(['meta','parts'],'readwrite',(tx,done)=>{
    const writer=streamParts(tx,['owner','outbox','fixed']);
    writer.append(bytes.subarray(0,7));writer.append(bytes.subarray(7));
    const barrier=tx.objectStore('meta').get('after-pending-writes');
    barrier.onsuccess=()=>writer.finish(ref=>{completed++;done(ref);});
  });
  expect(completed).toBe(1);expect(ref.size).toBe(size);expect(ref.chunks).toBe(Math.ceil(size/(1024*1024)));
  expect(ref.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  const saved=Buffer.concat(Array.from({length:ref.chunks},(_,index)=>Buffer.from(fixture.parts.get(JSON.stringify(['owner','outbox','fixed',ref.token,index])))));
  expect(Buffer.compare(saved,Buffer.from(bytes))).toBe(0);
});
it.each([1,25000])('streams exact stored wire bytes and inline body without payload parsing (%i repeats)',async repeat=>{
  const value=body(repeat),header=await seed(value),source=outboxSyncSource('owner',header),expected=new TextEncoder().encode(JSON.stringify(value));
  const parts:Uint8Array[]=[],parse=vi.spyOn(JSON,'parse');
  try{for await(const bytes of source.chunks())parts.push(bytes);
    expect(parse.mock.calls.every(([text])=>text.length<1000)).toBe(true);
  }finally{parse.mockRestore();}
  const result=new Uint8Array(parts.reduce((count,part)=>count+part.length,0));let offset=0;
  for(const bytes of parts){expect(bytes.length).toBe(Math.min(1024*1024,expected.length-offset));result.set(bytes,offset);offset+=bytes.length;}
  expect(result.length).toBe(expected.length);expect(result.every((byte,index)=>byte===expected[index])).toBe(true);
  expect((await source.inline()).body).toBe(JSON.stringify(value));
  expect(fixture.meta.get(key)).toEqual(header);
});
it.each(['revision','manifest','owner','busy','part'])('refuses %s changes between stored parts',async fault=>{
  const header=await seed(),iterator=outboxSyncSource('owner',header).chunks()[Symbol.asyncIterator]();await iterator.next();
  const current=fixture.meta.get(key);
  if(fault==='revision')current.revisions={chat:99};
  if(fault==='manifest')current.changesParts.token='20000000-0000-4000-8000-000000000001';
  if(fault==='owner')fixture.owner='other';if(fault==='busy')fixture.busy=true;
  if(fault==='part')fixture.parts.delete(JSON.stringify(['owner','outbox','fixed',header.changesParts!.token,1]));
  const before=structuredClone({meta:[...fixture.meta],parts:[...fixture.parts]});
  await expect(iterator.next()).rejects.toThrow();expect([...fixture.meta]).toEqual(before.meta);
  expect(fixture.parts.size).toBe(before.parts.length);
  for(const [key,bytes] of before.parts){const actual=fixture.parts.get(key);expect(actual?.length).toBe(bytes.length);expect(actual.every((byte:number,index:number)=>byte===bytes[index])).toBe(true);}
});
it('resumes exact wire chunks and withholds commit if a repeatable upload source changes',async()=>{
  const value=body(30000),header=await seed(value),expected=new TextEncoder().encode(JSON.stringify(value)),paths:string[]=[];
  expect(expected.length).toBeGreaterThan(SYNC_INLINE_BYTES);
  const call=async(path:string,init?:RequestInit)=>{
    paths.push(path);const data=JSON.parse(String(init?.body));
    if(path==='/transfers'){expect(data).toMatchObject({size:expected.length,sha256:sha(expected)});return {transfer_id:transfer,next:1,chunk_bytes:1024*1024};}
    if(path.endsWith('/commit'))return {changes:[]};
    expect(path).toBe('/transfers/'+transfer+'/parts/1');const bytes=decodeBytes(data.data);
    expect(bytes.length).toBe(expected.length-1024*1024);expect(bytes.every((byte,index)=>byte===expected[1024*1024+index])).toBe(true);return {next:2};
  };
  await uploadSync(outboxSyncSource('owner',header),call,async()=>{});expect(paths.some(path=>path.endsWith('/parts/0'))).toBe(false);
  let round=0;const stable=new Uint8Array(1024*1024).fill(65),small=new Uint8Array(600000).fill(66);
  const source={request_id:'changing',chunks:async function*(){yield stable;yield ++round===1?small:small.slice(1);},inline:async()=>({})};
  let committed=false;
  await expect(uploadSync(source,async path=>{
    if(path==='/transfers')return {transfer_id:transfer,next:0,chunk_bytes:1024*1024};
    if(path.endsWith('/commit'))committed=true;
    return {next:path.endsWith('/0')?1:2};
  },async()=>{})).rejects.toThrow('changed during upload');expect(committed).toBe(false);
});
