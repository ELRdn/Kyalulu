"""Qualify third-party Noise in an actual browser against noiseprotocol.

No production imports, relay, app modifications, or handwritten Noise algorithm.
Dependencies and generated bundle/report stay in .artifacts/remote-v1.
Run with the project's Python that already has Playwright installed.
"""
from __future__ import annotations

import functools
import hashlib
import http.server
import json
import secrets
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.artifacts' / 'remote-v1'
sys.path.insert(0, str(ARTIFACTS / 'python'))

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from noise.connection import Keypair, NoiseConnection
from noise.backends.default.ciphers import ChaCha20Cipher
from playwright.sync_api import sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    report = {'library': '@lukeburns/clatterjs@1.0.0',
              'python': 'noiseprotocol==0.3.1', 'checks': [], 'blockers': []}
    handler = functools.partial(QuietHandler, directory=str(ARTIFACTS))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                report['browser'] = browser.version
                page = browser.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.add_script_tag(url='/library-probe.js')
                identity = page.evaluate('remoteCryptoProbe.identity()')
                host_sk = X25519PrivateKey.generate()
                host_public = host_sk.public_key().public_bytes_raw()
                psk = secrets.token_bytes(32)

                def invoke(id, method, data=b'', allow_error=False):
                    result = page.evaluate('x => remoteCryptoProbe.call(x)',
                                           {'id': id, 'method': method, 'data': list(data)})
                    if not allow_error:
                        assert result['ok'], result
                        return bytes(result['data'])
                    return result

                def start(pairing=True, wrong_psk=False):
                    js = page.evaluate('x => remoteCryptoProbe.create(x)',
                                       {'identity': identity['id'], 'pairing': pairing,
                                        'psk': list(psk)})
                    name = 'Noise_XXpsk3_25519_ChaChaPoly_SHA256' if pairing else 'Noise_XX_25519_ChaChaPoly_SHA256'
                    assert js['name'] == name
                    host = NoiseConnection.from_name(name.encode())
                    host.set_as_responder()
                    host.set_prologue(b'kyalulu-remote-v1')
                    host.set_keypair_from_private_bytes(Keypair.STATIC, host_sk.private_bytes_raw())
                    if pairing:
                        host.set_psks(psk=secrets.token_bytes(32) if wrong_psk else psk)
                    host.start_handshake()
                    return js['id'], host

                def finish(id, host):
                    assert not host.read_message(invoke(id, 'write'))
                    invoke(id, 'read', host.write_message())
                    # noiseprotocol deletes its handshake reference on Split.
                    state = host.noise_protocol.handshake_state
                    assert not host.read_message(invoke(id, 'write'))
                    peer = state.rs.public_bytes
                    assert peer == bytes(identity['publicKey'])
                    assert invoke(id, 'finalize') == host_public
                    assert host.handshake_finished
                    return hashlib.sha256(peer).hexdigest()

                def rejection(fn):
                    try:
                        fn()
                    except Exception:
                        return
                    raise AssertionError('expected rejection')

                for pairing in (True, False):
                    id, host = start(pairing)
                    peer_pin = finish(id, host)
                    for message in (b'', 'browser/Python 日本語'.encode(), secrets.token_bytes(65519)):
                        assert host.decrypt(invoke(id, 'encrypt', message)) == message
                        assert invoke(id, 'decrypt', host.encrypt(message)) == message
                    report['checks'].append(f'{"XXpsk3" if pairing else "XX"}: bidirectional empty/UTF8/max transport and peer static keys')
                    id2, host2 = start(pairing)
                    assert finish(id2, host2) == peer_pin
                    old = invoke(id, 'encrypt', b'old session')
                    rejection(lambda: host2.decrypt(old))
                    report['checks'].append(f'{pairing=}: fresh handshake same identity; old-session ciphertext rejected')

                id, host = start(wrong_psk=True)
                host.read_message(invoke(id, 'write'))
                invoke(id, 'read', host.write_message())
                rejection(lambda: host.read_message(invoke(id, 'write')))
                assert not host.handshake_finished
                report['checks'].append('wrong PSK rejected at message 3')

                for target in ('python', 'browser'):
                    for attack in ('tamper', 'replay', 'reorder'):
                        id, host = start()
                        finish(id, host)
                        encrypt = (lambda m: invoke(id, 'encrypt', m)) if target == 'python' else host.encrypt
                        decrypt = host.decrypt if target == 'python' else (lambda m: invoke(id, 'decrypt', m))
                        packet = encrypt(b'first')
                        if attack == 'tamper':
                            packet = packet[:-1] + bytes([packet[-1] ^ 1])
                        elif attack == 'replay':
                            assert decrypt(packet) == b'first'
                        else:
                            packet = encrypt(b'second')
                        rejection(lambda: decrypt(packet))
                        report['checks'].append(f'{target}: {attack} rejected')

                for index in (2, 3):
                    id, host = start()
                    host.read_message(invoke(id, 'write'))
                    second = bytes(host.write_message())
                    if index == 2:
                        assert not invoke(id, 'read', second[:-1] + bytes([second[-1] ^ 1]), True)['ok']
                    else:
                        invoke(id, 'read', second)
                        third = invoke(id, 'write')
                        rejection(lambda: host.read_message(third[:-1] + bytes([third[-1] ^ 1])))
                    report['checks'].append(f'handshake message {index} tamper rejected')

                # Both sides use their library's own standard REKEY implementation.
                id, host = start()
                finish(id, host)
                invoke(id, 'rekeySend')
                host.rekey_inbound_cipher()
                packet = invoke(id, 'encrypt', b'after rekey')
                try:
                    assert host.decrypt(packet) == b'after rekey'
                except Exception as exc:
                    report['blockers'].append(f'Browser/Python REKEY interoperability fails: {type(exc).__name__}: {exc}')

                # Public test key only. Never writes session keys or private identities.
                key = bytes(range(32))
                cipher = ChaCha20Cipher()
                cipher.initialize(key)
                expected = cipher.rekey(key)
                actual = bytes(page.evaluate('x => remoteCryptoProbe.rekeyVector(x)', list(key)))
                report['rekey_vector'] = {'key': key.hex(), 'python': expected.hex(), 'browser': actual.hex()}
                assert expected != actual, 'Reassess blocker if upstream behavior changes'
                boundary = page.evaluate('remoteCryptoProbe.nonceBoundary()')
                report['nonce_boundary'] = boundary
                report['blockers'].append('clatterjs uses 0x0fffffffffffffff (2^60-1), not Noise 0xffffffffffffffff (2^64-1), for REKEY and nonce exhaustion')
                report['gate'] = 'BLOCKED_LIBRARY_INCOMPATIBLE'
                report['not_tested'] = ['production pin enforcement/approval: adapter intentionally not adopted', 'production release']
                # An independent older WASM candidate, as shipped, without vendor patches.
                base = '/node_modules/noise-c.wasm/src/'
                for filename in ('noise-c.js', 'constants.js', 'index.js'):
                    page.add_script_tag(url=base + filename)
                report['noise_c_wasm_0_4_0'] = page.evaluate('''() => new Promise(resolve => {
                    const timer = setTimeout(() => resolve({error:'initialization timeout'}), 10000);
                    try {
                        noise_c_wasm({locateFile: file => '/node_modules/noise-c.wasm/src/' + file}, noise => {
                            clearTimeout(timer);
                            const results = {};
                            for (const name of ['Noise_XX_25519_ChaChaPoly_SHA256', 'Noise_XXpsk3_25519_ChaChaPoly_SHA256']) {
                                try {
                                    const hs = new noise.HandshakeState(name, noise.constants.NOISE_ROLE_INITIATOR);
                                    results[name] = 'constructed';
                                    hs.free();
                                } catch (e) { results[name] = String(e); }
                            }
                            resolve(results);
                        });
                    } catch (e) { clearTimeout(timer); resolve({error:String(e)}); }
                })''')
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
    (ARTIFACTS / 'library-probe-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    # A successful reproduction of an incompatibility is NOT a passing release gate.
    return 2 if report['blockers'] else 0


if __name__ == '__main__':
    sys.exit(main())
