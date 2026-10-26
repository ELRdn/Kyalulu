"""Real migration pages and production Mobile shell in a private loopback profile."""
import argparse
import asyncio
import base64
import fnmatch
import gzip
import hashlib
from http.client import HTTPConnection
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys

from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
APP = 'https://app.kyalulu.com'
MOBILE = 'https://mobile.kyalulu.com'


async def until(page, expression):
    for _ in range(200):
        if await page.evaluate(expression):
            return
        await asyncio.sleep(.1)
    raise AssertionError('Fixture state did not settle: ' + expression)


async def source_state(page):
    return await page.evaluate('''async()=>{
      const data=await new Promise((resolve,reject)=>{const r=indexedDB.open('kyalulu-mobile-v1',1);r.onerror=reject;r.onsuccess=()=>{
        const db=r.result,tx=db.transaction(['data','models']),read=tx.objectStore('data').get('current'),models=tx.objectStore('models').getAll();
        tx.oncomplete=()=>{db.close();resolve({data:read.result,models:models.result});};tx.onerror=reject;
      };});
      const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('migration-fixture-marker'),file=await(await dir.getFileHandle('original.bin')).getFile();
      const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(v=>v.toString(16).padStart(2,'0')).join('');
      return {...data,marker:{bytes:file.size,sha256:digest}};
    }''')


async def target_state(page):
    return await page.evaluate('''async()=>{
      if(!(await indexedDB.databases()).some(db=>db.name==='kyalulu-app-v1'))return [];
      return new Promise((resolve,reject)=>{const r=indexedDB.open('kyalulu-app-v1',2);r.onerror=reject;r.onsuccess=()=>{
        const db=r.result,tx=db.transaction('entities'),read=tx.objectStore('entities').getAll();
        tx.oncomplete=()=>{db.close();resolve(read.result.sort((a,b)=>a.id.localeCompare(b.id)));};tx.onerror=reject;
      };});
    }''')


async def confirm_import(page):
    await page.get_by_role('button', name='取り込む', exact=True).click()
    dialog = page.locator('dialog[open]')
    await dialog.get_by_role('button', name='OK', exact=True).click()
    await page.get_by_role('status').filter(has_text='会話を取り込みました').wait_for()


def legacy_inventory(directory):
    text = (directory / 'sw.js').read_text(encoding='utf-8')
    state = {name: json.loads(re.search(r'^const ' + name + r' = (.+);$', text, re.M)[1])
             for name in ('FILES', 'INTEGRITY', 'COMPRESSED', 'VERSION')}
    for name, expected in state['INTEGRITY'].items():
        packed = state['COMPRESSED'].get(name)
        body = (directory / (packed['path'] if packed else name)).read_bytes()
        if packed:
            assert 'sha256-' + base64.b64encode(hashlib.sha256(body).digest()).decode() == packed['integrity']
            body = gzip.decompress(body)
        assert 'sha256-' + base64.b64encode(hashlib.sha256(body).digest()).decode() == expected, name
    return state


