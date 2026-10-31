import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { harness } from './idbHarness.test-support';
const fixture=vi.hoisted(()=>({owner:'research-a',entities:new Map<string,any>(),meta:new Map<string,any>(),parts:new Map<string,any>(),failAt:0,switchAt:0,reads:[] as any[],busy:false}));
vi.mock('./appContext',()=>({deviceOwner:()=>fixture.owner,generationBusy:()=>fixture.busy,setGenerationBusy:(busy:boolean)=>{fixture.busy=busy;}}));
vi.mock('../mobile/models',()=>({MODELS:[{id:'fictional-model',runtime:'gguf',revision:'fictional-pinned',files:[],temperature:.6,topK:64,topP:.95}],readyModels:async()=>new Set(['fictional-model'])}));
vi.mock('./appStore',()=>({newEntity:(kind:string,id:string,payload:any,owner:string)=>({kind,id,payload,owner,revision:0,serverRevision:0,deleted:false,dirty:true,pinned:false,opened:0}),appTransaction:(_stores:string[],mode:string,action:any)=>{
  let writes=0;return harness(fixture.entities,fixture.meta,fixture.parts,JSON.stringify,mode,action,{write:()=>{
    writes++;if(writes===fixture.failAt)throw Error('Quota');if(writes===fixture.switchAt)fixture.owner='research-b';
  },read:(_mode,name,key)=>{if(name==='parts')fixture.reads.push(key);}});
},getMeta:async(key:string)=>structuredClone(fixture.meta.get(key))}));
import { newEntity } from './appStore';
import { readResearchExperiment,writeResearchExperiment,type ResearchExperiment } from './deviceResearchStore';
import { deviceResearchRoute } from './deviceResearch';
import { deviceExecutionLockName } from './deviceExecution';
import { readGenerationHeader,readGenerationReceipt,generationReceiptChunks,eraseGenerationMemoryReferences,type GenerationHeader } from './deviceGenerationStore';
import * as generations from './deviceGenerationStore';
import { appTransaction } from './appStore';
import { Sha256 } from '../mobile/sha256';
import { JsonStream } from './jsonStream';
import { compilePortable } from './devicePrompt';
import { MODELS } from '../mobile/models';
import catalog from '../mobile/app-catalog.generated.json';
import { sampling } from '../mobile/sampling';
const id='10000000-0000-4000-8000-000000000001',owner='research-a';
const key='device-research:'+JSON.stringify(owner)+':experiment:'+id;
const value=():ResearchExperiment=>({revision:0,meta:{experiment_id:id,status:'running',metrics:{failure_rate:0}},turns:[{turn:1,assistant:'Keep result 茶🙂'}],raw_prompt:'Keep original prompt',
  session:newEntity('conversation','exp:'+id,{storage_policy:'local',messages:[{id:1,role:'user',content:'Unsent original 茶🙂'}],state:{turn:0},pending_generation:'pending'},owner)});
const snapshot=()=>structuredClone({meta:[...fixture.meta],parts:[...fixture.parts].map(([key,bytes])=>[key,bytes instanceof Uint8Array?{size:bytes.length,sha256:new Sha256().update(bytes).digest()}:bytes]),entities:[...fixture.entities]});
beforeEach(()=>{fixture.owner=owner;fixture.entities.clear();fixture.meta.clear();fixture.parts.clear();fixture.failAt=0;fixture.switchAt=0;fixture.reads=[];fixture.busy=false;});
afterEach(()=>vi.unstubAllGlobals());

