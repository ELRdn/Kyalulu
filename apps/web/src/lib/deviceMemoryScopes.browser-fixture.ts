import fixtures from '../../../../tests/fixtures/unified-memory-scopes.json';
import { RuntimeStateSchema } from '../../../../packages/schemas/src';
import { rememberOwner } from './appContext';
import { appTransaction,entity,getMeta,newEntity,saveEntity,setMeta,writeEntity,scrubGenerationRecords } from './appStore';
import { readDeviceMemoryDomain,commitDeviceMemoryDomain } from './deviceMemoryStore';
import { canonical } from './appSyncData';
import { deviceFetch } from './deviceApi';
import { deviceExecutionLockName } from './deviceExecution';
import { createElement } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import MemoryPanel from '../components/MemoryPanel';
import { preferences,savePreferences } from './appContext';
import { prepareRuntime } from '../pages/DeviceResearch.browser-fixture';
import '../index.css';
import { bindMemoryScope,memoryBinding,memoryIdentity,worldMemoryScope,sharedMemoryScope,ownScopeMemories,
  previewMemoryMigration,migrateMemoryDomain,memoryDomainKey,memorySignature,appendScopeEvent,reconcileScopeMemories } from './deviceMemoryScopes';

const owner='memory-scope-fixture',aId='scope-source-a',bId='scope-source-b';
const check=(ok:unknown,message:string)=>{if(!ok)throw Error(message);};
const same=(a:any,b:any)=>canonical(a)===canonical(b);
const identity=memoryIdentity({character_id:'fixture-character',world_id:'fixture-world'},
  {character_id:'1.0.0',persona_id:null,world_id:'1.0.0'});
const source=(sid:string,id:number)=>newEntity('conversation',sid,{storage_policy:'local',memory_scope_mode:'world',settings:{session_id:sid},
  messages:[{id,uuid:'source-'+sid,role:'user',content:'Fictional input '+sid}],summaries:[],draft:'Preserve draft '+sid,
  memories:[{id:'memory-'+sid,scope:sid,type:'semantic',content:'Fictional fact '+sid,origin:'user',supported:null,status:'active',
    source_session_id:sid,source_message_ids:[id],source_kind:'user_statement',version:1}]},owner);
const project=(domain:any,record:any)=>{const binding=memoryBinding(domain,record.id);record.payload.memories=ownScopeMemories(domain.pools[binding.scope],record.id);binding.signature=memorySignature(record.payload.memories);};
async function rejectDomainHeader(task:()=>Promise<unknown>) {
  const put=IDBObjectStore.prototype.put;let rejected=false;
  IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){
    if(this.name==='meta'&&key===memoryDomainKey(owner,'local'))throw new DOMException('Fictional quota failure','QuotaExceededError');
    return put.call(this,value,key!);
  };
  try{await task();}catch{rejected=true;}finally{IDBObjectStore.prototype.put=put;}
  check(rejected,'Expected domain-header write failure');
}

