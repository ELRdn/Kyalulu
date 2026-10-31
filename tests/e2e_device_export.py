"""Real IndexedDB/Response/file-byte export and document reload without providers."""
import asyncio
import base64
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import traceback
from urllib.parse import quote, unquote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-export-browser'
sys.path.insert(0, str(ROOT / 'scripts'))
from build_device_export_fixture import decode_output
from python.core.portable_formats import parse_import


async def main():
    results, blocked = [], []
    OUTPUT.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix='run-', dir=OUTPUT))
    report = {'ok': False, 'phase': 'launch', 'events': [], 'snapshots': [],
              'source_before': {}, 'owned_context_closed': False, 'owned_browser_closed': False,
              'vite_cleanup': 'local_vite owns terminate/wait/kill/wait'}

    def event(kind, **value):
        record = {'phase': report['phase'], 'kind': kind, **value}
        report['events'].append(record)
        with (output / 'events.jsonl').open('a', encoding='utf-8') as log:
            log.write(json.dumps(record) + '\n')
        print(json.dumps(record), flush=True)

    def source(path):
        if path.is_file() and path.is_relative_to(ROOT):
            report['source_before'].setdefault(path.relative_to(ROOT).as_posix(), hashlib.sha256(path.read_bytes()).hexdigest())

    for path in (Path(__file__), ROOT / 'tests/browser_fixture_server.py',
                 ROOT / 'apps/web/vite.config.ts', ROOT / 'pnpm-lock.yaml',
                 ROOT / 'tests/fixtures/device-exports.json'):
        source(path)
    print(json.dumps({'output': str(output)}), flush=True)
    try:
        async with local_vite(output) as origin, async_playwright() as runtime:
            report['owned_origin'] = origin
            report['chromium_executable'] = runtime.chromium.executable_path
            browser = await runtime.chromium.launch(headless=True)
            report['chromium_version'] = browser.version
            try:
                context = await browser.new_context()
                async def local_only(route):
                    parsed = urlsplit(route.request.url)
                    if parsed.hostname == '127.0.0.1' and parsed.port == urlsplit(origin).port and not parsed.path.startswith('/api/'):
                        path = unquote(parsed.path)
                        if path.startswith('/src/'):
                            source(ROOT / 'apps/web' / path.lstrip('/'))
                        elif path.startswith('/@fs/'):
                            source(Path(path.removeprefix('/@fs/')))
                        await route.continue_()
                    else:
                        event('blocked-request', url=route.request.url)
                        blocked.append(parsed.path); await route.abort()
                await context.route('**/*', local_only)
                page = await context.new_page()
                page.on('console', lambda message: event('console', type=message.type, text=message.text, location=message.location))
                page.on('pageerror', lambda error: event('pageerror', error=error.stack or str(error)))
                page.on('requestfailed', lambda request: event('requestfailed', url=request.url, error=request.failure))
                page.on('response', lambda response: event('http-error', url=response.url, status=response.status) if response.status >= 400 else None)
                await page.add_init_script("window.__EXPORT_INIT__={ready:true,at:Date.now()};")
                try:
                    for phase in ('setup', 'reload'):
                        report['phase'] = phase
                        event('navigation')
                        if phase == 'setup':
                            await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-export.html').as_posix(), safe='/:'))
                        else: await page.reload()
                        try:
                            await page.wait_for_function('window.__EXPORT_RESULT__ !== undefined', timeout=60000)
                        finally:
                            try:
                                snapshot = await asyncio.wait_for(page.evaluate('({url:location.href,readyState:document.readyState,init:window.__EXPORT_INIT__,progress:window.__EXPORT_PROGRESS__,result:window.__EXPORT_RESULT__})'), 5)
                                report['snapshots'].append(snapshot)
                            except Exception as error:
                                event('snapshot-error', error=repr(error))
                        result = await page.evaluate('window.__EXPORT_RESULT__')
                        assert result['ok'] and result['phase'] == phase, result
                        raw = base64.b64decode(result.pop('assetExportBase64'), validate=True)
                        (output / (phase + '-assets.charx')).write_bytes(raw)
                        fixture = next(item for item in json.loads((ROOT / 'tests/fixtures/device-exports.json').read_text(encoding='utf-8')) if item['name'] == 'png-and-audio-assets')
                        assert decode_output(raw, 'application/zip') == {'files': fixture['outputs']['charx']['files']}
                        documents, assets = parse_import('browser-assets.charx', raw)
                        assert documents[0].name == fixture['document']['name']
                        assert all(assets[id][0] == base64.b64decode(value['base64']) for id, value in fixture['assets'].items())
                        result['native_asset_roundtrip'] = True
                        result['blocked_network_requests'] = len(blocked); results.append(result)
                        assert len(result['formats']) == 6 and result['sourceDuplicateChoice'] and not blocked
                        event('validated')
                finally:
                    await context.close()
                    report['owned_context_closed'] = True
            finally:
                await browser.close()
                report['owned_browser_closed'] = not browser.is_connected()
        report['ok'] = True
    except BaseException:
        report['error'] = traceback.format_exc()
        raise
    finally:
        report['source_after'] = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                                  if (ROOT / name).is_file() else None for name in report['source_before']}
        report['source_unchanged'] = report['source_before'] == report['source_after']
        report['ok'] = report['ok'] and report['source_unchanged']
        (output / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
        (output / 'diagnostics.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'ok': report['ok'], 'passed': len(results), 'output': str(output),
                          'source_unchanged': report['source_unchanged'], 'error': report.get('error')}), flush=True)
    assert report['source_unchanged'], 'Export inputs changed during the run; source-sensitive acceptance is invalid'
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__': asyncio.run(main())
