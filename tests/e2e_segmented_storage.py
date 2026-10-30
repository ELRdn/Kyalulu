"""Disposable Chromium/IndexedDB acceptance for segmented persistence."""
import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ('roundtrip', 'depth-boundary', 'corrupt-missing', 'corrupt-hash', 'corrupt-size', 'owner-fence', 'kind-selection', 'kind-selection-owner', 'pending-stream', 'pending-quota', 'pending-corrupt', 'pending-owner', 'pending-legacy', 'pending-json', 'proof-read', 'proof-invalid', 'proof-owner', 'summary-read', 'summary-corrupt', 'summary-owner', 'page-read', 'page-cursor', 'page-owner', 'page-corrupt-json', 'page-corrupt-first', 'page-corrupt-last', 'quota', 'collisions', 'upgrade-v1', 'upgrade-v2', 'blocked', 'late-success', 'versionchange', 'receive-quota', 'receive-generation', 'ack-quota', 'deletion-controls', 'migration', 'device-branch', 'pin-ui', 'outbox-corrupt')


SCENARIOS += ('metadata-stream', 'metadata-quota', 'metadata-corrupt', 'metadata-owner', 'metadata-conflict', 'metadata-legacy', 'metadata-domain')
SCENARIOS += ('memory-verify-stream', 'memory-verify-corrupt', 'memory-verify-policy', 'memory-verify-owner', 'memory-verify-quota')


def record_failure(output, scenario, browser, error, blocked, errors, console):
    report = {'ok': False, 'scenario': scenario, 'browser': browser, 'exception': str(error),
              'blocked_requests': [urlsplit(url)._replace(query='', fragment='').geturl() for url in blocked],
              'page_errors': errors, 'console_errors': console[-10:]}
    print(json.dumps(report), flush=True)
    try:
        output.mkdir(parents=True, exist_ok=True)
        (output / 'failure.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    except OSError as failure:
        print(json.dumps({'failure_report_write_error': str(failure)}), flush=True)


async def main():
    results = []
    output=ROOT / '.artifacts/segmented-storage-browser'
    with TemporaryDirectory(prefix='kyalulu-segmented-') as directory:
        async with local_vite(Path(directory)) as origin, async_playwright() as runtime:
            port = urlsplit(origin).port
            browser = await runtime.chromium.launch(headless=True)
            try:
                for scenario in SCENARIOS:
                    print(json.dumps({'scenario': scenario, 'stage': 'start'}), flush=True)
                    context = await browser.new_context(service_workers='block')
                    blocked, errors, console = [], [], []

                    async def local_only(route):
                        parsed = urlsplit(route.request.url)
                        if parsed.hostname == '127.0.0.1' and parsed.port == port and not parsed.path.startswith('/api/'):
                            await route.continue_()
                        else:
                            blocked.append(route.request.url)
                            await route.abort()

                    await context.route('**/*', local_only)
                    try:
                        page = await context.new_page()
                        page.on('pageerror', lambda error: errors.append(str(error)))
                        page.on('console', lambda message: console.append(message.text) if message.type == 'error' else None)
                        path = quote((ROOT / 'tests/fixtures/segmented-storage.html').as_posix(), safe='/:')
                        await page.goto(origin + '/@fs/' + path + '?scenario=' + scenario)
                        await page.wait_for_function('window.__SEGMENTED__ !== undefined', timeout=60000)
                        result = await page.evaluate('window.__SEGMENTED__')
                        result.update(blocked_network_requests=len(blocked), page_errors=errors)
                        results.append(result)
                        print(json.dumps({'scenario': scenario, 'stage': 'complete', 'ok': result['ok']}), flush=True)
                    except Exception as error:
                        record_failure(output, scenario, browser.version, error, blocked, errors, console)
                        raise
                    finally:
                        await context.close()
            finally:
                await browser.close()
    output.mkdir(parents=True, exist_ok=True)
    (output / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'passed': sum(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results),
                      'browser': browser.version, 'results': results}, ensure_ascii=False, indent=2))
    assert len(results) == len(SCENARIOS)
    assert all(r['ok'] and not r['blocked_network_requests'] and not r['page_errors'] for r in results), results


if __name__ == '__main__':
    asyncio.run(main())
