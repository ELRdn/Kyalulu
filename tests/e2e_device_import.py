"""Real browser decoder, binary import, persistent ownership and media UI evidence."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-import-browser'


async def main():
    results, blocked, errors = [], [], []
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            try:
                context = await browser.new_context()
                async def local_only(route):
                    parsed = urlsplit(route.request.url)
                    if parsed.scheme == 'blob' or parsed.hostname == '127.0.0.1' and parsed.port == urlsplit(origin).port and not parsed.path.startswith('/api/'):
                        await route.continue_()
                    else:
                        blocked.append(parsed.path)
                        await route.abort()
                await context.route('**/*', local_only)
                page = await context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-import.html').as_posix(), safe='/:'))
                for phase in ('setup', 'reload'):
                    if phase == 'reload': await page.reload()
                    await page.wait_for_function('window.__IMPORT_RESULT__ !== undefined', timeout=45000)
                    result = await page.evaluate('window.__IMPORT_RESULT__')
                    results.append(result)
                    assert result['ok'] and result['phase'] == phase, result
                    assert not blocked and not errors, {'blocked': blocked, 'pageerrors': errors}
                await context.close()
            finally: await browser.close()
    finally:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'blocked': blocked, 'pageerrors': errors}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__': asyncio.run(main())
