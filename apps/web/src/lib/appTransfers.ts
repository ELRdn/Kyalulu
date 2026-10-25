import { Sha256 } from '../mobile/sha256';
import { encodeBytes, decodeBytes } from './remoteRpc';

export const SYNC_INLINE_BYTES=1_500_000;
const CHUNK_BYTES=1024*1024;
type Call=(path:string,init?:RequestInit)=>Promise<any>;
type Active=()=>Promise<void>;
const hash=(raw:Uint8Array)=>new Sha256().update(raw).digest();
const post=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

export async function uploadSync(body:string,call:Call,active:Active) {
  const raw=new TextEncoder().encode(body),request=JSON.parse(body);
  if(raw.length>1_000_000_000||typeof request.request_id!=='string')throw Error('Invalid sync transfer');
  await active();
  const opened=await call('/transfers',post({request_id:request.request_id,size:raw.length,sha256:hash(raw)}));
  if(opened.inline_receipt_required===true){await active();return call('',post(request));}
  if(opened.result)return opened.result;
  if(typeof opened.transfer_id!=='string'||!/^[0-9a-f-]{36}$/.test(opened.transfer_id)||opened.chunk_bytes!==CHUNK_BYTES
    ||!Number.isSafeInteger(opened.next)||opened.next<0||opened.next>Math.ceil(raw.length/CHUNK_BYTES))throw Error('Invalid sync transfer');
  for(let index=opened.next;index<Math.ceil(raw.length/CHUNK_BYTES);index++){
    await active();
    const chunk=raw.subarray(index*CHUNK_BYTES,(index+1)*CHUNK_BYTES);
    const received=await call(`/transfers/${opened.transfer_id}/parts/${index}`,post({data:encodeBytes(chunk),sha256:hash(chunk)}));
    if(received.next!==index+1)throw Error('Invalid transfer acknowledgment');
  }
  await active();
  return call(`/transfers/${opened.transfer_id}/commit`,post({}));
}

export async function downloadEntity(entity:any,call:Call,active:Active) {
  if(!entity?.payload_ref)return entity;
  const ref=entity.payload_ref;
  if(ref.id!==entity.id||ref.revision!==entity.revision||!Number.isSafeInteger(ref.size)||ref.size<1||ref.size>1_000_000_000
    ||typeof ref.transfer_id!=='string'||!/^[0-9a-f-]{36}$/.test(ref.transfer_id)||ref.chunk_bytes!==CHUNK_BYTES
    ||ref.chunks!==Math.ceil(ref.size/CHUNK_BYTES)||typeof ref.sha256!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256))throw Error('Invalid transfer reference');
  // shortcut: the existing entity contract still materializes JSON; stream storage before accepting 1 GB single-entity workloads.
  const raw=new Uint8Array(ref.size),digest=new Sha256();let offset=0;
  for(let index=0;index<ref.chunks;index++){
    await active();
    const part=await call(`/transfers/${ref.transfer_id}/parts/${index}`);
    if(typeof part.data!=='string'||part.data.length>4*Math.ceil(CHUNK_BYTES/3)||part.data.length%4!==0
      ||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.data))throw Error('Invalid transfer chunk');
    const chunk=decodeBytes(part.data);
    if(chunk.length!==Math.min(CHUNK_BYTES,ref.size-offset)||hash(chunk)!==part.sha256)throw Error('Transfer SHA-256 mismatch');
    raw.set(chunk,offset);digest.update(chunk);offset+=chunk.length;
  }
  if(offset!==ref.size||digest.digest()!==ref.sha256)throw Error('Transfer size or SHA-256 mismatch');
  const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid transfer payload');
  await active();
  const {payload_ref:_,...result}=entity;return {...result,payload};
}
