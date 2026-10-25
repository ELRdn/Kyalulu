"""Offline/online Core export; restore validates before touching current data."""

import json
import re
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from contextlib import closing


def erase_conversations(db, sessions, *, schema='main'):
    """Apply durable erasures to a staged SQLite restore before promoting it."""
    if schema not in {'main', 'runtime'}:
        raise ValueError('invalid erasure database')
    tables = {r[0] for r in db.execute(f"SELECT name FROM {schema}.sqlite_master WHERE type='table'")}
    db.execute(f"CREATE TABLE IF NOT EXISTS {schema}.session_deletions(session_id TEXT PRIMARY KEY,deleted_at TEXT NOT NULL DEFAULT (datetime('now')))")
    db.execute(f"PRAGMA {schema}.secure_delete=ON")
    for sid in sessions:
        memory_ids = set()
        if "memories" in tables:
            memory_ids = {r[0] for r in db.execute(f"SELECT id FROM {schema}.memories WHERE source_session_id=? OR scope=?", (sid,f"session:{sid}"))}
        if "generations" in tables:
            from python.storage.conversation import erase_memory_references
            for gid, encoded in db.execute(f"SELECT generation_id,result_json FROM {schema}.generations WHERE session_id<>? AND result_json IS NOT NULL",(sid,)).fetchall():
                original = json.loads(encoded)
                redacted = erase_memory_references(original,memory_ids,source_session_ids={sid})
                if redacted is not original:
                    db.execute(f"UPDATE {schema}.generations SET result_json=? WHERE generation_id=?", (json.dumps(redacted,ensure_ascii=False),gid))
        if "memories" in tables:
            if "memory_events" in tables:
                db.execute(f"DELETE FROM {schema}.memory_events WHERE memory_id IN (SELECT id FROM {schema}.memories WHERE source_session_id=? OR scope=?)",
                           (sid,f"session:{sid}"))
            db.execute(f"DELETE FROM {schema}.memories WHERE source_session_id=? OR scope=?",(sid,f"session:{sid}"))
        if {"memory_events","generations"} <= tables:
            db.execute(f"DELETE FROM {schema}.memory_events WHERE generation_id IN (SELECT generation_id FROM {schema}.generations WHERE session_id=?)", (sid,))
        if {"imported_history","chat_history"} <= tables:
            db.execute(f"DELETE FROM {schema}.imported_history WHERE message_id IN (SELECT id FROM {schema}.chat_history WHERE session_id=?)", (sid,))
        for table in ("chat_history","generations","runtime_states","session_settings","session_memory","conversation_summaries","session_scopes","unified_local_links"):
            if table in tables:
                db.execute(f"DELETE FROM {schema}.{table} WHERE session_id=?",(sid,))
        db.execute(f"INSERT OR IGNORE INTO {schema}.session_deletions(session_id) VALUES(?)",(sid,))


def preserve_sync(staged, current):
    """Merge only into staging; current delivery/ownership state must not rewind."""
    from python.storage.entity_bridge import Links
    from python.storage.native_sync import prepare_meta, fence_restored

    old_tables = {r[0] for r in current.execute("SELECT name FROM sqlite_master WHERE type='table'")} if current else set()
    tables = {r[0] for r in staged.execute("SELECT name FROM runtime.sqlite_master WHERE type='table'")}
    native = {'native_sync_meta', 'native_sync_received', 'unified_native_owners', 'unified_native_links'}
    if native & (tables | old_tables):
        Links(staged, '0' * 64).prepare()
        prepare_meta(staged)
        # An owner claim also survives when its conversation is absent in the older DB.
        owners = {}
        for db, prefix, known in ((current, '', old_tables), (staged, 'runtime.', tables)):
            for table in ('unified_native_owners', 'unified_native_links'):
                if table in known:
                    for sid, namespace in db.execute(f'SELECT session_id,namespace FROM {prefix}{table}'):
                        if sid in owners and owners[sid] != namespace:
                            raise ValueError('backup_sync_owner_conflict')
                        owners[sid] = namespace
        staged.executemany('INSERT OR IGNORE INTO runtime.unified_native_owners VALUES(?,?)', owners.items())
        if current:
            # A settled request in the current DB must never be resurrected by an archive.
            staged.execute('DELETE FROM runtime.native_sync_meta')
            if 'native_sync_meta' in old_tables:
                staged.executemany('INSERT INTO runtime.native_sync_meta VALUES(?,?,?)', current.execute('SELECT namespace,key,value FROM native_sync_meta'))
            if 'native_sync_received' in old_tables:
                staged.executemany('INSERT INTO runtime.native_sync_received VALUES(?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET revision=MAX(revision,excluded.revision),deleted=MAX(deleted,excluded.deleted)',
                                   current.execute('SELECT namespace,id,revision,deleted FROM native_sync_received'))
            if 'unified_native_links' in old_tables:
                staged.executemany('INSERT INTO runtime.unified_native_links VALUES(?,?,?,?,?,?) ON CONFLICT(namespace,session_id) DO UPDATE SET entity_id=excluded.entity_id,revision=excluded.revision,baseline=excluded.baseline,mapping=excluded.mapping',
                                   current.execute('SELECT namespace,session_id,entity_id,revision,baseline,mapping FROM unified_native_links'))
        fence_restored(staged, schema='runtime')
    if 'unified_runtime_links' in tables | old_tables:
        Links(staged).prepare()
        if 'unified_runtime_links' in old_tables:
            staged.executemany('INSERT INTO runtime.unified_runtime_links VALUES(?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET entity_id=excluded.entity_id,revision=excluded.revision,baseline=excluded.baseline,mapping=excluded.mapping',
                               current.execute('SELECT session_id,entity_id,revision,baseline,mapping FROM unified_runtime_links'))
        for sid, encoded in staged.execute('SELECT session_id,mapping FROM runtime.unified_runtime_links').fetchall():
            mapping = json.loads(encoded)
            mapping['restored_from_snapshot'] = True
            staged.execute('UPDATE runtime.unified_runtime_links SET mapping=? WHERE session_id=?', (json.dumps(mapping), sid))
    if 'unified_local_links' in tables:
        staged.execute('DELETE FROM runtime.unified_local_links')


