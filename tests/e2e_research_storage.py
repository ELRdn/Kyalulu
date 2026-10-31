"""Independent Research persistence oracle: installed Chromium, real IDB, no inference."""
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
SCENARIOS = ('legacy-roundtrip', 'optional-job', 'repeated-write', 'catalog', 'recovery', 'owner-isolation', 'catalog-binding', 'cas',
             'late-missing', 'late-corrupt', 'missing-manifest', 'manifest-tamper', 'header-tamper', 'body-tamper',
             'quota-legacy', 'quota-rewrite', 'quota-cleanup', 'owner-read', 'owner-write')


def fingerprint():
    paths = set()
    for folder in ('apps/web/src', 'packages/schemas/src', 'packages/ui/src'):
        paths.update(path for path in (ROOT / folder).rglob('*') if path.is_file())
    paths.update(ROOT / path for path in ('apps/web/vite.config.ts', 'apps/web/package.json',
                                         'pnpm-lock.yaml', 'tests/browser_fixture_server.py',
                                         'tests/e2e_research_storage.py', 'tests/fixtures/research-storage.html'))
    rows = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)}
    return {'sha256': hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest(), 'files': rows}


async def main(output, scenarios, expected_source):
    output.mkdir(parents=True, exist_ok=True)
    report = {'ok': False, 'source_before': fingerprint(), 'scenarios': [], 'network_denied': [],
              'page_errors': [], 'console_errors': [], 'websockets_closed': [], 'workers_created': [],
              'contexts_closed': 0, 'profiles_removed': 0, 'browser_restarts': 0, 'vite_stopped': False,
              'baseline_head': 'cc0b95fae3f9dead5a0649b90714aeec79aae412',
              'expected_source': expected_source, 'production_used': False, 'real_inference_attempts': 0,
              'limits': ['>=3 MiB fictional full Experiment, not full actor bounded memory or 1 GB acceptance',
                         'Injected quota exception, not actual disk exhaustion',
                         'Graceful Chromium close/relaunch, not crash/power loss',
                         'No real model, inference, download, external API, physical device, production or CI changes']}

    def save():
        (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    save()
    try:
        if expected_source:
            assert report['source_before']['sha256'] == expected_source, 'Frozen source fingerprint differs before start'
        async with local_vite(output) as origin, async_playwright() as runtime:
            report['chromium_executable'] = runtime.chromium.executable_path

            async def guard(route):
                url = urlsplit(route.request.url)
                if (url.scheme == 'http' and url.netloc == urlsplit(origin).netloc
                        and url.path != '/api' and not url.path.startswith('/api/')
                        and not any(word in url.path.lower() for word in ('.gguf', '.onnx', '.safetensors', '.wasm', '/models/'))):
                    await route.continue_()
                else:
                    report['network_denied'].append(route.request.url)
                    await route.abort()

            async def launch(profile):
                context = await runtime.chromium.launch_persistent_context(profile, headless=True, service_workers='block')
                await context.route('**/*', guard)

                async def close_socket(socket):
                    report['websockets_closed'].append(socket.url)
                    if urlsplit(socket.url).netloc != urlsplit(origin).netloc:
                        report['network_denied'].append(socket.url)
                    await socket.close()

                await context.route_web_socket('**/*', close_socket)
                page = await context.new_page()
                page.set_default_timeout(30000)
                page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                page.on('console', lambda message: report['console_errors'].append(message.text) if message.type == 'error' else None)
                page.on('worker', lambda worker: report['workers_created'].append(worker.url))
                report['chromium_version'] = context.browser.version
                return context, page

            async def close(context):
                browser = context.browser
                await context.close()
                report['contexts_closed'] += 1
                assert not browser.is_connected(), 'Owned browser remained connected'

            url = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/research-storage.html').as_posix(), safe='/:')
            for name in scenarios:
                started = time.monotonic()
                result = {'scenario': name, 'ok': False, 'source_before': fingerprint()['sha256']}
                with tempfile.TemporaryDirectory(prefix='research-profile-', dir=output) as profile:
                    context = page = None
                    try:
                        context, page = await launch(profile)
                        await page.goto(url)
                        await page.wait_for_function('window.__RESEARCH_STORAGE__ !== undefined')
                        result.update(await asyncio.wait_for(page.evaluate('name=>window.__RESEARCH_STORAGE__.run(name)', name), 90))
                        saved = await page.evaluate('window.__RESEARCH_STORAGE__.reopen()')
                        if name in ('quota-legacy', 'quota-rewrite', 'quota-cleanup', 'owner-write'):
                            await close(context)
                            context = None
                            context, page = await launch(profile)
                            report['browser_restarts'] += 1
                            await page.goto(url)
                            result['reopen_kind'] = 'Chromium close/relaunch, same disposable profile'
                        else:
                            await page.reload()
                            result['reopen_kind'] = 'page reload'
                        await page.wait_for_function('window.__RESEARCH_STORAGE__ !== undefined')
                        result['reopen'] = await page.evaluate('saved=>window.__RESEARCH_STORAGE__.resume(saved)', saved)
                    except Exception:
                        result['ok'] = False
                        result['error'] = traceback.format_exc()
                        print(result['error'], flush=True)
                        if page and not page.is_closed():
                            try:
                                result['progress'] = await page.evaluate('window.__RESEARCH_PROGRESS__ ?? null')
                                await page.screenshot(path=str(output / (name + '-failure.png')))
                            except Exception:
                                result['evidence_error'] = traceback.format_exc()
                    finally:
                        if context:
                            await close(context)
                report['profiles_removed'] += 1
                result['source_after'] = fingerprint()['sha256']
                result['source_unchanged'] = result['source_before'] == result['source_after']
                result['ok'] = result['ok'] and result['source_unchanged']
                result['seconds'] = round(time.monotonic() - started, 3)
                report['scenarios'].append(result)
                save()
                print(json.dumps({'scenario': name, 'ok': result['ok'], 'seconds': result['seconds']}), flush=True)
        report['vite_stopped'] = True
    finally:
        report['source_after'] = fingerprint()
        report['source_unchanged'] = report['source_before'] == report['source_after']
        report['ok'] = (len(report['scenarios']) == len(scenarios) and all(row['ok'] for row in report['scenarios'])
                        and report['source_unchanged'] and report['vite_stopped']
                        and not report['network_denied'] and not report['page_errors']
                        and not report['console_errors'] and not report['workers_created'])
        save()
    print(json.dumps({'ok': report['ok'], 'report': str(output / 'result.json')}, ensure_ascii=False), flush=True)
    assert report['ok'], f'Research browser acceptance failed; inspect {output / "result.json"}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Retained evidence directory; default system TEMP, outside repository')
    parser.add_argument('--scenario', action='append', choices=SCENARIOS)
    parser.add_argument('--expected-source', help='Require the source closure SHA-256 agreed at freeze before starting')
    args = parser.parse_args()
    output = args.output or Path(tempfile.mkdtemp(prefix='kyalulu-research-storage-'))
    print(json.dumps({'output': str(output)}, ensure_ascii=False), flush=True)
    asyncio.run(asyncio.wait_for(main(output, args.scenario or SCENARIOS, args.expected_source), 900))
