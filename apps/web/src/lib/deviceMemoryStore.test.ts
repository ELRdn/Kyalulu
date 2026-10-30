import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { harness,decoded } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'owner-a',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),failAt:0,partReads:[] as string[]}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),
  appTransaction:(_stores:string[],mode:string,action:any)=>{
    let writes=0;return harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action,{write:()=>{
      if(fixture.failAt&&++writes===fixture.failAt)throw Error('Fictional quota failure');
    },read:(_mode,name,key)=>{if(name==='parts')fixture.partReads.push(JSON.stringify(key));}});
  },
}));
import { newEntity,appTransaction,readEntity,writeEntity,scrubGenerationRecords } from './appStore';
import { readDeviceMemoryDomain,commitDeviceMemoryDomain,recoverDeviceMemoryGeneration,validateMemoryDomain,type OwnedMemoryDomain } from './deviceMemoryStore';
import { deviceExecutionLockName } from './deviceExecution';
import { bindMemoryScope,memoryIdentity,memoryBinding,ownScopeMemories,memoryDomainKey,reconcileScopeMemories,eraseMemoryDomain } from './deviceMemoryScopes';

beforeEach(()=>{fixture.owner='owner-a';fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.failAt=0;fixture.partReads=[];
  vi.stubGlobal('IDBKeyRange',{bound:(lower:unknown,upper:unknown)=>({lower,upper})});
});
afterEach(()=>vi.unstubAllGlobals());
const identity=memoryIdentity({character_id:'character',world_id:'harbor'},{character_id:'1.0.0',persona_id:null,world_id:'1.0.0'});
const record=(sid='chat')=>newEntity('conversation',sid,{storage_policy:'local',memory_scope_mode:'world',settings:{session_id:sid},
  messages:[{id:1,uuid:'source-'+sid,role:'user',content:'Source quote'}],memories:[{id:'memory-'+sid,scope:sid,type:'semantic',content:'remembered fact',origin:'user',supported:null,status:'active',source_session_id:sid,source_message_ids:[1]}]});
async function prepare(sid='chat'){
  const domain=await readDeviceMemoryDomain(fixture.owner,'local'),session=record(sid);bindMemoryScope(domain,session,identity);
  session.payload.memories=ownScopeMemories(domain.pools[memoryBinding(domain,sid).scope],sid);return {domain,session};
}
const saved=(sid='chat')=>decoded(fixture.records.get(JSON.stringify([fixture.owner,sid])),fixture.parts);

it('atomically saves a segmented domain, own conversation and pending receipt, then completes it',async()=>{
  const {domain,session}=await prepare();domain.pending={session_id:session.id,generation_id:'generation'};session.payload.pending_generation='generation';
  const first=await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session],
    {generation:{generation_id:'generation',session_id:session.id,status:'pending'}});
  expect(first.domain.revision).toBe(1);expect(saved().revision).toBe(1);expect(fixture.meta.get('generation:owner-a:generation').status).toBe('pending');
  expect(fixture.meta.get(memoryDomainKey(fixture.owner,'local')).parts.size).toBeGreaterThan(0);
  expect(await readDeviceMemoryDomain(fixture.owner,'local')).toEqual(first.domain);
  const next=structuredClone(first.domain),current=first.sessions[0];next.pending=null;current.payload.pending_generation=null;
  const completed=await commitDeviceMemoryDomain(fixture.owner,'local',next,[{id:current.id,revision:1}],[current],
    {generation:{generation_id:'generation',session_id:current.id,status:'completed'}});
  expect(completed.domain.revision).toBe(2);expect(saved().payload.pending_generation).toBeNull();
  expect(fixture.meta.get('generation:owner-a:generation').status).toBe('completed');
  await expect(commitDeviceMemoryDomain(fixture.owner,'local',first.domain,[{id:current.id,revision:1}])).rejects.toThrow('aborted');
});

it('rolls back entity body, domain chunks and receipt when domain-header persistence fails',async()=>{
  const {domain,session}=await prepare();domain.pending={session_id:session.id,generation_id:'generation'};session.payload.pending_generation='generation';
  fixture.failAt=4;
  await expect(commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session],
    {generation:{generation_id:'generation',session_id:session.id,status:'pending'}})).rejects.toThrow('aborted');
  expect(fixture.records.size).toBe(0);expect(fixture.meta.size).toBe(0);expect(fixture.parts.size).toBe(0);
});

