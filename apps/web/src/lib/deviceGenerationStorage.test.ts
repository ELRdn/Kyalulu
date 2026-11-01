import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { harness,decoded } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'owner',records:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),failAt:0}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner}));
vi.mock('./appStore',async original=>({...await original<typeof import('./appStore')>(),appTransaction:(_stores:string[],mode:string,action:any)=>{
  let writes=0;return harness(fixture.records,fixture.meta,fixture.parts,JSON.stringify,mode,action,{write:()=>{
    if(fixture.failAt&&++writes===fixture.failAt)throw Error('Quota');
  }});
},getMeta:async(key:string)=>structuredClone(fixture.meta.get(key)),readConversationSummary:async(id:string,owner:string)=>{
  const record=decoded(fixture.records.get(JSON.stringify([owner,id])),fixture.parts);return record&&{count:record.payload.messages.length};
}}));
import { appTransaction,newEntity,writeEntity,writeOutbox } from './appStore';
import { readMemorySource,readDeviceGenerationSource,commitDeviceGeneration } from './deviceMemoryStore';
import { deviceExecutionLockName } from './deviceExecution';
import { Sha256 } from '../mobile/sha256';
import { JsonStream } from './jsonStream';
import type { GenerationChange } from './deviceGenerationChange';
import { deviceFetch } from './deviceApi';
import { scrubGenerationRecords } from './appStore';
import { readGenerationReceipt } from './deviceGenerationStore';
import * as generationStore from './deviceGenerationStore';
import { assemblePortable } from './devicePrompt';
import { writeConversationGenerationInput, type ConversationGenerationInput } from './deviceGenerationInput';

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

it.each(['segmented','inline'])('replays full pre-fit bytes from the pinned %s source without passing an input array',async format=>{
  await seed('local');const original=body();
  original.payload.messages=original.payload.messages.map((message:any,index:number)=>({...message,
    content:`Original ${index} 茶🙂\\"\n\u0000\ud800 `+'本文🙂'.repeat(14000),
    imported_state:index===1?'stopped':index===2?'interrupted':undefined,
    before:{state:{turn:index}},after:{state:{turn:index+1}},unknown:{keep:index}}));
  original.payload.messages[3]={...original.payload.messages[3],role:'system',content:'Conversation source-linked summary'};
  if(format==='inline')fixture.records.set(JSON.stringify(['owner','chat']),original);
  else await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,original,'put',done));
  let source=(await readMemorySource('chat','owner'))!;
  source=await commitDeviceGeneration(source,change(source,'pending'));
  const stored=body(),ordered=[{role:'system',content:'Before'},
    {role:'system',content:'',slot:'history'},{role:'user',content:'Between'},
    {role:'system',content:'',slot:'history'},{role:'assistant',content:'After'}];
  const expected=assemblePortable({ordered_messages:ordered} as any,
    stored.payload.messages.filter((m:any)=>!['stopped','interrupted'].includes(m.imported_state)), 'Contract');
  const input:ConversationGenerationInput={format:'conversation-input@1',source,contract:expected[0].content,ordered};
  const completed=change(source,'completed');completed.input=input;
  completed.receipt={...completed.receipt,compiled:{ordered_messages:ordered},memory:null,telemetry:{memory:null}};
  const before=snapshot(),stringify=JSON.stringify;
  const aggregate=vi.spyOn(JSON,'stringify').mockImplementation(((value:any,...args:any[])=>{
    if(value===input||value===expected||value===stored.payload.messages)throw Error('Aggregate generation input');
    return stringify(value,...args);
  }) as typeof JSON.stringify);
  const finish=JsonStream.prototype.finish,retained:number[]=[];
  const read=vi.spyOn(JsonStream.prototype,'finish').mockImplementation(function(this:JsonStream){
    const result=finish.call(this);if(Array.isArray(result?.messages))retained.push(result.messages.length);return result;
  });
  try{await commitDeviceGeneration(source,completed);}finally{aggregate.mockRestore();read.mockRestore();}
  expect(retained.length).toBeGreaterThanOrEqual(4);expect(retained.every(count=>count===0)).toBe(true);
  const manifest=fixture.meta.get('generation:owner:gen'),ref=manifest.sections.prompt;
  const bytes=Array.from({length:ref.chunks},(_,index)=>fixture.parts.get(JSON.stringify(['owner','generation','gen',ref.token,index])));
  const raw=await new Blob(bytes.map(bytes=>new Uint8Array(bytes))).text();
  expect(raw).toBe(JSON.stringify(expected));expect(ref.size).toBeGreaterThan(2*1024*1024);
  expect(bytes.every(bytes=>bytes.length<=1024*1024)).toBe(true);
  const chunks:Uint8Array[]=[];for await(const part of generationStore.generationReceiptChunks('owner',{kind:'conversation',id:'chat'},'gen'))chunks.push(part);
  expect(JSON.parse(await new Blob(chunks.map(part=>new Uint8Array(part))).text())).toEqual({...completed.receipt,raw_prompt:raw});
  expect(body().payload.messages).toEqual([...stored.payload.messages,reply]);
  for(const name of ['draft','unknown','settings','state','memories','summaries'])expect(body().payload[name]).toEqual(stored.payload[name]);
  expect([...fixture.meta].find(([key])=>key==='sync:owner:outbox')).toEqual(before.meta.find(([key])=>key==='sync:owner:outbox'));
});

