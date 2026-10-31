import { appTransaction,conversationPartsHeader,type AppEntity,type StoredEntity } from './appStore';
import { deviceOwner,generationBusy } from './appContext';
import { canonical,conversationBinder,conversationReceiver,type SnapshotReferences } from './appSyncData';
import { downloadEntity,downloadEntityChunks,jsonChunks } from './appTransfers';
import { readParts,removeParts,storageStep,storageWrite,streamParts,guardStorage,validParts,type Parts,type ConversationScan } from './segmentedStorage';
import { memoryDomainKey } from './deviceMemoryScopes';
import { JsonStream } from './jsonStream';

type Call=(path:string,init?:RequestInit)=>Promise<any>;
type Manifest={purpose:string;owner:string;ref:Parts;received:number;ready:boolean};
type Incoming={owner:string;ref:Parts;manifest:Manifest;identities:{id:number;uuid:string}[];history:SnapshotReferences;count:number|undefined;signature:string};
const purpose='sync-incoming-v1',incoming=new WeakMap<object,Incoming>();
const prefix=(owner:string)=>'sync-incoming:'+JSON.stringify(owner)+':';
const key=(owner:string,token:string)=>prefix(owner)+token;
const location=(owner:string,token:string)=>[owner,'incoming',token] as const;

const reference=(value:any)=>({id:typeof value?.id==='string'?value.id:undefined,revision:typeof value?.revision==='number'?value.revision:NaN});
const creatorRefs=(value:any)=>({persona_id:typeof value.persona_id==='string'?value.persona_id:undefined,world_id:typeof value.world_id==='string'?value.world_id:undefined});
/** Only snapshot reference fields survive; other historical settings stay transient. */
function references(history:SnapshotReferences,message:any) {
  for(const point of ['before','after']){
    const snapshot=message?.[point];
    if(snapshot?.settings){
      const s=snapshot.settings,binding=s.library_binding;
      history.settings.push({...creatorRefs(s),library_binding:binding&&typeof binding==='object'?Object.fromEntries(Object.entries(binding).map(([field,value])=>
        [field,field==='lorebooks'?(Array.isArray(value)?value.map(reference):[]):reference(value)])):undefined});
    }
    if(snapshot?.state)history.states.push(creatorRefs(snapshot.state));
  }
}

export async function clearIncoming(owner:string) {
  await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>{
    const meta=tx.objectStore('meta'),start=prefix(owner),read=meta.openCursor(IDBKeyRange.bound(start,start+'\uffff'));
    read.onsuccess=()=>storageStep(tx,()=>{
      const cursor=read.result;if(!cursor){done();return;}
      const value=cursor.value as Manifest,token=String(cursor.key).slice(start.length);
      if(value?.purpose!==purpose||value.owner!==owner||!validParts(value.ref)||value.ref.size>1_000_000_000||value.ref.token!==token){cursor.continue();return;}
      removeParts(tx,location(owner,token),value.ref,()=>{
        const erase=meta.delete(cursor.key);erase.onsuccess=()=>storageStep(tx,()=>cursor.continue());
      });
    });
  });
}

/** All network receive callers share this owner lock; abandoned incoming bytes are disposable, never authored data. */
export async function withIncoming<T>(owner:string,run:()=>Promise<T>):Promise<T> {
  if(!navigator.locks)throw Error('Web Locks are required for safe synchronization');
  return navigator.locks.request('kyalulu-sync:'+owner,async()=>{
    try{await clearIncoming(owner);return await run();}finally{await clearIncoming(owner);}
  });
}

function stageWrite(owner:string,previous:Manifest|undefined,next:Manifest,bytes?:Uint8Array) {
  return appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner()&&!generationBusy());
    const meta=tx.objectStore('meta'),name=key(owner,next.ref.token),read=meta.get(name),consent=meta.get('sync:'+owner+':consent');
    consent.onsuccess=()=>storageStep(tx,()=>{
      if(consent.result!==true||canonical(read.result)!==canonical(previous))throw Error('Incoming transfer changed');
      if(bytes)tx.objectStore('parts').add(bytes,[...location(owner,next.ref.token),next.ref.token,previous!.received]);
      const write=previous?meta.put(next,name):meta.add(next,name);write.onsuccess=()=>storageStep(tx,done);
    });
  });
}

export function incomingSource(value:any,owner:string) {
  const source=value&&typeof value==='object'?incoming.get(value):undefined;
  if(source&&source.owner!==owner)throw Error('Incoming transfer owner changed');return source;
}

