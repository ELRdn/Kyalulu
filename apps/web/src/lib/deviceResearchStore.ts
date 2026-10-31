import { appTransaction,type AppEntity } from './appStore';
import { deviceOwner } from './appContext';
import { canonical } from './appSyncData';
import { Sha256 } from '../mobile/sha256';
import { jsonChunks } from './appTransfers';
import { deviceExecutionLockName } from './deviceExecution';
import { isGenerationHeader,validateGenerationHeader,generationSummary,writeGenerationReceipt } from './deviceGenerationStore';
import { guardStorage,readParts,writeParts,removeParts,storageStep,type Parts } from './segmentedStorage';

type Value=Record<string,any>;
export type ResearchExperiment={meta:Value;turns:Value[];raw_prompt:string;session:AppEntity;revision:number;job_id?:string};
export type ResearchExperimentSummary=Pick<ResearchExperiment,'meta'|'revision'|'job_id'>;
type StoredExperiment=ResearchExperimentSummary&{format:'device-research@1';bodyParts:Parts;catalog_sha256:string};
const prefix=(owner:string)=>'device-research:'+JSON.stringify(owner)+':experiment:';
const object=(value:any)=>value&&typeof value==='object'&&!Array.isArray(value);
const current=(owner:string)=>{if(owner!==deviceOwner())throw Error('Account changed');};
const digest=(value:unknown)=>{const hash=new Sha256();for(const bytes of jsonChunks(value))hash.update(bytes);return hash.digest();};
const textHash=(value:string)=>new Sha256().update(new TextEncoder().encode(value)).digest();
const turnFields=new Set(['turn','type','user','assistant','new_session','elapsed_ms','probe','generation_id','session_id','status',
  'user_id','assistant_id','user_content_sha256','reply_sha256','execution_lock']);
