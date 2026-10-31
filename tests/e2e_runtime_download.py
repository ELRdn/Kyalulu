"""Actual RuntimeDownload/Device API/IDB/OPFS; substitute only the OS picker."""
import asyncio
import hashlib
import json
from pathlib import Path
import traceback
from urllib.parse import quote, unquote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/runtime-download-browser'
CASES = [('file', 'none', True), ('file', 'write', True), ('file', 'owner', True),
         ('file', 'close', True), ('file', 'corrupt', True), ('file', 'picker-cancel', True),
         ('fallback', 'none', False), ('fallback', 'none', True)]


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    report = {'ok': False, 'cases': [], 'blocked': [], 'page_errors': [], 'workers': [],
              'source_before': {}, 'contexts_closed': 0, 'browser_closed': False, 'vite_stopped': False,
              'limits': ['Fictional few-MiB diagnostics, no 1 GB/RSS/model/device/production acceptance',
                         'Native OS picker substituted with an OPFS file handle; actual browser writable stream',
                         'Disk/close/corruption failures injected, not physical disk exhaustion']}

    def record_source(path):
        if path.is_file() and path.is_relative_to(ROOT):
            report['source_before'].setdefault(path.relative_to(ROOT).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest())

    def save():
        (OUTPUT / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    for name in ('tests/e2e_runtime_download.py', 'tests/browser_fixture_server.py',
                 'tests/fixtures/runtime-download.html', 'apps/web/vite.config.ts', 'pnpm-lock.yaml'):
        record_source(ROOT / name)
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            report['chromium'] = browser.version
            try:
                for language, width, theme in [('ja', 393, 'light'), ('en', 1280, 'dark')]:
                    for mode, fault, large in CASES:
                        row = {'language': language, 'width': width, 'theme': theme,
                               'mode': mode, 'fault': fault, 'large': large, 'ok': False}
                        report['cases'].append(row)
                        context = await browser.new_context(viewport={'width': width, 'height': 852}, accept_downloads=True)
                        try:
                            async def guard(route):
                                address = urlsplit(route.request.url)
                                if (address.scheme == 'http' and address.netloc == urlsplit(origin).netloc
                                        and not address.path.startswith('/api/') and not address.path.endswith(('.onnx', '.gguf', '.wasm'))):
                                    path = unquote(address.path)
                                    if path.startswith('/src/'):
                                        record_source(ROOT / 'apps/web' / path.lstrip('/'))
                                    elif path.startswith('/@fs/'):
                                        record_source(Path(path.removeprefix('/@fs/')))
                                    await route.continue_()
                                else:
                                    report['blocked'].append(route.request.url)
                                    await route.abort()

                            await context.route('**/*', guard)
                            page = await context.new_page()
                            page.set_default_timeout(30000)
                            page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                            page.on('worker', lambda worker: report['workers'].append(worker.url))
                            await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/runtime-download.html').as_posix(), safe='/:'))
                            await page.wait_for_function('window.__RUNTIME_DOWNLOAD__ !== undefined')
                            await page.evaluate('theme=>{localStorage.setItem("my-zeta-theme",theme);document.documentElement.setAttribute("data-theme",theme)}', theme)
                            await page.evaluate('args=>window.__RUNTIME_DOWNLOAD__.setup(...args)', [language, mode, fault, large])
                            button = page.get_by_role('button', name='書き出し' if language == 'ja' else 'Export', exact=True)
                            if mode == 'fallback' and not large:
                                async with page.expect_download() as pending:
                                    await button.click()
                                download = await pending.value
                                assert download.suggested_filename == 'experiment.json'
                                target = OUTPUT / (language + '-small-experiment.json')
                                await download.save_as(target)
                                downloaded = target.read_bytes()
                                row['download_bytes'] = len(downloaded)
                                row['download_sha256'] = hashlib.sha256(downloaded).hexdigest()
                            else:
                                await button.click()
                            await button.wait_for()
                            row.update(await page.evaluate('window.__RUNTIME_DOWNLOAD__.result()'))
                            if mode == 'file' and fault == 'none':
                                assert row['file_sha256'] == row['expected_sha256'] and row['file_bytes'] == row['expected_bytes']
                                assert row['writes'] > 2 and row['close'] == 1 and row['abort'] == 0
                                assert row['maximum_pending'] == 1 and row['maximum_chunk'] <= 1024 * 1024
                            elif mode == 'fallback' and not large:
                                assert row['download_sha256'] == row['expected_sha256'] and row['download_bytes'] == row['expected_bytes']
                                assert row['picker'] == 0 and row['original_file']
                            else:
                                if fault != 'picker-cancel':
                                    await page.get_by_role('alert').wait_for()
                                assert row['close'] == 0 and row['original_file'], row
                                if fault in ('write', 'owner', 'close'):
                                    assert row['abort'] == 1 and row['writes'] > 0, row
                                if fault in ('corrupt', 'picker-cancel'):
                                    assert row['writes'] == 0, row
                                if fault == 'picker-cancel':
                                    assert row['reads'] == 0, row
                            if mode == 'file':
                                assert row['picker'] == 1 and row['activation'], row
                            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                            row['ok'] = True
                        except Exception:
                            row['error'] = traceback.format_exc()
                            raise
                        finally:
                            await context.close()
                            report['contexts_closed'] += 1
                            save()
            finally:
                await browser.close()
                report['browser_closed'] = not browser.is_connected()
        report['vite_stopped'] = True
        report['source_after'] = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in report['source_before']}
        assert report['source_before'] == report['source_after'], 'Source changed during validation'
        assert not report['blocked'] and not report['page_errors'] and not report['workers'], report
        assert len(report['cases']) == 16 and all(row['ok'] for row in report['cases'])
        report['ok'] = True
        print(json.dumps({'ok': True, 'cases': len(report['cases']), 'source_files': len(report['source_before'])}))
    finally:
        save()


if __name__ == '__main__':
    asyncio.run(main())
