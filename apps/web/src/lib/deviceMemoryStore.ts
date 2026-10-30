import { appTransaction,readEntity,writeEntity,recoverPendingConversation,guardStorage,scrubGenerationRecords,type AppEntity,type StoredEntity } from './appStore';
import { storageStep } from './segmentedStorage';
import { deviceOwner } from './appContext';
import { readMemoryDomainTx as readDomain,writeMemoryDomainTx,validateMemoryDomain,type OwnedMemoryDomain } from './deviceMemoryDomainIO';
import { memoryPolicy,memoryBinding,memorySignature,ownScopeMemories,memoryDomainKey,type MemoryPolicy } from './deviceMemoryScopes';
import { deviceExecutionLockName } from './deviceExecution';
export { validateMemoryDomain,type OwnedMemoryDomain } from './deviceMemoryDomainIO';
const text=(value:any)=>typeof value==='string'&&value.length>0;

export const readDeviceMemoryDomain=(owner:string,policy:MemoryPolicy)=>appTransaction<OwnedMemoryDomain>(['meta','parts'],'readonly',(tx,done)=>{
  guardStorage(tx,()=>owner===deviceOwner());readDomain(tx,owner,policy,done);
});

/** Caller holds the owner execution lease; recovery never rewinds canonical user edits. */
export const recoverDeviceMemoryGeneration=(owner:string,generationId:string,sessionId:string)=>
  appTransaction<Record<string,any>|null>(['entities','meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const meta=tx.objectStore('meta'),headers=(['local','sync'] as const).map(policy=>({policy,read:meta.get(memoryDomainKey(owner,policy))}));
    headers[1].read.onsuccess=()=>{
      const matching=headers.filter(({read})=>read.result?.pending?.generation_id===generationId);
      if(!matching.length){done(null);return;}
      if(matching.length!==1||matching[0].read.result.pending.session_id!==sessionId){tx.abort();return;}
      const key='generation:'+owner+':'+generationId,receipt=meta.get(key);
      receipt.onsuccess=()=>{
        const previous=receipt.result;
        if(previous?.status!=='pending'||previous.session_id!==sessionId||previous.generation_id!==generationId
          ||previous.execution_lock!==deviceExecutionLockName(owner)){tx.abort();return;}
        readDomain(tx,owner,matching[0].policy,domain=>{
          const read=tx.objectStore('entities').get([owner,sessionId]);read.onsuccess=()=>storageStep(tx,()=>{
          const session=read.result as StoredEntity|undefined;
          if(session&&(session.owner!==owner||session.id!==sessionId||session.kind!=='conversation')){tx.abort();return;}
          domain.pending=null;
          const removed=!session||session.deleted,recovered=removed?{generation_id:generationId,session_id:sessionId,status:'deleted'}:{...previous,status:'failed'};
          const persist=()=>writeMemoryDomainTx(tx,domain,()=>{
            meta.put(recovered,key);
            if(removed)scrubGenerationRecords(tx,owner,sessionId);
            done(recovered);
          });
          if(session&&!session.deleted)recoverPendingConversation(tx,session,generationId,persist,true);else persist();
          });
        });
      };
    };
  });

function assertOwnMemorySources(record:AppEntity) {
  const check=(snapshot:any,available:Set<number>)=>{
    for(const memory of snapshot?.memories??[])if(memory.source_session_id!=null&&memory.source_session_id!==record.id
      ||(memory.source_message_ids??[]).some((id:number)=>!available.has(id)))throw Error('Foreign memory source cannot enter a conversation projection');
  };
  const messages=record.payload.messages??[],available=new Set<number>();
  for(const message of messages){
    if(!Number.isSafeInteger(message.id)||message.id<1||available.has(message.id))throw Error('Invalid memory message source');
    if(message.before)check(message.before,available);available.add(message.id);
    if(message.after)check(message.after,available);
  }
  check(record.payload,available);
}

