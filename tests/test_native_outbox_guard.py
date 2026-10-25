"""Outbox checks read indexed control state, never the private conversation body."""
import json
import sqlite3

import pytest

from test_native_sync_client import pc
from python.cloud.store import CloudError
from python.storage.native_sync import NativeSync


def sync_for(path):
    return NativeSync(path, 'https://app.test', '11111111-1111-4111-8111-111111111111', 'fixture-sync-token-at-least-twenty')


@pytest.fixture
def staged(pc):
    with sqlite3.connect(pc) as db:
        for _ in range(28): db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user',?)", ('large fixture ' * 6000,))
    sync = sync_for(pc)
    sync.configure(['selected'], True, consent=True)
    return sync, sync.stage()


def test_chunk_checks_and_status_never_parse_the_large_outbox_and_use_a_covering_index(staged, monkeypatch):
    sync, pending = staged
    original = sync.meta
    def small_only(db, key, default=None):
        assert key != 'outbox', 'A chunk/status check loaded the entire outbox'
        return original(db, key, default)
    monkeypatch.setattr(sync, 'meta', small_only)
    monkeypatch.setattr(sync, 'stage', lambda: pytest.fail('A chunk check restaged the body'))
    for _ in range(20):
        sync._transfer_active(pending['request_id'])
        assert sync.status()['pending']
    with sync.transaction() as db:
        statements = []
        db.set_trace_callback(statements.append)
        assert sync.outbox_header(db)['request_id'] == pending['request_id']
        db.set_trace_callback(None)
        code = db.execute('EXPLAIN ' + statements[-1]).fetchall()
        root = db.execute("SELECT rootpage FROM runtime.sqlite_master WHERE name='native_sync_meta'").fetchone()[0]
        table_cursors = {row[2] for row in code if row[1] == 'OpenRead' and row[3] == root}
        assert not any(row[1] == 'Column' and row[2] in table_cursors for row in code)
        assert not any(row[1] == 'Function' and 'json_' in str(row[5]) for row in code)


def test_existing_outbox_backfills_without_modifying_its_body_and_legacy_writes_update_guards(pc):
    sync = sync_for(pc)
    pending = {'request_id': 'legacy', 'captures': [{'native_session_id': 'selected'}], 'changes': [{'deleted': False}]}
    stored = json.dumps(pending)
    with sqlite3.connect(pc) as db:
        db.execute('CREATE TABLE native_sync_meta(namespace TEXT,key TEXT,value TEXT,PRIMARY KEY(namespace,key))')
        for key, value in [('enabled', 'true'), ('selected', '["selected"]'), ('outbox', stored)]:
            db.execute('INSERT INTO native_sync_meta VALUES(?,?,?)', (sync.namespace, key, value))
    assert sync.status()['pending']
    sync._transfer_active('legacy')
    with sync.transaction() as db:
        assert db.execute("SELECT value FROM runtime.native_sync_meta WHERE namespace=? AND key='outbox'", (sync.namespace,)).fetchone()[0] == stored
        assert db.execute('SELECT session_id FROM runtime.native_sync_outbox_sources WHERE namespace=?', (sync.namespace,)).fetchone()[0] == 'selected'
        # Simulate an older writer which knows only the original metadata table.
        db.execute("UPDATE runtime.native_sync_meta SET value=? WHERE namespace=? AND key='outbox'", (json.dumps({**pending, 'withdrawn': True}), sync.namespace))
    with pytest.raises(CloudError, match='sync_request_canceled'): sync._transfer_active('legacy')
    with sync.transaction() as db:
        db.execute("DELETE FROM runtime.native_sync_meta WHERE namespace=? AND key='outbox'", (sync.namespace,))
        assert not db.execute('SELECT 1 FROM runtime.native_sync_outbox_sources WHERE namespace=?', (sync.namespace,)).fetchone()
    assert not sync.status()['pending']


@pytest.mark.asyncio
async def test_purging_a_session_fences_its_staged_body_without_rewriting_it(staged):
    from python.storage.conversation import purge
    sync, pending = staged
    with sync.transaction() as db: before = sync.meta(db, 'outbox')
    await purge('selected')
    with pytest.raises(CloudError, match='sync_request_canceled'): sync._transfer_active(pending['request_id'])
    with sync.transaction() as db: assert sync.meta(db, 'outbox') == before
    assert sync.status()['pending']


def test_selection_change_and_request_replacement_fence_the_original_transfer(staged):
    sync, pending = staged
    with sync.transaction() as db: sync.save(db, 'selected', [])
    with pytest.raises(CloudError, match='sync_request_canceled'): sync._transfer_active(pending['request_id'])
    with sync.transaction() as db:
        sync.save(db, 'selected', ['selected'])
        sync.save(db, 'outbox', {**pending, 'request_id': 'replacement'})
    with pytest.raises(CloudError, match='sync_request_canceled'): sync._transfer_active(pending['request_id'])
    sync._transfer_active('replacement')


def test_incomplete_source_mapping_cannot_authorize_a_chunk(staged):
    sync, pending = staged
    with sync.transaction() as db:
        sync.save(db, 'outbox', {**pending, 'captures': [*pending['captures'], {'native_session_id': 'private'}]})
    with pytest.raises(CloudError, match='invalid_sync_outbox'): sync._transfer_active(pending['request_id'])