it('rejects a changed shared-source revision before saving any new projections',async()=>{
  const {domain,session}=await prepare();
  const first=await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session]);
  const other={...record('other'),revision:2};fixture.records.set(JSON.stringify([fixture.owner,other.id]),other);
  const before=structuredClone(fixture.meta),source=saved();
  await expect(commitDeviceMemoryDomain(fixture.owner,'local',first.domain,[{id:session.id,revision:1},{id:other.id,revision:1}],[first.sessions[0]])).rejects.toThrow('aborted');
  expect(saved()).toEqual(source);expect(fixture.meta).toEqual(before);
});

it('keeps owner and storage-policy namespaces separate and rejects an old-owner snapshot',async()=>{
  const {domain,session}=await prepare();const committed=await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session]);
  expect((await readDeviceMemoryDomain(fixture.owner,'sync')).pools).toEqual({});
  fixture.owner='owner-b';expect((await readDeviceMemoryDomain(fixture.owner,'local')).pools).toEqual({});
  await expect(commitDeviceMemoryDomain(fixture.owner,'local',committed.domain,[])).rejects.toThrow('Invalid memory commit scope');
  await expect(readDeviceMemoryDomain('owner-a','local')).rejects.toThrow('aborted');
});

it('rejects foreign message/session sources and inconsistent own projections',async()=>{
  for(const damage of ['message','session','projection']){
    const {domain,session}=await prepare();
    if(damage==='message'){session.payload.memories[0].source_message_ids=[999];reconcileScopeMemories(domain,session);}
    if(damage==='session')session.payload.memories[0].source_session_id='foreign';
    if(damage==='projection')session.payload.memories[0].content='not in pool';
    await expect(commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session])).rejects.toThrow();
    expect(fixture.meta.size).toBe(0);expect(fixture.records.size).toBe(0);
  }
});

it('retains pending data when a caller tries to mutate its pool without finishing its receipt',async()=>{
  const {domain,session}=await prepare();domain.pending={session_id:session.id,generation_id:'active'};session.payload.pending_generation='active';
  const first=await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session],{active:{generation_id:'active',session_id:session.id,status:'pending'}});
  const before=structuredClone(fixture.meta);
  await expect(commitDeviceMemoryDomain(fixture.owner,'local',first.domain,[])).rejects.toThrow('aborted');
  expect(fixture.meta).toEqual(before);expect(saved().payload.pending_generation).toBe('active');
});

it('refuses corrupt domain parts and retains the original entity on read/write failure',async()=>{
  const {domain,session}=await prepare();const first=await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session]);
  const header=fixture.meta.get(memoryDomainKey(fixture.owner,'local')),key=JSON.stringify([fixture.owner,'memory-domain','local',header.parts.token,0]);
  const bytes=fixture.parts.get(key);bytes[0]^=1;const before=saved();
  await expect(readDeviceMemoryDomain(fixture.owner,'local')).rejects.toThrow('aborted');
  await expect(commitDeviceMemoryDomain(fixture.owner,'local',first.domain,[{id:session.id,revision:1}],[first.sessions[0]])).rejects.toThrow('aborted');
  expect(saved()).toEqual(before);
});

it('retains an erased source tombstone and refuses a stale snapshot attempting to restore it',async()=>{
  const {domain,session}=await prepare();const first=await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:session.id,revision:0}],[session]);
  const erased=structuredClone(first.domain);eraseMemoryDomain(erased,session.id);
  const tombstone={...first.sessions[0],deleted:true,payload:{storage_policy:'local'}};
  const result=await commitDeviceMemoryDomain(fixture.owner,'local',erased,[{id:session.id,revision:1}],[tombstone]);
  expect(result.domain.erased_sessions).toContain(session.id);expect(saved().deleted).toBe(true);
  await expect(commitDeviceMemoryDomain(fixture.owner,'local',first.domain,[{id:session.id,revision:1}],[first.sessions[0]])).rejects.toThrow('aborted');
  const malformed=structuredClone(result.domain);malformed.bindings['"chat"']=first.domain.bindings['"chat"'];
  expect(()=>validateMemoryDomain(malformed)).toThrow('invalid');
});

