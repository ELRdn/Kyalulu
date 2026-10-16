import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtemp,readFile,rm,writeFile,readdir,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import childProcess,{spawnSync,spawn} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createServer} from 'node:http';
import {fileURLToPath,pathToFileURL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {extractTarGz} from '../src/archive.mjs';
import {install,target,main} from '../src/launcher.mjs';

function tar(entries) {
  const chunks=[];
  for(const [name,content,type='0'] of entries){
    const bytes=Buffer.from(content),h=Buffer.alloc(512);
    h.write(name,0);h.write('0000644\0',100);h.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);
    h.write('        ',148);h.write(type,156);h.write('ustar\0',257);
    const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    chunks.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));
  }
  chunks.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(chunks));
}
test('safe artifact extraction and rejection of traversal/link/duplicate',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kyalulu-cli-'));
  try{
    await extractTarGz(tar([['bundle.json','{}'],['runtime/core.py','test']]),root);
    assert.equal(await readFile(path.join(root,'runtime/core.py'),'utf8'),'test');
    await extractTarGz(tar([['package/package.json','{}']]),path.join(root,'npm'),'package/package.json');
    await assert.rejects(()=>extractTarGz(tar([['README.md','no descriptor']]),path.join(root,'missing')),/Missing archive descriptor/);
    for(const entries of [[['../escape','x']],[['C:/escape','x']],[['link','x','2']],[['bundle.json','{}'],['bundle.json','{}']]])
      await assert.rejects(()=>extractTarGz(tar(entries),path.join(root,'invalid')),/Unsafe|Links/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('invalid commands and corrupt selection cannot bootstrap or replace data',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kyalulu-cli-'));
  const previous=process.env.KYALULU_HOME;
  process.env.KYALULU_HOME=root;
  try{
    await assert.rejects(()=>main(['unknown']),/Unknown command/);
    await assert.rejects(()=>main(['restore']),/Specify a ZIP/);
    assert.deepEqual(await readdir(root),[]);
    await writeFile(path.join(root,'current.json'),'{broken');
    await assert.rejects(()=>main(['start']),SyntaxError);
    assert.equal(await readFile(path.join(root,'current.json'),'utf8'),'{broken');
    assert.deepEqual(await readdir(root),['current.json']);
  } finally {
    if(previous===undefined) delete process.env.KYALULU_HOME;else process.env.KYALULU_HOME=previous;
    await rm(root,{recursive:true,force:true});
  }
});
test('unsupported targets and unavailable artifacts fail before download',async()=>{
  assert.equal(target('win32','x64'),'win32-x64');
  assert.equal(target('darwin','arm64'),'darwin-arm64');
  assert.throws(()=>target('linux','x64'),/Supported/);
  await assert.rejects(()=>install('/unused',{schema:1,release:'0.1.0',artifacts:{}},'win32-x64'),/not published/);
});
test('untrusted source and non-hash manifest rejected before network',async()=>{
  await assert.rejects(()=>install('/unused',{schema:1,release:'0.1.0',artifacts:{'win32-x64':{url:'https://evil.test/runtime',sha256:'a'.repeat(64)}}},'win32-x64'),/Untrusted/);
  await assert.rejects(()=>install('/unused',{schema:1,release:'../escape',artifacts:{}},'win32-x64'),/Invalid runtime release/);
});
test('retry and rollback reuse the exact artifact; mismatched bytes never install',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kyalulu-cli-'));
  const original=globalThis.fetch;
  const bytes=tar([['bundle.json',JSON.stringify({schema:1,release:'0.1.0',target:'win32-x64'})]]);
  const manifest={schema:1,release:'0.1.0',artifacts:{'win32-x64':{url:'https://github.com/ELRdn/Kyalulu/runtime.tar.gz',sha256:createHash('sha256').update(bytes).digest('hex')}}};
  let downloads=0;
  globalThis.fetch=async()=>{downloads++;return new Response(bytes);};
  try{
    const first=await install(root,manifest,'win32-x64');
    assert.deepEqual(await install(root,manifest,'win32-x64'),first);
    assert.equal(downloads,1);
    await assert.rejects(()=>install(root,{...manifest,artifacts:{'win32-x64':{...manifest.artifacts['win32-x64'],sha256:'0'.repeat(64)}}},'win32-x64'),/Existing runtime differs/);
    await assert.rejects(()=>install(root,{...manifest,release:'0.2.0',artifacts:{'win32-x64':{...manifest.artifacts['win32-x64'],sha256:'0'.repeat(64)}}},'win32-x64'),/SHA-256 mismatch/);
    assert.equal(await readFile(path.join(first.directory,'bundle.json'),'utf8'),JSON.stringify({schema:1,release:'0.1.0',target:'win32-x64'}));
  } finally {globalThis.fetch=original;await rm(root,{recursive:true,force:true});}
});
test('reviewed manifest validation fails before changing the publication manifest',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kyalulu-cli-'));
  const manifestFile=new URL('../runtime-manifest.json',import.meta.url);
  const before=await readFile(manifestFile,'utf8');
  try{
    const gate={device_accepted:true,license_reviewed:true};
    const artifact={url:'https://github.com/ELRdn/Kyalulu/runtime.tar.gz',sha256:'a'.repeat(64)};
    for(const release of ['../escape','0.1.0-beta.1']){
      const a=path.join(root,'a.json'), b=path.join(root,'b.json');
      await writeFile(a,JSON.stringify({schema:1,release,gates:gate,artifacts:{'win32-x64':artifact}}));
      await writeFile(b,JSON.stringify({schema:1,release,gates:gate,artifacts:{'darwin-arm64':{...artifact,url:'https://untrusted.test/runtime.tar.gz'}}}));
      const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../../scripts/prepare_npm_manifest.mjs',import.meta.url)),a,b],{encoding:'utf8',windowsHide:true});
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/package version|Untrusted/);
      assert.equal(await readFile(manifestFile,'utf8'),before);
    }
  } finally {await rm(root,{recursive:true,force:true});}
});

