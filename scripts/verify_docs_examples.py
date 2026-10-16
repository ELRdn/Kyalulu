"""Capture real local UI operations using fictional SQLite data and Mock only.

Run with .venv/Scripts/python.exe scripts/verify_docs_examples.py after Web build.
Never builds Web, reads .env/user databases, or starts an inference engine.
"""
import argparse
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.parse import urlsplit
from urllib.request import urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/seo-aeo-20261012/examples'
ASSETS = ROOT / 'apps/landing/assets/docs-examples'
MODEL = {'id': 'mock-echo', 'display_name': 'Mock Echo (開発用ダミー)',
         'provider': {'type': 'mock', 'model': 'mock-echo'}, 'context_length': 4096}
MESSAGE = 'こんにちは。架空の星の図書館を案内してください。'
MEMORY = '架空の旅人ルナは、星の図書館で青いしおりを使う。'
EDITED = '架空の旅人ルナは、星の図書館で銀色のしおりを使う。'
CARD = {'spec': 'chara_card_v2', 'spec_version': '2.0', 'data': {
    'name': '星の図書館の案内人ルナ', 'description': '架空の星の図書館で本を案内する成人の司書。',
    'personality': '穏やかで好奇心が強い。', 'scenario': '星の図書館を訪ねる架空の物語。',
    'first_mes': '星の図書館へようこそ。今日はどんな本を探しますか？',
    'mes_example': '', 'creator_notes': 'ドキュメント撮影専用の架空データ。',
    'system_prompt': '', 'post_history_instructions': '', 'alternate_greetings': [],
    'tags': ['架空', '撮影用'], 'creator': 'Docs fixture', 'character_version': '1.0',
    'extensions': {'docs_fixture': True}}}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def fingerprint(dist):
    return {str(p.relative_to(dist)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(dist.rglob('*')) if p.is_file()}


def serve():
    """Harness-only safety gates; all UI, API handlers and storage are real app code."""
    from unittest.mock import patch
    import asyncio
    import uvicorn
    from pydantic_settings import BaseSettings
    original_init = BaseSettings.__init__

    def no_dotenv(self, *args, **kwargs):
        kwargs['_env_file'] = None
        original_init(self, *args, **kwargs)

    data = Path(os.environ['KYALULU_DATA_DIR']).resolve()
    assert data.is_relative_to(OUTPUT.resolve()) and not (data / 'data.db').exists()
    sys.path.insert(0, str(ROOT / 'runtime'))
    # Windows asyncio creates an internal socketpair before the outbound gate.
    loop = asyncio.new_event_loop()
    # No outbound connections, including loopback inference/discovery servers.
    def deny_connect(sock, address):
        with (data / 'blocked-outbound.jsonl').open('a', encoding='utf-8') as log:
            log.write(json.dumps({'address': str(address)}) + '\n')
        raise OSError('docs fixture denies every outbound connection')

    socket.socket.connect = deny_connect
    socket.socket.connect_ex = deny_connect
    with patch.object(BaseSettings, '__init__', no_dotenv):
        from python.core import config, registry, experiment, prompt_compiler
        config.resolve_le_token = lambda: ''
        experiment.EXPERIMENTS_DIR = data / 'experiments'
        for name in ('CHAR_DIR', 'PERSONA_DIR', 'WORLD_DIR'):
            directory = data / name.lower()
            directory.mkdir()
            setattr(prompt_compiler, name, directory)
        registry.load_yaml_registry = lambda: [MODEL]

        async def no_discovery():
            return []

        registry.list_local_models = no_discovery
        registry.list_le_models = no_discovery
        from python.providers import factory
        from python.providers import le
        le.resolve_le_token = lambda: ''
        original_provider = factory.get_provider

        def only_mock(kind, **kwargs):
            if kind != 'mock':
                raise ValueError('docs fixture permits only Mock')
            return original_provider(kind, **kwargs)

        factory.get_provider = only_mock
        from python.local_server import main
        with patch.object(uvicorn.Config, 'get_loop_factory', lambda self: lambda: loop):
            main()


def main():
    from PIL import Image
    from playwright.sync_api import sync_playwright, expect
    expect.set_options(timeout=15000)

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, default=ROOT / 'apps/web/dist')
    parser.add_argument('--final-build', action='store_true', help='Parent confirmed its final Web build.')
    args = parser.parse_args()
    dist = args.dist.resolve()
    assert (dist / 'index.html').is_file(), 'Build Web first; this script does not build it.'
    OUTPUT.mkdir(parents=True, exist_ok=True)
    run = OUTPUT / ('run-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:8])
    run.mkdir()
    data = run / 'fixture'
    data.mkdir()
    hashes = fingerprint(dist)
    snapshot = run / 'web-dist'
    shutil.copytree(dist, snapshot)
    assert fingerprint(snapshot) == hashes, 'Web build changed while snapshotting; rerun.'
    card = run / 'fictional-sillytavern-ccv2.json'
    write_json(card, CARD)
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        port = reservation.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    # Deliberately omit inherited provider keys, tokens, proxy settings and .env.
    env = {key: os.environ[key] for key in ('SYSTEMROOT', 'WINDIR', 'PATH', 'TEMP', 'TMP') if key in os.environ}
    env.update(KYALULU_DATA_DIR=str(data), KYALULU_WEB_DIST=str(snapshot), KYALULU_PORT=str(port),
               KYALULU_REMOTE_MODE='0', PYTHONIOENCODING='utf-8', KYALULU_OWNER_TOKEN=uuid4().hex)
    result = {'status': 'failed', 'run': str(run), 'dist': str(dist), 'final_build_confirmed': args.final_build,
              'source_index_sha256': hashes['index.html'], 'source_assets_sha256': hashes,
              'viewport': {'width': 960, 'height': 720}, 'data_dir': str(data),
              'api_mode': 'real isolated local Core API', 'provider': 'mock',
              'external_inference_attempts': 0, 'recall_quality_verified': False,
              'dotenv_loaded': False, 'user_database_accessed': False, 'operations': {}}
    result['verification_script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    calls, errors, blocked = [], [], []
    process = browser = page = None
    cleanup = ExitStack()
    images = {}
    log = (run / 'server.log').open('w', encoding='utf-8')
    try:
        process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--serve'],
                                   cwd=data, env=env, stdout=log, stderr=subprocess.STDOUT)
        result['owned_server_pid'] = process.pid
        for _ in range(150):
            assert process.poll() is None, 'Owned server failed; see server.log.'
            try:
                with urlopen(base + '/api/health', timeout=1) as response:
                    assert json.load(response)['status'] == 'ok'
                break
            except OSError:
                time.sleep(.1)
        else:
            raise AssertionError('Owned server readiness timeout')
        playwright = cleanup.enter_context(sync_playwright())
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport=result['viewport'], device_scale_factor=1,
                                      service_workers='block', locale='ja-JP')
        page = context.new_page()
        page.set_default_timeout(15000)
        page.on('pageerror', lambda error: errors.append(str(error)))

        def guard(route):
            request = route.request
            url = urlsplit(request.url)
            if f'{url.scheme}://{url.netloc}' != base:
                blocked.append(request.url)
                route.abort('blockedbyclient')
                return
            if url.path in {'/api/chat', '/api/chat/stream', '/api/chat/suggest'}:
                body = request.post_data_json
                assert body['model_id'] == 'mock-echo', body
            if url.path.startswith('/api/'):
                calls.append({'method': request.method, 'path': url.path,
                              'body': request.post_data_json if 'application/json' in request.headers.get('content-type', '') else None})
            route.continue_()

        context.route('**/*', guard)
        context.route_web_socket('**/*', lambda ws: (blocked.append('WebSocket: ' + ws.url), ws.close()))

        def read_api(path):
            response = context.request.get(base + path)
            assert response.ok, (path, response.status, response.text())
            return response.json()

        def capture(name, publish=False):
            page.evaluate('() => document.fonts.ready')
            page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
            png = page.screenshot(path=str(run / (name + '.png')), animations='disabled', full_page=False)
            image = Image.open(io.BytesIO(png))
            assert image.size == (960, 720)
            target = run / (name + '.webp')
            image.convert('RGB').save(target, 'WEBP', quality=92, method=6)
            with Image.open(target) as saved:
                assert saved.size == (960, 720) and saved.format == 'WEBP'
            if publish:
                images[name] = target

        session = 'docs-fictional-setup'
        page.goto(base + '/#/chats/' + session)
        draft = page.get_by_label('メッセージ', exact=True)
        expect(draft).to_be_visible()
        skip = page.get_by_role('button', name='スキップ', exact=True)
        page.get_by_role('button', name='キャラ・プリセット', exact=True).click()
        model = page.get_by_role('dialog', name='キャラ・プリセット', exact=True).get_by_label('会話モデル', exact=True)
        expect(model).to_be_enabled()
        model.select_option('mock-echo')
        page.keyboard.press('Escape')
        if skip.is_visible():
            skip.click()
        draft.fill(MESSAGE)
        page.get_by_role('button', name='送信', exact=True).click()
        expect(page.locator('.k-chat-messages').get_by_text('Mock: ' + MESSAGE, exact=True)).to_be_visible()
        expect(draft).to_have_value('')
        history = read_api('/api/chat/history?session_id=' + session)['history']
        assert any(row['role'] == 'user' and row['content'] == MESSAGE for row in history)
        assert any(row['role'] == 'assistant' and row['model_id'] == 'mock-echo'
                   and row['content'] == 'Mock: ' + MESSAGE for row in history)
        result['operations']['setup'] = {'session_id': session, 'history_readback': history,
                                          'evidence': 'real Mock stream and persisted chat history'}
        capture('setup', True)

        page.goto(base + '/#/create')
        page.get_by_label('取り込むファイル', exact=True).set_input_files(str(card))
        expect(page.get_by_role('heading', name='取り込み内容を確認', exact=True)).to_be_visible()
        expect(page.get_by_label('名前', exact=True)).to_have_value(CARD['data']['name'])
        capture('import-preview')
        with page.expect_response(lambda r: '/api/imports/' in r.url and r.url.endswith('/commit')) as committed:
            page.get_by_role('button', name='選択した内容を保存', exact=True).click()
        assert committed.value.ok, committed.value.text()
        commit = committed.value.json()
        item_id = commit['items'][0]['id']
        imported = read_api('/api/library/' + item_id)
        assert imported['document']['data']['description'] == CARD['data']['description']
        assert imported['document']['data']['first_mes'] == CARD['data']['first_mes']
        assert imported['document']['data']['extensions']['docs_fixture'] is True
        page.goto(base + '/#/create?edit=' + item_id)
        expect(page.get_by_label('名前', exact=True)).to_have_value(CARD['data']['name'])
        expect(page.get_by_label('説明', exact=True)).to_have_value(CARD['data']['description'])
        page.get_by_label('説明', exact=True).scroll_into_view_if_needed()
        result['operations']['import'] = {'synthetic_source': str(card), 'commit': commit,
            'item_readback': imported, 'evidence': 'CCv2 parser preview, UI commit, API and saved editor field readback',
            'published_screen': 'saved imported character editor'}
        capture('import', True)

        page.goto(base + '/#/chats/' + session)
        expect(draft).to_be_visible()
        panel_button = page.get_by_role('button', name='情報パネルを開く', exact=True)
        if panel_button.is_visible():
            panel_button.click()
        page.get_by_role('button', name='覚えてほしいことを追加', exact=True).click()
        page.get_by_label('覚えてほしいこと', exact=True).fill(MEMORY)
        with page.expect_response(lambda r: urlsplit(r.url).path == '/api/memory' and r.request.method == 'POST') as created:
            page.get_by_role('button', name='覚えてもらう', exact=True).click()
        assert created.value.ok, created.value.text()
        original = created.value.json()
        expect(page.locator('.k-memory__content')).to_contain_text(MEMORY)
        capture('memory-registered')
        page.get_by_role('button', name='訂正', exact=True).click()
        page.get_by_label('記憶を訂正', exact=True).fill(EDITED)
        with page.expect_response(lambda r: r.url.endswith('/api/memory/' + original['id']) and r.request.method == 'PATCH') as updated:
            page.get_by_role('button', name='保存', exact=True).click()
        assert updated.value.ok, updated.value.text()
        expect(page.locator('.k-memory__content')).to_contain_text(EDITED)
        stored = read_api('/api/memory/' + original['id'])
        assert stored['content'] == EDITED and stored['version'] > original['version']
        assert stored['origin'] == 'user'
        page.reload()
        expect(draft).to_be_enabled()
        if panel_button.is_visible():
            panel_button.click()
        expect(page.locator('.k-memory__content')).to_contain_text(EDITED)
        result['operations']['memory'] = {'registered': original, 'edited_readback': stored,
            'reload_verified': True, 'evidence': 'real memory management UI POST/PATCH, storage readback and reload',
            'inspector_limit': 'Memory Inspector is a read-only generation trace; registration/editing use 覚えていること.',
            'recall_quality_verified': False}
        capture('memory-edited-panel')
        memory_switch = page.get_by_role('switch', name='会話を覚える', exact=True)
        memory_switch.click()
        expect(memory_switch).to_have_attribute('aria-checked', 'true')
        page.keyboard.press('Escape')
        draft.fill('星の図書館のしおりについて。')
        page.get_by_role('button', name='送信', exact=True).click()
        expect(draft).to_have_value('')
        page.get_by_role('button', name='初トークの案内', exact=True).click()
        for _ in range(3):
            page.get_by_role('button', name='次へ', exact=True).click()
        page.get_by_role('button', name='Inspectorを開く', exact=True).click()
        inspector = page.locator('.k-meminspect')
        expect(inspector).to_contain_text(EDITED)
        for title in ('生プロンプト (raw prompt)', '互換設定・Loreの採用結果', 'Hubの出典・取得記録'):
            page.locator('summary').filter(has_text=title).click()
        inspector.scroll_into_view_if_needed()
        debug = read_api('/api/chat/debug?session_id=' + session)
        candidate = next(row for row in debug['memory']['candidates'] if row['id'] == original['id'])
        assert candidate['content'] == EDITED and candidate['version'] == stored['version']
        result['operations']['memory'].update(inspector_trace=debug['memory'],
            inspector_transport_verified=True, published_screen='actual Memory Inspector after edit',
            mock_transport_only=True)
        capture('memory', True)
        assert not errors and not blocked, {'page_errors': errors, 'blocked': blocked}
        assert read_api('/api/models')['models'][0]['provider_type'] == 'mock'
        browser.close()
        # Independent read-only SQLite confirmation after the UI operations.
        with sqlite3.connect(f'{(data / "data.db").as_uri()}?mode=ro', uri=True) as db:
            assert db.execute('SELECT content FROM memories WHERE id=?', (original['id'],)).fetchone()[0] == EDITED
            document = json.loads(db.execute('SELECT document_json FROM library_versions WHERE id=? ORDER BY revision DESC', (item_id,)).fetchone()[0])
            assert document['data']['description'] == CARD['data']['description']
            assert db.execute('SELECT content FROM chat_history WHERE session_id=? AND role=?', (session, 'assistant')).fetchone()[0] == 'Mock: ' + MESSAGE
        result['sqlite_readback_verified'] = True
        assert fingerprint(dist) == hashes, 'Parent Web build changed; rerun after its final build.'
        result['source_build_unchanged'] = True
        outbound = data / 'blocked-outbound.jsonl'
        assert not outbound.exists(), 'Runtime attempted outbound access; inspect blocked-outbound.jsonl.'
        result['status'] = 'passed'
    except Exception as exc:
        result['failure'] = str(exc)
        if page is not None and not page.is_closed():
            try:
                result['failure_url'] = page.url
                result['failure_ui'] = page.locator('body').inner_text()[:6000]
                page.screenshot(path=str(run / 'failure.png'))
            except Exception:
                pass
        raise
    finally:
        if browser is not None and browser.is_connected():
            browser.close()
        cleanup.close()
        if process is not None and process.poll() is None:
            from urllib.request import Request
            try:
                with urlopen(Request(base + '/api/local/shutdown', data=b'', method='POST',
                                     headers={'x-kyalulu-owner': env['KYALULU_OWNER_TOKEN']}), timeout=5):
                    pass
                process.wait(timeout=10)
            except Exception:
                if os.name == 'nt':
                    # The Windows venv launcher has its own Python child.
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        log.close()
        result.update(api_calls=calls, page_errors=errors, blocked_browser_requests=blocked,
                      owned_server_stopped=process is None or process.poll() is not None,
                      chromium_disconnected=browser is None or not browser.is_connected())
        if result['status'] == 'passed':
            assert result['owned_server_stopped'] and result['chromium_disconnected']
            ASSETS.mkdir(parents=True, exist_ok=True)
            result['images'] = {}
            for name, source in images.items():
                target = ASSETS / (name + '.webp')
                shutil.copyfile(source, target)
                result['images'][name] = {'path': str(target), 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                                         'width': 960, 'height': 720}
        write_json(run / 'acceptance.json', result)
        write_json(OUTPUT / 'acceptance.json', result)
        write_json(run / 'api-calls.json', calls)
        print(json.dumps({'status': result['status'], 'acceptance': str(OUTPUT / 'acceptance.json'),
                          'failure': result.get('failure')}, ensure_ascii=False))


if __name__ == '__main__':
    if not __debug__:
        raise SystemExit('Run without -O; safety and acceptance assertions must be enabled.')
    if sys.argv[1:] == ['--serve']:
        serve()
    else:
        main()