it('replays regeneration without the replaced reply and preserves a no-history compiler input',async()=>{
  let source=await seed('local');const original=body();
  original.payload.messages.push(user,{...reply,content:'Old assistant',before:{state:{turn:0},memories:[]}});
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,original,'put',done));
  source=(await readMemorySource('chat','owner'))!;
  const pending=change(source,'pending');pending.append=[];pending.regenerate=reply.id;
  source=await commitDeviceGeneration(source,pending);
  const completed=change(source,'completed');completed.regenerate=reply.id;
  completed.append=[{...reply,id:102}];completed.receipt.assistant_id=102;
  completed.input={format:'conversation-input@1',source,contract:'Contract',regenerate:reply.id,
    ordered:[{role:'system',content:'',slot:'history'}]};
  await commitDeviceGeneration(source,completed);
  const saved=await readGenerationReceipt('owner',{kind:'conversation',id:'chat'},'gen');
  expect(saved.state).toBe('inline');if(saved.state!=='inline')throw Error('Expected small receipt');
  expect(JSON.parse(saved.value.raw_prompt)).toEqual([{role:'system',content:'Contract'},
    ...original.payload.messages.slice(0,-1).map(({role,content}:any)=>({role,content}))]);
  expect(body().payload.messages).toEqual([...original.payload.messages.slice(0,-1),{...reply,id:102}]);
  const current=(await readMemorySource('chat','owner'))!,parts=await appTransaction<any>(['entities','parts'],'readwrite',(tx,done)=>
    writeConversationGenerationInput(tx,'owner','chat',{format:'conversation-input@1',source:current,contract:'Only',ordered:[]},['owner','test','no-history'],done));
  expect(new TextDecoder().decode(fixture.parts.get(JSON.stringify(['owner','test','no-history',parts.token,0])))).toBe('[{"role":"system","content":"Only"}]');
});

