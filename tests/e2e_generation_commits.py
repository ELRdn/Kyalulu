"""Actual Device generation/IDB contracts; only inference transport is synthetic."""
import asyncio
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from urllib.parse import quote, urlsplit

from playwright.async_api import async_playwright
from browser_fixture_server import local_vite

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / '.artifacts/generation-commits-browser'


def fingerprint():
    """Source content, independent of Git availability and timestamps."""
    paths = sorted(set(
        list((ROOT / 'apps/web/src').rglob('*'))
        + list((ROOT / 'packages/schemas/src').rglob('*'))
        + [Path(__file__), ROOT / 'tests/fixtures/generation-commits.html',
           ROOT / 'tests/browser_fixture_server.py', ROOT / 'apps/web/vite.config.ts']))
    rows = {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths if path.is_file() and path.suffix in {'.ts', '.tsx', '.json', '.html', '.py'}}
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()
    return {'sha256': digest, 'files': rows}


def assert_bounded_write_parsers(rows):
    for row in rows:
        assert any(parser['mode'] == 'readwrite' for parser in row['observation']['parsers']), (
            row.get('id', 'reload'), 'Missing observed generation/recovery write source parser')
    parsers = [parser for row in rows for parser in row['observation']['parsers']]
    writes = [parser for parser in parsers if parser['mode'] == 'readwrite']
    assert writes, 'Observer must exercise actual source parsers in generation write transactions'
    assert all(parser['finished'] and parser['maximum_root_messages'] == 0 for parser in writes), [
        parser for parser in writes if not parser['finished'] or parser['maximum_root_messages'] != 0]
    # Root retention alone cannot prove callback projection; inspect the actual helper results too.
    readonly = [parser for parser in parsers if parser['mode'] == 'readonly']
    return {'write_parsers': len(writes), 'write_source_root_messages_max': 0,
            'readonly_source_parsers': len(readonly),
            'readonly_source_root_messages_max': max((parser['maximum_root_messages'] for parser in readonly), default=0),
            'full_actor_bounded': False, 'actor_context_retention_measured': True}


def assert_actor_context(rows):
    projections = [item for row in rows for item in row['observation']['actor_projections']]
    preservation = [item for row in rows for item in row['observation']['historical_preservation']]
    inputs = [item for row in rows for item in row['observation']['worker_inputs']]
    assert projections and preservation and inputs, 'Missing direct projection, original byte or Worker evidence'
    assert all(item['older_snapshot_fields'] == 0 and item['latest_complete'] and item['metadata_complete'] and item['header_complete'] for item in projections)
    assert all(item['stored_bytes_equal'] and item['decoded_equal'] for item in preservation)
    assert all(item['full_original_reference_equal'] and item['settings_equal'] and item['grammar_equal'] for item in inputs)
    successes = [row for row in rows if row.get('outcome') == 'success']
    assert len(successes) == 12 and all(row['observation']['worker_inputs'][0]['raw_prompt_equal'] for row in successes)
    large = [row for row in rows if row.get('large_snapshots')]
    assert len(large) == 1 and max(item['historical_snapshot_bytes'] for item in large[0]['observation']['actor_projections']) >= 4 * 1024 * 1024
    assert len(rows) == 84, 'Original 36 normal + 36 fault + 12 reload matrix must remain'
    return {'direct_idb_helper_reads': len(projections), 'historical_byte_comparisons': len(preservation),
            'worker_full_original_comparisons': len(inputs), 'raw_prompt_exact_comparisons': len(successes),
            'multiple_mib_snapshot_cases': len(large), 'maximum_historical_snapshot_bytes': max(item['historical_snapshot_bytes'] for item in projections),
            'older_snapshots_retained': 0, 'latest_complete': True, 'peak_ram_measured': False}


