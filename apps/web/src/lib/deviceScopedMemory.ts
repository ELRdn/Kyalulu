import { entity,appTransaction,memoryEventsKey,type AppEntity } from './appStore';
import { deviceOwner } from './appContext';
import { canonical } from './appSyncData';
import { readDeviceMemoryDomain,commitDeviceMemoryDomain,type OwnedMemoryDomain } from './deviceMemoryStore';
import { bindMemoryScope,memoryBinding,memoryPolicy,memorySignature,ownScopeMemories,type MemoryIdentity,type MemoryPolicy } from './deviceMemoryScopes';

export type MemoryIdentityResolver=(settings:Record<string,any>)=>Promise<MemoryIdentity>;
export type ScopedMemory={owner:string;policy:MemoryPolicy;domain:OwnedMemoryDomain;scope:string;records:Map<string,AppEntity>};
const fail=(message:string)=>Object.assign(Error(message),{status:409});
export const deviceMemoryScope=(policy:MemoryPolicy,scope:string)=>scope+'|device:'+policy;
export function parseDeviceMemoryScope(scope:string){
  const match=scope.match(/^((?:work:|char:|session:).+)\|device:(local|sync)$/);
  return match?{scope:match[1],policy:match[2] as MemoryPolicy}:null;
}

async function bindInitialMemory(domain:OwnedMemoryDomain,session:AppEntity,resolve:MemoryIdentityResolver){
  const existed=memoryBinding(domain,session.id),binding=bindMemoryScope(domain,session,await resolve(session.payload.settings));
  if(!existed){
    const events=await appTransaction<any[]|undefined>(['meta'],'readonly',(tx,done)=>{
      const read=tx.objectStore('meta').get(memoryEventsKey(session.owner,session.id));read.onsuccess=()=>done(read.result);
    });
    if(events!==undefined&&(!Array.isArray(events)||events.some((event,index)=>!event||event.id!==index+1||event.scope!==session.id)))
      throw fail('Saved memory history is invalid');
    const pool=domain.pools[binding.scope];
    for(const event of events??[])pool.events.push({...event,id:pool.events.length+1,scope:binding.scope,source_session_id:session.id});
  }
  return binding;
}

async function sources(context:ScopedMemory,resolve:MemoryIdentityResolver,allowPending:boolean){
  const {domain,scope,owner,policy,records}=context,pool=domain.pools[scope];
  if(!pool)throw fail('Saved memory scope is missing');
  if(domain.pending&&!allowPending)throw fail('Reconcile the pending generation before editing memory');
  const ids=new Set([...Object.entries(domain.bindings).filter(([,b])=>b.scope===scope).map(([key])=>JSON.parse(key) as string),
    ...pool.memories.map(m=>m.source_session_id??pool.holders[JSON.stringify(m.id)]).filter((id):id is string=>id!=null)]);
  for(const id of ids){
    if(records.has(id))continue;
    const record=await entity(id,owner);
    if(!record||record.deleted||record.kind!=='conversation'||memoryPolicy(record)!==policy)continue;
    if(record.payload.cache_evicted)throw fail('Open the source conversation to load its shared memories');
    records.set(id,record);
    const binding=memoryBinding(domain,id);
    if(!domain.pending&&binding?.scope===scope&&binding.signature!==memorySignature(record.payload.memories??[]))
      bindMemoryScope(domain,record,await resolve(record.payload.settings));
  }
  if(owner!==deviceOwner())throw fail('Account changed');
  return context;
}

export async function scopedSessionMemory(session:AppEntity,resolve:MemoryIdentityResolver,allowPending=false):Promise<ScopedMemory>{
  const owner=session.owner,policy=memoryPolicy(session),domain=await readDeviceMemoryDomain(owner,policy);
  if(domain.pending&&!allowPending)throw fail('Reconcile the pending generation before editing memory');
  const binding=domain.pending?memoryBinding(domain,session.id):await bindInitialMemory(domain,session,resolve);
  if(!binding)throw fail('Saved memory scope is missing');
  return sources({owner,policy,domain,scope:binding.scope,records:new Map([[session.id,session]])},resolve,allowPending);
}

export async function scopedMigrationMemory(session:AppEntity,resolve:MemoryIdentityResolver){
  const owner=session.owner,policy=memoryPolicy(session),domain=await readDeviceMemoryDomain(owner,policy),identity=await resolve(session.payload.settings);
  if(domain.pending||session.payload.pending_generation)throw fail('Stop generation before migrating memory');
  const binding=memoryBinding(domain,session.id)??await bindInitialMemory(domain,session,async()=>identity);
  const context=await sources({owner,policy,domain,scope:binding.scope,records:new Map([[session.id,session]])},resolve,false);
  return {context,identity};
}

export async function scopedMemoryAddress(owner:string,address:string,resolve:MemoryIdentityResolver,allowPending=false){
  const parsed=parseDeviceMemoryScope(address);if(!parsed)throw fail('Choose a device memory scope');
  const domain=await readDeviceMemoryDomain(owner,parsed.policy);
  return sources({owner,policy:parsed.policy,scope:parsed.scope,domain,records:new Map()},resolve,allowPending);
}

export function scopedMemoryRows(context:ScopedMemory){
  const {domain,scope,records}=context,pool=domain.pools[scope];
  return pool.memories.filter(memory=>{
    const source=memory.source_session_id??pool.holders[JSON.stringify(memory.id)];
    return source==null||records.has(source);
  });
}

/** Only own projections enter wire bodies, including when foreign rows were retrieved. */
export async function saveScopedMemory(context:ScopedMemory,updates:AppEntity[]=[],generations:Record<string,Record<string,any>>={}){
  const records=new Map(context.records),requested=new Set(updates.map(record=>record.id));
  for(const record of updates){if(!records.has(record.id))throw fail('Memory source changed');records.set(record.id,record);}
  const projections:AppEntity[]=[];
  for(const record of records.values()){
    const binding=memoryBinding(context.domain,record.id);if(!binding)continue;
    const memories=ownScopeMemories(context.domain.pools[binding.scope],record.id),signature=memorySignature(memories);
    binding.signature=signature;
    if(requested.has(record.id)||canonical(record.payload.memories??[])!==canonical(memories))
      projections.push({...record,payload:{...record.payload,memories}});
  }
  const result=await commitDeviceMemoryDomain(context.owner,context.policy,context.domain,
    [...context.records.values()].map(({id,revision})=>({id,revision})),projections,generations);
  context.domain=result.domain;
  for(const record of result.sessions)context.records.set(record.id,record);
  return result;
}
