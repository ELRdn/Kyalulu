"""Disposable Chromium/IndexedDB acceptance for selective sync record reads."""
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ('receive', 'missing', 'mismatch', 'protections', 'ack', 'owner-switch',
             'outgoing', 'outgoing-delete', 'outgoing-references', 'outgoing-fences')


async def main():
    results = []
    with TemporaryDirectory(prefix='kyalulu-sync-selection-') as directory:
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
                        path = quote((ROOT / 'tests/fixtures/sync-selection.html').as_posix(), safe='/:')
                        await page.goto(origin + '/@fs/' + path + '?scenario=' + scenario)
                        await page.wait_for_function('window.__SYNC_SELECTION__ !== undefined', timeout=60000)
                        result = await page.evaluate('window.__SYNC_SELECTION__')
                        result.update(blocked_network_requests=len(blocked), page_errors=errors)
                        results.append(result)
                    finally:
                        await context.close()
            finally:
                await browser.close()
    print(json.dumps({'passed': sum(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results),
                      'browser': browser.version, 'results': results}, ensure_ascii=False, indent=2))
    assert len(results) == len(SCENARIOS)
    assert all(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results), results


if __name__ == '__main__':
    asyncio.run(main())
