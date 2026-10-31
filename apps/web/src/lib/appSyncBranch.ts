import { conversationPartsHeader,copyMemoryEvents,type AppEntity,type StoredEntity,type StoredOutbox } from './appStore';
import { conversationBinder,conversationReceiver,canonical } from './appSyncData';
import { deviceOwner,generationBusy } from './appContext';
import { memoryDomainKey } from './deviceMemoryScopes';
import { readParts,storageStep,storageWrite,streamParts,type ConversationScan } from './segmentedStorage';
import { JsonStream } from './jsonStream';
import { jsonChunks } from './appTransfers';

type Batch=StoredOutbox&{revisions:Record<string,number>};
type Ack={id:string;revision:number;source_id?:string;lineage?:Record<string,unknown>};
type Reader=(message:(value:any,index:number)=>void,done:(metadata:Record<string,any>,count:number|undefined)=>void)=>void;
const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value);
const memoryIds=(items:any,map:Map<unknown,unknown>)=>{
  if(items==null)return;if(!Array.isArray(items))throw Error('Invalid memory history');
  for(const memory of items){if(!object(memory))throw Error('Invalid memory history');map.set(memory.id,memory.uuid??memory.id);}
};

/** Called inside acknowledgment's guarded transaction; no source history or outbox is replaced. */
export function acknowledgeBranch(tx:IDBTransaction,header:StoredEntity,ack:Ack,batch:Batch,allocate:()=>number,done:(target:StoredEntity)=>void) {
  storageWrite(tx,next=>{
    const owner=header.owner,meta=tx.objectStore('meta'),local=meta.get(memoryDomainKey(owner,'local')),sync=meta.get(memoryDomainKey(owner,'sync'));
    const sentIndex=batch.changes.findIndex(change=>change.id===(ack.source_id??ack.id)),sent=batch.changes[sentIndex];
    const current:Reader=(message,finish)=>{
      if(header.payloadParts){
        const parser=new JsonStream({onMessage:message});
        readParts(tx,[owner,'entity',header.id],header.payloadParts,value=>{
          if(!object(value))throw Error('Invalid conversation body');finish(value,parser.totalMessages);
        },parser);
      }else{
        const p=header.payload;if(!object(p))throw Error('Missing conversation body');
        if(Array.isArray(p!.messages))p!.messages.forEach((value:any,index:number)=>message(structuredClone(value),index));
        finish(structuredClone({...p,...(Array.isArray(p!.messages)?{messages:[]}:{})}),Array.isArray(p!.messages)?p!.messages.length:undefined);
      }
    };
    const frozen:Reader=(message,finish)=>{
      if(!batch.changesParts){
        const p=sent.payload;if(!object(p)||!Array.isArray(p.messages))throw Error('Invalid sent conversation');
        p.messages.forEach((value:any,index:number)=>message(structuredClone(value),index));finish(structuredClone({...p,messages:[]}),p.messages.length);return;
      }
      const parser=new JsonStream({outboxChange:{index:sentIndex,onMessage:message}});
      readParts(tx,[owner,'outbox','fixed'],batch.changesParts,changes=>{
        if(!Array.isArray(changes)||changes.length!==batch.changes.length||batch.count!==changes.length
          ||canonical(changes.map(({payload,...control})=>({...control,payload:{}})))!==canonical(batch.changes.map(({payload,...control})=>({...control,payload:{}}))))throw Error('Fixed outbox controls changed');
        const p=changes[sentIndex]?.payload;
        if(!object(p))throw Error('Invalid sent conversation');finish(p,parser.totalMessages);
      },parser);
    };
    sync.onsuccess=()=>storageStep(tx,()=>{
      if(owner!==deviceOwner()||generationBusy()||header.kind!=='conversation'||ack.id===header.id||!sent||sent.kind!==header.kind
        ||local.result?.pending||sync.result?.pending)throw Error('Conversation acknowledgment changed');
      const originalIds=new Map<unknown,unknown>(),historicalIds=new Map<unknown,unknown>(),identities:{id:number;uuid:string}[]=[];let sourceMetadata:Record<string,any>;
      // A deleted source keeps its current event mapping; the branch body comes from its frozen send.
      const read=header.deleted?frozen:current;
      const collectSource=(message:any)=>{
        for(const point of ['before','after'])memoryIds(message?.[point]?.memories,historicalIds);
        if(!header.deleted)identities.push({id:message?.id,uuid:message?.uuid});
      };
      const sourceReady=(metadata:Record<string,any>,count:number|undefined)=>{
        sourceMetadata=metadata;memoryIds(metadata.memories,originalIds);for(const [id,uuid] of historicalIds)originalIds.set(id,uuid);
        const branch=(p:Record<string,any>,count:number|undefined)=>{
          if(!Array.isArray(p.messages)||count===undefined||count!==identities.length)throw Error('Invalid conversation body');
          const metadata=structuredClone(p),firstBind=conversationBinder(metadata,ack.id);
          firstBind(metadata);metadata.branch_of=header.id;metadata.fork_revision=sent.base_revision;if(ack.lineage)metadata.lineage=ack.lineage;
          const receive=conversationReceiver(metadata,identities,undefined,allocate),lastBind=conversationBinder(metadata,ack.id);
          lastBind(metadata);metadata.last_generation=null;
          const target={...header,id:ack.id,serverRevision:ack.revision,deleted:false,dirty:header.deleted?false:header.revision!==batch.revisions[header.id]};
          const targetIds=new Map<unknown,string>(),output=streamParts(tx,[owner,'entity',ack.id]),encoder=new TextEncoder();
          const text=(value:string)=>output.append(encoder.encode(value)),value=(item:unknown)=>{for(const bytes of jsonChunks(item))output.append(bytes);};
          const collectTarget=(items:any)=>{for(const memory of items??[])targetIds.set(memory.uuid??memory.id,memory.id);};
          collectTarget(metadata.memories);
          const scan:ConversationScan={count:0,maximumMessageId:0,messageIdsValid:true,last_preview:'',last_at:null};
          text('{"messages":[');
          read((message,index)=>{
            firstBind(message?.before);firstBind(message?.after);receive(message,index);lastBind(message?.before);lastBind(message?.after);
            for(const point of ['before','after'])collectTarget(message?.[point]?.memories);
            if(scan.count++)text(',');value(message);scan.maximumMessageId=Math.max(scan.maximumMessageId,message.id);
            scan.last_preview=message.content.slice(0,160);scan.last_at=message.created_at??null;
          },(verified,total)=>{
            if(total!==identities.length||scan.count!==identities.length||canonical(verified)!==canonical(p))throw Error('Conversation source changed');
            const {messages:_,...rest}=metadata;text(']');
            for(const [key,item] of Object.entries(rest)){text(','+JSON.stringify(key)+':');value(item);}text('}');
            output.finish(ref=>{
              const saved=conversationPartsHeader(target,ref,metadata,scan),write=tx.objectStore('entities').add(saved);
              write.onsuccess=()=>storageStep(tx,()=>{
                const ids=new Map([...originalIds].map(([id,uuid])=>[id,targetIds.get(uuid)]));
                const events=()=>copyMemoryEvents(tx,{...header,payload:sourceMetadata} as AppEntity,{...saved,payload:metadata} as AppEntity,ids,()=>{done(saved);next();});
                if(header.deleted){events();return;}
                const keep=tx.objectStore('entities').put({...header,dirty:false});keep.onsuccess=()=>storageStep(tx,events);
              });
            });
          });
        };
        if(header.deleted)read(message=>identities.push({id:message?.id,uuid:message?.uuid}),branch);else branch(metadata,count);
      };
      current(collectSource,sourceReady);
    });
  });
}
