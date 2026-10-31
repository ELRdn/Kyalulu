import { deviceOwner } from './appContext';
import { readParts, writeParts, rewriteConversationParts, removeParts, storageStep, storageWrite, type Parts, type ConversationScan } from './segmentedStorage';
import { memoryDomainKey,eraseMemoryDomain,eraseDeviceMemoryReferences,type MemoryPolicy } from './deviceMemoryScopes';
import { readMemoryDomainTx,writeMemoryDomainTx } from './deviceMemoryDomainIO';
import { canonical } from './appSyncData';
import { Sha256 } from '../mobile/sha256';
import { JsonStream } from './jsonStream';
import type { GenerationStatus } from './chatRecovery';
import { deviceExecutionLockName } from './deviceExecution';
import { changedHistoryMessage,changedHistoryMetadata,validateHistoryChange,type HistoryChange } from './deviceHistoryChange';
import { generationChangeView,type GenerationChange } from './deviceGenerationChange';

export type EntityKind = 'conversation' | 'character' | 'persona' | 'world' | 'preset' | 'profile';
export type AppEntity = { id: string; owner: string; kind: EntityKind; revision: number; serverRevision: number;
  payload: Record<string, any>; deleted: boolean; dirty: boolean; pinned: boolean; opened: number };
export type Outbox = { request_id: string; changes: {id:string;kind:EntityKind;base_revision:number;payload:Record<string,any>;deleted:boolean;delete_confirmed?:boolean}[] };
export { guardStorage } from './segmentedStorage';
const DB = 'kyalulu-app-v1';
export type ConversationSummary={count:number;last_at:string|null;last_preview:string;character_id:string|null;world_id:string|null;
  title:string|null;sync_recovery:boolean;offline_available:boolean};
export function conversationSummary(p:Record<string,any>):ConversationSummary {
  const last=p.messages?.at(-1),preview=p.cache_evicted?p.cache_preview:{count:p.messages?.length??0,last_at:last?.created_at??null,last_preview:last?.content??''};
  return {count:preview?.count??0,last_at:preview?.last_at??null,last_preview:String(preview?.last_preview??'').slice(0,160),
    character_id:p.settings?.character_id??null,world_id:p.settings?.world_id??null,title:p.title??null,
    sync_recovery:!!p.recovery_from,offline_available:!p.cache_evicted};
}
export type EntitySelection={storage_policy?:string;cache_evicted:boolean;pending_generation:boolean;maximumMessageId:number;messageIdsValid:boolean;
  delete_confirmation_revision?:number;source?:Record<string,unknown>;summary?:ConversationSummary&{token:string}};
