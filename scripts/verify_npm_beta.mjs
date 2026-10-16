// Native unpacked artifact, isolated app data, no external inference.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,stat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {extractTarGz} from '../packages/launcher/src/archive.mjs';
import {createServer} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {validateManifest} from '../packages/launcher/src/launcher.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const target=`${process.platform}-${process.arch}`;
assert.ok(['win32-x64','darwin-arm64'].includes(target),'Acceptance must run on the native supported target');
const manifestFile=path.resolve(process.argv[2] || path.join(root,'.artifacts/npm-beta',`${target}.manifest.json`));
const manifest=JSON.parse(await readFile(manifestFile,'utf8'));
validateManifest(manifest,target);
const filename=path.basename(new URL(manifest.artifacts[target].url).pathname);
const bytes=await readFile(path.join(path.dirname(manifestFile),filename));
assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.artifacts[target].sha256);
// Optional output directory and npm tarball keep worker artifacts self-contained.
const output=path.resolve(process.argv[3] || path.join(root,'.artifacts'));
assert.ok(output.startsWith(root),'Verification output must stay in the workspace');
await mkdir(output,{recursive:true});
const home=await mkdtemp(path.join(output,'npm-verify-'));
const releaseDir=path.join(home,'releases',manifest.release);
await mkdir(releaseDir,{recursive:true});
await extractTarGz(bytes,releaseDir);
const descriptor=JSON.parse(await readFile(path.join(releaseDir,'bundle.json'),'utf8'));
assert.equal(descriptor.schema,1);assert.equal(descriptor.release,manifest.release);assert.equal(descriptor.target,target);
await writeFile(path.join(releaseDir,'.artifact-sha256'),manifest.artifacts[target].sha256);
await writeFile(path.join(home,'current.json'),JSON.stringify({release:manifest.release,directory:releaseDir}));
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const port=socket.address().port;await new Promise(r=>socket.close(r));
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(SystemRoot|WINDIR|COMSPEC)$/i.test(key))),
  HOME:home,USERPROFILE:home,LOCALAPPDATA:home,APPDATA:home,TEMP:home,TMP:home,TMPDIR:home,
  KYALULU_HOME:home,KYALULU_PORT:String(port),PATH:'',PYTHONHOME:'',PYTHONPATH:'',PYTHONDONTWRITEBYTECODE:'1',
  UV_PYTHON_INSTALL_DIR:'',KYALULU_OWNER_TOKEN:''};
