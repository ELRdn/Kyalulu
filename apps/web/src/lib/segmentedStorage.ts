import { deviceOwner } from './appContext';
import { jsonChunks } from './appTransfers';
import { JsonStream } from './jsonStream';
import { Sha256 } from '../mobile/sha256';

export type Parts = { token:string; size:number; chunks:number; sha256:string };
export type ConversationScan={count:number;maximumMessageId:number;messageIdsValid:boolean;last_preview:string;last_at:any};
const LIMIT=1024*1024;
type Location=readonly [string,string,string];
const partKey=(location:Location,ref:Parts,index:number)=>[...location,ref.token,index];
const valid=(ref:Parts)=>ref&&typeof ref.token==='string'&&/^[0-9a-f-]{36}$/.test(ref.token)
  &&Number.isSafeInteger(ref.size)&&ref.size>0&&Number.isSafeInteger(ref.chunks)&&ref.chunks===Math.ceil(ref.size/LIMIT)
  &&typeof ref.sha256==='string'&&/^[0-9a-f]{64}$/.test(ref.sha256);
// IDB callbacks alone advance the queue; no crypto/network promises can expire a live transaction.
const owners=new WeakMap<IDBTransaction,string>();
const guards=new WeakMap<IDBTransaction,()=>boolean>();
export const guardStorage=(tx:IDBTransaction,current:()=>boolean)=>{guards.set(tx,current);};
export function storageStep(tx:IDBTransaction,action:()=>void) {
  try{
    if(!owners.has(tx))owners.set(tx,deviceOwner());
    if(owners.get(tx)!==deviceOwner()||guards.get(tx)?.()===false)throw Error('Account changed');
    action();
  }catch{tx.abort();}
}
export function readParts(tx:IDBTransaction,location:Location,ref:Parts,done:(value:any)=>void,decode:boolean|JsonStream=true) {
  storageStep(tx,()=>{
    if(!valid(ref))throw Error('Invalid storage manifest');
    const parser=decode===true?new JsonStream():decode||undefined,digest=new Sha256();let index=0,size=0;
    const next=()=>{
      const read=tx.objectStore('parts').get(partKey(location,ref,index));
      read.onsuccess=()=>storageStep(tx,()=>{
        const bytes=read.result;
        if(!(bytes instanceof Uint8Array)||bytes.length!==Math.min(LIMIT,ref.size-size))throw Error('Missing or corrupt storage part');
        digest.update(bytes);parser?.feed(bytes);size+=bytes.length;
        if(++index<ref.chunks){next();return;}
        if(size!==ref.size||digest.digest()!==ref.sha256)throw Error('Storage checksum mismatch');
        done(parser?.finish());
      });
    };next();
  });
}
export function removeParts(tx:IDBTransaction,location:Location,ref:Parts|undefined,done:()=>void) {
  storageStep(tx,()=>{
    if(!ref){done();return;}
    if(!valid(ref))throw Error('Invalid storage manifest');
    let index=0;
    const next=()=>{
      const request=tx.objectStore('parts').delete(partKey(location,ref,index++));
      request.onsuccess=()=>storageStep(tx,()=>index<ref.chunks?next():done());
    };next();
  });
}
export function writeParts(tx:IDBTransaction,location:Location,value:unknown,done:(ref:Parts)=>void) {
  storageStep(tx,()=>{
    const chunks=jsonChunks(value),digest=new Sha256(),ref:Parts={token:crypto.randomUUID(),size:0,chunks:0,sha256:''};
    const next=()=>storageStep(tx,()=>{
      const chunk=chunks.next();
      if(chunk.done){ref.sha256=digest.digest();done(ref);return;}
      const bytes=chunk.value;digest.update(bytes);ref.size+=bytes.length;
      const request=tx.objectStore('parts').add(bytes,partKey(location,ref,ref.chunks++));
      request.onsuccess=next;
    });next();
  });
}
/** Tentative output stays in this transaction until the entire original body verifies. */
export function rewriteConversationParts(tx:IDBTransaction,location:Location,previous:Parts,patch:Record<string,unknown>,
  done:(ref:Parts,metadata:Record<string,any>,scan:ConversationScan)=>void) {
  storageStep(tx,()=>{
    if(Object.hasOwn(patch,'messages'))throw Error('History cannot be replaced by a metadata patch');
    const digest=new Sha256(),ref:Parts={token:crypto.randomUUID(),size:0,chunks:0,sha256:''},encoder=new TextEncoder();
    const scan={count:0,maximumMessageId:0,messageIdsValid:true,last_preview:'',last_at:null as any};
    let buffer=new Uint8Array(LIMIT),used=0;
    const flush=()=>{
      if(!used)return;
      const bytes=used===LIMIT?buffer:buffer.slice(0,used);digest.update(bytes);ref.size+=bytes.length;
      const write=tx.objectStore('parts').add(bytes,partKey(location,ref,ref.chunks++));buffer=new Uint8Array(LIMIT);used=0;return write;
    };
    const append=(bytes:Uint8Array)=>{
      let write:IDBRequest|undefined;
      for(let offset=0;offset<bytes.length;){const count=Math.min(LIMIT-used,bytes.length-offset);buffer.set(bytes.subarray(offset,offset+count),used);used+=count;offset+=count;if(used===LIMIT)write=flush();}return write;
    };
    append(encoder.encode('{"messages":['));
    const parser=new JsonStream({onMessage:(message:any,index:number)=>{
      if(index)append(encoder.encode(','));for(const chunk of jsonChunks(message))append(chunk);
      scan.count=index+1;scan.messageIdsValid&&=Number.isSafeInteger(message?.id)&&message.id>0;
      if(Number.isSafeInteger(message?.id))scan.maximumMessageId=Math.max(scan.maximumMessageId,message.id);
      scan.last_preview=String(message?.content??'').slice(0,160);scan.last_at=message?.created_at??null;
    }});
    readParts(tx,location,previous,p=>{
      if(!p||typeof p!=='object'||Array.isArray(p)||!Array.isArray(p.messages)||parser.totalMessages===undefined||parser.totalMessages!==scan.count)throw Error('Invalid conversation body');
      const {messages:_,...metadata}=p,updated={...metadata,...patch},hasMetadata=Object.keys(updated).length>0;
      append(encoder.encode(hasMetadata?'],':']}'));
      const chunks=hasMetadata?jsonChunks(updated):undefined;let first=true;
      const finish=()=>{ref.sha256=digest.digest();done(ref,metadata,scan);};
      const next=()=>storageStep(tx,()=>{
        const step=chunks?.next();
        if(step&&!step.done){const write=append(first?step.value.subarray(1):step.value);first=false;
          if(write)write.onsuccess=next;else next();return;}
        const write=flush();if(write)write.onsuccess=()=>storageStep(tx,finish);else finish();
      });next();
    },parser);
  });
}
const queues=new WeakMap<IDBTransaction,((next:()=>void)=>void)[]>();
export function storageWrite(tx:IDBTransaction,write:(next:()=>void)=>void) {
  let queue=queues.get(tx);
  if(queue){queue.push(write);return;}
  queue=[];queues.set(tx,queue);queue.push(write);
  const next=()=>storageStep(tx,()=>{
    queue!.shift();if(queue!.length)queue![0](next);else queues.delete(tx);
  });
  storageStep(tx,()=>queue![0](next));
}
