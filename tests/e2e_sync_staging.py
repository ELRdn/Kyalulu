"""Real Chromium/IDB initial staging; baseline oracle and output decoding are independent."""
import argparse
import asyncio
import base64
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
BASELINE_HELPER_SHA256 = '8a1e01c6a6c6731ff35eee201695fa1190a1cb1e78779a0f0703438240916528'
FROZEN_ORACLE_SHA256 = '8d02a0834b4e35abd1b1d79eb258c372b6407e23b2c59e66b33211e37f0c5868'
BASELINE_SCHEMA_SHA256 = {
    'capabilities.ts': '1480c1050c57d79f1cf381f9df1e9134cc0ad043ffc24d67505d364dc21f9b9a',
    'community.ts': 'eb13e86212932c9815246b82d9784a129f1d33bd6615563178b8a2b7494ce8fc',
    'hub.ts': 'f099338016d2f5533b3b39967cfc68f4da29ec12a01124fe6a6d2a13e0380b1c',
    'index.ts': '02fd2b5447aab7c2e5c5dafc5b0df3c117857ee381112ecd6ab699da7c656f09',
    'portable.ts': '7eed8d943ab4863ea168a019b884ac68e1b7c695e51c5ffdfdb3b4d15dc1e4dd',
    'publications.ts': '38021a20e5e809492b2d79f7f09b4965d5d5c6bd978255c065a64180ccd2af83',
    'story.ts': 'cb1e1297cb7911ce0b0de7fee73c4e2e8d8b1cd9b34574f3b5ce2ec9a729bac5',
}
SCENARIOS = (
    'initial', 'historical-fallback', 'legacy', 'mixed', 'nonconversation',
    'selection50', 'deletion-confirmed', 'deletion-unconfirmed',
    'missing-library', 'missing-creator', 'corrupt-last', 'missing-last',
    'invalid-json', 'invalid-utf8', 'second-pass-corrupt',
    'owner-readonly', 'owner-readwrite', 'busy-readonly', 'busy-readwrite',
    'revision-change', 'token-change', 'consent-change', 'quota',
    'owner-after-stage', 'busy-after-stage', 'consent-after-stage',
    'existing-outbox', 'existing-winner', 'reload',
)


def fingerprints():
    files = set()
    for directory in ('apps/web/src', 'packages/schemas/src'):
        files.update(path for path in (ROOT / directory).rglob('*') if path.is_file())
    files.update(ROOT / name for name in (
        'apps/web/vite.config.ts', 'tests/browser_fixture_server.py',
        'tests/e2e_sync_staging.py', 'tests/fixtures/sync-staging.html',
        'tests/fixtures/sync-staging-oracle.ts', 'tests/fixtures/unified-history.json',
    ))
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(files) if path.is_file()}


def fingerprint_hash(values):
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def check_oracle():
    frozen = (ROOT / 'tests/fixtures/sync-staging-oracle.ts').read_text(encoding='utf-8')
    assert hashlib.sha256(frozen.encode()).hexdigest() == FROZEN_ORACLE_SHA256, 'Frozen oracle/selection adapter integrity differs'
    baseline = frozen.split('\n', 1)[1].split('\n// Pure equivalent of baseline prepareSyncBatch', 1)[0]
    baseline = baseline.replace("'../../packages/schemas/src/index.ts'", "'../../../../packages/schemas/src'")
    baseline = baseline.replace('type AppEntity=any;', "import type { AppEntity } from './appStore';")
    assert hashlib.sha256(baseline.encode()).hexdigest() == BASELINE_HELPER_SHA256, 'Frozen old helper drifted from baseline 21ba2fa'
    for name, digest in BASELINE_SCHEMA_SHA256.items():
        raw = (ROOT / 'packages/schemas/src' / name).read_bytes().replace(b'\r\n', b'\n')
        assert hashlib.sha256(raw).hexdigest() == digest, f'Baseline oracle schema drift: {name}'
    return BASELINE_HELPER_SHA256


