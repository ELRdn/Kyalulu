"""Real browser -> opaque loopback Relay -> Host -> isolated Runtime acceptance.

Uses the actual PWA in Vite development mode (localhost secure-context exception).
No user model or data. Physical Android/TLS/production deployment are separate gates.
"""

import asyncio
import base64
import copy
import hashlib
import io
import json
import os
import socket
import subprocess
import sys
import threading
import uuid
import pytest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "runtime"))


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class MemoryVault:
    def __init__(self, config):
        self.config = config

    def read(self):
        return copy.deepcopy(self.config)

    def write(self, value):
        self.config = copy.deepcopy(value)


async def language_in_place(page, language):
    await page.evaluate('''async language=>{
        const {preferences,savePreferences}=await import('/src/lib/appContext.ts');
        savePreferences({...preferences(),language});
    }''', language)


async def runtime_ready(page, ready):
    from playwright.async_api import expect

    reconnect = page.get_by_role('button', name='もう一度接続する', exact=True)
    # Settle the 15s channel handshake / 10s access check before inspecting the route.
    await expect(ready.or_(reconnect)).to_be_enabled(timeout=30000)
    retried = await reconnect.is_visible()
    if retried:
        await reconnect.click()  # One explicit access GET; never retry a generation or cancel POST.
    await expect(ready).to_be_visible(timeout=30000)
    return int(retried)


@pytest.mark.asyncio
async def test_two_device_management_permissions():
    from fastapi import Request
    from python.api.mobile import local_admin
    from python.remote.host import HostService
    from test_remote_bridge import collect, setup, submit

    unused, app, *_ = setup()
    devices = [str(uuid.uuid4()), str(uuid.uuid4())]
    vault = MemoryVault(dict(version=1, relay='https://relay.example', app_origin='https://app.example',
                            owner_id=str(uuid.uuid4()), host_id=str(uuid.uuid4()),
                            devices={d: {'approved': True, 'name': 'Fictional device'} for d in devices}))
    host = HostService(app, vault)

    @app.get('/api/diagnostics')
    async def diagnostics(request: Request):
        assert not local_admin(request)
        return {'ready': True}

    try:
        for enabled, expected in (((), (403, 403)), ((0,), (200, 403)),
                                  ((0, 1), (200, 200)), ((1,), (403, 200)), ((), (403, 403))):
            for i, device in enumerate(devices):
                host.set_management(device, i in enabled)
            for device, status in zip(devices, expected):
                assert (await collect(submit(host.bridge, device=device, path='/api/diagnostics')))[0]['status'] == status
                assert host.authorized(device)
                assert vault.read()['devices'][device]['management'] == host.management(device)
                assert (await collect(submit(host.bridge, device=device)))[0]['status'] == 200
    finally:
        await host.stop()
        await unused.aclose()