export async function downloadIncoming(owner:string,remote:any,call:Call,active:()=>Promise<void>) {
  if(remote?.kind!=='conversation'||remote.deleted||!remote.payload_ref)return downloadEntity(remote,call,active);
  const {payload:_,...descriptor}=remote,wire=structuredClone(descriptor);
  const identities:{id:number;uuid:string}[]=[],history:SnapshotReferences={settings:[],states:[]};
  const parser=new JsonStream({onMessage:(message:any)=>{
    identities.push({id:typeof message?.id==='number'?message.id:NaN,uuid:typeof message?.uuid==='string'?message.uuid:''});references(history,message);
  }});
  let manifest:Manifest|undefined;
  for await(const bytes of downloadEntityChunks(wire,call,active)){
    // The generator validates the reference and first part before any durable stage is allocated.
    if(!manifest){
      const ref={token:crypto.randomUUID(),size:wire.payload_ref.size,chunks:wire.payload_ref.chunks,sha256:wire.payload_ref.sha256};
      manifest={purpose,owner,ref,received:0,ready:false};await stageWrite(owner,undefined,manifest);
    }
    parser.feed(bytes);
    const next={...manifest,received:manifest.received+1};await stageWrite(owner,manifest,next,bytes);manifest=next;
  }
  const payload=parser.finish();
  if(!manifest||!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid transfer payload');
  await active();const ready={...manifest,ready:true};await stageWrite(owner,manifest,ready);
  const {payload_ref:__,...header}=wire,result={...header,payload};
  incoming.set(result,{owner,ref:ready.ref,manifest:ready,identities,history,count:parser.totalMessages,signature:canonical(result)});return result;
}

/** Source completion, snapshot validation and the new body/header all belong to the caller's guarded transaction. */
export function receiveIncoming(tx:IDBTransaction,owner:string,remote:any,local:AppEntity|undefined,allocate:()=>number,
  snapshots:(payload:Record<string,any>,history:SnapshotReferences)=>void,done:(value:AppEntity)=>void) {
  storageWrite(tx,next=>{
    const source=incomingSource(remote,owner);if(!source)throw Error('Missing incoming transfer');
    const meta=tx.objectStore('meta'),pendingLocal=meta.get(memoryDomainKey(owner,'local')),pendingSync=meta.get(memoryDomainKey(owner,'sync'));
    const staged=meta.get(key(owner,source.ref.token)),consent=meta.get('sync:'+owner+':consent');
    consent.onsuccess=()=>storageStep(tx,()=>{
      if(owner!==deviceOwner()||generationBusy()||consent.result!==true||pendingLocal.result?.pending||pendingSync.result?.pending
        ||remote.kind!=='conversation'||remote.deleted||canonical(staged.result)!==canonical(source.manifest)||!source.manifest.ready
        ||canonical(remote)!==source.signature||!Array.isArray(remote.payload.messages)||source.count!==source.identities.length)throw Error('Incoming transfer changed');
      const metadata=structuredClone(remote.payload),receive=conversationReceiver(metadata,source.identities,local?.payload,allocate),bind=conversationBinder(metadata,remote.id);
      bind(metadata);
      const history:SnapshotReferences={settings:[],states:[]},messages:{id:number;uuid:string}[]=[],output=streamParts(tx,[owner,'entity',remote.id]),encoder=new TextEncoder();
      const text=(value:string)=>output.append(encoder.encode(value)),value=(item:unknown)=>{for(const bytes of jsonChunks(item))output.append(bytes);};
      const scan:ConversationScan={count:0,maximumMessageId:0,messageIdsValid:true,last_preview:'',last_at:null};text('{"messages":[');
      const parser=new JsonStream({onMessage:(message:any,index)=>{
        receive(message,index);bind(message.before);bind(message.after);references(history,message);messages.push({id:message.id,uuid:message.uuid});
        if(scan.count++)text(',');value(message);scan.maximumMessageId=Math.max(scan.maximumMessageId,message.id);
        scan.last_preview=message.content.slice(0,160);scan.last_at=message.created_at??null;
      }});
      readParts(tx,location(owner,source.ref.token),source.ref,verified=>{
        if(parser.totalMessages!==source.count||scan.count!==source.count||canonical(verified)!==canonical(remote.payload)||canonical(remote)!==source.signature)throw Error('Incoming transfer changed');
        const {messages:_,...rest}=metadata;text(']');for(const [name,item] of Object.entries(rest)){text(','+JSON.stringify(name)+':');value(item);}text('}');
        output.finish(ref=>{
          snapshots(metadata,history);
          const target={...remote,owner,revision:(local?.revision??0)+1,serverRevision:remote.revision,dirty:false,pinned:local?.pinned??false,opened:local?.opened??0};
          const store=tx.objectStore('entities'),prior=store.get([owner,remote.id]);
          prior.onsuccess=()=>storageStep(tx,()=>{
            const previous=prior.result as StoredEntity|undefined;
            if((previous?.revision??0)!==(local?.revision??0)||previous&&previous.kind!==remote.kind)throw Error('Incoming destination changed');
            const save=()=>{
              const staged=meta.get(key(owner,source.ref.token)),pendingLocal=meta.get(memoryDomainKey(owner,'local')),pendingSync=meta.get(memoryDomainKey(owner,'sync')),consent=meta.get('sync:'+owner+':consent');
              consent.onsuccess=()=>storageStep(tx,()=>{
                if(consent.result!==true||pendingLocal.result?.pending||pendingSync.result?.pending||canonical(staged.result)!==canonical(source.manifest)||canonical(remote)!==source.signature)throw Error('Incoming transfer changed');
                const write=store.put(conversationPartsHeader({...target,selection:undefined,payload:metadata},ref,metadata,scan));
                write.onsuccess=()=>removeParts(tx,[owner,'entity',remote.id],previous?.payloadParts,()=>{done({...target,payload:{...metadata,messages}});next();});
              });
            };
            if(previous?.payloadParts)readParts(tx,[owner,'entity',remote.id],previous.payloadParts,save,false);else save();
          });
        });
      },parser);
    });
  });
}
