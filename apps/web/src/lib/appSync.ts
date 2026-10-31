import { appTransaction, entity, getMeta, entitySelection, guardStorage, restoreEntity, readEntity, writeEntity, acknowledgeConversation, writeOutbox, scrubGenerationRecords, copyMemoryEvents, trimOfflineCache, type StoredEntity, type StoredOutbox, type AppEntity, type Outbox } from './appStore';
import { deviceExecutionLockName } from './deviceExecution';
import { cloudFetch } from './transport';
import { deviceOwner, generationBusy } from './appContext';
import { receiveConversation, receiveLibrarySnapshot, receiveCreatorSnapshot, rebindConversation, conversationSettings } from './appSyncData';
import { downloadEntity, uploadSync } from './appTransfers';
import { outboxSyncSource,sameOutboxSource } from './appOutbox';
import { stageSyncBatch } from './appSyncStage';
import { acknowledgeBranch } from './appSyncBranch';
import { storageStep } from './segmentedStorage';

type Batch=StoredOutbox&{revisions:Record<string,number>;withdrawn?:boolean|0;receipt?:{changes:Ack[]}};
type Ack={id:string;source_id?:string;revision:number;deleted:boolean;branched?:boolean;lineage?:Record<string,unknown>};
export type SyncState={phase:'off'|'syncing'|'saved'|'error';pending:number;error:string};
let state:SyncState={phase:'off',pending:0,error:''};
const off:SyncState={phase:'off',pending:0,error:''};
let stateOwner='';
const listeners=new Set<()=>void>();
export const subscribeSync=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export const syncState=()=>stateOwner===deviceOwner()?state:off;
const report=(next:SyncState,owner=deviceOwner())=>{state=next;stateOwner=owner;listeners.forEach(fn=>fn());};
let flight:Promise<void>|null=null;
const key=(owner:string,suffix:string)=>`sync:${owner}:${suffix}`;

async function transferActive(owner:string,requestId?:string,expected?:StoredOutbox) {
  if(owner!==deviceOwner()||generationBusy())throw Error('Sync consent changed');
  if(!requestId){if(!await getMeta(key(owner,'consent')))throw Error('Sync consent changed');return;}
  await appTransaction<void>(['meta'],'readwrite',(tx,done)=>{
    const meta=tx.objectStore('meta'),consent=meta.get(key(owner,'consent'));
    const current=()=>owner===deviceOwner()&&!generationBusy()&&consent.result===true;
    consent.onsuccess=()=>{
      if(!current()){tx.abort();return;}
      const probe=meta.index('sync-outbox-state').openKeyCursor(IDBKeyRange.only([requestId,0]));
      probe.onsuccess=()=>{
        if(!current()){tx.abort();return;}
        if(probe.result){
          if(probe.result.primaryKey!==key(owner,'outbox')){probe.result.continue();return;}
          if(!expected?.changesParts){done();return;}
          const source=meta.get(key(owner,'outbox'));source.onsuccess=()=>{
            if(!current()||!sameOutboxSource(source.result,expected)){tx.abort();return;}done();
          };return;
        }
        const legacy=meta.get(key(owner,'outbox'));
        legacy.onsuccess=()=>{
          const pending=legacy.result as Batch|undefined;
          if(!current()||!pending||pending.request_id!==requestId||pending.withdrawn
            ||expected?.changesParts&&!sameOutboxSource(pending,expected)){tx.abort();return;}
          // A legacy boolean/missing flag is read once; numeric zero is an indexable false value.
          meta.put({...pending,withdrawn:0},key(owner,'outbox'));done();
        };
      };
    };
  });
}
async function rawRequest(owner:string,path:string,init?:RequestInit) {
  if(owner!==deviceOwner())throw Error('Account changed');
  const headers=new Headers(init?.headers);headers.set('X-Kyalulu-Owner',owner);
  const response=await cloudFetch('/api/cloud/app/sync'+path,{...init,headers,signal:AbortSignal.timeout(20000)});
  const body=await response.json();if(!response.ok)throw Error(body.error??`HTTP ${response.status}`);return body;
}
async function request(owner:string,path:string,init?:RequestInit) {
  const call=(suffix:string,options?:RequestInit)=>rawRequest(owner,suffix,options);
  const result=await rawRequest(owner,path.startsWith('?cursor=')?path+'&paged=1':path,init);
  if(Array.isArray(result.changes))for(let index=0;index<result.changes.length;index++){
    if(result.changes[index]?.payload_ref){
      const remote=result.changes[index],local=await entity(remote.id,owner);
      if(local&&local.kind===remote.kind&&!local.payload.cache_evicted&&Number.isSafeInteger(remote.revision)&&local.serverRevision>=remote.revision){result.changes.splice(index--,1);continue;}
    }
    result.changes[index]=await downloadEntity(result.changes[index],call,()=>transferActive(owner));
  }
  return result;
}
export type RuntimeConsent={revision:number;selected:string[];accepted:boolean};
export async function runtimeConsent(owner:string, update?:{revision:number;selected:string[];consent:boolean}):Promise<RuntimeConsent> {
  if(owner==='guest'||owner!==deviceOwner())throw Error('Login required');
  const response=await cloudFetch('/api/cloud/app/runtime-consent',{headers:{'Content-Type':'application/json','X-Kyalulu-Owner':owner},
    ...(update?{method:'PUT',body:JSON.stringify(update)}:{}),signal:AbortSignal.timeout(20000)});
  const value=await response.json();
  if(owner!==deviceOwner())throw Error('Account changed');
  if(!response.ok)throw Error(value.error??`HTTP ${response.status}`);
  if(!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.accepted!=='boolean'||!Array.isArray(value.selected)
    ||value.selected.some((id:unknown)=>typeof id!=='string'))throw Error('Invalid sync consent');
  return value;
}

