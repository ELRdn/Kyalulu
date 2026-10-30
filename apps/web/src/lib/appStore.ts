import { deviceOwner } from './appContext';
import { readParts, writeParts, removeParts, storageStep, storageWrite, type Parts } from './segmentedStorage';

export type EntityKind = 'conversation' | 'character' | 'persona' | 'world' | 'preset' | 'profile';
export type AppEntity = { id: string; owner: string; kind: EntityKind; revision: number; serverRevision: number;
  payload: Record<string, any>; deleted: boolean; dirty: boolean; pinned: boolean; opened: number };
export type Outbox = { request_id: string; changes: {id:string;kind:EntityKind;base_revision:number;payload:Record<string,any>;deleted:boolean;delete_confirmed?:boolean}[] };
export { guardStorage } from './segmentedStorage';
const DB = 'kyalulu-app-v1';
export type EntitySelection={storage_policy?:string;cache_evicted:boolean;pending_generation:boolean;maximumMessageId:number;messageIdsValid:boolean;
  delete_confirmation_revision?:number;source?:Record<string,unknown>};
export type StoredEntity=Omit<AppEntity,'payload'>&{payload?:AppEntity['payload'];payloadParts?:Parts;selection?:EntitySelection};
export type StoredOutbox=Outbox&{changesParts?:Parts;count?:number};
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
    const {payloadParts,selection,...header}=value;
    readParts(tx,[value.owner,'entity',value.id],payloadParts,payload=>{
      if(!payload||typeof payload!=='object'||Array.isArray(payload)){tx.abort();return;}
      done({...header,payload});
    });
  });
}
export function readEntity(tx:IDBTransaction,owner:string,id:string,done:(value:AppEntity|undefined)=>void) {
  const read=tx.objectStore('entities').get([owner,id]);read.onsuccess=()=>restoreEntity(tx,read.result,done);
}
export function writeEntity(tx:IDBTransaction,value:AppEntity,mode:'put'|'add'='put',done:()=>void=()=>{}) {
  storageWrite(tx,next=>{
    const store=tx.objectStore('entities'),read=store.get([value.owner,value.id]);
    read.onsuccess=()=>storageStep(tx,()=>{
      const previous=read.result as StoredEntity|undefined;
      if(mode==='add'&&previous)throw Error('Entity identity conflict');
      const {payload,...header}=value,selection=entitySelection(value);
      const write=()=>writeParts(tx,[value.owner,'entity',value.id],payload,payloadParts=>{
        const write=store[mode]({...header,selection,payloadParts});
        write.onsuccess=()=>removeParts(tx,[value.owner,'entity',value.id],previous?.payloadParts,()=>{done();next();});
      });
      if(previous?.payloadParts)readParts(tx,[value.owner,'entity',value.id],previous.payloadParts,write,false);else write();
    });
  });
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
    try{tx=db.transaction(stores.includes('entities')?[...new Set([...stores,'parts'])]:stores,mode);}
    catch(error){db.close();reject(error);return;}
    let value:T,failure:unknown;
    tx.oncomplete=()=>{db.close();resolve(value);};
    tx.onabort=()=>{db.close();reject(failure??Error('Device save/read failed; original data retained / 保存・読込に失敗しました。原本は保持されています'));};
    storageStep(tx,()=>{try{action(tx,v=>{value=v;});}catch(error){failure=error;tx.abort();}});
  });
}
export const allEntities=(owner=deviceOwner())=>appTransaction<AppEntity[]>(['entities'],'readonly',(tx,done)=>{
  const values:AppEntity[]=[],read=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
  read.onsuccess=()=>{
    const cursor=read.result;if(!cursor){done(values);return;}
    restoreEntity(tx,cursor.value,value=>{values.push(value!);cursor.continue();});
  };
});
export const entity=(id:string,owner=deviceOwner())=>appTransaction<AppEntity|undefined>(['entities'],'readonly',(tx,done)=>readEntity(tx,owner,id,done));
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
  const meta=tx.objectStore('meta'),keys=meta.getAllKeys();
  meta.delete(memoryEventsKey(owner,sessionId));
  keys.onsuccess=()=>{
    for(const key of keys.result)if(typeof key==='string'&&key.startsWith('generation:'+owner+':')) {
      const read=meta.get(key);read.onsuccess=()=>{
        if(read.result?.session_id===sessionId)meta.put({generation_id:read.result.generation_id,session_id:sessionId,status:'deleted'},key);
      };
    }
  };
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
export async function trimOfflineCache(owner=deviceOwner()) {
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
  const disposable=conversations.filter(e=>!recent.has(e.id)&&e.disposable);
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
