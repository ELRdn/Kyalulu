"""Disposable Core archives only; no production directory or real provider."""
import json
import hashlib
import sqlite3
import zipfile
from contextlib import closing
from pathlib import Path
import pytest
import httpx
from test_native_sync_client import pc, enrolled, LostReceipt
from test_native_sync_scopes import accounts
from python.local_backup import backup, restore
from python.storage.runtime_lock import RuntimeLock
from python.cloud.store import CloudError


async def prepared(accounts, pc, tmp_path):
    assert pc.resolve().is_relative_to(tmp_path.resolve())
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    await sync.run()
    archive = tmp_path / 'fixture-older-core.zip'
    backup(pc.parent, archive)
    return sync, archive


@pytest.mark.asyncio
async def test_whole_restore_retains_the_current_unsent_request_and_local_recovery_archive(accounts, pc, tmp_path):
    sync, archive = await prepared(accounts, pc, tmp_path)
    with closing(sqlite3.connect(pc)) as db, db:
        db.execute("UPDATE chat_history SET content='UNSENT-AFTER-BACKUP' WHERE session_id='selected'")
    pending = sync.stage()
    before = Path(restore(pc.parent, archive))
    assert before.resolve().is_relative_to(tmp_path.resolve()) and before.is_file()
    with sync.transaction() as db:
        retained = sync.meta(db, 'outbox')
    assert retained and retained['request_id'] == pending['request_id']
    assert retained['changes'] == pending['changes'] and retained['withdrawn'] is True
    assert not sync.status()['enabled'] and sync.status()['restores']['selected']


@pytest.mark.asyncio
async def test_whole_restore_does_not_revive_an_already_settled_outbox(accounts, pc, tmp_path):
    sync, _ = await prepared(accounts, pc, tmp_path)
    with closing(sqlite3.connect(pc)) as db, db:
        db.execute("UPDATE chat_history SET content='STAGED-BEFORE-BACKUP' WHERE session_id='selected'")
    sync.stage()
    archive = tmp_path / 'fixture-pending-core.zip'
    backup(pc.parent, archive)
    sync.configure(['selected'], False)
    await sync.settle_withdrawn()
    assert not sync.status()['pending']
    restore(pc.parent, archive)
    assert not sync.status()['pending'] and not sync.status()['enabled']


@pytest.mark.asyncio
async def test_whole_restore_keeps_received_tombstones_monotonic(accounts, pc, tmp_path):
    sync, archive = await prepared(accounts, pc, tmp_path)
    with sync.transaction() as db:
        db.execute('INSERT INTO runtime.native_sync_received VALUES(?,?,7,1)', (sync.namespace, 'fixture-erased-entity'))
    restore(pc.parent, archive)
    with sync.transaction() as db:
        row = db.execute('SELECT revision,deleted FROM runtime.native_sync_received WHERE namespace=? AND id=?', (sync.namespace, 'fixture-erased-entity')).fetchone()
    assert row and tuple(row) == (7, 1)


@pytest.mark.asyncio
async def test_whole_restore_rejects_conflicting_account_claims_without_changing_current_data(accounts, pc, tmp_path):
    sync, _ = await prepared(accounts, pc, tmp_path)
    other = await enrolled(accounts, pc, 1)
    staged = tmp_path / 'fixture-other-account'
    staged.mkdir()
    with closing(sqlite3.connect(pc)) as source, closing(sqlite3.connect(staged / 'data.db')) as target:
        source.backup(target)
    with closing(sqlite3.connect(staged / 'data.db')) as db, db:
        for table in ('unified_native_owners', 'unified_native_links', 'native_sync_meta', 'native_sync_received'):
            db.execute(f'UPDATE {table} SET namespace=? WHERE namespace=?', (other.namespace, sync.namespace))
    archive = tmp_path / 'fixture-other-account.zip'
    backup(staged, archive)
    with closing(sqlite3.connect(pc)) as db:
        before = list(db.iterdump())
    with pytest.raises(ValueError, match='backup_sync_owner_conflict'):
        restore(pc.parent, archive)
    with closing(sqlite3.connect(pc)) as db:
        assert list(db.iterdump()) == before
        assert db.execute("SELECT namespace FROM unified_native_owners WHERE session_id='selected'").fetchone()[0] == sync.namespace
    assert archive.is_file() and len(list((tmp_path / 'backups').glob('before-restore-*.zip'))) == 1


