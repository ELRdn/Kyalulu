// Frozen f9c8d2c branch ACK + pure event adapter; receiver/binder reuse the checksum-pinned old oracle.
import {rebindConversation,receiveConversation} from './sync-staging-oracle.ts';
type AppEntity=any;
type Ack=any;
type Batch=any;
// BEGIN OLD ACK
export function acknowledgeEntity(local:AppEntity, ack:Ack, batch:Batch) {
  const source=ack.source_id??ack.id;
  const updated={...local,id:ack.id,serverRevision:ack.revision,dirty:local.revision!==batch.revisions[source]};
  if(ack.deleted)return {...updated,deleted:true,dirty:false,payload:{storage_policy:'sync',deleted_revision:ack.revision}};
  if(ack.branched)updated.payload={...rebindConversation(local.payload,ack.id),branch_of:source,fork_revision:batch.changes.find(c=>c.id===source)!.base_revision};
  if(ack.lineage)updated.payload={...updated.payload,lineage:ack.lineage};
  return updated;
}
// END OLD ACK
export function oldMemoryEvents(source:AppEntity,target:AppEntity,history:any[]) {
      const memories=(p:AppEntity['payload'])=>[...(p.memories??[]),...(p.messages??[]).flatMap((m:any)=>[...(m.before?.memories??[]),...(m.after?.memories??[])])];
      const targetIds=new Map(memories(target.payload).map((m:any)=>[m.uuid??m.id,m.id]));
      const ids=new Map(memories(source.payload).map((m:any)=>[m.id,targetIds.get(m.uuid??m.id)]));
      const events=history.map((event:any,index:number)=>{
        if(event?.id!==index+1||event.scope!==source.id)throw Error('Invalid memory history');
        const remap=(id:string)=>ids.get(id)??null;
        return {...event,scope:target.id,source_scope:event.source_scope??source.id,
          memory_id:event.memory_id?remap(event.memory_id):null,source_memory_id:event.source_memory_id??event.memory_id,
          detail:Array.isArray(event.detail?.candidates)?{...event.detail,candidates:event.detail.candidates.map((c:any)=>({...c,id:remap(c.id),source_id:c.source_id??c.id}))}:event.detail};
      });
  return events;
}
export function oldBranch(local:AppEntity,ack:Ack,batch:Batch,allocate:()=>number,history:any[]) {
  const updated=acknowledgeEntity(local,ack,batch);
  if(local.deleted){
    const sent=batch.changes.find((c:any)=>c.id===(ack.source_id??ack.id))!;
    updated.deleted=false;updated.dirty=false;
    updated.payload={...rebindConversation(sent.payload,ack.id),branch_of:local.id,fork_revision:sent.base_revision};
    if(ack.lineage)updated.payload.lineage=ack.lineage;
  }
  updated.payload=rebindConversation(receiveConversation(updated.payload,undefined,allocate),ack.id);
  updated.payload.last_generation=null;
  return {target:updated,source:local.deleted?local:{...local,dirty:false},events:oldMemoryEvents(local,updated,history)};
}
