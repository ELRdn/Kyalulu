"""Real PC settings, local API and Cloud ledger fixtures; no external provider."""
import asyncio
import json
import os
from pathlib import Path
import sqlite3
import sys
from contextlib import closing
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit
from uuid import uuid4
import httpx
from fastapi import FastAPI
from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.api import native_sync as native
from python.cloud.app import create_app
from python.cloud.auth import SESSION_COOKIE, provider_consent_version
from python.cloud.config import CloudConfig
from python.cloud.sync import export_snapshot, apply_snapshot
from python.storage import db as storage
from python.storage.native_sync import NativeSync

OUTPUT = ROOT / '.artifacts/native-restore-browser'


async def main():
    results, blocked, errors = [], [], []
    os.environ['KYALULU_UNIFIED_CLOUD_ORIGIN'] = 'https://app.test'
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        try:
            for language, width, theme in [('ja', 393, 'light'), ('en', 393, 'light'), ('en', 1280, 'dark')]:
                with TemporaryDirectory(prefix='fixture-', dir=OUTPUT) as directory:
                    root = Path(directory)
                    assert root.resolve().is_relative_to(OUTPUT.resolve())
                    cfg = CloudConfig(root=root / 'cloud', origin='https://app.test', secret='s' * 32, unified_enabled=True,
                        region_policies=(('JP', {'accepted': True, 'version': 'fixture'}),))
                    cloud = create_app(cfg, transport=httpx.MockTransport(lambda _: (_ for _ in ()).throw(AssertionError('External provider forbidden'))))
                    owner = str(uuid4())
                    cloud.state.store.account(owner, consent=provider_consent_version(cfg))
                    cloud.state.store.secret(owner, 'app-eligibility', json.dumps({'country': 'JP', 'age_band': 'adult', 'policy': 'fixture'}))
                    cloud.state.auth.save('fixture-session', owner, {'access_token': 'fake', 'refresh_token': 'fake', 'expires_in': 3600})
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(cloud), base_url=cfg.origin, cookies={SESSION_COOKIE: 'fixture-session'}, headers={'Origin': cfg.origin}) as account:
                        issued = await account.post('/api/cloud/app/devices', json={'name': 'Fixture PC'})
                        assert issued.status_code == 200, issued.text
                        device = issued.json()
                    storage.DB_PATH = root / 'pc/data.db'
                    await storage.init_db()
                    with closing(sqlite3.connect(storage.DB_PATH)) as db, db:
                        db.execute("INSERT INTO session_settings(session_id) VALUES('selected')")
                        db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user','ORIGINAL-FIXTURE')")
                    sync = NativeSync(storage.DB_PATH, cfg.origin, owner, device['token'], transport=httpx.ASGITransport(cloud))
                    sync.configure(['selected'], True, consent=True)
                    await sync.run()
                    original = cloud.state.unified.pull(owner)['changes'][0]
                    native.save({'origin': cfg.origin, 'owner': owner, 'device_id': device['id'], 'token': device['token']})
                    native.last = {'phase': 'off', 'error': ''}
                    app = FastAPI(); app.include_router(native.router, prefix='/api')
                    app.state.native_sync_transport = httpx.ASGITransport(cloud)
                    def restore():
                        snapshot = export_snapshot(storage.DB_PATH, ['selected'])
                        snapshot['tables']['chat_history'][0]['content'] = 'RESTORED-FIXTURE'
                        apply_snapshot(storage.DB_PATH, snapshot)
                    restore()
                    context = await browser.new_context(viewport={'width': width, 'height': 852})
                    writes = []
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app, client=('127.0.0.1', 1234)), base_url='http://127.0.0.1:8000', headers={'Origin': 'http://127.0.0.1:8000'}) as api:
                        try:
                            async def broker(route):
                                request, parsed = route.request, urlsplit(route.request.url)
                                if parsed.hostname != '127.0.0.1' or parsed.port != urlsplit(origin).port:
                                    blocked.append(parsed.path); await route.abort(); return
                                if not parsed.path.startswith('/api/'):
                                    await route.continue_(); return
                                assert parsed.path.startswith('/api/local/app-sync'), parsed.path
                                if request.method != 'GET': writes.append(parsed.path)
                                response = await api.request(request.method, parsed.path + ('?' + parsed.query if parsed.query else ''), headers={'Content-Type': 'application/json'}, content=request.post_data_buffer)
                                await route.fulfill(status=response.status_code, headers={'Content-Type': 'application/json', 'Cache-Control': 'no-store'}, body=response.content)
                            await context.route('**/*', broker)
                            page = await context.new_page()
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/native-restore.html').as_posix(), safe='/:'))
                            await page.wait_for_function('window.__NATIVE_RESTORE__ !== undefined')
                            await page.evaluate('([language,theme])=>{window.__unmount=window.__NATIVE_RESTORE__.mount(document.getElementById("root"),language,theme)}', [language, theme])
                            en = language == 'en'
                            async def enable():
                                await page.get_by_role('checkbox', name='Enable automatic sync' if en else '自動同期を有効にする', exact=True).check()
                                await page.get_by_role('checkbox', name='Allow these chats, settings and memories to be saved to this Cloud account.' if en else 'このアカウントへの会話・作品設定・記憶の保存と同期に同意する', exact=True).check()
                            save = page.get_by_role('button', name='Save sync settings' if en else '同期設定を保存', exact=True)
                            await enable(); await save.click()
                            dialog = page.get_by_role('dialog')
                            assert ('Earlier Cloud chats stay unchanged' if en else '以前のCloud会話は変更しません') in await dialog.inner_text()
                            assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                            await page.screenshot(path=str(OUTPUT / f'review-{language}-{width}-{theme}.png'), full_page=True, animations='disabled')
                            await dialog.get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
                            assert not writes and not sync.status()['enabled']
                            await save.click(); restore()
                            await dialog.get_by_role('button', name='Sync separate copies' if en else '別コピーとして同期', exact=True).click()
                            await page.get_by_role('alert').filter(has_text='The restore changed' if en else '復元内容が更新された').wait_for()
                            assert not sync.status()['enabled'] and len(cloud.state.unified.pull(owner)['changes']) == 1
                            await page.get_by_role('button', name='Discard settings edits' if en else '設定の変更を戻す', exact=True).click()
                            await page.wait_for_function('!document.querySelector("input[type=checkbox]").checked')
                            await enable(); await save.click()
                            await dialog.get_by_role('button', name='Sync separate copies' if en else '別コピーとして同期', exact=True).click()
                            await page.get_by_role('button', name='Sync now' if en else '今すぐ同期', exact=True).click()
                            await page.get_by_role('status').filter(has_text='Synced' if en else '同期済み').wait_for()
                            changes = cloud.state.unified.pull(owner)['changes']
                            assert len(changes) == 2 and len({change['id'] for change in changes}) == 2
                            assert next(change for change in changes if change['id'] == original['id'])['payload']['messages'][0]['content'] == 'ORIGINAL-FIXTURE'
                            assert any(change['payload']['messages'][0]['content'] == 'RESTORED-FIXTURE' for change in changes)
                            assert not sync.status()['restores'] and await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                            results.append({'language': language, 'width': width, 'theme': theme, 'cancel_kept_sync_off': True, 'stale_review_rejected': True, 'separate_copy_saved': True})
                        finally:
                            await context.close()
        finally:
            await browser.close()
    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
    (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'blocked_requests': blocked, 'page_errors': errors}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__': asyncio.run(main())
