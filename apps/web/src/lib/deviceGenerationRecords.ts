import { deviceOwner } from './appContext';
import { canonical } from './appSyncData';
import { jsonChunks } from './appTransfers';
import { deviceExecutionLockName } from './deviceExecution';
import { eraseDeviceMemoryReferences } from './deviceMemoryScopes';
import { Sha256 } from '../mobile/sha256';
import { storageStep, readParts, writeParts, removeParts, validParts, type Parts } from './segmentedStorage';
import { writeConversationGenerationInput, type ConversationGenerationInput, type GenerationInput } from './deviceGenerationInput';

type Value = Record<string, any>;
export type GenerationHolder = { kind:'conversation'|'research'; id:string };
export type Section = 'receipt'|'prompt'|'compiled'|'memory'|'telemetryMemory'|'telemetry'|'attempts';
export type GenerationHeader = {
  format:'device-generation@1'; owner:string; holder:GenerationHolder;
  generation_id:string; session_id:string; status:'completed';
  user_id:number; assistant_id:number; execution_lock:string; user_content_sha256:string; reply_sha256:string;
  sections:Partial<Record<Section,Parts>>; prompt_encoding?:'input-json'|'json-string';
  top_memory:boolean; telemetry_memory:boolean; diagnostics_state?:'erased'; catalog_sha256:string;
};
const sections:Section[]=['receipt','prompt','compiled','memory','telemetryMemory','telemetry','attempts'];
const object=(value:any):value is Value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const key=(owner:string,id:string)=>'generation:'+owner+':'+id;
const location=(owner:string,id:string)=>[owner,'generation',id] as const;
const hash=(text:string)=>new Sha256().update(new TextEncoder().encode(text)).digest();
const signature=(header:Omit<GenerationHeader,'catalog_sha256'>)=>hash(canonical(header));
const current=(owner:string,signal?:AbortSignal)=>{signal?.throwIfAborted();if(owner!==deviceOwner())throw Error('Account changed');};
export const isGenerationHeader=(value:any):value is GenerationHeader=>value?.format==='device-generation@1';
export function validateGenerationHeader(value:any,owner:string,holder:GenerationHolder,id:string):asserts value is GenerationHeader {
  if(!object(value)||!isGenerationHeader(value)||value.owner!==owner||value.generation_id!==id||typeof id!=='string'||!id||id.length>200
    ||Object.keys(value).some(name=>!['format','owner','holder','generation_id','session_id','status','user_id','assistant_id','execution_lock',
      'user_content_sha256','reply_sha256','sections','prompt_encoding','top_memory','telemetry_memory','diagnostics_state','catalog_sha256'].includes(name))
    ||!object(value.holder)||Object.keys(value.holder).some(name=>!['kind','id'].includes(name))
    ||!['conversation','research'].includes(holder.kind)||typeof holder.id!=='string'||!holder.id
    ||value.holder.kind!==holder.kind||value.holder.id!==holder.id
    ||value.session_id!==(holder.kind==='research'?'exp:'+holder.id:holder.id)||value.status!=='completed'
    ||!Number.isSafeInteger(value.user_id)||value.user_id<1||!Number.isSafeInteger(value.assistant_id)||value.assistant_id<1
    ||value.execution_lock!==deviceExecutionLockName(owner)||!object(value.sections)||!value.sections.receipt
    ||Object.keys(value.sections).some(name=>!sections.includes(name as Section))
    ||Object.values(value.sections).some(part=>!validParts(part!))
    ||new Set(Object.values(value.sections).map(part=>part!.token)).size!==Object.keys(value.sections).length
    ||[value.user_content_sha256,value.reply_sha256,value.catalog_sha256].some(digest=>typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))
    ||typeof value.top_memory!=='boolean'||typeof value.telemetry_memory!=='boolean'
    ||value.diagnostics_state!==undefined&&value.diagnostics_state!=='erased'
    ||(value.top_memory||value.telemetry_memory)!==!!value.sections.memory
    ||!!value.sections.telemetryMemory&&!(value.top_memory&&value.telemetry_memory)
    ||value.telemetry_memory&&!value.sections.telemetry
    ||(value.sections.prompt?!['input-json','json-string'].includes(value.prompt_encoding??''):value.prompt_encoding!==undefined))throw Error('Invalid generation manifest');
  const {catalog_sha256,...unsigned}=value;
  if(catalog_sha256!==signature(unsigned))throw Error('Generation manifest changed');
}
function fingerprint(value:unknown){const digest=new Sha256();let bytes=0;for(const part of jsonChunks(value)){digest.update(part);bytes+=part.length;}return [bytes,digest.digest()].join(':');}
export function generationSummary(header:GenerationHeader):Value {
  return {generation_id:header.generation_id,session_id:header.session_id,status:header.status,user_id:header.user_id,assistant_id:header.assistant_id,
    execution_lock:header.execution_lock,user_content_sha256:header.user_content_sha256,reply_sha256:header.reply_sha256,
    device_diagnostics:{format:header.format,generation_id:header.generation_id,holder:{...header.holder},state:header.diagnostics_state??'stored'}};
}

