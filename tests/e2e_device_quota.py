"""Real Chromium IndexedDB quota rejection and retry; never fills a physical disk."""
import asyncio
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/device-quota-browser'
QUOTA_BYTES = 128 * 1024


async def main():
    report = {'ok': False, 'quota_bytes': QUOTA_BYTES, 'results': []}
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            report['origin'] = origin
            browser = await runtime.chromium.launch(headless=True)
            report['browser'] = browser.version
            try:
                for owner in ('quota-owner-a', 'quota-owner-b'):
                    for operation in ('new', 'update'):
                        result = {'owner': owner, 'operation': operation, 'ok': False}
                        report['results'].append(result)
                        context = await browser.new_context(service_workers='block')
                        blocked, errors = [], []

                        async def local_only(route):
                            parsed = urlsplit(route.request.url)
                            # Only fixture/module loading is allowed; reject Vite's API proxy too.
                            if (f'{parsed.scheme}://{parsed.netloc}' == origin
                                    and not parsed.path.lower().startswith('/api')):
                                await route.continue_()
                            else:
                                blocked.append(parsed.path)
                                await route.abort()

                        cdp = None
                        try:
                            await context.route('**/*', local_only)
                            await context.route_web_socket('**/*', lambda socket: socket.close())
                            page = await context.new_page()
                            page.set_default_timeout(30000)
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            fixture = quote((ROOT / 'tests/fixtures/device-quota.html').as_posix(), safe='/:')
                            url = f'{origin}/@fs/{fixture}?owner={owner}&operation={operation}'
                            await page.goto(url)
                            await page.wait_for_function('window.quotaFixture !== undefined')
                            cdp = await context.new_cdp_session(page)
                            result['before'] = await cdp.send('Storage.getUsageAndQuota', {'origin': origin})
                            await cdp.send('Storage.overrideQuotaForOrigin', {'origin': origin, 'quotaSize': QUOTA_BYTES})
                            result['limited'] = await cdp.send('Storage.getUsageAndQuota', {'origin': origin})
                            assert result['limited']['overrideActive'], result['limited']
                            assert result['limited']['quota'] == QUOTA_BYTES, result['limited']
                            # Set the cap before IDB opens: Chromium can cache a pre-granted write budget.
                            before = await page.evaluate('quotaFixture.seed()')
                            result['seeded'] = await cdp.send('Storage.getUsageAndQuota', {'origin': origin})
                            result['native_probe'] = await page.evaluate('quotaFixture.probe()')
                            probe = result['native_probe']
                            assert probe['failure'] and any(event['name'] == 'QuotaExceededError' for event in probe['events']), (
                                'CDP override did not produce a native IndexedDB quota rejection', probe)
                            result['probe_rollback'] = await page.evaluate('before => quotaFixture.preserved(before)', before)
                            result['limited_save'] = await page.evaluate('quotaFixture.attempt()')
                            assert not result['limited_save']['ok'], 'saveEntity unexpectedly succeeded under real quota'
                            result['rollback'] = await page.evaluate('before => quotaFixture.preserved(before)', before)
                            await page.reload()
                            await page.wait_for_function('window.quotaFixture !== undefined')
                            result['reload_rollback'] = await page.evaluate('before => quotaFixture.preserved(before)', before)
                            await cdp.send('Storage.overrideQuotaForOrigin', {'origin': origin})
                            result['released'] = await cdp.send('Storage.getUsageAndQuota', {'origin': origin})
                            assert not result['released']['overrideActive'], result['released']
                            result['retry'] = await page.evaluate('quotaFixture.attempt()')
                            assert result['retry']['ok'], result['retry']
                            result['recovery'] = await page.evaluate('before => quotaFixture.recovered(before)', before)
                            await page.reload()
                            await page.wait_for_function('window.quotaFixture !== undefined')
                            result['reload_recovery'] = await page.evaluate('before => quotaFixture.recovered(before)', before)
                            result['blocked_network_requests'], result['page_errors'] = blocked, errors
                            assert not blocked and not errors, (blocked, errors)
                            result['ok'] = True
                        finally:
                            try:
                                if cdp is not None:
                                    await cdp.send('Storage.overrideQuotaForOrigin', {'origin': origin})
                                    await cdp.detach()
                            finally:
                                await context.close()
                                result['context_closed'] = True
            finally:
                await browser.close()
                report['browser_closed'] = not browser.is_connected()
        report['vite_stopped'] = True
        report['ok'] = True
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / 'results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
        print(json.dumps({'ok': report['ok'], 'browser': report.get('browser'),
                          'passed': sum(result['ok'] for result in report['results']),
                          'results': str(OUTPUT / 'results.json'), 'error': report.get('error')}))


if __name__ == '__main__':
    asyncio.run(asyncio.wait_for(main(), 120))