async def check(args):
    old = legacy_inventory(args.legacy)
    new_version = json.loads(re.search(r'^const VERSION = (.+);$', (args.mobile / 'sw.js').read_text(encoding='utf-8'), re.M)[1])
    assert new_version != old['VERSION']
    assert not any('migration' in path for path in old['FILES'])
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 443))
    args.output.mkdir(parents=True, exist_ok=False)
    marker = args.output / 'phase.txt'
    marker.write_text('old', encoding='ascii')
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    policy = (ROOT / 'deploy/cloud/Caddyfile.unified.example').read_text(encoding='utf-8')
    policy = policy.replace('{$APP_DOMAIN} {', 'app.kyalulu.com {\n bind 127.0.0.1\n tls internal')
    policy = policy.replace('{$RELAY_DOMAIN}', 'relay.kyalulu.com').replace('{$CLOUD_UPSTREAM:kyalulu-cloud-runtime:8000}', f'127.0.0.1:{port}')
    config = '{\n admin off\n auto_https disable_redirects\n skip_install_trust\n log default {\n output discard\n }\n}\n' + policy
    config += f'\nmobile.kyalulu.com {{\n bind 127.0.0.1\n tls internal\n reverse_proxy 127.0.0.1:{port}\n}}\n'
    caddyfile = args.output / 'Caddyfile'
    caddyfile.write_text(config, encoding='utf-8')
    env = {**os.environ, 'XDG_DATA_HOME': str(args.output / 'caddy-data'), 'XDG_CONFIG_HOME': str(args.output / 'caddy-config')}
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    processes = []
    try:
        with (args.output / 'process.log').open('wb') as log:
            backend = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--serve', '--port', str(port),
                '--legacy', str(args.legacy), '--mobile', str(args.mobile), '--app', str(args.app), '--output', str(args.output)],
                stdout=log, stderr=log, creationflags=flags)
            processes.append(backend)
            proxy = subprocess.Popen([str(args.caddy), 'run', '--config', str(caddyfile), '--adapter', 'caddyfile'],
                                     env=env, stdout=log, stderr=log, creationflags=flags)
            processes.append(proxy)
            roots = []
            for _ in range(100):
                assert all(p.poll() is None for p in processes), 'Fixture process exited'
                roots = list((args.output / 'caddy-data').rglob('root.crt'))
                if roots:
                    break
                await asyncio.sleep(.1)
            assert len(roots) == 1
            trust = ssl.create_default_context(cafile=str(roots[0]))
            pins = set()
            for hostname in ('app.kyalulu.com', 'mobile.kyalulu.com'):
                for attempt in range(100):
                    try:
                        with socket.create_connection(('127.0.0.1', 443), timeout=5) as tcp, trust.wrap_socket(tcp, server_hostname=hostname) as tls:
                            cert = x509.load_der_x509_certificate(tls.getpeercert(binary_form=True))
                        break
                    except (ssl.SSLError, OSError):
                        assert all(p.poll() is None for p in processes), 'Fixture process exited'
                        if attempt == 99: raise
                        await asyncio.sleep(.1)
                key = cert.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
                pins.add(base64.b64encode(hashlib.sha256(key).digest()).decode())
            for attempt in range(100):
                connection = HTTPConnection('127.0.0.1', port, timeout=2)
                try:
                    connection.request('GET', '/_fixture/seed', headers={'Host': 'mobile.kyalulu.com'})
                    response = connection.getresponse()
                    assert response.getheader('X-Kyalulu-Fixture') == 'mobile-migration'
                    response.read()
                    break
                except OSError:
                    assert all(p.poll() is None for p in processes), 'Fixture process exited'
                    if attempt == 99: raise
                    await asyncio.sleep(.1)
                finally:
                    connection.close()
            async with async_playwright() as playwright:
                context = await playwright.chromium.launch_persistent_context(str(args.output / 'profile'), headless=True,
                    locale='ja-JP', viewport={'width': args.width, 'height': 852}, color_scheme=args.theme, args=[
                    '--host-resolver-rules=MAP app.kyalulu.com 127.0.0.1, MAP mobile.kyalulu.com 127.0.0.1',
                    '--ignore-certificate-errors-spki-list=' + ','.join(sorted(pins)), '--no-proxy-server'])
                errors, external, api = [], [], []
                try:
                    async def guard(route):
                        from urllib.parse import urlsplit
                        url = urlsplit(route.request.url)
                        if url.hostname not in {'app.kyalulu.com', 'mobile.kyalulu.com'}:
                            external.append(url.hostname)
                            await route.abort()
                        elif url.path.startswith('/api/') or route.request.method != 'GET':
                            api.append(url.path)
                            await route.abort()
                        else:
                            await route.continue_()
                    await context.route('**/*', guard)
                    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
                    source = await context.new_page()
                    source.on('dialog', lambda dialog: dialog.accept())
                    response = await source.goto(MOBILE + '/_fixture/seed')
                    assert response.headers.get('x-kyalulu-fixture') == 'mobile-migration', 'Not the private loopback server'
                    character = {'id': 'legacy-character', 'name': '現在の原文', 'prompt': '元の設定', 'intro': '元の挨拶'}
                    data = {'version': 1, 'selectedModel': 'kyalulu-iq3m', 'characters': [character,
                        {'id': 'unused-character', 'name': '未使用の原文', 'prompt': '未使用の設定', 'intro': ''}],
                        'conversations': [{'id': 'legacy-conversation', 'characterId': character['id'],
                            'character': {**character, 'name': '過去の原文'}, 'modelId': 'kyalulu-iq3m',
                            'title': '旧Mobileの会話', 'updatedAt': '2026-10-24T00:00:00.000Z', 'draft': '未送信の原文 🧪',
                            'messages': [{'id': f'legacy-message-{i}', 'role': 'user' if i % 2 == 0 else 'assistant',
                                          'content': f'{i}:' + '星' * 32000, 'state': 'complete' if i % 2 == 0 else 'stopped'} for i in range(14)]}]}
                    await source.evaluate('''async data=>{
                      await new Promise((resolve,reject)=>{const r=indexedDB.open('kyalulu-mobile-v1',1);r.onerror=reject;
                        r.onupgradeneeded=()=>{r.result.createObjectStore('data');r.result.createObjectStore('models',{keyPath:'id'});};
                        r.onsuccess=()=>{const db=r.result,tx=db.transaction('data','readwrite');tx.objectStore('data').put(data,'current');
                          tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=reject;};});
                      const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('migration-fixture-marker',{create:true});
                      const writer=await(await dir.getFileHandle('original.bin',{create:true})).createWritable();
                      const bytes=Uint8Array.from({length:2097171},(_,i)=>i%251);await writer.write(bytes);await writer.close();
                    }''', data)
                    original = await source_state(source)
                    await source.goto(MOBILE)
                    await source.locator('.m-app').wait_for()
                    await until(source, 'navigator.serviceWorker.controller !== null')
                    assert any(key.endswith(old['VERSION']) for key in await source.evaluate('caches.keys()'))
                    assert await source_state(source) == original
                    marker.write_text('new', encoding='ascii')
                    target = await context.new_page()
                    response = await target.goto(APP + '/_fixture/seed')
                    assert response.headers.get('x-kyalulu-fixture') == 'mobile-migration'
                    await target.evaluate('''()=>{localStorage.setItem('kyalulu-app-owner','migration-fixture-owner');
                      localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,language:'ja',country:'JP',age:25,accepted:true,genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));}''')
                    await target.goto(APP + '/migration/')
                    assert not await target.evaluate('crossOriginIsolated')
                    connect = target.get_by_role('button', name='以前のMobileに接続', exact=True)
                    async with target.expect_popup() as opened:
                        await connect.click()
                    cancelled = await opened.value
                    await cancelled.locator('.k-migration').wait_for()
                    await target.get_by_role('button', name='転送を中止', exact=True).click()
                    await expect(connect).to_be_enabled()
                    await cancelled.close()
                    async with target.expect_popup() as opened:
                        await connect.click()
                    popup = await opened.value
                    await popup.set_viewport_size({'width': args.width, 'height': 852})
                    await popup.locator('.k-migration').wait_for()
                    assert popup.url.startswith(MOBILE + '/migration/#')
                    assert await popup.evaluate('window.opener !== null && !crossOriginIsolated')
                    assert await target_state(target) == []
                    await popup.get_by_label('表示言語', exact=True).select_option('en')
                    await popup.get_by_role('button', name='Allow conversation and saved-model transfer', exact=True).click()
                    await target.get_by_role('button', name='取り込む', exact=True).wait_for()
                    await popup.get_by_role('status').filter(has_text='Review the contents').wait_for()
                    assert await popup.evaluate('document.documentElement.dataset.theme') == args.theme
                    assert await popup.get_by_label('Language', exact=True).evaluate('(el)=>el.getBoundingClientRect().height>=44')
                    assert await popup.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    await popup.screenshot(path=str(args.output / 'source-english.png'), full_page=True, animations='disabled')
                    await popup.get_by_label('Language', exact=True).select_option('ja')
                    await popup.get_by_role('status').filter(has_text='統合アプリで内容を確認').wait_for()
                    await target.get_by_label('表示言語', exact=True).select_option('en')
                    await target.get_by_role('button', name='Import', exact=True).wait_for()
                    assert await target.evaluate('document.documentElement.dataset.theme') == args.theme
                    assert await target.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    await target.screenshot(path=str(args.output / 'preview-english.png'), full_page=True, animations='disabled')
                    await target.get_by_label('Language', exact=True).select_option('ja')
                    assert await target_state(target) == []
                    await target.get_by_role('button', name='取り込む', exact=True).click()
                    await target.locator('dialog[open]').get_by_role('button', name='キャンセル', exact=True).click()
                    assert await target_state(target) == []
                    await confirm_import(target)
                    imported = await target_state(target)
                    chats = [row for row in imported if row['kind'] == 'conversation']
                    assert len(chats) == 1 and len([row for row in imported if row['kind'] == 'character']) == 3
                    payload = chats[0]['payload']
                    assert payload['storage_policy'] == 'local' and payload['rating'] == 'general'
                    assert [m['content'] for m in payload['messages']] == [m['content'] for m in data['conversations'][0]['messages']]
                    assert [m['imported_state'] for m in payload['messages']] == [m['state'] for m in data['conversations'][0]['messages']]
                    assert payload['migrated_draft'] == data['conversations'][0]['draft']
                    key = 'kyalulu:chat-recovery:v1:device%3Amigration-fixture-owner:' + chats[0]['id']
                    recovery = await target.evaluate('key=>JSON.parse(localStorage.getItem(key))', key)
                    assert recovery['draft'] == data['conversations'][0]['draft']
                    cleared = {'version': 1, 'draft': '', 'pending': None}
                    await target.evaluate('([key,value])=>localStorage.setItem(key,JSON.stringify(value))', [key, cleared])
                    await confirm_import(target)
                    assert await target_state(target) == imported
                    assert await target.evaluate('key=>JSON.parse(localStorage.getItem(key))', key) == cleared
                    pending = {**cleared, 'pending': {'id': 'fixture-pending', 'draft': '新しい送信待ち', 'regenerate': False}}
                    await target.evaluate('([key,value])=>localStorage.setItem(key,JSON.stringify(value))', [key, pending])
                    await confirm_import(target)
                    assert await target.evaluate('key=>JSON.parse(localStorage.getItem(key))', key) == pending
                    await target.evaluate('([key,value])=>localStorage.setItem(key,JSON.stringify(value))', [key, cleared])
                    assert await source_state(source) == original
                    await source.locator('.k-mobile-status summary').click()
                    await source.get_by_role('button', name='更新を確認', exact=True).click()
                    update = source.get_by_role('button', name='更新して再読み込み', exact=True)
                    await update.wait_for()
                    await update.click()
                    await source.get_by_role('alert').filter(has_text=re.compile('タブ|tab')).wait_for()
                    assert any(key.endswith(old['VERSION']) for key in await source.evaluate('caches.keys()'))
                    assert await source_state(source) == original
                    await popup.close()
                    async with source.expect_navigation(wait_until='domcontentloaded'):
                        await update.click()
                    await source.locator('.m-app').wait_for()
                    await until(source, 'navigator.serviceWorker.controller !== null')
                    await until(source, f"(async()=> (await caches.keys()).some(key=>key.endsWith({json.dumps(new_version)})))()")
                    await until(source, f"(async()=> !(await caches.keys()).some(key=>key.endsWith({json.dumps(old['VERSION'])})))()")
                    assert await source_state(source) == original
                    await source.get_by_role('button', name='保存・設定', exact=True).click()
                    await source.get_by_role('link', name='統合アプリへ移行する', exact=True).click()
                    async with source.expect_download() as downloaded:
                        await source.get_by_role('button', name='移行用ファイルを書き出す', exact=True).click()
                    export = args.output / 'fictional-migration.json'
                    await (await downloaded.value).save_as(export)
                    envelope = json.loads(export.read_text(encoding='utf-8'))
                    raw = envelope['payload'].encode('utf-8')
                    assert envelope['bytes'] == len(raw) and hashlib.sha256(raw).hexdigest() == envelope['sha256']
                    assert len(raw) > 1024 ** 2 and json.loads(envelope['payload']) == data
                    corrupt = args.output / 'corrupt-migration.json'
                    corrupt.write_text(json.dumps({**envelope, 'sha256': '0' * 64}), encoding='utf-8')
                    await target.get_by_label('移行用ファイル', exact=True).set_input_files(str(corrupt))
                    await target.get_by_role('alert').filter(has_text='SHA-256 mismatch').wait_for()
                    assert await target_state(target) == imported
                    await expect(target.get_by_role('button', name='取り込む', exact=True)).to_have_count(0)
                    await target.get_by_label('移行用ファイル', exact=True).set_input_files(str(export))
                    assert await target.get_by_label('移行用ファイル', exact=True).input_value() == ''
                    await target.get_by_role('button', name='取り込む', exact=True).wait_for()
                    await confirm_import(target)
                    assert await target_state(target) == imported
                    assert await target.evaluate('key=>JSON.parse(localStorage.getItem(key))', key) == cleared
                    assert await source_state(source) == original
                    await target.get_by_label('移行用ファイル', exact=True).set_input_files(str(export))
                    await confirm_import(target)
                    assert await target_state(target) == imported
                    assert await target.evaluate('key=>JSON.parse(localStorage.getItem(key))', key) == cleared
                    await target.screenshot(path=str(args.output / 'imported.png'), full_page=True, animations='disabled')
                    await target.goto(APP + '/device/#/chats/' + chats[0]['id'])
                    await expect(target.locator('.k-composer textarea')).to_have_value('')
                    await target.reload()
                    await expect(target.locator('.k-composer textarea')).to_have_value('')
                    after_open = await target_state(target)
                    assert [{**row, 'opened': 0} for row in after_open] == [{**row, 'opened': 0} for row in imported]
                    assert next(row['opened'] for row in after_open if row['id'] == chats[0]['id']) >= chats[0]['opened']
                    assert not errors and not external and not api, (errors, external, api)
                    result = {'width': args.width, 'theme': args.theme,
                        'production_worker_sha256': hashlib.sha256((args.legacy / 'sw.js').read_bytes()).hexdigest(),
                        'production_worker_version': old['VERSION'], 'legacy_precache_files': len(old['FILES']),
                        'updated_worker_version': new_version, 'corrupt_file_rejected_without_writes': True,
                        'legacy_active_worker_and_original_data_preserved': True, 'real_origin_neutral_popup_and_consent': True,
                        'cancelled_pair_and_import_write_nothing': True, 'multichunk_direct_copy_and_history_snapshots': True,
                        'language_switch_keeps_live_channel_and_import_preview': True,
                        'cleared_draft_and_pending_preserved_on_replay': True, 'same_file_can_be_selected_again': True,
                        'source_open_blocks_update': True,
                        'explicit_mobile_update_keeps_idb_and_opfs': True, 'file_export_hash_and_replay': True,
                        'migrated_chat_opens_and_cleared_composer_survives_reload': True,
                        'api_requests': len(api), 'external_requests': len(external), 'page_errors': len(errors)}
                    (args.output / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
                    print(json.dumps(result, indent=2))
                finally:
                    await context.close()
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    await asyncio.to_thread(process.wait, 10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    await asyncio.to_thread(process.wait)


def serve(args):
    import uvicorn
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse
    from starlette.staticfiles import StaticFiles
    from python.api.mobile import WebDist
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    legacy = StaticFiles(directory=str(args.legacy), html=True)
    mobile = StaticFiles(directory=str(args.mobile), html=True)
    unified = WebDist(directory=str(args.app), html=True)
    observed = json.loads((args.legacy / 'observed-headers.json').read_text(encoding='utf-8'))
    @app.middleware('http')
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers['X-Kyalulu-Fixture'] = 'mobile-migration'
        if request.headers.get('host') == 'mobile.kyalulu.com':
            if (args.output / 'phase.txt').read_text() == 'old':
                for name, key in (('Content-Security-Policy', 'csp'), ('Cross-Origin-Opener-Policy', 'coop'), ('Cross-Origin-Embedder-Policy', 'coep')):
                    if observed[key]: response.headers[name] = observed[key]
            else:
                match = False
                for line in (args.mobile / '_headers').read_text(encoding='utf-8').splitlines():
                    if line and not line.startswith(' '): match = fnmatch.fnmatchcase(request.url.path, line)
                    elif match and ':' in line:
                        name, value = line.strip().split(':', 1)
                        response.headers.append(name, value.strip())
        return response
    @app.get('/_fixture/seed')
    async def seed():
        return HTMLResponse('<!doctype html><meta charset="utf-8"><title>Disposable fixture setup</title>')
    @app.get('/{path:path}')
    async def web(path: str, request: Request):
        if request.headers.get('host') == 'app.kyalulu.com':
            return await unified.get_response(path, request.scope)
        assert request.headers.get('host') == 'mobile.kyalulu.com'
        selected = legacy if (args.output / 'phase.txt').read_text() == 'old' else mobile
        path = 'migration/index.html' if path in {'migration', 'migration/'} else path
        return await selected.get_response(path, request.scope)
    uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False, log_level='warning')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('legacy', 'mobile', 'app', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--caddy', type=Path)
    parser.add_argument('--width', type=int, default=393)
    parser.add_argument('--theme', choices=('light', 'dark'), default='light')
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    if args.serve:
        serve(args)
    else:
        assert args.caddy and args.caddy.is_file()
        asyncio.run(check(args))
