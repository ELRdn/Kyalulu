"""Independent fictional fixed-outbox checks in installed Chromium/IndexedDB.

Preparation: .venv/Scripts/python tests/e2e_outbox_stream.py --prepare-only
After the implementation owner freezes sources, use the printed fingerprint:
  .venv/Scripts/python tests/e2e_outbox_stream.py --frozen-source <sha256>
No browser installation, provider, model, or production access is permitted.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import tempfile
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = (
    'wire', 'resume', 'committed', 'inline', 'legacy-inline', 'legacy-large-receipt',
    'cached-receipt', 'cached-withdrawn-receipt', 'sync-resume', 'sync-committed', 'sync-inline',
    'sync-legacy-large-receipt',
    *(f'{boundary}-{change}' for boundary in ('hash', 'open', 'part', 'last')
      for change in ('owner', 'busy', 'consent', 'manifest', 'revision', 'control', 'count', 'request')),
    *(f'late-{failure}' for failure in ('missing', 'corrupt', 'sha', 'json', 'utf8', 'depth', 'shape', 'payload-array', 'payload-scalar')),
    'upload-late-missing', 'upload-late-corrupt',
    *(f'source-{change}' for change in ('owner', 'busy', 'manifest', 'revision', 'control', 'count', 'request')),
    *(f'sync-{change}' for change in ('owner', 'busy', 'consent', 'manifest', 'revision', 'control')),
    *(f'sync-last-{change}' for change in ('owner', 'busy', 'consent', 'manifest', 'revision', 'control', 'count', 'request')),
    'serialize-manifest-owner', 'serialize-part-busy', 'serialize-commit-owner',
)


def fingerprint():
    files = sorted((ROOT / 'apps/web/src').rglob('*'))
    files += [ROOT / name for name in (
        'apps/web/package.json', 'apps/web/vite.config.ts', 'pnpm-lock.yaml',
        'tests/browser_fixture_server.py', 'tests/e2e_outbox_stream.py',
        'tests/fixtures/outbox-stream.html')]
    records = {p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
               for p in files if p.is_file()}
    raw = json.dumps(records, sort_keys=True, separators=(',', ':')).encode()
    return {'sha256': hashlib.sha256(raw).hexdigest(), 'files': records}


async def main(args):
    before = fingerprint()
    output = Path(tempfile.mkdtemp(prefix='kyalulu-outbox-stream-'))
    report = {'source_before': before, 'source_after': None, 'results': [],
              'preparation_only': args.prepare_only, 'accept_current_source': args.accept_current_source, 'output': str(output),
              'network_attempts': [], 'console_errors': [], 'ok': False}
    print(json.dumps({'source_fingerprint': before['sha256'], 'output': str(output)}), flush=True)
    try:
        if not args.prepare_only and not args.accept_current_source:
            assert args.frozen_source == before['sha256'], 'Frozen source fingerprint is absent or changed'
        async with local_vite(output) as origin, async_playwright() as runtime:
            executable = Path(runtime.chromium.executable_path)
            assert executable.is_file(), 'Existing Playwright Chromium required; do not download'
            report['browser_executable'] = str(executable)
            browser = await runtime.chromium.launch(headless=True)
            report['browser_version'] = browser.version
            port = urlsplit(origin).port
            try:
                for scenario in (('prepare',) if args.prepare_only else SCENARIOS):
                    assert fingerprint() == before, f'Source changed before {scenario}'
                    context = await browser.new_context(service_workers='block', accept_downloads=False)
                    pending = set()

                    async def local_only(route):
                        task = asyncio.current_task()
                        pending.add(task)
                        try:
                            parsed = urlsplit(route.request.url)
                            forbidden = ('/api/', '/models/', '/model/', '/downloads/', '/download/', '/inference', '/provider')
                            model_file = parsed.path.lower().endswith(('.gguf', '.safetensors', '.onnx', '.pth', '.pt', '.bin'))
                            if (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1'
                                    and parsed.port == port and not parsed.path.startswith(forbidden) and not model_file):
                                await route.continue_()
                            else:
                                report['network_attempts'].append({'scenario': scenario, 'url': route.request.url})
                                await route.abort()
                        finally:
                            pending.discard(task)

                    await context.route('**/*', local_only)
                    try:
                        page = await context.new_page()
                        page.on('pageerror', lambda error: report['console_errors'].append(str(error)))
                        url = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/outbox-stream.html').as_posix(), safe='/:')
                        await page.goto(url)
                        await page.wait_for_function('window.__OUTBOX_STREAM_READY__ === true', timeout=30000)
                        # Preparation exercises real IDB seeding/oracle and guards without importing the new API.
                        result = await asyncio.wait_for(page.evaluate('(s)=>window.outboxStreamRun(s)', scenario), 90)
                        report['results'].append(result)
                        assert result['ok'], result
                        if scenario in ('resume', 'sync-resume'):
                            await page.reload()
                            await page.wait_for_function('window.__OUTBOX_STREAM_READY__ === true', timeout=30000)
                            resumed = await asyncio.wait_for(page.evaluate('(s)=>window.outboxStreamRun(s,true)', scenario), 90)
                            report['results'].append(resumed)
                            assert resumed['ok'], resumed
                        assert not report['network_attempts'], 'Real API/model/external request attempted'
                        assert not report['console_errors'], report['console_errors']
                        assert fingerprint() == before, f'Source changed during {scenario}'
                        print(json.dumps({'scenario': scenario, 'ok': True}), flush=True)
                    finally:
                        if pending:
                            await asyncio.gather(*tuple(pending), return_exceptions=True)
                        await context.close()
            finally:
                await browser.close()
        report['ok'] = True
    except BaseException as error:
        report['error'] = repr(error)
        raise
    finally:
        report['source_after'] = fingerprint()
        report['source_unchanged'] = before == report['source_after']
        report['ok'] = report['ok'] and report['source_unchanged']
        (output / 'results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps({'ok': report['ok'], 'results': len(report['results']),
                          'source_unchanged': report['source_unchanged'], 'output': str(output)}), flush=True)
        assert report['source_unchanged'], 'Source changed during browser run; discard source-sensitive acceptance'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare-only', action='store_true')
    mode.add_argument('--frozen-source')
    mode.add_argument('--accept-current-source', action='store_true', help='CI only: adopt the current source fingerprint and require it throughout')
    asyncio.run(main(parser.parse_args()))