/** Caller validates pending/source revision and publishes this result in the same transaction. */
export function writeGenerationReceipt(tx:IDBTransaction,owner:string,holder:GenerationHolder,value:Value,input:GenerationInput|undefined,
  done:(header:GenerationHeader,summary:Value)=>void) {
  storageStep(tx,()=>{
    current(owner);
    if(!object(value)||value.status!=='completed'||value.device_diagnostics!==undefined||typeof value.reply!=='string'||value.full!==value.reply
      ||input!==undefined&&(value.raw_prompt!==undefined||!Array.isArray(input)&&(holder.kind!=='conversation'||(input as ConversationGenerationInput)?.format!=='conversation-input@1')))throw Error('Invalid generation receipt');
    const {raw_prompt,compiled,memory,attempts,telemetry,...receipt}=value;
    const telemetryObject=object(telemetry),telemetryTrace=telemetryObject?telemetry.memory:undefined;
    const top=memory!==undefined,inside=telemetryTrace!==undefined;
    if(!telemetryObject&&telemetry!==undefined)receipt.telemetry=telemetry;
    const values:Partial<Record<Section,unknown>>={receipt,
      ...(input!==undefined?{prompt:input}:raw_prompt!==undefined?{prompt:raw_prompt}:{}),
      ...(compiled===undefined?{}:{compiled}),...(attempts===undefined?{}:{attempts}),
      ...(top||inside?{memory:top?memory:telemetryTrace}:{}),
      ...(telemetryObject?{telemetry:Object.fromEntries(Object.entries(telemetry).filter(([name])=>name!=='memory'))}:{}),
      ...(top&&inside&&memory!==telemetryTrace&&fingerprint(memory)!==fingerprint(telemetryTrace)?{telemetryMemory:telemetryTrace}:{}),
    };
    if(raw_prompt!==undefined&&typeof raw_prompt!=='string')throw Error('Invalid saved raw prompt');
    const header:GenerationHeader={format:'device-generation@1',owner,holder:{...holder},generation_id:value.generation_id,session_id:value.session_id,
      status:'completed',user_id:value.user_id,assistant_id:value.assistant_id,execution_lock:value.execution_lock,
      user_content_sha256:value.user_content_sha256,reply_sha256:hash(value.reply),sections:{},
      ...(Object.hasOwn(values,'prompt')?{prompt_encoding:input===undefined?'json-string' as const:'input-json' as const}:{}),
      top_memory:top,telemetry_memory:inside,catalog_sha256:''};
    const names=sections.filter(name=>Object.hasOwn(values,name));let index=0;
    const next=()=>{
      const name=names[index++];
      if(name){
        const save=(part:Parts)=>{header.sections[name]=part;next();};
        if(name==='prompt'&&input!==undefined&&!Array.isArray(input))
          writeConversationGenerationInput(tx,owner,holder.id,input as ConversationGenerationInput,location(owner,header.generation_id),save);
        else writeParts(tx,location(owner,header.generation_id),values[name],save);
        return;
      }
      const {catalog_sha256:_,...unsigned}=header;header.catalog_sha256=signature(unsigned);
      validateGenerationHeader(header,owner,holder,header.generation_id);
      const saved=tx.objectStore('meta').put(header,key(owner,header.generation_id));saved.onsuccess=()=>storageStep(tx,()=>done(header,generationSummary(header)));
    };
    const existing=tx.objectStore('meta').get(key(owner,header.generation_id));
    existing.onsuccess=()=>storageStep(tx,()=>{
      const previous=existing.result;
      if(previous!==undefined&&(previous.status!=='pending'||previous.generation_id!==header.generation_id||previous.session_id!==header.session_id
        ||previous.user_id!==header.user_id||previous.user_content_sha256!==header.user_content_sha256||previous.execution_lock!==header.execution_lock))throw Error('Generation receipt changed');
      next();
    });
  });
}

