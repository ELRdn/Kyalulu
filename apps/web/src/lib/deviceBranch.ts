import { appTransaction,conversationInfo,trimOfflineCache,entitySelection,writeConversationCopy,guardStorage,type StoredEntity } from './appStore';
import { hydrateConversation } from './appSync';
import { readMemorySource } from './deviceMemoryStore';
import { conversationReceiver,conversationBinder } from './appSyncData';
import { deviceOwner } from './appContext';
import { storageStep } from './segmentedStorage';

const fail=(message:string,status=400)=>Object.assign(Error(message),{status});

/** The caller holds the owner's execution lease; histories never leave their selected store. */
export async function branchDeviceConversation(sourceId:string,messageId:unknown,owner:string) {
  const info=await conversationInfo(sourceId,owner);
  if(info?.deleted)throw fail('Conversation deleted',404);
  if(info?.selection.cache_evicted){await hydrateConversation(sourceId,owner);await trimOfflineCache(owner,sourceId);}
  const identity:{id:number;uuid:string}[]=[];
  let found=false,next=false,snapshot:any,lastAfter:any;
  const source=await readMemorySource(sourceId,owner,message=>{
    if(next){snapshot=message?.before??snapshot;next=false;}
    if(!found){
      identity.push({id:message?.id,uuid:message?.uuid});
      if(message?.id===messageId){
        found=true;snapshot=message.role==='assistant'?message.after:lastAfter;next=message.role!=='assistant';
      }else if(message?.after)lastAfter=message.after;
    }
  });
  if(!source||!found)throw fail('Branch point not found');
  if(source.metadata.cache_evicted)throw fail('Conversation unavailable',503);
  if(!snapshot)throw fail('Historical state is unavailable for branching',409);
  const id=crypto.randomUUID(),metadata=structuredClone(source.metadata),included=new Set(identity.map(message=>message.id));
  metadata.memories=structuredClone(snapshot.memories??[]);metadata.state=structuredClone(snapshot.state);
  if(snapshot.settings)metadata.settings=structuredClone(snapshot.settings);
  metadata.summaries=metadata.summaries.filter((summary:any)=>summary.source_message_ids?.every((mid:number)=>included.has(mid)));
  metadata.branch_of=source.id;metadata.fork_revision=source.revision;metadata.last_generation=null;
  metadata.settings.session_id=id;metadata.state.session_id=id;metadata.state.turn=snapshot.state.turn??0;
  return appTransaction<string>(['entities','meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const store=tx.objectStore('entities'),meta=tx.objectStore('meta'),read=store.get([owner,source.id]);
    read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result as StoredEntity|undefined;
      if(!header||header.deleted||header.kind!=='conversation'||header.owner!==owner||header.revision!==source.revision
        ||(header.payloadParts?.token??null)!==source.bodyToken)throw Error('Branch source changed');
      const sequence=meta.get('message-sequence:'+owner);
      sequence.onsuccess=()=>storageStep(tx,()=>{
        let number=sequence.result??0;
        if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid message sequence');
        const scan=store.openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
        scan.onsuccess=()=>storageStep(tx,()=>{
          const cursor=scan.result;
          if(cursor){
            const current=cursor.value as StoredEntity;
            if(current.kind==='conversation'){
              const maximum=entitySelection(current).maximumMessageId;
              if(!Number.isSafeInteger(maximum)||maximum<0)throw Error('Invalid message sequence');number=Math.max(number,maximum);
            }
            cursor.continue();return;
          }
          const receive=conversationReceiver(metadata,identity,undefined,()=>++number),bind=conversationBinder(metadata,id);
          bind(metadata);let index=0;
          writeConversationCopy(tx,header,id,metadata,message=>{
            if(index>=identity.length)return null;
            const copy=receive(message,index++);bind(copy.before);bind(copy.after);return copy;
          },()=>{meta.put(number,'message-sequence:'+owner);done(id);});
        });
      });
    });
  });
}
