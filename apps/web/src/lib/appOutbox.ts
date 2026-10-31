import { appTransaction,type StoredOutbox } from './appStore';
import { deviceOwner,generationBusy } from './appContext';
import { guardStorage,storageStep,validParts } from './segmentedStorage';
import { canonical } from './appSyncData';
import { Sha256 } from '../mobile/sha256';
import { JsonStream } from './jsonStream';
import type { SyncUploadSource } from './appTransfers';

const LIMIT=1024*1024;
const sourceFields=(value:StoredOutbox)=>{const {receipt:_,withdrawn:__,...source}=value as StoredOutbox&{receipt?:unknown;withdrawn?:unknown};return source;};
const omitted=(value:unknown)=>['undefined','function','symbol'].includes(typeof value);
// Inline outboxes already hold their trees; compare JSON values without copying or serializing their histories.
function sameJson(left:any,right:any,depth=0):boolean {
  if(typeof left==='bigint'||typeof right==='bigint')throw Error('Invalid fixed outbox');
  if(omitted(left)||omitted(right))return omitted(left)&&omitted(right);
  if(typeof left==='number'&&!Number.isFinite(left))left=null;
  if(typeof right==='number'&&!Number.isFinite(right))right=null;
  if(left===null||right===null||typeof left!=='object'||typeof right!=='object')return left===right;
  if(depth>=64||[left,right].some(value=>!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))throw Error('Invalid fixed outbox');
  if(Array.isArray(left)||Array.isArray(right)){
    if(!Array.isArray(left)||!Array.isArray(right)||left.length!==right.length)return false;
    for(let index=0;index<left.length;index++)if(!sameJson(omitted(left[index])?null:left[index],omitted(right[index])?null:right[index],depth+1))return false;
    return true;
  }
  const keys=Object.keys(left).filter(key=>!omitted(left[key]));
  return keys.length===Object.keys(right).filter(key=>!omitted(right[key])).length
    &&keys.every(key=>Object.prototype.propertyIsEnumerable.call(right,key)&&sameJson(left[key],right[key],depth+1));
}
export const sameOutboxSource=(value:StoredOutbox|undefined,expected:StoredOutbox)=>!!value&&sameJson(sourceFields(value),sourceFields(expected));
export function outboxSyncSource(owner:string,batch:StoredOutbox):SyncUploadSource {
  if(!batch.changesParts||!validParts(batch.changesParts)||batch.count!==batch.changes.length
    ||typeof batch.request_id!=='string'||!batch.request_id||batch.request_id.length>100)throw Error('Invalid fixed outbox');
  const expected=structuredClone(sourceFields(batch)),ref=expected.changesParts!,signature=canonical(expected),key='sync:'+owner+':outbox';
  const prefix=new TextEncoder().encode('{"request_id":'+JSON.stringify(expected.request_id)+',"changes":');
  const current=(header:StoredOutbox)=>{
    if(owner!==deviceOwner()||generationBusy()||!header||canonical(sourceFields(header))!==signature)throw Error('Fixed outbox changed');
  };
  async function* chunks():AsyncGenerator<Uint8Array> {
    const parser=new JsonStream({omitChangePayloads:true}),digest=new Sha256();let size=0,buffer=new Uint8Array(LIMIT),used=prefix.length;
    buffer.set(prefix);parser.feed(prefix);
    for(let index=0;index<ref.chunks;index++){
      const bytes=await appTransaction<Uint8Array>(['meta','parts'],'readonly',(tx,done)=>{
        guardStorage(tx,()=>owner===deviceOwner()&&!generationBusy());
        const read=tx.objectStore('meta').get(key);read.onsuccess=()=>storageStep(tx,()=>{
          current(read.result);
          const part=tx.objectStore('parts').get([owner,'outbox','fixed',ref.token,index]);part.onsuccess=()=>storageStep(tx,()=>{
            const bytes=part.result;
            if(!(bytes instanceof Uint8Array)||bytes.length!==Math.min(LIMIT,ref.size-index*LIMIT))throw Error('Missing or corrupt outbox part');
            done(bytes);
          });
        });
      });
      if(owner!==deviceOwner()||generationBusy())throw Error('Account or generation changed');
      digest.update(bytes);size+=bytes.length;parser.feed(bytes);
      for(let offset=0;offset<bytes.length;){
        const count=Math.min(LIMIT-used,bytes.length-offset);buffer.set(bytes.subarray(offset,offset+count),used);used+=count;offset+=count;
        if(used===LIMIT){yield buffer;buffer=new Uint8Array(LIMIT);used=0;}
      }
    }
    if(size!==ref.size||digest.digest()!==ref.sha256)throw Error('Outbox checksum mismatch');
    parser.feed(new Uint8Array([125]));
    const projection=parser.finish();
    if(!projection||!Array.isArray(projection.changes)||projection.changes.length!==expected.count
      ||canonical(projection)!==canonical({request_id:expected.request_id,changes:expected.changes}))throw Error('Outbox controls changed');
    buffer[used++]=125;if(used)yield buffer.subarray(0,used);
  }
  return {request_id:expected.request_id,chunks,inline:async()=>{
    // shortcut: legacy inline receipts still require a complete JSON string; new large uploads use parts.
    const decoder=new TextDecoder('utf-8',{fatal:true});let text='';
    for await(const bytes of chunks())text+=decoder.decode(bytes,{stream:true});text+=decoder.decode();
    return {method:'POST',headers:{'Content-Type':'application/json'},body:text};
  }};
}