type MemoryReferences={sources:string[];memories:string[];hash:string};
export type StoredEntity=Omit<AppEntity,'payload'>&{payload?:AppEntity['payload'];payloadParts?:Parts;selection?:EntitySelection;memoryReferences?:MemoryReferences|null};
export type StoredOutbox=Outbox&{changesParts?:Parts;count?:number};
function memoryReferences(payload:AppEntity['payload']) {
  const sources=new Set<string>(),memories=new Set<string>();
  for(const trace of [payload.last_generation?.memory,payload.last_generation?.telemetry?.memory]){
    if(trace==null)continue;if(typeof trace!=='object')return null;
    if(['candidates','decisions','injected','evidenced'].some(key=>trace[key]!==undefined&&!Array.isArray(trace[key])))return null;
    for(const candidate of trace.candidates??[]){
      if(typeof candidate?.source_session_id==='string')sources.add(candidate.source_session_id);
      if(candidate?.id!=null){if(typeof candidate.id!=='string')return null;memories.add(candidate.id);}
    }
    for(const id of [...(trace.decisions??[]).map((d:any)=>d?.memory_id),...(trace.injected??[]),...(trace.evidenced??[])]){
      if(id==null)continue;if(typeof id!=='string')return null;memories.add(id);
    }
  }
  return {sources:[...sources].sort(),memories:[...memories].sort()};
}
const referenceHash=(token:string,refs:Omit<MemoryReferences,'hash'>)=>new Sha256().update(new TextEncoder().encode(canonical([token,refs.sources,refs.memories]))).digest();
function referencesSource(header:StoredEntity,source:string,removed:Set<string>) {
  const refs=header.memoryReferences;
  if(!header.payloadParts||!refs||!Array.isArray(refs.sources)||!Array.isArray(refs.memories)
    ||refs.sources.some(id=>typeof id!=='string')||refs.memories.some(id=>typeof id!=='string')||refs.hash!==referenceHash(header.payloadParts.token,refs))return true;
  return refs.sources.includes(source)||refs.memories.some(id=>removed.has(id));
}
export function entitySelection(value:StoredEntity):EntitySelection {
  if(value.payloadParts){if(!value.selection)throw Error('Missing entity selection');return value.selection;}
  const p=value.payload!,remote=p.document?.source?.remote;let maximumMessageId=0,messageIdsValid=true;
  for(const message of p.messages??[]){
    messageIdsValid&&=Number.isSafeInteger(message.id)&&message.id>0;maximumMessageId=Math.max(maximumMessageId,message.id);
  }
  return {storage_policy:p.storage_policy,cache_evicted:!!p.cache_evicted,pending_generation:!!p.pending_generation,maximumMessageId,messageIdsValid,
    delete_confirmation_revision:p.delete_confirmation_revision,source:remote?Object.fromEntries(['source','source_id','sha256','document_index'].map(key=>[key,remote[key]])):undefined};
}
export function restoreEntity(tx:IDBTransaction,value:StoredEntity|undefined,done:(value:AppEntity|undefined)=>void) {
  storageStep(tx,()=>{
    if(!value?.payloadParts){
      if(value&&(!value.payload||typeof value.payload!=='object'||Array.isArray(value.payload)))throw Error('Missing entity body');
      done(value as AppEntity|undefined);return;
    }
    const {payloadParts,selection,memoryReferences:_,...header}=value;
    readParts(tx,[value.owner,'entity',value.id],payloadParts,payload=>{
      if(!payload||typeof payload!=='object'||Array.isArray(payload)){tx.abort();return;}
      done({...header,payload});
    });
  });
}
export function readEntity(tx:IDBTransaction,owner:string,id:string,done:(value:AppEntity|undefined)=>void) {
  const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>restoreEntity(tx,read.result,done);
}
function persistEntity(tx:IDBTransaction,value:AppEntity,mode:'put'|'add',done:()=>void) {
    const store=tx.objectStore('entities'),read=store.get([value.owner,value.id]);
    read.onsuccess=()=>storageStep(tx,()=>{
      const previous=read.result as StoredEntity|undefined;
      if(mode==='add'&&previous)throw Error('Entity identity conflict');
      const {payload,...header}=value,selection=entitySelection(value);
      const write=()=>writeParts(tx,[value.owner,'entity',value.id],payload,payloadParts=>{
        const refs=value.kind==='conversation'?memoryReferences(payload):null;
        const write=store[mode]({...header,selection:{...selection,...(value.kind==='conversation'?{summary:{...conversationSummary(payload),token:payloadParts.token}}:{})},payloadParts,memoryReferences:refs?{...refs,hash:referenceHash(payloadParts.token,refs)}:null});
        write.onsuccess=()=>removeParts(tx,[value.owner,'entity',value.id],previous?.payloadParts,done);
      });
      if(previous?.payloadParts)readParts(tx,[value.owner,'entity',value.id],previous.payloadParts,write,false);else write();
    });
}
export function writeEntity(tx:IDBTransaction,value:AppEntity,mode:'put'|'add'='put',done:()=>void=()=>{},verifiedMemoryCommit=false) {
  storageWrite(tx,next=>{
    const write=()=>persistEntity(tx,value,mode,()=>{done();next();});
    if(verifiedMemoryCommit||value.kind!=='conversation'){write();return;}
    const meta=tx.objectStore('meta'),local=meta.get(memoryDomainKey(value.owner,'local')),sync=meta.get(memoryDomainKey(value.owner,'sync'));
    sync.onsuccess=()=>storageStep(tx,()=>{
      if(local.result?.pending||sync.result?.pending)throw Error('Stop generation before editing');write();
    });
  });
}
function conversationPartsHeader(header:StoredEntity,ref:Parts,payload:Record<string,any>,scan:ConversationScan):StoredEntity {
  const refs=memoryReferences(payload),{payload:_,...raw}=header;
  const selection={...header.selection,...entitySelection({...header,payloadParts:undefined,payload}),maximumMessageId:scan.maximumMessageId,messageIdsValid:scan.messageIdsValid,
    summary:{...conversationSummary(payload),...(!payload.cache_evicted?{count:scan.count,last_preview:scan.last_preview,last_at:scan.last_at}:{}),token:ref.token}};
  return {...raw,selection,payloadParts:ref,memoryReferences:refs?{...refs,hash:referenceHash(ref.token,refs)}:null};
}
function adoptConversationRewrite(tx:IDBTransaction,header:StoredEntity,ref:Parts,payload:Record<string,any>,scan:ConversationScan,done:()=>void) {
  const write=tx.objectStore('entities').put(conversationPartsHeader({...header,revision:header.revision+1,dirty:header.dirty||payload.storage_policy==='sync'},ref,payload,scan));
  write.onsuccess=()=>removeParts(tx,[header.owner,'entity',header.id],header.payloadParts,done);
}
/** Caller verifies source revision/token in this transaction; copying never removes source parts. */
export function writeConversationCopy(tx:IDBTransaction,source:StoredEntity,id:string,metadata:Record<string,any>,transform:(message:any)=>any|null,done:()=>void) {
  storageWrite(tx,next=>{
    const meta=tx.objectStore('meta'),local=meta.get(memoryDomainKey(source.owner,'local')),sync=meta.get(memoryDomainKey(source.owner,'sync'));
    sync.onsuccess=()=>storageStep(tx,()=>{
      if(source.owner!==deviceOwner()||source.kind!=='conversation'||source.deleted||id===source.id
        ||Object.hasOwn(metadata,'messages')||local.result?.pending||sync.result?.pending)throw Error('Invalid conversation copy');
      const target={...newEntity('conversation',id,{}),owner:source.owner,revision:1,dirty:metadata.storage_policy==='sync'},complete=()=>{done();next();};
      if(source.payloadParts){
        rewriteConversationParts(tx,[source.owner,'entity',source.id],source.payloadParts,()=>metadata,(ref,_source,scan)=>{
          const write=tx.objectStore('entities').add(conversationPartsHeader(target,ref,{...metadata,messages:[]},scan));write.onsuccess=()=>storageStep(tx,complete);
        },transform,[source.owner,'entity',id]);
      }else{
        if(!Array.isArray(source.payload?.messages))throw Error('Missing conversation body');
        const messages=source.payload.messages.flatMap((message:any)=>{const copy=transform(structuredClone(message));return copy===null?[]:[copy];});
        persistEntity(tx,{...target,payload:{...metadata,messages}},'add',complete);
      }
    });
  });
}
/** The caller rechecks the inspected revision in this transaction; never pass a page as a full entity. */
export function writeConversationMetadata(tx:IDBTransaction,header:StoredEntity,patch:Record<string,unknown>,done:()=>void) {
  storageWrite(tx,next=>{
    const complete=()=>{done();next();};
    const meta=tx.objectStore('meta'),local=meta.get(memoryDomainKey(header.owner,'local')),sync=meta.get(memoryDomainKey(header.owner,'sync'));
    sync.onsuccess=()=>storageStep(tx,()=>{
      if(header.owner!==deviceOwner()||header.kind!=='conversation'||header.deleted||!Number.isSafeInteger(header.revision+1)
        ||Object.keys(patch).some(key=>!['settings','summaries'].includes(key)))throw Error('Invalid conversation metadata update');
      if(local.result?.pending||sync.result?.pending)throw Error('Stop generation before editing');
      const check=(p:Record<string,any>)=>{if(p.cache_evicted)throw Error('Conversation unavailable');};
      if(!header.payloadParts){
        const p=header.payload;if(!p||!Array.isArray(p.messages))throw Error('Missing conversation body');check(p);
        persistEntity(tx,{...header,revision:header.revision+1,dirty:header.dirty||p.storage_policy==='sync',payload:{...p,...patch}} as AppEntity,'put',complete);return;
      }
      rewriteConversationParts(tx,[header.owner,'entity',header.id],header.payloadParts,patch,(ref,metadata,scan)=>{
        check(metadata);adoptConversationRewrite(tx,header,ref,{...metadata,...patch,messages:[]},scan,complete);
      });
    });
  });
}
/** Callers verify source/receipt/pending guards in this transaction before rewriting. */
export function writeConversationMemories(tx:IDBTransaction,header:StoredEntity,memories:unknown[],done:(bodyToken:string)=>void,history?:HistoryChange) {
  storageWrite(tx,next=>{
    if(header.owner!==deviceOwner()||header.kind!=='conversation'||header.deleted||!Number.isSafeInteger(header.revision+1))throw Error('Invalid memory projection');
    const complete=(token:string)=>{done(token);next();};
    if(history)validateHistoryChange(history);
    const check=(p:Record<string,any>)=>{if(p.cache_evicted)throw Error('Conversation unavailable');if(history&&p.pending_generation)throw Error('Stop generation before editing history');};
    const patch=(p:Record<string,any>)=>({...(history?changedHistoryMetadata(p,history):{}),memories});
    if(header.payloadParts){
      rewriteConversationParts(tx,[header.owner,'entity',header.id],header.payloadParts,patch,(ref,metadata,scan)=>{
        check(metadata);adoptConversationRewrite(tx,{...header,dirty:metadata.storage_policy==='sync',opened:Date.now()},ref,
          {...metadata,...patch(metadata),messages:[]},scan,()=>complete(ref.token));
      },history?message=>changedHistoryMessage(message,history):undefined);
    }else{
      const p=header.payload;if(!p||!Array.isArray(p.messages))throw Error('Missing conversation body');check(p);
      const messages=history?p.messages.flatMap((message:any)=>{const changed=changedHistoryMessage(message,history);return changed===null?[]:[changed];}):p.messages;
      persistEntity(tx,{...header,revision:header.revision+1,dirty:p.storage_policy==='sync',opened:Date.now(),payload:{...p,...patch(p),messages}} as AppEntity,'put',()=>{
        const read=tx.objectStore('entities').get([header.owner,header.id]);read.onsuccess=()=>storageStep(tx,()=>complete(read.result.payloadParts.token));
      });
    }
  });
}
/** Caller verifies the source and receipt in this transaction; no full history enters a save. */
export function writeConversationGeneration(tx:IDBTransaction,header:StoredEntity,change:GenerationChange,done:(bodyToken:string)=>void) {
  storageWrite(tx,next=>storageStep(tx,()=>{
    if(header.owner!==deviceOwner()||header.kind!=='conversation'||header.deleted||!Number.isSafeInteger(header.revision+1))throw Error('Invalid generation source');
    const view=generationChangeView(change),complete=(token:string)=>{done(token);next();};
    if(header.payloadParts){
      let metadata:Record<string,any>;
      rewriteConversationParts(tx,[header.owner,'entity',header.id],header.payloadParts,p=>metadata=view.finish(p),(ref,_p,scan)=>{
        adoptConversationRewrite(tx,{...header,dirty:change.metadata.storage_policy==='sync',opened:Date.now()},ref,{...metadata,messages:[]},scan,()=>complete(ref.token));
      },view.message,undefined,change.append);
    }else{
      const p=header.payload;if(!Array.isArray(p?.messages))throw Error('Missing generation source');
      const messages=p.messages.flatMap((message:any)=>{const value=view.message(message);return value===null?[]:[value];});
      const metadata=view.finish(p);messages.push(...change.append);
      persistEntity(tx,{...header,revision:header.revision+1,dirty:metadata.storage_policy==='sync',opened:Date.now(),payload:{...metadata,messages}} as AppEntity,'put',()=>{
        const read=tx.objectStore('entities').get([header.owner,header.id]);read.onsuccess=()=>storageStep(tx,()=>complete(read.result.payloadParts.token));
      });
    }
  }));
}
/** Caller holds the owner execution lease; domain recovery also commits its pending domain here. */
export function recoverPendingConversation(tx:IDBTransaction,header:StoredEntity,generationId:string,done:()=>void,domainRecovery=false) {
  storageWrite(tx,next=>{
    const complete=()=>{done();next();};
    const rewrite=()=>storageStep(tx,()=>{
      if(header.owner!==deviceOwner()||header.kind!=='conversation'||header.deleted||!Number.isSafeInteger(header.revision+1))throw Error('Pending conversation changed');
      const check=(p:Record<string,any>)=>{
        if(p.pending_generation!==generationId&&!(domainRecovery&&p.pending_generation==null))throw Error('Pending generation changed');
      };
      if(!header.payloadParts){
        const p=header.payload;if(!p)throw Error('Missing conversation body');check(p);
        if(p.pending_generation==null){complete();return;}
        persistEntity(tx,{...header,revision:header.revision+1,dirty:header.dirty||p.storage_policy==='sync',payload:{...p,pending_generation:null}} as AppEntity,'put',complete);return;
      }
      const previous=header.payloadParts,location=[header.owner,'entity',header.id] as const;
      rewriteConversationParts(tx,location,previous,{pending_generation:null},(ref,metadata,scan)=>{
        check(metadata);
        if(metadata.pending_generation==null){removeParts(tx,location,ref,complete);return;}
        adoptConversationRewrite(tx,header,ref,{...metadata,pending_generation:null,messages:[]},scan,complete);
      });
    });
    if(domainRecovery){rewrite();return;}
    const meta=tx.objectStore('meta'),local=meta.get(memoryDomainKey(header.owner,'local')),sync=meta.get(memoryDomainKey(header.owner,'sync'));
    sync.onsuccess=()=>storageStep(tx,()=>{if(local.result?.pending||sync.result?.pending)throw Error('Stop generation before editing');rewrite();});
  });
}
export async function recoverConversationGeneration(owner:string,generationId:string,sessionId:string,expectedRevision?:number) {
  if(owner!==deviceOwner())throw Error('Account changed');
  const result=await appTransaction<Record<string,any>>(['entities','meta'],'readwrite',(tx,done)=>{
    const meta=tx.objectStore('meta'),key='generation:'+owner+':'+generationId,receipt=meta.get(key);
    receipt.onsuccess=()=>storageStep(tx,()=>{
      const previous=receipt.result;
      if(previous?.status!=='pending'||previous.session_id!==sessionId||previous.generation_id!==generationId
        ||previous.execution_lock!==deviceExecutionLockName(owner)&&!Number.isSafeInteger(expectedRevision))throw Error('Pending generation changed');
      const read=tx.objectStore('entities').get([owner,sessionId]);read.onsuccess=()=>storageStep(tx,()=>{
        const header=read.result as StoredEntity|undefined;
        if(!header||header.owner!==owner||header.id!==sessionId||expectedRevision!==undefined&&header.revision!==expectedRevision)throw Error('Pending conversation changed');
        const recovered={...previous,status:'failed'};
        recoverPendingConversation(tx,{...header,opened:Date.now()},generationId,()=>{meta.put(recovered,key);done(recovered);});
      });
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');return result;
}
export function restoreOutbox<T extends StoredOutbox>(tx:IDBTransaction,owner:string,value:T|undefined,done:(value:T|undefined)=>void) {
  if(!value?.changesParts){done(value);return;}
  const {changesParts,count,...header}=value;
  readParts(tx,[owner,'outbox','fixed'],changesParts,changes=>{
    if(!Array.isArray(changes)||changes.length!==count){tx.abort();return;}
    done({...header,changes} as T);
  });
}
export function writeOutbox(tx:IDBTransaction,owner:string,value:Outbox|null,done:()=>void=()=>{}) {
  storageWrite(tx,next=>{
    const meta=tx.objectStore('meta'),key='sync:'+owner+':outbox',read=meta.get(key);
    read.onsuccess=()=>storageStep(tx,()=>{
      const previous=read.result as StoredOutbox|undefined;
      const finish=(ref?:Parts)=>{
        const write=value?meta.put({...value,changes:value.changes.map(({payload,...control})=>({...control,payload:{}})),
          count:value.changes.length,changesParts:ref},key):meta.delete(key);
        write.onsuccess=()=>removeParts(tx,[owner,'outbox','fixed'],previous?.changesParts,()=>{done();next();});
      };
      if(!value){finish();return;}
      const write=()=>writeParts(tx,[owner,'outbox','fixed'],value.changes,finish);
      if(previous?.changesParts)readParts(tx,[owner,'outbox','fixed'],previous.changesParts,write,false);else write();
    });
  });
}
async function database() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const open=indexedDB.open(DB,3);let settled=false;
    open.onupgradeneeded=()=>{
      if(settled){open.transaction!.abort();return;}
      if(!open.result.objectStoreNames.contains('entities'))open.result.createObjectStore('entities',{keyPath:['owner','id']});
      if(!open.result.objectStoreNames.contains('parts'))open.result.createObjectStore('parts');
      const meta=open.result.objectStoreNames.contains('meta')?open.transaction!.objectStore('meta'):open.result.createObjectStore('meta');
      if(!meta.indexNames.contains('sync-outbox-state'))meta.createIndex('sync-outbox-state',['request_id','withdrawn']);
    };
    open.onblocked=()=>{settled=true;reject(Error('Close other app tabs and reload to upgrade device storage / 他のタブを閉じて再読み込みしてください'));};
    open.onsuccess=()=>{
      const db=open.result;db.onversionchange=()=>db.close();
      if(settled){db.close();return;}settled=true;resolve(db);
    };
    open.onerror=()=>{settled=true;reject(Error('Cannot open device storage; use a v3-compatible client / v3対応のアプリで保存領域を開いてください'));};
  });
}
export async function appTransaction<T>(stores:string[],mode:IDBTransactionMode,
  action:(tx:IDBTransaction,finish:(value:T)=>void)=>void):Promise<T> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    let tx:IDBTransaction;
    try{tx=db.transaction(stores.includes('entities')?[...new Set([...stores,'parts',...(mode==='readwrite'?['meta']:[])])]:stores,mode);}
    catch(error){db.close();reject(error);return;}
    let value:T,failure:unknown;
    tx.oncomplete=()=>{db.close();resolve(value);};
    tx.onabort=()=>{db.close();reject(failure??Error('Device save/read failed; original data retained / 保存・読込に失敗しました。原本は保持されています'));};
    storageStep(tx,()=>{try{action(tx,v=>{value=v;});}catch(error){failure=error;tx.abort();}});
  });
}
export const allEntities=(owner=deviceOwner(),kinds?:readonly EntityKind[])=>appTransaction<AppEntity[]>(['entities'],'readonly',(tx,done)=>{
  const values:AppEntity[]=[],read=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
  read.onsuccess=()=>storageStep(tx,()=>{
    const cursor=read.result;if(!cursor){done(values);return;}
    if(kinds&&!kinds.includes(cursor.value.kind)){cursor.continue();return;}
    restoreEntity(tx,cursor.value,value=>{values.push(value!);cursor.continue();});
  });
});
export const entity=(id:string,owner=deviceOwner())=>appTransaction<AppEntity|undefined>(['entities'],'readonly',(tx,done)=>readEntity(tx,owner,id,done));
export type ConversationInfo=Pick<AppEntity,'owner'|'id'|'revision'|'pinned'|'opened'|'deleted'>&{selection:EntitySelection};
export async function conversationInfo(id:string,owner=deviceOwner()):Promise<ConversationInfo|undefined> {
  if(owner!==deviceOwner())throw Error('Account changed');
  const value=await appTransaction<ConversationInfo|undefined>(['entities'],'readonly',(tx,done)=>{
    const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>storageStep(tx,()=>{
      const value=read.result as StoredEntity|undefined;
      if(!value){done(undefined);return;}
      if(value.owner!==owner||value.id!==id||value.kind!=='conversation')throw Error('Invalid conversation');
      const {revision,pinned,opened,deleted}=value;done({id,owner,revision,pinned,opened,deleted,selection:entitySelection(value)});
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');return value;
}
export async function readConversationSummary(id:string,owner=deviceOwner()):Promise<ConversationSummary|undefined> {
  if(owner!==deviceOwner())throw Error('Account changed');
  const value=await appTransaction<ConversationSummary|undefined>(['entities'],'readonly',(tx,done)=>{
    const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result as StoredEntity|undefined;if(!header||header.deleted){done(undefined);return;}
      if(header.owner!==owner||header.id!==id||header.kind!=='conversation')throw Error('Invalid conversation');
      const finish=(p:any,total:number|undefined)=>{
        if(!p||!Array.isArray(p.messages)||total===undefined)throw Error('Invalid conversation summary');
        const summary=conversationSummary(p);done({...summary,count:p.cache_evicted?summary.count:total});
      };
      if(header.payloadParts){const parser=new JsonStream({limit:1});readParts(tx,[owner,'entity',id],header.payloadParts,p=>finish(p,parser.totalMessages),parser);}
      else finish(header.payload,header.payload?.messages?.length);
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');return value;
}
export type ConversationPageCursor={owner:string;id:string;revision:number;bodyToken:string|null;start:number;end:number};
export type GenerationHistoryProof={status:GenerationStatus;revision:number;body_token:string|null;
  history:{id:number;role:'user'|'assistant';content:string}[]};
/** Read the receipt and its saved messages in one snapshot; never return a partial AppEntity. */
export async function generationHistory(id:string,generationId:string,owner=deviceOwner()):Promise<GenerationHistoryProof> {
  if(!id||!generationId||owner!==deviceOwner())throw Error('Invalid generation history');
  const result=await appTransaction<GenerationHistoryProof>(['entities','meta'],'readonly',(tx,done)=>{
    const receipt=tx.objectStore('meta').get('generation:'+owner+':'+generationId);
    receipt.onsuccess=()=>storageStep(tx,()=>{
      const status=receipt.result;
      const positive=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
      if(!status||status.generation_id!==generationId||status.session_id!==id||!['completed','invalid','failed','cancelled'].includes(status.status)
        ||status.assistant_id!==null&&!positive(status.assistant_id)||status.user_id!==null&&!positive(status.user_id)
        ||status.status==='completed'&&status.assistant_id===null)throw Error('Generation result is not confirmed');
      const ids=[status.user_id,status.assistant_id].filter((n):n is number=>n!==null);
      if(new Set(ids).size!==ids.length)throw Error('Invalid generation message IDs');
      const parser=new JsonStream(ids.length?{ids}:{limit:0});
      const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>storageStep(tx,()=>{
        const header=read.result as StoredEntity|undefined;
        if(!header||header.owner!==owner||header.id!==id||header.kind!=='conversation'||header.deleted||!Number.isSafeInteger(header.revision)||header.revision<0)throw Error('Saved conversation unavailable');
        const finish=(p:any,total:number|undefined)=>{
          if(!p||!Array.isArray(p.messages)||total===undefined||p.cache_evicted)throw Error('Saved conversation unavailable');
          const messages=p.messages.filter((m:any)=>ids.includes(m?.id));
          if(new Set(messages.map((m:any)=>m.id)).size!==messages.length)throw Error('Duplicate generation message IDs');
          if(status.assistant_id!==null){
            const assistant=messages.find((m:any)=>m.id===status.assistant_id),user=messages.find((m:any)=>m.id===status.user_id);
            if(assistant?.role!=='assistant'||typeof assistant.content!=='string'||typeof status.reply==='string'&&assistant.content!==status.reply
              ||status.user_id!==null&&(user?.role!=='user'||typeof user.content!=='string')
              ||typeof status.user_content_sha256==='string'&&new Sha256().update(new TextEncoder().encode(user?.content??'')).digest()!==status.user_content_sha256)throw Error('Saved generation messages changed');
          }
          done({status:{generation_id:status.generation_id,session_id:status.session_id,status:status.status,assistant_id:status.assistant_id,user_id:status.user_id},
            revision:header.revision,body_token:header.payloadParts?.token??null,
            history:messages.filter((m:any)=>['user','assistant'].includes(m.role)&&typeof m.content==='string').map(({id,role,content}:any)=>({id,role,content}))});
        };
        if(header.payloadParts)readParts(tx,[owner,'entity',id],header.payloadParts,p=>finish(p,parser.totalMessages),parser);
        else finish(header.payload,header.payload?.messages?.length);
      });
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');return result;
}
export type ConversationPage={owner:string;id:string;revision:number;bodyToken:string|null;metadata:Record<string,unknown>;
  messages:unknown[];total:number;start:number;end:number;previous?:ConversationPageCursor;next?:ConversationPageCursor};
export async function conversationPage(id:string,owner=deviceOwner(),limit=50,cursor?:ConversationPageCursor):Promise<ConversationPage|undefined> {
  if(typeof id!=='string'||!id||owner!==deviceOwner()||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid conversation page');
  if(cursor!==undefined&&(!cursor||cursor.owner!==owner||cursor.id!==id||!Number.isSafeInteger(cursor.revision)||cursor.revision<0
    ||!Number.isSafeInteger(cursor.start)||cursor.start<0||!Number.isSafeInteger(cursor.end)||cursor.end<cursor.start||cursor.end-cursor.start>limit
    ||cursor.bodyToken!==null&&typeof cursor.bodyToken!=='string'))throw Error('Invalid conversation cursor');
  cursor=cursor&&{...cursor};
  const parser=new JsonStream(cursor?{start:cursor.start,limit:cursor.end-cursor.start}:{limit});
  const page=await appTransaction<ConversationPage|undefined>(['entities'],'readonly',(tx,done)=>{
    const read=tx.objectStore('entities').get([owner,id]);
    read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result as StoredEntity|undefined;
      if(!header){if(cursor)throw Error('Conversation page changed');done(undefined);return;}
      const bodyToken=header.payloadParts?.token??null;
      if(header.owner!==owner||header.id!==id||header.kind!=='conversation'||header.deleted||!Number.isSafeInteger(header.revision)||header.revision<0
        ||cursor&&(cursor.revision!==header.revision||cursor.bodyToken!==bodyToken))throw Error('Conversation page changed');
      const finish=(payload:any,total:number|undefined)=>{
        if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.messages)||total===undefined||payload.cache_evicted
          ||cursor&&cursor.end>total)throw Error('Conversation page unavailable');
        const {messages,...metadata}=payload,end=cursor?.end??total,start=cursor?.start??Math.max(0,end-limit);
        if(messages.length!==end-start)throw Error('Conversation page changed');
        const position=(start:number,end:number):ConversationPageCursor=>({owner,id,revision:header.revision,bodyToken,start,end});
        done({owner,id,revision:header.revision,bodyToken,metadata,messages,total,start,end,
          ...(start>0?{previous:position(Math.max(0,start-limit),start)}:{}),...(end<total?{next:position(end,Math.min(total,end+limit))}:{})});
      };
      if(header.payloadParts)readParts(tx,[owner,'entity',id],header.payloadParts,payload=>finish(payload,parser.totalMessages),parser);
      else{
        const payload=header.payload,total=Array.isArray(payload?.messages)?payload.messages.length:undefined,end=cursor?.end??total??0;
        finish({...payload,messages:payload?.messages?.slice(cursor?.start??Math.max(0,end-limit),end)},total);
      }
    });
  });
  if(owner!==deviceOwner())throw Error('Account changed');return page;
}
export async function saveEntity(value:AppEntity,expectedRevision?:number,metadata:Record<string,unknown>={}) {
  return appTransaction<AppEntity>(['entities','meta'],'readwrite',(tx,done)=>{
    const read=tx.objectStore('entities').get([value.owner,value.id]);
    read.onsuccess=()=>{
      const previous=read.result as StoredEntity|undefined;
      if(value.owner!==deviceOwner()||expectedRevision!==undefined&&(previous?.revision??0)!==expectedRevision){tx.abort();return;}
      const updated={...value,revision:(previous?.revision??0)+1,dirty:value.payload.storage_policy==='sync',opened:Date.now()};
      writeEntity(tx,updated,'put',()=>{
        if(value.owner!==deviceOwner()){tx.abort();return;}
        for(const [key,item] of Object.entries(metadata))tx.objectStore('meta').put(item,key);
        done(updated);
      });
    };
  });
}
export const getMeta=<T>(key:string)=>appTransaction<T|undefined>(['meta'],'readonly',(tx,done)=>{
  const read=tx.objectStore('meta').get(key);read.onsuccess=()=>done(read.result);
});
export const setMeta=(key:string,value:unknown)=>appTransaction<void>(['meta'],'readwrite',(tx,done)=>{
  tx.objectStore('meta').put(value,key);done();
});
export const memoryEventsKey=(owner:string,sessionId:string)=>'memory-events:'+JSON.stringify([owner,sessionId]);
export function copyMemoryEvents(tx:IDBTransaction,source:AppEntity,target:AppEntity) {
  const meta=tx.objectStore('meta'),read=meta.get(memoryEventsKey(source.owner,source.id));
  read.onsuccess=()=>{
    try{
      if(read.result===undefined)return;
      if(source.owner!==target.owner||source.owner!==deviceOwner()||source.id===target.id)throw Error('Invalid memory history destination');
      if(!Array.isArray(read.result))throw Error('Invalid memory history');
      const memories=(p:AppEntity['payload'])=>[...(p.memories??[]),...(p.messages??[]).flatMap((m:any)=>[...(m.before?.memories??[]),...(m.after?.memories??[])])];
      const targetIds=new Map(memories(target.payload).map((m:any)=>[m.uuid??m.id,m.id]));
      const ids=new Map(memories(source.payload).map((m:any)=>[m.id,targetIds.get(m.uuid??m.id)]));
      const events=read.result.map((event:any,index:number)=>{
        if(event?.id!==index+1||event.scope!==source.id)throw Error('Invalid memory history');
        const remap=(id:string)=>ids.get(id)??null;
        return {...event,scope:target.id,source_scope:event.source_scope??source.id,
          memory_id:event.memory_id?remap(event.memory_id):null,source_memory_id:event.source_memory_id??event.memory_id,
          detail:Array.isArray(event.detail?.candidates)?{...event.detail,candidates:event.detail.candidates.map((c:any)=>({...c,id:remap(c.id),source_id:c.source_id??c.id}))}:event.detail};
      });
      meta.add(events,memoryEventsKey(target.owner,target.id));
    }catch{tx.abort();}
  };
}
export function scrubGenerationRecords(tx:IDBTransaction,owner:string,sessionId:string) {
  storageWrite(tx,next=>{
    const meta=tx.objectStore('meta'),removed=new Set<string>(),policies:MemoryPolicy[]=['local','sync'];let index=0;
    meta.delete(memoryEventsKey(owner,sessionId));
    const domains=()=>{
      const policy=policies[index++];if(!policy){generations();return;}
      readMemoryDomainTx(tx,owner,policy,domain=>{
        const result=eraseMemoryDomain(domain,sessionId);for(const id of result.removed)removed.add(id);
        if(result.changed)writeMemoryDomainTx(tx,domain,domains);else domains();
      });
    };
    const generations=()=>{
      const keys=meta.getAllKeys();keys.onsuccess=()=>{
        const selected=keys.result.filter(key=>typeof key==='string'&&key.startsWith('generation:'+owner+':'));let index=0;
        const scan=()=>{
          const key=selected[index++];if(key===undefined){conversations();return;}
          const read=meta.get(key);read.onsuccess=()=>storageStep(tx,()=>{
            const value=read.result;
            if(value?.session_id===sessionId)meta.put({generation_id:value.generation_id,session_id:sessionId,status:'deleted'},key);
            else {const redacted=eraseDeviceMemoryReferences(value,sessionId,removed);if(redacted!==value)meta.put(redacted,key);}
            scan();
          });
        };scan();
      };
    };
    const conversations=()=>{
      const cursor=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
      cursor.onsuccess=()=>storageStep(tx,()=>{
        const current=cursor.result;if(!current){next();return;}
        const header=current.value as StoredEntity;
        if(header.id===sessionId||header.kind!=='conversation'||header.deleted||!referencesSource(header,sessionId,removed)){current.continue();return;}
        restoreEntity(tx,header,value=>{
          const result=value!.payload.last_generation,redacted=eraseDeviceMemoryReferences(result,sessionId,removed);
          if(redacted===result){current.continue();return;}
          persistEntity(tx,{...value!,revision:value!.revision+1,payload:{...value!.payload,last_generation:redacted}},'put',()=>current.continue());
        });
      });
    };
    domains();
  });
}
export function newEntity(kind:EntityKind,id:string,payload:Record<string,any>,owner=deviceOwner()):AppEntity {
  return {owner,id,kind,payload,revision:0,serverRevision:0,deleted:false,dirty:false,pinned:false,opened:Date.now()};
}
export const openEntity = (id:string,owner=deviceOwner()) => appTransaction<AppEntity|undefined>(['entities'],'readwrite',(tx,done)=>{
  const store=tx.objectStore('entities'),read=store.get([owner,id]);
  read.onsuccess=()=>{
    if(owner!==deviceOwner()){tx.abort();return;}
    const value=read.result as StoredEntity|undefined;
    if(value&&!value.deleted){value.opened=Date.now();store.put(value);}
    restoreEntity(tx,value,done);
  };
});
export function offlineStub(record:AppEntity):AppEntity {
  const p=record.payload,last=p.messages?.at(-1);
  return {...record,payload:{storage_policy:'sync',rating:p.rating,cache_evicted:true,title:p.title,
    source:p.source,migration:p.migration,imported_from:p.imported_from,branch_of:p.branch_of,fork_revision:p.fork_revision,lineage:p.lineage,
    settings:{session_id:record.id,character_id:p.settings?.character_id,world_id:p.settings?.world_id},
    messages:(p.messages??[]).map((m:any)=>({id:m.id,uuid:m.uuid})),memories:(p.memories??[]).map((m:any)=>({id:m.id,uuid:m.uuid})),
    summaries:[],cache_preview:{count:p.messages?.length??0,last_at:last?.created_at??null,last_preview:String(last?.content??'').slice(0,160)}}};
}
export async function trimOfflineCache(owner=deviceOwner(),keepId?:string) {
  const conversations=await appTransaction<(Pick<AppEntity,'id'|'revision'|'opened'|'serverRevision'>&{disposable:boolean})[]>(['entities'],'readonly',(tx,done)=>{
    const records:(Pick<AppEntity,'id'|'revision'|'opened'|'serverRevision'>&{disposable:boolean})[]=[];
    const read=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
    read.onsuccess=()=>{
      if(owner!==deviceOwner()){tx.abort();return;}
      const cursor=read.result;
      if(!cursor){done(records);return;}
      const e=cursor.value as StoredEntity,p=entitySelection(e);
      if(e.kind==='conversation'&&!e.deleted)records.push({id:e.id,revision:e.revision,opened:e.opened,serverRevision:e.serverRevision,
        disposable:!e.pinned&&!e.dirty&&e.serverRevision>0&&p.storage_policy==='sync'&&!p.cache_evicted&&!p.pending_generation});
      cursor.continue();
    };
  });
  conversations.sort((a,b)=>b.opened-a.opened||a.id.localeCompare(b.id));
  const recent=new Set(conversations.slice(0,10).map(e=>e.id));
  const disposable=conversations.filter(e=>e.id!==keepId&&!recent.has(e.id)&&e.disposable);
  if(!disposable.length)return;
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>{
    const store=tx.objectStore('entities');let index=0;
    // Wait for each write so eviction never queues all conversation bodies at once.
    const next=()=>{
      if(owner!==deviceOwner()){tx.abort();return;}
      const e=disposable[index++];if(!e){done();return;}
      const read=store.get([owner,e.id]);read.onsuccess=()=>{
        const current=read.result as StoredEntity|undefined,p=current&&entitySelection(current);
        if(owner!==deviceOwner()){tx.abort();return;}
        if(current&&current.kind==='conversation'&&!current.deleted&&!current.dirty&&!current.pinned&&!p!.pending_generation
          &&p!.storage_policy==='sync'&&!p!.cache_evicted&&current.serverRevision>0
          &&current.revision===e.revision&&current.opened===e.opened&&current.serverRevision===e.serverRevision){
          restoreEntity(tx,current,value=>{
            if(owner!==deviceOwner()){tx.abort();return;}
            writeEntity(tx,offlineStub(value!),'put',next);
          });
        }else next();
      };
    };
    next();
  });
}
