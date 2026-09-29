"""Real browser / Python qualification of unmodified noise-c.wasm@0.4.0 XX.

Only test keys and an isolated loopback server are used. Exit 2 = blocked gate.
"""
from __future__ import annotations

import functools
import hashlib
import hmac
import http.server
import json
import secrets
import sys
import threading

from remote_crypto_library_probe import ARTIFACTS, ROOT, QuietHandler
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from noise.connection import Keypair, NoiseConnection
from playwright.sync_api import sync_playwright


def main():
    report = {'library': 'noise-c.wasm@0.4.0', 'python': 'noiseprotocol==0.3.1',
              'suite': 'Noise_XX_25519_ChaChaPoly_SHA256', 'checks': [], 'blockers': []}
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
        functools.partial(QuietHandler, directory=str(ARTIFACTS)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                report['browser'] = browser.version
                page = browser.new_page()
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                for filename in ('noise-c.js', 'constants.js', 'index.js'):
                    page.add_script_tag(url='/node_modules/noise-c.wasm/src/' + filename)
                page.add_script_tag(path=str(ROOT / 'scripts' / 'remote_crypto_wasm_probe.js'))
                page.wait_for_function('globalThis.wasmProbe || globalThis.wasmProbeError')
                assert page.evaluate('globalThis.wasmProbeError ?? null') is None
                identity = page.evaluate('wasmProbe.identity()')
                assert identity['fingerprint'] == hashlib.sha256(bytes(identity['publicKey'])).hexdigest()
                static = X25519PrivateKey.generate()
                public = static.public_key().public_bytes_raw()
                pin = hashlib.sha256(public).hexdigest()
                secret = secrets.token_bytes(32)

                def call(id, method, data=b'', error=False):
                    result = page.evaluate('x => wasmProbe.call(x)',
                        {'id': id, 'method': method, 'data': list(data)})
                    if error:
                        return result
                    assert result['ok'], result
                    return bytes(result['data'])

                def start(browser_initiator=True, expected_pin=pin, key=static):
                    id = page.evaluate('x => wasmProbe.create(x)',
                        {'identity': identity['id'], 'initiator': browser_initiator, 'expectedPin': expected_pin})
                    py = NoiseConnection.from_name(report['suite'].encode())
                    if browser_initiator:
                        py.set_as_responder()
                    else:
                        py.set_as_initiator()
                    py.set_prologue(b'kyalulu-remote-v1')
                    py.set_keypair_from_private_bytes(Keypair.STATIC, key.private_bytes_raw())
                    py.start_handshake()
                    return id, py

                def handshake(id, py, browser_initiator=True, payload=secret):
                    if browser_initiator:
                        assert not py.read_message(call(id, 'write'))
                        call(id, 'read', py.write_message())
                        state = py.noise_protocol.handshake_state
                        third = call(id, 'write', payload)
                        assert payload not in third if payload else True
                        received = bytes(py.read_message(third))
                        assert hmac.compare_digest(received, payload)
                    else:
                        call(id, 'read', py.write_message())
                        py.read_message(call(id, 'write'))
                        state = py.noise_protocol.handshake_state
                        assert call(id, 'read', py.write_message(payload)) == payload
                    assert state.rs.public_bytes == bytes(identity['publicKey'])
                    assert hashlib.sha256(state.rs.public_bytes).hexdigest() == identity['fingerprint']
                    assert call(id, 'finalize') == py.get_handshake_hash()

                def reject(fn):
                    try:
                        fn()
                    except Exception:
                        return
                    raise AssertionError('expected rejection')

                for initiator in (True, False):
                    id, py = start(initiator)
                    handshake(id, py, initiator)
                    for msg in (b'', 'Noise XX 日本語'.encode(), secrets.token_bytes(65519)):
                        assert py.decrypt(call(id, 'encrypt', msg)) == msg
                        assert call(id, 'decrypt', py.encrypt(msg)) == msg
                    report['checks'].append(f'browser_initiator={initiator}: XX + encrypted m3 payload + pins + transcript hash + bidirectional transport')
                    id2, py2 = start(initiator)
                    handshake(id2, py2, initiator, payload=b'')
                    reject(lambda: py2.decrypt(call(id, 'encrypt', b'old-session')))
                    report['checks'].append(f'browser_initiator={initiator}: reconnect pins, empty m3, old-session rejection')

                # A changed real static identity is rejected before Client releases m3.
                id, py = start(key=X25519PrivateKey.generate())
                py.read_message(call(id, 'write'))
                result = call(id, 'read', py.write_message(), error=True)
                assert not result['ok'] and 'pin mismatch' in result['error']
                assert not call(id, 'write', secret, error=True)['ok']
                report['checks'].append('changed Host static key rejected before enrollment secret transmission')

                # Browser responder tests the same policy for a reconnecting client.
                id, py = start(False, key=X25519PrivateKey.generate())
                call(id, 'read', py.write_message())
                py.read_message(call(id, 'write'))
                result = call(id, 'read', py.write_message(), error=True)
                assert not result['ok'] and 'pin mismatch' in result['error']
                report['checks'].append('changed reconnecting Client static key rejected at m3')

                # An app-layer enrollment token is validated by application policy,
                # not interpreted as a PSK or as an automatic Noise failure.
                id, py = start()
                py.read_message(call(id, 'write'))
                call(id, 'read', py.write_message())
                received = bytes(py.read_message(call(id, 'write', secrets.token_bytes(32))))
                assert py.handshake_finished and not hmac.compare_digest(received, secret)
                report['checks'].append('wrong app enrollment secret: Noise succeeds, app comparison rejects; no approval implied')

                for target in ('python', 'browser'):
                    for attack in ('tamper', 'replay', 'reorder', 'truncated'):
                        id, py = start()
                        handshake(id, py)
                        encrypt = (lambda m: call(id, 'encrypt', m)) if target == 'python' else py.encrypt
                        decrypt = py.decrypt if target == 'python' else (lambda m: call(id, 'decrypt', m))
                        packet = encrypt(b'first')
                        if attack == 'tamper':
                            packet = packet[:-1] + bytes([packet[-1] ^ 1])
                        elif attack == 'replay':
                            assert decrypt(packet) == b'first'
                        elif attack == 'reorder':
                            packet = encrypt(b'second')
                        else:
                            packet = packet[:8]
                        reject(lambda: decrypt(packet))
                        report['checks'].append(f'{target}: {attack} rejected')

                for index in (2, 3):
                    id, py = start()
                    py.read_message(call(id, 'write'))
                    second = bytes(py.write_message())
                    if index == 2:
                        assert not call(id, 'read', second[:-1] + bytes([second[-1] ^ 1]), error=True)['ok']
                    else:
                        call(id, 'read', second)
                        third = call(id, 'write', secret)
                        reject(lambda: py.read_message(third[:-1] + bytes([third[-1] ^ 1])))
                    report['checks'].append(f'handshake m{index} tamper rejected')

                id, py = start(False, expected_pin=None)
                result = call(id, 'read', bytes(32), error=True)
                if result['ok']:
                    result = call(id, 'write', error=True)
                assert not result['ok'], 'zero X25519 point must fail before a key is accepted'
                report['checks'].append('all-zero ephemeral public key rejected by unmodified WASM')

                id, py = start()
                handshake(id, py)
                rekey = call(id, 'rekey', error=True)
                report['rekey'] = rekey
                if not rekey['ok']:
                    report['blockers'].append('Published CipherState.Rekey() throws: ' + rekey['error'])
                else:
                    py.rekey_inbound_cipher()
                    assert py.decrypt(call(id, 'encrypt', b'rekey')) == b'rekey'
                    report['checks'].append('standard rekey interoperates')
                report['gate'] = 'BLOCKED_LIBRARY_API' if report['blockers'] else 'INTEROP_ONLY_PASSED'
                report['limitations'] = [
                    'Probe pin checks are not a product adapter or persistent registration policy',
                    'Secret expiry/single use/manual approval/vault roundtrip are not implemented by this probe',
                    'Production security suitability is not established by positive interoperability alone',
                ]
                page.evaluate('wasmProbe.cleanup()')
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
    (ARTIFACTS / 'wasm-probe-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 2 if report['blockers'] else 0


if __name__ == '__main__':
    sys.exit(main())
