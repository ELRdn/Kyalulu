"""Logical, bounded synchronization into the same Character Runtime tables.

Control revision/idempotency and runtime changes commit together via SQLite ATTACH.
No raw database, credentials, temporary imports or experiment files cross this API.
"""

import base64
import hashlib
import json
import sqlite3
from collections.abc import Sequence, Mapping
from pathlib import Path
from .store import CloudError, fingerprint

TABLES = (
    "chat_history",
    "session_settings",
    "runtime_states",
    "session_memory",
    "memories",
    "memory_events",
    "library_versions",
    "library_assets",
    "creator_versions",
)
SESSION_TABLES = {
    "chat_history": "session_id",
    "session_settings": "session_id",
    "runtime_states": "session_id",
    "session_memory": "session_id",
    "memories": "source_session_id",
}
MAX_BYTES = 16_000_000


def selected_settings(db, selected):
    global_row = db.execute(
        "SELECT * FROM session_settings WHERE session_id='__global__'"
    ).fetchone()
    rows = []
    for session in selected:
        row = db.execute("SELECT * FROM session_settings WHERE session_id=?", (session,)).fetchone()
        if row or global_row:
            settings = dict(row or global_row)
            settings["session_id"] = session
            rows.append(settings)
    return rows


def selection_scopes(rows, selected):
    from python.storage.memories import chat_scope

    settings = {row.get("session_id"): row for row in rows}
    return {
        chat_scope(
            settings.get(s, {}).get("character_id"), settings.get(s, {}).get("persona_id"), s
        )
        for s in selected
    }


def selected_memory(row, selected, scopes):
    return row.get("source_session_id") in selected or (
        row.get("source_session_id") is None and row.get("scope") in scopes
    )


def export_snapshot(path: Path, selected: list[str] | None = None):
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN")
        if db.execute("SELECT 1 FROM generations WHERE status='pending'").fetchone():
            raise CloudError("stop_generation_before_sync", 409)
        tables = {}
        settings = selected_settings(db, selected) if selected is not None else []
        scopes = selection_scopes(settings, selected) if selected is not None else set()
        for table in TABLES:
            rows = [dict(r) for r in db.execute(f"SELECT * FROM {table} ORDER BY rowid")]
            if selected is not None and table in SESSION_TABLES:
                if table == "session_settings":
                    rows = settings
                elif table == "memories":
                    rows = [r for r in rows if selected_memory(r, selected, scopes)]
                else:
                    rows = [r for r in rows if r[SESSION_TABLES[table]] in selected]
            if selected is not None and table == "memory_events":
                ids = {r["id"] for r in tables.get("memories", [])}
                rows = [r for r in rows if r["memory_id"] in ids]
            if table == "library_versions":
                for row in rows:
                    row["original_id"] = None  # original source files stay local
            tables[table] = rows
        if selected is not None:
            library_refs, creator_refs = set(), set()
            for row in tables["session_settings"]:
                binding = json.loads(row.get("library_binding") or "{}")
                for ref in binding.values():
                    if isinstance(ref, dict) and isinstance(ref.get("id"), str):
                        library_refs.add((ref["id"], ref.get("revision")))
                for column in ("character_id", "persona_id", "world_id"):
                    value = row.get(column) or ""
                    if value.startswith("created_") and "@" in value:
                        asset, revision = value.rsplit("@", 1)
                        creator_refs.add((asset, int(revision)))
            tables["library_versions"] = [
                r for r in tables["library_versions"] if (r["id"], r["revision"]) in library_refs
            ]
            tables["creator_versions"] = [
                r
                for r in tables["creator_versions"]
                if (r["asset_id"], r["revision"]) in creator_refs
            ]
            asset_refs = set()
            for row in tables["library_versions"]:
                document = json.loads(row["document_json"])
                asset_refs.update(
                    a.get("asset_id") for a in document.get("assets", []) if a.get("asset_id")
                )
            for row in tables["session_settings"]:
                asset_refs.add(
                    json.loads(row.get("library_binding") or "{}").get("expression_asset_id")
                )
            tables["library_assets"] = [
                r for r in tables["library_assets"] if r["id"] in asset_refs
            ]
        assets = {}
        for row in tables["library_assets"]:
            raw = (path.parent / "library_assets" / row["id"]).read_bytes()
            assets[row["id"]] = {
                "media_type": row["media_type"],
                "base64": base64.b64encode(raw).decode(),
            }
        result = {"version": 1, "selected_sessions": selected, "tables": tables, "assets": assets}
        if len(json.dumps(result).encode()) > MAX_BYTES:
            raise CloudError("sync_batch_too_large", 413)
        return result
    finally:
        db.close()