/** Conversion never replaces an older inline diagnostic unless its complete receipt is retained. */
export function preserveLegacyGeneration(tx:IDBTransaction,owner:string,holder:GenerationHolder,value:any,done:()=>void) {
  storageStep(tx,()=>{
    if(!object(value)||(!['raw_prompt','compiled','attempts','memory'].some(name=>value[name]!==undefined)&&value.telemetry?.memory===undefined)){done();return;}
    if(typeof value.generation_id!=='string'||!value.generation_id||value.generation_id.length>200
      ||value.session_id!==(holder.kind==='research'?'exp:'+holder.id:holder.id))throw Error('Legacy diagnostics could not be preserved; original data retained');
    const read=tx.objectStore('meta').get(key(owner,value.generation_id));
    read.onsuccess=()=>storageStep(tx,()=>{
      if(read.result===undefined){writeGenerationReceipt(tx,owner,holder,value,undefined,()=>done());return;}
      if(isGenerationHeader(read.result)||fingerprint(read.result)!==fingerprint(value))throw Error('Conflicting legacy diagnostics; original data retained');
      done();
    });
  });
}

/** Holder deletion removes the physical closure and tombstone in the caller's guarded transaction. */
export function deleteGenerationReceipt(tx:IDBTransaction,header:GenerationHeader,done:()=>void) {
  storageStep(tx,()=>{
    current(header.owner);validateGenerationHeader(header,header.owner,header.holder,header.generation_id);
    const store=tx.objectStore('meta'),read=store.get(key(header.owner,header.generation_id));
    read.onsuccess=()=>storageStep(tx,()=>{
      validateGenerationHeader(read.result,header.owner,header.holder,header.generation_id);
      if(read.result.catalog_sha256!==header.catalog_sha256)throw Error('Generation changed before deletion');
      let index=0;
      const next=()=>{
        const name=sections[index++];
        if(name){removeParts(tx,location(header.owner,header.generation_id),header.sections[name],next);return;}
        const saved=store.put({generation_id:header.generation_id,session_id:header.session_id,status:'deleted'},key(header.owner,header.generation_id));
        saved.onsuccess=()=>storageStep(tx,done);
      };next();
    });
  });
}

/** Prune only a verified trace; authored replies stay in receipt/history and all changes commit together. */
export function eraseGenerationMemoryReferences(tx:IDBTransaction,header:GenerationHeader,source:string,removed:Set<string>,done:(updated?:GenerationHeader)=>void) {
  storageStep(tx,()=>{
    current(header.owner);validateGenerationHeader(header,header.owner,header.holder,header.generation_id);
    const store=tx.objectStore('meta'),request=store.get(key(header.owner,header.generation_id));
    request.onsuccess=()=>storageStep(tx,()=>{
      validateGenerationHeader(request.result,header.owner,header.holder,header.generation_id);
      if(request.result.catalog_sha256!==header.catalog_sha256)throw Error('Generation changed before memory erasure');
      if(!header.sections.memory){done();return;}
      const at=location(header.owner,header.generation_id);
      readParts(tx,at,header.sections.memory,primary=>{
        const check=(secondary:any)=>{
          const traces={...(header.top_memory?{memory:primary}:{}),...(header.telemetry_memory?{telemetry:{memory:secondary}}:{})};
          const result=eraseDeviceMemoryReferences(traces,source,removed);
          if(result===traces){done();return;}
          readParts(tx,at,header.sections.receipt!,receipt=>{
            if(!object(receipt))throw Error('Invalid generation receipt');
            const updated:GenerationHeader={...header,sections:{...header.sections},diagnostics_state:'erased'};
            delete updated.sections.prompt;delete updated.prompt_encoding;delete updated.sections.compiled;delete updated.sections.attempts;
            const primary=header.top_memory?result.memory:result.telemetry.memory,secondary=result.telemetry?.memory;
            const values:Partial<Record<Section,unknown>>={receipt:{...receipt,erased_memory_source:source,
              ...(object(receipt.validation)?{validation:{...receipt.validation,errors:[]}}:{})},memory:primary};
            delete updated.sections.telemetryMemory;
            if(header.top_memory&&header.telemetry_memory&&fingerprint(primary)!==fingerprint(secondary))values.telemetryMemory=secondary;
            const names=Object.keys(values) as Section[];let index=0;
            const write=()=>{
              const name=names[index++];
              if(name){writeParts(tx,at,values[name],part=>{updated.sections[name]=part;write();});return;}
              const {catalog_sha256:_,...unsigned}=updated;updated.catalog_sha256=signature(unsigned);
              validateGenerationHeader(updated,updated.owner,updated.holder,updated.generation_id);
              const saved=store.put(updated,key(updated.owner,updated.generation_id));
              saved.onsuccess=()=>storageStep(tx,()=>{index=0;clean();});
            };
            const clean=()=>{
              const name=sections[index++];if(!name){done(updated);return;}
              if(header.sections[name]?.token!==updated.sections[name]?.token)removeParts(tx,at,header.sections[name],clean);else clean();
            };write();
          });
        };
        if(header.sections.telemetryMemory)readParts(tx,at,header.sections.telemetryMemory,check);else check(primary);
      });
    });
  });
}

export { key as generationKey, location as generationLocation, fingerprint as generationFingerprint, current as assertGenerationOwner };
