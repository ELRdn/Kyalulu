"""Actual App + owned Cloud HTTP/DB/wallet, fictional provider and HTTPS interception."""
import asyncio
from contextlib import AsyncExitStack
from dataclasses import replace
import json
import os
from pathlib import Path
import sys
import threading
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import urlsplit

import httpx
import uvicorn
from playwright.async_api import async_playwright, expect

from browser_fixture_server import local_vite
from e2e_remote import port

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE
from test_cloud_cost_accounting import config, enroll, generation_response, VALID_OUTPUT

ORIGIN = 'https://app.kyalulu.test'
SESSION = 'cloud-target-switch'
INPUT = 'CLOUD_STOP_keep_input'
DRAFT = 'CLOUD_UNSENT_after_stop'
OUTPUT = ROOT / '.artifacts/cloud-target-switch-browser'


async def run_case(browser, vite, directory, language, width, theme):
    print(json.dumps({'language': language, 'stage': 'start'}), flush=True)
    entered, release_provider = threading.Event(), threading.Event()
    late_success = threading.Event()
    checked, release_status = asyncio.Event(), asyncio.Event()
    provider_calls, calls, errors, blocked, active_routes, cancelled_routes, hmr_sockets = [], [], [], [], {}, [], []

    class ProviderStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            entered.set()
            try:
                while not release_provider.is_set():
                    await asyncio.sleep(.01)
            except asyncio.CancelledError:
                late_success.set()
            yield generation_response(VALID_OUTPUT, {'prompt_tokens': 30, 'completion_tokens': 50, 'cost': .00001}).content

    def provider(request):
        assert request.url.host == 'openrouter.ai' and request.url.path == '/api/v1/chat/completions'
        provider_calls.append(json.loads(request.content))
        return httpx.Response(200, stream=ProviderStream())

    policy = {'accepted': True, 'minimum_age': 18, 'guardian_below': 18, 'version': 'fictional-cloud-switch-only'}
    cfg = replace(config(directory), origin=ORIGIN, unified_enabled=True, region_policies=(('ZZ', policy),))
    app = create_app(cfg, transport=httpx.MockTransport(provider))
    owner = enroll(app)
    app.state.store.secret(owner, 'app-eligibility', json.dumps(app.state.unified.general_eligibility('ZZ', 25)))
    balance = app.state.store.balance(owner)
    server_port = port()
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=server_port,
        access_log=False, log_level='error', timeout_graceful_shutdown=5,
        loop='asyncio:SelectorEventLoop' if os.name == 'nt' else 'auto'))
    server_errors = []

    def serve():
        try:
            server.run()
        except BaseException as error:
            server_errors.append(str(error))

    thread = threading.Thread(target=serve, daemon=True)
    context = await browser.new_context(locale='ja-JP' if language == 'ja' else 'en-US',
        viewport={'width': width, 'height': 852}, color_scheme=theme, service_workers='block')
    en = language == 'en'
    try:
        thread.start()
        for _ in range(200):
            if server.started or server_errors:
                break
            await asyncio.sleep(.05)
        assert server.started and not server_errors, server_errors
        async with httpx.AsyncClient(base_url=f'http://127.0.0.1:{server_port}', trust_env=False, timeout=30) as api, \
                httpx.AsyncClient(base_url=vite, trust_env=False, timeout=10) as assets, AsyncExitStack() as cleanup:
            cleanup.push_async_callback(context.close)
            cleanup.push_async_callback(asyncio.wait_for, context.unroute_all(behavior='wait'), 10)
            cleanup.callback(release_status.set)
            cleanup.callback(release_provider.set)
            async def dispatch(route):
                request, url = route.request, urlsplit(route.request.url)
                if url.scheme != 'https' or url.netloc != urlsplit(ORIGIN).netloc:
                    blocked.append(request.url); await route.abort(); return
                if url.path.startswith('/api/'):
                    headers = await request.all_headers()
                    # Preserve the browser's virtual HTTPS authority over the owned HTTP bridge.
                    headers['host'] = url.netloc
                    call = {'path': url.path, 'method': request.method}
                    if request.post_data:
                        call['body'] = request.post_data_json
                    calls.append(call)
                    response = await api.request(request.method, url.path + ('?' + url.query if url.query else ''),
                        headers=headers, content=request.post_data_buffer)
                    call['status'] = response.status_code
                    if (request.method == 'GET' and url.path.startswith('/api/chat/generations/')
                            and response.status_code == 200 and response.json()['status'] == 'cancelled'):
                        checked.set(); await release_status.wait()
                    if request.failure is None:
                        await route.fulfill(status=response.status_code, headers=dict(response.headers), body=response.content)
                    else:
                        await route.abort()
                else:
                    response = await assets.get(url.path + ('?' + url.query if url.query else ''))
                    headers = {key: value for key, value in response.headers.items()
                               if key not in {'content-encoding', 'content-length', 'transfer-encoding'}}
                    await route.fulfill(status=response.status_code, headers=headers, body=response.content)

            async def guard(route):
                active_routes[id(route)] = route.request.method + ' ' + urlsplit(route.request.url).path
                try:
                    await dispatch(route)
                except asyncio.CancelledError:
                    cancelled_routes.append(active_routes[id(route)])
                    raise
                except Exception as error:
                    errors.append(str(error))
                    raise
                finally:
                    active_routes.pop(id(route), None)

            await context.route('**/*', guard)
            async def close_socket(socket):
                url = urlsplit(socket.url)
                if url.netloc not in {urlsplit(ORIGIN).netloc, urlsplit(vite).netloc}:
                    blocked.append(url._replace(query='', fragment='').geturl())
                else:
                    hmr_sockets.append(url.netloc)
                await socket.close()

            await context.route_web_socket('**/*', close_socket)
            await context.add_cookies([{'name': SESSION_COOKIE, 'value': 'browser', 'url': ORIGIN,
                                       'secure': True, 'httpOnly': True, 'sameSite': 'Lax'}])
            await context.add_init_script('''(() => {
              if(localStorage.getItem('cloud-switch-seeded'))return;
              localStorage.setItem('cloud-switch-seeded','1');
              localStorage.setItem('kyalulu-execution-target','cloud');
              localStorage.setItem('my-zeta-theme',THEME);
              localStorage.setItem('kyalulu-first-chat-tutorial-v1','skipped');
              localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,
                language:LANGUAGE,country:'ZZ',age:25,accepted:true,
                genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
            })();'''.replace('THEME', json.dumps(theme)).replace('LANGUAGE', json.dumps(language)))
            page = await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_default_timeout(15000)
            await page.goto(ORIGIN + '/#/chats/' + SESSION)
            picker = page.get_by_role('combobox', name='Run on' if en else '実行先', exact=True)
            composer = page.locator('.k-composer__input')
            await expect(page.locator('html')).to_have_attribute('data-theme', theme)

            async def reject_switches():
                assert await page.evaluate('''async()=>{
                  const {switchTarget,generationBusy}=await import('/src/lib/appContext.ts');
                  const before=JSON.stringify({...localStorage}),url=location.href;
                  if(!generationBusy())return false;
                  for(const target of ['cloud','device','pc']){
                    try{switchTarget(target);return false;}
                    catch(error){if(!String(error).includes('Stop generation and confirm its saved result'))throw error;}
                  }
                  return location.href===url&&JSON.stringify({...localStorage})===before;
                }''')

            await expect(composer).to_be_enabled()
            await composer.fill(INPUT)
            await expect(page.get_by_role('button', name='Send' if en else '送信', exact=True)).to_be_enabled()
            await page.get_by_role('button', name='Send' if en else '送信', exact=True).click()
            assert await asyncio.to_thread(entered.wait, 15), 'Mock provider was not reached'
            print(json.dumps({'language': language, 'stage': 'provider-entered'}), flush=True)
            await expect(picker).to_be_disabled()
            await reject_switches()
            recovery_key = await page.evaluate('''()=>Object.keys(localStorage).find(key=>
                key.startsWith('kyalulu:chat-recovery:v1:')&&key.endsWith(':cloud-target-switch'))''')
            pending = await page.evaluate('key=>JSON.parse(localStorage.getItem(key))', recovery_key)
            gid = pending['pending']['id']
            await page.get_by_role('button', name='Stop' if en else '停止', exact=True).click()
            await asyncio.wait_for(checked.wait(), 15)
            print(json.dumps({'language': language, 'stage': 'cancelled-result-held'}), flush=True)
            await expect(picker).to_be_disabled()
            await reject_switches()
            await page.evaluate('location.hash="/profile"')
            await expect(composer).to_have_count(0)
            await page.reload()
            await page.get_by_role('link', name='Check send result' if en else '送信結果を確認', exact=True).wait_for()
            await expect(picker).to_be_disabled()
            await reject_switches()
            await page.screenshot(path=str(OUTPUT / f'{language}-{width}-{theme}-pending.png'), full_page=True)
            await page.get_by_role('link', name='Check send result' if en else '送信結果を確認', exact=True).click()
            release_status.set()
            await expect(picker).to_be_enabled()
            await expect(composer).to_have_value(INPUT)
            assert late_success.is_set()
            assert app.state.store.balance(owner) == balance
            with app.state.store.transaction() as db:
                operation = dict(db.execute('SELECT * FROM operations WHERE owner=? AND id=?', (owner, gid)).fetchone())
                assert operation['state'] == 'failed' and operation['charged_credits'] == 0, operation
            await composer.fill(DRAFT)
            await picker.select_option('device')
            await page.get_by_role('dialog').get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
            await expect(composer).to_have_value(DRAFT)
            await expect(picker).to_have_value('cloud')
            await picker.select_option('device')
            await page.get_by_role('dialog').get_by_role('button', name='Next' if en else '次へ', exact=True).click()
            await page.wait_for_url(ORIGIN + '/device/#/')
            await expect(picker).to_have_value('device')
            assert await page.evaluate('''async sid=>{
              const {entity}=await import('/src/lib/appStore.ts');return !await entity(sid);
            }''', SESSION)
            await picker.select_option('cloud')
            await page.get_by_role('dialog').get_by_role('button', name='Next' if en else '次へ', exact=True).click()
            await page.wait_for_url(ORIGIN + '/#/')
            await page.goto(ORIGIN + '/#/chats/' + SESSION)
            await expect(composer).to_have_value(DRAFT)
            await page.wait_for_load_state('networkidle')
            assert not active_routes, active_routes
            verified = await page.evaluate('''async ([sid,gid])=>{
              const {apiFetch}=await import('/src/lib/transport.ts');
              const status=await apiFetch('/api/chat/generations/'+gid+'?session_id='+sid);
              const history=await apiFetch('/api/chat/history?session_id='+sid);
              return {status:await status.json(),history:await history.json()};
            }''', [SESSION, gid])
            assert verified == {'status': {'generation_id': gid, 'session_id': SESSION, 'status': 'cancelled',
                                          'user_id': None, 'assistant_id': None}, 'history': {'history': []}}, verified
            assert len(provider_calls) == 1
            assert len([call for call in calls if call['path'] == '/api/chat/stream']) == 1
            assert len([call for call in calls if call['path'] == '/api/cloud/quotes']) == 1
            release_provider.set()
            await composer.fill('CLOUD_EXPLICIT_resume')
            await page.get_by_role('button', name='Send' if en else '送信', exact=True).click()
            reply = page.locator('.k-msg--character .k-msg__stack').get_by_text('hello', exact=True)
            await reply.wait_for()
            await expect(picker).to_be_enabled()
            assert await composer.input_value() == ''
            assert len(provider_calls) == 2
            assert app.state.store.balance(owner) == balance - 1
            with app.state.store.transaction() as db:
                operations = db.execute('SELECT state,charged_credits FROM operations ORDER BY created').fetchall()
                assert [tuple(row) for row in operations] == [('failed', 0), ('completed', 1)]
            await page.wait_for_load_state('networkidle')
            assert not active_routes, active_routes
            await expect(page.locator('.k-session-row__preview').get_by_text('hello', exact=True)).to_have_count(1)
            await expect(page.get_by_text('hello', exact=True)).to_have_count(2)
            await expect(reply).to_have_count(1)
            assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
            print(json.dumps({'language': language, 'stage': 'complete'}), flush=True)
            return {'language': language, 'width': width, 'theme': theme, 'provider_calls': len(provider_calls),
                'cancelled_credits': operation['charged_credits'], 'cancel_balance_unchanged': True,
                'late_success_fenced': True, 'explicit_resume_credits': 1,
                'profile_reload_keeps_guard': True, 'draft_retained': True, 'automatic_resend': False,
                'reply_locator_ignores_sidebar_preview': True,
                'blocked_requests': blocked, 'page_errors': errors, 'cancelled_route_callbacks': cancelled_routes,
                'owned_development_websockets_closed': len(hmr_sockets)}
    except BaseException as error:
        print(json.dumps({'language': language, 'error': str(error), 'page_errors': errors,
                          'blocked': blocked, 'calls': [{key: value for key, value in c.items() if key != 'body'} for c in calls]}), flush=True)
        raise
    finally:
        release_status.set(); release_provider.set()
        print(json.dumps({'language': language, 'stage': 'cleanup', 'active_routes': list(active_routes.values())}), flush=True)
        try:
            await context.close()
        finally:
            server.should_exit = True
            if thread.ident is not None:
                await asyncio.to_thread(thread.join, 15)
            assert not thread.is_alive() and not server_errors, server_errors


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='cloud-switch-', dir=OUTPUT) as directory, patch.dict(os.environ, {'VITE_UNIFIED_APP': '1'}):
        async with local_vite(Path(directory)) as vite, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            try:
                results = []
                for language, width, theme in [('ja', 393, 'light'), ('en', 1280, 'dark')]:
                    results.append(await run_case(browser, vite, Path(directory) / language, language, width, theme))
                report = {'passed': len(results), 'browser': browser.version, 'results': results,
                          'limits': ['HTTPS requests intercepted, not a TLS server', 'fictional provider and identity', 'no physical device']}
                (OUTPUT / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                print(json.dumps(report, ensure_ascii=False))
            finally:
                await browser.close()


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), 180))
