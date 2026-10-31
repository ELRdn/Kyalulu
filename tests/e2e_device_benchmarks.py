"""Real BenchmarkLab/App/IDB/Web Locks/BroadcastChannel; synthetic inference only."""
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright, expect
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'runtime'))
from python.core.benchmark import BenchmarkRequest
from python.core.schemas import ExperimentMeta
OUTPUT = ROOT / '.artifacts/device-benchmarks-browser'


async def job(page, id_, statuses):
    for _ in range(600):
        response = await page.evaluate('id=>window.__DEVICE_RESEARCH__.api("/api/benchmarks/"+id)', id_)
        assert response['status'] == 200, response
        if response['data']['status'] in statuses:
            return response['data']
        await asyncio.sleep(.05)
    raise AssertionError({'expected': statuses, 'job': response['data']})


async def main():
    results, blocked, errors = [], [], []
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        try:
            for language, width, theme in [('ja', 393, 'light'), ('en', 1280, 'dark')]:
                context = await browser.new_context(viewport={'width': width, 'height': 852})
                try:
                    # This driver verifies the browser-download fallback; the OPFS sink has its own driver.
                    await context.add_init_script("Object.defineProperty(window,'showSaveFilePicker',{configurable:true,value:undefined});")
                    async def route(request):
                        url = urlsplit(request.request.url)
                        if url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port or url.path.startswith('/api/'):
                            blocked.append(url.path); await request.abort()
                        else:
                            await request.continue_()
                    await context.route('**/*', route)
                    address = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-research.html').as_posix(), safe='/:') + '#/research/benchmarks'
                    en = language == 'en'

                    async def mount(page):
                        await page.wait_for_function('window.__DEVICE_RESEARCH__ !== undefined')
                        await page.evaluate('([lang,theme])=>window.__DEVICE_RESEARCH__.mount(document.getElementById("root"),lang,theme)', [language, theme])
                        await page.get_by_role('heading', name='Benchmarks' if en else '比較実験', exact=True).wait_for()

                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(error.stack or str(error)))
                    await page.goto(address); await mount(page)
                    await page.get_by_role('checkbox', name='Kyalulu E2B JP Rolepaly beta · IQ3_M', exact=True).wait_for()
                    await page.get_by_label('Scenario' if en else 'シナリオ', exact=True).select_option('mocha_memory_001')
                    await page.get_by_label('Runs' if en else '繰り返し', exact=True).fill('2')
                    await page.get_by_label('Seed' if en else 'シード', exact=True).fill('17')
                    await page.get_by_text('Memory retrieval and context conditions' if en else '記憶検索・文脈の条件', exact=True).click()
                    await page.get_by_label('Maximum memories' if en else '最大記憶数', exact=True).fill('1')
                    await page.get_by_label('Estimated memory token budget' if en else '記憶の推定トークン枠', exact=True).fill('80')
                    await page.get_by_label('Recent conversation turns (0 = all history)' if en else '直近の会話ターン数（0＝全履歴）', exact=True).fill('1')
                    await page.evaluate('window.__DEVICE_RESEARCH__.holdAtCall(25)')
                    await page.get_by_role('button', name='Start benchmark' if en else '比較実験を開始', exact=True).click()
                    # The returned job card establishes acceptance; table rows are partial until completion.
                    await page.get_by_role('button', name='Results JSON' if en else '結果JSON', exact=True).wait_for()
                    all_jobs = await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/benchmarks")')
                    assert all_jobs['status'] == 200 and len(all_jobs['data']['jobs']) == 1
                    first = all_jobs['data']['jobs'][0]
                    await page.wait_for_function('window.__DEVICE_RESEARCH__.status().calls===25')
                    partial = await job(page, first['id'], ['running'])
                    assert len(partial['results']) == 3
                    await expect(page.locator('table tbody tr')).to_have_count(3)
                    await page.evaluate('window.__DEVICE_RESEARCH__.resume()')
                    first = await job(page, first['id'], ['completed'])
                    await expect(page.locator('table tbody tr')).to_have_count(4)
                    assert first['planned_runs'] == 4 and first['planned_turns'] == 32
                    assert [[r['memory_enabled'], r['seed']] for r in first['results']] == [[False, 17], [True, 17], [True, 18], [False, 18]]
                    assert all(r['memory_options']['top_k'] == 1 and r['history_turn_limit'] == 1 for r in first['results'])
                    async with page.expect_download() as downloading:
                        await page.get_by_role('button', name='Results JSON' if en else '結果JSON', exact=True).click()
                    download = await downloading.value
                    assert download.suggested_filename == 'benchmark.json'
                    destination = OUTPUT / f'{language}-benchmark.json'; await download.save_as(destination)
                    downloaded = json.loads(destination.read_text(encoding='utf-8'))
                    assert BenchmarkRequest.model_validate(downloaded['request']).seed == 17
                    assert all(ExperimentMeta.model_validate(r).status == 'completed' for r in downloaded['results'])
                    assert 'revision' not in downloaded
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
                    await page.screenshot(path=str(OUTPUT / f'{language}-{width}-{theme}.png'), full_page=True)
                    # The owning tab can change screens while the document keeps running.
                    before = await page.evaluate('window.__DEVICE_RESEARCH__.status().calls')
                    await page.evaluate('window.__DEVICE_RESEARCH__.pause(true)')
                    await page.get_by_role('button', name='Start benchmark' if en else '比較実験を開始', exact=True).click()
                    await page.wait_for_function('(count)=>window.__DEVICE_RESEARCH__.status().calls===count', arg=before + 1)
                    running = (await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/benchmarks")'))['data']['jobs'][0]
                    await page.evaluate('location.hash="/research"')
                    assert (await job(page, running['id'], ['running']))['status'] == 'running'
                    # A second tab sees the live lock and requests cancellation through BroadcastChannel.
                    other = await context.new_page()
                    other.on('pageerror', lambda error: errors.append(error.stack or str(error)))
                    await other.goto(address); await mount(other)
                    await other.get_by_role('button', name='Cancel benchmark' if en else '実験を中止', exact=True).click()
                    cancelled = await job(other, running['id'], ['cancelled'])
                    assert cancelled['cancel_requested'] and len(cancelled['results']) == 1
                    assert cancelled['results'][0]['status'] == 'cancelled'
                    await page.wait_for_function('!window.__DEVICE_RESEARCH__.status().busy')
                    await other.close()
                    # A whole-document reload interrupts, preserves and exposes the partial result.
                    await page.evaluate('location.hash="/research/benchmarks"')
                    await page.get_by_role('button', name='Start benchmark' if en else '比較実験を開始', exact=True).wait_for()
                    before = await page.evaluate('window.__DEVICE_RESEARCH__.status().calls')
                    await page.get_by_role('button', name='Start benchmark' if en else '比較実験を開始', exact=True).click()
                    await page.wait_for_function('(count)=>window.__DEVICE_RESEARCH__.status().calls===count', arg=before + 1)
                    running = (await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/benchmarks")'))['data']['jobs'][0]
                    await page.reload(); await mount(page)
                    interrupted = await job(page, running['id'], ['interrupted'])
                    assert interrupted['results'][0]['status'] == 'interrupted'
                    assert interrupted['results'][0]['metrics']['turn_count'] == 0
                    replay = await page.evaluate('request=>window.__DEVICE_RESEARCH__.api("/api/benchmarks",request)', interrupted['request'])
                    assert replay['status'] == 200 and replay['data']['status'] == 'interrupted'
                    assert (await page.evaluate('window.__DEVICE_RESEARCH__.status()'))['calls'] == 0
                    await page.evaluate('window.__DEVICE_RESEARCH__.owner("other-fixture")')
                    await expect(page.get_by_text('No benchmarks yet.' if en else 'まだ比較実験はありません。', exact=True)).to_be_visible()
                    assert (await page.evaluate('id=>window.__DEVICE_RESEARCH__.api("/api/benchmarks/"+id+"/export")', first['id']))['status'] == 404
                    await page.evaluate('window.__DEVICE_RESEARCH__.owner("device-research-fixture")')
                    assert (await job(page, first['id'], ['completed']))['results'] == first['results']
                    if en:
                        # Exercise the actual MobileRuntime reset path when loading never replies.
                        await page.evaluate('window.__DEVICE_RESEARCH__.pauseLoad(true)')
                        response = await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/benchmarks",{model_ids:["kyalulu-iq3m"],scenarios:["mocha_memory_001"],memory:"off",run_timeout_seconds:10})')
                        assert response['status'] == 202
                        await page.wait_for_function('window.__DEVICE_RESEARCH__.status().loading')
                        timed_out = await job(page, response['data']['id'], ['timed_out'])
                        assert timed_out['results'][0]['status'] == 'cancelled'
                        await page.wait_for_function('!window.__DEVICE_RESEARCH__.status().busy')
                        assert (await page.evaluate('window.__DEVICE_RESEARCH__.status()'))['terminations'] >= 1
                        await page.evaluate('window.__DEVICE_RESEARCH__.pauseLoad(false)')
                        response = await page.evaluate('window.__DEVICE_RESEARCH__.api("/api/benchmarks",{model_ids:["kyalulu-iq3m"],scenarios:["advanced_mocha_sfw_100"],memory:"on",history_turn_limit:2,memory_options:{top_k:3,budget_tokens:200},seed:73})')
                        assert response['status'] == 202
                        long_run = await job(page, response['data']['id'], ['completed'])
                        assert long_run['planned_turns'] == 100 and long_run['current']['turns_completed'] == 100
                        assert long_run['results'][0]['seed'] == 73
                        detail = await page.evaluate('id=>window.__DEVICE_RESEARCH__.api("/api/experiments/"+id)', long_run['results'][0]['experiment_id'])
                        assert len(detail['data']['turns']) == 100
                        assert [t['user_id'] for t in detail['data']['turns']] == list(range(1, 200, 2))
                    assert (await page.evaluate('window.__DEVICE_RESEARCH__.state()'))['entities'] == []
                    results.append({'language': language, 'width': width, 'theme': theme, 'paired_32_turns': True, 'native_export_contract': True,
                                    'navigation_continues': True, 'cross_tab_cancel': True, 'reload_interrupted': True, 'account_separation': True,
                                    'load_timeout': en, 'synthetic_100_turns': en, 'synced_entities': 0, 'overflow': False})
                finally:
                    await context.close()
        finally:
            await browser.close()
    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
    (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'blocked_requests': blocked, 'page_errors': errors}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__':
    asyncio.run(main())
