"""Real IndexedDB/Response/file-byte export and document reload without providers."""
import asyncio
import base64
import json
from pathlib import Path
import sys
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-export-browser'
sys.path.insert(0, str(ROOT / 'scripts'))
from build_device_export_fixture import decode_output
from python.core.portable_formats import parse_import


async def main():
    results, blocked = [], []
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            try:
                context = await browser.new_context()
                async def local_only(route):
                    parsed = urlsplit(route.request.url)
                    if parsed.hostname == '127.0.0.1' and parsed.port == urlsplit(origin).port and not parsed.path.startswith('/api/'):
                        await route.continue_()
                    else:
                        blocked.append(parsed.path); await route.abort()
                await context.route('**/*', local_only)
                page = await context.new_page()
                await page.goto(origin + '/@fs/' + quote((ROOT / 'tests/fixtures/device-export.html').as_posix(), safe='/:'))
                for phase in ('setup', 'reload'):
                    if phase == 'reload': await page.reload()
                    await page.wait_for_function('window.__EXPORT_RESULT__ !== undefined', timeout=60000)
                    result = await page.evaluate('window.__EXPORT_RESULT__')
                    assert result['ok'] and result['phase'] == phase, result
                    raw = base64.b64decode(result.pop('assetExportBase64'), validate=True)
                    (OUTPUT / (phase + '-assets.charx')).write_bytes(raw)
                    fixture = next(item for item in json.loads((ROOT / 'tests/fixtures/device-exports.json').read_text(encoding='utf-8')) if item['name'] == 'png-and-audio-assets')
                    assert decode_output(raw, 'application/zip') == {'files': fixture['outputs']['charx']['files']}
                    documents, assets = parse_import('browser-assets.charx', raw)
                    assert documents[0].name == fixture['document']['name']
                    assert all(assets[id][0] == base64.b64decode(value['base64']) for id, value in fixture['assets'].items())
                    result['native_asset_roundtrip'] = True
                    result['blocked_network_requests'] = len(blocked); results.append(result)
                    assert len(result['formats']) == 6 and result['sourceDuplicateChoice'] and not blocked
                await context.close()
            finally: await browser.close()
    finally:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / 'results.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps({'passed': len(results), 'results': results}))


if __name__ == '__main__': asyncio.run(main())
