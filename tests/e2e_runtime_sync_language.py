"""Real React/IndexedDB sync settings; only fictional loopback HTTP responses."""
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright, expect
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OWNER = 'fixture-runtime-sync-owner'
RAW = '未知の同期診断 request_id=fixture-runtime-sync-request-42'
API = 'window.__RUNTIME_SYNC_LANGUAGE__'


async def main():
    requests, blocked, errors, checks = [], [], [], []
    consent = {'revision': 41, 'selected': [], 'accepted': False}
    fail_stop, invalid_sessions = True, False
    stop_observed = None
    with TemporaryDirectory(prefix='kyalulu-runtime-sync-language-') as directory:
        async with local_vite(Path(directory)) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            try:
                context = await browser.new_context(service_workers='block', viewport={'width': 1000, 'height': 850})
                try:
                    async def route(request):
                        nonlocal consent, stop_observed
                        url, incoming = urlsplit(request.request.url), request.request
                        if url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port:
                            blocked.append(incoming.url); await request.abort(); return
                        if not url.path.startswith('/api/'):
                            await request.continue_(); return
                        body = incoming.post_data_json if incoming.post_data else None
                        requests.append({'method': incoming.method, 'path': url.path, 'query': url.query,
                                         'body': body, 'owner': incoming.headers.get('x-kyalulu-owner')})
                        if url.path != '/api/mobile/status':
                            assert incoming.headers.get('x-kyalulu-owner') == OWNER, 'Wrong owner header'
                        if url.path == '/api/cloud/app/runtime-consent':
                            if incoming.method == 'PUT':
                                assert body['revision'] == consent['revision'], 'Consent revision changed'
                                if not body['consent']:
                                    stop_observed = await page.evaluate(API + '.snapshot()')
                                    assert stop_observed['consent'] is False, 'Local withdrawal must precede Cloud request'
                                    assert stop_observed['outbox']['withdrawn'] is True, 'Outbox must be withdrawn first'
                                    if fail_stop:
                                        await request.fulfill(status=503, json={'error': RAW}); return
                                consent = {'revision': consent['revision'] + 1, 'selected': body['selected'], 'accepted': body['consent']}
                            else:
                                assert incoming.method == 'GET'
                            value = consent
                        elif url.path == '/api/chat/sessions' and incoming.method == 'GET':
                            value = {} if invalid_sessions else {'sessions': [
                                {'session_id': 'chat-a', 'character_name': '原文の会話名', 'count': 2},
                                {'session_id': 'chat-b', 'character_name': '別の会話名', 'count': 1}]}
                        elif url.path == '/api/mobile/status' and incoming.method == 'GET':
                            value = {'cloud_mode': True, 'authenticated': True, 'owner_scope': OWNER}
                        elif url.path == '/api/cloud/app/sync' and incoming.method == 'GET':
                            value = {'changes': [], 'cursor': 0, 'has_more': False}
                        else:
                            blocked.append(incoming.url); await request.abort(); return
                        await request.fulfill(json=value)

                    await context.route('**/*', route)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    path = quote((ROOT / 'tests/fixtures/runtime-sync-language.html').as_posix(), safe='/:')
                    await page.goto(origin + '/@fs/' + path)
                    try:
                        await page.wait_for_function(API + ' !== undefined', timeout=15000)
                    except Exception:
                        print(json.dumps({'page_errors': errors, 'blocked': blocked,
                                          'vite': (Path(directory) / 'vite.log').read_text(encoding='utf-8', errors='replace')[-4000:]}, ensure_ascii=False))
                        raise
                    await page.get_by_text('Cloud会話をこの端末と同期', exact=True).click()
                    boxes = page.locator('#root .k-cloud__checkbox input')
                    await expect(boxes).to_have_count(2)
                    await boxes.nth(0).check()
                    await page.get_by_role('button', name='選択を保存して有効にする', exact=True).click()
                    await page.get_by_role('dialog').get_by_role('button', name='同意して有効にする', exact=True).click()
                    await page.get_by_text('同期を有効にしました。コピーは別の会話として表示します。', exact=True).wait_for()
                    assert consent == {'revision': 42, 'selected': ['chat-a'], 'accepted': True}
                    await page.evaluate(API + '.seedOutbox()')

                    async def switches(japanese, english, role='status'):
                        before = await page.evaluate(API + '.snapshot()')
                        request_count, saved_consent = len(requests), dict(consent)
                        raw_alerts = await page.get_by_role('alert').all_text_contents()
                        mounted = await page.locator('#root > details').element_handle()
                        for language, text, stale in [('en', english, japanese), ('ja', japanese, english), ('en', english, japanese)]:
                            await page.evaluate('language=>' + API + '.language(language)', language)
                            await expect(page.get_by_role(role).filter(has_text=text)).to_have_text(text)
                            await expect(page.get_by_text(stale, exact=True)).to_have_count(0)
                            await page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                            assert await page.evaluate(API + '.snapshot()') == before, 'Language changed selections, owner, consent or stored data'
                            if role != 'alert':
                                assert await page.get_by_role('alert').all_text_contents() == raw_alerts, 'Raw diagnostics changed'
                            assert await mounted.evaluate('(node)=>node===document.querySelector("#root > details")'), 'Component was remounted'
                            assert len(requests) == request_count and consent == saved_consent, 'Language change issued a request'
                        checks.append(english)
                        return before

                    original = await switches('同期を有効にしました。コピーは別の会話として表示します。',
                                              'Sync enabled. Copies are listed separately.')
                    assert original['selected'] == [True, False] and original['consent'] is True
                    await page.get_by_role('button', name='Stop copying and device sync', exact=True).click()
                    await expect(page.get_by_role('alert')).to_have_text('Error: ' + RAW)
                    withdrawn = await switches('この端末の同期は停止しました。Cloud側のコピー停止は再試行して確認してください。',
                                               'Sync on this device is stopped. Retry to confirm that Cloud copying is also stopped.')
                    assert withdrawn['consent'] is False and withdrawn['selected'] == [True, False]
                    assert stop_observed['outbox'] == withdrawn['outbox']
                    assert withdrawn['outbox'] == {**original['outbox'], 'withdrawn': True}
                    assert withdrawn['storage']['entities'] == original['storage']['entities'], 'Draft or conversation changed'
                    assert withdrawn['storage']['parts'] == original['storage']['parts'], 'Stored transfer payload changed'
                    await expect(page.get_by_role('alert')).to_have_text('Error: ' + RAW)

                    fail_stop = False
                    await page.get_by_role('button', name='Stop copying and device sync', exact=True).click()
                    await page.get_by_text('Cloud copying and sync on this device stopped. Existing copies are retained.', exact=True).wait_for()
                    await switches('Cloudとのコピーと、この端末の同期を停止しました。保存済みコピーは残ります。',
                                   'Cloud copying and sync on this device stopped. Existing copies are retained.')
                    assert consent == {'revision': 43, 'selected': [], 'accepted': False}
                    await expect(boxes.nth(0)).not_to_be_checked()

                    invalid_sessions = True
                    await page.get_by_role('button', name='Reload settings', exact=True).click()
                    await page.get_by_role('alert').get_by_text('Could not verify Cloud conversations', exact=True).wait_for()
                    await switches('Cloudの会話を確認できません', 'Could not verify Cloud conversations', 'alert')
                    invalid_sessions = False
                    await page.get_by_role('button', name='Reload settings', exact=True).click()
                    await expect(boxes).to_have_count(2)
                    await boxes.nth(0).check()
                    await page.get_by_role('button', name='Save selection and enable', exact=True).click()
                    dialog = page.get_by_role('dialog')
                    await expect(dialog).to_be_visible()
                    before_owner, request_count = await page.evaluate(API + '.snapshot()'), len(requests)
                    await page.evaluate(API + '.owner(true)')
                    await expect(boxes).to_have_count(0)
                    await dialog.get_by_role('button', name='Enable sync', exact=True).click()
                    await expect(page.get_by_role('alert')).to_have_text('Account changed')
                    await page.evaluate(API + '.language("ja")')
                    await expect(page.get_by_role('alert')).to_have_text('アカウントが切り替わりました')
                    await page.evaluate(API + '.language("en")')
                    await expect(page.get_by_role('alert')).to_have_text('Account changed')
                    after_owner = await page.evaluate(API + '.snapshot()')
                    assert after_owner['owner'] == 'fixture-runtime-sync-foreign'
                    assert after_owner['storage'] == before_owner['storage'] and len(requests) == request_count
                    await page.evaluate(API + '.owner(false)')
                    await expect(boxes).to_have_count(2)
                    await expect(boxes.nth(0)).to_be_checked()
                    assert (await page.evaluate(API + '.snapshot()')) == before_owner
                    assert len(requests) == request_count and not consent['accepted'], 'Owner change granted consent or sent a request'
                    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
                    print(json.dumps({'passed': 1, 'browser': browser.version, 'real_react_and_indexeddb': True,
                                      'notice_checks': len(checks), 'requests': requests, 'owner_guard': True,
                                      'withdrawn_request_id': withdrawn['outbox']['request_id'],
                                      'blocked_requests': blocked, 'page_errors': errors}, ensure_ascii=False, indent=2))
                finally:
                    await context.close()
            finally:
                await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
