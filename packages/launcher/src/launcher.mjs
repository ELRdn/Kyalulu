import { readFile, writeFile, mkdir, rename, rm, open } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { extractTarGz } from './archive.mjs';

const manifestPath = fileURLToPath(new URL('../runtime-manifest.json',import.meta.url));
export function dataRoot() {
  return process.env.KYALULU_HOME || (process.platform==='win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(),'Kyalulu') : path.join(os.homedir(),'Library','Application Support','Kyalulu'));
}
export function target(platform=process.platform,arch=process.arch) {
  if (!['win32-x64','darwin-arm64'].includes(`${platform}-${arch}`)) throw Error('Supported beta targets: Windows 11 x64 and macOS Apple Silicon');
  return `${platform}-${arch}`;
}
const json = async p => JSON.parse(await readFile(p,'utf8'));
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function lock(root, action) {
  await mkdir(root,{recursive:true});
  const handle = await open(path.join(root,'launcher.lock'),'wx').catch(()=>{throw Error('Another launcher operation is running. If it crashed, inspect launcher.lock before removing it.');});
  try { await handle.writeFile(JSON.stringify({pid:process.pid,created:Date.now()})); return await action(); }
  finally { await handle.close(); await rm(path.join(root,'launcher.lock')); }
}
export function validateManifest(manifest, platform=target()) {
  if (manifest.schema!==1) throw Error('Invalid runtime manifest schema');
  if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/i.test(manifest.release || '')) throw Error('Invalid runtime release');
  const artifact = manifest.artifacts?.[platform];
  if (!artifact) throw Error('Runtime artifacts are not published for this release. Beta publication is awaiting artifact and device validation.');
  const url = new URL(artifact.url);
  if (url.protocol!=='https:' || !['github.com','objects.githubusercontent.com','release-assets.githubusercontent.com'].includes(url.hostname) || url.username || url.password || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error('Untrusted runtime manifest');
  return artifact;
}
export async function install(root, manifest, platform=target()) {
  const artifact = validateManifest(manifest,platform);
  const url = new URL(artifact.url);
  const directory = path.join(root,'releases',manifest.release);
  // Reuse only the exact downloaded artifact after rollback or a failed preflight.
  try {
    const descriptor=await json(path.join(directory,'bundle.json'));
    const hash=await readFile(path.join(directory,'.artifact-sha256'),'utf8');
    if(descriptor.release!==manifest.release || descriptor.target!==platform || descriptor.schema!==1 || hash!==artifact.sha256) throw Error('Existing runtime differs from the packaged artifact');
    return {release:manifest.release,directory};
  } catch(error) {if(error.code!=='ENOENT') throw error;}
  const stage = path.join(root,'releases',`.stage-${randomBytes(8).toString('hex')}`);
  await mkdir(stage,{recursive:true});
  try {
    const response = await fetch(url,{signal:AbortSignal.timeout(300000)});
    if (!response.ok) throw Error(`Runtime download failed (${response.status})`);
    const chunks=[]; let size=0;
    for await (const chunk of response.body) {
      size+=chunk.length;
      if(size>700_000_000) throw Error('Runtime download too large');
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    if (createHash('sha256').update(bytes).digest('hex')!==artifact.sha256) throw Error('Runtime SHA-256 mismatch');
    await extractTarGz(bytes,stage);
    const descriptor=await json(path.join(stage,'bundle.json'));
    if(descriptor.release!==manifest.release || descriptor.target!==platform || descriptor.schema!==1) throw Error('Bundle version or target mismatch');
    await writeFile(path.join(stage,'.artifact-sha256'),artifact.sha256,{flag:'wx'});
    await rename(stage,directory);
    return {release:manifest.release,directory};
  } finally { await rm(stage,{recursive:true,force:true}); }
}
async function execute(current, root, args, {detached=false,env={}}={}) {
  const descriptor=await json(path.join(current.directory,'bundle.json'));
  const executable=path.resolve(current.directory,descriptor.python);
  if(!executable.startsWith(path.resolve(current.directory)+path.sep)) throw Error('Invalid Python descriptor');
  const pythonPath=[path.join(current.directory,'runtime'),path.join(current.directory,'vendor')].join(path.delimiter);
  const log = detached ? await open(path.join(root,'runtime.log'),'a',0o600) : null;
  const child = spawn(executable,args,{cwd:current.directory,windowsHide:true,detached,
    env:{...process.env,PYTHONHOME:'',PYTHONPATH:pythonPath,PYTHONNOUSERSITE:'1',PYTHONUNBUFFERED:'1',
      KYALULU_DATA_DIR:path.join(root,'data'),KYALULU_WEB_DIST:path.join(current.directory,'web'),
      KYALULU_CLOUD_MODE:'0',KYALULU_REMOTE_MODE:'0',...env},stdio:log?['ignore',log.fd,log.fd]:'inherit'});
  const ready = new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  if(log) await log.close();
  await ready;
  return child;
}
async function owned(root) {
  let state;
  try {state=await json(path.join(root,'process.json'));} catch {return null;}
  const url=new URL(state.url);
  if(url.hostname!=='127.0.0.1' || url.protocol!=='http:') throw Error('Invalid saved local address');
  try {
    const response=await fetch(state.url+'/api/local/owner',{headers:{'x-kyalulu-owner':state.token},signal:AbortSignal.timeout(2000)});
    const owner=await response.json();
    if(response.ok && owner.owned && owner.pid===state.pid) return state;
  } catch {}
  return null;
}
async function stop(root) {
  const state=await owned(root);
  if(!state) return false;
  await fetch(state.url+'/api/local/shutdown',{method:'POST',headers:{'x-kyalulu-owner':state.token,origin:state.url},signal:AbortSignal.timeout(5000)});
  for(let i=0;i<100;i++){if(!await owned(root)){await rm(path.join(root,'process.json'),{force:true}); return true;}await delay(100);}
  throw Error('Owned runtime did not stop; no external process was killed');
}
async function runCommand(child) {
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Runtime command failed (${code})`)));});
}
async function selectRuntime(root,next,current) {
  const pending=path.join(root,'current.tmp'), previous=path.join(root,'previous.json');
  const pendingPrevious=path.join(root,'previous.tmp'), restorePrevious=path.join(root,'previous.restore.tmp');
  let oldPrevious=null, previousChanged=false, preserveRecovery=false;
  try {
    // Stage all writes before replacing either pointer. Keep the old bytes for recovery.
    await writeFile(pending,JSON.stringify(next));
    if(current) {
      oldPrevious=await readFile(previous).catch(error=>{if(error.code==='ENOENT') return null;throw error;});
      if(oldPrevious!==null) await writeFile(restorePrevious,oldPrevious);
      await writeFile(pendingPrevious,JSON.stringify(current));
      await rename(pendingPrevious,previous);
      previousChanged=true;
    }
    await rename(pending,path.join(root,'current.json'));
  } catch(error) {
    if(previousChanged) {
      try {
        if(oldPrevious===null) await rm(previous);
        else await rename(restorePrevious,previous);
      } catch(recoveryError) {
        preserveRecovery=true;
        throw new AggregateError([error,recoveryError],'Runtime selection failed; current runtime remains running. Previous pointer recovery failed; inspect previous.restore.tmp.');
      }
    }
    throw error;
  } finally {
    await rm(pending,{force:true});
    if(current) {
      await rm(pendingPrevious,{force:true});
      if(!preserveRecovery) await rm(restorePrevious,{force:true});
    }
  }
  // Selection failures must never shut down the still-selected runtime.
  await stop(root);
}
export async function main(args=process.argv.slice(2)) {
  if(Number(process.versions.node.split('.')[0])<22) throw Error('Node.js 22+ is required');
  const root=path.resolve(dataRoot()), command=args[0] || 'start';
  if(command==='help' || args.includes('--help')) {console.log('kyalulu [start|stop|doctor|update|rollback|backup <file.zip>|restore <file.zip>]\nNode.js 22+. Local Core is free; no cloud account is required.');return;}
  if(command==='doctor') {
    const manifest=await json(manifestPath);
    console.log(JSON.stringify({node:process.version,platform:`${process.platform}-${process.arch}`,home:root,
      runtime_artifact_available:!!manifest.artifacts?.[`${process.platform}-${process.arch}`],owned_runtime:!!await owned(root),le_auto_install:false},null,2));return;
  }
  if(!['start','stop','update','rollback','backup','restore'].includes(command)) throw Error('Unknown command; use kyalulu help');
  if(['backup','restore'].includes(command) && !args[1]) throw Error('Specify a ZIP file path');
  return lock(root,async()=>{
    if(command==='stop') {console.log(await stop(root)?'Owned Kyalulu runtime stopped.':'No owned runtime is running.');return;}
    let current=await json(path.join(root,'current.json')).catch(error=>{if(error.code==='ENOENT') return null;throw error;});
    if(command==='rollback') {
      const previous=await json(path.join(root,'previous.json'));
      await runCommand(await execute(previous,root,['-c','import python.api.main, fastapi, uvicorn, aiosqlite, PIL']));
      await selectRuntime(root,previous);
      console.log('Previous runtime selected. Data stays in the app-data directory.');return;
    }
    const manifest=await json(manifestPath);
    if(!current || command==='update') {
      if(current && current.release===manifest.release) {console.log('Already on the packaged manifest version.');return;}
      if(current) {
        const file=path.join(root,'backups',`before-update-${Date.now()}.zip`);
        await runCommand(await execute(current,root,['-m','python.local_backup','backup',path.join(root,'data'),file]));
      }
      const next=await install(root,manifest);
      // Verify import/startup dependencies before selecting the new release.
      await runCommand(await execute(next,root,['-c','import python.api.main, fastapi, uvicorn, aiosqlite, PIL']));
      await selectRuntime(root,next,current);
      current=next;
      if(command==='update') {console.log('Runtime updated; start with npx kyalulu.');return;}
    }
    if(['backup','restore'].includes(command)) {
      if(command==='restore') await stop(root);
      await runCommand(await execute(current,root,['-m','python.local_backup',command,path.join(root,'data'),path.resolve(args[1])]));return;
    }
    const existing=await owned(root);
    if(existing){console.log(existing.url);return;}
    const port=Number(process.env.KYALULU_PORT || 8000);
    if(!Number.isInteger(port) || port<1024 || port>65535) throw Error('Invalid local port');
    const url=`http://127.0.0.1:${port}`, token=randomBytes(32).toString('hex');
    const child=await execute(current,root,['-m','python.local_server'],{detached:true,env:{KYALULU_PORT:String(port),KYALULU_OWNER_TOKEN:token,KYALULU_TRUSTED_ORIGINS:url}});
    const state={url,token,pid:child.pid};
    child.unref();
    try {
      await writeFile(path.join(root,'process.json'),JSON.stringify(state),{mode:0o600});
      for(let i=0;i<150;i++){
        if(await owned(root)){console.log(`Kyalulu is ready: ${url}\nOpen this address in your browser. Local/BYOK uses no K-Credits.`);return;}
        if(child.exitCode!==null || child.signalCode!==null) break;
        await delay(100);
      }
      throw Error('Local runtime did not become healthy. The port may be occupied; use KYALULU_PORT to choose another port.');
    } catch(error) {
      // This handle belongs only to the child spawned above, never a saved PID.
      if(child.exitCode===null && child.signalCode===null) child.kill();
      for(let i=0;i<50 && child.exitCode===null && child.signalCode===null;i++) await delay(100);
      if(child.exitCode!==null || child.signalCode!==null) await rm(path.join(root,'process.json'),{force:true});
      throw error;
    }
  });
}
