"""Pure regression checks for bounded sync-staging diagnostics; no browser startup."""
import asyncio
import json

from e2e_sync_staging import ROOT, StagingDiagnostics, diagnostic_snapshot, public_module_path

def test_diagnostic_bounds_and_privacy():
    from types import SimpleNamespace

    secret = 'PRIVATE_BODY_TOKEN'
    value = diagnostic_snapshot({'stage': secret, 'payload': secret, 'stages': [{'stage': 'seed', 'ms': 2}] * 100,
                                 'probes': {'network': [{'body': secret}], 'referenceReads': [secret], 'injected': 2**64,
                                            'reads': {'readonly': 3, 'readwrite': True, 'private': secret}}})
    assert secret not in json.dumps(value)
    assert len(value['stages']) == 16 and value['stage'] == 'unknown'
    assert value['probes']['injected'] == 1_000_000_000
    assert value['probes']['reads'] == {'readonly': 3, 'readwrite': 0}
    port = 12345
    assert public_module_path(f'http://127.0.0.1:{port}/src/lib/appStore.ts?token={secret}', port) == '/src/lib/appStore.ts'
    assert public_module_path(f'http://user:{secret}@127.0.0.1:{port}/src/lib/appStore.ts#private', port) == '/src/lib/appStore.ts'
    assert public_module_path(f'http://127.0.0.1:{port}/@fs/{ROOT.as_posix()}/tests/fixtures/sync-staging.html?auth={secret}', port) == '/tests/fixtures/sync-staging.html'
    assert public_module_path(f'http://127.0.0.1:{port}/private/{secret}', port) == '[other-loopback]'
    assert public_module_path(f'http://127.0.0.1:{port}/src/' + 'x' * 300 + '.ts', port) == '[other-loopback]'
    assert public_module_path(f'http://127.0.0.1:{port}/src/%2e%2e/private.ts', port) == '[other-loopback]'
    assert public_module_path(f'https://example.com/{secret}', port) is None
    assert public_module_path(f'https://127.0.0.1:{port}/src/test.ts', port) is None
    assert public_module_path(f'http://127.0.0.1:{port + 1}/src/test.ts', port) is None
    assert public_module_path('http://127.0.0.1:bad/src/test.ts', port) is None
    diagnostics = StagingDiagnostics(port)
    # Requests are identity-keyed by Playwright; these stand-ins need the same hashing contract.
    class Request:
        def __init__(self, url):
            self.url = url
    requests = [Request(f'http://127.0.0.1:{port}/src/test.ts?key={secret}') for _ in range(100)]
    for request in requests:
        diagnostics.request(request)
        diagnostics.failure(request, 503)
    assert len(diagnostics.pending) == 64 and len(diagnostics.failures) == 16
    assert diagnostics.omitted == 36 and diagnostics.http_errors == 100
    diagnostics.finish(requests[0])
    diagnostics.failure(requests[1])
    assert diagnostics.failed == 1
    diagnostics.console(SimpleNamespace(text='__SYNC_STAGING_DIAGNOSTIC__' + json.dumps({'stage': 'stageSyncBatch', 'probes': {'injected': 1}})))
    assert diagnostics.latest['probes']['injected'] == 1
    diagnostics.console(SimpleNamespace(text='__SYNC_STAGING_DIAGNOSTIC__' + 'x' * 8192))
    assert diagnostics.latest['stage'] == 'stageSyncBatch'
    assert secret not in json.dumps([diagnostics.latest, diagnostics.failures, list(diagnostics.pending.values())])


def test_diagnostic_snapshot_deadline():
    from unittest.mock import AsyncMock, Mock, patch

    def complete(coroutine):
        # Immediate mocks test the deadline path without opening asyncio's Windows loopback socketpair.
        try:
            coroutine.send(None)
        except StopIteration as done:
            return done.value
        raise AssertionError('Diagnostics waited beyond its bounded wait')

    diagnostics, page, task = StagingDiagnostics(12345), Mock(), Mock()
    diagnostics.latest = {'stage': 'stageSyncBatch'}
    with patch.object(asyncio, 'create_task', return_value=task), patch.object(asyncio, 'wait', AsyncMock(return_value=(set(), {task}))) as wait:
        result = complete(diagnostics.snapshot(page))
    wait.assert_awaited_once_with({task}, timeout=3)
    task.cancel.assert_called_once()
    task.add_done_callback.assert_called_once()
    assert result['page_snapshot'] == 'timeout' and result['last_checkpoint']['stage'] == 'stageSyncBatch'
    task.result.return_value = {'stage': 'after-snapshot'}
    with patch.object(asyncio, 'create_task', return_value=task), patch.object(asyncio, 'wait', AsyncMock(return_value=({task}, set()))):
        result = complete(diagnostics.snapshot(page))
        assert result['page_snapshot'] == 'ok' and result['last_checkpoint']['stage'] == 'after-snapshot'
        task.result.side_effect = RuntimeError('PRIVATE_BODY_TOKEN')
        result = complete(diagnostics.snapshot(page))
        assert result['page_snapshot'] == 'unavailable' and 'PRIVATE_BODY_TOKEN' not in json.dumps(result)
