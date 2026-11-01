"""Real Research controls with fictional HTTP Runtime responses; no model or private DB."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/research-language-browser'


def meta(identifier):
    return {'experiment_id': identifier, 'model_id': 'fixture_model', 'scenario_id': 'fixture_scenario',
            'run_number': 1, 'timestamp': '2026-10-26T00:00:00Z', 'status': 'completed', 'prompt_version': 'fixture'}


async def main():
    results, blocked, errors = [], [], []
    async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
        browser = await runtime.chromium.launch(headless=True)
        try:
            for initial, width, theme in [('ja', 393, 'light'), ('en', 393, 'dark'), ('en', 1280, 'light')]:
                context = await browser.new_context(viewport={'width': width, 'height': 852})
                requests, writes, benchmark_posts = [], [], []
                jobs = []
                page, phase = None, 'setup'
                console_errors, failed_requests = [], []
                try:
                    async def route(request):
                        url = urlsplit(request.request.url)
                        if url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port:
                            blocked.append(url.path); await request.abort(); return
                        if not url.path.startswith('/api/'):
                            await request.continue_(); return
                        requests.append((request.request.method, url.path, url.query))
                        value = None
                        if url.path == '/api/experiments':
                            value = {'experiments': [meta('fixture_' + str(n)) for n in range(3)]}
                        elif url.path == '/api/models':
                            value = {'models': [{'id': 'fixture_model', 'display_name': 'Fixture model'}, {'id': 'mock-echo', 'display_name': 'Mock fixture'}]}
                        elif url.path == '/api/scenarios':
                            value = {'scenarios': [{'id': 'fixture_scenario', 'official': True, 'turns': 20}]}
                        elif url.path == '/api/leaderboard':
                            value = {'scope': 'official', 'generated_at': '2026-10-26T00:00:00Z', 'ranking': [], 'total_experiments': 3}
                        elif url.path == '/api/ratings':
                            writes.append(request.request.post_data_json); value = {'ok': True}
                        elif url.path == '/api/benchmarks':
                            if request.request.method == 'POST':
                                benchmark_posts.append(request.request.post_data_json)
                                value = {'id': 'fixture_job', 'status': 'completed', 'created_at': '2026-10-26T00:00:00Z',
                                         'planned_runs': 2, 'planned_turns': 40, 'current': None, 'results': []}
                                jobs.append(value)
                            else:
                                value = {'jobs': jobs}
                        elif url.path.startswith('/api/experiments/'):
                            identifier = url.path.rsplit('/', 1)[-1]
                            value = {'meta': meta(identifier), 'raw_prompt': '原文プロンプト', 'ratings': {},
                                     'turns': [{'turn': 1, 'type': 'chat', 'user': '元の質問', 'assistant': '元の応答',
                                                'elapsed_ms': 12, 'state': {}, 'raw_prompt': '原文プロンプト', 'token_budget': {'estimate': 42}}]}
                        if value is None:
                            blocked.append(url.path); await request.abort(); return
                        await request.fulfill(json=value)

                    await context.route('**/*', route)
                    page = await context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
                    page.on('requestfailed', lambda request: failed_requests.append({'url': request.url, 'failure': request.failure}))
                    phase = 'fixture-import'
                    await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/research-language.html').as_posix(), safe='/:'))
                    await page.wait_for_function('window.__RESEARCH_LANGUAGE__ !== undefined')
                    phase = 'ui-assertions'
                    await page.evaluate('([language,theme])=>{window.__unmount=window.__RESEARCH_LANGUAGE__.mount(document.getElementById("root"),language,theme)}', [initial, theme])
                    column = page.locator('.k-research-col').first
                    comment = column.get_by_role('textbox', name='Comment (optional)' if initial == 'en' else 'コメント（任意）')
                    await comment.wait_for()
                    await page.wait_for_function('document.querySelectorAll(".k-research-col input[placeholder]").length===6')
                    await column.get_by_role('button', name='Rate 4 out of 5' if initial == 'en' else '5段階中4で評価', exact=True).click()
                    await comment.fill('入力中の日本語コメント')
                    request_count = len(requests)
                    other = 'ja' if initial == 'en' else 'en'
                    await page.evaluate('language=>window.__RESEARCH_LANGUAGE__.language(language)', other)
                    comment = column.get_by_role('textbox', name='Comment (optional)' if other == 'en' else 'コメント（任意）')
                    await comment.wait_for()
                    assert await comment.input_value() == '入力中の日本語コメント'
                    assert len(requests) == request_count and not writes, 'Language change must not send or fetch'
                    await column.get_by_role('button', name='Save' if other == 'en' else '保存', exact=True).click()
                    await page.wait_for_function('!Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Saving")||b.textContent.includes("保存中"))')
                    assert writes == [{'experiment_id': 'fixture_0', 'turn': 1, 'score': 4, 'comment': '入力中の日本語コメント', 'rater': 'local'}]
                    await column.get_by_role('button', name='Tokens' if other == 'en' else 'トークン', exact=True).click()
                    await column.get_by_text('Estimated tokens (not measured usage)' if other == 'en' else '推定トークン（実測値ではありません）', exact=True).wait_for()
                    await column.get_by_role('button', name='Prompt' if other == 'en' else 'プロンプト', exact=True).click()
                    await column.get_by_text('原文プロンプト', exact=True).wait_for()
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Horizontal overflow'
                    await page.screenshot(path=str(OUTPUT / f'{initial}-{width}-{theme}.png'), full_page=True)
                    # Switching experiments resets the rating draft; switching language did not.
                    await comment.fill('未保存の別実験向けではない下書き')
                    choice = page.locator('.k-experiment-choice').first.get_by_role('checkbox')
                    await choice.uncheck()
                    await column.get_by_text('fixture_1', exact=True).wait_for()
                    await page.wait_for_function('document.querySelector(".k-research-col input[placeholder*=Comment],.k-research-col input[placeholder*=コメント]")?.value===""')
                    assert len(writes) == 1
                    await page.evaluate('([language,theme])=>{window.__unmount();window.__unmount=window.__RESEARCH_LANGUAGE__.mount(document.getElementById("root"),language,theme,"benchmark")}', [initial, theme])
                    await page.get_by_label('Scenario' if initial == 'en' else 'シナリオ').select_option('fixture_scenario')
                    await page.get_by_label('Seed' if initial == 'en' else 'シード', exact=True).fill('127')
                    await page.evaluate('language=>window.__RESEARCH_LANGUAGE__.language(language)', other)
                    seed = page.get_by_label('Seed' if other == 'en' else 'シード', exact=True)
                    assert await seed.input_value() == '127' and not benchmark_posts
                    await page.get_by_text('Memory retrieval and context conditions' if other == 'en' else '記憶検索・文脈の条件', exact=True).click()
                    await page.get_by_label('Maximum memories' if other == 'en' else '最大記憶数', exact=True).fill('7')
                    await page.get_by_role('button', name='Start benchmark' if other == 'en' else '比較実験を開始', exact=True).click()
                    await page.get_by_role('button', name='Results JSON' if other == 'en' else '結果JSON', exact=True).wait_for()
                    assert len(benchmark_posts) == 1
                    assert benchmark_posts[0]['seed'] == 127 and benchmark_posts[0]['memory_options']['top_k'] == 7
                    assert benchmark_posts[0]['scenarios'] == ['fixture_scenario'] and benchmark_posts[0]['model_ids'] == ['mock-echo']
                    assert benchmark_posts[0]['memory'] == 'compare' and len(benchmark_posts[0]['request_id']) == 36
                    assert ('do not count as model quality evidence' if other == 'en' else 'モデルの品質評価には数えません') in await page.locator('main').inner_text()
                    assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Benchmark horizontal overflow'
                    await page.screenshot(path=str(OUTPUT / f'benchmark-{initial}-{width}-{theme}.png'), full_page=True)
                    results.append({'initial_language': initial, 'width': width, 'theme': theme, 'draft_retained_on_language_change': True,
                                    'no_automatic_request': True, 'explicit_rating_saved': True, 'draft_reset_on_experiment_change': True,
                                    'benchmark_conditions_retained': True, 'benchmark_explicit_request_only': True, 'overflow': False})
                except Exception as error:
                    failure = {'ok': False, 'initial_language': initial, 'width': width, 'theme': theme, 'phase': phase,
                               'exception': str(error), 'page_url': page.url if page else None,
                               'page_errors': list(errors), 'console_errors': console_errors,
                               'failed_requests': failed_requests, 'blocked_requests': list(blocked)}
                    (OUTPUT / f'failure-{initial}-{width}-{theme}.json').write_text(json.dumps(failure, indent=2), encoding='utf-8')
                    print(json.dumps(failure), flush=True)
                    raise
                finally:
                    await context.close()
        finally:
            await browser.close()
    assert not blocked and not errors, {'blocked': blocked, 'errors': errors}
    (OUTPUT / 'results.json').write_text(json.dumps({'results': results, 'blocked_requests': blocked, 'page_errors': errors}, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__':
    asyncio.run(main())
