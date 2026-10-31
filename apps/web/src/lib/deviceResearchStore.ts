import { appTransaction,type AppEntity } from './appStore';
import { deviceOwner } from './appContext';
import { canonical } from './appSyncData';
import { Sha256 } from '../mobile/sha256';
import { guardStorage,readParts,writeParts,removeParts,storageStep,type Parts } from './segmentedStorage';

type Value=Record<string,any>;
export type ResearchExperiment={meta:Value;turns:Value[];raw_prompt:string;session:AppEntity;revision:number;job_id?:string};
export type ResearchExperimentSummary=Pick<ResearchExperiment,'meta'|'revision'|'job_id'>;
type StoredExperiment=ResearchExperimentSummary&{format:'device-research@1';bodyParts:Parts;catalog_sha256:string};
const prefix=(owner:string)=>'device-research:'+JSON.stringify(owner)+':experiment:';
const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value);
const current=(owner:string)=>{if(owner!==deviceOwner())throw Error('Account changed');};
function summary(value:any,id:string):ResearchExperimentSummary {
  if(!object(value)||!object(value.meta)||value.meta.experiment_id!==id||!Number.isSafeInteger(value.revision)||value.revision<0
    ||value.job_id!==undefined&&typeof value.job_id!=='string')throw Error('Invalid saved experiment');
  return {meta:value.meta,revision:value.revision,...(value.job_id===undefined?{}:{job_id:value.job_id})};
}
function experiment(value:any,owner:string,id:string):asserts value is ResearchExperiment {
  summary(value,id);
  if(!Array.isArray(value.turns)||typeof value.raw_prompt!=='string'||!object(value.session)||value.session.owner!==owner
    ||value.session.id!=='exp:'+id||value.session.kind!=='conversation'||!object(value.session.payload)
    ||value.session.payload.storage_policy!=='local'||!Array.isArray(value.session.payload.messages))throw Error('Invalid saved experiment body');
}
const catalogHash=(owner:string,id:string,value:ResearchExperimentSummary,parts:Parts)=>
  new Sha256().update(new TextEncoder().encode(canonical([owner,id,summary(value,id),parts]))).digest();
function stored(value:any,owner:string,id:string):value is StoredExperiment {
  if(!Object.hasOwn(value,'format')&&!Object.hasOwn(value,'bodyParts'))return false;
  if(value.format!=='device-research@1'||!object(value.bodyParts)
    ||value.catalog_sha256!==catalogHash(owner,id,value,value.bodyParts))throw Error('Invalid saved experiment manifest');
  return true;
}
export async function readResearchExperiment(owner:string,id:string):Promise<ResearchExperiment|undefined> {
  current(owner);
  const value=await appTransaction<ResearchExperiment|undefined>(['meta','parts'],'readonly',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const read=tx.objectStore('meta').get(prefix(owner)+id);read.onsuccess=()=>storageStep(tx,()=>{
      const header=read.result;if(header===undefined){done(undefined);return;}
      const expected=summary(header,id);
      if(!stored(header,owner,id)){experiment(header,owner,id);done(header);return;}
      readParts(tx,[owner,'research',id],header.bodyParts,body=>{
        experiment(body,owner,id);
        if(canonical(summary(body,id))!==canonical(expected))throw Error('Saved experiment header changed');
        done(body);
      });
    });
  });current(owner);return value;
}
export async function writeResearchExperiment(owner:string,id:string,value:ResearchExperiment):Promise<number> {
  current(owner);experiment(value,owner,id);
  return appTransaction<number>(['meta','parts'],'readwrite',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const meta=tx.objectStore('meta'),key=prefix(owner)+id,read=meta.get(key);
    read.onsuccess=()=>storageStep(tx,()=>{
      const previous=read.result;
      if(previous!==undefined){summary(previous,id);if(!stored(previous,owner,id))experiment(previous,owner,id);}
      if((previous?.revision??0)!==value.revision)throw Error('Experiment changed; reload before saving');
      if(value.revision===Number.MAX_SAFE_INTEGER)throw Error('Experiment revision exhausted');
      const old=previous!==undefined&&stored(previous,owner,id)?previous.bodyParts:undefined;
      const revision=value.revision+1,updated={...value,revision};
      const write=()=>writeParts(tx,[owner,'research',id],updated,bodyParts=>{
        const header:StoredExperiment={...summary(updated,id),format:'device-research@1',bodyParts,catalog_sha256:catalogHash(owner,id,updated,bodyParts)};
        const saved=meta.put(header,key);saved.onsuccess=()=>removeParts(tx,[owner,'research',id],old,()=>done(revision));
      });
      if(old)readParts(tx,[owner,'research',id],old,write,false);else write();
    });
  });
}
/** Only catalog metadata leaves each cursor step; completed bodies are not read. */
export async function listResearchExperiments(owner:string):Promise<ResearchExperimentSummary[]> {
  current(owner);
  const rows=await appTransaction<ResearchExperimentSummary[]>(['meta'],'readonly',(tx,done)=>{
    guardStorage(tx,()=>owner===deviceOwner());
    const rows:ResearchExperimentSummary[]=[],start=prefix(owner);
    const read=tx.objectStore('meta').openCursor(IDBKeyRange.bound(start,start+'\uffff'));
    read.onsuccess=()=>storageStep(tx,()=>{
      const cursor=read.result;if(!cursor){done(rows);return;}
      const value=cursor.value,id=String(cursor.key).slice(start.length);stored(value,owner,id);rows.push(summary(value,id));cursor.continue();
    });
  });current(owner);return rows;
}
