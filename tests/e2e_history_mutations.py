"""Independent Device history route acceptance, real Chromium/IDB, loopback only."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
import time
import traceback
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = (
    'flow-legacy-local', 'flow-legacy-sync', 'flow-world-local', 'flow-shared-sync',
    'late-part', 'invalid-json', 'quota-legacy', 'quota-scoped', 'quota-clear',
    'owner-switch', 'cas-revision', 'cas-token', 'contracts',
)
PRODUCT = ('deviceApi.ts', 'deviceHistoryChange.ts', 'appStore.ts', 'segmentedStorage.ts',
           'deviceMemoryStore.ts', 'deviceScopedMemory.ts', 'deviceMemoryScopes.ts',
           'deviceMemoryDomainIO.ts', 'jsonStream.ts', 'devicePrompt.ts')


def fingerprints():
    return {name: hashlib.sha256((ROOT / 'apps/web/src/lib' / name).read_bytes()).hexdigest()
            if (ROOT / 'apps/web/src/lib' / name).exists() else None for name in PRODUCT}


async def main(output, scenarios):
    output.mkdir(parents=True, exist_ok=True)
    report = {'ok': False, 'scenarios': [], 'product_sha256_before': fingerprints(),
              'network_denied': [], 'websockets_closed': [], 'page_errors': [],
              'owned_contexts_closed': 0, 'browser_restarts': 0, 'vite_stopped': False,
              'real_inference_attempts': 0, 'production_used': False,
              'golden_baseline_head': '3688179',
              'fixture_sha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                                 for name in ('tests/fixtures/history-mutations.html',
                                              'tests/fixtures/memory-source-projection.html')},
              'limits': ['>=2 MiB / 80 synthetic messages; mechanism acceptance, no 1 GB or heap/RSS claim',
                         'No inference, external API, production, CI restart or physical device',
                         'Metadata/scalars and one callback message may remain whole',
                         'CAS commits a competing real IDB revision/token after admission; no two-tab scheduling claim',
                         'Reopen is graceful browser close/relaunch or page reload, not crash recovery']}

    def save():
        (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    save()
    try:
        async with local_vite(output) as origin, async_playwright() as runtime:
            report['chromium_executable'] = runtime.chromium.executable_path

            async def guard(route):
                url = urlsplit(route.request.url)
                if (url.scheme == 'http' and url.netloc == urlsplit(origin).netloc
                        and url.path != '/api' and not url.path.startswith('/api/')):
                    await route.continue_()
                else:
                    report['network_denied'].append(route.request.url)
                    await route.abort()

            async def launch(profile):
                context = await runtime.chromium.launch_persistent_context(profile, headless=True, service_workers='block')
                await context.route('**/*', guard)

                async def close_socket(socket):
                    report['websockets_closed'].append(socket.url)
                    url = urlsplit(socket.url)
                    if url.netloc != urlsplit(origin).netloc or url.path == '/api' or url.path.startswith('/api/'):
                        report['network_denied'].append(socket.url)
                    await socket.close()

                await context.route_web_socket('**/*', close_socket)
                page = await context.new_page()
                page.set_default_timeout(30000)
                page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                report['chromium_version'] = context.browser.version
                return context, page

            async def close(context):
                browser = context.browser
                await context.close()
                report['owned_contexts_closed'] += 1
                assert not browser.is_connected(), 'Owned browser remained connected after close'

            url = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/history-mutations.html').as_posix(), safe='/:')
            for scenario in scenarios:
                started = time.monotonic()
                result = {'scenario': scenario, 'ok': False, 'product_sha256_before': fingerprints()}
                with tempfile.TemporaryDirectory(prefix='history-profile-', dir=output) as profile:
                    context = page = None
                    try:
                        context, page = await launch(profile)
                        await page.goto(url)
                        await page.wait_for_function('window.__HISTORY_MUTATIONS__ !== undefined')
                        result.update(await asyncio.wait_for(page.evaluate('(name)=>window.__HISTORY_MUTATIONS__.run(name)', scenario), 90))
                        if scenario == 'quota-clear':
                            await close(context)
                            context = None
                            context, page = await launch(profile)
                            report['browser_restarts'] += 1
                            await page.goto(url)
                            result['reopen_kind'] = 'Chromium process close/relaunch, same disposable profile'
                        else:
                            await page.reload()
                            result['reopen_kind'] = 'page reload, fresh module state'
                        await page.wait_for_function('window.__HISTORY_MUTATIONS__ !== undefined')
                        result['reopen'] = await page.evaluate('window.__HISTORY_MUTATIONS__.resume()')
                    except Exception:
                        result['ok'] = False
                        result['error'] = traceback.format_exc()
                        print(result['error'], flush=True)
                        if page and not page.is_closed():
                            try:
                                result['progress'] = await page.evaluate('window.__HISTORY_PROGRESS__ ?? null')
                                await page.screenshot(path=str(output / (scenario + '-failure.png')))
                            except Exception:
                                result['evidence_error'] = traceback.format_exc()
                    finally:
                        if context:
                            await close(context)
                result['product_sha256_after'] = fingerprints()
                result['product_unchanged_during_case'] = result['product_sha256_before'] == result['product_sha256_after']
                result['ok'] = result['ok'] and result['product_unchanged_during_case']
                result['seconds'] = round(time.monotonic() - started, 3)
                report['scenarios'].append(result)
                save()
                print(json.dumps({'scenario': scenario, 'ok': result['ok'], 'seconds': result['seconds']}, ensure_ascii=False), flush=True)
        report['vite_stopped'] = True
    finally:
        report['product_sha256_after'] = fingerprints()
        report['product_unchanged_during_run'] = report['product_sha256_before'] == report['product_sha256_after']
        report['ok'] = (len(report['scenarios']) == len(scenarios) and all(case['ok'] for case in report['scenarios'])
                        and not report['network_denied'] and not report['page_errors']
                        and report['vite_stopped'] and report['product_unchanged_during_run'])
        save()
    print(json.dumps({'ok': report['ok'], 'report': str(output / 'result.json')}, ensure_ascii=False), flush=True)
    assert report['ok'], f'Browser acceptance failed; inspect {output / "result.json"}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Artifacts directory; defaults outside repository in system TEMP')
    parser.add_argument('--scenario', action='append', choices=SCENARIOS, help='Run selected cases; defaults to all')
    args = parser.parse_args()
    output = args.output or Path(tempfile.mkdtemp(prefix='kyalulu-history-mutations-'))
    print(json.dumps({'output': str(output)}, ensure_ascii=False), flush=True)
    asyncio.run(asyncio.wait_for(main(output, args.scenario or SCENARIOS), 900))
