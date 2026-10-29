"""Test-only logical reader for built bundles; snapshot all stores before decoding."""
READ_ENTITIES_JS = r"""async (kinds=null)=>{
  const raw=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('kyalulu-app-v1',3);request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;db.onversionchange=()=>db.close();
      const tx=db.transaction(['entities','parts'],'readonly'),entities=tx.objectStore('entities').getAll();
      const store=tx.objectStore('parts'),keys=store.getAllKeys(),values=store.getAll();
      tx.oncomplete=()=>{db.close();resolve({entities:entities.result,parts:keys.result.map((key,index)=>[JSON.stringify(key),values.result[index]])});};
      tx.onabort=()=>{db.close();reject(tx.error);};
    };
  });
  const parts=new Map(raw.parts),result=[];
  for(const row of raw.entities){
    if(kinds&&!kinds.includes(row.kind))continue;
    if(!row.payloadParts){result.push(row);continue;}
    const {payloadParts:ref,selection,...header}=row,bytes=new Uint8Array(ref.size);let size=0;
    if(ref.chunks!==Math.ceil(ref.size/1048576))throw Error('Invalid test manifest');
    for(let index=0;index<ref.chunks;index++){
      const piece=parts.get(JSON.stringify([row.owner,'entity',row.id,ref.token,index]));
      if(!(piece instanceof Uint8Array)||piece.length!==Math.min(1048576,ref.size-size))throw Error('Missing/corrupt test part');
      bytes.set(piece,size);size+=piece.length;
    }
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
    if(hash!==ref.sha256)throw Error('Corrupt test hash');
    result.push({...header,payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))});
  }
  return result.sort((a,b)=>a.id.localeCompare(b.id));
}"""
