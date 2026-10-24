import catalog from './catalog.generated.json';
import type { MobileModel, ModelFile } from './types';
import { deleteModelStatus, modelStatuses, saveModelStatus } from './store';
import { Sha256 } from './sha256';

export const MODELS = catalog as MobileModel[];
export function fingerprint(m:MobileModel) {return JSON.stringify([m.runtime,m.revision,m.distributionRevision,m.files.map(f=>[f.path,f.bytes,f.sha256])]);}
export const modelBytes=(m:MobileModel)=>m.files.reduce((n,f)=>n+f.bytes,0);
export const formatBytes=(n:number)=>`${(n/1024**3).toFixed(2)} GiB`;
export function validateCatalog(models:MobileModel[]) {
  const ids=new Set<string>();
  for(const m of models) {
    if(ids.has(m.id)||!/^[a-z0-9-]+$/.test(m.id)||!['gguf','onnx'].includes(m.runtime)||!/^[a-f0-9]{40}$/.test(m.revision)) throw Error('不正なモデル登録');
    ids.add(m.id);const paths=new Set<string>();
    for(const f of m.files) {
      const u=new URL(f.url);
      if(paths.has(f.path)||!f.path||f.path.split('/').some(s=>s==='..'||s==='.')||u.origin!=='https://huggingface.co'||!u.pathname.includes('/resolve/')||u.search||
        !Number.isSafeInteger(f.bytes)||f.bytes<=0||!/^[a-f0-9]{64}$/.test(f.sha256)||!u.pathname.split('/').some(s=>/^[a-f0-9]{40}$/.test(s))) throw Error('不正なモデルファイル');
      if(m.runtime==='gguf'&&f.bytes>=2**31) throw Error('GGUFは2GiB未満の分割が必要です。');
      paths.add(f.path);
    }
  }
}
validateCatalog(MODELS);
async function directory(m:MobileModel) {
  if(typeof navigator.storage?.getDirectory!=='function')throw Error('このブラウザはモデルを保存するOPFSに対応していません。最新版のChromeまたはSafariで開いてください。');
  const root=await navigator.storage.getDirectory();
  const models=await root.getDirectoryHandle('kyalulu-mobile-models',{create:true});
  return models.getDirectoryHandle(m.id,{create:true});
}
const diskName=(f:ModelFile)=>f.sha256;
export async function openModelFile(m:MobileModel,f:ModelFile) {return (await (await directory(m)).getFileHandle(diskName(f))).getFile();}
async function verify(file:File,expected:ModelFile,signal?:AbortSignal) {
  if(file.size!==expected.bytes)return false;
  const h=new Sha256();const reader=file.stream().getReader();
  try {while(true){signal?.throwIfAborted();const r=await reader.read();if(r.done)break;h.update(r.value);}}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return h.digest()===expected.sha256;
}
export async function importModel(m:MobileModel,signal:AbortSignal,read:(file:ModelFile,offset:number)=>Promise<Uint8Array>,progress:(loaded:number,total:number)=>void) {
  validateCatalog([m]);
  if(!m.files.length)throw Error('Model files unavailable');
  const transfer=async()=>{
    const dir=await directory(m),total=modelBytes(m);let loaded=0;
    for(const f of m.files){
      signal.throwIfAborted();
      try{if(await verify(await openModelFile(m,f),f,signal)){loaded+=f.bytes;progress(loaded,total);continue;}}
      catch(error){if(signal.aborted)throw error;}
      await deleteModelStatus(m.id);
      const estimate=await navigator.storage.estimate();
      if(estimate.quota!==undefined&&estimate.usage!==undefined&&estimate.quota-estimate.usage<f.bytes+64*1024**2)throw Error('Storage full / 端末の保存容量が不足しています');
      const writer=await (await dir.getFileHandle(diskName(f),{create:true})).createWritable();
      try{
        let offset=0;const hash=new Sha256();
        while(offset<f.bytes){
          signal.throwIfAborted();const bytes=await read(f,offset);signal.throwIfAborted();
          if(!(bytes instanceof Uint8Array)||bytes.length!==Math.min(1024**2,f.bytes-offset))throw Error('Migration chunk size mismatch');
          hash.update(bytes);await writer.write(bytes.slice());offset+=bytes.length;progress(loaded+offset,total);
        }
        if(hash.digest()!==f.sha256)throw Error('Migration SHA-256 mismatch');
        signal.throwIfAborted();await writer.close();loaded+=f.bytes;
      }catch(error){await writer.abort().catch(()=>{});throw error;}
    }
    signal.throwIfAborted();await saveModelStatus({id:m.id,fingerprint:fingerprint(m),verifiedAt:new Date().toISOString()});
  };
  // OPFS swaps a writable only on close; a failed transfer keeps the existing file.
  if(!navigator.locks)throw Error('Web Locks required / 対応ブラウザで開いてください');
  return navigator.locks.request('kyalulu-model:'+m.id,{signal},transfer);
}
export async function readyModels() {
  const result=new Set<string>();
  for(const status of await modelStatuses()) {
    const m=MODELS.find(m=>m.id===status.id);
    if(!m?.files.length||fingerprint(m)!==status.fingerprint)continue;
    try {for(const f of m.files){const file=await openModelFile(m,f);if(file.size!==f.bytes)throw Error('missing');}result.add(m.id);}catch{/* Browser eviction invalidates readiness. */}
  }
  return result;
}
export async function downloadModel(m:MobileModel,signal:AbortSignal,progress:(loaded:number,total:number,stage:string)=>void) {
  const transfer=()=>download(m,signal,progress);
  return navigator.locks?navigator.locks.request('kyalulu-model:'+m.id,{signal},transfer):transfer();
}
async function download(m:MobileModel,signal:AbortSignal,progress:(loaded:number,total:number,stage:string)=>void) {
  if(!m.files.length)throw Error('このモデルの分割配布はまだ準備中です。');
  await deleteModelStatus(m.id);
  const dir=await directory(m);const total=modelBytes(m);let loaded=0;
  const estimate=await navigator.storage.estimate();
  let existing=0;
  for(const f of m.files)try{existing+=(await openModelFile(m,f)).size;}catch{}
  if(estimate.quota!==undefined&&estimate.usage!==undefined&&estimate.quota-estimate.usage<total-existing+64*1024**2) throw Error('端末の保存容量が不足しています。不要なモデルを削除してください。');
  await navigator.storage.persist?.().catch(()=>false);
  for(const f of m.files) {
    signal.throwIfAborted();
    try {
      const file=await openModelFile(m,f);
      progress(loaded,total,'保存済みファイルを検証中');
      if(await verify(file,f,signal)){loaded+=f.bytes;progress(loaded,total,'保存済みファイルを再利用');continue;}
    } catch(e) {if(signal.aborted)throw e;}
    const handle=await dir.getFileHandle(diskName(f),{create:true});
    const writer=await handle.createWritable();
    let reader:ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>|undefined;
    try {
      const response=await fetch(f.url,{signal,credentials:'omit',cache:'no-store'});
      if(!response.ok||!response.body)throw Error(`モデルの取得に失敗しました（HTTP ${response.status}）。`);
      reader=response.body.getReader();let bytes=0;const hash=new Sha256();
      while(true) {
        signal.throwIfAborted();const r=await reader.read();if(r.done)break;
        bytes+=r.value.length;if(bytes>f.bytes)throw Error('モデルのサイズが登録内容と異なります。');
        hash.update(r.value);await writer.write(r.value);progress(loaded+bytes,total,'ダウンロード中');
      }
      if(bytes!==f.bytes||hash.digest()!==f.sha256)throw Error('モデルのサイズまたはSHA-256が一致しません。再試行してください。');
      await writer.close();loaded+=bytes;
    } catch(e) {
      await writer.abort().catch(()=>{});await dir.removeEntry(diskName(f)).catch(()=>{});throw e;
    } finally {await reader?.cancel().catch(()=>{});reader?.releaseLock();}
  }
  signal.throwIfAborted();
  await saveModelStatus({id:m.id,fingerprint:fingerprint(m),verifiedAt:new Date().toISOString()});
  progress(total,total,'検証・保存完了');
}
export async function removeModel(m:MobileModel) {
  const remove=async()=>{
    await deleteModelStatus(m.id);
    const dir=await directory(m);
    for(const f of m.files)await dir.removeEntry(diskName(f)).catch((e:DOMException)=>{if(e.name!=='NotFoundError')throw e;});
  };
  return navigator.locks?navigator.locks.request('kyalulu-model:'+m.id,remove):remove();
}