export function acknowledgeEntity(local:AppEntity, ack:Ack, batch:Batch) {
  const source=ack.source_id??ack.id;
  const updated={...local,id:ack.id,serverRevision:ack.revision,dirty:local.revision!==batch.revisions[source]};
  if(ack.deleted)return {...updated,deleted:true,dirty:false,payload:{storage_policy:'sync',deleted_revision:ack.revision}};
  if(ack.branched)updated.payload={...rebindConversation(local.payload,ack.id),branch_of:source,fork_revision:batch.changes.find(c=>c.id===source)!.base_revision};
  if(ack.lineage)updated.payload={...updated.payload,lineage:ack.lineage};
  return updated;
}

function syncReceipt(batch:Batch,result:any):{changes:Ack[]} {
  if(!Array.isArray(result?.changes)||result.changes.length!==batch.changes.length
    ||new Set(result.changes.map((ack:any)=>ack?.source_id??ack?.id)).size!==batch.changes.length
    ||new Set(result.changes.map((ack:any)=>ack?.id)).size!==batch.changes.length)throw Error('Invalid sync acknowledgment');
  for(const ack of result.changes) {
    const source=ack?.source_id??ack?.id,sent=batch.changes.find(c=>c.id===source);
    if(!sent||!Number.isSafeInteger(ack?.revision)||ack.revision<1||typeof ack.id!=='string'||!ack.id||ack.id.length>200
      ||typeof ack.deleted!=='boolean'||ack.branched!==undefined&&typeof ack.branched!=='boolean'
      ||!ack.branched&&ack.id!==source||ack.branched&&(ack.deleted||sent.kind!=='conversation')||sent.deleted&&!ack.deleted)throw Error('Invalid sync acknowledgment');
  }
  return {changes:result.changes};
}