@pytest.mark.asyncio
async def test_running_runtime_rejects_restore_before_creating_a_recovery_archive(accounts, pc, tmp_path):
    _, archive = await prepared(accounts, pc, tmp_path)
    recovery = tmp_path / 'backups'
    with RuntimeLock(pc.parent), pytest.raises(ValueError, match='runtime_already_running'):
        restore(pc.parent, archive)
    assert not recovery.exists() or not list(recovery.iterdir())


@pytest.mark.asyncio
@pytest.mark.parametrize('applied', [False, True])
async def test_core_pending_is_receipt_only_until_review_then_becomes_a_separate_copy(accounts, pc, tmp_path, applied):
    sync, archive = await prepared(accounts, pc, tmp_path)
    cloud, owners = accounts
    original = cloud.state.unified.pull(owners[0])['changes'][0]
    cloud.state.store.admin_grant(owners[0], 321, 'core-fixture-balance')
    balance = cloud.state.store.balance(owners[0])
    with closing(sqlite3.connect(pc)) as db, db:
        db.execute("UPDATE chat_history SET content='UNSENT-CORE-EDIT' WHERE session_id='selected'")
    pending = sync.stage()
    if applied:
        sync.transport = LostReceipt(cloud)
        with pytest.raises(httpx.ReadError):
            await sync.run()
    restore(pc.parent, archive)
    confirmations = sync.status()['restores']
    sync.transport = httpx.MockTransport(lambda _: pytest.fail('Core restore must stay offline'))
    assert await sync.run() == {'phase': 'off'}
    with pytest.raises(CloudError, match='restored_session_confirmation_required'):
        sync.configure(['selected'], True, consent=True)
    with pytest.raises(CloudError, match='restore_receipt_pending'):
        sync.configure(['selected'], True, consent=True, restore_confirmations=confirmations)
    requests = []
    class ReceiptOnly(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request):
            assert request.url.path.endswith('/sync/cancel/' + pending['request_id']) and request.content == b'{}'
            requests.append(request.url.path)
            return await httpx.ASGITransport(cloud).handle_async_request(request)
    sync.transport = ReceiptOnly()
    await sync.settle_withdrawn()
    assert len(requests) == 1 and not sync.status()['pending']
    with closing(sqlite3.connect(pc)) as db:
        assert db.execute("SELECT content FROM chat_history WHERE session_id='selected'").fetchone()[0] == 'SELECTED'
    sync.configure(['selected'], True, consent=True, restore_confirmations=confirmations)
    sync.transport = httpx.ASGITransport(cloud)
    await sync.run()
    changes = cloud.state.unified.pull(owners[0])['changes']
    assert len(changes) == 2 and len({c['id'] for c in changes}) == 2
    old = next(c for c in changes if c['id'] == original['id'])
    assert old['payload']['messages'][0]['content'] == ('UNSENT-CORE-EDIT' if applied else 'SELECTED')
    assert cloud.state.store.balance(owners[0]) == balance


@pytest.mark.asyncio
async def test_core_retains_newer_accounts_links_cursor_and_opt_out_state(accounts, pc, tmp_path):
    first, archive = await prepared(accounts, pc, tmp_path)
    other = await enrolled(accounts, pc, 1)
    other.configure(['private'], True, consent=True)
    await other.run()
    with first.transaction() as db:
        first.save(db, 'excluded', ['fixture-excluded'])
        first.save(db, 'cursor', 87)
        links = [tuple(r) for r in db.execute('SELECT * FROM runtime.unified_native_links ORDER BY namespace,session_id')]
    restore(pc.parent, archive)
    assert first.status()['cursor'] == 87
    assert not first.status()['enabled'] and not other.status()['enabled']
    assert other.status()['selected'] == ['private'] and set(other.status()['restores']) == {'private'}
    with first.transaction() as db:
        assert first.meta(db, 'excluded') == ['fixture-excluded']
        assert [tuple(r) for r in db.execute('SELECT * FROM runtime.unified_native_links ORDER BY namespace,session_id')] == links
        assert not db.execute('SELECT * FROM runtime.unified_local_links').fetchall()
    with pytest.raises(CloudError, match='sync_account_copy_required'):
        first.configure(['private'], True, consent=True)


