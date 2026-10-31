"""Independent bounded Device branch acceptance in disposable Chromium/IndexedDB."""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import traceback
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/device-branches.html'
BASELINE = '6787167'
# Audited against git show 6787167 during fixture creation; runtime works without .git.
FROZEN_SHA256 = {
    'branch': 'ac1b91d19211f2d9a793eddc1dab8d3907806afad6c3b1f77b239e78a3249e29',
    'receive': '6d6a86675221a63c4153821960d96a713af747965dc5ea0ea7e2e8055fff0d52',
    'schemas': 'ba425f0ac105a42407ae2e16451cdef8ceb963cad4d35e6f70434c4184087d8d',
    'executable': '58279ab6cabf122594dab69a55c1d3b858dd0e7660aef740363f2b8cc9ed1ea9',
}
SCENARIOS = (
    'flow-legacy-local', 'flow-legacy-sync', 'flow-world-local', 'flow-world-sync',
    'flow-shared-local', 'flow-shared-sync', 'user-end-fallback', 'user-no-next-before',
    'missing-id', 'missing-assistant-snapshot', 'missing-user-snapshot',
    'late-corrupt-part', 'late-missing-part', 'invalid-discarded-json',
    'late-rewrite-corruption', 'pending-copy',
    'quota-local', 'quota-sync', 'owner-switch', 'cas-revision', 'cas-token', 'contracts',
    'low-sequence', 'missing-sequence',
)
INPUTS = (FIXTURE, Path(__file__), ROOT / 'tests/fixtures/memory-source-projection.html',
          ROOT / 'tests/fixtures/storage-fixture.ts', ROOT / 'tests/browser_fixture_server.py')


def fingerprints():
    paths = set(INPUTS)
    for folder in ('apps/web/src/lib', 'apps/web/src/mobile', 'packages/schemas/src'):
        paths.update(path for path in (ROOT / folder).rglob('*')
                     if path.is_file() and path.suffix in ('.ts', '.tsx', '.json'))
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(paths)}


def verify_frozen_oracle():
    """Verify audited immutable blocks and executable without requiring Git history."""
    html = FIXTURE.read_text(encoding='utf-8')
    frozen = json.loads(re.search(r'<script id="frozen" type="application/json">(.*?)</script>', html, re.S).group(1))
    assert frozen['baseline'] == BASELINE
    hashes = {key: hashlib.sha256(frozen[key].encode()).hexdigest() for key in FROZEN_SHA256}
    assert hashes == FROZEN_SHA256, 'Frozen source/executable differs from audited baseline hashes'
    source = (frozen['schemas'] + frozen['receive']).replace('export ', '') + '\nfunction frozenBranch(source,body,sequence){\n' + frozen['branch'] + (
        '\nlet number=sequence;const copy=rebindConversation(receiveConversation(payload,undefined,()=>++number),id);'
        'return {payload:copy,sequence:number};\n}')
    compiler = "const fs=require('fs'),ts=require('./apps/web/node_modules/typescript');process.stdout.write(ts.transpileModule(fs.readFileSync(0,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)"
    compiled = subprocess.run(['node', '-e', compiler], cwd=ROOT, input=source, text=True,
                              capture_output=True, check=True).stdout
    assert frozen['executable'].replace('\r\n', '\n') == compiled.replace('\r\n', '\n'), 'Frozen executable differs from frozen TypeScript'
    return hashes