async def run():
    output = ROOT / ".artifacts" / "remote-v1" / ("e2e-" + uuid.uuid4().hex[:8])
    output.mkdir(parents=True)
    os.environ["KYALULU_DATA_DIR"] = str(output)
    os.environ["KYALULU_EXPERIMENTS_DIR"] = str(output / "experiments")
    os.environ["KYALULU_REMOTE_MODE"] = "0"
    os.environ.pop("KYALULU_WEB_DIST", None)
    import httpx
    import uvicorn
    from python.core import config, registry

    fixture = ExitStack()
    fixture.enter_context(patch.object(config, 'settings', config.Settings(
        _env_file=None, le_api_token='', openai_compatible_api_key='', llm_api_key='',
        le_token_file=str(output / 'unused-le-token'))))
    from python.api import providers

    models = output / 'models'
    models.mkdir()
    (models / 'mock-echo.yaml').write_bytes((ROOT / 'models/mock-echo.yaml').read_bytes())
    fixture.enter_context(patch.object(registry, 'MODELS_DIR', models))
    fixture.enter_context(patch.dict(os.environ, {'KYALULU_MODELS_DIR': str(models)}))
    fixture.enter_context(patch.object(providers, 'TYPES', ('mock',)))
    from playwright.async_api import Error as PlaywrightError
    from playwright.async_api import async_playwright, expect
    from python.api.main import app
    from python.relay.app import create_app
    from python.remote.crypto import generate_keypair
    from python.remote.host import HostService

    relay_port, web_port = port(), port()
    relay_origin, web_origin = (
        f"http://127.0.0.1:{relay_port}",
        f"http://127.0.0.1:{web_port}",
    )
    external_attempts = []
    original_http = httpx.AsyncHTTPTransport.handle_async_request

    async def fixture_http(transport, request):
        origin = urlsplit(str(request.url))
        if origin.scheme + '://' + origin.netloc not in (relay_origin, web_origin):
            external_attempts.append({'source': 'runtime', 'method': request.method, 'path': origin.path})
            raise AssertionError('non-fixture HTTP request')
        return await original_http(transport, request)

    fixture.enter_context(patch.object(httpx.AsyncHTTPTransport, 'handle_async_request', fixture_http))
    relay = create_app(str(output / "relay.sqlite3"), [web_origin])
    relay_trace = []
    original_attach = relay.state.hub.attach

    def observe_attach(peer):
        entry = {'role': peer.device['role'], 'existing_peer': peer.device['id'] in relay.state.hub.peers}
        relay_trace.append(entry)
        original_stop = peer.stop

        def observe_stop(code=1013):
            caller = sys._getframe(1)
            stopped = {'code': code, 'source': caller.f_code.co_name, 'line': caller.f_lineno}
            if error := sys.exception():
                trace = error.__traceback__
                while trace and trace.tb_next:
                    trace = trace.tb_next
                stopped.update(exception_type=type(error).__name__, exception_line=trace.tb_lineno if trace else None)
            entry.setdefault('stop', stopped)
            original_stop(code)

        peer.stop = observe_stop
        try:
            original_attach(peer)
        except Exception as error:
            entry['exception_type'] = type(error).__name__
            entry['status'] = getattr(error, 'status_code', None)
            raise

    relay.state.hub.attach = observe_attach
    store = relay.state.store
    issued = store.redeem_invite(store.invite(), "Acceptance PC")
    private, public = generate_keypair()
    vault = MemoryVault(
        dict(
            version=1,
            relay=relay_origin,
            app_origin=web_origin,
            **issued,
            private_key=private.hex(),
            public_key=public.hex(),
            devices={},
            pairings={},
        )
    )
    host = HostService(app, vault, le_probe=lambda: None)
    server = uvicorn.Server(
        uvicorn.Config(
            relay,
            host="127.0.0.1",
            port=relay_port,
            log_level="error",
            access_log=False,
            loop="asyncio:SelectorEventLoop" if os.name == "nt" else "auto",
            timeout_graceful_shutdown=10,
        )
    )
    server_errors = []

    def serve_relay():
        try:
            server.run()
        except BaseException as error:
            server_errors.append(error)

    # Keep Playwright's subprocess-capable loop separate from the Windows Relay loop.
    server_thread = threading.Thread(target=serve_relay, daemon=True)
    server_thread.start()
    vite = None
    log = None
    report = {
        "checks": [],
        "runtime_recoveries": [],
        "external_attempts": external_attempts,
        "limits": ["Mock model", "emulated Android", "loopback development origins"],
    }

    async def wait_until(predicate, seconds=15):
        for _ in range(seconds * 20):
            if predicate():
                return
            await asyncio.sleep(0.05)
        raise AssertionError("condition timeout")

    try:
        await wait_until(lambda: server.started)
        async with app.router.lifespan_context(app):
            app.state.remote_host = host
            await host.start()
            await wait_until(lambda: host.connected)
            env = {**os.environ, "VITE_RELAY_ORIGIN": relay_origin, "VITE_UNIFIED_APP": "1"}
            log = (output / "vite.log").open("wb")
            vite = await asyncio.to_thread(
                subprocess.Popen,
                [
                    "node",
                    str(ROOT / "apps/web/node_modules/vite/bin/vite.js"),
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(web_port),
                    "--strictPort",
                ],
                cwd=ROOT / "apps/web",
                env=env,
                stdout=log,
                stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            async with httpx.AsyncClient(trust_env=False) as check:
                for _ in range(100):
                    try:
                        if (await check.get(web_origin)).status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(0.1)
                else:
                    raise AssertionError("Vite did not start")
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                try:
                    async def remote_context():
                        context = await browser.new_context(
                            locale="ja-JP",
                            viewport={"width": 393, "height": 851},
                            is_mobile=True,
                            has_touch=True,
                        )
                        await context.expose_binding('fixtureBlockedFetch', lambda _source, path:
                                                     external_attempts.append({'source': 'browser', 'path': path}))
                        # Keep the browser cache and native WebSocket behavior used by the recovery checks.
                        await context.add_init_script('''(allowed => {
                        const original = window.fetch.bind(window);
                        window.fetch = (input, init) => {
                            const url = new URL(input instanceof Request ? input.url : input, location.href);
                            if (url.pathname.startsWith('/api/') || !allowed.includes(url.origin)) {
                                void window.fixtureBlockedFetch(url.pathname);
                                return Promise.reject(new Error('non-fixture HTTP request'));
                            }
                            return original(input, init);
                        };
                    })(%s)''' % json.dumps([web_origin, relay_origin]))
                        await context.add_init_script('''
                        if(!localStorage.getItem('kyalulu-app-preferences-v1')){
                            localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,language:'ja',country:'JP',age:25,accepted:true,
                              genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
                            localStorage.setItem('kyalulu-execution-target','pc');
                        }
                    ''')
                        return context

                    context = await remote_context()
                    page = await context.new_page()
                    errors, requests = [], []
                    page.on("pageerror", lambda e: errors.append(str(e)))
                    page.on("request", lambda r: requests.append(r.url))
                    page.on('websocket', lambda ws: external_attempts.append({'source': 'browser-websocket'})
                            if urlsplit(ws.url).netloc not in (urlsplit(web_origin).netloc, urlsplit(relay_origin).netloc) else None)
                    link = await host.pair()
                    await page.goto(link["url"])
                    assert "#remote=" not in page.url
                    await page.get_by_label("この端末の名前").fill(
                        "Acceptance Android"
                    )
                    await language_in_place(page, 'en')
                    await expect(page.get_by_label('This device’s name')).to_have_value('Acceptance Android')
                    await page.get_by_role(
                        "button", name="Register with this PC", exact=True
                    ).click()
                    await wait_until(lambda: bool(host.status()["pending"]))
                    code = await page.locator(
                        'form [role="status"] strong'
                    ).inner_text()
                    device = host.status()["pending"][0]["device_id"]
                    assert not host.authorized(device)
                    await language_in_place(page, 'ja')
                    await expect(page.get_by_role('button', name='PCの承認を待っています…', exact=True)).to_be_visible()
                    assert await page.locator('form [role="status"] strong').inner_text() == code
                    assert [item['device_id'] for item in host.status()['pending']] == [device]
                    await page.screenshot(
                        path=str(output / "approval.png"), full_page=True
                    )
                    await host.approve(device, code)
                    await expect(
                        page.get_by_role("heading", name="登録できました")
                    ).to_be_visible()
                    keys_before = await page.evaluate('''async()=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        const bytes=new TextEncoder().encode(JSON.stringify(await remoteDevices()));
                        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
                    }''')
                    await language_in_place(page, 'en')
                    await expect(page.get_by_role('heading', name='Registered successfully', exact=True)).to_be_visible()
                    assert await page.evaluate('''async expected=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        const bytes=new TextEncoder().encode(JSON.stringify(await remoteDevices()));
                        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')===expected;
                    }''', keys_before)
                    await page.screenshot(path=str(output / 'paired-en.png'), full_page=True)
                    await language_in_place(page, 'ja')
                    await page.get_by_role(
                        "button", name="会話を開く", exact=True
                    ).click()
                    await expect(
                        page.get_by_role("heading", name="チャット", exact=True)
                    ).to_be_visible(timeout=30000)
                    report["checks"].append(
                        "QR fragment erased; Noise pinned pairing; PC approval; persisted reconnect"
                    )
                    report['checks'].append('JA/EN pairing preserves name, one pending approval, confirmation code and persisted device-key fingerprint')
                    await language_in_place(page, 'en')
                    await expect(page.locator('.k-remote-banner')).to_contain_text('Encrypted connection')
                    await page.goto(web_origin + '/#/profile')
                    destinations=page.get_by_role('region',name='Remote destinations',exact=True)
                    # A named section uses the region role and must appear only once.
                    await expect(destinations).to_have_count(1)
                    await destinations.get_by_role('button',name='Connect',exact=True).click()
                    review=destinations.get_by_role('group',name='Confirm PC destination',exact=True)
                    await expect(review).to_contain_text('Unsent drafts are saved separately')
                    await destinations.screenshot(path=str(output/'remote-settings-en.png'),animations='disabled')
                    await language_in_place(page,'ja')
                    japanese=page.get_by_role('region',name='Remoteの接続先',exact=True)
                    await expect(japanese.get_by_role('group',name='PCの接続先を確認',exact=True)).to_contain_text('未送信の下書きは接続先ごと')
                    await japanese.get_by_role('button',name='キャンセル',exact=True).click()
                    assert await page.evaluate('''async expected=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        const bytes=new TextEncoder().encode(JSON.stringify(await remoteDevices()));
                        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')===expected;
                    }''',keys_before)
                    assert len(host.status()['devices'])==1
                    report['checks'].append('unified PC settings have one destination list; JA/EN review cancellation retains registered keys')
                    await page.goto(web_origin + '/#/chats')

                    async def api(path, method="GET", body=None, *, target=page):
                        return await target.evaluate(
                            """async a => {
                          const {apiFetch} = await import('/src/lib/transport.ts');
                          const r = await apiFetch(a.path, {method:a.method, headers:a.body?{'Content-Type':'application/json'}:undefined, body:a.body?JSON.stringify(a.body):undefined});
                          return {status:r.status, body:await r.text()};
                        }""",
                            {"path": path, "method": method, "body": body},
                        )

                    assert (await api("/api/diagnostics"))["status"] == 403
                    assert (await api("/api/remote/pair", "POST"))["status"] == 403
                    report["checks"].append(
                        "Runtime and Host administration denied over encrypted channel"
                    )
                    await page.get_by_role(
                        "button", name="新しいチャット", exact=True
                    ).click()
                    await page.wait_for_url("**/#/chats/*")
                    diagnostic = await api(
                        "/api/chat/settings?session_id=" + page.url.rsplit("/", 1)[1]
                    )
                    (output / "settings-check.json").write_text(
                        json.dumps(diagnostic), encoding="utf-8"
                    )
                    await page.get_by_role(
                        "button", name="会話エンジンを選ぶ", exact=True
                    ).click()
                    await (
                        page.get_by_role("dialog")
                        .get_by_label("会話モデル", exact=True)
                        .select_option("mock-echo")
                    )
                    await page.get_by_role("button", name="閉じる", exact=True).click()
                    composer = page.locator(".k-composer__input")
                    await expect(composer).to_be_enabled()
                    await composer.fill("暗号化通信の下書き")
                    await page.reload()
                    await expect(composer).to_have_value(
                        "暗号化通信の下書き", timeout=30000
                    )
                    await expect(composer).to_be_enabled()
                    await composer.fill("REMOTE_PRIVATE_CANARY_こんにちは")
                    await page.get_by_role("button", name="送信", exact=True).click()
                    await expect(
                        page.get_by_text(
                            "Mock: REMOTE_PRIVATE_CANARY_こんにちは", exact=True
                        )
                    ).to_be_visible(timeout=30000)
                    sid = page.url.rsplit("/", 1)[1]
                    await wait_until(lambda: not host.bridge._closed)
                    for _ in range(100):
                        history = json.loads(
                            (await api("/api/chat/history?session_id=" + sid))["body"]
                        )["history"]
                        if len(history) == 2:
                            break
                        await asyncio.sleep(0.1)
                    assert len(history) == 2
                    assert history[0]["content"] == "REMOTE_PRIVATE_CANARY_こんにちは"
                    report["checks"].append(
                        "draft reload, explicit Mock model, one durable user/assistant pair"
                    )
                    scenario = output / 'management-scenario.yaml'
                    scenario.write_text(json.dumps({
                        'id': 'remote_management_fictional', 'description': 'Fictional permission acceptance only',
                        'character': None,
                        'turns': [{'turn': 1, 'user': 'REMOTE_MANAGEMENT_FICTIONAL_ONLY'}],
                    }), encoding='utf-8')
                    research_body = {'scenario': str(scenario), 'model_id': 'mock-echo', 'runs': 1, 'seed': 42}
                    management_requests = [('/api/diagnostics', 'GET', None), ('/api/commands', 'GET', None),
                                           ('/api/providers', 'GET', None),
                                           ('/api/commands', 'POST', {'input': '/help'}),
                                           ('/api/experiments', 'GET', None),
                                           ('/api/experiments/run', 'POST', research_body)]
                    management_trace = []

                    async def management_request(phase, path, method='GET', body=None, status=200):
                        response = await api(path, method, body)
                        management_trace.append({'phase': phase, 'method': method, 'path': path, 'status': response['status']})
                        assert response['status'] == status, (phase, method, path, response)
                        return json.loads(response['body'])

                    for path, method, body in management_requests:
                        await management_request('conversation_only', path, method, body, 403)
                    assert not (output / 'experiments').exists()
                    assert not json.loads((await api('/api/mobile/status'))['body'])['administrative']
                    connections = dict(host.connections)
                    assert any(c.device_id == device for c in connections.values())
                    devices_before = copy.deepcopy(host.config['devices'])
                    browser_entities = await page.evaluate('''async()=>{
                        const {allEntities}=await import('/src/lib/appStore.ts');
                        return JSON.stringify(await allEntities());
                    }''')
                    # Grant through the existing PC-local API, never a Remote principal.
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                                 base_url='http://127.0.0.1:5174',
                                                 headers={'Origin': 'http://127.0.0.1:5174'}) as local:
                        permission_path = '/api/remote/devices/' + device + '/management'
                        granted = await local.put(permission_path, json={'enabled': True})
                        assert granted.status_code == 200 and granted.json() == {'management': True}
                        assert host.management(device) and vault.read()['devices'][device]['management'] is True
                        assert json.loads((await api('/api/mobile/status'))['body'])['administrative']
                        diagnostics = await management_request('granted', '/api/diagnostics')
                        storage = next(c for c in diagnostics['checks'] if c['id'] == 'storage')
                        assert storage['ok'] and Path(storage['detail']['path']).resolve() == (output / 'data.db').resolve()
                        commands = await management_request('granted', '/api/commands')
                        assert any(c['name'] == '/le models' for c in commands['commands'])
                        provider_info = await management_request('granted', '/api/providers')
                        assert provider_info['providers'] == [{'id': 'mock', 'type': 'mock',
                                                               'capabilities': {'streaming': True, 'structured_output': True}}]
                        help_result = await management_request('granted', '/api/commands', 'POST', {'input': '/help'})
                        assert help_result['ok'] and '/le models' in help_result['output'] and not help_result['refresh_models']
                        assert (await management_request('granted', '/api/experiments'))['experiments'] == []
                        research = await management_request('granted', '/api/experiments/run', 'POST', research_body)
                        assert research['count'] == 1
                        result = research['results'][0]
                        result_dir = Path(result['path']).resolve()
                        assert result_dir == (output / 'experiments' / result['experiment_id']).resolve()
                        meta = json.loads((result_dir / 'meta.json').read_text(encoding='utf-8'))
                        turns = json.loads((result_dir / 'turns.json').read_text(encoding='utf-8'))
                        assert meta['provider'] == 'mock' and meta['status'] == 'completed' and meta['turns'] == 1
                        assert meta['character_id'] is None and meta['official'] is False
                        assert len(turns) == 1 and turns[0]['user'] == 'REMOTE_MANAGEMENT_FICTIONAL_ONLY'
                        assert turns[0]['status'] == 'completed' and 'REMOTE_MANAGEMENT_FICTIONAL_ONLY' in turns[0]['assistant']
                        assert all((result_dir / name).is_file() for name in ('turns.jsonl', 'raw_prompt.txt', 'metrics.json'))
                        assert [e['experiment_id'] for e in (await management_request('granted', '/api/experiments'))['experiments']] == [result['experiment_id']]
                        saved_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in result_dir.iterdir()}
                        local_only = [('/api/remote/status', 'GET', None), ('/api/remote/pair', 'POST', None),
                                      ('/api/remote/approve', 'POST', {'device_id': device, 'code': '000000'}),
                                      (permission_path, 'PUT', {'enabled': False}),
                                      ('/api/remote/devices/' + device, 'DELETE', None),
                                      ('/api/remote/stop', 'POST', None), ('/api/mobile/admin/code', 'POST', None),
                                      ('/api/mobile/admin/devices', 'GET', None)]
                        for path, method, body in local_only:
                            await management_request('granted_local_only', path, method, body, 403)
                        assert host.connected and host.management(device)
                        revoked = await local.put(permission_path, json={'enabled': False})
                        assert revoked.status_code == 200 and revoked.json() == {'management': False}
                        # The very next Remote request must observe revocation on this channel.
                        await management_request('revoked_next_request', '/api/diagnostics', status=403)
                    for path, method, body in management_requests[1:]:
                        await management_request('revoked', path, method, body, 403)
                    assert host.authorized(device) and not host.management(device)
                    assert vault.read()['devices'][device]['management'] is False
                    assert not json.loads((await api('/api/mobile/status'))['body'])['administrative']
                    assert host.connections.keys() == connections.keys()
                    assert all(host.connections[k] is c for k, c in connections.items())
                    assert host.config['devices'] == {**devices_before, device: {**devices_before[device], 'management': False}}
                    assert json.loads((await api('/api/chat/history?session_id=' + sid))['body'])['history'] == history
                    assert await page.evaluate('''async()=>{
                        const {allEntities}=await import('/src/lib/appStore.ts');
                        return JSON.stringify(await allEntities());
                    }''') == browser_entities
                    assert await page.evaluate('''async expected=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        const bytes=new TextEncoder().encode(JSON.stringify(await remoteDevices()));
                        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')===expected;
                    }''', keys_before)
                    assert list((output / 'experiments').iterdir()) == [result_dir]
                    assert {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in result_dir.iterdir()} == saved_hashes
                    assert all(b'REMOTE_MANAGEMENT_FICTIONAL_ONLY' not in p.read_bytes() for p in output.glob('relay.sqlite3*'))
                    report['management'] = {'requests': management_trace, 'same_host_connections': True,
                                            'experiment_directory': str(result_dir), 'result_sha256': saved_hashes,
                                            'provider': 'mock', 'browser_entities_unchanged': True,
                                            'registered_keys_unchanged': True, 'runtime_data_root': str(output),
                                            'relay_has_no_plaintext_research_canary': True}
                    report['checks'].extend([
                        'conversation-only rejects diagnostics, model-management help and research; PC-local grant enables them',
                        'one fictional Mock research turn saves complete results only beneath target PC data root',
                        'management grant never enables pairing, approval, permission changes, revocation, Host stop or admin keys',
                        'same Noise connection observes management revocation on next request; registration, keys, history and conversation remain usable',
                    ])
                    second_context = await remote_context()
                    second = await second_context.new_page()
                    second.on('pageerror', lambda e: errors.append(str(e)))
                    second.on('request', lambda r: requests.append(r.url))
                    second.on('websocket', lambda ws: external_attempts.append({'source': 'browser-websocket'})
                              if urlsplit(ws.url).netloc not in (urlsplit(web_origin).netloc, urlsplit(relay_origin).netloc) else None)
                    await second.goto((await host.pair())['url'])
                    await second.get_by_label('この端末の名前').fill('Acceptance second browser')
                    await second.get_by_role('button', name='このPCに登録する', exact=True).click()
                    await wait_until(lambda: len(host.status()['pending']) == 1)
                    second_device = host.status()['pending'][0]['device_id']
                    assert second_device != device
                    await host.approve(second_device, await second.locator('form [role="status"] strong').inner_text())
                    await expect(second.get_by_role('heading', name='登録できました', exact=True)).to_be_visible()
                    await second.get_by_role('button', name='会話を開く', exact=True).click()
                    await expect(second.get_by_role('heading', name='チャット', exact=True)).to_be_visible(timeout=30000)
                    second_keys = await second.evaluate('''async()=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        return JSON.stringify(await remoteDevices());
                    }''')
                    second_records = json.loads(second_keys)
                    first_records = await page.evaluate('''async()=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        return await remoteDevices();
                    }''')
                    assert len(second_records) == len(first_records) == 1
                    assert first_records[0]['deviceId'] == device and second_records[0]['deviceId'] == second_device
                    assert all(first_records[0][key] != second_records[0][key] for key in ('privateKey', 'token'))
                    assert all(first_records[0][key] == second_records[0][key] for key in ('ownerId', 'hostId', 'hostKey'))
                    assert (await api('/api/chat/sessions', target=second))['status'] == 200
                    simultaneous = dict(host.connections)
                    assert {c.device_id for c in simultaneous.values()} == {device, second_device}
                    expected_config = copy.deepcopy(host.config)
                    permission_matrix = []
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                                 base_url='http://127.0.0.1:5174',
                                                 headers={'Origin': 'http://127.0.0.1:5174'}) as local:
                        for enabled in ((), (0,), (0, 1), (1,), ()):
                            for i, principal in enumerate((device, second_device)):
                                changed = await local.put('/api/remote/devices/' + principal + '/management',
                                                          json={'enabled': i in enabled})
                                assert changed.status_code == 200 and changed.json() == {'management': i in enabled}
                                expected_config['devices'][principal]['management'] = i in enabled
                                assert host.config == vault.read() == expected_config
                            responses = await asyncio.gather(*(
                                api('/api/diagnostics', target=client) for client in (page, second)))
                            statuses = [r['status'] for r in responses]
                            assert statuses == [200 if i in enabled else 403 for i in range(2)]
                            permission_matrix.append({'enabled': list(enabled), 'diagnostics': statuses})
                            for i, (client, principal) in enumerate(zip((page, second), (device, second_device))):
                                status = json.loads((await api('/api/mobile/status', target=client))['body'])
                                assert status['administrative'] is (i in enabled)
                                assert (await api('/api/remote/devices/' + principal + '/management', 'PUT',
                                                  {'enabled': i not in enabled}, target=client))['status'] == 403
                                assert host.config == vault.read() == expected_config
                                assert host.authorized(principal) and host.management(principal) is (i in enabled)
                                assert vault.read()['devices'][principal]['management'] is (i in enabled)
                                shared = json.loads((await api('/api/chat/history?session_id=' + sid, target=client))['body'])
                                assert shared['history'] == history
                            assert host.connections.keys() == simultaneous.keys()
                            assert all(host.connections[k] is connection for k, connection in simultaneous.items())
                    assert await second.evaluate('''async()=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        return JSON.stringify(await remoteDevices());
                    }''') == second_keys
                    assert await page.evaluate('''async expected=>{
                        const {remoteDevices}=await import('/src/lib/remoteStore.ts');
                        const bytes=new TextEncoder().encode(JSON.stringify(await remoteDevices()));
                        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')===expected;
                    }''', keys_before)
                    report['two_browser_permissions'] = {'matrix': permission_matrix,
                        'independent_registered_keys': True, 'same_live_connections': True,
                        'history_preserved': True, 'remote_permission_edits_denied': True}
                    report['checks'].append('two isolated live browser principals independently grant/revoke management without reconnect, key changes or conversation loss')
                    await second_context.close()
                    from python.api import chat
                    from python.providers.mock import MockProvider

                    original_stream = MockProvider.stream_events

                    async def delayed_stream(self, *args, **kwargs):
                        async for event in original_stream(self, *args, **kwargs):
                            await asyncio.sleep(0.04)
                            yield event

                    MockProvider.stream_events = delayed_stream
                    try:
                        await composer.fill("REMOTE_DISCONNECT_覚えていて")
                        await page.get_by_role(
                            "button", name="送信", exact=True
                        ).click()
                        await wait_until(lambda: bool(chat._running))
                        assert await page.evaluate('''async()=>{
                            const {generationBusy}=await import('/src/lib/appContext.ts');
                            const {activeRemote,deleteRemote,remoteDevices}=await import('/src/lib/remoteStore.ts');
                            if(!generationBusy())throw Error('Expected active generation');
                            const before=JSON.stringify(await remoteDevices()),selected=activeRemote().id;
                            try {await deleteRemote(selected);return false;}
                            catch(error){if(!String(error).includes('Stop generation and confirm its saved result'))throw error;}
                            return JSON.stringify(await remoteDevices())===before&&activeRemote().id===selected
                                &&localStorage.getItem('kyalulu-active-remote')===selected;
                        }''')
                        report['checks'].append('active generation blocks key erasure before IndexedDB or selected destination changes')
                        await host.socket.close()
                        await asyncio.sleep(2)
                        await wait_until(lambda: host.connected)
                        await page.reload()
                        await expect(page.locator(".k-composer__input")).to_be_visible(
                            timeout=30000
                        )
                        for _ in range(100):
                            restored = json.loads(
                                (await api("/api/chat/history?session_id=" + sid))[
                                    "body"
                                ]
                            )["history"]
                            if len(restored) == 4:
                                break
                            await asyncio.sleep(0.1)
                        assert len(restored) == 4
                        assert (
                            sum(
                                m["role"] == "user"
                                and m["content"] == "REMOTE_DISCONNECT_覚えていて"
                                for m in restored
                            )
                            == 1
                        )
                        report["checks"].append(
                            "disconnect DURING generation then reload: one durable completion, no resubmission"
                        )
                    finally:
                        MockProvider.stream_events = original_stream

                    # Hold a separate generation until explicit cancellation; never race a short Mock reply.
                    cancel_sid = 'remote-stop-' + uuid.uuid4().hex
                    entered, checking_saved, release_saved = asyncio.Event(), asyncio.Event(), asyncio.Event()
                    from python.storage import generations
                    original_status = generations.status
                    original_invoke = host.bridge.adapter.invoke
                    fail_access_read = False
                    recovery_trace = []
                    recovery_phase = 'generation'
                    recovery_started = asyncio.get_running_loop().time()
                    held_reads = 0

                    async def observe_recovery(scope, body, send):
                        access_read = scope['method'] == 'GET' and scope['path'] == '/api/mobile/status'
                        entry = {'phase': recovery_phase, 'elapsed_ms': round((asyncio.get_running_loop().time() - recovery_started) * 1000),
                                 'method': scope['method'], 'route': 'access' if access_read else 'other'}
                        recovery_trace.append(entry)
                        if access_read and fail_access_read:
                            entry['injected_failure'] = True
                            raise ConnectionError('controlled metadata read failure')

                        async def observed_send(message):
                            if message['type'] == 'http.response.start':
                                entry['status'] = message['status']
                            await send(message)

                        try:
                            await original_invoke(scope, body, observed_send)
                        except Exception as error:
                            entry['exception_type'] = type(error).__name__
                            raise

                    host.bridge.adapter.invoke = observe_recovery

                    async def held_status(generation_id, session_id):
                        nonlocal held_reads
                        result = await original_status(generation_id, session_id)
                        if session_id == cancel_sid and result['status'] == 'cancelled':
                            held_reads += 1
                            checking_saved.set()
                            await release_saved.wait()
                        return result

                    async def held_stream(self, *args, **kwargs):
                        entered.set()
                        await asyncio.Event().wait()
                        async for event in original_stream(self, *args, **kwargs):
                            yield event

                    MockProvider.stream_events = held_stream
                    generations.status = held_status
                    try:
                        await page.goto(web_origin + '/#/chats/' + cancel_sid)
                        composer = page.locator('.k-composer__input')
                        await expect(composer).to_be_enabled()
                        await composer.fill('REMOTE_STOP_keep_input')
                        await page.get_by_role('button', name='送信', exact=True).click()
                        await asyncio.wait_for(entered.wait(), 15)
                        picker = page.get_by_role('combobox', name='実行先', exact=True)
                        await expect(picker).to_be_disabled()
                        assert await page.evaluate('''async()=>{
                            const {switchTarget,generationBusy}=await import('/src/lib/appContext.ts');
                            const before=JSON.stringify({...localStorage}),url=location.href;
                            if(!generationBusy())throw Error('Generation must still be pending');
                            for(const target of ['cloud','device','pc']){
                                try{switchTarget(target);return false;}
                                catch(error){if(!String(error).includes('Stop generation and confirm its saved result'))throw error;}
                            }
                            return location.href===url&&JSON.stringify({...localStorage})===before;
                        }''')
                        generation_id = await page.evaluate('''sid=>{
                            const key=Object.keys(localStorage).find(key=>key.startsWith('kyalulu:chat-recovery:v1:')&&key.endsWith(':'+sid));
                            return JSON.parse(localStorage.getItem(key)).pending.id;
                        }''', cancel_sid)
                        await page.get_by_role('button', name='停止', exact=True).click()
                        await asyncio.wait_for(checking_saved.wait(), 15)
                        await expect(picker).to_be_disabled()
                        await expect(page.get_by_role('button', name='停止して確認', exact=True)).to_be_visible()
                        assert await page.evaluate('''async()=>{
                            const {switchTarget}=await import('/src/lib/appContext.ts');
                            try{switchTarget('device');return false;}
                            catch(error){return String(error).includes('Stop generation and confirm its saved result');}
                        }''')
                        for controlled_failure in (False, True):
                            await page.evaluate('location.hash="/profile"')
                            await expect(composer).to_have_count(0)
                            await expect(picker).to_be_disabled()
                            recovery_phase = 'controlled_reload' if controlled_failure else 'normal_reload'
                            # Bootstrap can issue overlapping checks; hold the fault until the explicit retry.
                            fail_access_read = controlled_failure
                            start = len(recovery_trace)
                            await page.reload()
                            profile = page.get_by_role('textbox', name='表示名', exact=True)
                            reconnect = page.get_by_role('button', name='もう一度接続する', exact=True)
                            # RuntimeGate also renders RemoteConnections; only an authenticated Profile proves readiness.
                            await expect(profile.or_(reconnect)).to_be_enabled(timeout=30000)
                            await expect(picker).to_be_disabled()
                            assert not release_saved.is_set()
                            if controlled_failure:
                                await expect(reconnect).to_be_visible()
                                await expect(page.get_by_role('region', name='Remoteの接続先', exact=True)).to_be_visible()
                                await expect(page.get_by_role('link', name='送信結果を確認', exact=True)).to_be_visible()
                                await expect(composer).to_have_count(0)
                                assert any(e.get('injected_failure') for e in recovery_trace[start:])
                            fail_access_read = False
                            retries = await runtime_ready(page, profile)
                            report['runtime_recoveries'].append({'phase': recovery_phase, 'ui_retries': retries})
                            if controlled_failure:
                                assert retries == 1
                            assert all(e['method'] == 'GET' for e in recovery_trace[start:]), recovery_trace[start:]
                            assert any(e['route'] == 'access' and e.get('status') == 200 for e in recovery_trace[start:])
                            await expect(page.locator('.k-remote-banner')).to_contain_text('暗号化接続中')
                            await expect(picker).to_be_disabled()
                            before_reads = held_reads
                            await page.get_by_role('link', name='送信結果を確認', exact=True).click()
                            await expect(composer).to_be_visible()
                            await wait_until(lambda: held_reads > before_reads)
                            await expect(picker).to_be_disabled()
                            assert not release_saved.is_set()
                        recovery_phase = 'saved_result_release'
                        release_saved.set()
                        await expect(picker).to_be_enabled(timeout=30000)
                        await expect(composer).to_have_value('REMOTE_STOP_keep_input')
                        stopped_history = json.loads((await api('/api/chat/history?session_id=' + cancel_sid))['body'])['history']
                        assert stopped_history == [], 'Cancelled uncommitted turn must not appear as a saved reply'
                        terminal = json.loads((await api('/api/chat/generations/' + generation_id + '?session_id=' + cancel_sid))['body'])
                        assert terminal == {'generation_id': generation_id, 'session_id': cancel_sid, 'status': 'cancelled', 'user_id': None, 'assistant_id': None}
                    finally:
                        release_saved.set()
                        host.bridge.adapter.invoke = original_invoke
                        generations.status = original_status
                        MockProvider.stream_events = original_stream
                        (output / 'recovery-metadata.json').write_text(json.dumps(recovery_trace, indent=2), encoding='utf-8')
                        if sys.exc_info()[0] is not None:
                            print(json.dumps({'remote_recovery_metadata': recovery_trace, 'host_connected': host.connected,
                                              'host_connections': len(host.connections), 'held_reads': held_reads}), flush=True)
                    report['checks'].append('pending generation and delayed saved-result check reject target switching; verified cancellation restores input before unlocking')
                    report['checks'].append('normal and failed access-read reloads reach authenticated Profile; one GET-only reconnect preserves held saved-result barrier')

                    # Canceling the destination review cannot mutate the current route or draft.
                    await composer.fill('REMOTE_UNSENT_after_stop')
                    await picker.select_option('device')
                    review = page.get_by_role('dialog')
                    await review.get_by_role('button', name='キャンセル', exact=True).click()
                    await expect(picker).to_have_value('pc')
                    await expect(composer).to_have_value('REMOTE_UNSENT_after_stop')
                    await picker.select_option('device')
                    await review.get_by_role('button', name='次へ', exact=True).click()
                    await page.wait_for_url(web_origin + '/device/#/')
                    await expect(page.get_by_role('combobox', name='実行先', exact=True)).to_have_value('device')
                    assert await page.evaluate('''async sid=>{
                        const {entity}=await import('/src/lib/appStore.ts');
                        return !await entity(sid);
                    }''', cancel_sid), 'Switching must not copy the PC conversation to Device'
                    await page.get_by_role('combobox', name='実行先', exact=True).select_option('pc')
                    await page.get_by_role('dialog').get_by_role('button', name='次へ', exact=True).click()
                    await page.wait_for_url(web_origin + '/#/')
                    await page.goto(web_origin + '/#/chats/' + cancel_sid)
                    retries = await runtime_ready(page, page.locator('.k-composer__input'))
                    report['runtime_recoveries'].append({'phase': 'pc_device_pc_reload', 'ui_retries': retries})
                    await expect(page.locator('.k-composer__input')).to_have_value('REMOTE_UNSENT_after_stop', timeout=30000)
                    assert json.loads((await api('/api/chat/history?session_id=' + cancel_sid))['body'])['history'] == stopped_history
                    report['checks'].append('review cancellation and PC/Device roundtrip preserve scoped draft, keys and authoritative history without copying or resending')
                    await page.goto(web_origin + '/#/chats/' + sid)
                    await expect(page.locator('.k-composer__input')).to_be_enabled()
                    from PIL import Image

                    png = io.BytesIO()
                    Image.frombytes(
                        "RGB", (1024, 1024), os.urandom(1024 * 1024 * 3)
                    ).save(png, format="PNG")
                    image_bytes = png.getvalue()
                    binary = await page.evaluate(
                        """async raw => {
                      const {apiFetch} = await import('/src/lib/transport.ts');
                      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
                      const form = new FormData(); form.set('file', new Blob([bytes], {type:'image/png'}), 'private.png');
                      const uploaded = await apiFetch('/api/library/assets', {method:'POST',body:form});
                      if(!uploaded.ok) throw new Error('upload_failed_'+uploaded.status);
                      const asset = await uploaded.json();
                      const response = await apiFetch('/api/library/assets/'+asset.asset_id);
                      if(!response.ok) throw new Error('download_failed');
                      const body = await response.arrayBuffer();
                      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',body))].map(b=>b.toString(16).padStart(2,'0')).join('');
                      const {default:React} = await import('/node_modules/.vite/deps/react.js');
                      const {default:ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
                      const {RuntimeImage} = await import('/src/components/RuntimeMedia.tsx');
                      const container = document.createElement('div');container.id='acceptance-image';document.body.appendChild(container);
                      window.acceptanceImageRoot = ReactDOM.createRoot(container);
                      window.acceptanceImageRoot.render(React.createElement(RuntimeImage, {src:'/api/library/assets/'+asset.asset_id,alt:'private fixture'}));
                      return {hash, bytes:body.byteLength};
                    }""",
                        base64.b64encode(image_bytes).decode(),
                    )
                    assert binary == {
                        "hash": hashlib.sha256(image_bytes).hexdigest(),
                        "bytes": len(image_bytes),
                    }
                    await expect(
                        page.locator("#acceptance-image img")
                    ).to_have_attribute(
                        "src", __import__("re").compile("^blob:"), timeout=30000
                    )
                    await page.evaluate(
                        "window.acceptanceImageRoot.unmount(); document.getElementById('acceptance-image').remove()"
                    )
                    report["checks"].append(
                        "3MiB multipart image upload, hash-identical encrypted download, Blob image rendering"
                    )
                    assert not any("/api/" in url for url in requests), requests
                    assert not any("REMOTE_PRIVATE_CANARY" in url for url in requests)
                    assert not external_attempts, external_attempts
                    report["checks"].append(
                        "Runtime requests never use plaintext browser HTTP URLs"
                    )
                    await page.screenshot(
                        path=str(output / "conversation.png"), full_page=True
                    )
                    for width in (320, 360, 393, 1280):
                        await page.set_viewport_size({"width": width, "height": 851})
                        assert not await page.evaluate(
                            "document.documentElement.scrollWidth > innerWidth"
                        )
                    report["checks"].append(
                        "320/360/393/1280 viewport: no horizontal overflow"
                    )
                    # Closing the Host transport preserves its Runtime and database.
                    await host.socket.close()
                    await asyncio.sleep(2)
                    await wait_until(lambda: host.connected)
                    for _ in range(30):
                        try:
                            if (await api("/api/health"))["status"] == 200:
                                break
                        except PlaywrightError:
                            await asyncio.sleep(0.5)
                    else:
                        raise AssertionError("reconnect failed")
                    assert (
                        len(
                            json.loads(
                                (await api("/api/chat/history?session_id=" + sid))[
                                    "body"
                                ]
                            )["history"]
                        )
                        == 4
                    )
                    report["checks"].append(
                        "Host WSS reconnect retains authoritative history"
                    )
                    await host.revoke(device)
                    try:
                        await asyncio.wait_for(api("/api/chat/sessions"), timeout=20)
                    except (PlaywrightError, TimeoutError):
                        report["checks"].append(
                            "revoked device cannot fetch Runtime data"
                        )
                    else:
                        raise AssertionError("revoked client accepted")
                    assert not errors, errors
                    await context.close()
                except Exception:
                    (output / 'partial-acceptance.json').write_text(
                        json.dumps({**report, 'completed': False}, ensure_ascii=False, indent=2), encoding='utf-8')
                    print(json.dumps({'remote_relay_metadata': relay_trace, 'host_connected': host.connected,
                                      'host_connections': len(host.connections)}), flush=True)
                    if "page" in locals():
                        await page.screenshot(
                            path=str(output / "failure.png"), full_page=True
                        )
                        (output / "failure.txt").write_text(
                            await page.locator("body").inner_text(), encoding="utf-8"
                        )
                        (output / "errors.json").write_text(
                            json.dumps(errors), encoding="utf-8"
                        )
                    raise
                finally:
                    await asyncio.wait_for(browser.close(), timeout=10)
                    report['browser_closed'] = True
            await asyncio.wait_for(host.stop(), timeout=15)
    finally:
        try:
            await asyncio.wait_for(host.stop(), timeout=15)
        finally:
            try:
                server.should_exit = True
                await asyncio.to_thread(server_thread.join, 15)
                assert not server_thread.is_alive(), "Relay fixture did not stop"
                if server_errors:
                    raise server_errors[0]
                report["relay_shutdown_complete"] = True
            finally:
                try:
                    if vite:
                        if vite.poll() is None:
                            vite.terminate()
                        try:
                            await asyncio.to_thread(vite.wait, 10)
                        except subprocess.TimeoutExpired:
                            vite.kill()
                            await asyncio.to_thread(vite.wait, 5)
                            raise
                        report['vite_exit_code'] = vite.returncode
                finally:
                    if log:
                        log.close()
                    fixture.close()
                    if sys.exc_info()[0] is not None:
                        (output / 'partial-acceptance.json').write_text(json.dumps(
                            {**report, 'completed': False, 'relay_bootstrap': relay_trace},
                            ensure_ascii=False, indent=2), encoding='utf-8')
    assert not external_attempts, external_attempts
    relay_files = list(output.glob('relay.sqlite3*'))
    assert relay_files and all(b'REMOTE_MANAGEMENT_FICTIONAL_ONLY' not in p.read_bytes() for p in relay_files)
    report['relay_bootstrap'] = relay_trace
    (output / "acceptance.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "passed": len(report["checks"]),
                "report": str(output / "acceptance.json"),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    asyncio.run(run())