def decode_evidence(result):
    """stdlib JSON + hashlib decode actual IDB bytes, never the product JsonStream."""
    evidence = result.pop('evidence', None)
    if evidence is None:
        return
    ref = evidence['header']['changesParts']
    parts = evidence['parts']
    assert [part['key'][4] for part in parts] == list(range(ref['chunks']))
    raw = b''.join(base64.b64decode(part['data'], validate=True) for part in parts)
    expected = evidence['expected'].encode('utf-8')
    assert len(raw) == ref['size']
    assert hashlib.sha256(raw).hexdigest() == ref['sha256']
    assert json.loads(raw) == json.loads(expected), 'Python independent semantic mismatch'
    assert raw == expected, 'Python independent JSON.stringify bytes/order mismatch'
    result['python_independent_decode'] = True
    result['header_sha256'] = hashlib.sha256(json.dumps(evidence['header'], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


async def main(scenarios, frozen_source=None):
    oracle_hash = check_oracle()
    before = fingerprints()
    source_hash = fingerprint_hash(before)
    if frozen_source:
        assert source_hash == frozen_source, f'Source differs from approved freeze: {source_hash}'
    print(json.dumps({'stage': 'source-locked', 'sha256': source_hash, 'files': len(before)}), flush=True)
    results = []
    with TemporaryDirectory(prefix='kyalulu-initial-sync-') as directory:
        async with local_vite(Path(directory)) as origin, async_playwright() as runtime:
            port = urlsplit(origin).port
            browser = await runtime.chromium.launch(headless=True)
            version = browser.version
            try:
                for scenario in scenarios:
                    print(json.dumps({'scenario': scenario, 'stage': 'start'}), flush=True)
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

                    await context.route('**/*', local_only)

                    async def socket_only(route):
                        parsed = urlsplit(route.url)
                        if parsed.hostname == '127.0.0.1' and parsed.port == port:
                            await route.connect_to_server()
                        else:
                            blocked.append(route.url)
                            await route.close()

                    await context.route_web_socket('**/*', socket_only)
                    try:
                        page = await context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        page.on('download', lambda download: downloads.append(download.suggested_filename))
                        path = quote((ROOT / 'tests/fixtures/sync-staging.html').as_posix(), safe='/:')
                        url = origin + '/@fs/' + path + '?scenario=' + scenario
                        for resumed in ([False, True] if scenario == 'reload' else [False]):
                            await page.goto(url + ('&resume=1' if resumed else ''))
                            await page.wait_for_function('window.__SYNC_STAGING__ !== undefined', timeout=90000)
                            result = await page.evaluate('window.__SYNC_STAGING__')
                            decode_evidence(result)
                            result.update(blocked_network_requests=len(blocked), page_errors=list(errors), downloads=list(downloads))
                            results.append(result)
                            print(json.dumps(result, ensure_ascii=False), flush=True)
                    except Exception as error:
                        results.append({'ok': False, 'scenario': scenario, 'exception': str(error), 'blocked': blocked, 'page_errors': errors})
                        print(json.dumps(results[-1]), flush=True)
                    finally:
                        await context.close()
            finally:
                await browser.close()
    after = fingerprints()
    changed = sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))
    passed = sum(result['ok'] and not result.get('blocked_network_requests') and not result.get('page_errors')
                 and not result.get('downloads') for result in results)
    print(json.dumps({'browser': version, 'passed': passed, 'total': len(results), 'baseline': '21ba2fa',
                      'oracle_source_sha256': oracle_hash, 'fingerprinted_files': len(before),
                      'source_before_sha256': fingerprint_hash(before), 'source_after_sha256': fingerprint_hash(after),
                      'changed_sources': changed,
                      'critical_source_sha256': {name: before[name] for name in (
                          'apps/web/src/lib/appSyncStage.ts', 'apps/web/src/lib/appSync.ts',
                          'apps/web/src/lib/appSyncData.ts', 'apps/web/src/lib/segmentedStorage.ts',
                          'apps/web/src/lib/appStore.ts', 'apps/web/src/lib/appOutbox.ts',
                          'apps/web/src/lib/appTransfers.ts', 'apps/web/src/lib/jsonStream.ts',
                          'tests/e2e_sync_staging.py', 'tests/fixtures/sync-staging.html',
                          'tests/fixtures/sync-staging-oracle.ts',
                      )}}, ensure_ascii=False, indent=2), flush=True)
    assert not changed, f'Product/fixture sources changed during run; this is not immutable final proof: {changed}'
    assert len(results) == len(scenarios) + ('reload' in scenarios)
    assert passed == len(results), 'Real browser failures above; assertions were not weakened'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scenario', action='append', choices=SCENARIOS)
    source = parser.add_mutually_exclusive_group()
    source.add_argument('--accept-current-source', action='store_true', help='Lock current source for this run; require identical hashes after it.')
    source.add_argument('--frozen-source', help='Require this SHA256 aggregate before and after the run.')
    parser.add_argument('--print-source-hash', action='store_true', help='Print current aggregate without starting a browser.')
    args = parser.parse_args()
    if args.print_source_hash:
        print(fingerprint_hash(fingerprints()))
    else:
        if not args.accept_current_source and not args.frozen_source:
            parser.error('Choose --accept-current-source or --frozen-source SHA256')
        asyncio.run(main(args.scenario or SCENARIOS, args.frozen_source))
