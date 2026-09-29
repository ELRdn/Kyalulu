"""Production build + Caddy CSP acceptance of actual remoteClient/RuntimeMedia.

Owns only this script and ignored .artifacts/remote-v1/csp-* output. A synthetic
in-memory Python Noise Host and Playwright-routed Relay replace external services;
no user identities, vault, databases or running services are used. This is an
internal browser/CSP test, not a TLS deployment or external security audit.
Exit 2 means a concrete privacy/CSP acceptance defect remains in current source.
"""
from __future__ import annotations

import base64
import functools
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
import uuid
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.remote.crypto import NoiseSession, generate_keypair
from playwright.sync_api import sync_playwright, expect

RELAY = 'https://relay.csp.test'
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6l9sAAAAASUVORK5CYII=')


def wait(page, predicate, seconds=15):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if predicate():
            return
        page.wait_for_timeout(50)
    raise AssertionError('acceptance condition timed out')


def build(output):
    source = output / 'review-probe.tsx'
    web = (ROOT / 'apps/web').as_posix()
    source.write_text(f'''
import React from 'react';
import {{createRoot}} from 'react-dom/client';
import {{RuntimeImage}} from {json.dumps(web + '/src/components/RuntimeMedia.tsx')};
import {{activeRemote}} from {json.dumps(web + '/src/lib/remoteStore.ts')};
import {{RemoteConnection}} from {json.dumps(web + '/src/lib/remoteClient.ts')};
import {{RemoteRpc}} from {json.dumps(web + '/src/lib/remoteRpc.ts')};
const mount=document.createElement('div'); mount.id='review-image'; document.body.appendChild(mount);
const root=createRoot(mount);
globalThis.remoteReview={{
  active:()=>!!activeRemote(),
  image:props=>root.render(React.createElement(RuntimeImage,props)),
  clear:()=>root.render(null),
  async disposeDuringOpen() {{
    const c=new RemoteConnection(activeRemote());
    const pending=c.connect().catch(()=>undefined);
    c.close();
    await new Promise(r=>setTimeout(r,250));
    const result={{socketCreatedAfterClose:!!c.socket, state:c.socket?.readyState}};
    c.close(); return result;
  }},
  async admissionRead() {{
    const rpc=new RemoteRpc(async frame=>{{
      queueMicrotask(()=>{{
        rpc.receive({{type:'response',id:frame.id,seq:0,status:204,headers:{{}}}});
        rpc.receive({{type:'end',id:frame.id,seq:1}});
      }});
    }});
    for(let i=0;i<12;i++) rpc.pending.set(String(i),{{cleanup(){{}},reject(){{}}}});
    const original=Request.prototype.arrayBuffer;
    const originalGetReader=ReadableStream.prototype.getReader;
    const originalRead=ReadableStreamDefaultReader.prototype.read;
    const bodyDescriptor=Object.getOwnPropertyDescriptor(Request.prototype,'body');
    const bodies=new WeakSet(), readers=new WeakSet();
    let arrayBuffers=0, acquired=0, reads=0;
    Request.prototype.arrayBuffer=function(){{arrayBuffers++;return original.call(this)}};
    Object.defineProperty(Request.prototype,'body',{{...bodyDescriptor,get(){{
      const body=bodyDescriptor.get.call(this); if(body)bodies.add(body); return body;
    }}}});
    ReadableStream.prototype.getReader=function(...args){{
      const reader=originalGetReader.apply(this,args);
      if(bodies.has(this)){{acquired++;readers.add(reader)}} return reader;
    }};
    ReadableStreamDefaultReader.prototype.read=function(...args){{
      if(readers.has(this))reads++;return originalRead.apply(this,args);
    }};
    const abort=new AbortController();
    try {{
      const task=rpc.fetch('/api/library/assets',{{method:'POST',body:new Uint8Array(1024),signal:abort.signal}});
      await new Promise(r=>setTimeout(r,40));
      const full={{arrayBuffers,acquired,reads}};
      rpc.pending.delete('0'); // Positive control: the real reader must run after admission.
      await task;
      return {{whileFull:full,afterAdmission:{{arrayBuffers,acquired,reads}},
        readsWhileFull:full.arrayBuffers+full.acquired+full.reads}};
    }} finally {{
      abort.abort(); Request.prototype.arrayBuffer=original;
      Object.defineProperty(Request.prototype,'body',bodyDescriptor);
      ReadableStream.prototype.getReader=originalGetReader;
      ReadableStreamDefaultReader.prototype.read=originalRead; rpc.close();
    }}
  }},
  async boundedRead() {{
    let chunks=0,cancelled=false,sent=0;
    const body=new ReadableStream({{
      pull(controller){{chunks++;controller.enqueue(new Uint8Array(1024*1024));
        if(chunks===18)controller.close();}},
      cancel(){{cancelled=true}}
    }},{{highWaterMark:0}});
    const rpc=new RemoteRpc(async()=>{{sent++;throw new Error('unexpected send')}});
    let error='';
    try {{await rpc.fetch('/api/library/assets',{{method:'POST',body,duplex:'half'}})}}
    catch(e){{error=String(e)}}
    finally{{rpc.close()}}
    return {{chunks,cancelled,sent,error,reservations:rpc.preparing}};
  }}
}};
''', encoding='utf-8')
    runner = output / 'build.mjs'
    runner.write_text(f'''
import {{build}} from {json.dumps((ROOT / 'apps/web/node_modules/vite/dist/node/index.js').as_uri())};
await build({{
  root:{json.dumps(web)},configFile:{json.dumps(web + '/vite.config.ts')},
  resolve:{{alias:{{react:{json.dumps(web + '/node_modules/react')},'react-dom':{json.dumps(web + '/node_modules/react-dom')}}}}},
  build:{{outDir:{json.dumps((output / 'dist').as_posix())},emptyOutDir:false,
    rollupOptions:{{input:{{app:{json.dumps(web + '/index.html')},'review-probe':{json.dumps(source.as_posix())}}}}}}}
}});
''', encoding='utf-8')
    result = subprocess.run(['node', str(runner)], cwd=ROOT,
        env={**os.environ, 'VITE_RELAY_ORIGIN': RELAY}, capture_output=True, text=True,
        timeout=120, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    (output / 'build.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    if result.returncode:
        raise RuntimeError('isolated production build failed; inspect build.log')


def main():
    output = ROOT / '.artifacts/remote-v1' / ('csp-' + uuid.uuid4().hex[:8])
    output.mkdir(parents=True)
    sources = ['apps/web/src/lib/remoteClient.ts', 'apps/web/src/lib/remoteRpc.ts',
        'apps/web/src/components/RuntimeMedia.tsx', 'deploy/remote/Caddyfile',
        'apps/web/index.html', 'apps/web/public/theme-init.js', 'apps/web/vite.config.ts']
    def snapshot():
        return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in sources}
    before_build = snapshot()
    build(output)
    dist = output / 'dist'
    policy = re.search(r'Content-Security-Policy "([^"]+)"',
        (ROOT / 'deploy/remote/Caddyfile').read_text()).group(1)
    policy = policy.replace('{$RELAY_DOMAIN}', 'relay.csp.test')
    assert "'unsafe-eval'" not in policy
    report = {'kind': 'internal_review_only', 'policy': policy, 'checks': [], 'findings': [],
              'scope': 'real production modules + synthetic Relay/Noise Host; no main-file edits'}
    diagnostic = b'''window.cspProbe={violations:[],functionBlocked:false};
document.addEventListener('securitypolicyviolation',e=>cspProbe.violations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));
try{new Function('return 1')()}catch(e){cspProbe.functionBlocked=true}
'''
    server_requests = []

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def end_headers(self):
            mode = self.headers.get('X-CSP-Test-Mode', '')
            current = policy.replace(" 'wasm-unsafe-eval'", '') if mode == 'no-wasm' else policy
            self.send_header('Content-Security-Policy', current)
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def do_GET(self):
            server_requests.append(self.path)
            if self.path.split('?')[0] == '/csp-probe.js':
                self.send_response(200); self.send_header('Content-Type', 'text/javascript'); self.end_headers()
                self.wfile.write(diagnostic); return
            if self.path.split('?')[0] in ('/', '/index.html'):
                body = (dist / 'index.html').read_bytes().replace(b'<head>', b'<head><script src="/csp-probe.js"></script>')
                self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers()
                self.wfile.write(body); return
            if self.path.startswith('/api/') or self.path.startswith('/csp-marker'):
                self.send_response(200); self.send_header('Content-Type', 'image/png'); self.end_headers()
                self.wfile.write(PNG); return
            super().do_GET()

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(dist)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                report['browser'] = browser.version
                for no_wasm in (False, True):
                    context = browser.new_context(service_workers='block',
                        extra_http_headers={'X-CSP-Test-Mode': 'no-wasm'} if no_wasm else {})
                    page = context.new_page()
                    owner, host_id, device_id, pairing_id = [str(uuid.uuid4()) for _ in range(4)]
                    private, public = generate_keypair()
                    secret = secrets.token_urlsafe(32)
                    token = secrets.token_urlsafe(32)
                    live = []
                    approved_peer = None
                    decrypted_paths = []
                    requests = []
                    page.on('request', lambda req: requests.append({'url': req.url, 'type': req.resource_type}))

                    def route(request):
                        if request.request.url.startswith(RELAY + '/v1/pairings/'):
                            request.fulfill(status=200, content_type='application/json', body=json.dumps({
                                'owner_id': owner, 'host_id': host_id, 'device_id': device_id, 'device_token': token}))
                        else:
                            request.abort()

                    page.route('https://**/*', route)

                    def socket(ws):
                        state = {'noise': None, 'ws': ws, 'pending': False}
                        live.append(state)

                        def send_frame(frame):
                            ws.send(state['noise'].encrypt(json.dumps(frame).encode()))

                        def incoming(message):
                            if isinstance(message, str):
                                auth = json.loads(message)
                                assert auth == {'role': 'client', 'token': token}
                                state['noise'] = NoiseSession(private, False, approved_peer,
                                    f'kyalulu-remote-v1|{owner}|{host_id}|{device_id}'.encode())
                                ws.send(json.dumps({'type': 'ready'})); return
                            noise = state['noise']
                            if not noise.finished:
                                payload = noise.read(message)
                                if not noise.finished:
                                    ws.send(noise.write()); return
                                data = json.loads(payload)
                                if approved_peer is None:
                                    assert secrets.compare_digest(data['secret'], secret)
                                    state['pending'] = True
                                    send_frame({'type': 'approval_required', 'code': '123456'})
                                else:
                                    assert data['secret'] is None
                                    send_frame({'type': 'ready', 'version': 1})
                                return
                            frame = json.loads(noise.decrypt(message))
                            if frame.get('type') != 'request':
                                return
                            path = frame['path']; decrypted_paths.append(path)
                            if path.startswith('/api/library/assets/'):
                                body, content_type = PNG, 'image/png'
                            else:
                                data = {'remote_mode': True, 'authenticated': True, 'administrative': False} if path == '/api/mobile/status' else []
                                body, content_type = json.dumps(data).encode(), 'application/json'
                            ident = frame['id']
                            send_frame({'type': 'response', 'id': ident, 'seq': 0, 'status': 200, 'headers': {'content-type': content_type}})
                            send_frame({'type': 'chunk', 'id': ident, 'seq': 1, 'data': base64.b64encode(body).decode()})
                            send_frame({'type': 'end', 'id': ident, 'seq': 2})

                        ws.on_message(incoming)

                    page.route_web_socket('wss://relay.csp.test/v1/socket', socket)
                    link = dict(version=1, relay=RELAY, ownerId=owner, hostId=host_id,
                        pairingId=pairing_id, token=token, secret=secret, hostKey=public.hex(), expires=int(time.time()) + 300)
                    page.goto(origin + '/#remote=' + quote(json.dumps(link), safe=''))
                    expect(page.get_by_role('button', name='このPCに登録する', exact=True)).to_be_visible()
                    page.get_by_role('button', name='このPCに登録する', exact=True).click()
                    if no_wasm:
                        expect(page.get_by_role('alert').filter(has_text='Noise')).to_be_visible(timeout=20000)
                        assert not live
                        report['checks'].append('negative control: same production chunk fails without wasm-unsafe-eval; no socket/enrollment')
                        report['no_wasm_violations'] = page.evaluate('cspProbe')
                        context.close(); continue
                    wait(page, lambda: any(s['pending'] for s in live))
                    expect(page.locator('form [role="status"] strong')).to_have_text('123456')
                    pending = next(s for s in live if s['pending'])
                    approved_peer = pending['noise'].peer_key
                    pending['ws'].send(pending['noise'].encrypt(json.dumps({'type': 'ready', 'version': 1}).encode()))
                    expect(page.get_by_role('heading', name='登録できました')).to_be_visible()
                    assert page.evaluate('cspProbe.functionBlocked') is True
                    report['checks'].append('actual production remoteClient: XX + encrypted enrollment + approval under strict Caddy CSP; JS unsafe-eval remains blocked')
                    page.get_by_role('button', name='会話を開く', exact=True).click()
                    probe = next((dist / 'assets').glob('review-probe-*.js'))
                    page.add_script_tag(url='/assets/' + probe.name, type='module')
                    wait(page, lambda: page.evaluate('!!globalThis.remoteReview && remoteReview.active()'))

                    asset = '/api/library/assets/' + 'a' * 64
                    page.evaluate('props => remoteReview.image(props)', {'src': asset, 'alt': 'CSP image'})
                    expect(page.locator('#review-image img')).to_have_attribute('src', re.compile('^blob:'))
                    assert asset in decrypted_paths
                    assert not any(urlsplit(r['url']).path == asset for r in requests)
                    report['checks'].append('canonical private image loaded through encrypted RPC into blob URL; no HTTP image request')
                    cases = {
                        'external': {'src': 'https://leak.invalid/csp-marker-external'},
                        'backslash_host': {'src': '/\\leak.invalid/csp-marker-backslash'},
                        'dot_api': {'src': '/public/../api/csp-marker-private'},
                        'encoded_dot_api': {'src': '/public/%2e%2e/api/csp-marker-encoded'},
                        'srcset': {'src': '/apple-touch-icon.png', 'srcSet': '/api/csp-marker-srcset 1x'},
                    }
                    image_results = {}
                    for name, props in cases.items():
                        page.evaluate('remoteReview.clear()'); page.wait_for_timeout(30)
                        before = len(requests)
                        server_before = len(server_requests)
                        violations_before = len(page.evaluate('cspProbe.violations'))
                        page.evaluate('props => remoteReview.image(props)', props)
                        page.wait_for_timeout(200)
                        seen = [r for r in requests[before:] if 'csp-marker' in r['url']]
                        received = [path for path in server_requests[server_before:] if 'csp-marker' in path]
                        violations = page.evaluate('cspProbe.violations')[violations_before:]
                        image_results[name] = {'browser_attempts': seen, 'server_gets': received,
                            'csp_violations': violations}
                        if received:
                            report['findings'].append({'file': 'apps/web/src/components/RuntimeMedia.tsx',
                                'case': name, 'impact': 'image metadata caused server-observed HTTP requests outside encrypted RPC', 'server_gets': received})
                        elif seen:
                            report['findings'].append({'file': 'apps/web/src/components/RuntimeMedia.tsx',
                                'case': name, 'impact': 'component allowed an image request attempt; CSP blocking is recorded separately, not confirmed exfiltration',
                                'attempts': seen, 'csp_violations': violations})
                    report['image_cases'] = image_results
                    report['rpc_admission'] = page.evaluate('remoteReview.admissionRead()')
                    assert report['rpc_admission']['afterAdmission']['reads'] > 0, 'reader spy positive control failed'
                    if report['rpc_admission']['readsWhileFull']:
                        report['findings'].append({'file': 'apps/web/src/lib/remoteRpc.ts',
                            'impact': 'Request body is fully materialized before waiting on the 12-request admission limit'})
                    else:
                        report['checks'].append('full admission queue performs no body read or reader acquisition; reader positive control runs after a slot opens')
                    report['rpc_bounded_read'] = page.evaluate('remoteReview.boundedRead()')
                    bounded = report['rpc_bounded_read']
                    assert bounded['cancelled'] and bounded['chunks'] == 17 and bounded['sent'] == 0 and bounded['reservations'] == 0 and '16MiB' in bounded['error'], bounded
                    report['checks'].append('stream exceeding 16 MiB cancelled at chunk 17, no frame sent, admission reservation released')
                    report['dispose_during_open'] = page.evaluate('remoteReview.disposeDuringOpen()')
                    if report['dispose_during_open']['socketCreatedAfterClose']:
                        report['findings'].append({'file': 'apps/web/src/lib/remoteClient.ts',
                            'impact': 'close during asynchronous Noise initialization still creates a WebSocket afterward'})
                    else:
                        report['checks'].append('close during Noise initialization creates no subsequent WebSocket')
                    report['csp_diagnostics'] = page.evaluate('cspProbe')
                    font_requests = [r for r in requests if r['type'] == 'font' or 'fonts.googleapis.com' in r['url'] or 'fonts.gstatic.com' in r['url']]
                    assert not font_requests, font_requests
                    report['checks'].append('no font requests; system font stack used')
                    unexpected = [v for v in report['csp_diagnostics']['violations']
                        if v['blocked'] != 'eval' and v['directive'] != 'img-src']
                    assert not unexpected, unexpected
                    assert not any(secret in r['url'] or token in r['url'] for r in requests)
                    report['checks'].append('pairing secret/ticket absent from all HTTP request URLs')
                    for state in live:
                        if state['noise']:
                            state['noise'].close()
                    context.close()
            finally:
                browser.close()
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=3)
    report['source_sha256_before_build'] = before_build
    report['source_sha256_after_test'] = snapshot()
    if before_build != report['source_sha256_after_test']:
        report['findings'].append({'impact': 'source changed during acceptance; rerun against a stable snapshot'})
    report['server_private_gets'] = [x for x in server_requests if '/api/csp-marker' in x]
    report['result'] = 'FINDINGS_REQUIRE_FIX' if report['findings'] else 'PASS_INTERNAL_ACCEPTANCE'
    (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'result': report['result'], 'report': str(output / 'report.json'),
        'checks': report['checks'], 'findings': report['findings']}, indent=2))
    return 2 if report['findings'] else 0


if __name__ == '__main__':
    sys.exit(main())