let cli;
async function invoke(executable,args,options={}){
  return new Promise((resolve,reject)=>{
    const p=spawn(executable,args,{env,windowsHide:true,...options});let out='';
    const timer=setTimeout(()=>{p.kill();reject(Error('Verification command timed out'));},60000);
    p.stdout.on('data',v=>out+=v);p.stderr.on('data',v=>out+=v);
    p.on('error',error=>{clearTimeout(timer);reject(error);});
    p.on('exit',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(out));});
  });
}
let npmTarball=process.argv[4] && path.resolve(process.argv[4]);
if(!npmTarball){
  const npmCli=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  const packed=await invoke(process.execPath,[npmCli,'pack','--ignore-scripts','--offline','--json','--cache',path.join(home,'npm-cache'),'--pack-destination',home],{cwd:path.join(root,'packages/launcher')});
  npmTarball=path.join(home,JSON.parse(packed)[0].filename);
}
const npmBytes=await readFile(npmTarball);
await extractTarGz(npmBytes,path.join(home,'npm'),'package/package.json');
const packageInfo=JSON.parse(await readFile(path.join(home,'npm/package/package.json'),'utf8'));
assert.equal(packageInfo.version,manifest.release);assert.equal(packageInfo.name,'kyalulu');
assert.equal(Object.keys(JSON.parse(await readFile(path.join(home,'npm/package/runtime-manifest.json'),'utf8')).artifacts).length,0,'Acceptance uses the intentionally unpublished npm candidate');
cli=path.join(home,'npm/package/bin/kyalulu.mjs');
async function command(args){
  return invoke(process.execPath,[cli,...args]);
}
const url=`http://127.0.0.1:${port}`;
async function api(endpoint,method='GET',body){
  const response=await fetch(url+'/api/'+endpoint,{method,signal:AbortSignal.timeout(15000),headers:{Origin:url,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
}
try{
  await command(['start']);
  await assert.rejects(()=>command(['restore']),/Specify a ZIP/);
  await command(['start']); // Missing arguments must leave the running instance intact.
  assert.ok((await fetch(url)).ok);
  assert.ok((await api('models')).models.some(m=>m.id==='mock-echo'));
  await api('memory','POST',{scope:'npm-test',type:'semantic',content:'Character memory persists across restart'});
  const generated=await api('chat','POST',{model_id:'mock-echo',session_id:'npm-test',messages:[{role:'user',content:'Hello'}],generation_id:'npm-test-1'});
  assert.equal(generated.status,'completed');
  await command(['backup',path.join(home,'core.zip')]);
  await command(['stop']);
  await command(['start']);
  assert.equal((await api('chat/history?session_id=npm-test')).history.length,2);
  assert.equal((await api('memory?scope=npm-test')).memories.length,1);
  await api('chat/history?session_id=npm-test','DELETE');
  await command(['stop']);
  await command(['restore',path.join(home,'core.zip')]);
  await command(['start']);
  assert.equal((await api('chat/history?session_id=npm-test')).history.length,2);
  await command(['backup',path.join(home,'after-restore.zip')]);
  const beforeRestoreBackups=await readdir(path.join(home,'backups'));
  assert.ok(beforeRestoreBackups.some(name=>name.startsWith('before-restore-')));
  await writeFile(path.join(home,'previous.json'),JSON.stringify({release:manifest.release,directory:releaseDir}));
  await command(['rollback']);
  await command(['start']);
  assert.equal((await api('memory?scope=npm-test')).memories.length,1);
  const current=JSON.parse(await readFile(path.join(home,'current.json'),'utf8'));
  // Exercise the packed CLI with real native preflight/backup and a live owned Runtime.
  // Fault injection stays in the isolated test preload, never in the production launcher.
  const preload=path.join(home,'pointer-fault.mjs');
  await writeFile(preload,`import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const operation=process.env.TEST_POINTER_OPERATION;
const original=fs[operation];
fs[operation]=async(...args)=>{
  if(path.resolve(String(args[0]))===path.join(process.env.KYALULU_HOME,process.env.TEST_POINTER_FILE))
    throw Object.assign(Error('injected pointer EACCES'),{code:'EACCES'});
  return original(...args);
};
syncBuiltinESMExports();
`);
  const packagedManifest=path.join(home,'npm/package/runtime-manifest.json');
  const unpublishedManifest=await readFile(packagedManifest);
  const pointerFaultChecks=[];
  const originalCurrent=JSON.stringify({...current,release:'previous-test'});
  const originalPrevious=JSON.stringify({...current,release:'rollback-test'},null,2)+'\n';
  const originalProcess=await readFile(path.join(home,'process.json'),'utf8');
  const runningPid=JSON.parse(originalProcess).pid;
  await writeFile(path.join(home,'data/pointer-sentinel'),'isolated-private-data');
  try {
    await writeFile(packagedManifest,JSON.stringify(manifest));
    await writeFile(path.join(home,'current.json'),originalCurrent);
    await writeFile(path.join(home,'previous.json'),originalPrevious);
    async function assertPreserved() {
      assert.equal(await readFile(path.join(home,'current.json'),'utf8'),originalCurrent);
      assert.equal(await readFile(path.join(home,'previous.json'),'utf8'),originalPrevious);
      assert.equal(await readFile(path.join(home,'process.json'),'utf8'),originalProcess);
      assert.doesNotThrow(()=>process.kill(runningPid,0));
      assert.ok((await fetch(url)).ok);
      assert.equal((await api('memory?scope=npm-test')).memories.length,1);
      assert.equal((await api('chat/history?session_id=npm-test')).history.length,2);
      assert.equal(await readFile(path.join(home,'data/pointer-sentinel'),'utf8'),'isolated-private-data');
      assert.ok(!(await readdir(home)).some(name=>name.endsWith('.tmp') || name==='launcher.lock'));
    }
    for(const action of ['rollback','update']) {
      const faults=[['writeFile','current.tmp'],['rename','current.tmp']];
      if(action==='update') faults.push(['writeFile','previous.tmp'],['writeFile','previous.restore.tmp'],['rename','previous.tmp']);
      for(const [operation,file] of faults) {
        await assert.rejects(()=>invoke(process.execPath,['--import',pathToFileURL(preload).href,cli,action],{
          env:{...env,TEST_POINTER_OPERATION:operation,TEST_POINTER_FILE:file}
        }),/injected pointer EACCES/);
        await assertPreserved();pointerFaultChecks.push({action,operation,file});
      }
    }
    await command(['update']);
    assert.deepEqual(JSON.parse(await readFile(path.join(home,'current.json'),'utf8')),current);
    assert.equal(await readFile(path.join(home,'previous.json'),'utf8'),originalCurrent);
    await assert.rejects(()=>stat(path.join(home,'process.json')),error=>error.code==='ENOENT');
    await command(['start']);
    assert.equal((await api('memory?scope=npm-test')).memories.length,1);
    assert.equal((await api('chat/history?session_id=npm-test')).history.length,2);
  } finally {await writeFile(packagedManifest,unpublishedManifest);}
  // Bad/unavailable update cannot change the current pointer or the Core data.
  const pid=JSON.parse(await readFile(path.join(home,'process.json'),'utf8')).pid;
  await writeFile(path.join(home,'current.json'),JSON.stringify({...current,release:'previous-test'}));
  await assert.rejects(()=>command(['update']),/not published/);
  assert.equal(JSON.parse(await readFile(path.join(home,'current.json'),'utf8')).release,'previous-test');
  assert.equal(JSON.parse(await readFile(path.join(home,'process.json'),'utf8')).pid,pid);
  await command(['start']);
  assert.equal((await api('chat/history?session_id=npm-test')).history.length,2);
  await command(['stop']);
  const external=createHttpServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"external":true}');});
  await new Promise(r=>external.listen(port,'127.0.0.1',r));
  try {
    await assert.rejects(()=>command(['start']),/did not become healthy/);
    await assert.rejects(()=>stat(path.join(home,'process.json')),error=>error.code==='ENOENT');
    await command(['stop']);
    assert.deepEqual(await (await fetch(url)).json(),{external:true});
  } finally {await new Promise(r=>external.close(r));}
  const result={home,target,manifest:manifestFile,sha256:manifest.artifacts[target].sha256,npm_tarball:npmTarball,
    npm_sha256:createHash('sha256').update(npmBytes).digest('hex'),packaged_cli:true,python_path_removed:true,node_only_path:true,
    environment:'development_host_isolated_data_and_PATH',clean_os_accepted:false,first_download_verified:false,
    start:true,restart_memory:true,backup_restore:true,rollback:true,invalid_restore_preserved_runtime:true,
    failed_update_preserved_data:true,failed_start_cleaned_up:true,external_process_preserved:true,real_inference_attempts:0,mock_generations:1};
  result.pointer_fault_checks=pointerFaultChecks;
  result.successful_update_committed_before_shutdown=true;
  await writeFile(path.join(home,'acceptance.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {await command(['stop']);}
