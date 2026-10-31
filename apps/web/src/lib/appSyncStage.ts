import { appTransaction,entitySelection,readEntity,restoreEntity,type AppEntity,type StoredEntity,type StoredOutbox } from './appStore';
import { deviceOwner,generationBusy } from './appContext';
import { canonical,withLibrarySnapshots,type SnapshotReferences } from './appSyncData';
import { guardStorage,readParts,storageStep,streamParts } from './segmentedStorage';
import { JsonStream } from './jsonStream';
import { jsonChunks } from './appTransfers';

type Source={header:StoredEntity;metadata?:Record<string,any>;payload?:Record<string,any>;history:SnapshotReferences;count?:number};
type Prepared={sources:Source[];batch:StoredOutbox&{revisions:Record<string,number>;withdrawn:0}};

function prepare(owner:string) {
  return appTransaction<Prepared|undefined>(['entities'],'readonly',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner()&&!generationBusy());
    const selected:StoredEntity[]=[],sources:Source[]=[];
    const prepare=()=>{
      let index=0;
      const next=()=>storageStep(tx,()=>{
        const header=selected[index++];if(!header){references();return;}
        const source:Source={header,history:{settings:[],states:[]}};sources.push(source);
        if(header.deleted){next();return;}
        if(header.kind!=='conversation'){restoreEntity(tx,header,value=>{source.payload=value!.payload;next();});return;}
        const seen={settings:new Set<string>(),states:new Set<string>()};
        const message=(value:any)=>{
          for(const kind of ['settings','states'] as const)for(const point of ['before','after']){
            const settings=value[point]?.[kind==='states'?'state':'settings'];if(!settings)continue;
            const fields=kind==='settings'?['persona_id','world_id','library_binding']:['persona_id','world_id'];
            const reference=Object.fromEntries(fields.filter(key=>Object.hasOwn(settings,key)).map(key=>[key,settings[key]])),key=canonical(reference);
            if(!seen[kind].has(key)){seen[kind].add(key);source.history[kind].push(reference);}
          }
        };
        const finish=(payload:Record<string,any>,count:number|undefined)=>{
          if(!payload||typeof payload!=='object'||Array.isArray(payload)||!Array.isArray(payload.messages)||count===undefined
            ||payload.storage_policy!=='sync'||payload.pending_generation)throw Error('Conversation sync source changed');
          source.metadata={...payload,messages:[]};source.count=count;next();
        };
        if(header.payloadParts){
          const parser=new JsonStream({onMessage:message});
          readParts(tx,[owner,'entity',header.id],header.payloadParts,value=>finish(value,parser.totalMessages),parser);
        }else{
          const payload=header.payload;if(!Array.isArray(payload?.messages))throw Error('Missing conversation body');
          for(const value of payload.messages)message(value);finish(payload,payload.messages.length);
        }
      });next();
    };
    const references=()=>storageStep(tx,()=>{
      const required=new Set<string>(),records:AppEntity[]=[];
      for(const source of sources){
        if(!source.metadata)continue;
        const settings=[source.metadata.settings??{},...source.history.settings];
        for(const setting of [...settings,source.metadata.state,...source.history.states])for(const kind of ['persona','world']){
          const reference=setting?.[kind+'_id'],match=typeof reference==='string'?reference.match(/^(created_[0-9a-f]{32})@([1-9]\d*)$/):null;
          if(match)required.add(match[1]);
        }
        for(const setting of settings)for(const [field,value] of Object.entries(setting.library_binding??{})){
          for(const ref of (field==='lorebooks'?value:[value]) as any[])if(typeof ref?.id==='string')required.add(ref.id);
        }
      }
      const finish=()=>storageStep(tx,()=>{
        for(const source of sources)if(source.metadata){
          source.payload=withLibrarySnapshots(source.metadata,records,source.history);source.history={settings:[],states:[]};
        }
        done(sources.length?{sources,batch:{request_id:crypto.randomUUID(),withdrawn:0,
          revisions:Object.fromEntries(sources.map(({header})=>[header.id,header.revision])),
          changes:sources.map(({header})=>({id:header.id,kind:header.kind,base_revision:header.serverRevision,payload:{},deleted:header.deleted,
            ...(header.deleted?{delete_confirmed:entitySelection(header).delete_confirmation_revision===header.revision}:{})}))}}:undefined);
      });
      const ids=[...required];let index=0;
      const next=()=>storageStep(tx,()=>{
        const id=ids[index++];if(id===undefined){finish();return;}
        readEntity(tx,owner,id,record=>{if(record)records.push(record);next();});
      });next();
    });
    const read=tx.objectStore('entities').openCursor(IDBKeyRange.bound([owner,''],[owner,'\uffff']));
    read.onsuccess=()=>storageStep(tx,()=>{
      const cursor=read.result;if(!cursor){prepare();return;}
      const record=cursor.value as StoredEntity,selection=entitySelection(record);
      if(record.dirty&&selection.storage_policy==='sync'&&!selection.pending_generation){
        // A deletion beyond the 50-record cap still takes the entire batch.
        if(record.deleted){selected.length=0;selected.push(record);prepare();return;}
        if(selected.length<50)selected.push(record);
      }
      cursor.continue();
    });
  });
}

