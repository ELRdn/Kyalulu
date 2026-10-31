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
  expect(read.source).toEqual(source);expect(read.session).toEqual(publicOriginal);
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
