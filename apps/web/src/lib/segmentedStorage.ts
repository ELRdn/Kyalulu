import { deviceOwner } from './appContext';
import { jsonChunks } from './appTransfers';
import { JsonStream } from './jsonStream';
import { Sha256 } from '../mobile/sha256';

export type Parts = { token:string; size:number; chunks:number; sha256:string };
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
export function readParts(tx:IDBTransaction,location:Location,ref:Parts,done:(value:any)=>void,decode=true) {
  storageStep(tx,()=>{
    if(!valid(ref))throw Error('Invalid storage manifest');
    const parser=decode?new JsonStream():undefined,digest=new Sha256();let index=0,size=0;
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
