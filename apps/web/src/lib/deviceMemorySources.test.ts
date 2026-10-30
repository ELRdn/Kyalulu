import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { harness,decoded } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'source-owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),
  failDomain:false,switchOnPart:false}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),
  entity:vi.fn(()=>{throw Error('Scoped peers must not restore full entities');}),
  appTransaction:(_stores:string[],mode:string,action:any)=>harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,(tx:any,done:any)=>{
    const objectStore=tx.objectStore;
    tx.objectStore=(name:string)=>{
      const store=objectStore(name),put=store.put;
      if(name==='meta')store.put=(value:unknown,key:unknown)=>{
        if(fixture.failDomain&&key===memoryDomainKey('source-owner','local'))throw Error('Fictional domain quota');
        return put(value,key);
      };
      return store;
    };
    action(tx,done);
  },{read:(_mode,name,key)=>{
    if(fixture.switchOnPart&&name==='parts'&&key[2]==='b'){fixture.switchOnPart=false;fixture.owner='another-owner';}
  }}),
}));
import { newEntity,writeEntity,appTransaction,entity,type AppEntity } from './appStore';
import { readDeviceMemoryDomain,readMemorySource,commitDeviceMemoryDomain } from './deviceMemoryStore';
import { memoryIdentity,bindMemoryScope,memoryBinding,ownScopeMemories,memoryDomainKey } from './deviceMemoryScopes';
import { scopedSessionMemory,saveScopedMemory } from './deviceScopedMemory';
import { JsonStream } from './jsonStream';
import { Sha256 } from '../mobile/sha256';

const identity=memoryIdentity({character_id:'character',world_id:'world'},{character_id:'1',persona_id:null,world_id:'1'});
const resolve=async()=>identity;
const stored=(id:string)=>fixture.records.get(JSON.stringify(['source-owner',id]));
const saved=(id:string):AppEntity=>decoded(stored(id),fixture.parts);
const physical=()=>({records:JSON.stringify([...fixture.records]),meta:JSON.stringify([...fixture.meta]),
  parts:[...fixture.parts].map(([key,bytes])=>[key,bytes.length,new Sha256().update(bytes).digest()])});
function source(id:string,count:number,policy:string){
  const memory={id:'memory-'+id,scope:id,type:'semantic',content:'Fact '+id,origin:'user',supported:null,status:'active',
    source_session_id:id,source_message_ids:[1],version:1,access_count:0};
  return newEntity('conversation',id,{storage_policy:policy,memory_scope_mode:'world',settings:{session_id:id},draft:'Unsent 茶🙂 '+id,
    state:{turn:37,extension:'preserve'},summaries:[{id:'manual',text:'Original summary'}],opaque:{keep:['原文',7]},
    memories:[memory],messages:Array.from({length:count},(_,i)=>({id:i+1,uuid:id+'-'+i,role:i%2?'assistant':'user',content:'茶🙂 source'.repeat(1300),
      before:{state:{turn:i},memories:i?[memory]:[]},after:{state:{turn:i+1},memories:[memory]},unknown:{keep:i}}))},'source-owner');
}
async function seed(policy='local'){
  const a=source('a',1,policy),b=source('b',130,policy),domain=await readDeviceMemoryDomain('source-owner',policy as 'local'|'sync');
  for(const record of [a,b]){
    const binding=bindMemoryScope(domain,record,identity);record.payload.memories=ownScopeMemories(domain.pools[binding.scope],record.id);
  }
  const result=await commitDeviceMemoryDomain('source-owner',policy as 'local'|'sync',domain,[{id:'a',revision:0},{id:'b',revision:0}],[a,b]);
  fixture.meta.set('sync:source-owner:outbox',{request_id:'fixed-unsent',changes:[{id:'b',body:'Original fixed snapshot'}]});
  return {a:result.sessions[0],b:result.sessions[1]};
}
function usePeer(context:Awaited<ReturnType<typeof scopedSessionMemory>>,count=7){
  context.domain.pools[context.scope].memories.find(memory=>memory.source_session_id==='b')!.access_count=count;
}
beforeEach(()=>{
  fixture.owner='source-owner';fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.failDomain=false;fixture.switchOnPart=false;
});
afterEach(()=>vi.restoreAllMocks());

