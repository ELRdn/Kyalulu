"""Device-origin switch acceptance: real App/API/IDB, fixture Worker, no weights."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from unittest.mock import patch
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright, expect
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-target-switch-browser'
OWNER = 'device-research-fixture'
SESSION = 'device-target-switch'
INPUT = 'DEVICE_STOP_keep_input'
DRAFT = 'DEVICE_UNSENT_after_stop'


async def reject_switches(page):
    evidence = await page.evaluate('''async () => {
      const {generationBusy,switchTarget}=await import('/src/lib/appContext.ts');
      const {appTransaction}=await import('/src/lib/appStore.ts');
      const snapshot=async()=>({url:location.href,storage:{...localStorage},
        database:await appTransaction(['entities','parts','meta'],'readonly',(tx,done)=>{
          const rows={};done(rows);
          for(const name of ['entities','parts','meta']){
            const store=tx.objectStore(name),keys=store.getAllKeys(),values=store.getAll();
            values.onsuccess=()=>{rows[name]={keys:keys.result,values:values.result};};
          }
        })});
      if(!generationBusy())throw Error('Expected generation/recovery lock');
      const before=await snapshot(),rejected=[];
      for(const target of ['cloud','device','pc']){
        try{switchTarget(target);throw Error('Switch unexpectedly accepted: '+target);}
        catch(error){
          if(!String(error).includes('Stop generation and confirm its saved result'))throw error;
          rejected.push(target);
        }
      }
      const after=await snapshot();
      return {rejected,unchanged:JSON.stringify(before)===JSON.stringify(after)};
    }''')
    assert evidence == {'rejected': ['cloud', 'device', 'pc'], 'unchanged': True}, evidence
    return evidence


async def main():
    report = {'results': [], 'blocked_requests': [], 'page_errors': []}
    with patch.dict(os.environ, {'VITE_UNIFIED_APP': '1'}):
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            report['browser_version'] = browser.version
            report['browser_executable'] = runtime.chromium.executable_path
            try:
                for language, width, theme in [('ja', 393, 'light'), ('en', 1280, 'dark')]:
                    en = language == 'en'
                    context = await browser.new_context(locale='en-US' if en else 'ja-JP',
                        viewport={'width': width, 'height': 852}, color_scheme=theme,
                        service_workers='block')
                    try:
                        async def guard(route):
                            url = urlsplit(route.request.url)
                            if (url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port
                                    or url.path.startswith('/api/')):
                                report['blocked_requests'].append(route.request.url)
                                await route.abort()
                            else:
                                await route.continue_()
                        await context.route('**/*', guard)
                        await context.route_web_socket('**/*', lambda socket: socket.close())
                        page = await context.new_page()
                        page.set_default_timeout(15000)
                        page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                        address = origin + '/@fs/' + quote(
                            (ROOT / 'tests/fixtures/device-research.html').as_posix(), safe='/:')
                        await page.goto(address + '#/chats/' + SESSION)
                        await page.wait_for_function('window.__DEVICE_RESEARCH__ !== undefined')
                        await page.evaluate('''async ([owner,sid])=>{
                          const store=await import('/src/lib/appStore.ts');
                          const app=await import('/src/lib/appContext.ts');
                          const {RuntimeStateSchema}=await import('/@fs/ROOT/packages/schemas/src/index.ts');
                          app.rememberOwner(owner);
                          app.savePreferences({...app.preferences(),accepted:true,age:20,country:'JP'});
                          localStorage.setItem('kyalulu-first-chat-tutorial-v1','skipped');
                          localStorage.setItem('kyalulu-context-panel-mode','collapsible');
                          await store.saveEntity(store.newEntity('conversation',sid,{storage_policy:'local',rating:'general',
                            settings:{session_id:sid,system_prompt:'',temperature:.8},messages:[
                              {id:1,uuid:'baseline-user',role:'user',content:'Saved baseline user'},
                              {id:2,uuid:'baseline-assistant',role:'assistant',content:'Saved baseline assistant',model_id:'kyalulu-iq3m'}],
                            memories:[],summaries:[],state:RuntimeStateSchema.parse({session_id:sid}),memory_enabled:false}),0);
                          await store.setMeta('message-sequence:'+owner,2);
                        }'''.replace('ROOT', ROOT.as_posix()), [OWNER, SESSION])
                        await page.evaluate('([lang,theme])=>window.__DEVICE_RESEARCH__.mount(document.getElementById("root"),lang,theme)', [language, theme])
                        # The fixture owns App. Mount only the real picker in a separate root.
                        await page.evaluate('''async()=>{
                          const {default:React}=await import('/@id/react');
                          const {default:ReactDOM}=await import('/@id/react-dom/client');
                          const {ExecutionPicker}=await import('/src/components/UnifiedEntry.tsx');
                          const node=document.createElement('div');node.id='acceptance-picker';document.body.prepend(node);
                          window.__pickerRoot=ReactDOM.createRoot(node);window.__pickerRoot.render(React.createElement(ExecutionPicker));
                          // Hold the real saved-history proof at decoding, without replacing its payload or API.
                          const json=Response.prototype.json;
                          window.__proofGate=new Promise(resolve=>{window.__releaseProof=resolve;});
                          Response.prototype.json=async function(){
                            const value=await json.call(this);
                            if(value?.status?.generation_id&&Array.isArray(value.history)&&'body_token' in value){
                              window.__heldProof=value;await window.__proofGate;
                            }
                            return value;
                          };
                        }''')
                        picker = page.get_by_role('combobox', name='Run on' if en else '実行先', exact=True)
                        composer = page.locator('.k-composer__input')
                        send = page.get_by_role('button', name='Send' if en else '送信', exact=True)
                        await expect(picker).to_have_value('device')
                        await expect(picker).to_be_enabled()
                        await expect(composer).to_be_enabled()
                        await expect(page.locator('.k-chat-main')).to_contain_text('Saved baseline assistant')
                        await expect(page.locator('html')).to_have_attribute('data-theme', theme)
                        baseline = await page.evaluate('sid=>window.__DEVICE_RESEARCH__.api("/api/chat/history?session_id="+sid)', SESSION)
                        assert baseline['status'] == 200 and len(baseline['data']['history']) == 2
                        await page.evaluate('window.__DEVICE_RESEARCH__.pause(true)')
                        await composer.fill(INPUT)
                        await expect(send).to_be_enabled()
                        await send.click()
                        await page.wait_for_function('window.__DEVICE_RESEARCH__.status().calls===1&&window.__DEVICE_RESEARCH__.status().busy')
                        await expect(picker).to_be_disabled()
                        during_generation = await reject_switches(page)
                        recovery_key = f'kyalulu:chat-recovery:v1:{quote("device:" + OWNER, safe="")}:{SESSION}'
                        pending = await page.evaluate('key=>JSON.parse(localStorage.getItem(key))', recovery_key)
                        assert pending['draft'] == '' and pending['pending']['draft'] == INPUT
                        generation_id = pending['pending']['id']
                        await page.get_by_role('button', name='Stop' if en else '停止', exact=True).click()
                        await page.wait_for_function('window.__heldProof !== undefined')
                        proof = await page.evaluate('window.__heldProof')
                        assert proof['status'] == {'generation_id': generation_id, 'session_id': SESSION,
                            'status': 'failed', 'assistant_id': None, 'user_id': 3}, proof
                        assert proof['history'] == [{'id': 3, 'role': 'user', 'content': INPUT}], proof
                        await expect(picker).to_be_disabled()
                        await expect(page.get_by_role('button', name='Stop and check' if en else '停止して確認', exact=True)).to_be_visible()
                        during_verification = await reject_switches(page)
                        assert (await page.evaluate('key=>JSON.parse(localStorage.getItem(key))', recovery_key))['pending']['id'] == generation_id
                        saved = await page.evaluate('''async ([sid,key])=>{
                          const store=await import('/src/lib/appStore.ts');
                          return {session:await store.entity(sid),terminal:await store.getMeta(key)};
                        }''', [SESSION, f'generation:{OWNER}:{generation_id}'])
                        terminal = saved['terminal']
                        assert proof['revision'] == saved['session']['revision']
                        assert terminal == {**proof['status'], 'execution_lock': 'device-research:' + json.dumps(OWNER) + ':lock:',
                            'user_content_sha256': hashlib.sha256(INPUT.encode()).hexdigest()}, terminal
                        stopped = saved['session']['payload']
                        assert stopped['pending_generation'] is None and stopped['storage_policy'] == 'local'
                        assert stopped['messages'][:2] == baseline['data']['history']
                        assert len(stopped['messages']) == 3 and stopped['messages'][-1]['content'] == INPUT
                        assert stopped['messages'][-1]['role'] == 'user'
                        assert not stopped['memories'] and stopped['state']['turn'] == 0
                        await page.evaluate('window.__releaseProof()')
                        await expect(picker).to_be_enabled()
                        await expect(composer).to_have_value(INPUT)
                        await expect(page.locator('.k-chat-main')).to_contain_text('Saved baseline assistant')
                        assert await page.evaluate('key=>JSON.parse(localStorage.getItem(key))', recovery_key) == {
                            'version': 1, 'draft': INPUT, 'pending': None}
                        assert (await page.evaluate('window.__DEVICE_RESEARCH__.status()'))['calls'] == 1
                        await composer.fill(DRAFT)
                        before_cancel = await page.evaluate('({url:location.href,storage:{...localStorage}})')
                        await picker.select_option('pc')
                        review = page.get_by_role('dialog')
                        await expect(review).to_contain_text('Nothing is transferred automatically.' if en else '会話を自動転送しません。')
                        await review.get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
                        await expect(picker).to_have_value('device')
                        await expect(composer).to_have_value(DRAFT)
                        assert await page.evaluate('({url:location.href,storage:{...localStorage}})') == before_cancel
                        await picker.select_option('pc')
                        await review.get_by_role('button', name='Next' if en else '次へ', exact=True).click()
                        await page.wait_for_url(origin + '/#/')
                        picker = page.get_by_role('combobox', name='Run on' if en else '実行先', exact=True)
                        await expect(picker).to_have_value('pc')
                        await page.locator('.k-connect-screen').wait_for()
                        assert await page.evaluate('''async()=>{
                          const remote=await import('/src/lib/remoteStore.ts');
                          return !remote.activeRemote()&&(await remote.remoteDevices()).length===0;
                        }''')
                        assert await page.evaluate('key=>JSON.parse(localStorage.getItem(key)).draft', recovery_key) == DRAFT
                        await picker.select_option('device')
                        await page.get_by_role('dialog').get_by_role('button', name='Next' if en else '次へ', exact=True).click()
                        await page.wait_for_url(origin + '/device/#/')
                        await expect(page.get_by_role('combobox', name='Run on' if en else '実行先', exact=True)).to_have_value('device')
                        await page.goto(origin + '/device/#/chats/' + SESSION)
                        await expect(page.locator('.k-composer__input')).to_have_value(DRAFT)
                        await expect(page.locator('.k-chat-main')).to_contain_text('Saved baseline assistant')
                        restored = await page.evaluate('''async ([sid,key])=>{
                          const store=await import('/src/lib/appStore.ts');
                          const {deviceFetch}=await import('/src/lib/deviceApi.ts');
                          const history=await deviceFetch('/api/chat/history?session_id='+sid);
                          const keys=await store.appTransaction(['meta'],'readonly',(tx,done)=>{
                            const read=tx.objectStore('meta').getAllKeys();read.onsuccess=()=>done(read.result);
                          });
                          return {session:await store.entity(sid),terminal:await store.getMeta(key),
                            history:await history.json(),conversations:await store.allEntities(undefined,['conversation']),
                            receipts:await Promise.all(keys.filter(k=>k.startsWith('generation:')).map(k=>store.getMeta(k)))};
                        }''', [SESSION, f'generation:{OWNER}:{generation_id}'])
                        # Reopening may update only recency on the entity header.
                        assert restored['session']['payload'] == stopped
                        assert restored['session']['revision'] == saved['session']['revision']
                        assert restored['terminal'] == terminal
                        assert restored['receipts'] == [terminal], 'Roundtrip must not admit or resend another generation'
                        assert restored['history']['history'] == stopped['messages']
                        assert len(restored['conversations']) == 1
                        assert not report['blocked_requests'] and not report['page_errors'], report
                        report['results'].append({'language': language, 'width': width, 'theme': theme,
                            'generation_switches': during_generation, 'held_proof_switches': during_verification,
                            'terminal': terminal, 'proof': proof, 'saved_messages': len(stopped['messages']),
                            'worker_generate_calls': 1, 'input_restored': True, 'cancel_keeps_draft': True,
                            'unregistered_pc_device_roundtrip': True, 'history_and_draft_retained': True,
                            'persisted_generation_receipts': len(restored['receipts']),
                            'network_api_requests': 0, 'automatic_resend': False})
                    finally:
                        await context.close()
            finally:
                await browser.close()
                (OUTPUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    assert len(report['results']) == 2, report
    assert not report['blocked_requests'] and not report['page_errors'], report
    print(json.dumps({'passed': len(report['results']), **report}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
