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
            'readonly_test_full_replay_parsers': sum(parser['observer_phase'] == 'test-full-source-replay' for parser in readonly),
            'readonly_test_actor_helper_parsers': sum(parser['observer_phase'] == 'test-actor-helper' for parser in readonly),
            'readonly_source_root_messages_max': max((parser['maximum_root_messages'] for parser in readonly), default=0),
            'full_actor_bounded': False, 'actor_context_retention_measured': True}


def assert_actor_context(rows):
    projections = [item for row in rows for item in row['observation']['actor_projections']]
    body_projections = [item for row in rows for item in row['observation']['actor_body_projections']]
    sources = [item for row in rows for item in row['observation']['source_inputs']]
    preservation = [item for row in rows for item in row['observation']['historical_preservation']]
    inputs = [item for row in rows for item in row['observation']['worker_inputs']]
    assert projections and preservation and inputs, 'Missing direct projection, original byte or Worker evidence'
    assert all(item['older_snapshot_fields'] == 0 and item['latest_complete'] and item['metadata_complete'] and item['header_complete'] for item in projections)
    assert all(item['stored_bytes_equal'] and item['decoded_equal'] for item in preservation)
    assert body_projections and all(item['direct_helper_probe'] and item['tail_equal'] and item['latest_complete']
                                   and item['metadata_complete'] and item['header_complete']
                                   and item['retained_messages'] <= item['limit'] and not item['full_actor_bounded']
                                   and not item['api_call_retention_observed'] for item in body_projections)
    assert {item['limit'] for item in body_projections} == {2, 1001}
    assert all(item['cap_exercised'] and item['retained_messages'] == 2 for item in body_projections if item['limit'] == 2)
    assert sources and len(sources) == len(inputs)
    assert all(item['format'] == 'gguf-source@1' and item['output_tokens'] == 256
               and item['descriptors_content_absent'] and item['original_descriptors_equal']
               and item['full_original_runs_equal'] and item['observer_full_replay']
               and not item['observer_replay_is_production_memory_evidence']
               and all(set(run) == {'run', 'role', 'bytes'} for run in item['descriptors'])
               and len(item['runtime_materializations']) == 2 for item in sources)
    assert all(item['fitted_original_reference_equal'] and item['mandatory_only_first_packet'] and item['bounded_history_after_mock_count']
               and item['full_source_original_reference_equal'] and item['raw_prompt_reference_is_original_unmerged']
               and not item['native_count_proof'] and item['settings_equal'] and item['grammar_equal'] for item in inputs)
    successes = [row for row in rows if row.get('outcome') == 'success']
    assert len(successes) == 12 and all(row['observation']['worker_inputs'][0]['raw_prompt_equal'] for row in successes)
    completions = [item for row in successes for item in row['observation']['public_completions']]
    assert len(completions) == 12 and all(item['full_payload_equal'] and item['diagnostics_absent']
                                        and item['saved_diagnostics_preserved'] for item in completions)
    large = [row for row in rows if row.get('large_snapshots')]
    assert len(large) == 1 and max(item['historical_snapshot_bytes'] for item in large[0]['observation']['actor_projections']) >= 4 * 1024 * 1024
    assert len(rows) == 84, 'Original 36 normal + 36 fault + 12 reload matrix must remain'
    return {'direct_idb_helper_reads': len(projections), 'historical_byte_comparisons': len(preservation),
            'actor_body_projection_evidence': {'direct_helper_reads': len(body_projections), 'api_limit': 1001,
                                               'api_call_retention_observed': False, 'small_cap_exercised': True,
                                               'matrix_1001_cap_exercised': False},
            'source_descriptor_comparisons': len(sources), 'full_source_original_comparisons': len(sources),
            'observer_full_replay_is_test_only': True, 'observer_replay_is_production_memory_evidence': False,
            'worker_fitted_original_comparisons': len(inputs), 'raw_prompt_exact_comparisons': len(successes),
            'public_completion_comparisons': len(completions),
            'public_completion_json_bytes': [item['event_json_bytes'] for item in completions],
            'saved_receipt_json_bytes': [item['saved_receipt_json_bytes'] for item in completions],
            'multiple_mib_snapshot_cases': len(large), 'maximum_historical_snapshot_bytes': max(item['historical_snapshot_bytes'] for item in projections),
            'older_snapshots_retained': 0, 'latest_complete': True, 'peak_ram_measured': False, 'full_actor_bounded': False}


async def main():
    report = {'ok': False, 'cases': [], 'blocked_requests': [], 'page_errors': [], 'native_workers': [],
              'production_used': False, 'real_inference_attempts': 0, 'native_count_proof': False, 'full_actor_bounded': False,
              'limits': ['Synthetic inference Worker and fictional OPFS metadata; no model/download/provider',
                         'Normal GGUF receives content-free source descriptors; the observer deliberately replays every run for independent old-history equivalence, not production memory evidence',
                         'Bounded actor body helper is probed separately at limits 1001 and 2; the 80-message matrix does not reach the 1001 cap or observe the API caller retention directly',
                         'ONNX/Research arrays, complete metadata/latest/UI and whole-capacity/peak-RAM bounds remain unproved; full_actor_bounded stays false',
                         'Injected receipt quota, not physical disk exhaustion; Chromium, not physical mobile hardware',
                         'GGUF matrix uses fictional counts; stock Mocha has forced-mock overflow and mock-rescue cases, neither is native count proof']}
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
                report['mandatory_overflow'] = await page.evaluate('window.__GENERATION_COMMITS__.mandatoryOverflow()')
                assert report['mandatory_overflow']['synthetic_completion_calls'] == 0 and report['mandatory_overflow']['originals_retained']
                assert not report['mandatory_overflow']['native_count_proof']
                assert report['mandatory_overflow']['source_original_reference_equal']
                report['mandatory_mock_rescue'] = await page.evaluate('window.__GENERATION_COMMITS__.mandatoryMockRescue()')
                assert report['mandatory_mock_rescue']['mandatory_bytes_preserved'] and report['mandatory_mock_rescue']['raw_prompt_preserved']
                assert report['mandatory_mock_rescue']['source_original_reference_equal'] and not report['mandatory_mock_rescue']['native_count_proof']
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
