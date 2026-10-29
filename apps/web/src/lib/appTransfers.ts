import { Sha256 } from '../mobile/sha256';
import { encodeBytes, decodeBytes } from './remoteRpc';
import { JsonStream } from './jsonStream';

export const SYNC_INLINE_BYTES=1_500_000;
const CHUNK_BYTES=1024*1024;
type Call=(path:string,init?:RequestInit)=>Promise<any>;
type Active=()=>Promise<void>;
const hash=(raw:Uint8Array)=>new Sha256().update(raw).digest();
const post=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

// Keep JSON.stringify's bytes for persisted transfer manifests without creating the whole string.
function* jsonText(value:any,ancestors=new Set<object>()):Generator<string> {
  if(typeof value==='string'){
    yield '"';
    for(let start=0;start<value.length;){
      let end=Math.min(start+4096,value.length);
      if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1])&&/[\uDC00-\uDFFF]/.test(value[end]))end--;
      yield JSON.stringify(value.slice(start,end)).slice(1,-1);start=end;
    }
    yield '"';return;
  }
  if(value===null||typeof value!=='object') {const text=JSON.stringify(value);if(text===undefined)throw Error('Invalid sync transfer');yield text;return;}
  if(ancestors.has(value)||ancestors.size>=64||!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid sync transfer');
  ancestors.add(value);
  if(Array.isArray(value)){
    yield '[';
    for(let index=0;index<value.length;index++){if(index)yield ',';yield* jsonText(['undefined','function','symbol'].includes(typeof value[index])?null:value[index],ancestors);}
    yield ']';
  }else{
    yield '{';let first=true;
    for(const key of Object.keys(value)){
      const item=value[key];if(['undefined','function','symbol'].includes(typeof item))continue;
      if(!first)yield ',';first=false;yield* jsonText(key,ancestors);yield ':';yield* jsonText(item,ancestors);
    }
    yield '}';
  }
  ancestors.delete(value);
}

// shortcut: decoded trees and scalar strings stay whole; bound them before large-memory acceptance.
export function* jsonChunks(value:unknown):Generator<Uint8Array> {
  const encoder=new TextEncoder();let buffer=new Uint8Array(CHUNK_BYTES),used=0;
  for(const text of jsonText(value)){
    const raw=encoder.encode(text);let offset=0;
    while(offset<raw.length){
      const length=Math.min(raw.length-offset,CHUNK_BYTES-used);
      buffer.set(raw.subarray(offset,offset+length),used);offset+=length;used+=length;
      if(used===CHUNK_BYTES){yield buffer;buffer=new Uint8Array(CHUNK_BYTES);used=0;}
    }
  }
  if(used)yield buffer.subarray(0,used);
}

export async function uploadSync(body:{request_id:string;changes:unknown[]},call:Call,active:Active) {
  if(typeof body.request_id!=='string'||!body.request_id||body.request_id.length>100)throw Error('Invalid sync transfer');
  let size=0;const digest=new Sha256();
  for(const chunk of jsonChunks(body)){
    await active();size+=chunk.length;if(size>1_000_000_000)throw Error('Invalid sync transfer');digest.update(chunk);
  }
  await active();
  if(size<=SYNC_INLINE_BYTES)return call('',post(body));
  const opened=await call('/transfers',post({request_id:body.request_id,size,sha256:digest.digest()}));
  if(opened.inline_receipt_required===true){await active();return call('',post(body));}
  if(opened.result)return opened.result;
  if(typeof opened.transfer_id!=='string'||!/^[0-9a-f-]{36}$/.test(opened.transfer_id)||opened.chunk_bytes!==CHUNK_BYTES
    ||!Number.isSafeInteger(opened.next)||opened.next<0||opened.next>Math.ceil(size/CHUNK_BYTES))throw Error('Invalid sync transfer');
  let index=0;
  for(const chunk of jsonChunks(body)){
    await active();
    if(index++<opened.next)continue;
    const received=await call(`/transfers/${opened.transfer_id}/parts/${index-1}`,post({data:encodeBytes(chunk),sha256:hash(chunk)}));
    if(received.next!==index)throw Error('Invalid transfer acknowledgment');
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
  // shortcut: decoded entities and individual strings remain whole; segment storage before 1 GB acceptance.
  const parser=new JsonStream(),digest=new Sha256();let offset=0;
  for(let index=0;index<ref.chunks;index++){
    await active();
    const part=await call(`/transfers/${ref.transfer_id}/parts/${index}`);
    if(typeof part.data!=='string'||part.data.length>4*Math.ceil(CHUNK_BYTES/3)||part.data.length%4!==0
      ||!/^[A-Za-z0-9+/]*={0,2}$/.test(part.data))throw Error('Invalid transfer chunk');
    const chunk=decodeBytes(part.data);
    if(chunk.length!==Math.min(CHUNK_BYTES,ref.size-offset)||hash(chunk)!==part.sha256)throw Error('Transfer SHA-256 mismatch');
    digest.update(chunk);offset+=chunk.length;parser.feed(chunk);
  }
  if(offset!==ref.size||digest.digest()!==ref.sha256)throw Error('Transfer size or SHA-256 mismatch');
  const payload=parser.finish();
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid transfer payload');
  await active();
  const {payload_ref:_,...result}=entity;return {...result,payload};
}