export async function run() {
  localStorage.setItem('kyalulu-execution-target','device');rememberOwner(owner);
  for(const c of fixtures.cases){const id=memoryIdentity(c.settings,c.identity.versions);
    check(same(id,c.identity),'Golden identity');check(worldMemoryScope(id,c.settings.session_id)===c.world_scope,'Python world scope');
    check(sharedMemoryScope(id,c.settings.session_id)===c.shared_scope,'Python shared scope');}
  let domain=await readDeviceMemoryDomain(owner,'local'),a=source(aId,1),b=source(bId,31);
  bindMemoryScope(domain,a,identity);bindMemoryScope(domain,b,identity);project(domain,a);project(domain,b);
  let result=await commitDeviceMemoryDomain(owner,'local',domain,[{id:aId,revision:0},{id:bId,revision:0}],[a,b]);
  domain=result.domain;[a,b]=result.sessions;
  let preview=previewMemoryMigration(domain,a,identity);
  check(migrateMemoryDomain(domain,a,identity,preview.preview_revision,true).copied===2,'Actual shared copy');project(domain,a);
  result=await commitDeviceMemoryDomain(owner,'local',domain,[{id:aId,revision:a.revision},{id:bId,revision:b.revision}],[a]);domain=result.domain;a=result.sessions[0];
  preview=previewMemoryMigration(domain,b,identity);check(migrateMemoryDomain(domain,b,identity,preview.preview_revision,true).copied===0,'Shared deduplication');project(domain,b);
  result=await commitDeviceMemoryDomain(owner,'local',domain,[{id:aId,revision:a.revision},{id:bId,revision:b.revision}],[b]);domain=result.domain;b=result.sessions[0];
  const shared=memoryBinding(domain,aId).scope;
  check(domain.pools[shared].memories.length===2,'Both sources visible in shared pool');
  check(a.payload.memories.length===1&&a.payload.memories[0].source_message_ids[0]===1,'Own A projection');
  check(b.payload.memories.length===1&&b.payload.memories[0].source_message_ids[0]===31,'Own B projection');
  domain.pending={session_id:aId,generation_id:'scope-generation'};a.payload.pending_generation='scope-generation';
  result=await commitDeviceMemoryDomain(owner,'local',domain,[{id:aId,revision:a.revision},{id:bId,revision:b.revision}],[a],
    {'scope-generation':{generation_id:'scope-generation',session_id:aId,status:'pending',execution_lock:deviceExecutionLockName(owner)}});domain=result.domain;a=result.sessions[0];
  let fenced=false;try{await saveEntity({...b,payload:{...b.payload,title:'MUST NOT COMMIT'}},b.revision);}catch{fenced=true;}
  check(fenced&&same(await entity(bId,owner),b),'Pending generation fences other source writes');
  a={...a,revision:a.revision+1,payload:{...a.payload,draft:'Newer externally saved draft'}};
  await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>writeEntity(tx,a,'put',done,true));
  const pendingDomain=structuredClone(domain),pendingA=structuredClone(a);
  await rejectDomainHeader(async()=>{
    const response=await deviceFetch('/api/chat/generations/scope-generation?session_id='+aId);
    check(response.ok,'Injected recovery persistence failure');
  });
  check(same(await entity(aId,owner),pendingA)&&same(await readDeviceMemoryDomain(owner,'local'),pendingDomain),'Orphan recovery rollback');
  const recovered=await deviceFetch('/api/chat/generations/scope-generation?session_id='+aId);
  check(recovered.ok&&(await recovered.json()).status==='failed','Orphan scope resolved through common generation API');
  domain=await readDeviceMemoryDomain(owner,'local');a=(await entity(aId,owner))!;
  check(domain.pending===null&&same(domain.pools,pendingDomain.pools)&&a.payload.draft==='Newer externally saved draft','Recovery preserves newer body and pools');
  const beforeDomain=structuredClone(domain),beforeA=structuredClone(a);
  const quotaDomain=structuredClone(domain),quotaA=structuredClone(a);
  quotaDomain.pools[shared].memories.find(m=>m.source_session_id===aId)!.content='MUST ROLL BACK';project(quotaDomain,quotaA);
  await rejectDomainHeader(()=>commitDeviceMemoryDomain(owner,'local',quotaDomain,[{id:aId,revision:a.revision},{id:bId,revision:b.revision}],[quotaA]));
  check(same(await entity(aId,owner),beforeA)&&same(await readDeviceMemoryDomain(owner,'local'),beforeDomain),'Entity and pool rollback together');
  const oldB=b;b=await saveEntity({...b,payload:{...b.payload,title:'Concurrent preserved edit'}},b.revision);
  let stale=false;try{await commitDeviceMemoryDomain(owner,'local',domain,[{id:aId,revision:a.revision},{id:bId,revision:oldB.revision}],[a]);}catch{stale=true;}
  check(stale&&same(await entity(aId,owner),a),'Shared-source revision fence');
  const foreign=domain.pools[shared].memories.find(m=>m.source_session_id===bId)!;
  const trace={candidates:[{...foreign,content:'SOURCE SECRET'}],injected:[foreign.id],evidenced:[foreign.id],decisions:[{memory_id:foreign.id}]};
  const generation={generation_id:'scope-foreign-proof',session_id:aId,status:'completed',reply:'Retained authored reply',memory:trace,telemetry:{memory:trace},
    raw_prompt:'SOURCE SECRET',compiled:{system_prompt:'SOURCE SECRET'},attempts:['SOURCE SECRET'],validation:{ok:false,retries:1,errors:['SOURCE SECRET']}};
  a=await saveEntity({...a,payload:{...a.payload,last_generation:generation}},a.revision);await setMeta('generation:'+owner+':scope-foreign-proof',generation);
  b.payload.memories=[];reconcileScopeMemories(domain,b);
  result=await commitDeviceMemoryDomain(owner,'local',domain,[{id:aId,revision:a.revision},{id:bId,revision:b.revision}],[b]);domain=result.domain;b=result.sessions[0];
  check(domain.pools[shared].events.some(e=>e.source_session_id===bId),'Audit source retained after row removal');
  await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
    writeEntity(tx,{...b,deleted:true,revision:b.revision+1,payload:{storage_policy:'local'}});scrubGenerationRecords(tx,owner,bId);done();
  });
  domain=await readDeviceMemoryDomain(owner,'local');a=(await entity(aId,owner))!;
  check((await entity(bId,owner))?.deleted,'Source tombstone');check(domain.erased_sessions.includes(bId),'Durable memory erasure');
  check(Object.values(domain.pools).every(pool=>pool.memories.every(m=>m.source_session_id!==bId)),'All retained copies erased');
  check(!JSON.stringify(domain).includes('Fictional fact '+bId),'Retired row audit content erased');
  for(const value of [a.payload.last_generation,await getMeta('generation:'+owner+':scope-foreign-proof')]){
    check(!JSON.stringify(value).includes('SOURCE SECRET'),'No erased source in diagnostics');check((value as any).reply==='Retained authored reply','Authored reply preserved');
  }
  const eraseA=()=>appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
    writeEntity(tx,{...a,deleted:true,revision:a.revision+1,payload:{storage_policy:'local'}});scrubGenerationRecords(tx,owner,aId);done();
  });
  await rejectDomainHeader(eraseA);check(same(await entity(aId,owner),a)&&same(await readDeviceMemoryDomain(owner,'local'),domain),'Erasure rollback');
  rememberOwner('memory-scope-other-owner');check(Object.keys((await readDeviceMemoryDomain('memory-scope-other-owner','local')).pools).length===0,'Owner isolation');
  let crossOwner=false;try{await commitDeviceMemoryDomain('memory-scope-other-owner','local',domain,[]);}catch{crossOwner=true;}
  check(crossOwner,'Cross-owner snapshot rejected');rememberOwner(owner);
  check(Object.keys((await readDeviceMemoryDomain(owner,'sync')).pools).length===0,'Storage-policy isolation');
  appendScopeEvent(domain.pools[shared],shared,'fixture_payload',null,null,{fixture_payload:'x'.repeat(1_100_000)});
  result=await commitDeviceMemoryDomain(owner,'local',domain,[{id:aId,revision:a.revision}]);domain=result.domain;
  const header=await getMeta<any>(memoryDomainKey(owner,'local'));check(header.parts.chunks>=2,'Memory domain segmented');
  const key=[owner,'memory-domain','local',header.parts.token,0];
  const original=await appTransaction<Uint8Array>(['parts'],'readonly',(tx,done)=>{const read=tx.objectStore('parts').get(key);read.onsuccess=()=>done(read.result);});
  const corrupt=new Uint8Array(original);corrupt[0]^=1;
  await appTransaction<void>(['parts'],'readwrite',(tx,done)=>{tx.objectStore('parts').put(corrupt,key);done();});
  let broken=false;try{await readDeviceMemoryDomain(owner,'local');}catch{broken=true;}check(broken,'Corrupt domain rejected');
  await appTransaction<void>(['parts'],'readwrite',(tx,done)=>{tx.objectStore('parts').put(original,key);done();});
  check(same(await readDeviceMemoryDomain(owner,'local'),domain),'Verified original chunk restored');
  return {ok:true,python_identity_cases:fixtures.cases.length,shared_copy_and_dedup:true,own_canonical_sources_only:true,
    pending_write_fence:true,orphan_generation_api_recovery:true,orphan_recovery_quota_rollback:true,atomic_metadata_quota_rollback:true,shared_source_revision_fence:true,
    atomic_source_erasure_and_diagnostic_redaction:true,retired_row_audit_erasure:true,erasure_quota_rollback:true,owner_and_policy_isolation:true,
    segmented_chunks:header.parts.chunks,checksum_rejection_and_verified_repair:true,real_inference_attempts:0};
}

