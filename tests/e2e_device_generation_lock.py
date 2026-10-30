"""Real cross-document Web Locks and atomic pending recovery; fictional data only."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-generation-lock-browser'
OWNER = 'generation-lock-fixture'
SESSION = 'generation-lock-session'
GENERATION = 'generation-lock-pending'
KEY = f'generation:{OWNER}:{GENERATION}'


async def main():
    blocked, errors = [], []
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        context = await browser.new_context()
        try:
            async def guard(route):
                url = urlsplit(route.request.url)
                if url.hostname == '127.0.0.1' and url.port == urlsplit(origin).port and not url.path.startswith('/api/'):
                    await route.continue_()
                else:
                    blocked.append(url.path)
                    await route.abort()
            await context.route('**/*', guard)
            await context.route_web_socket('**/*', lambda socket: socket.close())
            first, second = await context.new_page(), await context.new_page()
            fixture = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/memory-language.html').as_posix(), safe='/:')
            for page in (first, second):
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(fixture)
                await page.wait_for_function('window.__MEMORY_LANGUAGE__ !== undefined')
                await page.evaluate('(owner)=>window.__MEMORY_LANGUAGE__.owner(owner)', OWNER)
            await first.evaluate('''async ([owner,sid,gid,key])=>{
              const store=await import('/src/lib/appStore.ts');
              const {deviceExecutionLockName}=await import('/src/lib/deviceResearch.ts');
              await store.saveEntity(store.newEntity('conversation',sid,{storage_policy:'local',settings:{session_id:sid},
                messages:[{id:1,uuid:'fictional-user',role:'user',content:'Preserve pending input'}],
                memories:[],summaries:[],draft:'Preserve draft',pending_generation:gid},owner),0,
                {[key]:{generation_id:gid,session_id:sid,status:'pending',assistant_id:null,user_id:1,execution_lock:deviceExecutionLockName(owner)}});
              window.__held=navigator.locks.request(deviceExecutionLockName(owner),async()=>{
                window.__locked=true;await new Promise(resolve=>{window.__release=resolve;});
              });
            }''', [OWNER, SESSION, GENERATION, KEY])
            await first.wait_for_function('window.__locked===true')

            async def saved():
                return await second.evaluate('''async ([sid,key])=>{
                  const store=await import('/src/lib/appStore.ts');
                  return {session:await store.entity(sid),status:await store.getMeta(key)};
                }''', [SESSION, KEY])

            async def api(path, method='GET', body=None):
                return await second.evaluate('([path,method,body])=>window.__MEMORY_LANGUAGE__.api(path,method,body)', [path, method, body])

            status_path = f'/api/chat/generations/{GENERATION}?session_id={SESSION}'
            before = await saved()
            assert (await api(status_path))['data']['status'] == 'pending'
            assert (await api(f'/api/chat/generations/{GENERATION}/cancel?session_id={SESSION}', 'POST'))['status'] == 409
            blocked_send = await api('/api/chat/stream', 'POST', {'session_id': SESSION, 'generation_id': 'must-not-run',
                'model_id': 'mock-echo', 'messages': [{'role': 'user', 'content': 'Must not replace pending input'}]})
            assert blocked_send['status'] == 409, blocked_send
            assert await saved() == before
            # Closing a document releases its real platform lock without a timer/heartbeat guess.
            await first.close()
            await second.wait_for_function('(name)=>navigator.locks.query().then(state=>!state.held.some(lock=>lock.name===name))',
                                           arg=before['status']['execution_lock'])
            rejected = await second.evaluate('''async ([path,key])=>{
              const put=IDBObjectStore.prototype.put;
              IDBObjectStore.prototype.put=function(value,k){
                if(this.name==='meta'&&k===key)throw new DOMException('Fictional metadata quota','QuotaExceededError');
                return put.call(this,value,k);
              };
              try{return await window.__MEMORY_LANGUAGE__.api(path);}
              finally{IDBObjectStore.prototype.put=put;}
            }''', [status_path, KEY])
            assert rejected['status'] == 400, rejected
            assert await saved() == before, 'Recovery must roll back session and status together'
            recovered = await api(status_path)
            assert recovered['status'] == 200 and recovered['data']['status'] == 'failed', recovered
            after = await saved()
            assert after['session']['payload'] == {**before['session']['payload'], 'pending_generation': None}
            assert after['session']['revision'] == before['session']['revision'] + 1
            assert after['status']['status'] == 'failed'
            assert (await api(status_path))['data'] == after['status']
            assert await saved() == after, 'Repeated reconciliation must not write again'
            await second.reload()
            await second.wait_for_function('window.__MEMORY_LANGUAGE__ !== undefined')
            assert await saved() == after
            for language in ('ja', 'en'):
                sid, gid = f'legacy-session-{language}', f'legacy-generation-{language}'
                key = f'generation:{OWNER}:{gid}'
                await second.evaluate('''async ([owner,sid,gid,key,language])=>{
                  const store=await import('/src/lib/appStore.ts');
                  await store.saveEntity(store.newEntity('conversation',sid,{storage_policy:'local',settings:{session_id:sid},
                    messages:[{id:1,uuid:'saved-reply',role:'assistant',content:'Saved reply'},
                      {id:2,uuid:'legacy-input',role:'user',content:'Legacy sent input'}],memories:[],summaries:[],
                    pending_generation:gid},owner),0,{[key]:{generation_id:gid,session_id:sid,status:'pending',assistant_id:null,user_id:2}});
                  window.__unmount=window.__MEMORY_LANGUAGE__.mountLegacyRecovery(document.getElementById('root'),sid,gid,language);
                }''', [OWNER, sid, gid, key, language])

                async def legacy_saved():
                    return await second.evaluate('''async ([sid,key])=>{
                      const store=await import('/src/lib/appStore.ts');
                      return {session:await store.entity(sid),status:await store.getMeta(key)};
                    }''', [sid, key])

                en = language == 'en'
                notice = second.get_by_role('status')
                await notice.filter(has_text='older app' if en else '旧アプリ').wait_for()
                original = await legacy_saved()
                stop = second.get_by_role('button', name='Stop and check' if en else '停止して確認', exact=True)
                await stop.click()
                dialog = second.get_by_role('dialog')
                await dialog.get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
                await dialog.wait_for(state='detached')
                assert await legacy_saved() == original
                await stop.click()
                await dialog.wait_for()
                # An intervening edit invalidates the exact revision shown to the user.
                await second.evaluate('''async sid=>{
                  const store=await import('/src/lib/appStore.ts'),record=await store.entity(sid);
                  await store.saveEntity({...record,payload:{...record.payload,title:'Concurrent edit'}},record.revision);
                }''', sid)
                await dialog.get_by_role('button', name='Tabs closed; recover' if en else 'タブを閉じたので復旧', exact=True).click()
                await notice.filter(has_text='Stopping could not' if en else '停止を確認できません').wait_for()
                conflict = await legacy_saved()
                assert conflict['status']['status'] == 'pending' and conflict['session']['payload']['pending_generation'] == gid
                await stop.click()
                await dialog.get_by_role('button', name='Tabs closed; recover' if en else 'タブを閉じたので復旧', exact=True).click()
                await notice.filter(has_text='did not finish' if en else '完了しませんでした').wait_for()
                recovered_legacy = await legacy_saved()
                assert recovered_legacy['status']['status'] == 'failed'
                assert recovered_legacy['session']['payload'] == {**conflict['session']['payload'], 'pending_generation': None}
                assert await second.get_by_role('textbox', name='Draft' if en else '下書き', exact=True).input_value() == 'Legacy sent input\n\nUnsent newer draft'
                await second.evaluate('window.__unmount()')
            assert not blocked and not errors, (blocked, errors)
        finally:
            await context.close()
            await browser.close()
    report = {'ok': True, 'two_documents': True, 'live_lock_retains_pending': True,
        'other_document_send_and_cancel_rejected': True, 'document_close_releases_lock': True,
        'metadata_failure_rolls_back_session_and_status': True, 'orphan_recovery_is_durable_and_idempotent': True,
        'legacy_ja_en_confirmation_cancel_conflict_and_draft_recovery': True,
        'blocked_external_or_api_network_requests': blocked, 'page_errors': errors, 'vite_stopped': True,
        'production_used': False, 'real_inference_attempts': 0,
        'limits': ['Synthetic live lock and metadata quota injection; no real model or physical device']}
    (OUTPUT / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'report': str(OUTPUT / 'result.json')}))


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), 120))