@pytest.mark.asyncio
async def test_core_unions_old_and_current_tombstones_and_disables_orphan_namespaces(accounts, pc, tmp_path):
    sync, _ = await prepared(accounts, pc, tmp_path)
    with sync.transaction() as db:
        db.execute('INSERT INTO runtime.native_sync_received VALUES(?,?,9,1)', (sync.namespace, 'fixture-deleted'))
        db.execute('INSERT INTO runtime.native_sync_meta VALUES(?,?,?)', ('0' * 64, 'enabled', 'true'))
    archive = tmp_path / 'fixture-tombstones.zip'
    backup(pc.parent, archive)
    with sync.transaction() as db:
        db.execute('UPDATE runtime.native_sync_received SET revision=7,deleted=0 WHERE id=?', ('fixture-deleted',))
    restore(pc.parent, archive)
    with sync.transaction() as db:
        assert tuple(db.execute('SELECT revision,deleted FROM runtime.native_sync_received WHERE id=?', ('fixture-deleted',)).fetchone()) == (9, 1)
        assert db.execute("SELECT value FROM runtime.native_sync_meta WHERE namespace=? AND key='enabled'", ('0' * 64,)).fetchone()[0] == 'false'


@pytest.mark.asyncio
async def test_core_deletion_records_from_both_databases_prevent_revival(accounts, pc, tmp_path):
    from python.local_backup import erase_conversations
    sync, _ = await prepared(accounts, pc, tmp_path)
    with closing(sqlite3.connect(pc)) as db, db:
        erase_conversations(db, ['private'])
    archive = tmp_path / 'fixture-deletion.zip'
    backup(pc.parent, archive)
    with closing(sqlite3.connect(pc)) as db, db:
        db.execute("DELETE FROM session_deletions WHERE session_id='private'")
        erase_conversations(db, ['selected'])
    restore(pc.parent, archive)
    with closing(sqlite3.connect(pc)) as db:
        assert {r[0] for r in db.execute('SELECT session_id FROM session_deletions')} == {'selected', 'private'}
        assert db.execute('SELECT COUNT(*) FROM chat_history').fetchone()[0] == 0
    assert not sync.status()['enabled']


@pytest.mark.asyncio
@pytest.mark.parametrize('failure', ['asset_validation', 'new_asset', 'database', 'recovery_archive'])
async def test_failed_core_promotion_keeps_db_assets_input_and_independent_recovery(accounts, pc, tmp_path, monkeypatch, failure):
    import python.local_backup as core
    assets = pc.parent / 'library_assets'
    assets.mkdir()
    older = assets / hashlib.sha256(b'older-fixture-media').hexdigest()
    older.write_bytes(b'older-fixture-media')
    sync, archive = await prepared(accounts, pc, tmp_path)
    with closing(sqlite3.connect(pc)) as db, db:
        db.execute("UPDATE chat_history SET content='KEEP-AFTER-FAILED-RESTORE' WHERE session_id='selected'")
    sync.stage()
    # Different content has a different ID; the older asset is archive-only.
    older.rename(tmp_path / 'retained-older-fixture-media')
    asset = assets / hashlib.sha256(b'current-fixture-media').hexdigest()
    asset.write_bytes(b'current-fixture-media')
    sentinel = pc.parent / 'unrelated-fixture.txt'
    sentinel.write_text('keep')
    with closing(sqlite3.connect(pc)) as db:
        before = list(db.iterdump())
    input_bytes = archive.read_bytes()
    if failure == 'asset_validation':
        def unreadable(*_):
            raise OSError('fixture unreadable media')
        monkeypatch.setattr(core.hashlib, 'file_digest', unreadable)
    elif failure == 'new_asset':
        rename = Path.rename
        def reject_move(self, target):
            if self.parent.name == 'library_assets' and self.parent.parent.name == 'restored':
                raise OSError('fixture media promotion failed')
            return rename(self, target)
        monkeypatch.setattr(Path, 'rename', reject_move)
    elif failure == 'database':
        connect = sqlite3.connect
        class FailedBackup(sqlite3.Connection):
            def backup(self, target, **kwargs):
                def interrupt(*_):
                    raise OSError('fixture interrupted SQLite promotion')
                return super().backup(target, pages=1, progress=interrupt)
        def open_db(path, *args, **kwargs):
            if Path(path).name == 'data.db' and Path(path).parent.name == 'restored':
                kwargs['factory'] = FailedBackup
            return connect(path, *args, **kwargs)
        monkeypatch.setattr(sqlite3, 'connect', open_db)
    else:
        def full_disk(*_):
            raise OSError('fixture no space for recovery archive')
        monkeypatch.setattr(core, 'backup', full_disk)
    with pytest.raises(OSError, match='fixture'):
        restore(pc.parent, archive)
    with closing(sqlite3.connect(pc)) as db:
        assert list(db.iterdump()) == before
    assert asset.read_bytes() == b'current-fixture-media' and sentinel.read_text() == 'keep'
    assert archive.read_bytes() == input_bytes
    recoveries = list((tmp_path / 'backups').glob('before-restore-*.zip'))
    if failure == 'recovery_archive':
        assert not recoveries
    else:
        assert len(recoveries) == 1
        with zipfile.ZipFile(recoveries[0]) as recovered:
            assert recovered.read('library_assets/' + asset.name) == b'current-fixture-media'
            snapshot = tmp_path / 'fixture-recovery.db'
            snapshot.write_bytes(recovered.read('data.db'))
        with closing(sqlite3.connect(snapshot)) as db:
            assert list(db.iterdump()) == before


