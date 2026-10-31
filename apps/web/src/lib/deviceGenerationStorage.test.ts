import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { harness,decoded } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),failAt:0}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),appTransaction:(_stores:string[],mode:string,action:any)=>{
  let writes=0;return harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action,{write:()=>{
    if(fixture.failAt&&++writes===fixture.failAt)throw Error('Quota');
  }});
}}));
import { appTransaction,newEntity,writeEntity,writeOutbox } from './appStore';
import { readMemorySource,readDeviceGenerationSource,commitDeviceGeneration } from './deviceMemoryStore';
import { deviceExecutionLockName } from './deviceExecution';
import { Sha256 } from '../mobile/sha256';
import { JsonStream } from './jsonStream';
import type { GenerationChange } from './deviceGenerationChange';

const user={id:100,uuid:'new-user',role:'user',content:'New input 茶🙂'};
const reply={id:101,uuid:'new-reply',role:'assistant',content:'New reply'};
const receipt=(status:string)=>({generation_id:'gen',session_id:'chat',status,user_id:user.id,assistant_id:status==='completed'?reply.id:null,
  execution_lock:deviceExecutionLockName('owner'),user_content_sha256:new Sha256().update(new TextEncoder().encode(user.content)).digest(),
  ...(status==='completed'?{reply:reply.content,full:reply.content}:{})});
const body=()=>decoded(fixture.records.get(JSON.stringify(['owner','chat'])),fixture.parts);
const snapshot=()=>structuredClone({records:[...fixture.records],meta:[...fixture.meta],parts:[...fixture.parts]});
beforeEach(()=>{fixture.owner='owner';fixture.records.clear();fixture.meta.clear();fixture.parts.clear();fixture.failAt=0;
  vi.stubGlobal('IDBKeyRange',{bound:(lower:unknown,upper:unknown)=>({lower,upper})});
});
afterEach(()=>vi.unstubAllGlobals());
async function seed(policy:string){
  const source={...newEntity('conversation','chat',{storage_policy:policy,memory_scope_mode:'legacy',settings:{session_id:'chat'},state:{turn:0},
    memories:[],summaries:[],draft:'Unsent draft',unknown:{keep:true},messages:Array.from({length:20},(_,i)=>({id:i+1,uuid:'old-'+i,role:i%2?'assistant':'user',content:'茶🙂'.repeat(300)}))}),revision:4};
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,source,'put',done));
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>writeOutbox(tx,'owner',{request_id:'fixed',changes:[{id:'chat',kind:'conversation',base_revision:0,deleted:false,payload:{draft:'Keep fixed snapshot'}}]},done));
  return (await readMemorySource('chat','owner'))!;
}
const change=(source:any,status:string):GenerationChange=>({metadata:{...source.metadata,pending_generation:status==='pending'?'gen':null},
  receipt:receipt(status),append:status==='pending'?[user]:status==='completed'?[reply]:[]});

it.each(['local','sync'])('commits admission and completion with complete prefix/outbox preservation (%s)',async policy=>{
  let source=await seed(policy);const original=body(),outbox=structuredClone(fixture.meta.get('sync:owner:outbox'));
  const read=(await readDeviceGenerationSource('chat','owner'))!,{memoryReferences:_,...publicOriginal}=original;
  const {payload,...header}=publicOriginal;
  expect(read.source).toEqual(source);expect(read.header).toEqual(header);
  expect(read.messages).toEqual(payload.messages.map(({id,uuid,role,content,imported_state}:any)=>({id,uuid,role,content,imported_state})));
  expect(read.latest).toEqual(payload.messages.at(-1));
  source=await commitDeviceGeneration(source,change(source,'pending'));
  expect(body().payload.messages).toEqual([...original.payload.messages,user]);expect(fixture.meta.get('generation:owner:gen').status).toBe('pending');
  source=await commitDeviceGeneration(source,change(source,'completed'));
  expect(body().payload.messages).toEqual([...original.payload.messages,user,reply]);expect(body().payload.pending_generation).toBeNull();
  expect(body().payload.last_generation).toEqual(receipt('completed'));expect(source.revision).toBe(6);expect(body().dirty).toBe(policy==='sync');
  for(const key of ['draft','unknown','settings','state','memories','summaries'])expect(body().payload[key]).toEqual(original.payload[key]);
  expect(fixture.meta.get('sync:owner:outbox')).toEqual(outbox);
});

