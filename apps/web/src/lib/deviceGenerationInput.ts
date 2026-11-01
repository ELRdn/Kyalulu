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

/** Replay the complete pre-fit prompt into tentative parts in the source/receipt transaction. */
export function writeConversationGenerationInput(tx:IDBTransaction,owner:string,id:string,input:ConversationGenerationInput,
  location:readonly [string,string,string],done:(ref:Parts)=>void) {
  storageStep(tx,()=>{
    const source=input.source;
    if(input.format!=='conversation-input@1'||!source||source.owner!==owner||source.id!==id||owner!==deviceOwner()
      ||!Number.isSafeInteger(source.revision)||source.revision<0||source.bodyToken===undefined
      ||typeof input.contract!=='string'||!Array.isArray(input.ordered)
      ||input.regenerate!==undefined&&(!Number.isSafeInteger(input.regenerate)||input.regenerate<1))throw Error('Invalid generation input source');
    const read=tx.objectStore('entities').get([owner,id]);
    read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result as StoredEntity|undefined;
      if(!header||header.owner!==owner||header.id!==id||header.kind!=='conversation'||header.deleted
        ||header.revision!==source.revision||(header.payloadParts?.token??null)!==source.bodyToken)throw Error('Generation input source changed');
      const writer=streamParts(tx,location),encoder=new TextEncoder();let count=0,index=0,verified=false;
      const emit=(message:{role:string;content:string})=>{
        if(count++)writer.append(encoder.encode(','));
        for(const chunk of jsonChunks(message))writer.append(chunk);
      };
      const history=(finish:()=>void,visit?:(message:any)=>void)=>{
        const complete=(payload:any)=>{
          if(!payload||!Array.isArray(payload.messages))throw Error('Invalid generation input history');
          verified=true;finish();
        };
        if(header.payloadParts)readParts(tx,[owner,'entity',id],header.payloadParts,complete,new JsonStream(visit?{onMessage:visit}:{limit:0}));
        else {for(const message of header.payload?.messages??[])visit?.(message);complete(header.payload);}
      };
      writer.append(encoder.encode('['));emit({role:'system',content:input.contract});
      const next=()=>storageStep(tx,()=>{
        while(index<input.ordered.length){
          const part=input.ordered[index++];
          if(!part||typeof part.role!=='string'||typeof part.content!=='string')throw Error('Invalid generation input part');
          if(part.slot==='history'){
            history(next,message=>{
              if(input.regenerate!==undefined&&message?.id===input.regenerate||['stopped','interrupted'].includes(message?.imported_state))return;
              if(message?.role==='user'||message?.role==='assistant'){
                if(typeof message.content!=='string')throw Error('Invalid generation input message');
                emit({role:message.role,content:message.content});
              }
            });return;
          }
          emit({role:part.role,content:part.content});
        }
        const finish=()=>{writer.append(encoder.encode(']'));writer.finish(done);};
        if(verified)finish();else history(finish);
      });next();
    });
  });
}