/** Domain, own canonical projections and generation receipts share the same IDB commit. */
export async function commitDeviceMemoryDomain(owner:string,policy:MemoryPolicy,domain:OwnedMemoryDomain,
  expected:{id:string;revision:number}[],updates:AppEntity[]=[],generations:Record<string,Record<string,any>>={}) {
  validateMemoryDomain(domain);
  if(owner!==deviceOwner()||domain.owner!==owner||domain.policy!==policy||new Set(expected.map(e=>e.id)).size!==expected.length||new Set(updates.map(e=>e.id)).size!==updates.length
    ||expected.some(e=>!text(e.id)||!Number.isSafeInteger(e.revision)||e.revision<0)
    ||updates.some(e=>e.owner!==owner||e.kind!=='conversation'||memoryPolicy(e)!==policy||!expected.some(x=>x.id===e.id&&x.revision===e.revision)
      ||!e.deleted&&domain.erased_sessions.includes(e.id)))throw Error('Invalid memory commit scope');
  for(const update of updates)assertOwnMemorySources(update);
  for(const update of updates)if(!update.deleted){
    const binding=memoryBinding(domain,update.id);
    if(!binding||binding.signature!==memorySignature(update.payload.memories??[])
      ||binding.signature!==memorySignature(ownScopeMemories(domain.pools[binding.scope],update.id)))throw Error('Canonical memory projection changed');
  }
  if(Object.keys(generations).length>1)throw Error('Invalid memory generation receipt');
  for(const [id,value] of Object.entries(generations))if(!text(id)||id.length>200||value.generation_id!==id||!updates.some(e=>e.id===value.session_id)
    ||!['pending','completed','failed','deleted'].includes(value.status))throw Error('Invalid memory generation receipt');
  return appTransaction<{domain:OwnedMemoryDomain;sessions:AppEntity[]}>(['entities','meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    readDomain(tx,owner,policy,current=>{
      if(current.revision!==domain.revision){tx.abort();return;}
      const pending=current.pending;
      if(pending&&(domain.pending!==null||!updates.some(e=>e.id===pending.session_id&&e.payload.pending_generation==null)
        ||!['completed','failed'].includes(generations[pending.generation_id]?.status))){tx.abort();return;}
      if(domain.pending&&(!updates.some(e=>e.id===domain.pending!.session_id&&e.payload.pending_generation===domain.pending!.generation_id)
        ||generations[domain.pending.generation_id]?.status!=='pending')){tx.abort();return;}
      let index=0;const saved:AppEntity[]=[];
      const verify=()=>{
        const next=expected[index++];if(!next){index=0;verifyReceipt();return;}
        readEntity(tx,owner,next.id,record=>{
          if((record?.revision??0)!==next.revision||record&&(record.kind!=='conversation'||memoryPolicy(record)!==policy)
            ||!record&&!updates.some(e=>e.id===next.id)||record?.deleted&&!updates.some(e=>e.id===next.id&&e.deleted)){tx.abort();return;}
          verify();
        });
      };
      const receipts=Object.entries(generations);
      const verifyReceipt=()=>{
        const next=receipts[index++];if(!next){index=0;write();return;}
        const [id,value]=next,read=tx.objectStore('meta').get('generation:'+owner+':'+id);
        read.onsuccess=()=>{
          const previous=read.result;
          if(value.status==='pending'?previous!==undefined:value.status!=='deleted'&&(!previous||previous.status!=='pending'||previous.session_id!==value.session_id||previous.generation_id!==id)){
            tx.abort();return;
          }
          verifyReceipt();
        };
      };
      const write=()=>{
        const value=updates[index++];if(!value){persist();return;}
        const record={...value,revision:value.revision+1,dirty:policy==='sync',opened:Date.now()};
        writeEntity(tx,record,'put',()=>{saved.push(record);write();},true);
      };
      const persist=()=>{
        const next=structuredClone(domain);for(const record of saved){const binding=memoryBinding(next,record.id);if(binding)binding.entity_revision=record.revision;}
        writeMemoryDomainTx(tx,next,updated=>{
        const meta=tx.objectStore('meta');
        for(const [id,value] of Object.entries(generations))meta.put(value,'generation:'+owner+':'+id);
        done({domain:updated,sessions:saved});
        });
      };
      verify();
    });
  });
}
