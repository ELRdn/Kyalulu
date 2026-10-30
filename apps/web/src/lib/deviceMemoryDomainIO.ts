import { deviceOwner } from './appContext';
import { readParts,writeParts,removeParts,storageStep } from './segmentedStorage';
import { canonical } from './appSyncData';
import { emptyMemoryDomain,memoryDomainKey,memoryIdentity,type MemoryDomain,type MemoryPolicy } from './deviceMemoryScopes';

const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:any)=>typeof value==='string'&&value.length>0;
export type OwnedMemoryDomain=MemoryDomain&{owner:string;policy:MemoryPolicy};
export function validateMemoryDomain(value:unknown):asserts value is OwnedMemoryDomain {
  const d=value as OwnedMemoryDomain;
  if(!object(d)||d.schema_version!==1||!Number.isSafeInteger(d.revision)||d.revision<0||!object(d.bindings)||!object(d.pools)
    ||!Array.isArray(d.erased_sessions)||d.erased_sessions.some(s=>!text(s))||new Set(d.erased_sessions).size!==d.erased_sessions.length
    ||!text(d.owner)||!['local','sync'].includes(d.policy)
    ||d.pending!==null&&(!object(d.pending)||!text(d.pending.session_id)||!text(d.pending.generation_id)))throw Error('Saved memory domain is invalid');
  for(const [key,pool] of Object.entries(d.pools)){
    if(!/^(session:|work:|char:)/.test(key)||!object(pool)||!Array.isArray(pool.memories)||!object(pool.holders)||!Array.isArray(pool.events)
      ||new Set(pool.memories.map(m=>m?.id)).size!==pool.memories.length)throw Error('Saved memory pool is invalid');
    for(const m of pool.memories)if(!object(m)||!text(m.id)||typeof m.content!=='string'||!['semantic','episodic','relationship'].includes(m.type)
      ||typeof m.origin!=='string'||!['active','deleted'].includes(m.status)||m.scope!==key
      ||m.uuid!==undefined&&!text(m.uuid)||m.version!==undefined&&(!Number.isSafeInteger(m.version)||m.version<1)
      ||m.source_quote!=null&&typeof m.source_quote!=='string'||m.source_revision!=null&&typeof m.source_revision!=='string'
      ||m.source_generation_id!=null&&!text(m.source_generation_id)||m.source_turn!=null&&(!Number.isSafeInteger(m.source_turn)||m.source_turn<0)
      ||m.supported!==null&&typeof m.supported!=='boolean'
      ||m.source_session_id!=null&&(!text(m.source_session_id)||d.erased_sessions.includes(m.source_session_id))
      ||m.source_message_ids!==undefined&&(!Array.isArray(m.source_message_ids)||m.source_message_ids.some((id:unknown)=>!Number.isSafeInteger(id)||(id as number)<1)))throw Error('Saved memory row is invalid');
    const ids=new Set(pool.memories.map(m=>JSON.stringify(m.id)));
    if(Object.keys(pool.holders).length!==ids.size)throw Error('Saved memory owner is invalid');
    for(const [id,holder] of Object.entries(pool.holders))if(!ids.has(id)||holder!==null&&(!text(holder)||d.erased_sessions.includes(holder)))throw Error('Saved memory owner is invalid');
    for(const memory of pool.memories){const holder=pool.holders[JSON.stringify(memory.id)];
      if(holder!=null&&memory.source_session_id!=null&&holder!==memory.source_session_id)throw Error('Saved memory owner is invalid');}
    for(const [index,e] of pool.events.entries())if(!object(e)||e.id!==index+1||e.scope!==key||typeof e.op!=='string'
      ||e.memory_id!==null&&!text(e.memory_id)||e.generation_id!==null&&!text(e.generation_id)||typeof e.created_at!=='string'
      ||e.source_session_id!=null&&(!text(e.source_session_id)||d.erased_sessions.includes(e.source_session_id)))throw Error('Saved memory event is invalid');
  }
  for(const [sid,binding] of Object.entries(d.bindings)){
    let id:unknown;try{id=JSON.parse(sid);}catch{throw Error('Saved memory binding is invalid');}
    if(!text(id)||JSON.stringify(id)!==sid||d.erased_sessions.includes(id as string)||!object(binding)||!Object.hasOwn(d.pools,binding.scope)
      ||!['legacy','world','shared','branch'].includes(binding.mode)||! /^[a-f0-9]{64}$/.test(binding.signature)||!object(binding.identity)
      ||!object(binding.identity.versions))throw Error('Saved memory binding is invalid');
    if(binding.entity_revision!==undefined&&(!Number.isSafeInteger(binding.entity_revision)||binding.entity_revision<0))throw Error('Saved memory binding revision is invalid');
    const identity=binding.identity;
    for(const key of ['character_id','persona_id','world_id'] as const)if(identity[key]!==null&&!text(identity[key])
      ||identity.versions[key]!==null&&typeof identity.versions[key]!=='string')throw Error('Saved memory identity is invalid');
    if(canonical(identity)!==canonical(memoryIdentity(identity,identity.versions)))throw Error('Saved memory identity is invalid');
  }
  if(d.pending&&!Object.hasOwn(d.bindings,JSON.stringify(d.pending.session_id)))throw Error('Saved pending memory scope is invalid');
}

export function readMemoryDomainTx(tx:IDBTransaction,owner:string,policy:MemoryPolicy,done:(domain:OwnedMemoryDomain)=>void) {
  const read=tx.objectStore('meta').get(memoryDomainKey(owner,policy));
  read.onsuccess=()=>storageStep(tx,()=>{
    if(owner!==deviceOwner())throw Error('Account changed');
    if(read.result===undefined){done({...emptyMemoryDomain(),owner,policy});return;}
    const header=read.result;
    if(header.schema_version!==1||!Number.isSafeInteger(header.revision)||header.revision<1||!header.parts)throw Error('Saved memory domain header is invalid');
    readParts(tx,[owner,'memory-domain',policy],header.parts,domain=>{
      validateMemoryDomain(domain);if(domain.revision!==header.revision||domain.owner!==owner||domain.policy!==policy||canonical(domain.pending)!==canonical(header.pending))throw Error('Saved memory domain revision or owner is invalid');done(domain);
    });
  });
}

export function writeMemoryDomainTx(tx:IDBTransaction,domain:OwnedMemoryDomain,done:(updated:OwnedMemoryDomain)=>void) {
  validateMemoryDomain(domain);
  const {owner,policy}=domain,meta=tx.objectStore('meta'),key=memoryDomainKey(owner,policy),read=meta.get(key);
  read.onsuccess=()=>storageStep(tx,()=>{
    if(owner!==deviceOwner())throw Error('Account changed');
    const old=read.result;if((old?.revision??0)!==domain.revision)throw Error('Memory changed; reload before saving');
    const updated={...domain,revision:domain.revision+1};
    const write=()=>writeParts(tx,[owner,'memory-domain',policy],updated,parts=>{
      const put=meta.put({schema_version:1,revision:updated.revision,pending:updated.pending,parts},key);
      put.onsuccess=()=>removeParts(tx,[owner,'memory-domain',policy],old?.parts,()=>done(updated));
    });
    if(old?.parts)readParts(tx,[owner,'memory-domain',policy],old.parts,write,false);else write();
  });
}