export async function resume(){
  rememberOwner(owner);const domain=await readDeviceMemoryDomain(owner,'local'),a=await entity(aId,owner),b=await entity(bId,owner);
  check(domain.erased_sessions.includes(bId)&&b?.deleted&&!a?.deleted,'Durable owner/source state after reload');
  check(domain.pools[memoryBinding(domain,aId).scope].events.at(-1)?.detail.fixture_payload.length===1_100_000,'Large pool after reload');
  return {ok:true,reload_preserves_pool_and_erasure:true};
}

const adapterOwner='scope-adapter-fixture';
let adapterRoot:Root|undefined;
export async function adapterApi(path:string,method='GET',body?:unknown){
  const response=await deviceFetch(path,{method,...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,data:await response.json()};
}
export async function setupAdapter(language:'ja'|'en'){
  localStorage.setItem('kyalulu-execution-target','device');rememberOwner(adapterOwner);savePreferences({...preferences(),language});
  document.documentElement.dataset.theme=language==='ja'?'light':'dark';
  await prepareRuntime();
  for(const sid of ['adapter-a','adapter-b']){
    check((await adapterApi('/api/chat/settings','PUT',{session_id:sid,character_id:'mocha_sfw',world_id:'beast_world',system_prompt:'',temperature:.8})).status===200,'Adapter settings');
    check((await adapterApi('/api/memory/session/'+sid,'PUT',{enabled:true})).status===200,'Adapter memory enable');
  }
  const scope=(await adapterApi('/api/memory/session/adapter-a')).data.scope;
  const made=await adapterApi('/api/memory','POST',{scope,type:'semantic',content:'鮭のお寿司が好き',source_session_id:'adapter-a'});
  check(made.status===200,'Attributed shared manual memory');
  await saveEntity(newEntity('conversation','adapter-legacy',{storage_policy:'local',settings:{session_id:'adapter-legacy',character_id:'mocha_sfw',world_id:'beast_world',system_prompt:'',temperature:.8},
    messages:[],memories:[],summaries:[],state:RuntimeStateSchema.parse({session_id:'adapter-legacy'}),memory_enabled:true},adapterOwner),0);
  check((await adapterApi('/api/memory','POST',{scope:'adapter-legacy',type:'semantic',content:'猫を三匹飼っている'})).status===200,'Legacy manual memory');
  mountAdapter('adapter-legacy');return {scope,source_memory:made.data.id};
}
export function mountAdapter(sid:string){
  adapterRoot?.unmount();let node=document.getElementById('adapter-root');if(!node){node=document.createElement('div');node.id='adapter-root';document.body.append(node);}
  adapterRoot=createRoot(node);adapterRoot.render(createElement(MemoryPanel,{sessionId:sid,refreshKey:0}));
}
export async function runAdapter(){
  const legacy=(await entity('adapter-legacy',adapterOwner))!,a=(await entity('adapter-a',adapterOwner))!;
  check(legacy.payload.memory_scope_mode==='world'&&legacy.payload.memories[0].source_session_id==='adapter-legacy','UI migration committed own projection');
  const model='kyalulu-iq3m',response=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'adapter-b',generation_id:'adapter-generation',model_id:model,messages:[{role:'user',content:'鮭のお寿司が好き'}]})});
  check(response.ok&&(await response.text()).includes('event: done'),'Normal Device generation with scoped retrieval');
  const b=(await entity('adapter-b',adapterOwner))!,trace=b.payload.last_generation.memory;
  check(trace.injected.includes(a.payload.memories[0].id),'Real generator recalled peer fact');
  check(b.payload.memories.length===1&&b.payload.memories.every((row:any)=>row.source_session_id==='adapter-b')
    &&b.payload.messages.every((message:any)=>[message.before,message.after].every(snapshot=>!snapshot||snapshot.memories.every((row:any)=>row.source_session_id==='adapter-b'))),
    'Independent own fact retained without foreign canonical or snapshot rows');
  check(b.payload.last_generation.raw_prompt.includes('鮭のお寿司が好き'),'Actual frozen prompt includes selected shared evidence');
  const beforeReply=b.payload.messages.at(-1).content;
  check((await adapterApi('/api/chat/sessions/adapter-a/data','DELETE')).status===200,'Attributed source erasure');
  const after=(await entity('adapter-b',adapterOwner))!;
  check(after.payload.memories.length===1&&after.payload.memories[0].source_session_id==='adapter-b','Equal independent fact survives source A erasure');
  check(after.payload.messages.at(-1).content===beforeReply&&after.payload.last_generation.raw_prompt===undefined
    &&after.payload.last_generation.compiled===undefined&&!after.payload.last_generation.memory.candidates.some((row:any)=>row.source_session_id==='adapter-a'),
    'Foreign debug evidence scrubbed while authored input/reply retained');
  const userId=after.payload.messages.find((message:any)=>message.role==='user').id;
  check((await adapterApi('/api/chat/history/'+userId,'DELETE')).status===200,'Delete a memory source message');
  const next=await deviceFetch('/api/chat/stream',{method:'POST',body:JSON.stringify({session_id:'adapter-b',generation_id:'adapter-after-delete',model_id:model,
    messages:[{role:'user',content:'新しい架空の入力'}]})});
  check(next.ok&&(await next.text()).includes('event: done'),'Normal generation remains usable after source-message deletion');
  const preview=await adapterApi('/api/memory/session/adapter-legacy/scope-preview');
  const shared=await adapterApi('/api/memory/session/adapter-legacy/scope-migrate','POST',{expected_revision:preview.data.preview_revision,share:true});
  check(shared.status===200&&shared.data.scope.startsWith('char:'),'Explicit cross-world sharing');
  const debug=await adapterApi('/api/chat/debug?session_id=adapter-legacy');
  check(debug.data.memory_session.scope===shared.data.scope,'Common debug scope address');
  mountAdapter('adapter-legacy');
  return {ok:true,normal_generation_shared_recall:true,own_snapshots_only:true,ui_legacy_migration:true,explicit_shared_migration:true,
    independent_duplicate_source_retained:true,source_erasure_scrubs_foreign_debug:true,history_deletion_allows_next_generation:true,
    saved_reply_retained:true,model_backend:'synthetic',production_used:false};
}
export async function resumeAdapter(){
  rememberOwner(adapterOwner);const legacy=(await entity('adapter-legacy',adapterOwner))!;
  const state=await adapterApi('/api/memory/session/adapter-legacy');
  check(state.data.scope.startsWith('char:')&&legacy.payload.memories[0].content==='猫を三匹飼っている','Shared binding/source survives reload');
  check((await entity('adapter-a',adapterOwner))?.deleted,'Source erasure survives reload');return {adapter_reload:true};
}
