import type { MemorySource } from './deviceMemoryStore';
import type { compilePortable } from './devicePrompt';
import type { StoredEntity } from './appStore';
import { deviceOwner } from './appContext';
import { jsonChunks } from './appTransfers';
import { JsonStream } from './jsonStream';
import { readParts, streamParts, storageStep, type Parts } from './segmentedStorage';

export type ConversationGenerationInput = {
  format:'conversation-input@1';
  source:Pick<MemorySource,'id'|'owner'|'revision'|'bodyToken'>;
  contract:string;
  ordered:ReturnType<typeof compilePortable>['ordered_messages'];
  regenerate?:number;
};
export type GenerationInput = readonly unknown[] | ConversationGenerationInput;

/** A callback sees tentative rows; its result may be used only after verified EOF/transaction completion. */
export function readPinnedGenerationSource(tx:IDBTransaction,source:ConversationGenerationInput['source'],visit:((message:any)=>void)|undefined,done:()=>void) {
  storageStep(tx,()=>{
    if(!source||source.owner!==deviceOwner()||typeof source.id!=='string'||!source.id
      ||!Number.isSafeInteger(source.revision)||source.revision<0||source.bodyToken===undefined)throw Error('Invalid generation input source');
    const {owner,id}=source,read=tx.objectStore('entities').get([owner,id]);
    read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result as StoredEntity|undefined;
      if(!header||header.owner!==owner||header.id!==id||header.kind!=='conversation'||header.deleted
        ||header.revision!==source.revision||(header.payloadParts?.token??null)!==source.bodyToken)throw Error('Generation input source changed');
      const complete=(payload:any)=>{if(!payload||!Array.isArray(payload.messages))throw Error('Invalid generation input history');done();};
      if(header.payloadParts)readParts(tx,[owner,'entity',id],header.payloadParts,complete,new JsonStream(visit?{onMessage:visit}:{limit:0}));
      else {for(const message of header.payload?.messages??[])visit?.(message);complete(header.payload);}
    });
  });
}

export function visitConversationGenerationInput(tx:IDBTransaction,owner:string,id:string,input:ConversationGenerationInput,
  visit:(message:{role:string;content:string})=>void,done:()=>void) {
  storageStep(tx,()=>{
    if(input.format!=='conversation-input@1'||input.source?.owner!==owner||input.source.id!==id||owner!==deviceOwner()
      ||typeof input.contract!=='string'||!Array.isArray(input.ordered)
      ||input.regenerate!==undefined&&(!Number.isSafeInteger(input.regenerate)||input.regenerate<1))throw Error('Invalid generation input source');
    let index=0,verified=false;
    const history=(finish:()=>void,onMessage?:(message:any)=>void)=>readPinnedGenerationSource(tx,input.source,onMessage,()=>{verified=true;finish();});
    visit({role:'system',content:input.contract});
    const next=()=>storageStep(tx,()=>{
      while(index<input.ordered.length){
        const part=input.ordered[index++];
        if(!part||typeof part.role!=='string'||typeof part.content!=='string')throw Error('Invalid generation input part');
        if(part.slot==='history'){
          history(next,message=>{
            if(input.regenerate!==undefined&&message?.id===input.regenerate||['stopped','interrupted'].includes(message?.imported_state))return;
            if(message?.role==='user'||message?.role==='assistant'){
              if(typeof message.content!=='string')throw Error('Invalid generation input message');
              visit({role:message.role,content:message.content});
            }
          });return;
        }
        visit({role:part.role,content:part.content});
      }
      if(verified)done();else history(done);
    });next();
  });
}

/** Replay the complete pre-fit prompt into tentative parts in the source/receipt transaction. */
export function writeConversationGenerationInput(tx:IDBTransaction,owner:string,id:string,input:ConversationGenerationInput,
  location:readonly [string,string,string],done:(ref:Parts)=>void) {
  storageStep(tx,()=>{
    const writer=streamParts(tx,location),encoder=new TextEncoder();let count=0;
    writer.append(encoder.encode('['));
    visitConversationGenerationInput(tx,owner,id,input,message=>{
      if(count++)writer.append(encoder.encode(','));for(const chunk of jsonChunks(message))writer.append(chunk);
    },()=>{writer.append(encoder.encode(']'));writer.finish(done);});
  });
}
