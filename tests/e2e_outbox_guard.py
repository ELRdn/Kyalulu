"""Real IndexedDB upgrade/key-cursor checks with fake data in fresh browser contexts."""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
from urllib.parse import quote, urlsplit

import httpx
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/outbox-guard-browser'


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with socket.socket() as available:
        available.bind(('127.0.0.1', 0))
        port = available.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    log = (OUTPUT / 'vite.log').open('wb')
    server = subprocess.Popen(['node', str(ROOT / 'apps/web/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', str(port), '--strictPort'],
        cwd=ROOT / 'apps/web', stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    results = []
    try:
        async with httpx.AsyncClient(trust_env=False, timeout=1) as check:
            for _ in range(100):
                if server.poll() is not None: raise AssertionError('Fixture Vite stopped; inspect .artifacts/outbox-guard-browser/vite.log')
                try:
                    if (await check.get(origin)).status_code == 200: break
                except httpx.HTTPError: pass
                await asyncio.sleep(.1)
            else: raise AssertionError('Fixture Vite did not start')
        async with async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            try:
                for scenario in ('legacy', 'fresh', 'withdrawal', 'replacement', 'account'):
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
        if server.poll() is None:
            server.terminate()
            try: await asyncio.to_thread(server.wait, 10)
            except subprocess.TimeoutExpired:
                server.kill()
                await asyncio.to_thread(server.wait)
        log.close()
        (OUTPUT / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}, ensure_ascii=False))


if __name__ == '__main__': asyncio.run(main())
