"""Acceptance of the actual production wrappers, not the earlier library probes.

Build with node scripts/remote_crypto_build_wrapper.mjs. Isolated dependencies
live in .artifacts/remote-v1; no relay or user's persistent identities are used.
"""
from __future__ import annotations

import functools
import base64
import hashlib
import http.server
import importlib.metadata
import importlib.util
import json
import secrets
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / '.artifacts' / 'remote-v1'
# Prefer the installed product backend; use the isolated pinned PoC only when
# main has not installed the optional runtime dependencies yet.
if importlib.util.find_spec('noise') is None:
    sys.path.insert(0, str(ARTIFACTS / 'python'))
sys.path.insert(0, str(ROOT / 'runtime'))
from python.remote.crypto import NoiseSession, RemoteCryptoError, generate_keypair
from playwright.sync_api import sync_playwright


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def main():
    report = {'suite': 'Noise_XX_25519_ChaChaPoly_SHA256', 'checks': [],
              'production_release': 'EXTERNAL_SECURITY_REVIEW_REQUIRED',
              'renewal': 'Main enforces 64 MiB and Client 9 min / Host 10 min; fresh XX, no REKEY',
              'dependencies': {'browser': 'noise-c.wasm@0.4.0',
                  'noiseprotocol': importlib.metadata.version('noiseprotocol'),
                  'cryptography': importlib.metadata.version('cryptography')}}
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(
        QuietHandler, directory=str(ARTIFACTS / 'wrapper-dist')))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                report['browser'] = browser.version
                page = browser.new_page()
                errors = []
                page.on('pageerror', lambda err: errors.append(str(err)))
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.wait_for_function('globalThis.remoteWrapper')
                identity = page.evaluate('remoteWrapper.identity()')
                host_private, host_public = generate_keypair()
                prologue = b'kyalulu-remote-v1\x00owner=fixture\x00host=fixture\x00device=fixture'
                enrollment = json.dumps({'secret': secrets.token_hex(32), 'pairingId': 'fixture'}).encode()

                def call(id, method, data=b'', error=False, status=False):
                    result = page.evaluate('x => remoteWrapper.call(x)',
                        {'id': id, 'method': method, 'data': list(data)})
                    if error:
                        assert not result['ok'], result
                        assert not result['finished'] and not result['peerKey'] and not result['hash']
                        return result
                    assert result['ok'], result
                    return result if status else bytes(result['data'])

                def start(pinned=True, private=host_private, context=prologue):
                    id = page.evaluate('x => remoteWrapper.create(x)', {
                        'identity': identity['id'], 'expectedPeer': list(host_public), 'prologue': list(prologue)})
                    host = NoiseSession(private, False, bytes(identity['publicKey']) if pinned else None, context)
                    return id, host

                def finish(id, host, payload=b''):
                    assert not host.read(call(id, 'write'))
                    assert not call(id, 'read', host.write())
                    before = call(id, 'status', status=True)
                    assert not before['finished'] and bytes(before['peerKey']) == host_public
                    m3 = call(id, 'write', payload)
                    if payload:
                        assert payload not in m3
                    assert host.read(m3) == payload
                    status = call(id, 'status', status=True)
                    assert status['finished'] and host.finished
                    assert bytes(status['hash']) == host.handshake_hash
                    assert host.peer_key == bytes(identity['publicKey'])

                def reject_host(host, operation):
                    try:
                        operation()
                    except RemoteCryptoError:
                        assert not host.finished and not host.peer_key and not host.handshake_hash
                        return
                    raise AssertionError('expected closed Python session')

                for pinned in (False, True):
                    id, host = start(pinned)
                    finish(id, host, b'' if pinned else enrollment)
                    for msg in (b'', '実ブラウザー↔Python'.encode(), secrets.token_bytes(65519)):
                        assert host.decrypt(call(id, 'encrypt', msg)) == msg
                        assert call(id, 'decrypt', host.encrypt(msg)) == msg
                    report['checks'].append(f'{pinned=}: real Vite WASM bundle, arbitrary prologue, m3 JSON, peer pins/hash, bidirectional empty/UTF8/max transport')

                id1, host1 = start()
                finish(id1, host1)
                old = call(id1, 'encrypt', b'stale')
                old_reverse = host1.encrypt(b'stale-reverse')
                id2, host2 = start()
                finish(id2, host2)
                assert host1.handshake_hash != host2.handshake_hash
                reject_host(host2, lambda: host2.decrypt(old))
                call(id2, 'decrypt', old_reverse, error=True)
                report['checks'].append('fresh reconnect reuses static identity, changes session hash, rejects previous-session traffic in both directions')

                wrong_private, _ = generate_keypair()
                id, host = start(private=wrong_private)
                host.read(call(id, 'write'))
                call(id, 'read', host.write(), error=True)
                call(id, 'write', enrollment, error=True)
                report['checks'].append('wrong Host private/static key rejected before m3 enrollment release; session stays closed')

                id, _ = start()
                _, wrong_client = generate_keypair()
                host = NoiseSession(host_private, False, wrong_client, prologue)
                host.read(call(id, 'write'))
                call(id, 'read', host.write())
                reject_host(host, lambda: host.read(call(id, 'write', enrollment)))
                report['checks'].append('wrong registered Client pin rejected before m3 payload is returned')

                id, host = start(context=b'different-owner-host-device')
                host.read(call(id, 'write'))
                call(id, 'read', host.write(), error=True)
                report['checks'].append('prologue context mismatch rejected')

                for attack in ('tamper', 'replay', 'reorder', 'truncate', 'oversize'):
                    for target in ('browser', 'python'):
                        id, host = start()
                        finish(id, host)
                        enc = host.encrypt if target == 'browser' else lambda m: call(id, 'encrypt', m)
                        packet = enc(b'first')
                        if attack == 'tamper':
                            packet = packet[:-1] + bytes([packet[-1] ^ 1])
                        elif attack == 'replay':
                            if target == 'browser':
                                assert call(id, 'decrypt', packet) == b'first'
                            else:
                                assert host.decrypt(packet) == b'first'
                        elif attack == 'reorder':
                            packet = enc(b'second')
                        elif attack == 'truncate':
                            packet = packet[:8]
                        else:
                            packet = bytes(65536)
                        if target == 'browser':
                            call(id, 'decrypt', packet, error=True)
                            call(id, 'encrypt', b'after-failure', error=True)
                        else:
                            reject_host(host, lambda: host.decrypt(packet))
                        report['checks'].append(f'{target}: {attack} rejected and session closed')

                for stage in (2, 3):
                    id, host = start(False)
                    host.read(call(id, 'write'))
                    m2 = host.write()
                    if stage == 2:
                        call(id, 'read', m2[:-1] + bytes([m2[-1] ^ 1]), error=True)
                    else:
                        call(id, 'read', m2)
                        m3 = call(id, 'write', enrollment)
                        reject_host(host, lambda: host.read(m3[:-1] + bytes([m3[-1] ^ 1])))
                    report['checks'].append(f'm{stage} tamper rejected without payload release')

                for misuse in ('early_encrypt', 'early_payload', 'read_first', 'duplicate_write', 'large_m3'):
                    id, host = start()
                    if misuse == 'early_encrypt':
                        call(id, 'encrypt', b'not-yet', error=True)
                    elif misuse == 'early_payload':
                        call(id, 'write', b'no plaintext leak', error=True)
                    elif misuse == 'read_first':
                        call(id, 'read', b'', error=True)
                    elif misuse == 'duplicate_write':
                        call(id, 'write')
                        call(id, 'write', error=True)
                    else:
                        host.read(call(id, 'write'))
                        call(id, 'read', host.write())
                        call(id, 'write', bytes(1025), error=True)
                    report['checks'].append(f'browser misuse {misuse} closes session')

                id, host = start()
                finish(id, host, bytes(1024))
                report['checks'].append('1024-byte m3 maximum accepted')
                call(id, 'close')
                call(id, 'close')
                call(id, 'encrypt', b'', error=True)
                report['checks'].append('close is idempotent, clears public state and prevents further operations')
                # Driver models main's approved budget with real encryption.
                # Main's timer/relay enforcement is a separate integration gate.
                id, host = start()
                finish(id, host)
                old_hash = host.handshake_hash
                byte_limit = 64 * 1024 * 1024
                frame_bytes = 65535
                total = 192  # 32 + 96 + 64 byte empty XX handshake
                first = 0
                while total + 2 * frame_bytes <= byte_limit:
                    count = min(16, (byte_limit - total) // (2 * frame_bytes))
                    packets = page.evaluate('x => remoteWrapper.encryptBatch(x)',
                        {'id': id, 'count': count, 'first': first})
                    responses = []
                    for index, packet in enumerate(packets):
                        wire = base64.b64decode(packet, validate=True)
                        plaintext = host.decrypt(wire)
                        assert plaintext == bytes([(first + index) % 251]) * 65519
                        response = host.encrypt(plaintext)
                        total += len(wire) + len(response)
                        responses.append(base64.b64encode(response).decode())
                    page.evaluate('x => remoteWrapper.decryptBatch(x)',
                        {'id': id, 'messages': responses, 'first': first})
                    first += count
                assert total <= byte_limit < total + 2 * frame_bytes
                old_packet = call(id, 'encrypt', b'unsent-old-session-packet')
                call(id, 'close')
                host.close()
                id, host = start()
                finish(id, host)
                assert host.handshake_hash != old_hash
                assert host.decrypt(call(id, 'encrypt', b'fresh-XX-after-budget')) == b'fresh-XX-after-budget'
                reject_host(host, lambda: host.decrypt(old_packet))
                report['budget_workflow'] = {'limit': byte_limit, 'accounted_bytes': total,
                    'full_frames_each_direction': first, 'new_handshake': True,
                    'note': 'Driver applies main-owned budget; timer/relay enforcement outside this crypto test'}
                report['checks'].append('64-MiB budget: real bidirectional bulk traffic, close before budget, fresh pinned XX, stale-session rejection')
                assert not errors, errors
                report['checks'].append('no uncaught browser page errors')
                report['gate'] = 'PASS_BOUNDED_DEVELOPMENT_CANDIDATE'
                report['source_sha256'] = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest()
                    for path in [ROOT / 'apps/web/src/lib/remoteCrypto.ts', ROOT / 'runtime/python/remote/crypto.py']}
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
    (ARTIFACTS / 'wrapper-interop-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
