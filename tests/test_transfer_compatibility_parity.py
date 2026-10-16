"""Download adoption compatibility and atomicity; all remote calls are mocked."""
import sqlite3
from contextlib import closing

import pytest

from python.api import cloud_sync
from python.cloud.store import CloudError, fingerprint
from python.cloud.sync import export_snapshot
from python.storage import db as storage


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["all", "selected"])
@pytest.mark.parametrize("invalid,legacy", [(None, True), (None, False), ("unknown_column", True),
    ("invalid_sources", True), ("invalid_tombstone", True), ("duplicate_chat", True), ("resurrection", True)])
async def test_download_legacy_memory_and_tombstone_adoption(isolated, monkeypatch, mode, invalid, legacy):
    monkeypatch.setenv("KYALULU_MANAGED_CLOUD_ORIGIN", "https://cloud.test")
    selected = ["chosen", "erased"] if mode == "selected" else None
    cloud_sync.save_config({"origin": "https://cloud.test", "mode": mode,
                            "selected": selected or [], "revision": 7, "token": "fixture"})
    await storage.init_db()
    remote_path = isolated / "remote" / "data.db"
    remote_path.parent.mkdir()
    with closing(sqlite3.connect(storage.DB_PATH)) as source, closing(sqlite3.connect(remote_path)) as remote:
        source.backup(remote)
    with closing(sqlite3.connect(remote_path)) as remote, remote:
        remote.execute("INSERT INTO chat_history(id,session_id,role,content) VALUES(100,'chosen','user','remote text')")
        remote.execute("INSERT INTO memories(id,scope,type,content,source_session_id,source_kind,source_quote,source_revision,source_message_ids,confirmation) "
                       "VALUES('legacy-memory','session:chosen','semantic','remote memory','chosen','user_correction','explicit quote','manual:3','[100]','user_confirmed')")
        remote.execute("INSERT INTO session_deletions VALUES('erased','2026-10-11 00:00:00')")
    remote_before = remote_path.read_bytes()
    snapshot = export_snapshot(remote_path, selected)
    if legacy:
        for row in snapshot["tables"]["memories"]:
            for key in ("source_kind", "source_quote", "source_revision", "source_message_ids", "confirmation"):
                row.pop(key)
    pages = [{"table": table, "rows": rows} for table, rows in snapshot["tables"].items() if rows]
    # Repetition within a page AND across pages must be harmless.
    tombstones = snapshot["tables"]["session_deletions"]
    tombstones.append(dict(tombstones[0]))
    pages.append({"table": "session_deletions", "rows": [{"session_id": "erased", "deleted_at": "2026-10-12 00:00:00"}]})
    if invalid == "unknown_column":
        snapshot["tables"]["memories"][0]["unknown_column"] = "reject"
    elif invalid == "invalid_sources":
        snapshot["tables"]["memories"][0]["source_message_ids"] = "[true]"
    elif invalid == "invalid_tombstone":
        pages[-1]["rows"][0]["deleted_at"] = None
    elif invalid == "duplicate_chat":
        pages.append({"table": "chat_history", "rows": [dict(snapshot["tables"]["chat_history"][0])]})
    elif invalid == "resurrection":
        snapshot["tables"]["chat_history"][0]["session_id"] = "erased"
    wire_hashes = [fingerprint(page) for page in pages]
    with closing(sqlite3.connect(storage.DB_PATH)) as local, local:
        local.execute("INSERT INTO chat_history(session_id,role,content) VALUES('chosen','user','old local text')")
        local.execute("INSERT INTO chat_history(session_id,role,content) VALUES('unselected','user','keep local text')")
        local.execute("INSERT INTO session_deletions VALUES('erased','2026-10-10 00:00:00')")
        # A selected download must not send this local-only marker through the
        # selected wire validation, or discard it from the real local database.
        local.execute("INSERT INTO session_deletions VALUES('unselected-erased','2026-10-09 00:00:00')")
    local_before = export_snapshot(storage.DB_PATH)
    config_before = cloud_sync.config_path().read_bytes()
    calls = []

    async def remote(_config, path, **kwargs):
        calls.append((path, kwargs.get("method", "GET")))
        if kwargs.get("method") == "DELETE":
            return {"ok": True}
        if "/pages/" in path:
            return pages[int(path.rsplit("/", 1)[-1])]
        assert kwargs["body"]["selected_sessions"] == selected
        return {"transfer_id": "fixture-transfer", "pages": len(pages), "revision": 8}

    monkeypatch.setattr(cloud_sync, "remote", remote)
    if invalid:
        error_type, reason = {
            "unknown_column": (CloudError, "sync_schema_mismatch"),
            "invalid_sources": (CloudError, "invalid_sync_message_sources"),
            "invalid_tombstone": (CloudError, "sync_schema_mismatch"),
            "duplicate_chat": (sqlite3.IntegrityError, "UNIQUE constraint failed: chat_history.id"),
            "resurrection": (CloudError, "erased_conversation_cannot_be_restored"),
        }[invalid]
        with pytest.raises(error_type, match=reason):
            await cloud_sync.adopt()
        assert export_snapshot(storage.DB_PATH) == local_before
        assert cloud_sync.config_path().read_bytes() == config_before
    else:
        result = await cloud_sync.adopt()
        assert result["revision"] == 8 and cloud_sync.read_config()["revision"] == 8
        with closing(sqlite3.connect(storage.DB_PATH)) as local:
            assert local.execute("SELECT content FROM chat_history WHERE session_id='chosen'").fetchall() == [("remote text",)]
            assert local.execute("SELECT COUNT(*) FROM chat_history WHERE session_id='unselected'").fetchone()[0] == (1 if selected else 0)
            assert local.execute("SELECT source_kind,source_quote,source_revision,source_message_ids,confirmation FROM memories WHERE id='legacy-memory'").fetchone() == (
                ("user_statement", "", None, "[]", "unverified") if legacy else
                ("user_correction", "explicit quote", "manual:3", "[100]", "user_confirmed"))
            assert local.execute("SELECT session_id,deleted_at FROM session_deletions ORDER BY session_id").fetchall() == [
                ("erased", "2026-10-10 00:00:00"), ("unselected-erased", "2026-10-09 00:00:00")]
    assert remote_path.read_bytes() == remote_before
    assert [fingerprint(page) for page in pages] == wire_hashes
    assert calls[-1] == ("/transfers/fixture-transfer", "DELETE")
    expected_paths = {"data.db", "remote", "cloud-sync.json", "backups"}
    if not invalid:
        expected_paths.add("library_assets")
        assert not list((isolated / "library_assets").iterdir())
    assert set(p.name for p in isolated.iterdir()) == expected_paths