it.each(['pending','completed'])('rolls back %s quota failure including receipt and retries without lost history',async stage=>{
  let source=await seed('local');if(stage==='completed')source=await commitDeviceGeneration(source,change(source,'pending'));
  const before=snapshot();fixture.failAt=2;
  await expect(commitDeviceGeneration(source,change(source,stage))).rejects.toThrow();expect(snapshot()).toEqual(before);
  fixture.failAt=0;await commitDeviceGeneration(source,change(source,stage));expect(fixture.meta.get('generation:owner:gen').status).toBe(stage);
});

it('preserves a competing same-revision replacement body and keeps the pending receipt unresolved',async()=>{
  let source=await seed('local');source=await commitDeviceGeneration(source,change(source,'pending'));
  const winner={...body(),payload:{...body().payload,draft:'Winning unsent draft'}};
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,winner,'put',done));const before=snapshot();
  await expect(commitDeviceGeneration(source,change(source,'completed'))).rejects.toThrow();expect(snapshot()).toEqual(before);
  expect(body().payload.draft).toBe('Winning unsent draft');expect(fixture.meta.get('generation:owner:gen').status).toBe('pending');
});

it.each(['segmented','inline'])('projects actor history while retaining the complete regeneration tail and stored originals (%s)',async format=>{
  await seed('local');const original=body();
  original.payload.messages=original.payload.messages.map((message:any,index:number)=>({...message,
    imported_state:index===2?'stopped':undefined,unknown:{private:'authored-'+index},
    before:{state:{turn:index,location:'before-'+index},memories:[{id:'memory-'+index,content:'茶🙂'.repeat(10000)}],settings:{authored:'before'}},
    after:{state:{turn:index+1},memories:[],settings:{authored:'after'}}}));
  if(format==='inline')fixture.records.set(JSON.stringify(['owner','chat']),original);
  else await appTransaction<void>(['entities'],'readwrite',(tx,done)=>writeEntity(tx,original,'put',done));
  const before=snapshot(),finish=JsonStream.prototype.finish,roots:number[]=[];
  const observed=vi.spyOn(JsonStream.prototype,'finish').mockImplementation(function(this:JsonStream){const value=finish.call(this);roots.push(value.messages.length);return value;});
  try{
    const context=(await readDeviceGenerationSource('chat','owner'))!;
    expect(context.messages).toEqual(original.payload.messages.map(({id,uuid,role,content,imported_state}:any)=>({id,uuid,role,content,imported_state})));
    expect(context.messages.every(message=>!Object.hasOwn(message,'before')&&!Object.hasOwn(message,'after')&&!Object.hasOwn(message,'unknown'))).toBe(true);
    expect(context.latest).toEqual(original.payload.messages.at(-1));
    expect(context.source.metadata).toEqual(Object.fromEntries(Object.entries(original.payload).filter(([key])=>key!=='messages')));
    expect(Object.hasOwn(context,'session')).toBe(false);
    expect(roots).toEqual(format==='segmented'?[0]:[]);
    const after=snapshot();expect(after.records).toEqual(before.records);expect(after.meta).toEqual(before.meta);
    expect(after.parts.map(([key])=>key)).toEqual(before.parts.map(([key])=>key));
    for(const [key,bytes] of before.parts)expect(Buffer.compare(Buffer.from(fixture.parts.get(key)),Buffer.from(bytes)),key).toBe(0);
    expect(body().payload).toEqual(original.payload);
  }finally{observed.mockRestore();}
});

it('rejects a corrupt final actor history part without publishing a partial context or changing originals',async()=>{
  await seed('local');const header=fixture.records.get(JSON.stringify(['owner','chat'])),ref=header.payloadParts;
  const key=JSON.stringify(['owner','entity','chat',ref.token,ref.chunks-1]);
  const bytes=fixture.parts.get(key).slice();bytes[bytes.length-1]^=1;fixture.parts.set(key,bytes);
  const before=snapshot();await expect(readDeviceGenerationSource('chat','owner')).rejects.toThrow();expect(snapshot()).toEqual(before);
  await expect(readDeviceGenerationSource('chat','foreign')).rejects.toThrow();expect(snapshot()).toEqual(before);
});