async def main(output, scenarios, pilot):
    output.mkdir(parents=True, exist_ok=True)
    # /@fs/ HTML keeps inline modules untransformed; a standard import map resolves its bare dependency.
    resolved = subprocess.run(['node', '-e', "process.stdout.write(require.resolve('zod/package.json',{paths:[process.argv[1]]}))",
                               str(ROOT / 'packages/schemas')], cwd=ROOT, text=True, capture_output=True, check=True).stdout
    zod_entry = Path(resolved).parent / 'index.js'
    assert zod_entry.is_file(), 'Installed Zod ESM entry missing'
    fixture_route = '/@fs/' + quote(FIXTURE.as_posix(), safe='/:')
    import_map = '<script type="importmap">' + json.dumps({'imports': {
        'zod': '/@fs/' + quote(zod_entry.as_posix(), safe='/:@')}}) + '</script>\n'
    report = {'ok': False, 'acceptance': False, 'pilot': pilot, 'scenarios': [],
              'baseline': BASELINE, 'oracle_sha256': verify_frozen_oracle(),
              'inputs_sha256_before': fingerprints(), 'network_denied': [], 'page_errors': [],
              'websockets_closed': [], 'request_errors': [], 'console_errors': [],
              'owned_contexts_closed': 0, 'browser_restarts': 0,
              'zod_esm_entry': str(zod_entry), 'zod_esm_sha256': hashlib.sha256(zod_entry.read_bytes()).hexdigest(),
              'vite_stopped': False, 'production_used': False, 'real_inference_attempts': 0,
              'limits': ['Fictional >=3 MiB / 80 messages / multiple 1 MiB parts; no 1 GB, heap/RSS or physical-device claim',
                         'Graceful page reload or owned Chromium close/relaunch; no crash/power-loss recovery claim',
                         'Metadata/scalars and one callback message may remain whole',
                         'Quota is an injected native IDB boundary failure, not physical disk exhaustion',
                         'CAS uses a real queued competing IDB transaction, not a two-device scheduling claim']}

    def save():
        (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')

    save()
    try:
        async with local_vite(output) as origin, async_playwright() as runtime:
            report['chromium_executable'] = runtime.chromium.executable_path

            async def guard(route):
                url = urlsplit(route.request.url)
                if url.scheme == 'http' and url.netloc == urlsplit(origin).netloc and url.path != '/api' and not url.path.startswith('/api/'):
                    if url.path == fixture_route:
                        html = FIXTURE.read_text(encoding='utf-8')
                        assert html.count('<script type="module">') == 1
                        await route.fulfill(status=200, content_type='text/html',
                                            body=html.replace('<script type="module">', import_map + '<script type="module">', 1))
                    else:
                        await route.continue_()
                else:
                    report['network_denied'].append(route.request.url)
                    await route.abort()

            async def launch(profile):
                context = await runtime.chromium.launch_persistent_context(profile, headless=True, service_workers='block')
                await context.route('**/*', guard)

                async def close_socket(socket):
                    report['websockets_closed'].append(socket.url)
                    parsed = urlsplit(socket.url)
                    if parsed.netloc != urlsplit(origin).netloc or parsed.path == '/api' or parsed.path.startswith('/api/'):
                        report['network_denied'].append(socket.url)
                    await socket.close()

                await context.route_web_socket('**/*', close_socket)
                page = await context.new_page()
                page.set_default_timeout(30000)
                page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                page.on('requestfailed', lambda request: report['request_errors'].append({'url': request.url, 'error': request.failure}))
                page.on('console', lambda message: report['console_errors'].append(message.text) if message.type == 'error' else None)
                report['chromium_version'] = context.browser.version
                return context, page

            async def close(context):
                browser = context.browser
                await context.close()
                report['owned_contexts_closed'] += 1
                assert not browser.is_connected(), 'Owned Chromium remained connected after close'

            url = origin + fixture_route
            for scenario in scenarios:
                started = time.monotonic()
                result = {'scenario': scenario, 'ok': False, 'inputs_sha256_before': fingerprints()}
                with tempfile.TemporaryDirectory(prefix='branch-profile-', dir=output) as profile:
                    context = page = None
                    try:
                        context, page = await launch(profile)
                        await page.goto(url)
                        await page.wait_for_function('window.__DEVICE_BRANCHES__ !== undefined')
                        result['oracle_self_check'] = await page.evaluate('window.__DEVICE_BRANCHES__.selfCheck()')
                        result.update(await asyncio.wait_for(page.evaluate('(name)=>window.__DEVICE_BRANCHES__.run(name)', scenario), 120))
                        if scenario.startswith('quota-'):
                            await close(context)
                            context = None
                            context, page = await launch(profile)
                            report['browser_restarts'] += 1
                            await page.goto(url)
                            result['reopen_kind'] = 'Graceful Chromium close/relaunch, same disposable profile'
                        else:
                            await page.reload()
                            result['reopen_kind'] = 'Page reload, fresh module state'
                        await page.wait_for_function('window.__DEVICE_BRANCHES__ !== undefined')
                        result['reopen'] = await page.evaluate('window.__DEVICE_BRANCHES__.resume()')
                    except Exception:
                        result['ok'] = False
                        result['error'] = traceback.format_exc()
                        if page and not page.is_closed():
                            try:
                                result['progress'] = await page.evaluate('window.__BRANCH_PROGRESS__ ?? null')
                                result['module_resources'] = await page.evaluate('performance.getEntriesByType("resource").map(r=>({url:r.name,bytes:r.transferSize}))')
                                await page.screenshot(path=str(output / (scenario + '-failure.png')))
                            except Exception:
                                result['evidence_error'] = traceback.format_exc()
                    finally:
                        if context:
                            await close(context)
                result['inputs_sha256_after'] = fingerprints()
                result['inputs_unchanged_during_case'] = result['inputs_sha256_before'] == result['inputs_sha256_after']
                result['ok'] = result['ok'] and result['inputs_unchanged_during_case']
                result['seconds'] = round(time.monotonic() - started, 3)
                report['scenarios'].append(result)
                save()
                print(json.dumps({key: result[key] for key in ('scenario', 'ok', 'seconds')}), flush=True)
        report['vite_stopped'] = True
    finally:
        report['inputs_sha256_after'] = fingerprints()
        report['inputs_unchanged_during_run'] = report['inputs_sha256_before'] == report['inputs_sha256_after']
        report['ok'] = (len(report['scenarios']) == len(scenarios) and all(case['ok'] for case in report['scenarios'])
                        and not report['network_denied'] and not report['page_errors'] and not report['request_errors'] and report['vite_stopped']
                        and report['inputs_unchanged_during_run'])
        report['acceptance'] = report['ok'] and not pilot and tuple(scenarios) == SCENARIOS
        save()
    print(json.dumps({'ok': report['ok'], 'acceptance': report['acceptance'], 'report': str(output / 'result.json')}), flush=True)
    assert report['ok'], f'Branch verification failed; inspect {output / "result.json"}'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Evidence directory; defaults to system TEMP')
    parser.add_argument('--scenario', action='append', choices=SCENARIOS)
    parser.add_argument('--pilot', action='store_true', help='Development probe, never marks final acceptance')
    parser.add_argument('--self-check', action='store_true', help='Check frozen sources/executable without starting a browser')
    args = parser.parse_args()
    if args.self_check:
        print(json.dumps({'frozen_oracle_verified': verify_frozen_oracle()}))
    else:
        output = args.output or Path(tempfile.mkdtemp(prefix='kyalulu-device-branches-'))
        print(json.dumps({'output': str(output)}), flush=True)
        asyncio.run(asyncio.wait_for(main(output, args.scenario or SCENARIOS, args.pilot), 1800))