it('roundtrips legacy and segmented experiments with original extensions and removes only superseded parts',async()=>{
  const source={...value(),revision:3,extra:{keep:'legacy extension'}};fixture.meta.set(key,structuredClone(source));
  fixture.meta.set('sync:research-a:outbox',{request_id:'fixed',keep:'Unsent snapshot'});
  fixture.parts.set(JSON.stringify([owner,'unrelated','keep']),new Uint8Array([7]));
  expect(await readResearchExperiment(owner,id)).toEqual(source);
  const revision=await writeResearchExperiment(owner,id,source),header=fixture.meta.get(key);
  expect(header).toMatchObject({format:'device-research@1',revision:4});
  expect(header.session).toBeUndefined();expect(header.turns).toBeUndefined();expect(header.raw_prompt).toBeUndefined();
  expect(await readResearchExperiment(owner,id)).toEqual({...source,revision});
  const previousKeys=[...fixture.parts.keys()].filter(k=>k.includes(header.bodyParts.token));
  const changed={...source,revision,meta:{...source.meta,status:'completed'}};
  expect(await writeResearchExperiment(owner,id,changed)).toBe(5);
  expect(await readResearchExperiment(owner,id)).toEqual({...changed,revision:5});
  expect(previousKeys.every(k=>!fixture.parts.has(k))).toBe(true);
  expect(fixture.meta.get('sync:research-a:outbox')).toEqual({request_id:'fixed',keep:'Unsent snapshot'});
  expect(fixture.parts.get(JSON.stringify([owner,'unrelated','keep']))).toEqual(new Uint8Array([7]));
  expect(fixture.entities.size).toBe(0);
});
it.each(['legacy','segmented'])('rolls back quota and account changes without losing the %s source',async kind=>{
  const source=value();let revision=0;
  if(kind==='legacy')fixture.meta.set(key,structuredClone(source));else revision=await writeResearchExperiment(owner,id,source);
  const next={...source,revision,meta:{...source.meta,status:'completed'}};
  const before=snapshot();fixture.failAt=1;
  await expect(writeResearchExperiment(owner,id,next)).rejects.toThrow();expect(snapshot()).toEqual(before);
  fixture.failAt=0;fixture.switchAt=1;
  await expect(writeResearchExperiment(owner,id,next)).rejects.toThrow();expect(snapshot()).toEqual(before);
  fixture.owner=owner;fixture.switchAt=0;
  expect(await readResearchExperiment(owner,id)).toEqual({...source,revision});
  expect(await writeResearchExperiment(owner,id,next)).toBe(revision+1);
});
it('rejects stale revisions and mismatched owner/session scope before replacing any data',async()=>{
  const source=value(),revision=await writeResearchExperiment(owner,id,source),before=snapshot();
  await expect(writeResearchExperiment(owner,id,source)).rejects.toThrow();expect(snapshot()).toEqual(before);
  for(const session of [{...source.session,owner:'research-b'},{...source.session,id:'exp:other'},
    {...source.session,payload:{...source.session.payload,storage_policy:'sync'}}]){
    await expect(writeResearchExperiment(owner,id,{...source,revision,session})).rejects.toThrow();expect(snapshot()).toEqual(before);
  }
  fixture.owner='research-b';await expect(readResearchExperiment(owner,id)).rejects.toThrow('Account changed');
});
it.each(['missing','checksum','manifest','header'])('refuses %s corruption and preserves the original evidence',async fault=>{
  const source=value(),revision=await writeResearchExperiment(owner,id,source),header=fixture.meta.get(key);
  const partKey=JSON.stringify([owner,'research',id,header.bodyParts.token,0]);
  if(fault==='missing')fixture.parts.delete(partKey);
  if(fault==='checksum')fixture.parts.get(partKey)[5]^=1;
  if(fault==='manifest')header.bodyParts.size++;
  if(fault==='header')header.meta.status='tampered';
  const before=snapshot();await expect(readResearchExperiment(owner,id)).rejects.toThrow();expect(snapshot()).toEqual(before);
  await expect(writeResearchExperiment(owner,id,{...source,revision})).rejects.toThrow();expect(snapshot()).toEqual(before);
});

