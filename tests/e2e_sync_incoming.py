"""Real Chromium incoming spool acceptance; reuse frozen old receiver and independent decoder."""
import argparse
import asyncio
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite
from e2e_sync_receive_projection import check_oracle, decode_evidence, fingerprint as projection_fingerprint, digest

ROOT = Path(__file__).resolve().parents[1]
CRITICAL_SOURCES = (
    'apps/web/src/lib/appSync.ts', 'apps/web/src/lib/appSyncBranch.ts', 'apps/web/src/lib/appStore.ts',
    'apps/web/src/lib/segmentedStorage.ts', 'apps/web/src/lib/jsonStream.ts', 'apps/web/src/lib/appSyncStage.ts',
    'apps/web/src/lib/appSyncData.ts', 'apps/web/src/lib/appOutbox.ts', 'apps/web/src/lib/appTransfers.ts',
    'tests/e2e_sync_incoming.py', 'tests/fixtures/sync-incoming.html', 'apps/web/src/lib/appSyncIncoming.ts',
    'tests/fixtures/sync-branch-ack-oracle.ts', 'tests/fixtures/sync-staging-oracle.ts',
)
SCENARIOS = (
    'incoming', 'messages-first', 'two-sources', 'duplicate-id', 'multi-page', 'inline', 'nonconversation',
    'delete-recovery', 'hydrate', 'dirty-schema', 'newer-schema', 'cached-header', 'forged-stage',
    'bad-json', 'bad-utf8', 'bad-base64', 'bad-size', 'bad-part-sha', 'bad-overall-sha', 'second-download-fails',
    'quota', 'owner-body', 'busy-body', 'consent-body', 'pending-local', 'pending-sync',
    'late-consent', 'manifest-mutation', 'local-collision', 'required-snapshot', 'missing-required', 'conflicting-required',
    'snapshot-collision-inline', 'snapshot-collision-paged', 'delete-then-incoming',
    'cleanup-isolation', 'reload-orphan', 'lock-sync', 'lock-hydrate',
)


def fingerprint():
    files = projection_fingerprint()['files']
    for name in ('tests/e2e_sync_incoming.py', 'tests/fixtures/sync-incoming.html'):
        files[name] = digest((ROOT / name).read_bytes())
    return {'sha256': digest(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()), 'files': files}


def body_hashes(transport, evidences, case_dir):
    """Check source/output first and last content with Python, independent of product JSON parsing."""
    comparisons = []
    for index, evidence in enumerate(evidences):
        if evidence.get('phase') == 'deletion-scrub':
            continue
        identifier = evidence['header']['id']
        candidates = [w for w in transport if w['descriptor']['id'] == identifier and w.get('parts')]
        if not candidates:
            continue
        wire = candidates[-1]
        raw = b''.join(base64.b64decode(p['data'], validate=True) for p in wire['parts'])
        ref = wire['descriptor']['payload_ref']
        assert len(raw) == ref['size'] and digest(raw) == ref['sha256']
        remote = json.loads(raw.decode('utf-8', errors='strict'))
        messages = remote.get('messages', [])
        if not messages:
            continue
        actual = json.loads((case_dir / ('entity-' + str(index)) / 'actual-payload.json').read_text(encoding='utf-8'))
        pair = {}
        for name, position in (('first', 0), ('last', -1)):
            source = messages[position]['content'].encode('utf-8')
            received = actual['messages'][position]['content'].encode('utf-8')
            assert digest(source) == digest(received), name + ' body content changed'
            pair[name + '_body_sha256'] = digest(received)
        comparisons.append({'id': identifier, **pair})
    return comparisons


async def lock_peer(context, page, url, scenario, paused):
    peer = await context.new_page()
    peer.on('pageerror', lambda error: paused.setdefault('peer_page_errors', []).append(str(error)))
    peer.on('download', lambda download: paused.setdefault('peer_downloads', []).append(download.suggested_filename))
    await peer.goto(url + '&peer=1')
    await peer.wait_for_function('window.__PEER_READY__ === true')
    await peer.wait_for_function("async () => (await navigator.locks.query()).pending.some(l => l.name.startsWith('kyalulu-sync:'))")
    locks = await peer.evaluate('navigator.locks.query()')
    assert len([l for l in locks['held'] if l['name'].startswith('kyalulu-sync:')]) == 1
    assert len([l for l in locks['pending'] if l['name'].startswith('kyalulu-sync:')]) == 1
    assert await peer.evaluate('window.__SYNC_INCOMING__ === undefined')
    assert await peer.evaluate('window.__peerStats.api.length === 0'), 'Waiting peer started virtual network before owner lock'
    staged = json.loads(await page.evaluate('async () => JSON.stringify(await window.__incomingSnapshot())'))
    assert staged == json.loads(paused['physical_staged_json']), 'Waiting peer cleaned or changed active A spool'
    await page.evaluate('window.__releaseIncoming()')
    await page.wait_for_function('window.__SYNC_INCOMING__ !== undefined && !window.__SYNC_INCOMING__.paused', timeout=120000)
    result = await page.evaluate('window.__SYNC_INCOMING__')
    await peer.wait_for_function('window.__SYNC_INCOMING__ !== undefined', timeout=120000)
    peer_result = await peer.evaluate('window.__SYNC_INCOMING__')
    result.update(lock_snapshot=locks, peer_result=peer_result, peer_preserved_active_spool=True, peer_page_errors=paused.get('peer_page_errors', []), peer_downloads=paused.get('peer_downloads', []),
                  physical_staged_json=paused['physical_staged_json'])
    assert not result['peer_page_errors'] and not result['peer_downloads']
    assert peer_result['ok'] and peer_result['stats']['api'], 'Peer did not run after A released owner lock'
    await peer.close()
    return result