async function sharedSourceFixture(){
  const {domain,session:a}=await prepare('a'),b=record('b');bindMemoryScope(domain,b,identity);
  const trace={candidates:[{id:'memory-a',source_session_id:'a',content:'SOURCE SECRET'}],injected:['memory-a'],evidenced:['memory-a'],decisions:[{memory_id:'memory-a'}]};
  const result={generation_id:'other-generation',session_id:'b',status:'completed',reply:'retained reply',memory:trace,telemetry:{memory:trace},
    raw_prompt:'SOURCE SECRET',compiled:{system_prompt:'SOURCE SECRET'},attempts:['SOURCE SECRET'],validation:{ok:false,retries:1,errors:['SOURCE SECRET']}};
  b.payload.last_generation=result;
  const first=await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:'a',revision:0},{id:'b',revision:0}],[a,b]);
  fixture.meta.set('generation:'+fixture.owner+':other-generation',structuredClone(result));
  fixture.meta.set('generation:'+fixture.owner+':source-generation',{generation_id:'source-generation',session_id:'a',status:'completed',raw_prompt:'SOURCE SECRET'});
  return first;
}
const eraseSource=()=>appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
  const source=saved('a');writeEntity(tx,{...source,revision:source.revision+1,deleted:true,payload:{storage_policy:'local'}});
  scrubGenerationRecords(tx,fixture.owner,'a');done();
});

const storedHeader=(sid:string)=>fixture.records.get(JSON.stringify([fixture.owner,sid]));
const bodyKey=(sid:string)=>JSON.stringify([fixture.owner,'entity',sid,storedHeader(sid).payloadParts.token,0]);
function corruptBody(sid:string){
  const bytes=fixture.parts.get(bodyKey(sid)) as Uint8Array,index=bytes.indexOf('S'.charCodeAt(0));
  expect(index).toBeGreaterThanOrEqual(0);bytes[index]^=1;
}
const saveConversation=(session:ReturnType<typeof record>)=>appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
  writeEntity(tx,session);done();
});

it('erases a source without reading or rewriting a verified unrelated corrupt body',async()=>{
  await sharedSourceFixture();
  const unrelated=record('unrelated');unrelated.payload.last_generation={reply:'retained reply',memory:{candidates:[{id:'other-memory',source_session_id:'other-source'}]}};
  await saveConversation(unrelated);
  expect(storedHeader(unrelated.id).memoryReferences).toMatchObject({sources:['other-source'],memories:['other-memory']});
  corruptBody(unrelated.id);
  const key=bodyKey(unrelated.id),header=structuredClone(storedHeader(unrelated.id)),bytes=structuredClone(fixture.parts.get(key));
  await expect(appTransaction(['entities','parts'],'readonly',(tx,done)=>readEntity(tx,fixture.owner,unrelated.id,done))).rejects.toThrow('aborted');
  fixture.partReads=[];await eraseSource();
  expect(fixture.partReads).not.toContain(key);expect(storedHeader(unrelated.id)).toEqual(header);expect(fixture.parts.get(key)).toEqual(bytes);
  expect(saved('a').deleted).toBe(true);expect(JSON.stringify(saved('b').payload.last_generation)).not.toContain('SOURCE SECRET');
});

it.each([
  ['source candidate',{candidates:[{id:'unlisted-memory',source_session_id:'a'}]}],
  ['candidate ID',{candidates:[{id:'memory-a'}]}],
  ['decision ID',{decisions:[{memory_id:'memory-a'}]}],
  ['injected ID',{injected:['memory-a']}],
  ['evidenced ID',{evidenced:['memory-a']}],
] as const)('redacts a verified indexed conversation referenced only by %s, including telemetry',async(_name,trace)=>{
  await sharedSourceFixture();
  const target=saved('b');target.dirty=true;target.serverRevision=7;
  target.payload.last_generation={reply:'retained reply',telemetry:{memory:trace},raw_prompt:'SOURCE SECRET',
    compiled:{system_prompt:'SOURCE SECRET'},attempts:['SOURCE SECRET'],validation:{ok:false,retries:1,errors:['SOURCE SECRET']}};
  await saveConversation(target);
  const before=saved('b'),key=bodyKey('b');expect(storedHeader('b').memoryReferences.hash).toMatch(/^[a-f0-9]{64}$/);
  fixture.partReads=[];await eraseSource();
  expect(fixture.partReads).toContain(key);
  const after=saved('b');expect(after.revision).toBe(before.revision+1);expect(after.dirty).toBe(true);expect(after.serverRevision).toBe(7);
  expect(after.payload.messages).toEqual(before.payload.messages);expect(after.payload.last_generation.reply).toBe('retained reply');
  expect(JSON.stringify(after.payload.last_generation)).not.toContain('SOURCE SECRET');
  expect(after.payload.last_generation.telemetry.memory).toEqual({candidates:[],decisions:[],injected:[],evidenced:[]});
  expect(storedHeader('b').memoryReferences).toMatchObject({sources:[],memories:[]});
});