/** Unknown receipt extensions stay in canonical parts, never in a supposedly compact row too. */
export const compactResearchTurn=(turn:Value,summary:Value):Value=>({...Object.fromEntries(Object.entries(turn).filter(([name])=>turnFields.has(name))),...summary});
function compactExperiment(tx:IDBTransaction,owner:string,id:string,value:ResearchExperiment,done:(value:ResearchExperiment)=>void) {
  const turns:Value[]=[],holder={kind:'research' as const,id};let index=0;
  const compact=(turn:Value,next:(value:Value)=>void)=>{
    if(!turn?.generation_id){if(turn?.device_diagnostics)throw Error('Missing generation reference');next(turn);return;}
    const request=tx.objectStore('meta').get('generation:'+owner+':'+turn.generation_id);
    request.onsuccess=()=>storageStep(tx,()=>{
      const header=request.result;
      if(!isGenerationHeader(header)){if(turn.device_diagnostics)throw Error('Missing canonical generation');next(turn);return;}
      validateGenerationHeader(header,owner,holder,turn.generation_id);
      if(turn.session_id!==header.session_id||turn.user_id!==header.user_id||turn.assistant_id!==header.assistant_id
        ||turn.user_content_sha256!==header.user_content_sha256||turn.reply_sha256!==undefined&&turn.reply_sha256!==header.reply_sha256
        ||typeof turn.user==='string'&&textHash(turn.user)!==header.user_content_sha256
        ||typeof turn.assistant==='string'&&textHash(turn.assistant)!==header.reply_sha256
        ||typeof turn.reply==='string'&&textHash(turn.reply)!==header.reply_sha256)throw Error('Research generation changed');
      if(turn.device_diagnostics&&(turn.device_diagnostics.generation_id!==header.generation_id
        ||turn.device_diagnostics.holder?.kind!=='research'||turn.device_diagnostics.holder?.id!==id))throw Error('Research generation scope changed');
      next(compactResearchTurn(turn,generationSummary(header)));
    });
  };
  const next=()=>{
    if(index<value.turns.length){compact(value.turns[index++],turn=>{turns.push(turn);next();});return;}
    const finish=(last:Value|undefined)=>done({...value,turns,session:{...value.session,payload:{...value.session.payload,
      ...(last===undefined?{}:{last_generation:last})}}});
    const last=value.session.payload.last_generation;
    if(last)compact(last,finish);else finish(last);
  };next();
}
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
export async function writeResearchExperiment(owner:string,id:string,value:ResearchExperiment,packet?:{receipt:Value;input?:readonly unknown[]}):Promise<number> {
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
      const revision=value.revision+1;
      const write=()=>compactExperiment(tx,owner,id,{...value,revision},updated=>writeParts(tx,[owner,'research',id],updated,bodyParts=>{
        const header:StoredExperiment={...summary(updated,id),format:'device-research@1',bodyParts,catalog_sha256:catalogHash(owner,id,updated,bodyParts)};
        const saved=meta.put(header,key);saved.onsuccess=()=>removeParts(tx,[owner,'research',id],old,()=>done(revision));
      }));
      const transition=(source:ResearchExperiment|undefined)=>{
        if(source){experiment(source,owner,id);if(canonical(summary(source,id))!==canonical(summary(previous,id)))throw Error('Experiment header changed');}
        if(!packet){write();return;}
        const receipt=packet.receipt,p=value.session.payload,before=source?.session.payload,generation=receipt?.generation_id;
        if(!object(receipt)||typeof generation!=='string'||!generation||generation.length>200||receipt.session_id!=='exp:'+id
          ||receipt.execution_lock!==deviceExecutionLockName(owner)||!Number.isSafeInteger(receipt.user_id)||receipt.user_id<1
          ||!['pending','completed','failed'].includes(receipt.status)||!/^[a-f0-9]{64}$/.test(receipt.user_content_sha256)
          ||value.session.revision!==(source?.session.revision??0)+1
          ||packet.input!==undefined&&(receipt.status!=='completed'||!Array.isArray(packet.input)))throw Error('Invalid research generation');
        const user=p.messages.find((message:Value)=>message.id===receipt.user_id);
        if(user?.role!=='user'||typeof user.content!=='string'||textHash(user.content)!==receipt.user_content_sha256)throw Error('Research input changed');
        const request=meta.get('generation:'+owner+':'+generation);
        request.onsuccess=()=>storageStep(tx,()=>{
          const existing=request.result;
          if(receipt.status==='pending'){
            if(before?.pending_generation||p.pending_generation!==generation||existing!==undefined||receipt.assistant_id!==null)throw Error('Research generation already exists');
          }else{
            if(before?.pending_generation!==generation||p.pending_generation!==null||existing?.status!=='pending'
              ||['generation_id','session_id','user_id','user_content_sha256','execution_lock'].some(name=>existing[name]!==receipt[name]))throw Error('Pending research generation changed');
          }
          if(receipt.status==='completed'){
            const matches=value.turns.filter(turn=>turn.generation_id===generation),turn=matches[0],last=p.last_generation;
            if(matches.length!==1||last?.generation_id!==generation||receipt.reply!==last.reply||turn.reply!==receipt.reply||turn.assistant!==receipt.reply||turn.device_diagnostics!==undefined
              ||typeof turn.user!=='string'||textHash(turn.user)!==receipt.user_content_sha256
              ||Object.keys(receipt).some(name=>turn[name]!==receipt[name]&&digest(turn[name])!==digest(receipt[name]))
              ||p.messages.find((message:Value)=>message.id===receipt.assistant_id)?.content!==receipt.reply)throw Error('Research result changed');
            writeGenerationReceipt(tx,owner,{kind:'research',id},turn,packet.input,()=>write());return;
          }
          if(Object.keys(receipt).some(name=>!['generation_id','session_id','status','assistant_id','user_id','user_content_sha256','execution_lock'].includes(name)))throw Error('Invalid small generation receipt');
          const saved=meta.put(receipt,'generation:'+owner+':'+generation);saved.onsuccess=()=>storageStep(tx,write);
        });
      };
      if(old)readParts(tx,[owner,'research',id],old,transition);else transition(previous);
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
