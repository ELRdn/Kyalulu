import { appTransaction,writeEntity,writeConversationMemories,writeConversationGeneration,newEntity,memoryEventsKey,recoverPendingConversation,guardStorage,scrubGenerationRecords,type AppEntity,type StoredEntity } from './appStore';
import { readParts,storageStep } from './segmentedStorage';
import { JsonStream } from './jsonStream';
import { deviceOwner } from './appContext';
import { readMemoryDomainTx as readDomain,writeMemoryDomainTx,validateMemoryDomain,type OwnedMemoryDomain } from './deviceMemoryDomainIO';
import { memoryPolicy,memoryBinding,memorySignature,ownScopeMemories,memoryDomainKey,type MemoryPolicy,type MemoryConversation } from './deviceMemoryScopes';
import type { DeviceMemory } from './deviceCore';
import { deviceExecutionLockName } from './deviceExecution';
import { changedHistoryMetadata,detachHistoryMemories,validateHistoryChange,type HistoryChange } from './deviceHistoryChange';
import { generationChangeView,validateGenerationReceipt,type GenerationChange } from './deviceGenerationChange';
export { validateMemoryDomain,type OwnedMemoryDomain } from './deviceMemoryDomainIO';
const text=(value:any)=>typeof value==='string'&&value.length>0;
export type MemorySource={id:string;owner:string;revision:number;deleted:boolean;bodyToken?:string|null;metadata:Record<string,any>};
export type MemoryProjectionUpdate={source:MemorySource;memories:DeviceMemory[];history?:HistoryChange;generation?:GenerationChange};
export function memorySourceProjection(record:AppEntity):MemorySource {
  const {messages:_,...metadata}=record.payload;
  return {id:record.id,owner:record.owner,revision:record.revision,deleted:record.deleted,metadata};
}
export const memoryScopeInput=(source:MemorySource):MemoryConversation=>({id:source.id,revision:source.revision,deleted:source.deleted,payload:source.metadata});
function readMemorySourceTx(tx:IDBTransaction,header:StoredEntity,id:string,owner:string,done:(source:MemorySource)=>void,onMessage?:(message:any)=>void) {
  if(header.owner!==owner||header.id!==id||!text(id)||!Number.isSafeInteger(header.revision)||header.revision<0)throw Error('Invalid memory source');
  const finish=(payload:any)=>{
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.messages))throw Error('Invalid memory source');
    const {messages:_,...metadata}=payload;
    done({id,owner,revision:header.revision,deleted:false,bodyToken:header.payloadParts?.token??null,metadata});
  };
  if(header.payloadParts)readParts(tx,[owner,'entity',id],header.payloadParts,finish,new JsonStream(onMessage?{onMessage}:{limit:0}));
  else {if(onMessage)for(const message of header.payload?.messages??[])onMessage(message);finish(header.payload);}
}
/** Verify the entire source without retaining its message bodies; never return a partial AppEntity. */
export async function readMemorySource(id:string,owner:string,onMessage?:(message:any)=>void):Promise<MemorySource|undefined> {
  const value=await appTransaction<MemorySource|undefined>(['entities','parts'],'readonly',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result as StoredEntity|undefined;
      if(!header||header.deleted||header.kind!=='conversation'){done(undefined);return;}
      readMemorySourceTx(tx,header,id,owner,done,onMessage);
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');return value;
}

/** Verified actor inputs are transient; commits always reread and preserve the complete stored history. */
export async function readDeviceGenerationSource(id:string,owner:string) {
  const result=await appTransaction<{source:MemorySource;header:Omit<AppEntity,'payload'>;messages:any[];latest:any}|undefined>(['entities','parts'],'readonly',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result as StoredEntity|undefined;if(!header){done(undefined);return;}
      if(header.deleted)throw Object.assign(Error('Conversation deleted'),{status:404});
      if(header.kind!=='conversation')throw Error('Conversation unavailable');
      const messages:any[]=[];let latest:any;
      readMemorySourceTx(tx,header,id,owner,source=>{
        const {payloadParts:_,selection:__,memoryReferences:___,payload:____,...raw}=header;
        done({source,header:raw,messages,latest});
      },message=>{
        latest=message;
        messages.push(message&&typeof message==='object'&&!Array.isArray(message)
          ?{id:message.id,uuid:message.uuid,role:message.role,content:message.content,imported_state:message.imported_state}:message);
      });
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');return result;
}

/** Visit synchronously in one snapshot; callers retain only their catalog fields. */
export async function visitMemorySources(owner:string,visit:(source:MemorySource)=>void,onMessage?:(message:any)=>void) {
  await appTransaction<void>(['entities','parts'],'readonly',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const read=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
    read.onsuccess=()=>storageStep(tx,()=>{
      const cursor=read.result;if(!cursor){done();return;}
      const header=cursor.value as StoredEntity;
      if(header.kind!=='conversation'||header.deleted){cursor.continue();return;}
      readMemorySourceTx(tx,header,header.id,owner,source=>{visit(source);cursor.continue();},onMessage);
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');
}

export async function findConversationMessageSource(messageId:number,owner:string) {
  if(!Number.isSafeInteger(messageId)||messageId<1)return undefined;
  let found:MemorySource|undefined,matched=false;
  await visitMemorySources(owner,source=>{if(matched&&!found)found=source;matched=false;},message=>{if(message?.id===messageId)matched=true;});
  return found;
}

export async function saveUnscopedHistory(source:MemorySource,change:HistoryChange) {
  validateHistoryChange(change);
  const {owner,id,revision,bodyToken}=source;
  if(owner!==deviceOwner()||bodyToken===undefined)throw Error('Invalid history source');
  await appTransaction<void>(['entities','meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const meta=tx.objectStore('meta'),local=meta.get(memoryDomainKey(owner,'local')),sync=meta.get(memoryDomainKey(owner,'sync'));
    sync.onsuccess=()=>storageStep(tx,()=>{
      if(local.result?.pending||sync.result?.pending)throw Error('Stop generation before editing');
      const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>storageStep(tx,()=>{
        const header=read.result as StoredEntity|undefined;
        if(!header||header.kind!=='conversation'||header.deleted||header.revision!==revision||(header.payloadParts?.token??null)!==bodyToken)throw Error('History source changed');
        readMemorySourceTx(tx,header,id,owner,actual=>{
          if(['world','shared'].includes(actual.metadata.memory_scope_mode))throw Error('Scoped history commit required');
          writeConversationMemories(tx,header,detachHistoryMemories(actual.metadata.memories??[],change),()=>done(),change);
        });
      });
    });
  });
}

export const readDeviceMemoryDomain=(owner:string,policy:MemoryPolicy)=>appTransaction<OwnedMemoryDomain>(['meta','parts'],'readonly',(tx,done)=>{
  guardStorage(tx,()=>owner===deviceOwner());readDomain(tx,owner,policy,done);
});

export async function commitDeviceGeneration(source:MemorySource,change:GenerationChange,extra:Record<string,unknown>={}) {
  const {owner,id}=source,key='generation:'+owner+':'+change.receipt.generation_id;
  if(owner!==deviceOwner()||source.deleted||source.bodyToken===undefined||['world','shared'].includes(source.metadata.memory_scope_mode)
    ||['world','shared'].includes(change.metadata.memory_scope_mode)||Object.keys(extra).some(name=>name!==memoryEventsKey(owner,id)))throw Error('Invalid generation scope');
  return appTransaction<MemorySource>(['entities','meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const meta=tx.objectStore('meta'),local=meta.get(memoryDomainKey(owner,'local')),sync=meta.get(memoryDomainKey(owner,'sync'));
    sync.onsuccess=()=>storageStep(tx,()=>{
      if(local.result?.pending||sync.result?.pending)throw Error('Stop generation before editing');
      const receipt=meta.get(key);receipt.onsuccess=()=>storageStep(tx,()=>{
        validateGenerationReceipt(owner,id,change,receipt.result);
        const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>storageStep(tx,()=>{
          const header=read.result as StoredEntity|undefined;
          if(header&&(header.owner!==owner||header.id!==id||header.kind!=='conversation'||header.deleted)
            ||(header?.revision??0)!==source.revision||(header?.payloadParts?.token??null)!==source.bodyToken)throw Error('Generation source changed');
          const current=header??{...newEntity('conversation',id,{...source.metadata,messages:[]}),owner};
          writeConversationGeneration(tx,current,change,bodyToken=>{
            meta.put(change.receipt,key);for(const [name,value] of Object.entries(extra))meta.put(value,name);
            done({...source,revision:source.revision+1,bodyToken,metadata:{...change.metadata,...(change.receipt.status==='completed'?{last_generation:change.receipt}:{})}});
          });
        });
      });
    });
  });
}

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

function memorySourceValidator(sessionId:string) {
  const available=new Set<number>();
  const check=(snapshot:any,available:Set<number>)=>{
    for(const memory of snapshot?.memories??[])if(memory.source_session_id!=null&&memory.source_session_id!==sessionId
      ||(memory.source_message_ids??[]).some((id:number)=>!available.has(id)))throw Error('Foreign memory source cannot enter a conversation projection');
  };
  return {message:(message:any)=>{
    if(!Number.isSafeInteger(message.id)||message.id<1||available.has(message.id))throw Error('Invalid memory message source');
    if(message.before)check(message.before,available);available.add(message.id);
    if(message.after)check(message.after,available);
  },finish:(metadata:any)=>check(metadata,available)};
}
function assertOwnMemorySources(record:AppEntity) {
  const validator=memorySourceValidator(record.id);
  for(const message of record.payload.messages??[])validator.message(message);
  validator.finish(record.payload);
}

/** Domain, own canonical projections and generation receipts share the same IDB commit. */
export async function commitDeviceMemoryDomain(owner:string,policy:MemoryPolicy,domain:OwnedMemoryDomain,
  expected:{id:string;revision:number;bodyToken?:string|null}[],updates:AppEntity[]=[],generations:Record<string,Record<string,any>>={},memoryUpdates:MemoryProjectionUpdate[]=[]) {
  validateMemoryDomain(domain);
  if(owner!==deviceOwner()||domain.owner!==owner||domain.policy!==policy||new Set(expected.map(e=>e.id)).size!==expected.length||new Set(updates.map(e=>e.id)).size!==updates.length
    ||expected.some(e=>!text(e.id)||!Number.isSafeInteger(e.revision)||e.revision<0)
    ||new Set([...updates.map(e=>e.id),...memoryUpdates.map(e=>e.source.id)]).size!==updates.length+memoryUpdates.length
    ||memoryUpdates.some(({source})=>source.owner!==owner||source.deleted||memoryPolicy(memoryScopeInput(source))!==policy
      ||!expected.some(x=>x.id===source.id&&x.revision===source.revision)||domain.erased_sessions.includes(source.id))
    ||updates.some(e=>e.owner!==owner||e.kind!=='conversation'||memoryPolicy(e)!==policy||!expected.some(x=>x.id===e.id&&x.revision===e.revision)
      ||!e.deleted&&domain.erased_sessions.includes(e.id)))throw Error('Invalid memory commit scope');
  for(const update of updates)assertOwnMemorySources(update);
  for(const update of updates)if(!update.deleted){
    const binding=memoryBinding(domain,update.id);
    if(!binding||binding.signature!==memorySignature(update.payload.memories??[])
      ||binding.signature!==memorySignature(ownScopeMemories(domain.pools[binding.scope],update.id)))throw Error('Canonical memory projection changed');
  }
  for(const {source,memories,history,generation} of memoryUpdates){
    if(history){validateHistoryChange(history);if(source.bodyToken===undefined)throw Error('Invalid history source');}
    if(generation&&(history||source.bodyToken===undefined||generation.receipt.session_id!==source.id
      ||generations[generation.receipt.generation_id]!==generation.receipt||memoryPolicy({payload:generation.metadata})!==policy))throw Error('Invalid generation projection');
    const binding=memoryBinding(domain,source.id);
    if(!binding||binding.signature!==memorySignature(memories)||binding.signature!==memorySignature(ownScopeMemories(domain.pools[binding.scope],source.id)))throw Error('Canonical memory projection changed');
  }
  if(Object.keys(generations).length>1)throw Error('Invalid memory generation receipt');
  const changed=[...updates,...memoryUpdates.filter(update=>update.generation).map(update=>({id:update.source.id,payload:update.generation!.metadata}))];
  for(const [id,value] of Object.entries(generations))if(!text(id)||id.length>200||value.generation_id!==id||!changed.some(e=>e.id===value.session_id)
    ||!['pending','completed','failed','deleted'].includes(value.status))throw Error('Invalid memory generation receipt');
  return appTransaction<{domain:OwnedMemoryDomain;sessions:AppEntity[];sources:MemorySource[]}>(['entities','meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    readDomain(tx,owner,policy,current=>{
      if(current.revision!==domain.revision){tx.abort();return;}
      const pending=current.pending;
      if(pending&&(domain.pending!==null||!changed.some(e=>e.id===pending.session_id&&e.payload.pending_generation==null)
        ||!['completed','failed'].includes(generations[pending.generation_id]?.status))){tx.abort();return;}
      if(domain.pending&&(!changed.some(e=>e.id===domain.pending!.session_id&&e.payload.pending_generation===domain.pending!.generation_id)
        ||generations[domain.pending.generation_id]?.status!=='pending')){tx.abort();return;}
      let index=0;const saved:AppEntity[]=[],sources:MemorySource[]=[],headers=new Map<string,StoredEntity>();
      const verify=()=>{
        const next=expected[index++];if(!next){index=0;verifyReceipt();return;}
        const read=tx.objectStore('entities').get([owner,next.id]);read.onsuccess=()=>storageStep(tx,()=>{
          let record=read.result as StoredEntity|undefined;
          if((record?.revision??0)!==next.revision||record&&(record.owner!==owner||record.id!==next.id||record.kind!=='conversation')
            ||next.bodyToken!==undefined&&(record?.payloadParts?.token??null)!==next.bodyToken
            ||!record&&!changed.some(e=>e.id===next.id)||record?.deleted&&!updates.some(e=>e.id===next.id&&e.deleted)){tx.abort();return;}
          if(!record){
            const generation=memoryUpdates.find(update=>update.source.id===next.id&&update.generation);
            if(!generation){verify();return;}
            record={...newEntity('conversation',next.id,{...generation.source.metadata,messages:[]}),owner};
          }
          headers.set(next.id,record);
          const projection=memoryUpdates.find(update=>update.source.id===next.id),validator=projection?memorySourceValidator(next.id):undefined;
          const generation=projection?.generation,view=generation?generationChangeView(generation):undefined;
          const visit=(message:any)=>{const retained=view?view.message(message):message;if(retained!==null)validator!.message(retained);};
          const check=(payload:Record<string,any>)=>{
            if(!payload||typeof payload!=='object'||Array.isArray(payload)||(payload.storage_policy==='sync'?'sync':'local')!==policy){tx.abort();return;}
            if(generation){const metadata=view!.finish(payload);for(const message of generation.append)validator!.message(message);validator!.finish({...metadata,memories:projection!.memories});}
            else if(projection)validator!.finish({...payload,memories:projection.memories});
            verify();
          };
          if(record.payloadParts)readParts(tx,[owner,'entity',next.id],record.payloadParts,check,new JsonStream(validator?{onMessage:visit}:{limit:0}));
          else {if(validator)for(const message of record.payload?.messages??[])visit(message);check(record.payload!);}
        });
      };
      const receipts=Object.entries(generations);
      const verifyReceipt=()=>{
        const next=receipts[index++];if(!next){index=0;write();return;}
        const [id,value]=next,read=tx.objectStore('meta').get('generation:'+owner+':'+id);
        read.onsuccess=()=>{
          const previous=read.result;
          const generation=memoryUpdates.find(update=>update.generation?.receipt.generation_id===id)?.generation;
          if(generation){storageStep(tx,()=>{validateGenerationReceipt(owner,value.session_id,generation,previous);verifyReceipt();});return;}
          if(value.status==='pending'?previous!==undefined:value.status!=='deleted'&&(!previous||previous.status!=='pending'||previous.session_id!==value.session_id||previous.generation_id!==id)){
            tx.abort();return;
          }
          verifyReceipt();
        };
      };
      const write=()=>{
        const value=updates[index++];if(!value){index=0;writeMemories();return;}
        const record={...value,revision:value.revision+1,dirty:policy==='sync',opened:Date.now()};
        writeEntity(tx,record,'put',()=>{saved.push(record);write();},true);
      };
      const writeMemories=()=>{
        const update=memoryUpdates[index++];if(!update){persist();return;}
        const {source,memories,history,generation}=update;
        if(generation){
          const change={...generation,metadata:{...generation.metadata,memories}};
          writeConversationGeneration(tx,headers.get(source.id)!,change,bodyToken=>{
            sources.push({...source,revision:source.revision+1,bodyToken,metadata:{...change.metadata,...(change.receipt.status==='completed'?{last_generation:change.receipt}:{})}});writeMemories();
          });return;
        }
        writeConversationMemories(tx,headers.get(source.id)!,memories,bodyToken=>{
          sources.push({...source,revision:source.revision+1,bodyToken,metadata:{...source.metadata,...(history?changedHistoryMetadata(source.metadata,history):{}),memories}});writeMemories();
        },history);
      };
      const persist=()=>{
        const next=structuredClone(domain);for(const record of [...saved,...sources]){const binding=memoryBinding(next,record.id);if(binding)binding.entity_revision=record.revision;}
        writeMemoryDomainTx(tx,next,updated=>{
        const meta=tx.objectStore('meta');
        for(const [id,value] of Object.entries(generations))meta.put(value,'generation:'+owner+':'+id);
        done({domain:updated,sessions:saved,sources});
        });
      };
      verify();
    });
  });
}
