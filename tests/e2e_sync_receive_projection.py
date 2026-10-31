"""Real Chromium receive projection acceptance; checksum-frozen old full receiver oracle."""
import argparse
import asyncio
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite
from e2e_sync_staging import check_oracle as check_receiver_oracle

ROOT = Path(__file__).resolve().parents[1]
ORACLE_SHA256 = '6cc86c59cf156957702ed473d18994861baa5b10d46f607c9a5c5fea9164cf45'
OLD_ACK_SHA256 = 'f5114e8e366e0e3c264b56b50fd35151c41ffd841800325c5236aee535ed394b'
OLD_RECEIVER_SHA256 = 'd5bbdcb2f055ee8d19b0b2b2f4ed3c06c8ace99bcbb886a8493d291add8f4c88'
CRITICAL_SOURCES = (
    'apps/web/src/lib/appSync.ts', 'apps/web/src/lib/appSyncBranch.ts', 'apps/web/src/lib/appStore.ts',
    'apps/web/src/lib/segmentedStorage.ts', 'apps/web/src/lib/jsonStream.ts', 'apps/web/src/lib/appSyncStage.ts',
    'apps/web/src/lib/appSyncData.ts', 'apps/web/src/lib/appOutbox.ts', 'apps/web/src/lib/appTransfers.ts',
    'tests/e2e_sync_receive_projection.py', 'tests/fixtures/sync-receive-projection.html',
    'tests/fixtures/sync-branch-ack-oracle.ts', 'tests/fixtures/sync-staging-oracle.ts',
)
SCENARIOS = (
    'receive', 'two-sources', 'messages-first', 'inline', 'nonconversation', 'required-snapshot',
    'dirty', 'same-revision', 'delete-recovery', 'delete-after-skip', 'delete-after-update',
    'corrupt-last', 'missing-last', 'bad-json', 'bad-utf8', 'missing-required', 'conflicting-required',
    'quota', 'owner-body', 'busy-body', 'skip-cached', 'skip-corrupt', 'owner-header', 'busy-header', 'reload',
)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def check_oracle():
    """No Git/history dependency: pin the adapter, old receiver and schema inputs."""
    check_receiver_oracle()
    adapter = (ROOT / 'tests/fixtures/sync-branch-ack-oracle.ts').read_text(encoding='utf-8')
    assert digest(adapter.encode()) == ORACLE_SHA256, 'Frozen branch ACK/event oracle modified'
    ack = adapter.split('// BEGIN OLD ACK\n', 1)[1].split('// END OLD ACK', 1)[0]
    assert digest(ack.encode()) == OLD_ACK_SHA256, 'Old acknowledgeEntity differs from f9c8d2c'
    receiver = (ROOT / 'tests/fixtures/sync-staging-oracle.ts').read_text(encoding='utf-8')
    receiver = receiver.split('\n', 1)[1].split('export function conversationSettings(', 1)[0]
    receiver = receiver.replace("'../../packages/schemas/src/index.ts'", "'../../../../packages/schemas/src'")
    receiver = receiver.replace('type AppEntity=any;', "import type { AppEntity } from './appStore';")
    assert digest(receiver.encode()) == OLD_RECEIVER_SHA256, 'Old receiver/binder differs from f9c8d2c'
    return {'branch_adapter': ORACLE_SHA256, 'f9_acknowledge_entity': OLD_ACK_SHA256,
            'f9_receiver_binder_prefix': OLD_RECEIVER_SHA256}


def fingerprint():
    paths = set()
    for folder in ('apps/web/src', 'packages/schemas/src', 'packages/ui/src'):
        paths.update(p for p in (ROOT / folder).rglob('*') if p.is_file())
    paths.update(ROOT / name for name in (
        'apps/web/vite.config.ts', 'pnpm-lock.yaml', 'tests/browser_fixture_server.py',
        'tests/e2e_sync_staging.py', 'tests/e2e_sync_branch_ack.py', 'tests/e2e_sync_receive_projection.py',
        'tests/fixtures/sync-staging-oracle.ts', 'tests/fixtures/sync-branch-ack-oracle.ts',
        'tests/fixtures/sync-receive-projection.html', 'tests/fixtures/unified-history.json',
    ))
    files = {p.relative_to(ROOT).as_posix(): digest(p.read_bytes()) for p in sorted(paths)}
    return {'sha256': digest(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()), 'files': files}


def memory_rows(payload):
    yield from payload.get('memories', [])
    for message in payload.get('messages', []):
        for name in ('before', 'after'):
            yield from (message.get(name) or {}).get('memories', [])