it.each(['owner','id','revision','bodyToken','replacement','quota','checksum','no-history-checksum'])('rejects %s replay atomically and keeps originals/pending/outbox',async fault=>{
  let source=await seed('sync');source=await commitDeviceGeneration(source,change(source,'pending'));
  const completed=change(source,'completed'),input:ConversationGenerationInput={format:'conversation-input@1',source:{...source},contract:'Contract',ordered:[{role:'system',content:'',slot:'history'}]};
  completed.input=input;
  if(fault==='owner')input.source.owner='foreign';if(fault==='id')input.source.id='foreign';
  if(fault==='revision')input.source.revision++;if(fault==='bodyToken')input.source.bodyToken=crypto.randomUUID();
  if(fault==='replacement')input.regenerate=20;
  if(fault==='quota')fixture.failAt=3;
  if(fault.endsWith('checksum')){
    const header=fixture.records.get(JSON.stringify(['owner','chat'])),ref=header.payloadParts;
    const key=JSON.stringify(['owner','entity','chat',ref.token,ref.chunks-1]),bytes=fixture.parts.get(key).slice();
    bytes[bytes.length-1]^=1;fixture.parts.set(key,bytes);
    if(fault==='no-history-checksum')input.ordered=[];
  }
  const before=snapshot();
  if(fault.endsWith('checksum'))await expect(appTransaction<void>(['entities','parts'],'readwrite',(tx,done)=>
    writeConversationGenerationInput(tx,'owner','chat',input,['owner','test','corrupt'],()=>done()))).rejects.toThrow();
  else await expect(commitDeviceGeneration(source,completed)).rejects.toThrow();
  expect(snapshot()).toEqual(before);expect(fixture.meta.get('generation:owner:gen').status).toBe('pending');
});

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
it('commits a canonical receipt and conversation together, exposing explicit large diagnostics and preserved story data',async()=>{
  let source=await seed('local');source=await commitDeviceGeneration(source,change(source,'pending'));
  const completed=change(source,'completed'),trace={candidates:[{id:'memory-source',source_session_id:'source-other',content:'Private memory'}],injected:['memory-source']};
  const compiled={system_prompt:'Original compiler',sections:{portable_snapshot:{world:{cast:[{id:'saved-cast',display_name:'Original cast'}]}}}};
  completed.input=[{role:'system',content:'x'.repeat(2*1024*1024)},{role:'user',content:user.content}];
  completed.receipt={...completed.receipt,compiled,memory:trace,telemetry:{memory:trace},state:{turn:1},validation:{ok:true,errors:[]}};
  completed.metadata.state={turn:1,relationship_state:{stage:'friend'}};
  const outbox=structuredClone(fixture.meta.get('sync:owner:outbox'));
  source=await commitDeviceGeneration(source,completed);
  const header=fixture.meta.get('generation:owner:gen');expect(header.format).toBe('device-generation@1');
  expect(header.sections.telemetryMemory).toBeUndefined();expect(body().memoryReferences).toBeNull();
  expect(body().payload.last_generation).toEqual(source.metadata.last_generation);
  for(const name of ['raw_prompt','compiled','memory','telemetry'])expect(source.metadata.last_generation[name]).toBeUndefined();
  expect(body().payload.messages.at(-1)).toEqual(reply);expect(body().payload.draft).toBe('Unsent draft');expect(fixture.meta.get('sync:owner:outbox')).toEqual(outbox);
  const status=await (await deviceFetch('/api/chat/generations/gen?session_id=chat')).json();
  expect(status).toMatchObject({status:'completed',device_diagnostics:{state:'stored',bytes:expect.any(Number)}});expect(status.sections).toBeUndefined();
  const debug=await (await deviceFetch('/api/chat/debug?session_id=chat')).json();
  expect(debug).toMatchObject({history_count:22,prompt_source:'stored',compiled:null,device_diagnostics:{state:'stored'},story:compiled.sections.portable_snapshot.world});
  const full=await (await deviceFetch(status.device_diagnostics.export_url)).json();
  expect(full).toEqual({...completed.receipt,raw_prompt:JSON.stringify(completed.input)});
  const sourceBefore=JSON.stringify(body().payload),oldPrompt=header.sections.prompt.token;
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>{scrubGenerationRecords(tx,'owner','source-other');done();});
  expect(JSON.stringify(body().payload)).toBe(sourceBefore);expect([...fixture.parts.keys()].some(key=>key.includes(oldPrompt))).toBe(false);
  const erased=await (await deviceFetch('/api/chat/debug?session_id=chat')).json();expect(erased.prompt_source).toBe('erased');expect(erased.generation.reply).toBe(reply.content);
  expect(erased.generation.memory.candidates).toEqual([]);expect(erased.generation.raw_prompt).toBeUndefined();
});
it.each(['inline-erased','inline-deleted','large-erased','large-deleted'])('discards diagnostics replaced before the debug response (%s)',async mode=>{
  let source=await seed('local');source=await commitDeviceGeneration(source,change(source,'pending'));
  const completed=change(source,'completed'),canary='PRIVATE DIAGNOSTIC BEFORE ERASURE';
  completed.input=[{role:'system',content:canary+(mode.startsWith('large')?'x'.repeat(2*1024*1024):'')}];
  completed.receipt={...completed.receipt,compiled:{system_prompt:canary,sections:{portable_snapshot:{world:{cast:[{display_name:canary}]}}}},
    memory:{candidates:[{id:'source-memory',source_session_id:'source-other',content:canary}],injected:['source-memory']}};
  completed.metadata.state={turn:1,relationship_state:{stage:'friend'}};
  await commitDeviceGeneration(source,completed);
  const read=generationStore.readGenerationHeader;let reads=0;
  const observed=vi.spyOn(generationStore,'readGenerationHeader').mockImplementation(async(...args)=>{
    if(++reads===2)await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>{
      scrubGenerationRecords(tx,'owner',mode.endsWith('deleted')?'chat':'source-other');done();
    });
    return read(...args);
  });
  try{
    const response=await deviceFetch('/api/chat/debug?session_id=chat');expect(response.status).toBe(200);
    const debug=await response.json();expect(reads).toBe(2);
    expect(debug.prompt_source).toBe('corrupt');expect(debug.compiled).toBeNull();expect(debug.memory).toBeNull();expect(debug.story).toBeUndefined();
    expect(debug.generation).toEqual({generation_id:'gen',status:'completed'});
    expect(JSON.stringify(debug).includes(canary)).toBe(false);
  }finally{observed.mockRestore();}
});
it.each(['missing','conflict'])('retains legacy inline evidence before a new canonical completion (%s)',async mode=>{
  await seed('local');const original=body(),old={...receipt('completed'),generation_id:'old',user_id:1,assistant_id:2,raw_prompt:'Original legacy prompt',compiled:{original:true},extension:{keep:'legacy'}};
  const legacy={...original,payload:{...original.payload,last_generation:old}};
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>writeEntity(tx,legacy,'put',done));
  let source=(await readMemorySource('chat','owner'))!;source=await commitDeviceGeneration(source,change(source,'pending'));
  const before=snapshot(),completed=change(source,'completed');completed.input=[{role:'user',content:user.content}];
  if(mode==='conflict')fixture.meta.set('generation:owner:old',{...old,raw_prompt:'Conflicting retained evidence'});
  if(mode==='missing'){
    await commitDeviceGeneration(source,completed);
    const retained=await readGenerationReceipt('owner',{kind:'conversation',id:'chat'},'old');expect(retained.state).toBe('inline');
    if(retained.state==='inline')expect(retained.value).toEqual(old);
    expect(body().payload.last_generation.generation_id).toBe('gen');
  }else{
    const conflictBefore=snapshot();await expect(commitDeviceGeneration(source,completed)).rejects.toThrow();expect(snapshot()).toEqual(conflictBefore);
    expect(body().payload.last_generation).toEqual(old);expect(fixture.meta.get('generation:owner:gen').status).toBe('pending');
  }
  expect(before.records.length).toBe(1);
});
