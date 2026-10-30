import { LibraryBindingSchema } from '../../../../packages/schemas/src';
import { canonical } from './appSyncData';
import { Sha256 } from '../mobile/sha256';
import type { AppEntity } from './appStore';
import type { DeviceMemory } from './deviceCore';

export type MemoryPolicy='local'|'sync';
export type MemoryIdentity={character_id:string|null;persona_id:string|null;world_id:string|null;
  library_binding:Omit<ReturnType<typeof LibraryBindingSchema.parse>,'expression_asset_id'>;
  versions:{character_id:string|null;persona_id:string|null;world_id:string|null}};
export type ScopeEvent={id:number;scope:string;op:string;memory_id:string|null;generation_id:string|null;source_session_id?:string|null;detail:any;created_at:string};
export type MemoryPool={memories:DeviceMemory[];holders:Record<string,string|null>;events:ScopeEvent[]};
export type MemoryBinding={scope:string;mode:'legacy'|'world'|'shared'|'branch';identity:MemoryIdentity;signature:string;entity_revision?:number};
export type MemoryDomain={schema_version:1;revision:number;bindings:Record<string,MemoryBinding>;pools:Record<string,MemoryPool>;
  erased_sessions:string[];pending:{session_id:string;generation_id:string}|null;owner?:string;policy?:MemoryPolicy};
const fail=(message:string)=>Object.assign(Error(message),{status:409});
const digest=(value:string)=>new Sha256().update(new TextEncoder().encode(value)).digest();
export const memoryDomainKey=(owner:string,policy:MemoryPolicy)=>'device-memory-domain:'+JSON.stringify([owner,policy]);
export const memoryPolicy=(session:AppEntity):MemoryPolicy=>session.payload.storage_policy==='sync'?'sync':'local';
export const emptyMemoryDomain=():MemoryDomain=>({schema_version:1,revision:0,bindings:{},pools:{},erased_sessions:[],pending:null});
const emptyPool=():MemoryPool=>({memories:[],holders:{},events:[]});
const ownKey=(memory:DeviceMemory)=>memory.uuid??memory.id;
const mapKey=(id:string)=>JSON.stringify(id);
export const memoryBinding=(domain:MemoryDomain,sid:string)=>domain.bindings[mapKey(sid)];
export const memorySignature=(memories:DeviceMemory[])=>digest(canonical(memories.map(({scope:_,...memory})=>memory)));

export function memoryIdentity(settings:Record<string,any>,versions:MemoryIdentity['versions']):MemoryIdentity {
  const {expression_asset_id:_,...library_binding}=LibraryBindingSchema.parse(settings.library_binding??{});
  return {character_id:settings.character_id??null,persona_id:settings.persona_id??null,world_id:settings.world_id??null,library_binding,versions};
}
// Python scope IDs use sorted keys and the default separator spaces, with Unicode intact.
function pythonIdentityJson(value:any):string {
  if(Array.isArray(value))return '['+value.map(pythonIdentityJson).join(', ')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+': '+pythonIdentityJson(value[key])).join(', ')+'}';
  return JSON.stringify(value);
}
export const worldMemoryScope=(identity:MemoryIdentity,sid:string)=>identity.character_id?'work:'+digest(pythonIdentityJson(identity)):'session:'+sid;
export const sharedMemoryScope=(identity:MemoryIdentity,sid:string)=>identity.character_id?`char:${identity.character_id}|persona:${identity.persona_id??'default'}`:'session:'+sid;

export function assertMemoryVersions(binding:MemoryBinding,identity:MemoryIdentity) {
  for(const key of ['character_id','persona_id','world_id'] as const){
    if(binding.identity[key]===identity[key]&&binding.identity.versions[key]!==identity.versions[key]
      &&(key!=='character_id'||canonical(binding.identity.library_binding.character)===canonical(identity.library_binding.character)))
      throw fail('Asset version changed; preview and explicitly migrate memory scope before continuing');
  }
}
const rowOwnedBy=(pool:MemoryPool,memory:DeviceMemory,sid:string)=>memory.source_session_id===sid||memory.source_session_id==null&&pool.holders[mapKey(memory.id)]===sid;
export function ownScopeMemories(pool:MemoryPool,sid:string) {
  return pool.memories.filter(m=>rowOwnedBy(pool,m,sid)).map(m=>({...structuredClone(m),scope:sid}));
}
export function appendScopeEvent(pool:MemoryPool,scope:string,op:string,memoryId:string|null,generationId:string|null,detail:any=null,now=new Date().toISOString()) {
  const memory=pool.memories.find(m=>m.id===memoryId);
  const source=memory?.source_session_id??(memoryId===null?null:pool.holders[mapKey(memoryId)])??null;
  pool.events.push({id:pool.events.length+1,scope,op,memory_id:memoryId,generation_id:generationId,source_session_id:source,detail,created_at:now});
}