def promote_core(restored, data, new_assets):
    """Caller holds the runtime/tenant lock. DB copying is SQLite-atomic."""
    with closing(sqlite3.connect(':memory:')) as staged, staged:
        staged.execute('ATTACH DATABASE ? AS runtime', (str(restored),))
        erased = set()
        if (data / 'data.db').exists():
            with closing(sqlite3.connect(data / 'data.db')) as current:
                if current.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_deletions'").fetchone():
                    erased = {r[0] for r in current.execute('SELECT session_id FROM session_deletions')}
                preserve_sync(staged, current)
        else:
            preserve_sync(staged, None)
        if staged.execute("SELECT 1 FROM runtime.sqlite_master WHERE type='table' AND name='session_deletions'").fetchone():
            erased.update(r[0] for r in staged.execute('SELECT session_id FROM runtime.session_deletions'))
        if erased:
            erase_conversations(staged, erased, schema='runtime')
    old_assets = data / "library_assets"
    previous = restored.parent / "previous-assets"
    moved_old, moved_new = False, False
    try:
        if old_assets.exists():
            old_assets.rename(previous)
            moved_old = True
        if new_assets.exists():
            new_assets.rename(old_assets)
            moved_new = True
        source, destination = sqlite3.connect(restored), sqlite3.connect(data / "data.db")
        try:
            source.backup(destination)
        finally:
            source.close()
            destination.close()
    except BaseException:
        if moved_new:
            old_assets.rename(new_assets)
        if moved_old:
            previous.rename(old_assets)
        raise


def backup(data, destination):
    data, destination = Path(data), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=destination.parent) as tmp:
        tmp = Path(tmp)
        if (data / "data.db").exists():
            src, dst = sqlite3.connect(data / "data.db"), sqlite3.connect(tmp / "data.db")
            try:
                src.backup(dst)
            finally:
                src.close()
                dst.close()
        with zipfile.ZipFile(tmp / "backup.zip", "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("manifest.json", json.dumps({"format": "kyalulu-core", "version": 1}))
            if (tmp / "data.db").exists():
                archive.write(tmp / "data.db", "data.db")
            assets = data / "library_assets"
            if assets.exists() and not assets.is_symlink():
                for path in assets.iterdir():
                    if (
                        path.is_file()
                        and not path.is_symlink()
                        and re.fullmatch("[0-9a-f]{64}", path.name)
                    ):
                        archive.write(path, "library_assets/" + path.name)
        if destination.exists():
            raise ValueError("backup destination already exists")
        (tmp / "backup.zip").replace(destination)
    return str(destination)


def restore(data, source):
    data = Path(data)
    data.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=data.parent) as tmp:
        tmp = Path(tmp)
        with zipfile.ZipFile(source) as archive:
            if json.loads(archive.read("manifest.json")) != {
                "format": "kyalulu-core",
                "version": 1,
            }:
                raise ValueError("unsupported backup")
            total = 0
            names = set()
            for item in archive.infolist():
                if item.filename in names:
                    raise ValueError("duplicate backup member")
                names.add(item.filename)
                if item.filename not in {"manifest.json", "data.db"} and not re.fullmatch(
                    "library_assets/[0-9a-f]{64}", item.filename
                ):
                    raise ValueError("invalid backup path")
                total += item.file_size
                if total > 5_000_000_000:
                    raise ValueError("backup too large")
            archive.extractall(tmp / "restored")
        restored = tmp / "restored/data.db"
        if not restored.exists():
            sqlite3.connect(restored).close()
        if restored.exists():
            con = sqlite3.connect(restored)
            try:
                if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("backup integrity failed")
            finally:
                con.close()
        before = (
            data.parent / "backups" / ("before-restore-" + __import__("uuid").uuid4().hex + ".zip")
        )
        from python.storage.runtime_lock import RuntimeLock

        with RuntimeLock(data):
            backup(data, before)
            promote_core(restored, data, tmp / "restored/library_assets")
    return str(before)


if __name__ == "__main__":
    import sys

    command, data, file = sys.argv[1:]
    print((backup if command == "backup" else restore)(data, file))