test('update and rollback commit failures preserve the live PID, data and both pointers',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'kyalulu-pointer-'));
  const savedHome=process.env.KYALULU_HOME;
  const originalSpawn=childProcess.spawn, originalWrite=fs.writeFile, originalRename=fs.rename;
  const source=await readFile(new URL('../src/launcher.mjs',import.meta.url),'utf8');
  const archive=await readFile(new URL('../src/archive.mjs',import.meta.url),'utf8');
  try {
    // Isolated manifest and native-command stand-ins; no publication file is modified.
    await mkdir(path.join(root,'src'));
    await writeFile(path.join(root,'src/launcher.mjs'),source);
    await writeFile(path.join(root,'src/archive.mjs'),archive);
    const platform=target(), hash='a'.repeat(64), release='0.1.0';
    await writeFile(path.join(root,'runtime-manifest.json'),JSON.stringify({schema:1,release,artifacts:{[platform]:{url:'https://github.com/ELRdn/Kyalulu/test.tar.gz',sha256:hash}}}));
    const {main:isolatedMain}=await import(pathToFileURL(path.join(root,'src/launcher.mjs')));
    childProcess.spawn=()=>originalSpawn(process.execPath,['-e','process.exit(0)'],{windowsHide:true,stdio:'ignore'});
    syncBuiltinESMExports();
    for(const command of ['update','rollback']) {
      const faults=[['writeFile','current.tmp'],['rename','current.tmp']];
      if(command==='update') faults.push(['writeFile','previous.tmp'],['writeFile','previous.restore.tmp'],['rename','previous.tmp']);
      for(const [operation,filename,missingPrevious=false] of [...faults,[null,null],...(command==='update'?[['rename','current.tmp',true]]:[])]) await t.test(`${command}: ${operation || 'successful commit'} ${filename || ''}${missingPrevious?' without previous pointer':''}`,async()=>{
        const home=await mkdtemp(path.join(root,'case-'));
        process.env.KYALULU_HOME=home;
        const directory=path.join(home,'releases',release);
        await mkdir(directory,{recursive:true});
        await writeFile(path.join(directory,'bundle.json'),JSON.stringify({schema:1,release,target:platform,python:'python.exe'}));
        await writeFile(path.join(directory,'.artifact-sha256'),hash);
        const current=JSON.stringify({release:'0.0.1',directory});
        const previous=JSON.stringify({release:'0.0.0',directory},null,2)+'\n';
        await writeFile(path.join(home,'current.json'),current);
        if(!missingPrevious) await writeFile(path.join(home,'previous.json'),previous);
        await mkdir(path.join(home,'data'));
        await writeFile(path.join(home,'data/sentinel'),'private-test-data');
        const running=originalSpawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
        await new Promise((resolve,reject)=>{running.once('spawn',resolve);running.once('error',reject);});
        let shutdowns=0, alive=true, injected=false;
        const server=createServer((req,res)=>{
          res.setHeader('Content-Type','application/json');
          if(req.url==='/api/local/shutdown') {
            // The stopping boundary must see already-committed pointers.
            assert.equal(JSON.parse(requirePointer()).release,command==='update'?release:'0.0.0');
            shutdowns++;alive=false;running.kill();res.end('{}');
          } else res.end(JSON.stringify({owned:alive,pid:running.pid}));
        });
        // A synchronous read in the shutdown handler checks ordering at the actual call.
        const {readFileSync}=await import('node:fs');
        function requirePointer(){return readFileSync(path.join(home,'current.json'),'utf8');}
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        await writeFile(path.join(home,'process.json'),JSON.stringify({pid:running.pid,token:'isolated-test-token',url:`http://127.0.0.1:${server.address().port}`}));
        if(operation) {
          fs[operation]=async(...args)=>{
            if(path.resolve(String(args[0]))===path.join(home,filename)) {
              injected=true;throw Object.assign(Error('injected pointer EACCES'),{code:'EACCES'});
            }
            return (operation==='writeFile'?originalWrite:originalRename)(...args);
          };
          syncBuiltinESMExports();
        }
        try {
          if(operation) {
            await assert.rejects(()=>isolatedMain([command]),{code:'EACCES'});
            assert.equal(injected,true);assert.equal(shutdowns,0);
            assert.doesNotThrow(()=>process.kill(running.pid,0));
            assert.equal(JSON.parse(await readFile(path.join(home,'process.json'),'utf8')).pid,running.pid);
            assert.equal(await readFile(path.join(home,'current.json'),'utf8'),current);
            if(missingPrevious) await assert.rejects(()=>readFile(path.join(home,'previous.json')),{code:'ENOENT'});
            else assert.equal(await readFile(path.join(home,'previous.json'),'utf8'),previous);
          } else {
            await isolatedMain([command]);assert.equal(shutdowns,1);
            assert.equal(JSON.parse(await readFile(path.join(home,'current.json'),'utf8')).release,command==='update'?release:'0.0.0');
            assert.equal(await readFile(path.join(home,'previous.json'),'utf8'),command==='update'?current:previous);
          }
          assert.equal(await readFile(path.join(home,'data/sentinel'),'utf8'),'private-test-data');
          assert.ok(!(await readdir(home)).some(name=>name.endsWith('.tmp') || name==='launcher.lock'));
        } finally {
          fs.writeFile=originalWrite;fs.rename=originalRename;syncBuiltinESMExports();
          if(running.exitCode===null && running.signalCode===null) running.kill();
          await new Promise(resolve=>server.close(resolve));
          if(running.exitCode===null && running.signalCode===null) await new Promise(resolve=>running.once('exit',resolve));
        }
      });
    }
  } finally {
    childProcess.spawn=originalSpawn;fs.writeFile=originalWrite;fs.rename=originalRename;syncBuiltinESMExports();
    if(savedHome===undefined) delete process.env.KYALULU_HOME;else process.env.KYALULU_HOME=savedHome;
    await rm(root,{recursive:true,force:true});
  }
});