/** Reconcile only this conversation's projection; foreign source IDs never enter its wire body. */
export function reconcileScopeMemories(domain:MemoryDomain,session:AppEntity) {
  const binding=memoryBinding(domain,session.id);if(!binding)return false;
  const signature=memorySignature(session.payload.memories??[]);if(binding.signature===signature){binding.entity_revision=session.revision;return false;}
  const pool=domain.pools[binding.scope];if(!pool)throw fail('Saved memory scope is missing');
  const incoming=new Map<string,DeviceMemory>((session.payload.memories??[]).map((m:DeviceMemory)=>[ownKey(m),m]));
  if(incoming.size!==(session.payload.memories??[]).length||new Set((session.payload.memories??[]).map((m:DeviceMemory)=>m.id)).size!==incoming.size)throw fail('Memory identity is ambiguous');
  const removed=new Set(pool.memories.filter(m=>rowOwnedBy(pool,m,session.id)).map(m=>m.id));
  for(const memory of incoming.values()){
    if(memory.source_session_id!=null&&memory.source_session_id!==session.id)throw fail('Foreign memory source cannot enter a conversation projection');
    if(pool.memories.some(m=>!removed.has(m.id)&&m.id===memory.id))throw fail('Memory identity is ambiguous');
  }
  // Audit ownership must survive removal/replacement of the current memory row.
  for(const event of pool.events)if(event.memory_id!==null&&removed.has(event.memory_id)&&event.source_session_id==null)event.source_session_id=session.id;
  pool.memories=pool.memories.filter(m=>!removed.has(m.id));
  for(const id of removed)delete pool.holders[mapKey(id)];
  for(const memory of incoming.values()){
    pool.memories.push({...structuredClone(memory),scope:binding.scope});pool.holders[mapKey(memory.id)]=session.id;
  }
  binding.signature=signature;binding.entity_revision=session.revision;return true;
}

export function bindMemoryScope(domain:MemoryDomain,session:AppEntity,identity:MemoryIdentity) {
  if(domain.erased_sessions.includes(session.id)||session.deleted)throw fail('Conversation deleted');
  let binding=memoryBinding(domain,session.id);
  if(binding){
    assertMemoryVersions(binding,identity);
    if(canonical(binding.identity)===canonical(identity)){reconcileScopeMemories(domain,session);return binding;}
    if(binding.mode!=='world'){
      reconcileScopeMemories(domain,session);binding.identity=structuredClone(identity);return binding;
    }
    if(binding.signature!==memorySignature(session.payload.memories??[]))throw fail('Conversation memory and setting identity changed; preview scope migration');
    const scope=worldMemoryScope(identity,session.id);
    domain.pools[scope]??=emptyPool();
    binding={scope,mode:'world',identity:structuredClone(identity),signature:memorySignature(ownScopeMemories(domain.pools[scope],session.id))};
    domain.bindings[mapKey(session.id)]=binding;return binding;
  }
  const branch=!!(session.payload.branch_of||session.payload.recovery_from);
  const mode=branch?'branch':session.payload.memory_scope_mode==='world'?'world':'legacy';
  const scope=mode==='world'?worldMemoryScope(identity,session.id):'session:'+session.id;
  const pool=domain.pools[scope]??=emptyPool();
  binding={scope,mode,identity:structuredClone(identity),signature:''};domain.bindings[mapKey(session.id)]=binding;
  reconcileScopeMemories(domain,session);
  return binding;
}

