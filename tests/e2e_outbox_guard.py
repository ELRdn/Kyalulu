"""Real IndexedDB upgrade/key-cursor checks with fake data in fresh browser contexts."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/outbox-guard-browser'


async def main():
    results = []
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            port = urlsplit(origin).port
            browser = await runtime.chromium.launch(headless=True)
            try:
                for scenario in ('legacy', 'fresh', 'withdrawal', 'replacement', 'account', 'hash-account'):
                    context = await browser.new_context()
                    blocked = []
                    async def local_only(route):
                        parsed = urlsplit(route.request.url)
                        if parsed.hostname == '127.0.0.1' and parsed.port == port and not parsed.path.startswith('/api/'):
                            await route.continue_()
                        else:
                            blocked.append(parsed.path)
                            await route.abort()
                    await context.route('**/*', local_only)
                    try:
                        page = await context.new_page()
                        await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/outbox-guard.html').as_posix(), safe='/:') + '?scenario=' + scenario)
                        await page.wait_for_function('window.__OUTBOX_RESULT__ !== undefined', timeout=60000)
                        result = await page.evaluate('window.__OUTBOX_RESULT__')
                        result['blocked_network_requests'] = len(blocked)
                        results.append(result)
                        assert result['ok'], result
                        assert not blocked, 'Fixture attempted a real API or external request'
                    finally: await context.close()
            finally: await browser.close()
    finally:
        (OUTPUT / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}, ensure_ascii=False))


if __name__ == '__main__': asyncio.run(main())