function selectSyncHeaders(tx:IDBTransaction,owner:string,required:Set<string>,
  finish:(records:Map<string,StoredEntity>,identities:Set<string>,number:number)=>void) {
  const sequence=tx.objectStore('meta').get('message-sequence:'+owner);
  sequence.onsuccess=()=>{
    const records=new Map<string,StoredEntity>(),identities=new Set<string>();let number=sequence.result??0;
    const read=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
    read.onsuccess=()=>{
      if(owner!==deviceOwner()||generationBusy()){tx.abort();return;}
      const cursor=read.result;
      if(!cursor){finish(records,identities,number);return;}
      const record=cursor.value as StoredEntity;
      identities.add(record.id);number=Math.max(number,entitySelection(record).maximumMessageId);
      if(required.has(record.id))records.set(record.id,record);cursor.continue();
    };
  };
}
function selectSyncRecords(tx:IDBTransaction,owner:string,required:Set<string>,
  finish:(records:Map<string,AppEntity>,identities:Set<string>,number:number)=>void) {
  selectSyncHeaders(tx,owner,required,(headers,identities,number)=>{
    const records=new Map<string,AppEntity>(),values=[...headers.values()];let index=0;
    const next=()=>{
      const header=values[index++];if(!header){finish(records,identities,number);return;}
      restoreEntity(tx,header,value=>{records.set(header.id,value!);next();});
    };next();
  });
}

