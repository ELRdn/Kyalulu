"""Built unified shell + Native static server in Chromium; no model or real API."""
import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

import httpx
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))


async def language_in_place(page, language):
    await page.evaluate('''language=>{
        const key='kyalulu-app-preferences-v1', prefs=JSON.parse(localStorage.getItem(key));
        localStorage.setItem(key,JSON.stringify({...prefs,language}));
        window.dispatchEvent(new Event('kyalulu-app-context'));
    }''', language)


async def conversations(page):
    return await page.evaluate('''()=>new Promise((resolve,reject)=>{
        const open=indexedDB.open('kyalulu-app-v1',2);open.onerror=reject;open.onsuccess=()=>{
            const db=open.result,tx=db.transaction('entities'),read=tx.objectStore('entities').getAll();
            tx.oncomplete=()=>{db.close();resolve(read.result.filter(row=>row.kind==='conversation'));};tx.onerror=reject;
        };
    })''')


@asynccontextmanager
async def offline_renderer(context, page, language):
    # Traffic emulation alone can leave a cached renderer's navigator.onLine true.
    assert await page.evaluate("() => fetch('/__offline_probe__', {cache:'no-store'}).then(()=>false,()=>true)")
    cdp = await context.new_cdp_session(page)
    try:
        await cdp.send('Network.overrideNetworkState', {'offline': True, 'latency': 0,
            'downloadThroughput': 0, 'uploadThroughput': 0})
        await page.wait_for_function('() => navigator.onLine === false')
        await page.get_by_role('status').filter(has_text='Offline' if language == 'en' else 'オフライン').first.wait_for()
        yield
    finally:
        await cdp.detach()


