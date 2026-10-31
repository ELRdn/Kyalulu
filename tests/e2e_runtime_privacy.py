"""Browser privacy canaries through real loopback Noise/Relay and device storage."""
import asyncio
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import threading
from unittest.mock import patch
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
import uvicorn

from browser_fixture_server import local_vite
from e2e_remote import MemoryVault, port

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
API = 'window.__RUNTIME_PRIVACY__'
SECRETS = ['fixture-cloud-bearer-canary', 'fixture-cloud-cookie-canary',
           'fixture-cloud-owner-canary', 'fixture-cloud-csrf-canary']


async def until(predicate):
    for _ in range(300):
        if predicate():
            return
        await asyncio.sleep(.05)
    raise AssertionError('Loopback fixture timed out')


async def main():
    output = ROOT / '.artifacts'
    output.mkdir(exist_ok=True)
    with TemporaryDirectory(prefix='runtime-privacy-', dir=output) as directory, patch.dict(os.environ, {
        'KYALULU_DATA_DIR': directory, 'KYALULU_EXPERIMENTS_DIR': str(Path(directory) / 'experiments'),
        'KYALULU_REMOTE_MODE': '0', 'KYALULU_WEB_DIST': '', 'VITE_RELAY_ORIGIN': '',
    }):
        from python.api.main import app
        from python.relay.app import create_app
        from python.remote.crypto import generate_keypair
        from python.remote.host import HostService

        async with local_vite(Path(directory)) as origin:
            # Host-only Cloud cookies must use a different hostname, not just another port.
            relay_port = port()
            relay_origin = f'http://localhost:{relay_port}'
            relay = create_app(str(Path(directory) / 'relay.sqlite3'), [origin])
            issued = relay.state.store.redeem_invite(relay.state.store.invite(), 'Fictional privacy PC')
            private, public = generate_keypair()
            host = HostService(app, MemoryVault(dict(version=1, relay=relay_origin, app_origin=origin,
                **issued, private_key=private.hex(), public_key=public.hex(), devices={}, pairings={})), le_probe=lambda: None)
            envelopes, relay_requests, blocked, errors, cloud_calls, sockets = [], [], [], [], [], []
            prepare = host.bridge.adapter.prepare

            def capture(method, path, headers, body, device_id):
                # Capture BEFORE the Host's second header filter can hide a client leak.
                envelopes.append({'method': method, 'path': path, 'headers': dict(headers),
                                  'body': body.decode('utf-8')})
                return prepare(method, path, headers, body, device_id)

            host.bridge.adapter.prepare = capture

            async def relay_capture(scope, receive, send):
                if scope['type'] in ('http', 'websocket'):
                    relay_requests.append({'type': scope['type'], 'path': scope['path'],
                        'headers': {k.decode(): v.decode() for k, v in scope['headers']}})
                await relay(scope, receive, send)

            server = uvicorn.Server(uvicorn.Config(relay_capture, host='127.0.0.1', port=relay_port,
                log_level='error', access_log=False, timeout_graceful_shutdown=5,
                loop='asyncio:SelectorEventLoop' if os.name == 'nt' else 'auto'))
            server_errors = []

            def serve():
                try:
                    server.run()
                except BaseException as error:
                    server_errors.append(str(error))

            thread = threading.Thread(target=serve, daemon=True)
            thread.start()
            try:
                await until(lambda: server.started or server_errors)
                assert not server_errors, server_errors
                async with app.router.lifespan_context(app):
                    try:
                        await host.start()
                        await until(lambda: host.connected)
                        async with async_playwright() as runtime:
                            browser = await runtime.chromium.launch(headless=True)
                            try:
                                context = await browser.new_context(service_workers='block')
                                try:
                                    phase = 'remote'

                                    async def guard(route):
                                        request, url = route.request, urlsplit(route.request.url)
                                        if url.netloc == urlsplit(origin).netloc and url.scheme == 'http':
                                            if not url.path.startswith('/api/'):
                                                await route.continue_(); return
                                            if phase == 'remote' and url.path == '/api/cloud/profile':
                                                headers = await request.all_headers()
                                                assert SECRETS[1] in headers.get('cookie', ''), 'Cookie positive control missing'
                                                assert headers.get('authorization') == 'Bearer ' + SECRETS[0]
                                                assert headers.get('x-kyalulu-owner') == 'runtime-privacy-owner'
                                                cloud_calls.append(url.path)
                                                await route.fulfill(json={'fixture': True}); return
                                        elif phase == 'remote' and url.netloc == urlsplit(relay_origin).netloc:
                                            await route.continue_(); return
                                        blocked.append({'phase': phase, 'path': url.path, 'host': url.hostname})
                                        await route.abort()

                                    async def socket_guard(socket):
                                        url = urlsplit(socket.url)
                                        sockets.append({'phase': phase, 'path': url.path, 'host': url.hostname})
                                        if url.netloc == urlsplit(origin).netloc or (phase == 'remote' and url.netloc == urlsplit(relay_origin).netloc):
                                            socket.connect_to_server()
                                        else:
                                            blocked.append({'phase': phase, 'socket': url.path}); await socket.close()

                                    await context.route('**/*', guard)
                                    await context.route_web_socket('**/*', socket_guard)
                                    await context.add_cookies([{'name': 'fixture-cloud-session', 'value': SECRETS[1],
                                        'url': origin, 'httpOnly': True, 'sameSite': 'Lax'}])
                                    page = await context.new_page()
                                    page.on('pageerror', lambda error: errors.append(str(error)))
                                    fixture = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/runtime-privacy.html').as_posix(), safe='/:')
                                    await page.goto(fixture)
                                    await page.wait_for_function(API + ' !== undefined')
                                    link = await host.pair()
                                    enrollment = asyncio.create_task(page.evaluate('url=>' + API + '.enroll(url)', link['url']))
                                    try:
                                        await until(lambda: bool(host.status()['pending']) or enrollment.done())
                                        if enrollment.done():
                                            await enrollment
                                        await page.wait_for_function('window.__approval !== undefined')
                                        await host.approve(host.status()['pending'][0]['device_id'], await page.evaluate('window.__approval'))
                                        await enrollment
                                    finally:
                                        if not enrollment.done():
                                            enrollment.cancel()
                                        await asyncio.gather(enrollment, return_exceptions=True)
                                    assert await page.evaluate('secret=>' + API + '.cloud(secret)', SECRETS[0]) == {'fixture': True}
                                    assert 'sessions' in await page.evaluate('secrets=>' + API + '.remote(secrets)', SECRETS)
                                    assert await page.evaluate('secret=>' + API + '.cloud(secret)', SECRETS[0]) == {'fixture': True}
                                    assert [e['path'] for e in envelopes] == ['/api/health', '/api/chat/sessions'], envelopes
                                    for envelope in envelopes:
                                        assert envelope['headers'] == {'content-type': 'application/json', 'accept': 'application/json'}, envelope
                                    assert not any(secret in json.dumps([envelopes, relay_requests]) for secret in SECRETS)
                                    before = len(envelopes), len(cloud_calls)
                                    phase = 'device'
                                    await page.evaluate(API + '.device()')
                                    try:
                                        await page.locator('.k-page--home').wait_for(timeout=10000)
                                    except Exception:
                                        print(json.dumps({'page_errors': errors, 'blocked': blocked,
                                                          'body': await page.locator('body').inner_text()}, ensure_ascii=False))
                                        raise
                                    result = await page.evaluate(API + '.runDevice()')
                                    assert result == {'target': 'device', 'selectedRemote': True, 'cloud': False,
                                        'storagePolicy': 'local', 'messages': 2, 'memory': True, 'generation': 'completed', 'externalModelStatus': 409,
                                        'consent': False, 'outbox': False, 'sync': 'off', 'adFrames': 0}, result
                                    # Flush React effects before asserting absence of delayed HTTP/iframe work.
                                    await page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                                    assert len(envelopes) == before[0] and len(cloud_calls) == before[1]
                                    assert not [s for s in sockets if s['phase'] == 'device'], sockets
                                    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
                                    report = {'passed': 1, 'browser': browser.version, 'remote_requests': [e['path'] for e in envelopes],
                                        'cloud_positive_controls': len(cloud_calls), 'cloud_canaries_at_remote': 0,
                                        'device': result, 'blocked_requests': blocked, 'page_errors': errors}
                                finally:
                                    await context.close()
                            finally:
                                await browser.close()
                    finally:
                        await host.stop()
            finally:
                server.should_exit = True
                await asyncio.to_thread(thread.join, 15)
                assert not thread.is_alive() and not server_errors, server_errors
        report['owned_host_relay_vite_stopped'] = True
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), 150))
