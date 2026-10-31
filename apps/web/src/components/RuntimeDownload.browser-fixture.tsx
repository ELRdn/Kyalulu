/** Disposable IndexedDB + OPFS download oracle; only the OS picker is substituted. */
import { createRoot, type Root } from 'react-dom/client';
import { RuntimeDownload } from './RuntimeMedia';
import { writeResearchExperiment } from '../lib/deviceResearchStore';
import { appTransaction, newEntity } from '../lib/appStore';
import { preferences, rememberOwner, savePreferences } from '../lib/appContext';
import { Sha256 } from '../mobile/sha256';
import '../index.css';

const owner='download-fixture',id='10000000-0000-4000-8000-000000000001';
let root:Root|undefined,report:any,handle:FileSystemFileHandle;
const hash=(bytes:Uint8Array)=>new Sha256().update(bytes).digest();
export async function setup(language:'ja'|'en',mode:'file'|'fallback',fault='none',large=true) {
  root?.unmount();localStorage.setItem('kyalulu-execution-target','device');rememberOwner(owner);
  savePreferences({...preferences(),language});
  const raw_prompt=large?'架空の診断🙂\\\"\n'.repeat(180000):'Small original prompt';
  const value={revision:0,meta:{experiment_id:id,status:'completed',metrics:{turn_count:1}},turns:[{turn:1,user:'架空入力',assistant:'保存した応答',raw_prompt}],raw_prompt:'Original system',
    session:newEntity('conversation','exp:'+id,{storage_policy:'local',messages:[],state:{turn:1}},owner)};
  await writeResearchExperiment(owner,id,value);
  const expected={meta:value.meta,turns:value.turns,raw_prompt:value.raw_prompt,ratings:{},metrics:value.meta.metrics};
  const bytes=new TextEncoder().encode(JSON.stringify(expected));
  const directory=await navigator.storage.getDirectory();handle=await directory.getFileHandle('export.json',{create:true});
  const sentinel=await handle.createWritable();await sentinel.write('Original file');await sentinel.close();
  report={picker:0,activation:false,reads:0,writes:0,maximum_chunk:0,pending:0,maximum_pending:0,close:0,abort:0,expected_bytes:bytes.length,expected_sha256:hash(bytes),fault};
  Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:mode==='fallback'?undefined:async()=>{
    report.picker++;report.activation=navigator.userActivation.isActive;
    if(fault==='picker-cancel')throw new DOMException('Cancelled','AbortError');
    return {createWritable:async()=>{
      const stream=await handle.createWritable();
      return {
        write:async(chunk:Uint8Array)=>{
          report.writes++;report.maximum_chunk=Math.max(report.maximum_chunk,chunk.byteLength);report.maximum_pending=Math.max(report.maximum_pending,++report.pending);
          try{
            await stream.write(new Uint8Array(chunk));
            if(fault==='write')throw Error('Fictional disk failure');
            if(fault==='owner')rememberOwner('other-download-fixture');
          }finally{report.pending--;}
        },
        close:async()=>{if(fault==='close')throw Error('Fictional close failure');await stream.close();report.close++;},
        abort:async()=>{report.abort++;await stream.abort();},
      };
    }};
  }});
  if(fault==='corrupt')await appTransaction<void>(['meta','parts'],'readwrite',(tx,done)=>{
    const read=tx.objectStore('meta').get('device-research:'+JSON.stringify(owner)+':experiment:'+id);
    read.onsuccess=()=>{
      const ref=read.result.bodyParts,key=[owner,'research',id,ref.token,ref.chunks-1],part=tx.objectStore('parts').get(key);
      part.onsuccess=()=>{const bytes=part.result as Uint8Array;bytes[bytes.length-1]^=1;tx.objectStore('parts').put(bytes,key);done();};
    };
  });
  const get=IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get=function(key){report.reads++;return get.call(this,key);};
  root=createRoot(document.getElementById('root')!);
  root.render(<RuntimeDownload href={`/api/experiments/${id}/export`} download="experiment.json">{language==='ja'?'書き出し':'Export'}</RuntimeDownload>);
  return report;
}
export async function result(){const bytes=new Uint8Array(await (await handle.getFile()).arrayBuffer());return {...report,file_bytes:bytes.length,file_sha256:hash(bytes),original_file:new TextDecoder().decode(bytes)==='Original file'};}
export const unmount=()=>{root?.unmount();root=undefined;};
