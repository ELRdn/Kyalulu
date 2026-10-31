"""Loopback HTTPS/Caddy + disposable Cloud state; no deployment or real providers."""
import argparse
import asyncio
import base64
import hashlib
import json
import os
from pathlib import Path
import socket
import sqlite3
import ssl
import subprocess
import sys
from contextlib import closing

import httpx
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


async def ready(url, process, *, verify=True):
    async with httpx.AsyncClient(verify=verify, trust_env=False) as client:
        for _ in range(100):
            if process.poll() is not None:
                raise AssertionError(f'Fixture process exited: {process.returncode}')
            try:
                response = await client.get(url, timeout=1)
                if response.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            await asyncio.sleep(.1)
    raise AssertionError('Fixture readiness timed out')


async def check(args):
    args.output.mkdir(parents=True, exist_ok=False)
    assert args.caddy.is_file() and (args.dist / 'device/index.html').is_file()
    inference_file = next((args.dist / 'assets').glob('runtime.worker-*.js'))
    upstream_port, proxy_port, legacy_port = free_port(), free_port(), free_port()
    assert len({upstream_port, proxy_port, legacy_port}) == 3
    origin = f'https://localhost:{proxy_port}'
    legacy_origin = f'https://127.0.0.1:{legacy_port}'
    policy = (ROOT / 'deploy/cloud/Caddyfile.unified.example').read_text(encoding='utf-8')
    config = '{\n admin off\n auto_https disable_redirects\n skip_install_trust\n log default {\n output discard\n }\n}\n'
    config += policy.replace('{$APP_DOMAIN} {', f'localhost:{proxy_port} {{\n bind 127.0.0.1\n tls internal')
    config = config.replace('{$RELAY_DOMAIN}', 'relay.kyalulu.com').replace('{$CLOUD_UPSTREAM:kyalulu-cloud-runtime:8000}', f'127.0.0.1:{upstream_port}')
    legacy_policy = (ROOT / 'deploy/cloud/Caddyfile.cloud-migration.example').read_text(encoding='utf-8')
    # A fictional cache-first predecessor reproduces the stale-shell upgrade boundary.
    old_worker = 'self.addEventListener("install",e=>e.waitUntil(caches.open("legacy-fiction").then(c=>c.put("/",new Response("<!doctype html><title>Legacy fixture</title><main id=legacy-shell>Fictional old Cloud</main>",{headers:{"Content-Type":"text/html"}})))));self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("fetch",e=>{if(e.request.mode==="navigate")e.respondWith(caches.match("/"));});'
    legacy_policy = legacy_policy.replace('cloud.kyalulu.com {', f'127.0.0.1:{legacy_port} {{\n bind 127.0.0.1\n tls internal\n handle /legacy-fixture-sw.js {{\n header Content-Type "text/javascript"\n respond `'+old_worker+'` 200\n }')
    config += '\n' + legacy_policy.replace('{$APP_DOMAIN}', f'localhost:{proxy_port}')
    caddyfile = args.output / 'Caddyfile'
    caddyfile.write_text(config, encoding='utf-8')
    env = {**os.environ, 'XDG_DATA_HOME': str(args.output / 'caddy-data'), 'XDG_CONFIG_HOME': str(args.output / 'caddy-config')}
    flags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    version = subprocess.check_output([str(args.caddy), 'version'], text=True, creationflags=flags).strip()
    assert version.startswith('v2.10.2 '), 'Use the production Caddy version'
    processes = []
    try:
        with (args.output / 'process.log').open('wb') as log:
            # No OS trust installation, admin endpoint, access log or production origin.
            subprocess.run([str(args.caddy), 'validate', '--config', str(caddyfile), '--adapter', 'caddyfile'],
                           env=env, stdout=log, stderr=log, check=True, creationflags=flags)
            cloud = subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--serve',
                '--dist', str(args.dist), '--output', str(args.output), '--origin', origin, '--port', str(upstream_port)],
                stdout=log, stderr=log, creationflags=flags)
            processes.append(cloud)
            proxy = subprocess.Popen([str(args.caddy), 'run', '--config', str(caddyfile), '--adapter', 'caddyfile'],
                                     env=env, stdout=log, stderr=log, creationflags=flags)
            processes.append(proxy)
            await ready(origin + '/api/health', proxy, verify=False)
            roots = list((args.output / 'caddy-data').rglob('root.crt'))
            assert len(roots) == 1, 'Fixture CA must remain inside its output directory'
            # Readiness alone skips trust; all assertions verify the private fixture CA and hostname.
            async with httpx.AsyncClient(base_url=origin, verify=str(roots[0]), trust_env=False) as client:
                for name in ('', 'index.html', 'device', 'device/', 'device/index.html', 'migration', 'migration/', 'migration/index.html'):
                    response = await client.get('/' + name)
                    relative = ('device/index.html' if name.startswith('device') else 'migration/index.html' if name.startswith('migration') else 'index.html')
                    assert response.status_code == 200 and response.content == (args.dist / relative).read_bytes(), name
                    assert 'no-transform' in response.headers['cache-control'], name
                    assert len(response.headers.get_list('content-security-policy')) == 1, name
                    if name.startswith('device'):
                        assert response.headers['cross-origin-opener-policy'] == 'same-origin'
                        assert response.headers['cross-origin-embedder-policy'] == 'require-corp'
                        assert "worker-src 'self' blob:" in response.headers['content-security-policy']
                        assert "frame-src 'none'" in response.headers['content-security-policy']
                    elif name.startswith('migration'):
                        assert response.headers['cross-origin-opener-policy'] == 'unsafe-none'
                        assert response.headers['cross-origin-embedder-policy'] == 'unsafe-none'
                        assert "connect-src 'none'" in response.headers['content-security-policy']
                    else:
                        assert 'cross-origin-embedder-policy' not in response.headers
                        assert 'wss://relay.kyalulu.com' in response.headers['content-security-policy']
                worker = await client.get('/sw.js')
                assert worker.content == (args.dist / 'sw.js').read_bytes()
                assert worker.headers['service-worker-allowed'] == '/' and 'no-transform' in worker.headers['cache-control']
                inference_response = await client.get('/assets/' + inference_file.name)
                assert inference_response.content == inference_file.read_bytes()
                assert inference_response.headers['cross-origin-embedder-policy'] == 'require-corp'
                assert len(inference_response.headers.get_list('content-security-policy')) == 1
                assert 'huggingface.co' in inference_response.headers['content-security-policy']
                for path in ('/missing.js', '/assets/missing.png', '/device/missing', '/migration/missing', '/.env', '/.git/config'):
                    response = await client.get(path, headers={'Accept': 'text/html'})
                    assert response.status_code == 404 and response.content != (args.dist / 'index.html').read_bytes(), (path, response.status_code)
                status = (await client.get('/api/cloud/status')).json()
                assert status['billing_available'] is False and status['ads_available'] is False and status['inference_available'] is False
                assert (await client.get('/api/cloud/account')).status_code == 401
                assert (await client.post('/api/cloud/auth/logout', headers={'Origin': 'https://cloud.invalid'})).status_code == 403
                assert (await client.post('/api/cloud/app/eligibility', headers={'Origin': origin}, json={})).status_code == 503
            async with httpx.AsyncClient(base_url=legacy_origin, verify=str(roots[0]), trust_env=False) as client:
                for path in ('/', '/index.html', '/migration/', '/?code=FICTIONAL-OLD-CODE&token=FICTIONAL-TOKEN'):
                    response = await client.get(path, headers={'Cookie':'old=FICTIONAL-COOKIE','Authorization':'Bearer FICTIONAL-BEARER'})
                    assert response.status_code == 200 and 'Cloud has moved' in response.text
                    assert 'location' not in response.headers and 'clear-site-data' not in response.headers and 'set-cookie' not in response.headers
                    assert response.headers['cache-control']=='no-store'
                    assert len(response.headers.get_list('content-security-policy'))==1
                    assert all(marker not in response.text for marker in ('FICTIONAL-OLD-CODE','FICTIONAL-TOKEN','FICTIONAL-COOKIE','FICTIONAL-BEARER'))
                    assert f'href="{origin}/"' in response.text
                for method in ('GET','POST','PUT','DELETE'):
                    for path in ('/api/health','/api/cloud/auth/login','/api/cloud/app/sync','/auth/callback?code=FICTIONAL-OLD-CODE'):
                        response = await client.request(method,path,content=b'FICTIONAL-PRIVATE-BODY')
                        assert response.status_code==410 and response.json()=={'error':'cloud_origin_retired','app':origin+'/'}
                        assert 'location' not in response.headers and 'FICTIONAL-OLD-CODE' not in response.text
                response = await client.get('/sw.js')
                assert response.status_code==200 and response.headers['service-worker-allowed']=='/'
                assert response.headers['content-type'].startswith('text/javascript')
                assert len(response.headers.get_list('content-security-policy'))==1
                assert "connect-src 'self'" in response.headers['content-security-policy']
            async with async_playwright() as playwright:
                # Context-level ignore_https_errors does not cover worker certificate checks.
                trust = ssl.create_default_context(cafile=str(roots[0]))
                pins=[]
                for hostname,port in (('localhost',proxy_port),('127.0.0.1',legacy_port)):
                    with socket.create_connection(('127.0.0.1', port)) as tcp, trust.wrap_socket(tcp, server_hostname=hostname) as tls:
                        certificate = x509.load_der_x509_certificate(tls.getpeercert(binary_form=True))
                    spki = certificate.public_key().public_bytes(Encoding.DER, PublicFormat.SubjectPublicKeyInfo)
                    pins.append(base64.b64encode(hashlib.sha256(spki).digest()).decode('ascii'))
                pin=','.join(pins)
                browser = await playwright.chromium.launch(headless=True, args=['--ignore-certificate-errors-spki-list=' + pin])
                context = await browser.new_context(viewport={'width': 393, 'height': 852})
                errors, violations, external = [], [], []
                try:
                    async def guard(route):
                        parsed = httpx.URL(route.request.url)
                        if (parsed.host,parsed.port) not in {('localhost',proxy_port),('127.0.0.1',legacy_port)}:
                            external.append(route.request.url)
                            await route.abort()
                        else:
                            await route.continue_()
                    await context.route('**/*', guard)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    await page.add_init_script("window.__fixtureCsp=[];document.addEventListener('securitypolicyviolation',e=>window.__fixtureCsp.push(e.violatedDirective));")
                    await page.goto(origin)
                    await page.locator('.k-unified-entry').wait_for()
                    assert not await page.evaluate('crossOriginIsolated')
                    for _ in range(200):
                        if await page.evaluate('navigator.serviceWorker.controller !== null'):
                            break
                        await asyncio.sleep(.2)
                    assert await page.evaluate('navigator.serviceWorker.controller !== null'), 'Worker did not take control'
                    violations.extend(await page.evaluate('window.__fixtureCsp'))
                    await page.evaluate('''() => {
                        localStorage.setItem('kyalulu-app-preferences-v1',JSON.stringify({version:1,language:'en',country:'JP',age:25,accepted:true,genres:[],moods:[],activities:[],favorites:[],dismissed:[]}));
                        localStorage.setItem('kyalulu-app-owner','proxy-fixture');
                        localStorage.setItem('kyalulu-execution-target','device');
                    }''')
                    await page.goto(origin + '/device/#/')
                    await page.locator('.k-char-card').first.wait_for()
                    assert await page.evaluate('crossOriginIsolated && navigator.serviceWorker.controller !== null')
                    async with page.expect_worker() as started:
                        await page.evaluate('path => { window.__fixtureInferenceWorker = new Worker(path, {type:"module"}); }', '/assets/' + inference_file.name)
                    inference = await started.value
                    worker_state = await asyncio.wait_for(inference.evaluate('({isolated:crossOriginIsolated,shared:typeof SharedArrayBuffer === "function"})'), 10)
                    await page.evaluate('window.__fixtureInferenceWorker.terminate()')
                    assert worker_state == {'isolated': True, 'shared': True}, worker_state
                    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                    await page.screenshot(path=str(args.output / 'device.png'), animations='disabled')
                    violations.extend(await page.evaluate('window.__fixtureCsp'))
                    await page.goto(origin + '/migration/')
                    await page.locator('.k-migration').wait_for()
                    assert not await page.evaluate('crossOriginIsolated')
                    violations.extend(await page.evaluate('window.__fixtureCsp'))
                    legacy = await context.new_page()
                    legacy.on('pageerror',lambda error:errors.append(str(error)))
                    await legacy.add_init_script("window.__fixtureCsp=[];document.addEventListener('securitypolicyviolation',e=>window.__fixtureCsp.push(e.violatedDirective));")
                    await context.add_cookies([{'name':'legacy-private','value':'FICTIONAL-OLD-COOKIE','url':legacy_origin,'httpOnly':True,'secure':True,'sameSite':'Lax'}])
                    async def predecessor(route):
                        await route.fulfill(status=200,content_type='text/html',body='<title>Fictional predecessor</title>',
                            headers={'Content-Security-Policy':"default-src 'none'; worker-src 'self'"})
                    await legacy.route(legacy_origin+'/',predecessor)
                    await legacy.goto(legacy_origin)
                    await legacy.evaluate("async()=>{await navigator.serviceWorker.register('/legacy-fixture-sw.js',{scope:'/'});await navigator.serviceWorker.ready;}")
                    await legacy.wait_for_function('navigator.serviceWorker.controller!==null')
                    await legacy.unroute(legacy_origin+'/',predecessor)
                    await legacy.reload()
                    await legacy.locator('#legacy-shell').wait_for()
                    state = """async()=>{
                      const db=await new Promise((ok,bad)=>{const r=indexedDB.open('legacy-private',1);r.onupgradeneeded=()=>r.result.createObjectStore('outbox');r.onsuccess=()=>ok(r.result);r.onerror=bad;});
                      const value=await new Promise((ok,bad)=>{const t=db.transaction('outbox'),r=t.objectStore('outbox').get('draft');r.onsuccess=()=>ok(r.result);r.onerror=bad;});db.close();
                      const dir=await navigator.storage.getDirectory(),file=await(await dir.getFileHandle('original.txt')).getFile();
                      return {value,local:localStorage.getItem('draft'),file:await file.text(),cache:await(await caches.match('/')).text()};
                    }"""
                    await legacy.evaluate("""async()=>{
                      localStorage.setItem('draft','FICTIONAL-DRAFT');
                      const db=await new Promise((ok,bad)=>{const r=indexedDB.open('legacy-private',1);r.onupgradeneeded=()=>r.result.createObjectStore('outbox');r.onsuccess=()=>ok(r.result);r.onerror=bad;});
                      await new Promise((ok,bad)=>{const t=db.transaction('outbox','readwrite');t.objectStore('outbox').put({request:'FICTIONAL-UNSENT',body:'FICTIONAL-BODY'},'draft');t.oncomplete=ok;t.onerror=bad;});db.close();
                      const dir=await navigator.storage.getDirectory(),file=await dir.getFileHandle('original.txt',{create:true}),writer=await file.createWritable();await writer.write('FICTIONAL-ORIGINAL');await writer.close();
                    }""")
                    before=await legacy.evaluate(state)
                    await legacy.evaluate("async()=>{window.__retirement=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});}")
                    await legacy.wait_for_function('window.__retirement.waiting?.state==="installed"')
                    await legacy.evaluate('window.__retirement.waiting.postMessage({type:"UNKNOWN_UPDATE"})')
                    await legacy.wait_for_timeout(100)
                    assert await legacy.evaluate('!!window.__retirement.waiting')
                    other=await context.new_page();await other.goto(legacy_origin)
                    await legacy.evaluate('navigator.serviceWorker.addEventListener("message",e=>{if(e.data?.type==="UPDATE_BLOCKED")window.__blocked=true;});window.__retirement.waiting.postMessage({type:"APPLY_UPDATE"});')
                    await legacy.wait_for_function('window.__blocked===true')
                    assert await legacy.evaluate('!!window.__retirement.waiting')
                    await other.close()
                    await legacy.evaluate('window.__retirement.waiting.postMessage({type:"APPLY_UPDATE"})')
                    await legacy.wait_for_function('navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js")')
                    assert await legacy.evaluate("async()=> (await fetch('/api/cloud/app/sync',{method:'POST',body:'FICTIONAL-UNSENT'})).status")==410
                    await legacy.reload()
                    await legacy.get_by_role('link',name='統合アプリを開く / Open Kyalulu').wait_for()
                    assert await legacy.evaluate(state)==before, 'Retirement changed private stores or shell cache'
                    violations.extend(await legacy.evaluate('window.__fixtureCsp'))
                    await legacy.screenshot(path=str(args.output/'legacy-cloud.png'),animations='disabled')
                    await legacy.get_by_role('link',name='統合アプリを開く / Open Kyalulu').click()
                    await legacy.wait_for_url(origin+'/')
                    assert 'FICTIONAL-OLD-COOKIE' not in await legacy.evaluate('document.cookie')
                    assert not any(c['name']=='legacy-private' for c in await context.cookies(origin)), 'Legacy cookie crossed hostnames'
                    await legacy.close()
                    await page.goto(origin)
                    await page.evaluate("localStorage.setItem('kyalulu-execution-target','pc')")
                    await page.reload()
                    await page.get_by_role('heading',name='Connect to your PC.',exact=True).wait_for()
                    await page.get_by_role('region',name='Remote destinations',exact=True).wait_for()
                    assert not errors and not violations and not external, (errors, violations, external)
                finally:
                    await context.close()
                    await browser.close()
            control = args.output / 'cloud/control.db'
            assert control.is_file()
            with closing(sqlite3.connect(f'file:{control.as_posix()}?mode=ro', uri=True)) as db:
                for table in ('accounts', 'credit_lots', 'funds', 'operations', 'secrets'):
                    assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0, table
            result = {'https_fixture_ca_verified': True, 'canonical_host_and_same_origin_enforced': True,
                'exact_html_and_worker_bytes': True, 'one_csp_per_document': True, 'device_isolated': True,
                'migration_neutral': True, 'explicit_worker_scope_and_no_transform': True,
                'missing_asset_private_path_and_nested_document_denials': True, 'commercial_and_unaccepted_regions_closed': True,
                'browser_shell_device_and_migration': True, 'inference_worker_isolated_with_shared_memory': True,
                'no_accounts_or_funding_created': True,
                'legacy_cloud_410_without_forwarding_or_redirects': True,
                'legacy_cloud_explicit_one_tab_worker_retirement': True,
                'legacy_cloud_cache_outbox_opfs_and_draft_preserved': True,
                'legacy_cloud_relogin_link_without_code_or_cookie_transfer': True,
                'managed_relay_pc_registration_entry_present': True,
                'page_errors': len(errors), 'csp_violations': len(violations),
                'external_requests': len(external), 'caddy_version': version,
                'caddy_sha256': hashlib.sha256(args.caddy.read_bytes()).hexdigest()}
            (args.output / 'results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
            print(json.dumps(result, indent=2))
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                process.terminate()
                try:
                    await asyncio.to_thread(process.wait, 10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    await asyncio.to_thread(process.wait)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dist', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--caddy', type=Path)
    parser.add_argument('--serve', action='store_true')
    parser.add_argument('--origin')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    if args.serve:
        import uvicorn
        from python.cloud.app import create_app
        from python.cloud.config import CloudConfig
        def reject_provider(_):
            raise AssertionError('No providers')
        app = create_app(CloudConfig(root=args.output / 'cloud', origin=args.origin, secret='fixture-secret-' * 3,
                                    web_dist=args.dist), transport=httpx.MockTransport(reject_provider))
        uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False, log_level='warning')
    else:
        assert args.caddy, '--caddy must name a separately verified Caddy 2.10.2 binary'
        args.caddy, args.dist, args.output = args.caddy.resolve(), args.dist.resolve(), args.output.resolve()
        asyncio.run(check(args))
