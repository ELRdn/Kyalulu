"""Bounded real Chromium/IndexedDB memory projection acceptance; no API/inference."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
import traceback
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/memory-source-projection-browser'
SCENARIOS = (
    'read-projection', 'rewrite-local', 'rewrite-sync', 'isolation',
    'revision-conflict', 'body-token-conflict', 'corrupt-late-part',
    'missing-late-part', 'invalid-discarded-json', 'rewrite-late-corruption', 'owner-switch-read',
    'owner-switch-write', 'quota-atomic',
)
PRODUCT = ('appStore.ts', 'deviceMemoryStore.ts', 'deviceMemoryScopes.ts',
           'deviceScopedMemory.ts', 'deviceScopedMemoryApi.ts')


def fingerprints():
    return {name: hashlib.sha256((ROOT / 'apps/web/src/lib' / name).read_bytes()).hexdigest()
            for name in PRODUCT}


async def main():
    if os.name == 'nt':
        os.environ.setdefault('PLAYWRIGHT_BROWSERS_PATH', 'C:/Users/hiron/AppData/Local/ms-playwright')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'ok': False, 'scenarios': [], 'product_sha256_before': fingerprints(),
              'network_denied': [], 'websockets_closed': [], 'page_errors': [],
              'owned_contexts_closed': 0, 'browser_restarts': 0, 'vite_stopped': False,
              'real_inference_attempts': 0, 'production_used': False,
              'limits': ['1–3 MiB synthetic peer history; mechanism acceptance only',
                         'No real model, API generation, 1 GB capacity or heap/RSS acceptance',
                         'Metadata/scalars and one decoded rewrite/validation message may remain whole',
                         'Browser close/relaunch is graceful; not a kill/crash or physical-device test']}

    def save():
        (OUTPUT / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    save()
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
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
                context = await runtime.chromium.launch_persistent_context(
                    profile, headless=True, service_workers='block')
                await context.route('**/*', guard)

                async def close_socket(socket):
                    report['websockets_closed'].append(socket.url)
                    parsed = urlsplit(socket.url)
                    if (parsed.netloc != urlsplit(origin).netloc
                            or parsed.path == '/api' or parsed.path.startswith('/api/')):
                        report['network_denied'].append(socket.url)
                    await socket.close()

                await context.route_web_socket('**/*', close_socket)
                page = await context.new_page()
                page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                report['chromium_version'] = context.browser.version
                return context, page

            async def close(context):
                browser = context.browser
                await context.close()
                report['owned_contexts_closed'] += 1
                assert not browser.is_connected(), 'Owned persistent browser remained connected after close'

            url = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/memory-source-projection.html').as_posix(), safe='/:')
            for scenario in SCENARIOS:
                started = time.monotonic()
                result = {'scenario': scenario, 'ok': False}
                with tempfile.TemporaryDirectory(prefix='profile-', dir=OUTPUT) as profile:
                    context = page = None
                    try:
                        context, page = await launch(profile)
                        await page.goto(url)
                        await page.wait_for_function('window.__MEMORY_SOURCE_PROJECTION__ !== undefined')
                        result.update(await page.evaluate('(name)=>window.__MEMORY_SOURCE_PROJECTION__.run(name)', scenario))
                        if scenario == 'quota-atomic':
                            await close(context)
                            context = None
                            context, page = await launch(profile)
                            report['browser_restarts'] += 1
                            await page.goto(url)
                            result['reopen_kind'] = 'Chromium process close/relaunch with same disposable profile'
                        else:
                            await page.reload()
                            result['reopen_kind'] = 'page reload, fresh module state'
                        await page.wait_for_function('window.__MEMORY_SOURCE_PROJECTION__ !== undefined')
                        result['reopen'] = await page.evaluate('window.__MEMORY_SOURCE_PROJECTION__.resume()')
                    except Exception:
                        result['ok'] = False
                        result['error'] = traceback.format_exc()
                        if page and not page.is_closed():
                            try:
                                result['progress'] = await page.evaluate('window.__PROJECTION_PROGRESS__ ?? null')
                                await page.screenshot(path=str(OUTPUT / (scenario + '-failure.png')))
                            except Exception:
                                result['evidence_error'] = traceback.format_exc()
                    finally:
                        if context:
                            await close(context)
                result['seconds'] = round(time.monotonic() - started, 3)
                report['scenarios'].append(result)
                save()
                print(json.dumps({'scenario': scenario, 'ok': result['ok'], 'seconds': result['seconds']}, ensure_ascii=False), flush=True)
        report['vite_stopped'] = True
    finally:
        report['product_sha256_after'] = fingerprints()
        report['product_unchanged_during_run'] = report['product_sha256_before'] == report['product_sha256_after']
        report['ok'] = (len(report['scenarios']) == len(SCENARIOS)
                        and all(case['ok'] for case in report['scenarios'])
                        and not report['network_denied'] and not report['page_errors']
                        and report['vite_stopped'] and report['product_unchanged_during_run'])
        save()
    print(json.dumps({'ok': report['ok'], 'report': str(OUTPUT / 'result.json')}, ensure_ascii=False), flush=True)
    assert report['ok'], f'Browser acceptance failed; inspect {OUTPUT / "result.json"}'


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), 300))