def validate_snapshot(value, *, streamed=False):
    if (
        not isinstance(value, dict)
        or set(value) != {"version", "selected_sessions", "tables", "assets"}
        or value["version"] != 1
    ):
        raise CloudError("invalid_sync_snapshot")
    if not isinstance(value["tables"], dict) or set(value["tables"]) != set(TABLES):
        raise CloudError("invalid_sync_tables")
    if not isinstance(value["assets"], Mapping if streamed else dict) or (
        not streamed and len(json.dumps(value).encode()) > MAX_BYTES
    ):
        raise CloudError("sync_batch_too_large", 413)
    selected = value["selected_sessions"]
    if selected is not None and (
        not isinstance(selected, list)
        or len(selected) > 1000
        or any(not isinstance(s, str) or not 0 < len(s) <= 200 for s in selected)
    ):
        raise CloudError("invalid_sync_selection")
    scopes = (
        selection_scopes(value["tables"]["session_settings"], selected)
        if selected is not None
        else set()
    )
    for table, rows in value["tables"].items():
        if (
            not isinstance(rows, Sequence)
            or (not streamed and len(rows) > 50000)
            or any(not isinstance(row, dict) for row in rows)
        ):
            raise CloudError("invalid_sync_rows")
        if selected is not None and table in SESSION_TABLES:
            if any(
                not selected_memory(row, selected, scopes)
                if table == "memories"
                else row.get(SESSION_TABLES[table]) not in selected
                for row in rows
            ):
                raise CloudError("sync_selection_mismatch")
        if table == "library_versions" and any(r.get("original_id") is not None for r in rows):
            raise CloudError("original_sources_not_synced")
        if table == "library_versions":
            from python.core.portable_schema import PortableDocument

            for row in rows:
                PortableDocument.model_validate_json(row.get("document_json", "{}"))
        if table == "runtime_states":
            from python.core.schemas import RuntimeState

            for row in rows:
                state = RuntimeState.model_validate_json(row.get("state_json", "{}"))
                if state.session_id != row.get("session_id"):
                    raise CloudError("sync_state_session_mismatch")
    if set(value["assets"]) != {r.get("id") for r in value["tables"]["library_assets"]}:
        raise CloudError("sync_asset_manifest_mismatch")
    if selected is not None:
        # Consent is enforced again for uploads, not merely in the export helper.
        settings = value["tables"]["session_settings"]
        refs, creators = set(), set()
        for row in settings:
            binding = json.loads(row.get("library_binding") or "{}")
            refs.update(
                (r.get("id"), r.get("revision")) for r in binding.values() if isinstance(r, dict)
            )
            for k in ("character_id", "persona_id", "world_id"):
                ref = row.get(k) or ""
                if ref.startswith("created_") and "@" in ref:
                    a, rev = ref.rsplit("@", 1)
                    creators.add((a, int(rev)))
        if any(
            (r.get("id"), r.get("revision")) not in refs
            for r in value["tables"]["library_versions"]
        ):
            raise CloudError("unselected_library_document")
        if any(
            (r.get("asset_id"), r.get("revision")) not in creators
            for r in value["tables"]["creator_versions"]
        ):
            raise CloudError("unselected_creator_document")
        memory_ids = {r.get("id") for r in value["tables"]["memories"]}
        if any(r.get("memory_id") not in memory_ids for r in value["tables"]["memory_events"]):
            raise CloudError("unselected_memory_event")
    def decode_asset(key, item):
        if not isinstance(item, dict) or set(item) != {"media_type", "base64"}:
            raise CloudError("invalid_sync_asset")
        try:
            raw = base64.b64decode(item["base64"], validate=True)
        except (ValueError, TypeError) as exc:
            raise CloudError("invalid_sync_asset") from exc
        if hashlib.sha256(raw).hexdigest() != key:
            raise CloudError("sync_asset_hash_mismatch")
        from python.core.portable_assets import accept_image

        asset_id, mime = accept_image(raw)
        if asset_id != key or mime != item["media_type"]:
            raise CloudError("invalid_sync_asset")
        return raw, mime

    if streamed:
        # Validate all images before modifying DB/files, retaining one at a time.
        for key, item in value["assets"].items():
            decode_asset(key, item)
        return DecodedAssets(value["assets"], decode_asset)
    return {key: decode_asset(key, item) for key, item in value["assets"].items()}


class DecodedAssets(Mapping):
    def __init__(self, encoded, decode):
        self.encoded, self.decode = encoded, decode

    def __len__(self):
        return len(self.encoded)

    def __iter__(self):
        return iter(self.encoded)

    def __getitem__(self, key):
        return self.decode(key, self.encoded[key])


