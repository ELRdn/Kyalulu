"""Exercise both actual WASM variants and CPU with the cached test-only Kyalulu.

Requires pnpm --filter web exec vite --mode mobile --port 5187 --strictPort.
Uses the same isolated profile/origin as scripts/verify_mobile.py. This is a
Chrome runtime test; neither a physical Safari result nor baseline equivalence.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import TimeoutError as PlaywrightTimeoutError, async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'.artifacts/mobile-validation'

async def main(runtime_root=None, output=OUT):
    runtime_root=(runtime_root or ROOT/'.artifacts/mobile-wasm').resolve()
    output=output.resolve()
    assert runtime_root.is_relative_to(ROOT/'.artifacts') and output.is_relative_to(ROOT/'.artifacts')
    for variant in ('standard','compat'):
        assert all((runtime_root/('build-'+variant)/name).is_file() for name in ('wllama.js','wllama.wasm'))
    runtime_hashes={variant:{name:hashlib.sha256((runtime_root/('build-'+variant)/name).read_bytes()).hexdigest()
                            for name in ('wllama.js','wllama.wasm')} for variant in ('standard','compat')}
    output.mkdir(parents=True,exist_ok=True)
    fixture=output/'runtime-check.html'
    prefix='/@fs/'+ROOT.as_posix()+'/'
    html=r'''<!doctype html><meta charset="utf-8"><button id="run">Run isolated WASM verification</button><pre id="result"></pre><script type="module">
import {Wllama} from 'PREFIXapps/web/node_modules/@wllama/wllama/esm/index.js';
import {Sha256} from 'PREFIXapps/web/src/mobile/sha256.ts';
async function hashStream(stream){
 const hash=new Sha256(),reader=stream.getReader();
 try{for(;;){const {value,done}=await reader.read();if(done)break;hash.update(value);}}finally{reader.releaseLock();}
 return hash.digest();
}
window.done=false;window.records=[];window.verified=[];window.backendLogs=[];window.stage='ready';document.querySelector('#run').onclick=async()=>{
try {
 window.stage='model integrity';
 if(!crossOriginIsolated)throw Error('Runtime verification requires cross-origin isolation');
 const catalog=await(await fetch('PREFIXapps/web/src/mobile/catalog.generated.json')).json(),m=catalog.find(m=>m.id==='kyalulu-iq3m');
 const dir=await(await(await navigator.storage.getDirectory()).getDirectoryHandle('kyalulu-mobile-models')).getDirectoryHandle(m.id),files=[];
 for(const f of m.files){
  console.log('Verifying cached model: '+f.path);
  const file=await(await dir.getFileHandle(f.sha256)).getFile();if(file.size!==f.bytes)throw Error('Missing verified test model');
  if(await hashStream(file.stream())!==f.sha256)throw Error('Cached test model hash mismatch: '+f.path);
  window.verified.push({path:f.path,bytes:f.bytes,sha256:f.sha256});files.push(file);
 }
 for(const variant of ['standard','compat','cpu']){
  document.querySelector('#result').textContent='Running '+variant;console.log('Runtime variant: '+variant);
  const compat=variant==='compat',build=compat?'compat':'standard',root=new URL(RUNTIME_ROOT+'build-'+build+'/',location.href).href;
  // Vite transforms direct JS requests; raw imports retain the worker's original glue code.
  const {default:code}=await import(/* @vite-ignore */ root+'wllama.js?raw');
  const jsHash=new Sha256().update(new TextEncoder().encode(code)).digest(),wasm=await fetch(root+'wllama.wasm');
  if(!wasm.ok)throw Error('Runtime WASM request failed: '+wasm.status);
  const wasmHash=await hashStream(wasm.body);
  if(jsHash!==RUNTIME_HASHES[build]['wllama.js']||wasmHash!==RUNTIME_HASHES[build]['wllama.wasm'])throw Error('Runtime asset hash mismatch');
  const backendLogs=window.backendLogs=[],capture=(...args)=>{const text=args.map(String).join(' ');if(/offload|WebGPU|model buffer|error|failed|abort|exception/i.test(text))backendLogs.push(text.slice(0,1000));};
  const w=new Wllama({default:root+'wllama.wasm'},{allowOffline:true,logger:{debug:capture,log:capture,warn:capture,error:capture}});
  w.getWorkerResources=()=>({wasmPath:root+'wllama.wasm',jsPath:{code},compat});
  const start=performance.now();let loaded=false;try{
  window.stage=variant+' load';console.log('Runtime stage: '+window.stage);
  await w.loadModel(files,{n_ctx:512,n_batch:32,n_ubatch:32,n_parallel:1,n_gpu_layers:variant==='cpu'?0:99999,n_threads:1,reasoning:false,jinja:true,default_template_kwargs:{enable_thinking:false},ctx_shift:false});
  loaded=true;
  window.stage=variant+' generation';console.log('Runtime stage: '+window.stage);
  const result=await w.createChatCompletion({messages:[{role:'system',content:'日本語で短く挨拶してください。'},{role:'user',content:'こんにちは。'}],temperature:0,max_tokens:8,seed:12345,top_p:1,top_k:64,chat_template_kwargs:{enable_thinking:false}});
  const offload=backendLogs.map(text=>text.match(/offloaded\s+(\d+)\/\d+\s+layers to GPU/)).find(Boolean);
  window.records.push({variant,compat,contextTokens:512,maxOutputTokens:8,requestedGpuLayers:variant==='cpu'?0:99999,
    offloadedGpuLayers:offload?Number(offload[1]):null,runtimeHashes:{js:jsHash,wasm:wasmHash},backendLogs,response:result.choices[0].message.content,elapsedMs:performance.now()-start,debug:await w._getDebugInfo()});
  }finally{if(loaded){window.stage=variant+' exit';await w.exit();}}
 }
 window.result={records:window.records,verifiedModelFiles:window.verified,standardCompatExactEqual:window.records[0].response===window.records[1].response,physicalPhone:false};
}catch(e){window.result={records:window.records,verifiedModelFiles:window.verified,stage:window.stage,backendLogs:window.backendLogs,error:String(e),physicalPhone:false};}
document.querySelector('#result').textContent=JSON.stringify(window.result,null,2);window.done=true;
};</script>'''
    runtime_url='/@fs/'+runtime_root.as_posix()+'/'
    fixture.write_text(html.replace('PREFIX',prefix).replace('RUNTIME_ROOT',json.dumps(runtime_url)).replace('RUNTIME_HASHES',json.dumps(runtime_hashes)),encoding='utf-8')
    blocked=[]
    errors=[]
    async with async_playwright() as p:
        context=await p.chromium.launch_persistent_context(str(ROOT/'.artifacts/mobile-test-browser'),channel='chrome',headless=True,service_workers='block',args=['--enable-unsafe-webgpu','--disable-background-networking'])
        async def local_only(route):
            url=urlsplit(route.request.url)
            if url.hostname=='localhost' and url.port==5187 and not url.path.startswith('/api/'):
                await route.continue_()
            else:
                blocked.append(route.request.url);await route.abort()
        await context.route('**/*',local_only)
        page=await context.new_page()
        page.on('console',lambda m:print(m.text,flush=True) if m.text.startswith(('Runtime variant:','Runtime stage:','Verifying cached model:')) else None)
        page.on('pageerror',lambda error:errors.append(str(error)))
        try:
            await page.goto('http://localhost:5187/@fs/'+fixture.as_posix())
            await page.locator('#run').click()
            for _ in range(20):
                try:
                    await page.wait_for_function('()=>window.done',timeout=30000)
                    break
                except PlaywrightTimeoutError:
                    progress=await page.evaluate('({stage:window.stage,backendLogs:window.backendLogs ?? [],completedVariants:window.records?.length ?? 0})')
                    (output/'progress.json').write_text(json.dumps(progress,ensure_ascii=False,indent=2),encoding='utf-8')
                    print('Runtime observation: '+json.dumps(progress,ensure_ascii=False),flush=True)
            else:
                raise TimeoutError('Runtime verification did not complete within 600 seconds')
            result=await page.evaluate('window.result')
        except Exception as e:
            result={**await page.evaluate('({records:window.records ?? [],verifiedModelFiles:window.verified ?? [],stage:window.stage,backendLogs:window.backendLogs ?? []})'),
                    'error':str(e),'physicalPhone':False}
        finally:
            await context.close()
        result['blockedRequests']=blocked
        result['pageErrors']=errors
        (output/'runtime-variants.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False),flush=True)
        assert not result.get('error'),result
        assert not blocked,result
        assert not errors,result
        assert len(result['records'])==3 and result['standardCompatExactEqual']
        assert all(r['response'] and r['debug']['pleLazy'] and r['debug']['pleBytesRead']>0 for r in result['records'])
        assert all((r['offloadedGpuLayers'] or 0)>0 for r in result['records'][:2]),'GPU offload was not confirmed'

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-root',type=Path,help='Fresh build-standard/build-compat parent inside .artifacts')
    parser.add_argument('--output',type=Path,default=OUT)
    args=parser.parse_args()
    asyncio.run(main(args.runtime_root,args.output))
