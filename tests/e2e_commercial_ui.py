"""Real unified app in Chromium, fictional APIs only; exit nonzero on UX failures.

Run: .venv/Scripts/python.exe -B tests/e2e_commercial_ui.py
Evidence defaults to an OS temporary directory; no product/build files are edited.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect

from browser_fixture_server import local_vite

SESSION = 'commercial-fixture'
DRAFT = '未送信の下書き / Keep this draft — commercial fixture'
AD_ORIGIN = 'https://ads.commercial.invalid'
FEATURES = ('regenerate', 'suggestions', 'stored_context', 'progress', 'branch',
            'permanent_delete', 'summaries', 'world_memory', 'story_rules',
            'community', 'media_playback', 'media_generation')
WORDS = {
    'ja': {'balance': 'クレジットを補充', 'buy': '追加購入', 'watch': '動画を見て補充',
           'close': '閉じる', 'device': 'この端末', 'pc': '自分のPC', 'target': '実行先',
           'next': '次へ', 'send': '送信', 'ad': '広告', 'play': '動画を再生', 'pending': '確認中'},
    'en': {'balance': 'Add credits', 'buy': 'Buy credits', 'watch': 'Watch to earn credits',
           'close': 'Close', 'device': 'This device', 'pc': 'My PC', 'target': 'Run on',
           'next': 'Next', 'send': 'Send', 'ad': 'Advertisement', 'play': 'Play video', 'pending': 'Checking'},
}


class FictionalAPI:
    def __init__(self, origin, scenario):
        self.origin, self.scenario = origin, scenario
        self.target = scenario if scenario in ('device', 'pc', 'local') else 'cloud'
        self.calls, self.blocked, self.unexpected, self.ads = [], [], [], []
        self.owner, self.subscriber = 'commercial-owner', scenario == 'subscriber'
        self.banner = None if scenario == 'free' else AD_ORIGIN + '/banner'
        self.hold_status = False
        self.hold_reward_owner = None
        self.status_held, self.status_release = asyncio.Event(), asyncio.Event()
        self.reward_held, self.reward_release = asyncio.Event(), asyncio.Event()

    def writes(self):
        return [c for c in self.calls if c['method'] != 'GET']

    async def route(self, route):
        request, url = route.request, urlsplit(route.request.url)
        # These reserved .invalid URLs are fulfilled in-process, never fetched.
        if request.url in (AD_ORIGIN + '/banner', AD_ORIGIN + '/reward'):
            self.ads.append(request.url)
            await route.fulfill(content_type='text/html', body='<p>Fictional advertisement</p>')
            return
        if url.scheme != 'http' or url.netloc != urlsplit(self.origin).netloc:
            self.blocked.append(request.url)
            await route.abort()
            return
        if not url.path.startswith('/api'):
            if url.path.startswith(('/runtime/', '/ort/')) or url.path.endswith(('.gguf', '.wasm', '.safetensors')):
                self.unexpected.append('Model/runtime download: ' + url.path)
                await route.abort()
            else:
                await route.continue_()
            return

        call = {'method': request.method, 'path': url.path,
                'owner': request.headers.get('x-kyalulu-owner', '')}
        if request.post_data:
            call['body'] = request.post_data_json
        self.calls.append(call)
        cloud = self.target == 'cloud'
        commercial = {'enabled': True, 'subscriber': self.subscriber,
                      'ads_available': True, 'billing_available': True,
                      'banner': self.banner}
        reads = {
            '/api/mobile/status': {'remote_mode': cloud or self.target == 'pc',
                'authenticated': self.scenario != 'guest', 'cloud_mode': cloud,
                'administrative': not cloud, 'owner_scope': self.owner},
            '/api/cloud/status': {'app_commercial': commercial, 'billing_available': True,
                'ads_available': True, 'operator_route': {'provider': 'fixture'}},
            '/api/cloud/app/status': commercial,
            '/api/cloud/profile': {'revision': 1, 'display_name': 'Fictional user',
                                  'saved_characters': [], 'pinned_sessions': []},
            '/api/capabilities': {'schema_version': 1, 'mode': 'cloud' if cloud else 'local',
                'model_selection': 'cloud-routes' if cloud else 'local',
                'features': {k: k == 'stored_context' for k in FEATURES}},
            '/api/models': {'models': [{'id': 'cloud-standard', 'display_name': 'Fictional model',
                'provider_type': 'fixture', 'provider_model': 'fixture', 'quantization': '', 'available': True}]},
            '/api/providers/health': {'health': [{'id': 'fixture', 'status': 'ok'}]},
            '/api/characters': {'characters': []}, '/api/personas': {'personas': []},
            '/api/worlds': {'worlds': []}, '/api/prompts/presets': {'presets': []},
            '/api/library': {'items': []}, '/api/commands': {'commands': []},
            '/api/memory/session/' + SESSION: {'enabled': False, 'scope': 'commercial-fixture'},
            '/api/memory': {'memories': []},
            '/api/local/app-sync/status': {'session_id': SESSION, 'selected': False,
                'enabled': False, 'pending': False, 'error': ''},
            '/api/chat/sessions': {'sessions': [{'session_id': SESSION, 'count': 1,
                'character_name': 'Fictional chat', 'last_preview': 'Fixture', 'last_at': '2026-10-29T00:00:00Z'}]},
            '/api/chat/history': {'history': [{'id': 1, 'role': 'assistant',
                'content': 'Fictional conversation', 'model_id': 'cloud-standard'}]},
            '/api/chat/settings': {'session_id': SESSION, 'system_prompt': '', 'temperature': .8},
            '/api/chat/context/' + SESSION: {'history_revision': 'fixture-1', 'summaries': []},
            '/api/cloud/app/rewards/fixture-reward': {'id': 'fixture-reward', 'state': 'pending',
                'seconds': 15, 'credits': 150, 'frame_url': AD_ORIGIN + '/reward'},
        }
        status, body = 200, reads.get(url.path)
        if request.method == 'POST' and url.path == '/api/cloud/quotes':
            status, body = 402, {'error': 'insufficient_credits'}
        elif request.method == 'PUT' and url.path == '/api/chat/settings':
            body = {'ok': True}
        elif request.method == 'POST' and url.path == '/api/cloud/app/rewards':
            body = {**reads['/api/cloud/app/rewards/fixture-reward'], 'duration_seconds': 15}
            del body['seconds']
        elif request.method != 'GET' or body is None:
            self.unexpected.append(call)
            status, body = 501, {'error': 'Unmocked API; never forwarded'}
        if url.path == '/api/cloud/app/status' and self.hold_status:
            self.status_held.set()
            await self.status_release.wait()
        if url.path == '/api/cloud/app/rewards/fixture-reward' and call['owner'] == self.hold_reward_owner:
            self.reward_held.set()
            await self.reward_release.wait()
        await route.fulfill(status=status, json=body)


async def recovery_records(page):
    return await page.evaluate('''() => Object.fromEntries(Object.entries(localStorage)
        .filter(([key]) => key.startsWith('kyalulu:chat-recovery:v1:'))
        .map(([key,value]) => [key,JSON.parse(value)]))''')


async def run_case(browser, origin, output, language, width, theme, scenario):
    api = FictionalAPI(origin, scenario)
    name = f'{language}-{width}-{theme}-{scenario}'
    result = {'case': name, 'checks': [], 'failures': []}

    def check(label, passed, detail=None):
        result['checks'].append(label)
        if not passed:
            result['failures'].append({'check': label, 'detail': detail})

    desktop = {'user_agent': 'Kyalulu-Commercial-Fixture Electron/1.0'} if scenario == 'local' else {}
    context = await browser.new_context(locale='ja-JP' if language == 'ja' else 'en-US',
        viewport={'width': width, 'height': 852}, color_scheme=theme, **desktop)
    errors = []
    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
    await context.route('**/*', api.route)

    async def block_socket(socket):
        if urlsplit(socket.url).netloc != urlsplit(origin).netloc:
            api.blocked.append(socket.url)
        await socket.close()

    await context.route_web_socket('**/*', block_socket)
    # Playwright's service_workers='block' injects a script which itself throws
    # inside opaque ad frames. Deny registration in the fresh top-level app instead.
    await context.add_init_script('''(() => {
        if (window !== window.top || location.origin !== ORIGIN) return;
        window.__commercialServiceWorkerAttempts = 0;
        if ('serviceWorker' in navigator) navigator.serviceWorker.register = () => {
            window.__commercialServiceWorkerAttempts++;
            return Promise.reject(Error('Service workers are blocked by the commercial fixture'));
        };
        const [language,theme,target] = SETTINGS;
        if (localStorage.getItem('commercial-fixture-initialized')) return;
        localStorage.setItem('commercial-fixture-initialized','1');
        localStorage.setItem('kyalulu-execution-target',target);
        localStorage.setItem('my-zeta-theme',theme);
        localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,
            language,country:'JP',age:25,accepted:true,genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
        localStorage.setItem('kyalulu-first-chat-tutorial-v1','skipped');
    })();'''.replace('ORIGIN', json.dumps(origin)).replace('SETTINGS', json.dumps([language, theme, api.target])))
    page = await context.new_page()
    page.set_default_timeout(7000)
    t = WORDS[language]
    try:
        await page.goto(origin + ('/device/' if scenario == 'device' else '/'))
        await page.locator('.k-page--home').wait_for()
        await page.wait_for_load_state('networkidle')
        await expect(page.locator('html')).to_have_attribute('data-theme', theme)
        await expect(page.get_by_role('combobox', name=t['target'], exact=True)).to_have_value(api.target)
        free = scenario in ('free', 'guest')

        async def banner(where):
            slot = page.locator('.k-ad-slot')
            check(where + ': banner visibility', await slot.count() == int(free))
            if free and await slot.count():
                await expect(slot).to_have_attribute('aria-label', t['ad'])
                box = await slot.bounding_box()
                check(where + ': 50px banner', box is not None and abs(box['height'] - 50) < .1, box)
                if api.banner:
                    frame = slot.locator('iframe')
                    await expect(frame).to_have_attribute('title', t['ad'])
                    await expect(frame).to_have_attribute('sandbox', 'allow-scripts')
                    await expect(frame).to_have_attribute('referrerpolicy', 'no-referrer')
                    check(where + ': isolated fictional ad', await frame.get_attribute('src') == AD_ORIGIN + '/banner')
                else:
                    await expect(slot.locator('.k-ad-label')).to_have_text(t['ad'])
                    check(where + ': missing provider keeps labelled slot without iframe', await slot.locator('iframe').count() == 0)
            check(where + ': no horizontal overflow', await page.evaluate('document.documentElement.scrollWidth <= innerWidth'))

        await banner('home')
        await page.screenshot(path=str(output / (name + '-home.png')), full_page=True, animations='disabled')
        await page.goto(origin + ('/device/' if scenario == 'device' else '/') + '#/discover')
        await page.get_by_role('heading', name='Explore' if language == 'en' else 'ディスカバー', exact=True).wait_for()
        await page.wait_for_load_state('networkidle')
        await banner('discover')
        await page.screenshot(path=str(output / (name + '-discover.png')), full_page=True, animations='disabled')
        check('browsing makes no writes', not api.writes(), api.writes())
        if scenario == 'free':
            api.banner = AD_ORIGIN + '/banner'
            await page.goto(origin + '/#/chats/' + SESSION)
            composer = page.locator('.k-composer textarea')
            send = page.get_by_role('button', name=t['send'], exact=True)
            await composer.fill(DRAFT)
            await expect(send).to_be_enabled()
            await page.wait_for_load_state('networkidle')
            await banner('chat')
            initial = await recovery_records(page)
            check('typed draft persisted before send', len(initial) == 1 and next(iter(initial.values()))['draft'] == DRAFT, initial)
            dialog = page.get_by_role('dialog', name=t['balance'], exact=True)

            async def insufficient():
                before = len(api.writes())
                await send.click()
                await dialog.wait_for()
                await expect(composer).to_have_value(DRAFT)
                await expect(send).to_be_enabled()
                writes = api.writes()[before:]
                check('one deliberate send: settings then one rejected quote',
                    [(c['method'], c['path']) for c in writes] ==
                    [('PUT', '/api/chat/settings'), ('POST', '/api/cloud/quotes')], writes)
                check('quote contains the typed draft', bool(writes) and
                    writes[-1].get('body', {}).get('messages', []) == [{'role': 'user', 'content': DRAFT}], writes)
                check('402 restores draft and clears pending generation', await recovery_records(page) == initial)
                for key in ('buy', 'watch', 'device', 'pc', 'close'):
                    await expect(dialog.get_by_role('button', name=t[key], exact=True)).to_be_visible()
                check('dialog fits viewport', await dialog.evaluate('''el => {
                    const box=el.querySelector('.k-dialog').getBoundingClientRect();
                    return box.left>=0 && box.right<=innerWidth && box.top>=0 && box.bottom<=innerHeight;
                }'''))

            await insufficient()
            await page.screenshot(path=str(output / (name + '-credits.png')), full_page=True, animations='disabled')
            before = list(api.writes())
            await dialog.get_by_role('button', name=t['close'], exact=True).click()
            await expect(dialog).to_have_count(0)
            await expect(composer).to_have_value(DRAFT)
            check('Close sends nothing and keeps draft', api.writes() == before and await recovery_records(page) == initial)
            await expect(send).to_be_focused()
            await insufficient()
            before = list(api.writes())
            await page.keyboard.press('Escape')
            await expect(dialog).to_have_count(0)
            await page.reload()
            await composer.wait_for()
            await expect(composer).to_have_value(DRAFT)
            await page.wait_for_load_state('networkidle')
            check('Escape and reload do not resend or reopen', api.writes() == before and await dialog.count() == 0)

            await insufficient()
            before = len(api.writes())
            await dialog.get_by_role('button', name=t['watch'], exact=True).click()
            play = dialog.get_by_role('button', name=t['play'], exact=True)
            await play.wait_for()
            await expect(dialog.get_by_role('status').locator('p')).to_have_text('15s · 150 Credits · ' + t['pending'])
            check('15-second reward displays exactly 150 Credits', True)
            await page.screenshot(path=str(output / (name + '-reward.png')), full_page=True, animations='disabled')
            check('reward needs a separate Play click', await dialog.locator('iframe').count() == 0)
            await play.click()
            await expect(dialog.locator('iframe')).to_have_attribute('sandbox', 'allow-scripts')
            await expect(dialog.locator('iframe')).to_have_attribute('referrerpolicy', 'no-referrer')
            await dialog.get_by_role('button', name=t['close'], exact=True).click()
            await expect(dialog).to_have_count(0)
            await page.reload()
            await dialog.wait_for()
            await play.wait_for()
            await expect(dialog.get_by_role('status').locator('p')).to_have_text('15s · 150 Credits · ' + t['pending'])
            check('restored seconds-format reward still displays 150 Credits', True)
            check('pending reward restored without automatic playback', await dialog.locator('iframe').count() == 0)
            check('reward action never purchases or sends chat',
                [(c['method'], c['path']) for c in api.writes()[before:]] == [('POST', '/api/cloud/app/rewards')], api.writes()[before:])
            await expect(composer).to_have_value(DRAFT)
            await dialog.get_by_role('button', name=t['close'], exact=True).click()

            for target in ('device', 'pc'):
                await insufficient()
                before = list(api.writes())
                api.target = target
                async with page.expect_navigation(wait_until='domcontentloaded'):
                    await dialog.get_by_role('button', name=t[target], exact=True).click()
                await page.locator('.k-page--home').wait_for()
                await expect(page.get_by_role('combobox', name=t['target'], exact=True)).to_have_value(target)
                await page.wait_for_load_state('networkidle')
                check(target + ': switch hides commercial UI', await page.locator('.k-ad-slot').count() == 0 and await dialog.count() == 0)
                records = await recovery_records(page)
                check(target + ': switch preserves original draft', all(records.get(k) == v for k, v in initial.items()))
                await page.goto(origin + ('/device/' if target == 'device' else '/') + '#/chats/' + SESSION)
                await composer.wait_for()
                await expect(composer).to_have_value('')
                check(target + ': original draft not copied to new scope', sum(v['draft'] == DRAFT for v in (await recovery_records(page)).values()) == 1)
                api.target = 'cloud'
                await page.get_by_role('combobox', name=t['target'], exact=True).select_option('cloud')
                async with page.expect_navigation(wait_until='domcontentloaded'):
                    await page.locator('dialog[open]').get_by_role('button', name=t['next'], exact=True).click()
                await page.locator('.k-page--home').wait_for()
                await page.goto(origin + '/#/chats/' + SESSION)
                await composer.wait_for()
                await expect(composer).to_have_value(DRAFT)
                await page.wait_for_load_state('networkidle')
                # A saved pending reward may reopen; it still must not play or send.
                check(target + ': round trip never resends or buys', api.writes() == before, api.writes()[len(before):])
                if await dialog.count():
                    await dialog.get_by_role('button', name=t['close'], exact=True).click()

            # Exercise the real RuntimeGate/Provider key and cloudJson epoch fence.
            # No direct component mount or identity-module mutation bypasses them.
            before = list(api.writes())
            await page.reload()
            await play.wait_for()
            await play.click()
            await expect(dialog.locator('iframe')).to_be_visible()
            api.owner, api.subscriber, api.hold_status = 'commercial-owner-next', True, True
            await page.evaluate("window.dispatchEvent(new Event('online'))")
            await asyncio.wait_for(api.status_held.wait(), 7)
            await expect(composer).to_have_value('')
            check('owner switch clears previous banner while new status is pending', await page.locator('.k-ad-slot').count() == 0)
            check('owner switch closes previous reward dialog and playback', await dialog.count() == 0 and await page.locator('iframe').count() == 0)
            api.hold_status = False
            api.status_release.set()
            await page.wait_for_load_state('networkidle')
            check('subscriber owner gets no previous free banner', await page.locator('.k-ad-slot').count() == 0)
            records = await recovery_records(page)
            check('old owner draft stays in its original scope', all(records.get(k) == v for k, v in initial.items()))

            api.hold_reward_owner = 'commercial-owner'
            api.status_held.clear()
            api.status_release.clear()
            api.hold_status = True
            api.owner, api.subscriber = 'commercial-owner', False
            await page.evaluate("window.dispatchEvent(new Event('online'))")
            await asyncio.wait_for(api.reward_held.wait(), 7)
            await asyncio.wait_for(api.status_held.wait(), 7)
            api.hold_status = False
            api.owner, api.subscriber = 'commercial-owner-next', True
            await page.evaluate("window.dispatchEvent(new Event('online'))")
            await page.wait_for_function("localStorage.getItem('kyalulu-app-owner') === 'commercial-owner-next'")
            await expect(composer).to_have_value('')
            api.reward_release.set()
            api.status_release.set()
            await page.wait_for_load_state('networkidle')
            check('late old-owner free status does not restore banner', await page.locator('.k-ad-slot').count() == 0)
            check('late old-owner reward response does not reopen dialog', await dialog.count() == 0)
            check('old reward is never polled as the next owner', not any(
                c['path'] == '/api/cloud/app/rewards/fixture-reward' and c['owner'] == api.owner for c in api.calls))
            check('owner changes never send, purchase, or create rewards', api.writes() == before, api.writes()[len(before):])
            check('no generation request dispatched', not any(c['path'] in ('/api/chat', '/api/chat/stream') for c in api.calls))
        elif scenario != 'guest':
            await page.goto(origin + ('/device/' if scenario == 'device' else '/') + '#/chats/' + SESSION)
            await page.locator('.k-composer textarea').wait_for()
            await page.wait_for_load_state('networkidle')
            await banner('chat')
            check('opening chat makes no writes', not api.writes(), api.writes())
        check('no unmocked API or model downloads', not api.unexpected, api.unexpected)
        check('no external service requests', not api.blocked, api.blocked)
        check('no service workers started', await page.evaluate('window.__commercialServiceWorkerAttempts === 0'))
        check('no uncaught browser errors', not errors, errors)
    except Exception as error:
        result['failures'].append({'check': 'scenario completed', 'detail': str(error)})
        await page.screenshot(path=str(output / (name + '-failure.png')), full_page=True, animations='disabled')
    finally:
        api.status_release.set()
        api.reward_release.set()
        result.update(calls=api.calls, intercepted_fictional_ads=api.ads,
                      blocked_requests=api.blocked, unexpected=api.unexpected, page_errors=errors)
        await context.close()
    result['passed'] = not result['failures']
    print(json.dumps({k: result[k] for k in ('case', 'passed', 'failures')}, ensure_ascii=False), flush=True)
    return result


async def main(output):
    output.mkdir(parents=True, exist_ok=True)
    results = []
    with patch.dict(os.environ, {'VITE_UNIFIED_APP': '1', 'VITE_RELAY_ORIGIN': ''}):
        async with local_vite(output) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            try:
                for language in ('ja', 'en'):
                    for width, theme in ((393, 'light'), (1280, 'dark')):
                        for scenario in ('free', 'guest', 'subscriber', 'device', 'pc', 'local'):
                            results.append(await run_case(browser, origin, output, language, width, theme, scenario))
            finally:
                version = browser.version
                await browser.close()
    report = {'browser': 'Chromium ' + version, 'passed': sum(r['passed'] for r in results),
              'total': len(results), 'results': results}
    (output / 'results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': report['passed'], 'total': report['total'], 'evidence': str(output)}, ensure_ascii=False))
    return report['passed'] == report['total']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Evidence directory (default: OS temporary directory)')
    args = parser.parse_args()
    raise SystemExit(0 if asyncio.run(main(args.output or Path(tempfile.mkdtemp(prefix='kyalulu-commercial-')))) else 1)
