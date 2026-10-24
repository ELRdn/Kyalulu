import { deviceOwner } from './appContext';

export type EntityKind = 'conversation' | 'character' | 'persona' | 'world' | 'preset' | 'profile';
export type AppEntity = { id: string; owner: string; kind: EntityKind; revision: number; serverRevision: number;
  payload: Record<string, any>; deleted: boolean; dirty: boolean; pinned: boolean; opened: number };
export type Outbox = { request_id: string; changes: {id:string;kind:EntityKind;base_revision:number;payload:Record<string,any>;deleted:boolean;delete_confirmed?:boolean}[] };
const DB = 'kyalulu-app-v1';
async function database() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('entities', {keyPath:['owner','id']});
      open.result.createObjectStore('meta');
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(Error('Cannot open device storage / 端末の保存領域を開けません'));
  });
}
export async function appTransaction<T>(stores: string[], mode: IDBTransactionMode,
  action: (tx: IDBTransaction, finish: (value:T)=>void) => void): Promise<T> {
  const db = await database();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(stores, mode); let value:T;
    tx.oncomplete = () => {db.close();resolve(value);};
    tx.onerror = tx.onabort = () => {db.close();reject(Error('Device save failed / 端末への保存に失敗しました'));};
    try { action(tx, v => {value=v;}); } catch(error) {tx.abort();reject(error);}
  });
}
export const allEntities = (owner=deviceOwner()) => appTransaction<AppEntity[]>(['entities'],'readonly',(tx,done)=>{
  const r=tx.objectStore('entities').getAll(IDBKeyRange.bound([owner,''],[owner,'\uffff']));r.onsuccess=()=>done(r.result);
});
export const entity = (id:string, owner=deviceOwner()) => appTransaction<AppEntity|undefined>(['entities'],'readonly',(tx,done)=>{
  const r=tx.objectStore('entities').get([owner,id]);r.onsuccess=()=>done(r.result);
});
export async function saveEntity(value:AppEntity, expectedRevision?:number, metadata:Record<string,unknown>={}) {
  return appTransaction<AppEntity>(['entities','meta'],'readwrite',(tx,done)=>{
    const store=tx.objectStore('entities'),read=store.get([value.owner,value.id]);
    read.onsuccess=()=>{
      const previous=read.result as AppEntity|undefined;
      if(value.owner!==deviceOwner()){tx.abort();return;}
      if(expectedRevision!==undefined&&(previous?.revision??0)!==expectedRevision){tx.abort();return;}
      const updated={...value,revision:(previous?.revision??0)+1,dirty:value.payload.storage_policy==='sync',opened:Date.now()};
      store.put(updated);
      for(const [key,item] of Object.entries(metadata))tx.objectStore('meta').put(item,key);
      done(updated);
    };
  });
}
export const getMeta = <T>(key:string) => appTransaction<T|undefined>(['meta'],'readonly',(tx,done)=>{
  const r=tx.objectStore('meta').get(key);r.onsuccess=()=>done(r.result);
});
export const setMeta = (key:string,value:unknown) => appTransaction<void>(['meta'],'readwrite',(tx,done)=>{
  tx.objectStore('meta').put(value,key);done();
});
export function scrubGenerationRecords(tx:IDBTransaction,owner:string,sessionId:string) {
  const meta=tx.objectStore('meta'),keys=meta.getAllKeys();
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
    const value=read.result as AppEntity|undefined;
    if(value&&!value.deleted){value.opened=Date.now();store.put(value);}done(value);
  };
});
export function offlineStub(record:AppEntity):AppEntity {
  const p=record.payload,last=p.messages?.at(-1);
  return {...record,payload:{storage_policy:'sync',rating:p.rating,cache_evicted:true,title:p.title,
    settings:{session_id:record.id,character_id:p.settings?.character_id,world_id:p.settings?.world_id},
    messages:(p.messages??[]).map((m:any)=>({id:m.id,uuid:m.uuid})),memories:(p.memories??[]).map((m:any)=>({id:m.id,uuid:m.uuid})),
    summaries:[],cache_preview:{count:p.messages?.length??0,last_at:last?.created_at??null,last_preview:String(last?.content??'').slice(0,160)}}};
}
export async function trimOfflineCache(owner=deviceOwner()) {
  const records=await allEntities(owner);
  const conversations=records.filter(e=>e.kind==='conversation'&&!e.deleted).sort((a,b)=>b.opened-a.opened||a.id.localeCompare(b.id));
  const recent=new Set(conversations.slice(0,10).map(e=>e.id));
  const disposable=conversations.filter(e=>!recent.has(e.id)&&!e.pinned&&!e.dirty&&e.serverRevision>0
    &&e.payload.storage_policy==='sync'&&!e.payload.cache_evicted&&!e.payload.pending_generation);
  if(!disposable.length)return;
  await appTransaction<void>(['entities'],'readwrite',(tx,done)=>{
    const store=tx.objectStore('entities');
    for(const e of disposable){const read=store.get([owner,e.id]);read.onsuccess=()=>{
      const current=read.result as AppEntity|undefined;
      if(owner!==deviceOwner()){tx.abort();return;}
      if(current&&!current.deleted&&!current.dirty&&!current.pinned&&!current.payload.pending_generation
        &&current.revision===e.revision&&current.opened===e.opened&&current.serverRevision===e.serverRevision)store.put(offlineStub(current));
    };}
    done();
  });
}
