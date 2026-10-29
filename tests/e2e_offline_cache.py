"""Real IndexedDB cache eviction, races and atomic failure with disposable data."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/offline-cache-browser'


async def main():
    results = []
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            try:
                for scenario in ('normal', 'race', 'quota', 'account', 'scan-account'):
                    context = await browser.new_context()
                    external, errors = [], []

                    async def local_only(route):
                        parsed = urlsplit(route.request.url)
                        if parsed.netloc == urlsplit(origin).netloc and not parsed.path.startswith('/api/'):
                            await route.continue_()
                        else:
                            external.append(parsed.path)
                            await route.abort()

                    await context.route('**/*', local_only)
                    try:
                        page = await context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        url = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/offline-cache.html').as_posix(), safe='/:')
                        await page.goto(url + '?scenario=' + scenario)
                        await page.wait_for_function('window.__CACHE_RESULT__ !== undefined', timeout=60000)
                        result = await page.evaluate('window.__CACHE_RESULT__')
                        results.append(result)
                        assert result['ok'], result
                        if scenario == 'normal':
                            await page.close()
                            page = await context.new_page()
                            await page.goto(url + '?scenario=reload')
                            await page.wait_for_function('window.__CACHE_RESULT__ !== undefined')
                            restarted = await page.evaluate('window.__CACHE_RESULT__')
                            results.append(restarted)
                            assert restarted['ok'], restarted
                        assert not external and not errors, (external, errors)
                    finally:
                        await context.close()
            finally:
                await browser.close()
    finally:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__':
    asyncio.run(main())