const damageReferenceIndex=(sid:string,damage:string)=>{
  const header=storedHeader(sid);
  if(damage==='missing')delete header.memoryReferences;
  if(damage==='forged empty')header.memoryReferences={...header.memoryReferences,sources:[],memories:[]};
  if(damage==='malformed')header.memoryReferences={...header.memoryReferences,sources:[42]};
  if(damage==='replayed')header.memoryReferences=structuredClone(storedHeader('a').memoryReferences);
};

it.each(['missing','forged empty','malformed','replayed'])('falls back to body inspection and redacts references with a %s index',async damage=>{
  await sharedSourceFixture();damageReferenceIndex('b',damage);
  const key=bodyKey('b');fixture.partReads=[];await eraseSource();
  expect(fixture.partReads).toContain(key);expect(saved('a').deleted).toBe(true);
  const result=saved('b').payload.last_generation;
  expect(JSON.stringify(result)).not.toContain('SOURCE SECRET');expect(result.reply).toBe('retained reply');
  expect(storedHeader('b').memoryReferences).toMatchObject({sources:[],memories:[]});
});

it.each(['missing','forged empty','malformed','replayed'])('aborts erasure and preserves all source data when a %s index leads to a corrupt body',async damage=>{
  await sharedSourceFixture();damageReferenceIndex('b',damage);corruptBody('b');
  const before={records:structuredClone(fixture.records),meta:structuredClone(fixture.meta),parts:structuredClone(fixture.parts)};
  const key=bodyKey('b');fixture.partReads=[];
  await expect(eraseSource()).rejects.toThrow('aborted');expect(fixture.partReads).toContain(key);
  expect(fixture.records).toEqual(before.records);expect(fixture.meta).toEqual(before.meta);expect(fixture.parts).toEqual(before.parts);
  expect(saved('a').deleted).toBe(false);expect(saved('a').payload.memories[0].content).toBe('remembered fact');
  expect((await readDeviceMemoryDomain(fixture.owner,'local')).erased_sessions).not.toContain('a');
  expect(fixture.meta.get('generation:owner-a:source-generation').raw_prompt).toBe('SOURCE SECRET');
});

it('erases source copies and diagnostic references atomically with the conversation tombstone',async()=>{
  await sharedSourceFixture();await eraseSource();
  expect(saved('a').deleted).toBe(true);expect(saved('b').payload.messages).toHaveLength(1);
  const domain=await readDeviceMemoryDomain(fixture.owner,'local');expect(domain.erased_sessions).toContain('a');
  expect(Object.values(domain.pools).flatMap(pool=>pool.memories).map(m=>m.source_session_id)).toEqual(['b']);
  expect((await readDeviceMemoryDomain(fixture.owner,'sync')).erased_sessions).toContain('a');
  expect(fixture.meta.get('generation:owner-a:source-generation')).toEqual({generation_id:'source-generation',session_id:'a',status:'deleted'});
  for(const result of [saved('b').payload.last_generation,fixture.meta.get('generation:owner-a:other-generation')]){
    expect(JSON.stringify(result)).not.toContain('SOURCE SECRET');expect(result.reply).toBe('retained reply');expect(result.validation).toEqual({ok:false,retries:1,errors:[]});
  }
});

it.each([6,8])('rolls back source erasure and both policy domains on a partial write failure (%s)',async failAt=>{
  await sharedSourceFixture();const before={a:saved('a'),b:saved('b'),meta:structuredClone(fixture.meta),parts:structuredClone(fixture.parts)};
  fixture.failAt=failAt;await expect(eraseSource()).rejects.toThrow('aborted');
  expect(saved('a')).toEqual(before.a);expect(saved('b')).toEqual(before.b);expect(fixture.meta).toEqual(before.meta);expect(fixture.parts).toEqual(before.parts);
});