/** Freeze source revisions and bytes before publishing the compact fixed-outbox header. */
export async function stageSyncBatch(owner:string) {
  const prepared=await prepare(owner);if(!prepared)return;
  return appTransaction<Prepared['batch']|undefined>(['entities','meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner()&&!generationBusy());
    const meta=tx.objectStore('meta'),key='sync:'+owner+':outbox',existing=meta.get(key),consent=meta.get('sync:'+owner+':consent');
    consent.onsuccess=()=>storageStep(tx,()=>{
      if(!consent.result){done(undefined);return;}
      if(existing.result){done(existing.result);return;}
      const output=streamParts(tx,[owner,'outbox','fixed']),encoder=new TextEncoder();let size=0;
      const append=(bytes:Uint8Array)=>{size+=bytes.length;if(size>1_000_000_000)throw Error('Storage stream exceeds transfer limit');output.append(bytes);};
      const text=(value:string)=>append(encoder.encode(value));
      const value=(item:unknown)=>{for(const bytes of jsonChunks(item))append(bytes);};
      text('[');let index=0;
      const next=()=>storageStep(tx,()=>{
        const source=prepared.sources[index],change=prepared.batch.changes[index++];
        if(!source){text(']');output.finish(ref=>{
          const batch={...prepared.batch,count:prepared.batch.changes.length,changesParts:ref};
          const write=meta.put(batch,key);write.onsuccess=()=>storageStep(tx,()=>done(batch));
        });return;}
        const read=tx.objectStore('entities').get([owner,source.header.id]);
        read.onsuccess=()=>storageStep(tx,()=>{
          if(!read.result||canonical(read.result)!==canonical(source.header))throw Error('Conversation sync source changed');
          if(index>1)text(',');
          text(JSON.stringify({id:change.id,kind:change.kind,base_revision:change.base_revision}).slice(0,-1)+',"payload":');
          const finish=()=>{text(','+JSON.stringify({deleted:change.deleted,...(change.deleted?{delete_confirmed:change.delete_confirmed}:{})}).slice(1));next();};
          if(!source.metadata){value(source.payload??{});finish();return;}
          const payload=source.payload!,keys=Object.keys(payload);let field=0;
          text('{');
          const fields=()=>storageStep(tx,()=>{
            while(field<keys.length){
              const key=keys[field++];if(field>1)text(',');text(JSON.stringify(key)+':');
              if(key!=='messages'){value(payload[key]);continue;}
              text('[');let count=0;
              const message=(item:any)=>{if(count++)text(',');value(item);};
              const complete=()=>{if(count!==source.count)throw Error('Conversation sync source changed');text(']');fields();};
              if(source.header.payloadParts){
                const parser=new JsonStream({onMessage:message});
                readParts(tx,[owner,'entity',source.header.id],source.header.payloadParts,metadata=>{
                  if(parser.totalMessages!==source.count||canonical(metadata)!==canonical(source.metadata))throw Error('Conversation sync source changed');
                  complete();
                },parser);
              }else{for(const item of source.header.payload!.messages)message(item);complete();}
              return;
            }
            text('}');finish();
          });fields();
        });
      });next();
    });
  });
}
