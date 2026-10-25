"""Device Research through the real app/API/IDB, synthetic readiness and Worker only."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite
from python.core.schemas import ExperimentMeta

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-research-browser'


async def main():
    results, blocked, errors = [], [], []
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        try:
            for language, width, theme in [('ja', 393, 'light'), ('en', 1280, 'dark')]:
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
                    page.on('pageerror', lambda error: errors.append(error.stack or str(error)))
                    address = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-research.html').as_posix(), safe='/:') + '#/research'

                    async def mount():
                        await page.wait_for_function('window.__DEVICE_RESEARCH__ !== undefined')
                        await page.evaluate('([lang,theme])=>window.__DEVICE_RESEARCH__.mount(document.getElementById("root"),lang,theme)', [language, theme])
                        await page.get_by_role('button', name='▶ Run' if language == 'en' else '▶ 実行', exact=True).wait_for()

                    await page.goto(address); await mount()
                    en = language == 'en'
                    await page.evaluate('location.hash="/profile"')
                    await page.get_by_role('link', name='On-device research and ratings' if en else '端末内の比較・評価', exact=True).click()
                    await page.get_by_role('button', name='▶ Run' if en else '▶ 実行', exact=True).wait_for()
                    await page.get_by_label('Scenario' if en else 'シナリオ', exact=True).select_option('mocha_memory_001')
                    await page.get_by_label('Model' if en else 'モデル', exact=True).select_option('kyalulu-iq3m')
                    await page.get_by_role('spinbutton').fill('1')
                    await page.get_by_role('checkbox', name='Memory' if en else '記憶', exact=True).check()
                    await page.get_by_role('button', name='▶ Run' if en else '▶ 実行', exact=True).click()
                    column = page.locator('.k-research-col').first
                    await column.get_by_role('textbox', name='Comment (optional)' if en else 'コメント（任意）', exact=True).first.wait_for()
                    saved = await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/experiments")')
                    assert saved['status'] == 200 and len(saved['data']['experiments']) == 1
                    experiment = saved['data']['experiments'][0]
                    assert experiment['status'] == 'completed' and experiment['memory_enabled']
                    assert not experiment['official']
                    await column.get_by_role('button', name='Rate 4 out of 5' if en else '5段階中4で評価', exact=True).first.click()
                    await column.get_by_role('textbox', name='Comment (optional)' if en else 'コメント（任意）', exact=True).first.fill('端末研究の評価')
                    await column.get_by_role('button', name='Save' if en else '保存', exact=True).first.click()
                    await page.wait_for_function('!Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Saving")||b.textContent.includes("保存中"))')
                    exported = await page.evaluate('id=>window.__DEVICE_RESEARCH__.api("/api/experiments/"+id+"/export")', experiment['experiment_id'])
                    assert exported['data']['ratings']['1']['score'] == 4 and len(exported['data']['turns']) == 8
                    assert 'session' not in exported['data'] and exported['data']['turns'][0]['compiled']
                    async with page.expect_download() as downloading:
                        await column.get_by_role('button', name='Export' if en else '書き出し', exact=True).click()
                    download = await downloading.value
                    assert download.suggested_filename == 'experiment.json'
                    destination = OUTPUT / f'{language}-experiment.json'
                    await download.save_as(destination)
                    downloaded = json.loads(destination.read_text(encoding='utf-8'))
                    assert ExperimentMeta.model_validate(downloaded['meta']).experiment_id == experiment['experiment_id']
                    assert downloaded['ratings']['1']['comment'] == '端末研究の評価'
                    assert (await page.evaluate('window.__DEVICE_RESEARCH__.state()'))['entities'] == []
                    await page.screenshot(path=str(OUTPUT / f'{language}-{width}-{theme}.png'), full_page=True)
                    # Device access to research grants no linked-PC model/diagnostic access.
                    await page.evaluate('location.hash="/studio"')
                    await page.get_by_role('heading', name='This feature requires PC management access' if en else 'サーバー側で管理する機能です', exact=True).wait_for()
                    await page.evaluate('location.hash="/research"')
                    await page.get_by_role('button', name='▶ Run' if en else '▶ 実行', exact=True).wait_for()
                    await page.evaluate('window.__DEVICE_RESEARCH__.owner("other-fixture")')
                    await page.get_by_text('No experiments yet. Use ▶ Run above to create one.' if en else 'まだ実験がありません。上の「▶ 実行」で作成してね。', exact=True).wait_for()
                    assert (await page.evaluate('id=>window.__DEVICE_RESEARCH__.api("/api/experiments/"+id)', experiment['experiment_id']))['status'] == 404
                    await page.evaluate('window.__DEVICE_RESEARCH__.owner("device-research-fixture")')
                    await page.get_by_text(experiment['experiment_id'], exact=True).first.wait_for()
                    # Persisted results survive a complete document reload.
                    await page.reload(); await mount()
                    restored = await page.evaluate('id=>window.__DEVICE_RESEARCH__.api("/api/experiments/"+id)', experiment['experiment_id'])
                    assert restored['data']['ratings']['1']['comment'] == '端末研究の評価'
                    # Stop uses the active request ID and retains a cancelled experiment.
                    await page.evaluate('window.__DEVICE_RESEARCH__.pause(true)')
                    await page.get_by_label('Scenario' if en else 'シナリオ', exact=True).select_option('mocha_memory_001')
                    await page.get_by_label('Model' if en else 'モデル', exact=True).select_option('kyalulu-iq3m')
                    await page.get_by_role('spinbutton').fill('1')
                    await page.get_by_role('button', name='▶ Run' if en else '▶ 実行', exact=True).click()
                    await page.wait_for_function('window.__DEVICE_RESEARCH__.status().calls===1')
                    await page.get_by_role('button', name='Stop experiment' if en else '実験を停止', exact=True).click()
                    await page.get_by_role('button', name='▶ Run' if en else '▶ 実行', exact=True).wait_for(state='visible')
                    await page.wait_for_function('!window.__DEVICE_RESEARCH__.status().busy')
                    current = await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/experiments")')
                    assert any(e['status'] == 'cancelled' for e in current['data']['experiments'])
                    await page.get_by_role('button', name='▶ Run' if en else '▶ 実行', exact=True).click()
                    await page.wait_for_function('window.__DEVICE_RESEARCH__.status().calls===2')
                    middle = await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/experiments")')
                    assert len(middle['data']['experiments']) == 3, [e['status'] for e in middle['data']['experiments']]
                    await page.evaluate('location.hash="/profile"')
                    await page.wait_for_function('!window.__DEVICE_RESEARCH__.status().busy')
                    await page.get_by_role('link', name='On-device research and ratings' if en else '端末内の比較・評価', exact=True).click()
                    current = await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/experiments")')
                    assert sum(e['status'] == 'cancelled' for e in current['data']['experiments']) == 2, [e['status'] for e in current['data']['experiments']]
                    results.append({'language': language, 'width': width, 'theme': theme, 'eight_turn_pipeline': True, 'rating_and_reload': True,
                                    'account_separation': True, 'pc_management_denied': True, 'explicit_stop_saved': True, 'navigation_stop_saved': True, 'synced_entities': 0})
                finally:
                    await context.close()
        finally:
            await browser.close()
    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
    (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'blocked_requests': blocked, 'page_errors': errors}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__':
    asyncio.run(main())
