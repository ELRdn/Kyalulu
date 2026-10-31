import { Sha256 } from '../mobile/sha256';
import { deviceExecutionLockName } from './deviceExecution';

export type GenerationChange={metadata:Record<string,any>;append:any[];regenerate?:number;receipt:Record<string,any>};
const hash=(text:string)=>new Sha256().update(new TextEncoder().encode(text)).digest();
export function validateGenerationReceipt(owner:string,id:string,change:GenerationChange,previous:any) {
  const receipt=change.receipt;
  if(!receipt||typeof receipt.generation_id!=='string'||!receipt.generation_id||receipt.generation_id.length>200
    ||receipt.session_id!==id||receipt.execution_lock!==deviceExecutionLockName(owner)
    ||!['pending','completed','failed'].includes(receipt.status)||!Number.isSafeInteger(receipt.user_id)||receipt.user_id<1
    ||!/^[a-f0-9]{64}$/.test(receipt.user_content_sha256??'')
    ||receipt.status==='pending'&&previous!==undefined
    ||receipt.status!=='pending'&&(!previous||previous.status!=='pending'||previous.session_id!==id
      ||previous.generation_id!==receipt.generation_id||previous.user_id!==receipt.user_id
      ||previous.user_content_sha256!==receipt.user_content_sha256||previous.execution_lock!==receipt.execution_lock))throw Error('Generation receipt changed');
}

/** Inspect unchanged source messages and validate the small append/replacement before adoption. */
export function generationChangeView(change:GenerationChange) {
  const {receipt,metadata,append,regenerate}=change,ids=new Set<number>();
  if(!metadata||Object.hasOwn(metadata,'messages')||!Array.isArray(append)||append.length>1
    ||regenerate!==undefined&&(!Number.isSafeInteger(regenerate)||regenerate<1))throw Error('Invalid generation change');
  let last:any,previous:any,userHash:string|undefined;
  return {
    message(message:any) {
      if(!Number.isSafeInteger(message?.id)||message.id<1||ids.has(message.id))throw Error('Invalid generation history');
      ids.add(message.id);previous=last;last={id:message.id,role:message.role};
      if(message.id===receipt.user_id){if(message.role!=='user'||typeof message.content!=='string')throw Error('Invalid generation user');userHash=hash(message.content);}
      return receipt.status==='completed'&&message.id===regenerate?null:message;
    },
    finish(source:Record<string,any>):Record<string,any> {
      const pending=receipt.status==='pending',completed=receipt.status==='completed';
      if(source.cache_evicted||source.storage_policy!==metadata.storage_policy||source.memory_scope_mode!==metadata.memory_scope_mode
        ||(pending?source.pending_generation!=null:source.pending_generation!==receipt.generation_id)
        ||metadata.pending_generation!==(pending?receipt.generation_id:null))throw Error('Generation source changed');
      if(append.length!==(pending&&!regenerate||completed?1:0))throw Error('Invalid generation append');
      if(regenerate!==undefined&&(last?.id!==regenerate||last.role!=='assistant'||previous?.role!=='user'||previous.id!==receipt.user_id))throw Error('Regeneration source changed');
      if(!pending&&!regenerate&&(last?.role!=='user'||last.id!==receipt.user_id))throw Error('Generation user changed');
      for(const message of append){
        if(!message||!Number.isSafeInteger(message.id)||message.id<1||ids.has(message.id)||typeof message.uuid!=='string'||!message.uuid
          ||typeof message.content!=='string'||message.content.length>128000||message.role!==(pending?'user':'assistant')
          ||message.id!==(pending?receipt.user_id:receipt.assistant_id))throw Error('Invalid generation append');
        if(pending)userHash=hash(message.content);
        else if(message.content!==receipt.reply||message.content!==receipt.full)throw Error('Generation reply changed');
      }
      if(userHash!==receipt.user_content_sha256)throw Error('Generation user changed');
      return {...metadata,...(completed?{last_generation:receipt}:{})};
    },
  };
}