export async function receiveSyncPage(owner:string, changes:any[], cursor:number) {
  if(changes.some(change=>change?.deleted)&&typeof navigator!=='undefined'&&navigator.locks){
    return navigator.locks.request(deviceExecutionLockName(owner),{ifAvailable:true},async lock=>{
      if(!lock)throw Error('Stop generation and confirm its saved result before receiving conversation deletions');
      return receiveSyncPageTransaction(owner,changes,cursor);
    });
  }
  return receiveSyncPageTransaction(owner,changes,cursor);
}
async function receiveSyncPageTransaction(owner:string,changes:any[],cursor:number) {
  await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner()&&!generationBusy());
    const meta=tx.objectStore('meta');
    const consent=meta.get(key(owner,'consent'));
    consent.onsuccess=()=>{
      if(owner!==deviceOwner()||!consent.result||generationBusy()){tx.abort();return;}
      const required=new Set<string>();
      try {
        for(const remote of changes){
          if(typeof remote?.id==='string')required.add(remote.id);
          if(remote?.kind!=='conversation'||remote.deleted||!remote.payload)continue;
          // Prefetch must not validate payloads that an unsent/newer local revision will skip.
          const payload=remote.payload,messages=Array.isArray(payload.messages)?payload.messages.filter((message:any)=>message&&typeof message==='object'):[];
          const settings=conversationSettings({settings:payload.settings,messages});
          for(const setting of [...settings,...messages.flatMap((message:any)=>[message.before?.state,message.after?.state].filter(Boolean))]){
            for(const kind of ['persona','world']){
              const reference=setting[kind+'_id'];
              if(typeof reference==='string'&&reference.startsWith('created_'))required.add(reference.split('@')[0]);
            }
          }
          for(const setting of settings)for(const [field,value] of Object.entries(setting.library_binding??{})){
            for(const ref of (field==='lorebooks'?(Array.isArray(value)?value:[]):[value]) as any[])if(typeof ref?.id==='string')required.add(ref.id);
          }
        }
      }catch{tx.abort();return;}
      selectSyncRecords(tx,owner,required,(records,identities,number)=>{
          try {
            const allocate=()=>{if(!Number.isSafeInteger(++number))throw Error('Message ID limit reached');return number;};
            for(const remote of changes) {
              if(!remote||typeof remote.id!=='string'||!remote.id||remote.id.length>200||!Number.isSafeInteger(remote.revision)||remote.revision<1
                ||typeof remote.deleted!=='boolean'||!['conversation','character','persona','world','preset','profile'].includes(remote.kind)
                ||!remote.payload||typeof remote.payload!=='object'||Array.isArray(remote.payload))throw Error('Invalid sync entity');
              const local=records.get(remote.id);
              if(local?.kind&&local.kind!==remote.kind)throw Error('Entity kind conflict');
              meta.put({revision:remote.revision,deleted:remote.deleted,count:remote.payload.messages?.length??0},key(owner,'remote:'+remote.id));
              if(local?.payload.storage_policy==='local'&&remote.kind==='conversation')throw Error('Device-only conversation conflict');
              if(remote.deleted) {
                if(local?.deleted&&local.serverRevision>=remote.revision)continue;
                if(local?.dirty&&!local.deleted) {
                  const id=crypto.randomUUID();if(identities.has(id)||records.has(id))throw Error('Recovery identity conflict');
                  const payload=local.kind==='conversation'?rebindConversation(receiveConversation(local.payload,undefined,allocate),id):structuredClone(local.payload);
                  payload.storage_policy='local';payload.recovery_from=local.id;payload.last_generation=null;
                  const recovery={...local,id,payload,revision:1,serverRevision:0,dirty:false,deleted:false};
                  copyMemoryEvents(tx,local,recovery);
                  records.set(id,recovery);writeEntity(tx,recovery);
                }
                const retired={...remote,owner,payload:{storage_policy:'sync',deleted_revision:remote.revision},
                  revision:(local?.revision??0)+1,serverRevision:remote.revision,dirty:false,pinned:false,opened:Date.now()};
                records.set(retired.id,retired);writeEntity(tx,retired);
                scrubGenerationRecords(tx,owner,remote.id);
                continue;
              }
              if(local?.dirty||local&&local.serverRevision>=remote.revision&&!local.payload.cache_evicted)continue;
              if(local&&remote.revision<local.serverRevision)throw Error('Stale hydration revision');
              let payload=remote.payload;
              if(!remote.deleted&&remote.kind==='conversation') {
                if(payload.storage_policy!=='sync')throw Error('Invalid storage policy');
                payload=rebindConversation(receiveConversation(payload,local?.payload,allocate),remote.id);
                const creators=new Set<string>(),libraries=new Set<string>();
                for(const settings of [...conversationSettings(payload),...(payload.messages??[]).flatMap((message:any)=>[message.before?.state,message.after?.state].filter(Boolean))]){
                  for(const kind of ['persona','world'] as const){
                    const reference=settings[kind+'_id'];
                    if(typeof reference!=='string'||!reference.startsWith('created_')||creators.has(kind+':'+reference))continue;
                    creators.add(kind+':'+reference);
                    const snapshot=payload.creator_snapshots?.[reference];
                    if(!snapshot||snapshot.kind!==kind)throw Error('Setting snapshot missing');
                    const id=reference.split('@')[0],setting=receiveCreatorSnapshot(records.get(id),owner,reference,kind,snapshot.document);
                    records.set(id,setting);writeEntity(tx,setting);
                  }
                }
                for(const settings of conversationSettings(payload)){
                  const binding=settings.library_binding??{};
                  for(const [field,value] of Object.entries(binding))for(const ref of (field==='lorebooks'?value:[value]) as any[]) {
                    if(!ref||typeof ref.id!=='string'||libraries.has(ref.id+'@'+ref.revision))continue;
                    libraries.add(ref.id+'@'+ref.revision);
                    const snapshot=payload.library_snapshots?.[ref.id+'@'+ref.revision];
                    if(!snapshot) {
                      if(!records.get(ref.id)?.payload.versions?.[String(ref.revision)])throw Error('Library snapshot missing');
                      continue;
                    }
                    const library=receiveLibrarySnapshot(records.get(ref.id),owner,ref.id,ref.revision,snapshot);
                    records.set(library.id,library);writeEntity(tx,library);
                  }
                }
              }
              if(!remote.deleted&&['character','preset'].includes(remote.kind)&&payload.versions) {
                if(local?.payload.storage_policy==='local'&&!local.payload.snapshot_only)throw Error('Device-only library conflict');
                for(const [revision,document] of Object.entries(payload.versions))receiveLibrarySnapshot(local,owner,remote.id,Number(revision),document);
                payload={...payload,versions:{...local?.payload.versions,...payload.versions},
                  current_revision:payload.current_revision??Math.max(...Object.keys(payload.versions).map(Number))};
              }
              const updated={...remote,owner,payload,revision:(local?.revision??0)+1,serverRevision:remote.revision,dirty:false,pinned:local?.pinned??false,opened:local?.opened??0};
              records.set(updated.id,updated);writeEntity(tx,updated);
            }
            meta.put(number,'message-sequence:'+owner);
            const position=meta.get(key(owner,'cursor'));position.onsuccess=()=>meta.put(Math.max(position.result??0,cursor),key(owner,'cursor'));done();
          }catch{tx.abort();}
      });
    };
  });
}
export async function setSyncConsent(owner:string,enabled:boolean) {
  if(owner==='guest'||owner!==deviceOwner())throw Error('Login required');
  const pending=await appTransaction<number>(['meta'],'readwrite',(tx,done)=>{
    const meta=tx.objectStore('meta'),read=meta.get(key(owner,'outbox'));
    read.onsuccess=()=>{
      if(owner!==deviceOwner()){tx.abort();return;}
      meta.put(enabled,key(owner,'consent'));
      if(!enabled&&read.result)meta.put({...read.result,withdrawn:true},key(owner,'outbox'));
      done(read.result?.changes.length??0);
    };
  });
  if(!enabled)report({phase:'off',pending,error:''},owner);
}
async function updateOutbox(owner:string,batch:Batch,next:Batch|null) {
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>{
    const meta=tx.objectStore('meta'),read=meta.get(key(owner,'outbox'));
    read.onsuccess=()=>{
      if(owner!==deviceOwner()||generationBusy()||read.result?.request_id!==batch.request_id){tx.abort();return;}
      if(next){meta.put({...read.result,withdrawn:next.withdrawn?true:0,...(next.receipt?{receipt:next.receipt}:{})},key(owner,'outbox'));done();}
      else writeOutbox(tx,owner,null,done);
    };
  });
}

