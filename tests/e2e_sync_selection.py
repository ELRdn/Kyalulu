"""Disposable Chromium/IndexedDB acceptance for selective sync record reads."""
import asyncio
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ('receive', 'missing', 'mismatch', 'protections', 'ack', 'owner-switch',
             'outgoing', 'outgoing-delete', 'outgoing-references', 'outgoing-fences',
             'ack-normal', 'ack-lineage', 'ack-corrupt', 'ack-quota', 'ack-body-owner')


def fingerprint():
    paths = set()
    for folder in ('apps/web/src', 'packages/schemas/src', 'packages/ui/src'):
        paths.update(path for path in (ROOT / folder).rglob('*') if path.is_file())
    paths.update(ROOT / path for path in ('apps/web/vite.config.ts', 'pnpm-lock.yaml',
                                         'tests/e2e_sync_selection.py', 'tests/browser_fixture_server.py',
                                         'tests/fixtures/sync-selection.html', 'tests/fixtures/storage-fixture.ts',
                                         'tests/fixtures/unified-history.json'))
    rows = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}
    return {'sha256': hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest(), 'files': rows}


async def main():
    results, source_before, closed = [], fingerprint(), 0
    with TemporaryDirectory(prefix='kyalulu-sync-selection-') as directory:
        async with local_vite(Path(directory)) as origin, async_playwright() as runtime:
            port = urlsplit(origin).port
            browser = await runtime.chromium.launch(headless=True)
            try:
                for scenario in SCENARIOS:
                    print(json.dumps({'scenario': scenario, 'stage': 'start'}), flush=True)
                    context = await browser.new_context(service_workers='block')
                    blocked, errors = [], []

                    async def local_only(route):
                        parsed = urlsplit(route.request.url)
                        if parsed.hostname == '127.0.0.1' and parsed.port == port and not parsed.path.startswith('/api/'):
                            await route.continue_()
                        else:
                            blocked.append(route.request.url)
                            await route.abort()

                    await context.route('**/*', local_only)
                    try:
                        page = await context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        path = quote((ROOT / 'tests/fixtures/sync-selection.html').as_posix(), safe='/:')
                        await page.goto(origin + '/@fs/' + path + '?scenario=' + scenario)
                        await page.wait_for_function('window.__SYNC_SELECTION__ !== undefined', timeout=60000)
                        result = await page.evaluate('window.__SYNC_SELECTION__')
                        result.update(blocked_network_requests=len(blocked), page_errors=errors)
                        results.append(result)
                    finally:
                        await context.close()
                        closed += 1
            finally:
                await browser.close()
    source_after = fingerprint()
    report = {'passed': sum(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results),
              'browser': browser.version, 'results': results, 'source_before': source_before, 'source_after': source_after,
              'source_unchanged': source_before == source_after, 'owned_browser_disconnected': not browser.is_connected(),
              'contexts_closed': closed, 'owned_vite_stopped': True, 'temporary_fixture_directory_removed': not Path(directory).exists()}
    output = ROOT / '.artifacts/sync-selection-browser'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key not in {'source_before', 'source_after'}}, ensure_ascii=False, indent=2))
    assert len(results) == len(SCENARIOS)
    assert all(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results), results
    assert report['source_unchanged'], 'Sync sources changed during browser validation'
    assert report['owned_browser_disconnected'] and closed == len(SCENARIOS) and report['temporary_fixture_directory_removed']


if __name__ == '__main__':
    asyncio.run(main())
