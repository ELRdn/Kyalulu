"""Actual IndexedDB scope storage/erasure transactions; no inference/provider calls."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-memory-scopes-browser'


async def main():
    blocked, errors = [], []
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        context = await browser.new_context()
        try:
            async def guard(route):
                url = urlsplit(route.request.url)
                if url.hostname == '127.0.0.1' and url.port == urlsplit(origin).port and not url.path.startswith('/api/'):
                    await route.continue_()
                else:
                    blocked.append(url.path)
                    await route.abort()
            await context.route('**/*', guard)
            await context.route_web_socket('**/*', lambda socket: socket.close())
            page = await context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-memory-scopes.html').as_posix(), safe='/:'))
            await page.wait_for_function('window.__DEVICE_MEMORY_SCOPES__ !== undefined')
            result = await page.evaluate('window.__DEVICE_MEMORY_SCOPES__.run()')
            await page.reload()
            await page.wait_for_function('window.__DEVICE_MEMORY_SCOPES__ !== undefined')
            result.update(await page.evaluate('window.__DEVICE_MEMORY_SCOPES__.resume()'))
            assert not blocked and not errors, (blocked, errors)
        finally:
            await context.close()
            await browser.close()
    result.update({'blocked_external_or_api_network_requests': blocked, 'page_errors': errors,
                   'vite_stopped': True, 'production_used': False,
                   'limits': ['Core domain fixture; chat/migration API integration is separate', 'No physical device or real model']})
    (OUTPUT / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'report': str(OUTPUT / 'result.json')}))


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), 120))
