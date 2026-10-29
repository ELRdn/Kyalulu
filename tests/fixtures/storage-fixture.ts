import { appTransaction, restoreEntity, restoreOutbox } from '/src/lib/appStore.ts';
export const physicalSnapshot=()=>appTransaction(['entities','meta','parts'],'readonly',(tx:any,done:any)=>{
  const stores=['entities','meta','parts'],result:any={};let index=0;
  const next=()=>{const name=stores[index++];if(!name){done(JSON.parse(JSON.stringify(result)));return;}
    const store=tx.objectStore(name),keys=store.getAllKeys(),values=store.getAll();
    values.onsuccess=()=>{result[name]=keys.result.map((key:any,i:number)=>[key,values.result[i] instanceof Uint8Array?Array.from(values.result[i]):values.result[i]]);next();};
  };next();
});
export const logicalSnapshot=()=>appTransaction(['entities','meta','parts'],'readonly',(tx:any,done:any)=>{
  const entities:any[]=[],read=tx.objectStore('entities').openCursor();
  read.onsuccess=()=>{const cursor=read.result;if(cursor)restoreEntity(tx,cursor.value,(value:any)=>{entities.push(value);cursor.continue();});
    else {const store=tx.objectStore('meta'),keys=store.getAllKeys(),values=store.getAll();values.onsuccess=()=>done({entities,meta:keys.result.map((key:any,i:number)=>[key,values.result[i]])});}
  };
});
export const fixedOutbox=(owner:string)=>appTransaction(['meta','parts'],'readonly',(tx:any,done:any)=>{
  const read=tx.objectStore('meta').get('sync:'+owner+':outbox');read.onsuccess=()=>restoreOutbox(tx,owner,read.result,done);
});
