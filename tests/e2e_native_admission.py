"""Real queued production Worker cancellation with fictional public-count engine; no native count proof."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]


def fingerprint():
    paths = ['apps/web/src/mobile/runtime.worker.ts', 'apps/web/src/mobile/context.ts',
             'apps/web/src/mobile/sampling.ts', 'apps/web/src/mobile/types.ts',
             'tests/fixtures/native-admission.html', 'tests/e2e_native_admission.py', 'apps/web/vite.config.ts']
    return {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in paths}


async def main(output):
    report = {'ok': False, 'cases': [], 'page_errors': [], 'blocked_requests': [],
              'real_worker_queue': True, 'fictional_engine': True, 'native_count_proof': False,
              'real_inference_attempts': 0, 'source_before': fingerprint()}
    try:
        async with local_vite(output) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            context = await browser.new_context(service_workers='block')
            try:
                async def guard(route):
                    url = urlsplit(route.request.url)
                    if url.hostname != '127.0.0.1' or url.port != urlsplit(origin).port:
                        report['blocked_requests'].append(route.request.url)
                        return await route.abort()
                    if '/runtime/' in url.path and url.path.endswith('/wllama.js'):
                        return await route.fulfill(status=200, content_type='text/javascript', body='// fictional resource')
                    if url.path.startswith('/api/') or Path(url.path).suffix.lower() in {'.wasm', '.gguf', '.onnx', '.bin', '.safetensors'}:
                        report['blocked_requests'].append(route.request.url)
                        return await route.abort()
                    await route.continue_()
                await context.route('**/*', guard)
                await context.route_web_socket('**/*', lambda socket: socket.close())
                page = await context.new_page()
                page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/native-admission.html').as_posix(), safe='/:'))
                await page.wait_for_function('window.__NATIVE_ADMISSION__ !== undefined')
                for phase in ('mandatory', 'window', 'final'):
                    row = await page.evaluate('(phase)=>window.__NATIVE_ADMISSION__.run(phase)', phase)
                    report['cases'].append(row)
                    assert row['stopped_completion_calls'] == 0 and row['recovery_completion_calls'] == 1
                    print(json.dumps({'phase': phase, 'ok': True}), flush=True)
                report['checkpoint_negative_control'] = await page.evaluate('window.__NATIVE_ADMISSION__.run("final", true)')
                assert report['checkpoint_negative_control']['completion_escaped']
                assert not report['page_errors'] and not report['blocked_requests'], report
                report['ok'] = True
            finally:
                await context.close()
                await browser.close()
        report['source_after'] = fingerprint()
        assert report['source_before'] == report['source_after'], 'Source changed while validating queued Worker'
        report['fingerprint_stable'] = True
    except BaseException as error:
        report['error'] = str(error)
        report['ok'] = False
        raise
    finally:
        output.mkdir(parents=True, exist_ok=True)
        (output / 'result.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'report': str(output / 'result.json')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.artifacts/native-count-admission-transport-20261101/queued-worker')
    asyncio.run(asyncio.wait_for(main(parser.parse_args().output.resolve()), 120))
