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
            adapters = []
            for language,width in [('ja',393),('en',1280)]:
                adapter = await browser.new_context(viewport={'width':width,'height':852},service_workers='block')
                try:
                    await adapter.route('**/*',guard)
                    await adapter.route_web_socket('**/*',lambda socket:socket.close())
                    ui = await adapter.new_page()
                    ui.on('pageerror',lambda error:errors.append(str(error)))
                    await ui.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-memory-scopes.html').as_posix(),safe='/:'))
                    await ui.wait_for_function('window.__DEVICE_MEMORY_SCOPES__ !== undefined')
                    await ui.evaluate('(lang)=>window.__DEVICE_MEMORY_SCOPES__.setupAdapter(lang)',language)
                    await ui.locator('.k-memory__content').filter(has_text='猫を三匹飼っている').wait_for()
                    await ui.get_by_text('Change world separation and sharing scope' if language=='en' else '世界ごとの分離・共有範囲を変更',exact=True).click()
                    await ui.get_by_role('button',name='Preview migration' if language=='en' else '移行内容を確認',exact=True).click()
                    await ui.get_by_role('button',name='Copy to this world and settings revision' if language=='en' else 'この世界・設定版の範囲へ移行',exact=True).click()
                    await ui.locator('.k-memory__content').filter(has_text='鮭のお寿司が好き').wait_for()
                    current = await ui.evaluate('window.__DEVICE_MEMORY_SCOPES__.runAdapter()')
                    await ui.locator('.k-memory__content').filter(has_text='猫を三匹飼っている').wait_for()
                    await ui.screenshot(path=str(OUTPUT/f'adapter-{language}.png'),full_page=True)
                    await ui.reload()
                    await ui.wait_for_function('window.__DEVICE_MEMORY_SCOPES__ !== undefined')
                    current.update(await ui.evaluate('window.__DEVICE_MEMORY_SCOPES__.resumeAdapter()'))
                    current.update(language=language,width=width)
                    adapters.append(current)
                finally:
                    await adapter.close()
            result['common_ui_adapters'] = adapters
            assert not blocked and not errors, (blocked, errors)
        finally:
            await context.close()
            await browser.close()
    result.update({'blocked_external_or_api_network_requests': blocked, 'page_errors': errors,
                   'vite_stopped': True, 'production_used': False,
                   'limits': ['Fictional inference Worker; no physical device or real model', 'No large-domain decoded RAM acceptance']})
    (OUTPUT / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'report': str(OUTPUT / 'result.json')}))


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), 120))
