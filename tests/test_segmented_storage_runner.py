"""Failure diagnostics must identify the case without replacing accepted results."""
import json
from pathlib import Path

from e2e_segmented_storage import record_failure


def test_segmented_failure_records_context_and_redacts_request_queries(tmp_path, capsys):
    accepted = tmp_path / 'results.json'
    accepted.write_bytes(b'previous fictional result')
    blocked = ['https://fixture.invalid/module?token=synthetic-private-value#fragment']
    errors = ['Fictional module import failure']
    console = [str(i) for i in range(15)]
    record_failure(tmp_path, 'fixture-case', 'fixture-browser', TimeoutError('fictional timeout'), blocked, errors, console)
    report = json.loads((tmp_path / 'failure.json').read_text(encoding='utf-8'))
    assert report == {'ok': False, 'scenario': 'fixture-case', 'browser': 'fixture-browser',
                      'exception': 'fictional timeout', 'blocked_requests': ['https://fixture.invalid/module'],
                      'page_errors': errors, 'console_errors': console[-10:]}
    assert json.loads(capsys.readouterr().out) == report
    assert 'synthetic-private-value' not in json.dumps(report)
    assert blocked[0].endswith('synthetic-private-value#fragment')
    assert accepted.read_bytes() == b'previous fictional result'


def test_segmented_failure_diagnostics_survive_unwritable_output(tmp_path, monkeypatch, capsys):
    def unavailable(*args, **kwargs):
        raise OSError('fictional unavailable disk')
    monkeypatch.setattr(Path, 'mkdir', unavailable)
    record_failure(tmp_path, 'fixture-case', 'fixture-browser', TimeoutError('original failure'), [], [], [])
    records = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert records[0]['exception'] == 'original failure' and records[0]['ok'] is False
    assert records[1] == {'failure_report_write_error': 'fictional unavailable disk'}