async def check(dist, output):
    output.mkdir(parents=True, exist_ok=True)
    assert (dist / 'device/index.html').is_file(), 'Build unified app first'
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    marker = output / 'worker-version.txt'
    marker.write_text('0', encoding='ascii')
    results = []
    with (output / 'server.log').open('wb') as log:
        server = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--serve',
            '--dist', str(dist), '--port', str(port), '--update-marker', str(marker)], stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        try:
            async with httpx.AsyncClient(trust_env=False, timeout=1) as client:
                for _ in range(100):
                    assert server.poll() is None, 'Owned static fixture stopped'
                    try:
                        if (await client.get(origin)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(.1)
                else:
                    raise AssertionError('Owned static fixture did not start')
            async with async_playwright() as playwright:
                for language, width, theme in [('ja', 393, 'light'), ('en', 393, 'dark'), ('ja', 1280, 'dark'), ('en', 1280, 'light')]:
                    profile = tempfile.mkdtemp(prefix='profile-', dir=output)
                    settings = {'headless': True, 'viewport': {'width': width, 'height': 852},
                        'locale': 'ja-JP' if language == 'ja' else 'en-US', 'color_scheme': theme}
                    context = await playwright.chromium.launch_persistent_context(profile, **settings)
                    errors, blocked, api = [], [], []
                    try:
                        def record(request):
                            url = urlsplit(request.url)
                            if url.path.startswith('/api/'):
                                api.append(url.path)
                            if url.hostname != '127.0.0.1' or url.port != port:
                                blocked.append(url.path)
                        async def guard(route):
                            url = urlsplit(route.request.url)
                            if url.hostname != '127.0.0.1' or url.port != port:
                                await route.abort()
                            else:
                                await route.continue_()
                        await context.route('**/*', guard)
                        context.on('request', record)
                        page = await context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        await page.goto(origin)
                        await page.locator('.k-unified-entry').wait_for()
                        assert not await page.evaluate('crossOriginIsolated')
                        await page.wait_for_function('navigator.serviceWorker.controller !== null', timeout=120000)
                        await page.evaluate('''([language,theme])=>{
                            localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,language,country:'JP',age:25,accepted:true,
                              genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
                            localStorage.setItem('kyalulu-app-owner','pwa-fixture');
                            localStorage.setItem('kyalulu-execution-target','device');
                            localStorage.setItem('my-zeta-theme',theme);
                        }''', [language, theme])
                        await page.goto(origin + '/device/#/')
                        await page.locator('.k-char-card').first.wait_for()
                        await page.locator('.k-mobile-status summary').click()
                        await page.get_by_role('button', name='Check for updates' if language == 'en' else '更新を確認', exact=True).wait_for()
                        await page.locator('.k-mobile-status summary').click()
                        assert await page.evaluate('crossOriginIsolated && typeof SharedArrayBuffer !== "undefined"')
                        assert await page.evaluate('''async()=>{
                            await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));return true;
                        }''')
                        await page.locator('.k-char-card').first.click()
                        start = page.get_by_role('button', name='Start conversation' if language == 'en' else '会話をはじめる', exact=True)
                        await start.wait_for()
                        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                        await page.screenshot(path=str(output / f'{language}-{width}-{theme}-entry.png'), full_page=True)
                        opening = await page.locator('.k-scene-preview').inner_text()
                        alternate_language = 'ja' if language == 'en' else 'en'
                        await language_in_place(page, alternate_language)
                        await page.get_by_role('button', name='Start conversation' if alternate_language == 'en' else '会話をはじめる', exact=True).wait_for()
                        assert await page.locator('.k-scene-preview').inner_text() == opening
                        assert await conversations(page) == []
                        await language_in_place(page, language)
                        await page.get_by_role('button', name='Start conversation' if language == 'en' else '会話をはじめる', exact=True).click()
                        composer = page.locator('.k-composer textarea')
                        await composer.wait_for()
                        draft = 'オフラインの下書き · draft'
                        await composer.fill(draft)
                        await page.wait_for_function('text=>Object.values(localStorage).some(value=>value.includes(text))', arg=draft)
                        await page.get_by_role('button', name='Choose a model' if language == 'en' else '会話エンジンを選ぶ', exact=True).click()
                        model_panel = page.get_by_role('dialog', name='Character & preset' if language == 'en' else 'キャラ・プリセット', exact=True)
                        await model_panel.wait_for()
                        await model_panel.locator('.k-sheet-head').get_by_role('button', name='Close' if language == 'en' else '閉じる', exact=True).click()
                        assert await composer.input_value() == draft
                        tutorial = page.locator('.k-first-chat-tutorial')
                        await tutorial.wait_for()
                        await tutorial.get_by_role('button', name='Next' if language == 'en' else '次へ', exact=True).click()
                        expected = 'not sent to Cloud or external AI' if language == 'en' else 'Cloudや外部AIへ送りません'
                        await tutorial.get_by_text(expected, exact=False).wait_for()
                        assert 'BYOK' not in await tutorial.inner_text()
                        assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                        await tutorial.screenshot(path=str(output / f'{language}-{width}-{theme}-guide.png'))
                        before = await conversations(page)
                        assert len(before) == 1
                        await language_in_place(page, alternate_language)
                        expected = 'not sent to Cloud or external AI' if alternate_language == 'en' else 'Cloudや外部AIへ送りません'
                        await tutorial.get_by_text(expected, exact=False).wait_for()
                        assert await composer.input_value() == draft
                        assert await conversations(page) == before
                        await language_in_place(page, language)
                        for _ in range(2):
                            await tutorial.get_by_role('button', name='Next' if language == 'en' else '次へ', exact=True).click()
                        assert await tutorial.get_by_role('button', name='Open Inspector' if language == 'en' else 'Inspectorを開く', exact=True).is_disabled()
                        await tutorial.get_by_role('button', name='Finish guide' if language == 'en' else '案内を完了', exact=True).click()
                        assert await page.evaluate("localStorage.getItem('kyalulu-first-chat-tutorial-v1')") == 'completed'
                        await page.get_by_role('button', name='First chat guide' if language == 'en' else '初トークの案内', exact=True).click()
                        await tutorial.get_by_role('button', name='Skip' if language == 'en' else 'スキップ', exact=True).click()
                        assert await page.evaluate("localStorage.getItem('kyalulu-first-chat-tutorial-v1')") == 'skipped'
                        assert await conversations(page) == before
                        # Simulate a new worker release without changing app assets or integrity.
                        version = '1' if language == 'ja' else '2'
                        marker.write_text(version, encoding='ascii')
                        await page.locator('.k-mobile-status summary').click()
                        await page.get_by_role('button', name='Check for updates' if language == 'en' else '更新を確認', exact=True).click()
                        update = page.get_by_role('button', name='Update and reload' if language == 'en' else '更新して再読み込み', exact=True)
                        await update.wait_for(timeout=120000)
                        other = await context.new_page()
                        await other.goto(origin + '/device/#/')
                        await other.locator('.k-char-card').first.wait_for()
                        page.on('dialog', lambda dialog: dialog.accept())
                        await update.click()
                        await page.get_by_role('alert').filter(has_text='Close other Kyalulu' if language == 'en' else 'ほかのKyaluluタブ').wait_for()
                        assert await composer.input_value() == draft
                        assert await page.evaluate('navigator.serviceWorker.getRegistration().then(r=>!!r.waiting)')
                        await other.close()
                        async with page.expect_navigation():
                            await update.click()
                        await composer.wait_for()
                        assert await composer.input_value() == draft
                        await page.wait_for_function('version=>caches.keys().then(keys=>keys.some(k=>k.includes(":fixture"+version+"-")))', arg=version)
                        await context.set_offline(True)
                        await page.reload()
                        await composer.wait_for()
                        assert await composer.input_value() == draft
                        assert await page.evaluate('crossOriginIsolated')
                        async with offline_renderer(context, page, language):
                            assert not await page.evaluate('document.documentElement.scrollWidth > innerWidth')
                            await page.screenshot(path=str(output / f'{language}-{width}-{theme}-offline.png'), full_page=True)
                        chat_url = page.url
                        await context.close()
                        context = await playwright.chromium.launch_persistent_context(profile, offline=True, **settings)
                        await context.route('**/*', guard)
                        context.on('request', record)
                        page = context.pages[0]
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        await page.goto(chat_url)
                        composer = page.locator('.k-composer textarea')
                        await composer.wait_for()
                        assert await composer.input_value() == draft
                        assert await page.evaluate('crossOriginIsolated && navigator.serviceWorker.controller !== null')
                        async with offline_renderer(context, page, language):
                            await page.screenshot(path=str(output / f'{language}-{width}-{theme}-offline-restart.png'), full_page=True)
                        await context.set_offline(False)
                        await page.goto(origin + '/migration/')
                        assert not await page.evaluate('crossOriginIsolated')
                        assert not errors, errors
                        assert not blocked, blocked
                        assert not api, api
                        results.append({'language': language, 'width': width, 'theme': theme,
                            'device_isolated_online_and_offline': True, 'wasm_csp': True,
                            'entry_language_switch_preserves_opening': True, 'tutorial_device_disclosure': True,
                            'tutorial_language_switch_preserves_step_and_draft': True, 'tutorial_receipts': True,
                            'draft_reload': True, 'explicit_update': True, 'other_tab_update_blocked': True,
                            'offline_browser_restart': True, 'offline_status_with_renderer_emulation': True,
                            'uncached_network_blocked': True, 'migration_not_isolated': True,
                            'api_requests': len(api), 'external_requests': len(blocked), 'page_errors': len(errors)})
                    finally:
                        await context.close()
        finally:
            if server.poll() is None:
                server.terminate()
                try:
                    await asyncio.to_thread(server.wait, 10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    await asyncio.to_thread(server.wait)
    (output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / '.artifacts/unified-app')
    parser.add_argument('--output', type=Path, default=ROOT / '.artifacts/unified-pwa-browser')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int)
    parser.add_argument('--update-marker', type=Path)
    args = parser.parse_args()
    if args.serve:
        import uvicorn
        from fastapi import FastAPI
        from fastapi.responses import Response
        from python.api.mobile import WebDist
        app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
        @app.get('/sw.js')
        async def worker():
            source = (args.dist / 'sw.js').read_text(encoding='utf-8')
            version = args.update_marker.read_text(encoding='ascii').strip()
            assert version in {'0', '1', '2'}
            return Response(source.replace('const VERSION = "', f'const VERSION = "fixture{version}-', 1),
                media_type='text/javascript', headers={'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/'})
        app.mount('/', WebDist(directory=str(args.dist.resolve()), html=True))
        uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False)
    else:
        asyncio.run(check(args.dist.resolve(), args.output.resolve()))
