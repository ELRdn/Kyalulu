import { JsonStream } from './jsonStream';
export function decoded(value:any,parts:Map<string,any>,owner=value?.owner):any {
  if(!value)return value;
  const ref=value.payloadParts??value.changesParts;if(!ref)return structuredClone(value);
  const parser=new JsonStream();
  for(let index=0;index<ref.chunks;index++)parser.feed(parts.get(JSON.stringify([owner,value.payloadParts?'entity':'outbox',value.payloadParts?value.id:'fixed',ref.token,index])));
  const {payloadParts,selection,changesParts,count,...header}=value;
  return {...structuredClone(header),[payloadParts?'payload':'changes']:parser.finish()};
}
export function harness(records:Map<string,any>,metadata:Map<string,any>,pieces:Map<string,any>,entityKey:(key:any)=>string,
  mode:string,action:any,options:{write?:()=>void;read?:(mode:string,name:string,key:any)=>void}={}) {
  return new Promise((resolve,reject)=>{
    const entities=structuredClone(records),meta=structuredClone(metadata),parts=structuredClone(pieces);
    let pending=0,aborted=false,finished=false,value:any,failure:unknown;
    const finish=()=>{
      if(pending||finished)return;finished=true;
      if(aborted){reject(failure??Error('Transaction aborted'));return;}
      for(const [target,source] of [[records,entities],[metadata,meta],[pieces,parts]]){target.clear();for(const [k,v] of source)target.set(k,v);}
      resolve(value);
    };
    const enqueue=(operation:()=>any)=>{
      const request:any={};pending++;
      queueMicrotask(()=>{try{if(!aborted){request.result=structuredClone(operation());request.onsuccess?.();}}catch{aborted=true;}finally{pending--;finish();}});
      return request;
    };
    const cursor=(items:any[],hook:(value:any)=>void)=>{
      const request:any={};let index=0;
      const next=()=>{pending++;queueMicrotask(()=>{try{if(!aborted){request.result=index<items.length?{...structuredClone(items[index++]),continue:next}:null;hook(request.result);request.onsuccess?.();}}catch{aborted=true;}finally{pending--;finish();}});};
      next();return request;
    };
    const tx={abort:()=>{aborted=true;},objectStore:(name:string)=>{
      if(!['entities','meta','parts'].includes(name))throw Error('Unknown object store');
      const map=name==='entities'?entities:name==='parts'?parts:meta;
      const key=(k:any)=>name==='entities'?entityKey(k):name==='parts'?JSON.stringify(k):k;
      const write=(v:any,k:any,add=false)=>enqueue(()=>{
        options.write?.();const id=name==='entities'?key([v.owner,v.id]):key(k);
        if(add&&map.has(id))throw Error('Duplicate');map.set(id,structuredClone(v));return id;
      });
      return {get:(k:any)=>enqueue(()=>{options.read?.(mode,name,k);return map.get(key(k));}),
        getAll:()=>enqueue(()=>[...map.values()]),getAllKeys:()=>enqueue(()=>[...map.keys()]),
        openCursor:(range:any)=>cursor([...entities.values()].filter(e=>e.owner===range.lower[0]).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(value=>({value})),value=>options.read?.(mode,'cursor',value?.value?.id??null)),
        index:()=>({openKeyCursor:(range:any)=>cursor([...meta.entries()].filter(([,v])=>v?.request_id===range.lower[0]&&v?.withdrawn===range.lower[1]).map(([primaryKey])=>({primaryKey})),()=>{})}),
        put:(v:any,k:any)=>write(v,k),add:(v:any,k:any)=>write(v,k,true),delete:(k:any)=>enqueue(()=>{options.write?.();map.delete(key(k));})};
    }};
    try{action(tx,(v:any)=>{value=v;});finish();}catch(error){failure=error;aborted=true;finish();}
  });
}