export function previewMemoryMigration(domain:MemoryDomain,session:AppEntity,identity:MemoryIdentity) {
  const copy=structuredClone(domain);
  if(!memoryBinding(copy,session.id))bindMemoryScope(copy,session,identity);
  // Preview deliberately bypasses the asset-version fence and never changes the live binding.
  reconcileScopeMemories(copy,session);
  const binding=memoryBinding(copy,session.id),pool=copy.pools[binding.scope];
  const memories=pool.memories.filter(m=>m.status==='active');
  return {scope:binding.scope,target_scope:worldMemoryScope(identity,session.id),identity,previous_identity:binding.identity,memories,
    preview_revision:digest(canonical([domain.owner??null,domain.policy??null,domain.revision,session.revision,binding.scope,memories,identity]))};
}
export function migrateMemoryDomain(domain:MemoryDomain,session:AppEntity,identity:MemoryIdentity,expectedRevision:string,share=false,
  makeId:()=>string=()=>crypto.randomUUID(),now=new Date().toISOString()) {
  if(domain.pending||session.payload.pending_generation)throw fail('Stop generation before migrating memory');
  const preview=previewMemoryMigration(domain,session,identity);
  if(preview.preview_revision!==expectedRevision)throw fail('Memory changed; preview migration again');
  const binding=memoryBinding(domain,session.id)??bindMemoryScope(domain,session,identity);
  reconcileScopeMemories(domain,session);
  const original=domain.pools[binding.scope],scope=share?sharedMemoryScope(identity,session.id):worldMemoryScope(identity,session.id);
  const target=domain.pools[scope]??=emptyPool();
  const key=(m:DeviceMemory,source=m.source_session_id??null)=>canonical([m.content,m.type,m.source_kind??null,m.source_generation_id??null,source]);
  const existing=new Set(target.memories.filter(m=>m.status==='active').map(m=>key(m)));let copied=0;
  if(scope!==binding.scope)for(const memory of original.memories.filter(m=>m.status==='active')){
    const source=memory.source_session_id??(binding.scope==='session:'+session.id?session.id:null),dedup=key(memory,source);
    if(existing.has(dedup))continue;
    const id=makeId();if(Object.values(domain.pools).some(pool=>pool.memories.some(m=>m.id===id)))throw fail('Memory identity is ambiguous');
    const next:DeviceMemory={...structuredClone(memory),id,uuid:id,scope,source_session_id:source,version:1,access_count:0,last_accessed:null,created_at:now,updated_at:now};
    target.memories.push(next);target.holders[mapKey(id)]=original.holders[mapKey(memory.id)]??null;
    appendScopeEvent(target,scope,'create',id,next.source_generation_id??null,{type:next.type,content:next.content,origin:next.origin},now);
    existing.add(dedup);copied++;
  }
  domain.bindings[mapKey(session.id)]={scope,mode:share?'shared':'world',identity:structuredClone(identity),signature:memorySignature(ownScopeMemories(target,session.id))};
  return {scope,copied};
}

export function eraseMemoryDomain(domain:MemoryDomain,sid:string) {
  if(domain.pending)throw fail('Stop all generations before deleting conversation data');
  let changed=!domain.erased_sessions.includes(sid);if(changed)domain.erased_sessions.push(sid);
  const removed=new Set<string>();
  for(const [scope,pool] of Object.entries(domain.pools)){
    const ids=new Set(pool.memories.filter(m=>scope==='session:'+sid||rowOwnedBy(pool,m,sid)).map(m=>m.id));
    for(const event of pool.events)if((scope==='session:'+sid||event.source_session_id===sid)&&event.memory_id!==null)ids.add(event.memory_id);
    for(const id of ids){removed.add(id);delete pool.holders[mapKey(id)];}
    if(ids.size){changed=true;pool.memories=pool.memories.filter(m=>!ids.has(m.id));}
    pool.events=pool.events.filter(e=>scope!=='session:'+sid&&e.source_session_id!==sid&&!ids.has(e.memory_id??'')).map((e,index)=>({...e,id:index+1,
      detail:Array.isArray(e.detail?.candidates)?{...e.detail,candidates:e.detail.candidates.filter((c:any)=>!ids.has(c.id))}:e.detail}));
  }
  changed||=!!memoryBinding(domain,sid);delete domain.bindings[mapKey(sid)];
  return {changed,removed};
}

export function eraseDeviceMemoryReferences(result:any,source:string,removed:Set<string>) {
  if(!result||typeof result!=='object')return result;
  const traces=[result.memory,result.telemetry?.memory].filter(trace=>trace&&typeof trace==='object');
  const ids=new Set(removed);let referenced=false;
  for(const trace of traces){
    for(const candidate of trace.candidates??[])if(candidate.source_session_id===source){referenced=true;if(candidate.id!=null)ids.add(candidate.id);}
    if([...(trace.candidates??[]).map((c:any)=>c.id),...(trace.decisions??[]).map((d:any)=>d.memory_id),...(trace.injected??[]),...(trace.evidenced??[])].some(id=>ids.has(id)))referenced=true;
  }
  if(!referenced)return result;
  const next=structuredClone(result);
  for(const trace of [next.memory,next.telemetry?.memory].filter(trace=>trace&&typeof trace==='object')){
    trace.candidates=(trace.candidates??[]).filter((c:any)=>c.source_session_id!==source&&!ids.has(c.id));
    trace.decisions=(trace.decisions??[]).filter((d:any)=>!ids.has(d.memory_id));
    for(const key of ['injected','evidenced'])trace[key]=(trace[key]??[]).filter((id:string)=>!ids.has(id));
  }
  for(const key of ['raw_prompt','compiled','attempts'])delete next[key];
  if(next.validation&&typeof next.validation==='object')next.validation.errors=[];
  return next;
}