async def main(args):
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = Path(args.output) if args.output else ROOT / '.artifacts/sync-incoming-browser' / timestamp
    output.mkdir(parents=True, exist_ok=False)
    stdout = (output / 'stdout.jsonl').open('w', encoding='utf-8')
    def emit(value):
        line = json.dumps(value, ensure_ascii=True)  # Windows console encodings must preserve every JSON value.
        stdout.write(line + '\n'); stdout.flush()
        print(line, flush=True)
    before = fingerprint()
    results, browser_version, contexts_closed, disconnected = [], None, 0, False
    try:
        oracle = check_oracle()
        (output / 'manifest.json').write_text(json.dumps({'argv': vars(args), 'oracle': oracle, 'source': before, 'scenarios': args.scenario or SCENARIOS, 'scope': 'Chromium fictional IndexedDB/virtual fetch only'}, indent=2), encoding='utf-8')
        (output / 'source-before.json').write_text(json.dumps(before, indent=2), encoding='utf-8')
        emit({'stage': 'source-locked', 'sha256': before['sha256'], 'files': len(before['files']), 'oracle': oracle,
              'output': str(output)})
        if args.frozen_source:
            assert before['sha256'] == args.frozen_source, 'Current sources differ from coordinated approved freeze'
        async with local_vite(output) as origin, async_playwright() as runtime:
            port = urlsplit(origin).port
            browser = await runtime.chromium.launch(headless=True)
            browser_version = browser.version
            try:
                for scenario in args.scenario or SCENARIOS:
                    emit({'scenario': scenario, 'stage': 'start'})
                    context = await browser.new_context(service_workers='block', accept_downloads=False)
                    blocked, errors, downloads = [], [], []
                    async def local_only(route):
                        parsed = urlsplit(route.request.url)
                        forbidden = ('/api/', '/models/', '/model/', '/download/', '/weights/')
                        if parsed.hostname == '127.0.0.1' and parsed.port == port and not parsed.path.startswith(forbidden):
                            await route.continue_()
                        else:
                            blocked.append(route.request.url)
                            await route.abort()
                    async def socket_only(route):
                        blocked.append(route.url)
                        await route.close()
                    await context.route('**/*', local_only)
                    await context.route_web_socket('**/*', socket_only)
                    try:
                        page = await context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        page.on('download', lambda download: downloads.append(download.suggested_filename))
                        path = quote((ROOT / 'tests/fixtures/sync-incoming.html').as_posix(), safe='/:')
                        url = origin + '/@fs/' + path + '?scenario=' + scenario
                        for resumed in ([False, True] if scenario == 'reload-orphan' else [False]):
                            case = scenario + ('-resumed' if resumed else '')
                            await page.goto(url + ('&resume=1' if resumed else ''))
                            await page.wait_for_function('window.__SYNC_INCOMING__ !== undefined', timeout=120000)
                            result = await page.evaluate('window.__SYNC_INCOMING__')
                            if scenario.startswith('lock-') and not resumed and result.get('paused'):
                                try:
                                    result = await lock_peer(context, page, url, scenario, result)
                                except Exception as error:
                                    result.update(ok=False, lock_error=str(error))
                            result.update(blocked_network_requests=blocked.copy(), page_errors=errors.copy(), downloads=downloads.copy())
                            case_dir = output / case
                            case_dir.mkdir(exist_ok=True)
                            (case_dir / 'browser-result.json').write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
                            for key in ('physical_before_json', 'physical_after_json', 'physical_staged_json', 'transport_json', 'oracle_inputs_json'):
                                if key in result:
                                    (case_dir / key.replace('_json', '.json')).write_text(result.pop(key), encoding='utf-8')
                            evidences = result.pop('evidences', [])
                            transport = json.loads((case_dir / 'transport.json').read_text(encoding='utf-8')) if (case_dir / 'transport.json').exists() else []
                            for index, evidence in enumerate(evidences):
                                try:
                                    destination = case_dir / ('entity-' + str(index))
                                    accepted = evidence
                                    if scenario == 'delete-then-incoming' and evidence['header']['id'] == 'source' and evidence.get('phase') != 'deletion-scrub':
                                        old_expected = json.loads(evidence['expected_json'])
                                        assert old_expected['revision'] == 2 and evidence['header']['revision'] == 3
                                        adjusted = {**old_expected, 'revision': 3}
                                        accepted = {**evidence, 'expected_json': json.dumps(adjusted, ensure_ascii=False)}
                                    result.setdefault('decoded', []).append(decode_evidence(accepted, destination))
                                    if accepted is not evidence:
                                        (destination / 'expected-intentional-revision.json').write_text(accepted['expected_json'], encoding='utf-8')
                                        (destination / 'old-expected.json').write_text(evidence['expected_json'], encoding='utf-8')
                                        result['decoded'][-1]['intentional_revision_difference'] = result['intentional_revision_difference']
                                except Exception as error:
                                    result.update(ok=False, python_error=str(error))
                                    (case_dir / ('failed-evidence-' + str(index) + '.json')).write_text(json.dumps(evidence, ensure_ascii=False), encoding='utf-8')
                            if evidences and result['ok'] and not result.get('paused') and not result.get('rejected') and result['scenario'] != 'cached-header':
                                try:
                                    result['body_hashes'] = body_hashes(transport, evidences, case_dir)
                                except Exception as error:
                                    result.update(ok=False, body_hash_error=str(error))
                            results.append(result); emit(result)
                    except Exception as error:
                        result = {'ok': False, 'scenario': scenario, 'exception': str(error), 'blocked_network_requests': blocked.copy(), 'page_errors': errors.copy()}
                        results.append(result); emit(result)
                    finally:
                        await context.close(); contexts_closed += 1
            finally:
                await browser.close()
                disconnected = not browser.is_connected()
    except Exception as error:
        emit({'stage': 'fatal', 'error': str(error)})
        raise
    finally:
        after = fingerprint()
        (output / 'source-after.json').write_text(json.dumps(after, indent=2), encoding='utf-8')
        changed = sorted(p for p in before['files'].keys() | after['files'].keys() if before['files'].get(p) != after['files'].get(p))
        passed = sum(bool(r['ok'] and not r.get('blocked_network_requests') and not r.get('page_errors') and not r.get('downloads')) for r in results)
        report = {'baseline': 'f9c8d2c', 'expected_cases': len(args.scenario or SCENARIOS) + ('reload-orphan' in (args.scenario or SCENARIOS)), 'browser': browser_version, 'passed': passed, 'total': len(results),
                  'source_before_sha256': before['sha256'], 'source_after_sha256': after['sha256'],
                  'critical_source_sha256': {p: {'before': before['files'].get(p), 'after': after['files'].get(p)} for p in CRITICAL_SOURCES},
                  'changed_sources': changed, 'contexts_closed': contexts_closed,
                  'owned_browser_disconnected': disconnected, 'owned_vite_stopped': browser_version is not None, 'acceptance': 'exploratory' if args.accept_current_source or changed else 'source-frozen-browser', 'results': results}
        (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        emit({k: v for k, v in report.items() if k != 'results'}); stdout.close()
    assert not changed, 'Sources changed during run; exploratory evidence only, not immutable acceptance'
    assert len(results) == len(args.scenario or SCENARIOS) + ('reload-orphan' in (args.scenario or SCENARIOS))
    assert passed == len(results), 'Real browser assertions failed; inspect preserved stdout.jsonl and result.json'
    assert disconnected and contexts_closed == len(args.scenario or SCENARIOS)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario', action='append', choices=SCENARIOS)
    freeze = parser.add_mutually_exclusive_group()
    freeze.add_argument('--accept-current-source', action='store_true')
    freeze.add_argument('--frozen-source')
    parser.add_argument('--output', help='New artifact directory; existing results are never overwritten')
    parser.add_argument('--print-source-hash', action='store_true')
    parser.add_argument('--check-oracle', action='store_true')
    args = parser.parse_args()
    if args.check_oracle:
        print(json.dumps(check_oracle(), ensure_ascii=True))
    elif args.print_source_hash:
        print(fingerprint()['sha256'])
    else:
        if not args.accept_current_source and not args.frozen_source:
            parser.error('Choose --accept-current-source or --frozen-source SHA256')
        asyncio.run(main(args))
