"""Actual JA/EN memory controls, dialog cancellation and device IndexedDB edits."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit
from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/memory-language-browser'


async def main():
    results, blocked, errors = [], [], []
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        try:
            for language, width, theme in [('ja', 393, 'light'), ('en', 393, 'light'), ('en', 1280, 'dark')]:
                context = await browser.new_context(viewport={'width': width, 'height': 852})
                try:
                    async def route(request):
                        url = urlsplit(request.request.url)
                        if url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port or url.path.startswith('/api/'):
                            blocked.append(url.path); await request.abort()
                        else:
                            await request.continue_()
                    await context.route('**/*', route)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/memory-language.html').as_posix(), safe='/:'))
                    await page.wait_for_function('window.__MEMORY_LANGUAGE__ !== undefined')
                    await page.evaluate('([language,theme])=>window.__MEMORY_LANGUAGE__.mount(document.getElementById("root"),language,theme).then(fn=>{window.__unmount=fn})', [language, theme])
                    en = language == 'en'
                    await page.get_by_role('switch', name='Remember conversations' if en else '会話を覚える').wait_for()
                    erase = page.get_by_role('button', name='Erase memories in this scope' if en else 'この範囲の記憶を消去', exact=True)
                    await erase.click()
                    dialog = page.get_by_role('dialog')
                    assert ('cannot be undone' if en else '元に戻せません') in await dialog.inner_text()
                    await dialog.get_by_role('button', name='Cancel' if en else 'キャンセル', exact=True).click()
                    assert len((await page.evaluate('window.__MEMORY_LANGUAGE__.saved()'))['payload']['memories']) == 1
                    await page.get_by_role('button', name='Add a memory' if en else '覚えてほしいことを追加', exact=True).click()
                    field = page.get_by_role('textbox', name='What to remember' if en else '覚えてほしいこと', exact=True)
                    await field.fill('辛いものが苦手です')
                    await page.get_by_role('button', name='Remember this' if en else '覚えてもらう', exact=True).click()
                    await page.get_by_text('辛いものが苦手です', exact=True).wait_for()
                    await page.get_by_text('Review and correct conversation summaries' if en else '会話の要約を確認・訂正', exact=True).click()
                    await page.locator('article').get_by_role('button', name='Correct' if en else '訂正', exact=True).click()
                    await page.get_by_role('textbox', name='Correct summary' if en else '要約を訂正', exact=True).fill('Corrected fixture summary')
                    await page.get_by_role('button', name='Save correction' if en else '訂正を保存', exact=True).click()
                    await page.locator('article').get_by_role('button', name='Correct' if en else '訂正', exact=True).wait_for()
                    await page.get_by_text('Corrected fixture summary', exact=True).wait_for()
                    stored = await page.evaluate('window.__MEMORY_LANGUAGE__.saved()')
                    assert stored['payload']['summaries'][0]['revision'] == 2
                    assert len(stored['payload']['memories']) == 2
                    if en:
                        assert 'Corrected manually' in await page.locator('main').inner_text()
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
                    await page.screenshot(path=str(OUTPUT / f'{language}-{width}-{theme}.png'), full_page=True)
                    results.append({'language': language, 'width': width, 'theme': theme, 'canceled_erasure_kept_memories': True, 'device_edits_saved': True, 'overflow': False})
                finally:
                    await context.close()
        finally:
            await browser.close()
    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
    (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'blocked_requests': blocked, 'page_errors': errors}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__':
    asyncio.run(main())