def apply_rows(db, value, *, validate_only=False):
    selected = value["selected_sessions"]
    scopes = (
        selection_scopes(value["tables"]["session_settings"], selected)
        if selected is not None
        else set()
    )
    if db.execute("SELECT 1 FROM generations WHERE status='pending'").fetchone():
        raise CloudError("stop_generation_before_sync", 409)
    # Validate all schemas and ownership of primary keys BEFORE deleting anything.
    for table in TABLES:
        schema = [dict(r) for r in db.execute(f"PRAGMA table_info({table})")]
        columns = {r["name"] for r in schema}
        primary = [r["name"] for r in schema if r["pk"]]
        seen = set()
        for row in value["tables"][table]:
            if set(row) != columns or any(
                type(v) not in (str, int, float, type(None)) for v in row.values()
            ):
                raise CloudError("sync_schema_mismatch", 409)
            for column in schema:
                field = row[column["name"]]
                if field is None:
                    if column["notnull"] or column["pk"]:
                        raise CloudError("sync_schema_mismatch", 409)
                elif column["type"] == "INTEGER" and type(field) is not int:
                    raise CloudError("sync_schema_mismatch", 409)
                elif column["type"] == "TEXT" and not isinstance(field, str):
                    raise CloudError("sync_schema_mismatch", 409)
                elif type(field) is float:
                    import math

                    if not math.isfinite(field):
                        raise CloudError("sync_schema_mismatch", 409)
            identity = tuple(row[k] for k in primary)
            if identity in seen:
                raise CloudError("duplicate_sync_identity", 409)
            seen.add(identity)
            if selected is not None and table in SESSION_TABLES and primary:
                old = db.execute(
                    f"SELECT * FROM {table} WHERE " + " AND ".join(k + "=?" for k in primary),
                    identity,
                ).fetchone()
                if old and (
                    not selected_memory(dict(old), selected, scopes)
                    if table == "memories"
                    else old[SESSION_TABLES[table]] not in selected
                ):
                    raise CloudError("sync_identity_conflict", 409)
            if selected is not None and table not in SESSION_TABLES and table != "memory_events" and primary:
                old = db.execute(
                    f"SELECT * FROM {table} WHERE " + " AND ".join(k + "=?" for k in primary),
                    identity,
                ).fetchone()
                if old and dict(old) != row:
                    raise CloudError("sync_shared_identity_conflict", 409)
    if validate_only:
        return
    if selected is None:
        for table in TABLES:
            db.execute(f"DELETE FROM {table}")
        db.execute("DELETE FROM generations")
    else:
        for scope in scopes:
            db.execute(
                "DELETE FROM memory_events WHERE memory_id IN (SELECT id FROM memories WHERE source_session_id IS NULL AND scope=?)",
                (scope,),
            )
            db.execute("DELETE FROM memories WHERE source_session_id IS NULL AND scope=?", (scope,))
        for session in selected:
            db.execute(
                "DELETE FROM memory_events WHERE memory_id IN (SELECT id FROM memories WHERE source_session_id=?)",
                (session,),
            )
        for table, column in SESSION_TABLES.items():
            for session in selected:
                db.execute(f"DELETE FROM {table} WHERE {column}=?", (session,))
        for session in selected:
            db.execute("DELETE FROM generations WHERE session_id=?", (session,))
    for table in TABLES:
        for row in value["tables"][table]:
            names = list(row)
            if selected is not None and table == "memory_events":
                # Event sequence numbers are local to a database. Allocate anew
                # rather than rejecting or replacing an unrelated session's log.
                names.remove("id")
            db.execute(
                f"INSERT OR REPLACE INTO {table}("
                + ",".join(names)
                + ") VALUES("
                + ",".join("?" for _ in names)
                + ")",
                tuple(row[name] for name in names),
            )


def apply_snapshot(path, value):
    assets = validate_snapshot(value)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    created = []
    try:
        db.execute("BEGIN IMMEDIATE")
        apply_rows(db, value)
        created = save_assets(path.parent, assets)
        db.commit()
    except BaseException:
        db.rollback()
        for asset in created:
            asset.unlink(missing_ok=True)
        raise
    finally:
        db.close()


def save_assets(directory, assets):
    from uuid import uuid4

    target = directory / "library_assets"
    if target.is_symlink():
        raise CloudError("invalid_asset_directory")
    target.mkdir(exist_ok=True)
    created = []
    try:
        for key, (raw, _) in assets.items():
            path = target / key
            if path.is_symlink():
                raise CloudError("invalid_asset_path")
            if not path.exists():
                temporary = target / (key + "." + uuid4().hex + ".tmp")
                try:
                    temporary.write_bytes(raw)
                    temporary.replace(path)
                finally:
                    temporary.unlink(missing_ok=True)
                created.append(path)
    except BaseException:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    return created


def compact_assets(path):
    directory = path.parent / "library_assets"
    if not directory.exists() or directory.is_symlink():
        return
    with sqlite3.connect(path) as db:
        live = {r[0] for r in db.execute("SELECT id FROM library_assets")}
    import re

    for file in directory.iterdir():
        if (
            re.fullmatch(r"[0-9a-f]{64}", file.name)
            and file.name not in live
            and not file.is_symlink()
        ):
            file.unlink()