@pytest.mark.asyncio
@pytest.mark.parametrize('existing', [False, True])
async def test_archived_enrollment_stays_offline_without_current_sync_state(accounts, pc, tmp_path, existing):
    sync = await enrolled(accounts, pc)
    sync.configure(['selected'], True, consent=True)
    sync.stage()
    archive = tmp_path / 'fixture-enrolled.zip'
    backup(pc.parent, archive)
    target = tmp_path / 'fixture-fresh-runtime'
    if existing:
        target.mkdir()
        with closing(sqlite3.connect(target / 'data.db')) as db:
            db.execute('CREATE TABLE fixture_legacy(value TEXT)')
    restore(target, archive)
    with closing(sqlite3.connect(target / 'data.db')) as db:
        meta = {r[0]: json.loads(r[1]) for r in db.execute('SELECT key,value FROM native_sync_meta WHERE namespace=?', (sync.namespace,))}
        assert meta['enabled'] is False and meta['restore:selected']
        if existing:
            assert 'outbox' not in meta
        else:
            assert meta['outbox']['withdrawn'] is True


@pytest.mark.asyncio
async def test_encrypted_cloud_core_restore_requires_review_and_keeps_control_database(accounts, tmp_path, monkeypatch):
    import time
    from dataclasses import replace
    from python.cloud.backups import Backups
    from python.storage.context import CloudStorageContext, storage_context
    from python.storage import db as storage
    from test_native_sync_scopes import client
    cloud, owners = accounts
    owner = owners[0]
    store, unified = cloud.state.store, cloud.state.unified
    monkeypatch.setattr(store, 'config', replace(store.config, backup_root=tmp_path / 'fixture-offsite'))
    with store.transaction() as db:
        db.execute("UPDATE accounts SET plan='pro',plan_until=? WHERE id=?", (time.time() + 86400, owner))
    ctx = CloudStorageContext.for_owner(store.config.root / 'tenants', owner)
    with storage_context(ctx):
        await storage.init_db()
    path = ctx.directory / 'data.db'
    assert path.resolve().is_relative_to(tmp_path.resolve())
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("INSERT INTO session_settings(session_id) VALUES('selected')")
        db.execute("INSERT INTO chat_history(session_id,role,content) VALUES('selected','user','CLOUD-BEFORE-BACKUP')")
        db.execute("INSERT INTO session_settings(session_id) VALUES('erased-source')")
        result = {'reply': 'retained cloud reply',
                  'memory': {'candidates': [{'id': 'gone', 'source_session_id': 'erased-source', 'content': 'fixture cloud secret'}]},
                  'validation': {'ok': False, 'retries': 1, 'errors': ['schema error: fixture cloud secret']}}
        db.execute("INSERT INTO generations(generation_id,session_id,fingerprint,status,result_json) "
                   "VALUES('retained','selected','','completed',?)", (json.dumps(result),))
    unified.configure_runtime(owner, 0, ['selected'], True, runtime_path=path)
    original = unified.pull(owner, runtime_path=path)['changes'][0]
    backups = Backups(store)
    archive = backups.create(owner, path, force=True)
    async with client(cloud) as browser:
        response = await browser.delete('/api/chat/sessions/erased-source/data')
        assert response.status_code == 200, response.text
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("UPDATE chat_history SET content='CLOUD-CURRENT' WHERE session_id='selected'")
    unified.pull(owner, runtime_path=path)
    store.admin_grant(owner, 321, 'cloud-core-fixture-balance')
    with store.transaction() as db:
        protected = {table: [tuple(r) for r in db.execute(f'SELECT * FROM {table}')]
                     for table in ('accounts', 'credit_lots', 'funds', 'operations', 'private_budgets', 'admin_grants',
                                   'secrets', 'app_runtime_consent', 'app_entities', 'app_sync_devices')}
    async with client(cloud) as browser:
        response = await browser.post(f'/api/cloud/backups/{archive}/restore')
        assert response.status_code == 200, response.text
    with store.transaction() as db:
        for table, rows in protected.items():
            assert [tuple(r) for r in db.execute(f'SELECT * FROM {table}')] == rows
    with closing(sqlite3.connect(path)) as db:
        encoded = db.execute("SELECT mapping FROM unified_runtime_links WHERE session_id='selected'").fetchone()[0]
        assert json.loads(encoded)['restored_from_snapshot'] is True
        assert db.execute("SELECT content FROM chat_history WHERE session_id='selected'").fetchone()[0] == 'CLOUD-BEFORE-BACKUP'
        redacted = json.loads(db.execute("SELECT result_json FROM generations WHERE generation_id='retained'").fetchone()[0])
        assert redacted['reply'] == 'retained cloud reply'
        assert redacted['validation'] == {'ok': False, 'retries': 1, 'errors': []}
        assert 'fixture cloud secret' not in json.dumps(redacted)
        assert not db.execute("SELECT 1 FROM session_settings WHERE session_id='erased-source'").fetchone()
        assert not db.execute('SELECT * FROM unified_local_links').fetchall()
    with pytest.raises(CloudError, match='sync_restored_session_confirmation_required'):
        unified.pull(owner, runtime_path=path)
    result = unified.pull(owner)
    assert len(result['changes']) == 1 and result['changes'][0]['payload']['messages'][0]['content'] == 'CLOUD-CURRENT'
    unified.configure_runtime(owner, 1, ['selected'], True, runtime_path=path)
    result = unified.pull(owner, runtime_path=path)
    assert len(result['changes']) == 2 and len({c['id'] for c in result['changes']}) == 2
    assert next(c for c in result['changes'] if c['id'] == original['id'])['payload']['messages'][0]['content'] == 'CLOUD-CURRENT'
    assert 'fixture cloud secret' not in json.dumps(result)
    with closing(sqlite3.connect(path)) as db:
        assert json.loads(db.execute("SELECT result_json FROM generations WHERE generation_id='retained'").fetchone()[0]) == redacted
    assert len(backups.list(owner)) == 2


@pytest.mark.parametrize('corruption', ['path', 'duplicate', 'database'])
def test_invalid_core_input_never_changes_current_data_or_creates_recovery(pc, tmp_path, corruption):
    assert pc.resolve().is_relative_to(tmp_path.resolve())
    with closing(sqlite3.connect(pc)) as db:
        before = list(db.iterdump())
    archive = tmp_path / 'fixture-corrupt-core.zip'
    with zipfile.ZipFile(archive, 'w') as output:
        output.writestr('manifest.json', json.dumps({'format': 'kyalulu-core', 'version': 1}))
        if corruption == 'path':
            output.writestr('../outside.txt', 'invalid')
        elif corruption == 'duplicate':
            with pytest.warns(UserWarning, match='Duplicate name'):
                output.writestr('manifest.json', json.dumps({'format': 'kyalulu-core', 'version': 1}))
        else:
            output.writestr('data.db', b'not-a-sqlite-database')
    with pytest.raises((ValueError, sqlite3.DatabaseError)):
        restore(pc.parent, archive)
    with closing(sqlite3.connect(pc)) as db:
        assert list(db.iterdump()) == before
    assert not (tmp_path / 'backups').exists() and not (tmp_path / 'outside.txt').exists()