def normalize_fresh(target, events, retained):
    target, events = json.loads(json.dumps([target, events], ensure_ascii=False))
    mapping, stable = {}, {}
    for memory in memory_rows(target['payload']):
        identifier, uuid = memory['id'], memory['uuid']
        assert identifier not in mapping or mapping[identifier] == uuid, 'Memory UUID alias'
        assert uuid not in stable or stable[uuid] == identifier, 'Inconsistent memory allocation'
        mapping[identifier], stable[uuid] = uuid, identifier
    fresh = {identifier: 'allocated:' + uuid for identifier, uuid in mapping.items() if identifier not in retained}
    for identifier in fresh:
        import uuid
        uuid.UUID(identifier)  # Only newly allocated memory UUID IDs may vary.
    for memory in memory_rows(target['payload']):
        memory['id'] = fresh.get(memory['id'], memory['id'])
    for event in events:
        event['memory_id'] = fresh.get(event.get('memory_id'), event.get('memory_id'))
        for candidate in (event.get('detail') or {}).get('candidates', []):
            candidate['id'] = fresh.get(candidate.get('id'), candidate.get('id'))
    return {'target': target, 'events': events}


def decode_evidence(evidence, output):
    header = evidence['header']
    expected = json.loads(evidence['expected_json'])
    actual_events = json.loads(evidence['actual_events_json'])
    expected_events = json.loads(evidence['expected_events_json'])
    ref = header.get('payloadParts')
    if ref:
        parts = sorted(evidence['parts'], key=lambda p: p['key'][4])
        assert [p['key'][4] for p in parts] == list(range(ref['chunks']))
        for part in parts:
            assert part['key'][:4] == [header['owner'], 'entity', header['id'], ref['token']]
        raw = b''.join(base64.b64decode(p['data'], validate=True) for p in parts)
        assert len(raw) == ref['size'] and digest(raw) == ref['sha256'], 'IDB SHA/size mismatch'
        payload = json.loads(raw.decode('utf-8', errors='strict'))
    else:
        payload = json.loads(evidence['inline_json'])
        raw = json.dumps(payload, ensure_ascii=False).encode()
    actual = {k: v for k, v in header.items() if k not in ('payloadParts', 'selection', 'memoryReferences', 'payload')}
    actual['payload'] = payload
    output.mkdir(parents=True, exist_ok=False)
    (output / 'actual-payload.json').write_bytes(raw)
    for name, value in (('header', header), ('old-expected', expected), ('actual-events', actual_events), ('old-expected-events', expected_events)):
        (output / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    retained = evidence['retained_memory_ids']
    assert normalize_fresh(actual, actual_events, retained) == normalize_fresh(expected, expected_events, retained), 'Full payload/events differ from frozen old receiver'
    return {'python_independent_decode': True, 'python_full_old_oracle': True, 'actual_payload_bytes': len(raw),
            'actual_payload_sha256': digest(raw), 'idb_chunks': len(evidence['parts'])}


async def main(args):
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = Path(args.output) if args.output else ROOT / '.artifacts/sync-receive-projection-browser' / timestamp
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
                        path = quote((ROOT / 'tests/fixtures/sync-receive-projection.html').as_posix(), safe='/:')
                        url = origin + '/@fs/' + path + '?scenario=' + scenario
                        for resumed in ([False, True] if scenario == 'reload' else [False]):
                            case = scenario + ('-resumed' if resumed else '')
                            await page.goto(url + ('&resume=1' if resumed else ''))
                            await page.wait_for_function('window.__SYNC_RECEIVE_PROJECTION__ !== undefined', timeout=120000)
                            result = await page.evaluate('window.__SYNC_RECEIVE_PROJECTION__')
                            result.update(blocked_network_requests=blocked.copy(), page_errors=errors.copy(), downloads=downloads.copy())
                            case_dir = output / case
                            case_dir.mkdir(exist_ok=True)
                            for key in ('physical_before_json', 'physical_after_json'):
                                if key in result:
                                    (case_dir / key.replace('_json', '.json')).write_text(result.pop(key), encoding='utf-8')
                            evidences = result.pop('evidences', [])
                            for index, evidence in enumerate(evidences):
                                try:
                                    result.setdefault('decoded', []).append(decode_evidence(evidence, case_dir / ('entity-' + str(index))))
                                except Exception as error:
                                    result.update(ok=False, python_error=str(error))
                                    (case_dir / ('failed-evidence-' + str(index) + '.json')).write_text(json.dumps(evidence, ensure_ascii=False), encoding='utf-8')
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
        report = {'baseline': 'f9c8d2c', 'browser': browser_version, 'passed': passed, 'total': len(results),
                  'source_before_sha256': before['sha256'], 'source_after_sha256': after['sha256'],
                  'critical_source_sha256': {p: {'before': before['files'].get(p), 'after': after['files'].get(p)} for p in CRITICAL_SOURCES},
                  'changed_sources': changed, 'contexts_closed': contexts_closed,
                  'owned_browser_disconnected': disconnected, 'owned_vite_stopped': browser_version is not None, 'results': results}
        (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        emit({k: v for k, v in report.items() if k != 'results'}); stdout.close()
    assert not changed, 'Sources changed during run; exploratory evidence only, not immutable acceptance'
    assert len(results) == len(args.scenario or SCENARIOS) + ('reload' in (args.scenario or SCENARIOS))
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
        print(json.dumps(check_oracle()))
    elif args.print_source_hash:
        print(fingerprint()['sha256'])
    else:
        if not args.accept_current_source and not args.frozen_source:
            parser.error('Choose --accept-current-source or --frozen-source SHA256')
        asyncio.run(main(args))