async function synchronize(owner:string) {
  if(owner==='guest'||owner!==deviceOwner()||generationBusy())return;
  let batch=await getMeta<Batch>(key(owner,'outbox'));
  if(!await getMeta(key(owner,'consent'))) {
    if(!batch)return;
    if(!batch.withdrawn){await setSyncConsent(owner,false);batch={...batch,withdrawn:true};}
    if(batch.receipt){report({phase:'off',pending:batch.changes.length,error:''},owner);return;}
  }
  report({phase:'syncing',pending:0,error:''});
  try {
    const status=await cloudFetch('/api/mobile/status',{signal:AbortSignal.timeout(10000)});
    const identity=await status.json();
    if(!status.ok||!identity.cloud_mode||!identity.authenticated||identity.owner_scope!==owner)throw Error('Account verification required');
    const current=()=>{if(deviceOwner()!==owner||generationBusy())throw Error('Account or generation changed');};
    current();
    // Withdrawal only sends the request ID. Applied receipts wait locally until renewed consent.
    if(batch?.withdrawn&&!batch.receipt) {
      const result=await request(owner,'/cancel/'+encodeURIComponent(batch.request_id),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});current();
      if(result.state==='canceled'){await updateOutbox(owner,batch,null);batch=undefined;}
      else if(result.state==='applied'){
        const settled={...batch,receipt:syncReceipt(batch,result.result)};await updateOutbox(owner,batch,settled);batch=settled;
      }else throw Error('Invalid sync cancellation receipt');
    }
    if(!await getMeta(key(owner,'consent'))){report({phase:'off',pending:batch?.changes.length??0,error:''},owner);return;}
    let uploadBlocked='';
    const download=async()=>{
      uploadBlocked='';
      let more=true;
      while(more) {
        const cursor=await getMeta<number>(key(owner,'cursor'))??0;
        if(!await getMeta(key(owner,'consent')))return;
        const result=await request(owner,'?cursor='+cursor);current();
        if(!Array.isArray(result.changes)||!Number.isSafeInteger(result.cursor)||result.cursor<cursor)throw Error('Invalid sync cursor');
        await receiveSyncPage(owner,result.changes,result.cursor);
        if(result.upload_blocked)uploadBlocked=String(result.upload_blocked);
        more=result.has_more===true;
        if(more&&result.cursor===cursor)throw Error('Sync cursor did not advance');
      }
    };
    await download();current();
    batch=await getMeta<Batch>(key(owner,'outbox'));
    if(!batch)batch=await stageSyncBatch(owner);
    if(batch) {
      if(!await getMeta(key(owner,'consent')))return;
      current();
      report({phase:'syncing',pending:batch.changes.length,error:''});
      if(batch.withdrawn&&!batch.receipt)throw Error('Sync cancellation pending');
      const fixedBatch=batch,source=batch.changesParts?outboxSyncSource(owner,batch):undefined;
      if(batch.receipt&&source)for await(const _ of source.chunks()){current();}
      const result=syncReceipt(batch,batch.receipt??await uploadSync(source??{request_id:batch.request_id,changes:batch.changes},
        (path,init)=>rawRequest(owner,path,init),()=>transferActive(owner,batch!.request_id,fixedBatch)));current();
      const pending=batch;
      const deleted=result.changes.filter((ack:Ack)=>ack.deleted).map((ack:Ack)=>({id:ack.source_id??ack.id,revision:ack.revision,kind:pending.changes.find(c=>c.id===(ack.source_id??ack.id))?.kind,deleted:true,payload:{}}));
      if(deleted.length)await receiveSyncPage(owner,deleted,await getMeta<number>(key(owner,'cursor'))??0);
      await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
        guardStorage(tx,()=>owner===deviceOwner()&&!generationBusy());
        const meta=tx.objectStore('meta'),queued=meta.get(key(owner,'outbox')),consent=meta.get(key(owner,'consent'));
        consent.onsuccess=()=>{
          if(consent.result!==true||owner!==deviceOwner()||generationBusy()||queued.result?.request_id!==pending.request_id
            ||!sameOutboxSource(queued.result,fixedBatch)){tx.abort();return;}
          const required=new Set<string>(result.changes.map((ack:Ack)=>ack.source_id??ack.id));
          selectSyncHeaders(tx,owner,required,(records,identities,number)=>{
            let index=0;
            const next=()=>{
              try {
                const ack=(result.changes as Ack[])[index++];
                if(!ack){
                  const consent=meta.get(key(owner,'consent')),queued=meta.get(key(owner,'outbox'));
                  queued.onsuccess=()=>storageStep(tx,()=>{
                    if(consent.result!==true||queued.result?.request_id!==pending.request_id
                      ||!sameOutboxSource(queued.result,fixedBatch))throw Error('Sync consent or fixed outbox changed');
                    meta.put(number,'message-sequence:'+owner);
                    if(result.changes.some((ack:Ack)=>ack.branched))meta.put(0,key(owner,'cursor'));
                    writeOutbox(tx,owner,null,done);
                  });return;
                }
                const source=ack.source_id??ack.id;
                const header=records.get(source);if(!header)throw Error('Missing local conversation');
                if(!ack.branched&&!ack.deleted&&header.kind==='conversation'&&!header.deleted){
                  acknowledgeConversation(tx,header,ack.revision,header.revision!==pending.revisions[source],ack.lineage,next);return;
                }
                if(ack.branched){
                  if(identities.has(ack.id)||records.has(ack.id))throw Error('Branch identity conflict');
                  if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid message sequence');
                  acknowledgeBranch(tx,header,ack,pending,()=>++number,target=>{records.set(target.id,target);next();});return;
                }
                restoreEntity(tx,header,local=>{
                  try{
                    if(!local)throw Error('Missing local conversation');
                    const updated=acknowledgeEntity(local,ack,pending);
                    records.set(updated.id,updated);writeEntity(tx,updated,'put',next);
                  }catch{tx.abort();}
                });
              }catch{tx.abort();}
            };next();
          });
        };
      });
    }
    await download();
    await trimOfflineCache(owner);
    if(!await getMeta(key(owner,'consent'))){
      report({phase:'off',pending:(await getMeta<Batch>(key(owner,'outbox')))?.changes.length??0,error:''},owner);return;
    }
    if(uploadBlocked)throw Error(uploadBlocked);
    const pending=await appTransaction<number>(['entities'],'readonly',(tx,done)=>{
      let count=0;
      const read=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
      read.onsuccess=()=>{
        if(owner!==deviceOwner()||generationBusy()){tx.abort();return;}
        const cursor=read.result;
        if(!cursor){done(count);return;}
        if((cursor.value as AppEntity).dirty)count++;
        cursor.continue();
      };
    });
    const enabled=await getMeta(key(owner,'consent'));
    const queued=enabled?undefined:await getMeta<Batch>(key(owner,'outbox'));
    current();report({phase:enabled?'saved':'off',pending:enabled?pending:queued?.changes.length??0,error:''},owner);
  }catch(e){
    const enabled=await getMeta(key(owner,'consent')).catch(()=>true);
    report(enabled?{phase:'error',pending:state.pending,error:String(e)}:{phase:'off',pending:batch?.changes.length??0,error:String(e)},owner);
  }
}
export function syncNow(owner=deviceOwner()) {
  if(!navigator.locks){report({phase:'error',pending:0,error:'Web Locks are required for safe synchronization'});return Promise.resolve();}
  if(!flight)flight=navigator.locks.request<void>('kyalulu-sync:'+owner,()=>synchronize(owner)).finally(()=>{flight=null;});return flight;
}
export async function hydrateConversation(id:string,owner=deviceOwner()) {
  if(owner==='guest'||owner!==deviceOwner()||!await getMeta(key(owner,'consent')))throw Error('Connect and enable sync to reopen this conversation / 接続して同期を有効にすると、この会話を再取得できます');
  const response=await cloudFetch('/api/cloud/app/entities/'+encodeURIComponent(id)+'?paged=1',{headers:{'X-Kyalulu-Owner':owner},signal:AbortSignal.timeout(20000)});
  let remote=await response.json();
  if(!response.ok)throw Error(remote.error??`HTTP ${response.status}`);
  if(remote.id!==id||remote.kind!=='conversation')throw Error('Invalid hydration identity');
  remote=await downloadEntity(remote,(path,init)=>rawRequest(owner,path,init),()=>transferActive(owner));
  await receiveSyncPage(owner,[remote],await getMeta<number>(key(owner,'cursor'))??0);
  const result=await entity(id,owner);
  if(owner!==deviceOwner()||!result||result.payload.cache_evicted)throw Error('Conversation could not be loaded');
  return result;
}
export async function reconfirmDeletion(owner:string,id:string,localRevision:number,serverRevision:number) {
  if(owner!==deviceOwner()||owner==='guest'||generationBusy())throw Error('Account or generation changed');
  await appTransaction<void>(['entities','meta'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner()&&!generationBusy());
    const meta=tx.objectStore('meta');
    readEntity(tx,owner,id,value=>{
      const remote=meta.get(key(owner,'remote:'+id));
      remote.onsuccess=()=>{
        if(owner!==deviceOwner()||!value?.deleted||!value.dirty||value.revision!==localRevision
          ||remote.result?.revision!==serverRevision||remote.result.deleted){tx.abort();return;}
        const outbox=meta.get(key(owner,'outbox')),consent=meta.get(key(owner,'consent'));
        consent.onsuccess=()=>{
          if(!consent.result||outbox.result?.withdrawn||outbox.result&&(outbox.result.changes.length!==1||outbox.result.changes[0].id!==id)){tx.abort();return;}
          const revision=value.revision+1;
          writeEntity(tx,{...value,revision,serverRevision,payload:{...value.payload,delete_confirmation_revision:revision}});
          writeOutbox(tx,owner,{request_id:crypto.randomUUID(),withdrawn:0,revisions:{[id]:revision},changes:[{id,kind:value.kind,base_revision:serverRevision,
            payload:{},deleted:true,delete_confirmed:true}]} as Batch,done);
        };
      };
    });
  });
}
