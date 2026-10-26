"""Exercise both actual WASM variants and CPU with the cached test-only Kyalulu.

Requires pnpm --filter web exec vite --mode mobile --port 5187 --strictPort.
Uses the same isolated profile/origin as scripts/verify_mobile.py. This is a
Chrome runtime test; neither a physical Safari result nor baseline equivalence.
"""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'.artifacts/mobile-validation'

async def main():
    fixture=ROOT/'.artifacts/mobile-wasm/runtime-check.html'
    prefix='/@fs/'+ROOT.as_posix()+'/'
    html='''<!doctype html><meta charset="utf-8"><button id="run">Run isolated WASM verification</button><pre id="result"></pre><script type="module">
import {Wllama} from 'PREFIXapps/web/node_modules/@wllama/wllama/esm/index.js';
window.done=false;window.records=[];document.querySelector('#run').onclick=async()=>{
try {
 const catalog=await(await fetch('PREFIXapps/web/src/mobile/catalog.generated.json')).json(),m=catalog.find(m=>m.id==='kyalulu-iq3m');
 const dir=await(await(await navigator.storage.getDirectory()).getDirectoryHandle('kyalulu-mobile-models')).getDirectoryHandle(m.id),files=[];
 for(const f of m.files){const file=await(await dir.getFileHandle(f.sha256)).getFile();if(file.size!==f.bytes)throw Error('Missing verified test model');files.push(file);}
 for(const variant of ['standard','compat','cpu']){
  document.querySelector('#result').textContent='Running '+variant;console.log('Runtime variant: '+variant);
  const compat=variant==='compat',root=new URL('/runtime/'+(compat?'compat':'standard')+'/',location.href).href,code=await(await fetch(root+'wllama.js')).text();
  const w=new Wllama({default:root+'wllama.wasm'},{allowOffline:true,logger:{debug:()=>{},log:()=>{},warn:console.warn,error:console.error}});
  w.getWorkerResources=()=>({wasmPath:root+'wllama.wasm',jsPath:{code},compat});
  const start=performance.now();
  await w.loadModel(files,{n_ctx:512,n_batch:32,n_ubatch:32,n_parallel:1,n_gpu_layers:variant==='cpu'?0:99999,n_threads:1,reasoning:false,jinja:true,default_template_kwargs:{enable_thinking:false},ctx_shift:false});
  const result=await w.createChatCompletion({messages:[{role:'system',content:'日本語で短く挨拶してください。'},{role:'user',content:'こんにちは。'}],temperature:0,max_tokens:8,seed:12345,top_p:1,top_k:64,chat_template_kwargs:{enable_thinking:false}});
  window.records.push({variant,compat,contextTokens:512,maxOutputTokens:8,response:result.choices[0].message.content,elapsedMs:performance.now()-start,debug:await w._getDebugInfo()});
  await w.exit();
 }
 window.result={records:window.records,standardCompatExactEqual:window.records[0].response===window.records[1].response,physicalPhone:false};
}catch(e){window.result={records:window.records,error:String(e),physicalPhone:false};}
document.querySelector('#result').textContent=JSON.stringify(window.result,null,2);window.done=true;
};</script>'''
    fixture.write_text(html.replace('PREFIX',prefix),encoding='utf-8')
    async with async_playwright() as p:
        context=await p.chromium.launch_persistent_context(str(ROOT/'.artifacts/mobile-test-browser'),channel='chrome',headless=True,args=['--enable-unsafe-webgpu'])
        page=await context.new_page()
        page.on('console',lambda m:print(m.text,flush=True) if m.text.startswith('Runtime variant:') else None)
        await page.goto('http://localhost:5187'+prefix+'.artifacts/mobile-wasm/runtime-check.html')
        await page.locator('#run').click()
        try:
            await page.wait_for_function('()=>window.done',timeout=300000)
            result=await page.evaluate('window.result')
        except Exception as e:
            result={'error':str(e),'records':await page.evaluate('window.records'),'physicalPhone':False}
        (OUT/'runtime-variants.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False),flush=True)
        await context.close()
        assert not result.get('error'),result
        assert len(result['records'])==3 and result['standardCompatExactEqual']
        assert all(r['response'] and r['debug']['pleLazy'] and r['debug']['pleBytesRead']>0 for r in result['records'])

if __name__=='__main__':
    asyncio.run(main())