const hash=(text:string)=>new Sha256().update(new TextEncoder().encode(text)).digest();
const holder={kind:'research' as const,id};
const generationKey=(generation='fictional-generation')=>'generation:'+owner+':'+generation;
const receipt=(overrides:Record<string,any>={})=>({generation_id:'fictional-generation',session_id:'exp:'+id,status:'completed',user_id:1,assistant_id:2,
  user_content_sha256:hash('Fictional question'),execution_lock:deviceExecutionLockName(owner),reply:'Fictional answer',full:'Fictional answer',
  raw_prompt:'[{"role":"user","content":"Fictional question"}]',compiled:{sections:{portable_snapshot:{document:{title:'Fictional saved snapshot'}}}},
  state:{location:'Fictional library'},state_before:{location:'Fictional garden'},validation:{ok:true,retries:0,errors:[]},
  telemetry:{first_reply_ms:7,memory:{candidates:[]}},memory:{candidates:[]},attempts:[{raw:'Fictional model output'}],
  generation_config:{requested:{temperature:.6},applied:{temperature:.6}},token_budget:{total_prompt_tokens:42},...overrides});
async function begin(){
  const source=value();source.turns=[];source.session.payload.messages=[];source.session.payload.pending_generation=null;
  source.revision=await writeResearchExperiment(owner,id,source);
  const {generation_id,session_id,user_id,user_content_sha256,execution_lock}=receipt();
  const pending={generation_id,session_id,user_id,user_content_sha256,execution_lock,status:'pending',assistant_id:null};
  source.session={...source.session,revision:1,payload:{...source.session.payload,messages:[{id:1,role:'user',content:'Fictional question'}],pending_generation:generation_id}};
  source.revision=await writeResearchExperiment(owner,id,source,{receipt:pending});return source;
}
function finish(source:ResearchExperiment,done=receipt()):ResearchExperiment {
  const turn={...done,turn:1,type:'chat',user:'Fictional question',assistant:done.reply,elapsed_ms:9,probe:{outcome:'recalled'},extension:{keep:'Fictional extension'}};
  return {...source,turns:[turn],meta:{...source.meta,status:'completed'},session:{...source.session,revision:2,payload:{...source.session.payload,
    messages:[...source.session.payload.messages,{id:2,role:'assistant',content:done.reply}],pending_generation:null,last_generation:done}}};
}
async function completed(done=receipt(),input?:readonly unknown[]){
  const source=await begin(),next=finish(source,done);next.revision=await writeResearchExperiment(owner,id,next,{receipt:done,input});return next;
}
async function full(generation='fictional-generation'){
  const parser=new JsonStream();for await(const chunk of generationReceiptChunks(owner,holder,generation))parser.feed(chunk);return parser.finish();
}
async function route(suffix='',method='GET',body={}){
  vi.stubGlobal('navigator',{locks:{request:async(_name:any,_options:any,fn:any)=>fn(null)}});
  const path='/api/experiments/'+id+suffix;
  return deviceResearchRoute(path,method,body,new URL(path,'https://fictional.test'),owner,undefined,vi.fn(),vi.fn());
}
it('atomically stores the full research turn once and recompacts subsequent full active writes',async()=>{
  const next=await completed(),stored=(await readResearchExperiment(owner,id))!;
  const turn=stored.turns[0],last=stored.session.payload.last_generation;
  expect(turn).toMatchObject({turn:1,user:'Fictional question',assistant:'Fictional answer',type:'chat',elapsed_ms:9,probe:{outcome:'recalled'},device_diagnostics:{holder,state:'stored'}});
  expect(turn.extension).toBeUndefined();
  for(const field of ['raw_prompt','compiled','state','state_before','validation','telemetry','memory','attempts','generation_config','token_budget','full','reply']){
    expect(turn[field]).toBeUndefined();expect(last[field]).toBeUndefined();
  }
  expect(turn.device_diagnostics).toEqual(last.device_diagnostics);
  expect(await full()).toEqual(next.turns[0]);
  const header=await readGenerationHeader(owner,holder,'fictional-generation'),parts=[...fixture.parts.keys()].filter(key=>key.includes('generation'));
  next.revision=await writeResearchExperiment(owner,id,next);
  expect(await readGenerationHeader(owner,holder,'fictional-generation')).toEqual(header);
  expect([...fixture.parts.keys()].filter(key=>key.includes('generation'))).toEqual(parts);
  expect((await readResearchExperiment(owner,id))!.turns[0]).toEqual(turn);
  expect(next.turns[0].compiled).toBeDefined();
});
it('streams exact input JSON as raw_prompt without aggregate input serialization',async()=>{
  const done:any=receipt();delete done.raw_prompt;
  const input=[{role:'system',content:'Fictional 茶🙂\\"\n'.repeat(160000)},{role:'user',content:'Fictional question'}];
  const expected=JSON.stringify(input),stringify=JSON.stringify;
  const spy=vi.spyOn(JSON,'stringify').mockImplementation(((value:any,...args:any[])=>{
    if(value===input)throw Error('Aggregate input serialization');return stringify(value,...args);
  }) as typeof JSON.stringify);
  let next!:ResearchExperiment;try{next=await completed(done,input);}finally{spy.mockRestore();}
  expect(await full()).toEqual({...next.turns[0],raw_prompt:expected});
  expect(await readGenerationReceipt(owner,holder,done.generation_id)).toMatchObject({state:'stored',bytes:expect.any(Number),sha256:expect.any(String)});
});
it.each(['quota','owner','pending','receipt','session','hash','collision'])('rolls back the entire canonical completion on %s failure',async fault=>{
  const source=await begin(),done=receipt(),next=finish(source,done);
  if(fault==='quota')fixture.failAt=4;
  if(fault==='owner')fixture.switchAt=4;
  if(fault==='pending')next.session.payload.pending_generation='foreign';
  if(fault==='receipt')next.turns[0].compiled={tampered:true};
  if(fault==='session')next.session.revision++;
  if(fault==='hash')next.turns[0].user='Tampered fictional input';
  if(fault==='collision')fixture.meta.set(generationKey(),{...receipt(),session_id:'exp:foreign'});
  const before=snapshot();await expect(writeResearchExperiment(owner,id,next,{receipt:done})).rejects.toThrow();expect(snapshot()).toEqual(before);
});
it('rejects stale canonical manifests and forged holders during later persist without restoring diagnostics',async()=>{
  const next=await completed(),original=(await readResearchExperiment(owner,id))!,before=snapshot();
  original.turns[0].device_diagnostics.holder.id='foreign';
  await expect(writeResearchExperiment(owner,id,original)).rejects.toThrow();expect(snapshot()).toEqual(before);
  fixture.meta.get(generationKey()).reply_sha256='0'.repeat(64);const corrupt=snapshot();
  await expect(writeResearchExperiment(owner,id,next)).rejects.toThrow();expect(snapshot()).toEqual(corrupt);
});
it('stores only small pending/failed generation metadata and retains the experiment on invalid failed transitions',async()=>{
  const source=await begin(),pending=fixture.meta.get(generationKey()),failed={...pending,status:'failed'};
  expect(pending).toEqual({generation_id:'fictional-generation',session_id:'exp:'+id,status:'pending',assistant_id:null,user_id:1,user_content_sha256:hash('Fictional question'),execution_lock:deviceExecutionLockName(owner)});
  const next={...source,session:{...source.session,revision:2,payload:{...source.session.payload,pending_generation:null}}},before=snapshot();
  await expect(writeResearchExperiment(owner,id,next,{receipt:{...failed,compiled:{large:'forbidden'}}})).rejects.toThrow();expect(snapshot()).toEqual(before);
  next.revision=await writeResearchExperiment(owner,id,next,{receipt:failed});expect(fixture.meta.get(generationKey())).toEqual(failed);
  expect((await readResearchExperiment(owner,id))!.session.payload.pending_generation).toBeNull();
});
it('restores the full old detail for small canonical turns and streams self-contained experiment and per-turn exports',async()=>{
  const next=await completed(),before=snapshot(),detail=await (await route()).json();
  expect(detail.turns).toEqual(next.turns);expect(detail.turns[0].device_diagnostics).toBeUndefined();
  expect(await (await route('/export')).json()).toEqual({meta:next.meta,turns:next.turns,raw_prompt:next.raw_prompt,ratings:{},metrics:next.meta.metrics});
  expect(await (await route('/turns/1/diagnostics')).json()).toEqual(next.turns[0]);expect(snapshot()).toEqual(before);
  await expect(route('/turns/2/diagnostics')).rejects.toMatchObject({status:404});
  await expect(route('/turns/1/diagnostics','POST')).rejects.toMatchObject({status:405});
});
it('keeps large canonical details compact with authored output and complete export links',async()=>{
  const done=receipt({raw_prompt:'Fictional raw 茶🙂'.repeat(90000)}),next=await completed(done),before=snapshot();
  const detail=await (await route()).json(),turn=detail.turns[0];
  expect(turn).toMatchObject({generation_id:done.generation_id,session_id:done.session_id,user_id:done.user_id,assistant_id:done.assistant_id,
    assistant:done.reply,user:'Fictional question',probe:{outcome:'recalled'},device_diagnostics:{state:'stored',bytes:expect.any(Number),sha256:expect.stringMatching(/^[a-f0-9]{64}$/),export_url:`/api/experiments/${id}/turns/1/diagnostics`}});
  expect(turn.extension).toBeUndefined();
  expect(turn.raw_prompt).toBeUndefined();expect(turn.compiled).toBeUndefined();expect(turn.device_diagnostics.holder).toBeUndefined();
  const exported=await (await route('/export')).json();expect(exported.turns).toEqual(next.turns);expect(JSON.stringify(exported)).not.toContain('device_diagnostics');
  expect(await (await route('/turns/1/diagnostics')).json()).toEqual(next.turns[0]);expect(snapshot()).toEqual(before);
});
it('counts the entire expanded detail including aliases before admitting full diagnostics',async()=>{
  const trace={candidates:[],content:'Fictional memory '.repeat(42000)},done=receipt({memory:trace,telemetry:{memory:trace}});
  await completed(done);expect((await readGenerationReceipt(owner,holder,done.generation_id)).state).toBe('inline');
  // Root metadata pushes the entire response past the limit even though the turn fits alone.
  const record=(await readResearchExperiment(owner,id))!;record.meta.extension='Fictional metadata '.repeat(6000);
  await writeResearchExperiment(owner,id,record);
  const detail=await (await route()).json();expect(detail.turns[0].device_diagnostics.state).toBe('stored');expect(detail.turns[0].memory).toBeUndefined();
});
it('falls back to compact rows when individually small canonical turns exceed the combined detail boundary',async()=>{
  const next=await completed(receipt({raw_prompt:'Fictional input '.repeat(49000)}));
  const result=receipt({generation_id:'fictional-second-generation',user_id:3,assistant_id:4,user_content_sha256:hash('Fictional second question'),raw_prompt:'Fictional input '.repeat(49000)});
  const {generation_id,session_id,user_id,user_content_sha256,execution_lock}=result;
  const pending={generation_id,session_id,user_id,user_content_sha256,execution_lock,status:'pending',assistant_id:null};
  next.session={...next.session,revision:3,payload:{...next.session.payload,messages:[...next.session.payload.messages,{id:3,role:'user',content:'Fictional second question'}],pending_generation:generation_id}};
  next.revision=await writeResearchExperiment(owner,id,next,{receipt:pending});
  next.turns.push({...result,turn:2,type:'chat',user:'Fictional second question',assistant:result.reply,elapsed_ms:10});
  next.session={...next.session,revision:4,payload:{...next.session.payload,messages:[...next.session.payload.messages,{id:4,role:'assistant',content:result.reply}],pending_generation:null,last_generation:result}};
  next.revision=await writeResearchExperiment(owner,id,next,{receipt:result});
  expect((await readGenerationReceipt(owner,holder,'fictional-generation')).state).toBe('inline');
  expect((await readGenerationReceipt(owner,holder,generation_id)).state).toBe('inline');
  const detail=await (await route()).json();expect(detail.turns.map((turn:any)=>turn.device_diagnostics.state)).toEqual(['stored','stored']);
  expect(detail.turns.map((turn:any)=>[turn.generation_id,turn.user_id,turn.assistant_id])).toEqual([
    ['fictional-generation',1,2],[generation_id,3,4],
  ]);
  expect(detail.turns.every((turn:any)=>turn.raw_prompt===undefined)).toBe(true);
  expect((await (await route('/export')).json()).turns).toEqual(next.turns);
});
it.each(['missing','corrupt','foreign','deleted'])('marks %s canonical diagnostics explicitly and never uses another holder or current settings',async fault=>{
  await completed();
  if(fault==='missing')fixture.meta.delete(generationKey());
  if(fault==='deleted')fixture.meta.set(generationKey(),{generation_id:'fictional-generation',session_id:'exp:'+id,status:'deleted'});
  if(fault==='foreign')fixture.meta.get(generationKey()).holder.id='foreign';
  if(fault==='corrupt')fixture.meta.get(generationKey()).catalog_sha256='0'.repeat(64);
  const before=snapshot(),detail=await (await route()).json();
  expect(detail.turns[0]).toMatchObject({assistant:'Fictional answer',device_diagnostics:{state:fault==='missing'?'unavailable':fault==='deleted'?'erased':'corrupt'}});
  expect(detail.turns[0].compiled).toBeUndefined();expect(snapshot()).toEqual(before);
  await expect((await route('/turns/1/diagnostics')).text()).rejects.toThrow();
});
it('preserves a legacy large detail and offers its exact individual and full exports',async()=>{
  const legacy=value();legacy.turns[0].raw_prompt='Fictional legacy '.repeat(120000);fixture.meta.set(key,structuredClone(legacy));const before=snapshot();
  expect((await (await route()).json()).turns).toEqual(legacy.turns);
  expect((await (await route('/export')).json()).turns).toEqual(legacy.turns);
  expect(await (await route('/turns/1/diagnostics')).json()).toEqual(legacy.turns[0]);expect(snapshot()).toEqual(before);
});
it('keeps erased diagnostics explicit and never restores removed traces from an active full turn',async()=>{
  const trace={candidates:[{id:'fictional-memory',content:'Fictional private trace',source_session_id:'fictional-source'}],injected:['fictional-memory']};
  const next=await completed(receipt({memory:trace,telemetry:{memory:trace}}));
  const header=await readGenerationHeader(owner,holder,'fictional-generation') as GenerationHeader;
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>eraseGenerationMemoryReferences(tx,header,'fictional-source',new Set(['fictional-memory']),()=>done()));
  next.revision=await writeResearchExperiment(owner,id,next);
  const detail=await (await route()).json();expect(detail.turns[0]).toMatchObject({assistant:'Fictional answer',device_diagnostics:{state:'erased'}});
  expect(detail.turns[0].raw_prompt).toBeUndefined();expect(detail.turns[0].memory).toBeUndefined();
  const exported=await (await route('/export')).json();expect(exported.turns[0].assistant).toBe('Fictional answer');
  expect(exported.turns[0].raw_prompt).toBeUndefined();expect(exported.turns[0].compiled).toBeUndefined();
  expect(JSON.stringify(exported)).not.toContain('Fictional private trace');
});
it('discards an inline diagnostic if its catalog changes between receipt verification and detail admission',async()=>{
  const trace={candidates:[{id:'fictional-memory',content:'Fictional private trace',source_session_id:'fictional-source'}]};
  await completed(receipt({memory:trace,telemetry:{memory:trace}}));
  const header=await readGenerationHeader(owner,holder,'fictional-generation') as GenerationHeader,original=generations.readGenerationReceipt;
  const spy=vi.spyOn(generations,'readGenerationReceipt').mockImplementationOnce(async(...args)=>{
    const result=await original(...args);
    await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>eraseGenerationMemoryReferences(tx,header,'fictional-source',new Set(['fictional-memory']),()=>done()));
    return result;
  });
  try{
    const detail=await (await route()).json();expect(detail.turns[0]).toMatchObject({assistant:'Fictional answer',device_diagnostics:{state:'corrupt'}});
    expect(JSON.stringify(detail)).not.toContain('Fictional private trace');expect(detail.turns[0].raw_prompt).toBeUndefined();
  }finally{spy.mockRestore();}
});
it('replays a large canonical first turn from only its saved portable snapshot and saves the new full turn through the packet contract',async()=>{
  const compiled=compilePortable({document:{name:'Fictional researcher',data:{description:'Fictional saved instructions'}}});
  const config=sampling(MODELS[0],{temperature:.6});
  const source=await completed(receipt({compiled,generation_config:config,raw_prompt:'Fictional large original raw '.repeat(90000)}));
  const scenario={...catalog.scenarios[0],turns:catalog.scenarios[0].turns.slice(0,1)};
  Object.assign(source.meta,{scenario_id:scenario.id,model_id:MODELS[0].id,scenario_snapshot:scenario,model_config_snapshot:MODELS[0],generation_config:config,memory_enabled:false});
  source.revision=await writeResearchExperiment(owner,id,source);
  const before=(await readResearchExperiment(owner,id))!,header=await readGenerationHeader(owner,holder,'fictional-generation') as GenerationHeader;
  fixture.reads=[];
  vi.stubGlobal('navigator',{userAgent:'Fictional fixture',locks:{request:async(_name:any,_options:any,fn:any)=>fn({})}});
  const compile=vi.fn(),generate=vi.fn(async(body:any,_signal:any,scope:any)=>{
    const user=body.messages[0].content,pending={generation_id:body.generation_id,session_id:body.session_id,status:'pending',user_id:1,assistant_id:null,
      user_content_sha256:hash(user),execution_lock:deviceExecutionLockName(owner)};
    const session=await scope.save({...scope.session,payload:{...scope.session.payload,messages:[{id:1,role:'user',content:user}],pending_generation:body.generation_id}},pending);
    const result=receipt({...pending,status:'completed',assistant_id:2,compiled:scope.prompt,generation_config:config});delete (result as any).raw_prompt;
    await scope.save({...session,payload:{...session.payload,messages:[...session.payload.messages,{id:2,role:'assistant',content:result.reply}],last_generation:result,pending_generation:null}},result,[{role:'user',content:user}]);
    return new Response('event: done\ndata: '+JSON.stringify({generation_id:body.generation_id,status:'completed'})+'\n\n');
  });
  const path='/api/experiments/'+id+'/rerun',response=await deviceResearchRoute(path,'POST',{},new URL(path,'https://fictional.test'),owner,undefined,generate,compile);
  const results=await response.json();expect(results.results[0].meta.status).toBe('completed');expect(generate).toHaveBeenCalledTimes(1);expect(compile).not.toHaveBeenCalled();
  expect(fixture.reads.some(key=>key.includes(header.sections.compiled!.token))).toBe(true);
  expect(fixture.reads.some(key=>key.includes(header.sections.prompt!.token))).toBe(false);
  expect(await readResearchExperiment(owner,id)).toEqual(before);
  const replay=(await readResearchExperiment(owner,results.results[0].experiment_id))!;
  expect(replay.turns[0]).toMatchObject({turn:scenario.turns[0].turn,user:scenario.turns[0].user,assistant:'Fictional answer',device_diagnostics:{state:'stored'}});
  expect(replay.turns[0].compiled).toBeUndefined();expect(replay.session.payload.last_generation.device_diagnostics).toEqual(replay.turns[0].device_diagnostics);
  const restored=await readGenerationReceipt(owner,{kind:'research',id:replay.meta.experiment_id},replay.turns[0].generation_id);
  expect(restored.state).toBe('inline');if(restored.state==='inline'){
    expect(restored.value.compiled.sections.portable_snapshot).toEqual(compiled.sections.portable_snapshot);
    expect(JSON.parse(restored.value.raw_prompt)).toEqual([{role:'user',content:scenario.turns[0].user}]);
    expect(restored.value).toMatchObject({turn:scenario.turns[0].turn,type:scenario.turns[0].type,elapsed_ms:expect.any(Number)});
  }
});
