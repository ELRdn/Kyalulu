"""Disposable Chromium/IndexedDB acceptance for segmented persistence."""
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ('roundtrip', 'depth-boundary', 'corrupt-missing', 'corrupt-hash', 'corrupt-size', 'owner-fence', 'kind-selection', 'kind-selection-owner', 'summary-read', 'summary-corrupt', 'summary-owner', 'page-read', 'page-cursor', 'page-owner', 'page-corrupt-json', 'page-corrupt-first', 'page-corrupt-last', 'quota', 'collisions', 'upgrade-v1', 'upgrade-v2', 'blocked', 'late-success', 'versionchange', 'receive-quota', 'receive-generation', 'ack-quota', 'deletion-controls', 'migration', 'device-branch', 'pin-ui', 'outbox-corrupt')


async def main():
    results = []
    with TemporaryDirectory(prefix='kyalulu-segmented-') as directory:
        async with local_vite(Path(directory)) as origin, async_playwright() as runtime:
            port = urlsplit(origin).port
            browser = await runtime.chromium.launch(headless=True)
            try:
                for scenario in SCENARIOS:
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
                        path = quote((ROOT / 'tests/fixtures/segmented-storage.html').as_posix(), safe='/:')
                        await page.goto(origin + '/@fs/' + path + '?scenario=' + scenario)
                        await page.wait_for_function('window.__SEGMENTED__ !== undefined', timeout=60000)
                        result = await page.evaluate('window.__SEGMENTED__')
                        result.update(blocked_network_requests=len(blocked), page_errors=errors)
                        results.append(result)
                    finally:
                        await context.close()
            finally:
                await browser.close()
    output=ROOT / '.artifacts/segmented-storage-browser'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': sum(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results),
                      'browser': browser.version, 'results': results}, ensure_ascii=False, indent=2))
    assert len(results) == len(SCENARIOS)
    assert all(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results), results


if __name__ == '__main__':
    asyncio.run(main())