class SyncService:
    def __init__(self, store):
        self.store = store

    def revision(self, owner):
        with self.store.transaction() as db:
            row = db.execute(
                "SELECT revision,deleted FROM sync_heads WHERE owner=? AND id='workspace'", (owner,)
            ).fetchone()
            return {"revision": row[0] if row else 0, "deleted": bool(row[1]) if row else False}

    def bump(self, owner):
        with self.store.transaction() as db:
            db.execute(
                "INSERT INTO sync_heads VALUES(?,'workspace',1,0,'{}') ON CONFLICT(owner,id) DO UPDATE SET revision=revision+1,deleted=0",
                (owner,),
            )

    def settings(self, owner, mode=None):
        if mode is not None and mode not in {"off", "selected", "all"}:
            raise CloudError("invalid_sync_mode")
        with self.store.transaction() as db:
            if mode is not None:
                db.execute("UPDATE accounts SET sync_mode=? WHERE id=?", (mode, owner))
                if mode != "off":
                    db.execute(
                        "UPDATE sync_heads SET deleted=0,revision=revision+1 WHERE owner=? AND deleted=1",
                        (owner,),
                    )
            return {
                "mode": db.execute(
                    "SELECT sync_mode FROM accounts WHERE id=?", (owner,)
                ).fetchone()[0]
            }

    def push(self, owner, path, *, request_id, base_revision, snapshot, streamed_hash=None):
        assets = validate_snapshot(snapshot, streamed=streamed_hash is not None)
        mode = self.settings(owner)["mode"]
        if mode == "off" or (mode == "selected" and snapshot["selected_sessions"] is None):
            raise CloudError("sync_not_enabled", 403)
        request_hash = streamed_hash or fingerprint(
            {"base_revision": base_revision, "snapshot": snapshot}
        )
        db = sqlite3.connect(path, timeout=15)
        db.row_factory = sqlite3.Row
        created = []
        try:
            db.execute("ATTACH DATABASE ? AS control", (str(self.store.path),))
            db.execute("BEGIN IMMEDIATE")
            replay = db.execute(
                "SELECT hash,result FROM control.sync_requests WHERE owner=? AND id=?",
                (owner, request_id),
            ).fetchone()
            if replay:
                if replay["hash"] != request_hash:
                    raise CloudError("sync_request_conflict", 409)
                return json.loads(replay["result"])
            head = db.execute(
                "SELECT revision,deleted FROM control.sync_heads WHERE owner=? AND id='workspace'",
                (owner,),
            ).fetchone()
            if base_revision != (head[0] if head else 0):
                raise CloudError("sync_revision_conflict", 409)
            # Tombstones require a new explicitly configured sync enrollment.
            if head and head[1]:
                raise CloudError("cloud_copy_deleted", 409)
            apply_rows(db, snapshot)
            created = save_assets(path.parent, assets)
            result = {"revision": base_revision + 1}
            db.execute(
                "INSERT INTO control.sync_heads VALUES(?,'workspace',?,0,'{}') ON CONFLICT(owner,id) DO UPDATE SET revision=excluded.revision,deleted=0",
                (owner, result["revision"]),
            )
            db.execute(
                "INSERT INTO control.sync_requests VALUES(?,?,?,?)",
                (owner, request_id, request_hash, json.dumps(result)),
            )
            db.commit()
            try:
                db.execute("VACUUM main")
            except sqlite3.OperationalError:
                pass  # committed data stays valid; quota blocks further writes if needed
            return result
        except BaseException:
            db.rollback()
            for asset in created:
                asset.unlink(missing_ok=True)
            raise
        finally:
            db.close()

    def delete(self, owner, path):
        db = sqlite3.connect(path)
        try:
            db.execute("ATTACH DATABASE ? AS control", (str(self.store.path),))
            db.execute("BEGIN IMMEDIATE")
            if db.execute("SELECT 1 FROM generations WHERE status='pending'").fetchone():
                raise CloudError("stop_generation_before_sync", 409)
            for table in TABLES + (
                "generations",
                "library_originals",
                "library_previews",
                "library_commits",
            ):
                db.execute(f"DELETE FROM {table}")
            db.execute(
                "INSERT INTO control.sync_heads VALUES(?,'workspace',1,1,'{}') ON CONFLICT(owner,id) DO UPDATE SET revision=revision+1,deleted=1",
                (owner,),
            )
            db.execute("UPDATE control.accounts SET sync_mode='off' WHERE id=?", (owner,))
            db.commit()
            db.execute("VACUUM main")
            compact_assets(path)
        finally:
            db.close()