it('fences ordinary conversation writers and erasure while a verified shared generation is pending',async()=>{
  const {domain,session}=await prepare('a');domain.pending={session_id:'a',generation_id:'active'};session.payload.pending_generation='active';
  await commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:'a',revision:0}],[session],{active:{generation_id:'active',session_id:'a',status:'pending'}});
  const before=saved('a');
  await expect(appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{writeEntity(tx,{...before,revision:2,payload:{...before.payload,title:'MUST NOT COMMIT'}});done();})).rejects.toThrow('aborted');
  await expect(eraseSource()).rejects.toThrow('aborted');expect(saved('a')).toEqual(before);
});

async function pendingScope(){
  const {domain,session}=await prepare('a');domain.pending={session_id:'a',generation_id:'orphan'};session.payload.pending_generation='orphan';
  return commitDeviceMemoryDomain(fixture.owner,'local',domain,[{id:'a',revision:0}],[session],{
    orphan:{generation_id:'orphan',session_id:'a',status:'pending',execution_lock:deviceExecutionLockName(fixture.owner)}});
}

it('recovers an orphan domain without replacing newer canonical edits or memory pools',async()=>{
  const first=await pendingScope(),external=structuredClone(first.sessions[0]);
  external.revision+=3;external.dirty=true;external.payload.memories[0].content='Later unsent correction';external.payload.draft='Later draft';
  external.payload.messages.push({id:2,uuid:'later',role:'assistant',content:'Later saved reply'});
  fixture.records.set(JSON.stringify([fixture.owner,'a']),external);
  const receipt=await recoverDeviceMemoryGeneration(fixture.owner,'orphan','a');
  expect(receipt?.status).toBe('failed');
  expect(saved('a')).toMatchObject({...external,revision:external.revision+1,payload:{...external.payload,pending_generation:null}});
  const recovered=await readDeviceMemoryDomain(fixture.owner,'local');
  expect(recovered.pools).toEqual(first.domain.pools);expect(recovered.pending).toBeNull();
  expect(await recoverDeviceMemoryGeneration(fixture.owner,'orphan','a')).toBeNull();
});

it.each(['missing','deleted'])('erases orphan-source copies without reviving a %s conversation',async kind=>{
  await pendingScope();
  const key=JSON.stringify([fixture.owner,'a']);
  if(kind==='missing')fixture.records.delete(key);
  else fixture.records.set(key,{...saved('a'),revision:4,deleted:true,payload:{storage_policy:'local'}});
  const before=structuredClone(fixture.records.get(key));
  expect(await recoverDeviceMemoryGeneration(fixture.owner,'orphan','a')).toEqual({generation_id:'orphan',session_id:'a',status:'deleted'});
  expect(fixture.records.get(key)).toEqual(before);
  const domain=await readDeviceMemoryDomain(fixture.owner,'local');
  expect(domain.pending).toBeNull();expect(domain.erased_sessions).toContain('a');
  expect(Object.values(domain.pools).flatMap(pool=>pool.memories)).toEqual([]);
});

it('retains a newer pending flag and rejects mismatched receipt or source identity',async()=>{
  await pendingScope();const external=saved('a');external.payload.pending_generation='newer';fixture.records.set(JSON.stringify([fixture.owner,'a']),external);
  const before=structuredClone(fixture.meta);
  await expect(recoverDeviceMemoryGeneration(fixture.owner,'orphan','other')).rejects.toThrow('aborted');
  expect(fixture.meta).toEqual(before);
  const receipt=fixture.meta.get('generation:owner-a:orphan');delete receipt.execution_lock;
  await expect(recoverDeviceMemoryGeneration(fixture.owner,'orphan','a')).rejects.toThrow('aborted');
  receipt.execution_lock=deviceExecutionLockName(fixture.owner);
  await expect(recoverDeviceMemoryGeneration(fixture.owner,'orphan','a')).rejects.toThrow('aborted');
  expect(fixture.meta).toEqual(before);expect(saved('a').payload.pending_generation).toBe('newer');
});

it.each([1,3,5])('rolls back orphan recovery on partial persistence failure (%s)',async failAt=>{
  await pendingScope();const before={records:structuredClone(fixture.records),meta:structuredClone(fixture.meta),parts:structuredClone(fixture.parts)};
  fixture.failAt=failAt;await expect(recoverDeviceMemoryGeneration(fixture.owner,'orphan','a')).rejects.toThrow('aborted');
  expect(fixture.records).toEqual(before.records);expect(fixture.meta).toEqual(before.meta);expect(fixture.parts).toEqual(before.parts);
});