it.each(['local','sync'])('streams %s peer memory projections while preserving complete history and atomic generation receipts',async policy=>{
  const {a,b}=await seed(policy),outbox=structuredClone(fixture.meta.get('sync:source-owner:outbox'));
  expect(stored('b').payloadParts.chunks).toBeGreaterThan(1);
  const finish=JsonStream.prototype.finish,feed=JsonStream.prototype.feed,retained:number[]=[],peaks:number[]=[];
  const finishSpy=vi.spyOn(JsonStream.prototype,'finish').mockImplementation(function(this:JsonStream){
    const value=finish.call(this);if(Array.isArray(value.messages))retained.push(value.messages.length);return value;
  });
  const feedSpy=vi.spyOn(JsonStream.prototype,'feed').mockImplementation(function(this:JsonStream,bytes:Uint8Array){
    const result=feed.call(this,bytes),root=(this as any).root;if(Array.isArray(root?.messages))peaks.push(root.messages.length);return result;
  });
  const context=await scopedSessionMemory(a,resolve),peer=context.records.get('b')!,token=peer.bodyToken;
  expect(peer.metadata).not.toHaveProperty('messages');expect(peer).not.toHaveProperty('payload');
  expect(peer.metadata.draft).toBe(b.payload.draft);expect(peer.bodyToken).toBe(stored('b').payloadParts.token);
  usePeer(context);context.domain.pending={session_id:'a',generation_id:'generation'};
  const pending={generation_id:'generation',session_id:'a',status:'pending',assistant_id:null,user_id:1};
  const first=await saveScopedMemory(context,[{...a,payload:{...a.payload,pending_generation:'generation'}}],{generation:pending});
  expect(first.sessions.map(record=>record.id)).toEqual(['a']);expect(first.sources.map(record=>record.id)).toEqual(['b']);
  expect(context.records.get('b')!.bodyToken).not.toBe(token);
  expect(context.records.get('b')!.revision).toBe(b.revision+1);
  usePeer(context,9);context.domain.pending=null;
  const completed={...pending,status:'completed',assistant_id:2};
  await saveScopedMemory(context,[{...first.sessions[0],payload:{...first.sessions[0].payload,pending_generation:null}}],{generation:completed});
  finishSpy.mockRestore();feedSpy.mockRestore();
  expect(retained.length).toBeGreaterThan(3);expect(retained.every(count=>count===0)).toBe(true);expect(Math.max(...peaks)).toBe(0);
  expect(saved('b')).toMatchObject({revision:b.revision+2,dirty:policy==='sync',serverRevision:b.serverRevision,
    payload:{...b.payload,memories:b.payload.memories.map((memory:any)=>({...memory,access_count:9}))}});
  expect(fixture.meta.get('generation:source-owner:generation')).toEqual(completed);
  expect(fixture.meta.get('sync:source-owner:outbox')).toEqual(outbox);
  expect(memoryBinding(context.domain,'b').entity_revision).toBe(b.revision+2);
  expect(entity).not.toHaveBeenCalled();
});

it('keeps legacy inline sources compatible and adopts a new checksummed token after memory-only save',async()=>{
  const {a,b}=await seed(),previous=stored('b').payloadParts;
  for(let i=0;i<previous.chunks;i++)fixture.parts.delete(JSON.stringify(['source-owner','entity','b',previous.token,i]));
  fixture.records.set(JSON.stringify(['source-owner','b']),structuredClone(b));
  const context=await scopedSessionMemory(a,resolve);expect(context.records.get('b')!.bodyToken).toBeNull();
  usePeer(context);await saveScopedMemory(context);
  expect(typeof context.records.get('b')!.bodyToken).toBe('string');
  expect(saved('b').payload).toEqual({...b.payload,memories:b.payload.memories.map((memory:any)=>({...memory,access_count:7}))});
});

it('rolls back full actor, streamed peer, domain and receipt together on a final domain quota failure',async()=>{
  const {a}=await seed(),context=await scopedSessionMemory(a,resolve);usePeer(context);
  context.domain.pending={session_id:'a',generation_id:'never-admitted'};
  const before=physical();fixture.failDomain=true;
  await expect(saveScopedMemory(context,[{...a,payload:{...a.payload,pending_generation:'never-admitted'}}],
    {'never-admitted':{generation_id:'never-admitted',session_id:'a',status:'pending'}})).rejects.toThrow();
  expect(physical()).toEqual(before);
});

it.each(['missing-part','token'])('rejects a changed peer %s without committing domain or canonical data',async damage=>{
  const {a,b}=await seed(),context=await scopedSessionMemory(a,resolve);usePeer(context);
  const ref=stored('b').payloadParts;
  if(damage==='missing-part')fixture.parts.delete(JSON.stringify(['source-owner','entity','b',ref.token,ref.chunks-1]));
  else await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,b,'put',done,true));
  const before=physical();await expect(saveScopedMemory(context)).rejects.toThrow();expect(physical()).toEqual(before);
});

it.each(['future-snapshot','duplicate-id','missing-memory-source'])('rejects invalid %s in a streamed source before any write',async damage=>{
  const {a,b}=await seed();
  if(damage==='future-snapshot')b.payload.messages[5].before.memories[0].source_message_ids=[6];
  if(damage==='duplicate-id')b.payload.messages[5].id=1;
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,b,'put',done,true));
  const context=await scopedSessionMemory(a,resolve);usePeer(context);
  if(damage==='missing-memory-source')context.domain.pools[context.scope].memories.find(memory=>memory.source_session_id==='b')!.source_message_ids=[9999];
  const before=physical();await expect(saveScopedMemory(context)).rejects.toThrow();expect(physical()).toEqual(before);
});

it('checks policy from the verified body even when a supplied source projection claims local storage',async()=>{
  const {a,b}=await seed();b.payload.storage_policy='sync';
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,b,'put',done,true));
  const context=await scopedSessionMemory(a,resolve),peer=(await readMemorySource('b','source-owner'))!;
  peer.metadata.storage_policy='local';context.records.set('b',peer);usePeer(context);
  const before=physical();await expect(saveScopedMemory(context)).rejects.toThrow();expect(physical()).toEqual(before);
});

it('rejects owner changes during source parsing and never returns another account projection',async()=>{
  await seed();fixture.switchOnPart=true;const before=physical();
  await expect(readMemorySource('b','source-owner')).rejects.toThrow();expect(physical()).toEqual(before);
  expect(await readMemorySource('b','another-owner')).toBeUndefined();
});