async def main():
    report = {'ok': False, 'cases': [], 'blocked_requests': [], 'page_errors': [], 'native_workers': [],
              'production_used': False, 'real_inference_attempts': 0,
              'limits': ['Synthetic inference Worker and fictional OPFS metadata; no model/download/provider',
                         'Actor keeps full role/content history and a complete latest message; no total peak-RAM bound is claimed',
                         'Injected receipt quota, not physical disk exhaustion; Chromium, not physical mobile hardware']}
    report['started_at'] = datetime.now(timezone.utc).isoformat()
    report['source_before'] = fingerprint()
    try:
        async with local_vite(OUTPUT) as origin, async_playwright() as runtime:
            browser = await runtime.chromium.launch(headless=True)
            report['browser_version'] = browser.version
            context = await browser.new_context(service_workers='block')
            try:
                async def guard(route):
                    url = urlsplit(route.request.url)
                    binary_model = Path(url.path).suffix.lower() in {'.gguf', '.bin', '.wasm', '.safetensors', '.onnx', '.tflite'}
                    if url.hostname == '127.0.0.1' and url.port == urlsplit(origin).port and not url.path.startswith('/api/') and not binary_model:
                        await route.continue_()
                    else:
                        report['blocked_requests'].append(route.request.url)
                        await route.abort()
                await context.route('**/*', guard)
                await context.route_web_socket('**/*', lambda socket: socket.close())
                page = await context.new_page()
                page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
                page.on('worker', lambda worker: report['native_workers'].append(worker.url))
                fixture = origin + '/@fs/' + quote((ROOT / 'tests/fixtures/generation-commits.html').as_posix(), safe='/:')

                async def load():
                    await page.goto(fixture)
                    await page.wait_for_function('window.__GENERATION_COMMITS__ !== undefined')

                await load()
                for policy in ('local', 'sync'):
                    for mode in ('legacy', 'world', 'shared'):
                        for regenerate in (False, True):
                            for outcome in ('success', 'stopped', 'invalidJSON'):
                                options = {'id': f'commit-{policy}-{mode}-{regenerate}-{outcome}', 'policy': policy,
                                           'mode': mode, 'regenerate': regenerate, 'outcome': outcome,
                                           'largeSnapshots': policy == 'local' and mode == 'legacy' and regenerate and outcome == 'success'}
                                report['current_case'] = options
                                result = await page.evaluate('(o)=>window.__GENERATION_COMMITS__.run(o)', options)
                                report['cases'].append(result)
                                print(json.dumps({'case': options['id'], 'ok': True}), flush=True)
                for policy in ('local', 'sync'):
                    for mode in ('legacy', 'world', 'shared'):
                        for fault in ('pending', 'final', 'failure', 'owner', 'revision', 'body-token'):
                            options = {'id': f'fault-{policy}-{mode}-{fault}', 'policy': policy, 'mode': mode, 'fault': fault}
                            report['current_case'] = options
                            result = await page.evaluate('(o)=>window.__GENERATION_COMMITS__.fault(o)', options)
                            if fault in ('failure', 'owner'):
                                await page.reload()
                                await page.wait_for_function('window.__GENERATION_COMMITS__ !== undefined')
                                resumed = await page.evaluate('window.__GENERATION_COMMITS__.resume()')
                                result['reload'] = {key: value for key, value in resumed.items() if key != 'observation'}
                                report['cases'].append({'id': options['id']+'-reload', 'observation': resumed['observation']})
                            report['cases'].append(result)
                            print(json.dumps({'case': options['id'], 'ok': True}), flush=True)
                assert not report['blocked_requests'] and not report['page_errors'], (report['blocked_requests'], report['page_errors'])
                assert not report['native_workers'], report['native_workers']
                report['parser_evidence'] = assert_bounded_write_parsers(report['cases'])
                report['actor_context_evidence'] = assert_actor_context(report['cases'])
            finally:
                await context.close()
                report['context_closed'] = True
                await browser.close()
                report['browser_closed'] = True
        report['vite_stopped'] = True
        report['source_after'] = fingerprint()
        assert report['source_before'] == report['source_after'], 'Sources changed during validation; rerun after parent stability announcement'
        report['fingerprint_stable'] = True
        report.pop('current_case', None)
        report['ok'] = True
    except BaseException as error:
        report['error'] = str(error)
        raise
    finally:
        report['source_after'] = fingerprint()
        report['fingerprint_stable'] = report['source_before'] == report['source_after']
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        # local_vite's finally terminates/waits for its owned process on success and exception.
        report['vite_cleanup_returned'] = True
        OUTPUT.mkdir(parents=True, exist_ok=True)
        (OUTPUT / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'report': str(OUTPUT / 'result.json'), 'cases': len(report['cases'])}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUTPUT, help='Evidence directory (legacy default preserved)')
    OUTPUT = parser.parse_args().output.resolve()
    asyncio.run(asyncio.wait_for(main(), 600))
