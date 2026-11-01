"""Real owned-process termination; fictional Core files only, never power-loss proof."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import zipfile
from contextlib import closing

import pytest


def _worker(root, boundary):
    root = Path(root).resolve(strict=True)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'runtime'))
    from python.local_backup import restore

    connect = sqlite3.connect

    def pause():
        (root / 'ready.json').write_text(json.dumps({
            'pid': os.getpid(), 'parent_pid': os.getppid(),
            'root': str(root), 'boundary': boundary,
        }), encoding='utf-8')
        # The parent kills this exact Popen handle; no Python unwinding runs.
        sys.stdin.buffer.read(1)
        raise AssertionError('worker must be killed, never released')

    rename = Path.rename

    def publish(self, target):
        assert self.resolve().is_relative_to(root) and Path(target).resolve().is_relative_to(root)
        result = rename(self, target)
        if boundary == 'during_media' and Path(target).parent == root / 'pc/library_assets':
            pause()
        return result

    Path.rename = publish

    class InterruptedCopy(sqlite3.Connection):
        def backup(self, destination, **kwargs):
            def progress(status, remaining, total):
                if boundary == 'during_backup' and status == sqlite3.SQLITE_OK and 0 < remaining < total:
                    pause()

            super().backup(destination, pages=1, progress=progress)
            if boundary == 'after_db_commit':
                pause()

    def open_db(path, *args, **kwargs):
        if str(path) != ':memory:':
            path = Path(path).resolve()
            assert path.is_relative_to(root)
            if path.name == 'data.db' and path.parent.name == 'restored':
                kwargs['factory'] = InterruptedCopy
        return connect(path, *args, **kwargs)

    sqlite3.connect = open_db
    restore(root / 'pc', root / 'older.zip')
    raise AssertionError('restore returned without reaching the boundary')


def _kill_at_boundary(root, boundary):
    root = root.resolve(strict=True)
    command = [sys.executable, '-I', '-B', str(Path(__file__).resolve()),
               '--restore-worker', str(root), boundary]
    # Windows' venv redirector spawns another PID; launch its interpreter with the same venv.
    launch = {'executable': sys._base_executable,
              'env': {**os.environ, '__PYVENV_LAUNCHER__': sys.executable}} if os.name == 'nt' else {}
    process = subprocess.Popen(
        command, cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        **launch,
    )

    def kill_owned():
        assert process.pid > 0 and process.pid != os.getpid()
        assert process.args == command and Path(process.args[-2]).resolve(strict=True) == root
        assert Path(process.args[3]).resolve(strict=True) == Path(__file__).resolve()
        if process.poll() is None:
            process.kill()

    try:
        deadline = time.monotonic() + 30
        ready = None
        while time.monotonic() < deadline and process.poll() is None:
            try:
                ready = json.loads((root / 'ready.json').read_text(encoding='utf-8'))
                break
            except (FileNotFoundError, json.JSONDecodeError):
                time.sleep(.02)
        if ready is None:
            kill_owned()
            _, error = process.communicate(timeout=10)
            pytest.fail('worker did not reach restore boundary: ' + error.decode(errors='replace'))
        assert ready == {'pid': process.pid, 'parent_pid': os.getpid(),
                         'root': str(root), 'boundary': boundary}
        kill_owned()
        _, error = process.communicate(timeout=10)
        assert process.returncode != 0 and not error, error.decode(errors='replace')
        return ready
    finally:
        kill_owned()
        process.communicate(timeout=10)


def _state(data):
    with closing(sqlite3.connect(data / 'data.db')) as db:
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        epoch, asset = db.execute('SELECT epoch,asset FROM fixture_state').fetchone()
        assert db.execute('SELECT id FROM library_assets').fetchall() == [(asset,)]
        meta = {key: json.loads(value) for key, value in db.execute('SELECT key,value FROM native_sync_meta')}
        receipts = db.execute('SELECT * FROM native_sync_received ORDER BY namespace,id').fetchall()
        owners = db.execute('SELECT * FROM unified_native_owners ORDER BY session_id').fetchall()
    media = {p.name: p.read_bytes().decode() for p in (data / 'library_assets').iterdir()}
    return {'epoch': epoch, 'asset': asset, 'meta': meta,
            'receipts': receipts, 'owners': owners, 'media': media}


@pytest.mark.parametrize('boundary', ['during_media', 'during_backup', 'after_db_commit'])
def test_killed_core_restore_keeps_a_coherent_pair_and_independent_recovery(tmp_path, boundary):
    from python.local_backup import backup, restore
    from python.storage.entity_bridge import Links
    from python.storage.native_sync import prepare_meta
    from python.storage.runtime_lock import RuntimeLock

    root = tmp_path.resolve(strict=True)
    data = root / 'pc'
    assets = data / 'library_assets'
    assets.mkdir(parents=True)
    namespace = 'a' * 64
    names = {epoch: hashlib.sha256(epoch.encode()).hexdigest() for epoch in ('older', 'current')}
    (assets / names['older']).write_text('older', encoding='utf-8')
    with closing(sqlite3.connect(':memory:')) as db, db:
        db.execute('ATTACH DATABASE ? AS runtime', (str(data / 'data.db'),))
        Links(db, namespace).prepare()
        prepare_meta(db)
        db.execute('CREATE TABLE runtime.fixture_state(epoch TEXT,asset TEXT,padding BLOB)')
        db.execute('INSERT INTO runtime.fixture_state VALUES(?,?,zeroblob(65536))', ('older', names['older']))
        db.execute('CREATE TABLE runtime.library_assets(id TEXT PRIMARY KEY,media_type TEXT)')
        db.execute('INSERT INTO runtime.library_assets VALUES(?,?)', (names['older'], 'text/plain'))
        db.execute('INSERT INTO runtime.unified_native_owners VALUES(?,?)', ('fixture-session', namespace))
        db.execute('INSERT INTO runtime.native_sync_meta VALUES(?,?,?)', (namespace, 'enabled', 'true'))
    archive = root / 'older.zip'
    backup(data, archive)
    (assets / names['older']).rename(root / 'retained-original-media')
    (assets / names['current']).write_text('current', encoding='utf-8')
    pending = {'request_id': '00000000-0000-4000-8000-000000000001',
               'captures': [{'native_session_id': 'fixture-session'}],
               'changes': [{'payload': {'fixture_body': 'CURRENT-UNSENT'}}]}
    with closing(sqlite3.connect(data / 'data.db')) as db, db:
        db.execute('UPDATE fixture_state SET epoch=?,asset=?', ('current', names['current']))
        db.execute('UPDATE library_assets SET id=?', (names['current'],))
        db.execute('INSERT INTO native_sync_meta VALUES(?,?,?)', (namespace, 'outbox', json.dumps(pending)))
        db.execute('INSERT INTO native_sync_received VALUES(?,?,7,1)', (namespace, 'fixture-tombstone'))
        db.execute('INSERT INTO unified_native_owners VALUES(?,?)', ('current-only-session', namespace))
    before = _state(data)
    input_bytes = archive.read_bytes()
    ready = _kill_at_boundary(root, boundary)

    # Reopening uses SQLite's own recovery, with the killed writer fully reaped.
    with RuntimeLock(data):
        interrupted = _state(data)
    expected = 'older' if boundary == 'after_db_commit' else 'current'
    assert interrupted['epoch'] == expected
    assert interrupted['owners'] == before['owners']
    assert interrupted['receipts'] == before['receipts']
    assert interrupted['meta']['outbox'] == ({**pending, 'withdrawn': True} if boundary == 'after_db_commit' else pending)
    union = {names[epoch]: epoch for epoch in names}
    assert interrupted['media'] == union
    if boundary == 'after_db_commit':
        assert interrupted['meta']['enabled'] is False
        assert interrupted['meta']['restore:fixture-session']
    coherent = interrupted['media'].get(interrupted['asset']) == interrupted['epoch']

    recoveries = list((root / 'backups').glob('before-restore-*.zip'))
    assert len(recoveries) == 1 and archive.read_bytes() == input_bytes
    recovery = recoveries[0].resolve(strict=True)
    assert recovery.is_relative_to(root)
    recovery_bytes = recovery.read_bytes()
    extracted = root / 'recovery-check'
    extracted.mkdir()
    with zipfile.ZipFile(recovery) as saved:
        (extracted / 'data.db').write_bytes(saved.read('data.db'))
        (extracted / 'library_assets').mkdir()
        for name in before['media']:
            (extracted / 'library_assets' / name).write_bytes(saved.read('library_assets/' + name))
    assert _state(extracted) == before

    # Explicit offline recovery is tested separately from automatic interruption safety.
    next_recovery = Path(restore(data / '..' / 'pc', recovery)).resolve(strict=True)
    assert next_recovery.is_relative_to(root) and next_recovery.is_file()
    recovered = _state(data)
    assert recovered['epoch'] == 'current' and recovered['media'] == union
    assert recovered['meta']['outbox'] == {**pending, 'withdrawn': True}
    assert recovered['meta']['enabled'] is False and recovered['meta']['restore:fixture-session']
    assert recovered['owners'] == before['owners'] and recovered['receipts'] == before['receipts']
    assert archive.read_bytes() == input_bytes and recovery.read_bytes() == recovery_bytes
    evidence = {**ready, 'sqlite_integrity': 'ok', 'interrupted_epoch': interrupted['epoch'],
                'referenced_media_present': coherent, 'media': list(interrupted['media']),
                'independent_recovery_exact': True, 'explicit_offline_recovery': True}
    (root / 'evidence.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    print(json.dumps(evidence))
    assert coherent, 'Killed restore left current DB referencing missing media; recovery ZIP works, automatic DB/media consistency does not'


@pytest.mark.parametrize('problem,error', [
    ('archive_checksum', 'backup_asset_checksum_conflict'),
    ('current_collision', 'backup_asset_checksum_conflict'),
    ('archive_missing', 'missing_backup_asset'),
    ('current_missing', 'missing_backup_asset'),
    ('invalid_id', 'invalid_backup_asset'),
    ('nonfile_asset', 'invalid_backup_asset'),
])
def test_core_media_conflicts_fail_closed_before_any_publication(tmp_path, problem, error):
    from python.local_backup import backup, restore

    paths = {}
    for epoch in ('older', 'current'):
        data = tmp_path / epoch
        assets = data / 'library_assets'
        assets.mkdir(parents=True)
        name = hashlib.sha256(epoch.encode()).hexdigest()
        (assets / name).write_bytes(epoch.encode())
        with closing(sqlite3.connect(data / 'data.db')) as db, db:
            db.execute('CREATE TABLE library_assets(id TEXT PRIMARY KEY,media_type TEXT)')
            db.execute('INSERT INTO library_assets VALUES(?,?)', (name, 'text/plain'))
        paths[epoch] = (data, assets / name)
    older, old_asset = paths['older']
    current, current_asset = paths['current']
    if problem == 'archive_checksum':
        old_asset.write_bytes(b'bad archive checksum')
    elif problem == 'current_collision':
        (current_asset.parent / old_asset.name).write_bytes(b'conflicting original; keep it')
    elif problem == 'archive_missing':
        old_asset.rename(tmp_path / 'retained-archive-media')
    elif problem == 'current_missing':
        current_asset.rename(tmp_path / 'retained-current-media')
    elif problem == 'invalid_id':
        with closing(sqlite3.connect(older / 'data.db')) as db, db:
            db.execute("UPDATE library_assets SET id='../escape'")
    else:
        current_asset.rename(tmp_path / 'retained-current-media')
        current_asset.mkdir()
    archive = tmp_path / 'input.zip'
    backup(older, archive)
    before = {path.relative_to(tmp_path): path.read_bytes()
              for path in tmp_path.rglob('*') if path.is_file()}
    with pytest.raises(ValueError, match=error):
        restore(current, archive)
    for name, content in before.items():
        assert (tmp_path / name).read_bytes() == content
    assert {path.relative_to(tmp_path) for path in current.rglob('*') if path.is_file()} == {
        name for name in before if name.is_relative_to(Path('current'))
    } | {Path('current/.runtime.lock')}
    recovery, = (tmp_path / 'backups').glob('before-restore-*.zip')
    assert recovery.resolve().is_relative_to(tmp_path.resolve()) and recovery.is_file()


def test_partial_media_install_failure_retains_originals_and_archives(tmp_path, monkeypatch):
    from python.local_backup import backup, restore

    source, current = tmp_path / 'source', tmp_path / 'current'
    for directory in (source, current):
        (directory / 'library_assets').mkdir(parents=True)
        with closing(sqlite3.connect(directory / 'data.db')) as db, db:
            db.execute('CREATE TABLE library_assets(id TEXT PRIMARY KEY,media_type TEXT)')
            for content in ([b'archive-a', b'archive-b'] if directory == source else [b'current']):
                name = hashlib.sha256(content).hexdigest()
                (directory / 'library_assets' / name).write_bytes(content)
                db.execute('INSERT INTO library_assets VALUES(?,?)', (name, 'text/plain'))
    archive = tmp_path / 'input.zip'
    backup(source, archive)
    before = {path.name: path.read_bytes() for path in current.rglob('*') if path.is_file()}
    with closing(sqlite3.connect(current / 'data.db')) as db:
        before_dump = list(db.iterdump())
    input_bytes = archive.read_bytes()
    rename = Path.rename
    installed = []

    def fail_second(self, target):
        assert self.resolve().is_relative_to(tmp_path.resolve())
        assert Path(target).resolve().is_relative_to(tmp_path.resolve())
        if Path(target).parent == current / 'library_assets':
            if installed:
                raise OSError('fixture second media install failed')
            installed.append(Path(target))
        return rename(self, target)

    monkeypatch.setattr(Path, 'rename', fail_second)
    with pytest.raises(OSError, match='fixture second media install'):
        restore(current, archive)
    assert (current / 'data.db').read_bytes() == before['data.db']
    for name, content in before.items():
        if name != 'data.db':
            assert (current / 'library_assets' / name).read_bytes() == content
    for path in (current / 'library_assets').iterdir():
        assert hashlib.sha256(path.read_bytes()).hexdigest() == path.name
        if path.name in before:
            assert path.read_bytes() == before[path.name]
    assert installed and installed[0].is_file()
    assert archive.read_bytes() == input_bytes
    recovery, = (tmp_path / 'backups').glob('before-restore-*.zip')
    with zipfile.ZipFile(recovery) as saved:
        snapshot = tmp_path / 'independent-recovery.db'
        snapshot.write_bytes(saved.read('data.db'))
        for name, content in before.items():
            if name != 'data.db':
                assert saved.read('library_assets/' + name) == content
    with closing(sqlite3.connect(snapshot)) as db:
        assert list(db.iterdump()) == before_dump


if __name__ == '__main__':
    assert len(sys.argv) == 4 and sys.argv[1] == '--restore-worker'
    assert sys.argv[3] in {'during_media', 'during_backup', 'after_db_commit'}
    _worker(sys.argv[2], sys.argv[3])
