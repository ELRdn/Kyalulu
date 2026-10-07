"""Bounded, encrypted sync pages. A complete transfer commits once under CAS.

Readers hold an immutable SQLite snapshot while exporting; uploads cannot edit the
workspace until all pages have been screened. Page rows are read lazily so a 1GB
plan does not require a 1GB JSON object in memory. Images use indexed encrypted
pages; upload stays closed until the classifier is accepted and consent recorded.
"""

import hashlib
import base64
import json
import re
import shutil
import sqlite3
import time
from collections.abc import Sequence, Mapping
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

from .store import CloudError, fingerprint
from .sync import (
    TABLES,
    SESSION_TABLES,
    apply_rows,
    validate_snapshot,
    selected_settings,
    selection_scopes,
    selected_memory,
)

PAGE_BYTES = 2_000_000
ROW_BYTES = 50_000
SYNC_IMAGE_BYTES = 1_000_000  # One verified image fits one bounded encrypted page.
TTL = 3600


@contextmanager
def connection(path):
    db = sqlite3.connect(path)
    try:
        with db:
            yield db
    finally:
        db.close()


def validate_selection(selected):
    if selected is not None and (
        not isinstance(selected, list)
        or len(selected) > 1000
        or any(not isinstance(s, str) or not 0 < len(s) <= 200 for s in selected)
        or len(set(selected)) != len(selected)
    ):
        raise CloudError("invalid_sync_selection")


def snapshot_pages(path, selected=None, *, row_bytes=ROW_BYTES, include_assets=False, asset_directory=None):
    """Yield bounded row pages using one consistent read transaction."""
    validate_selection(selected)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    try:
        db.execute("BEGIN")
        if db.execute("SELECT 1 FROM generations WHERE status='pending'").fetchone():
            raise CloudError("stop_generation_before_sync", 409)
        refs, creators, assets = set(), set(), set()
        if selected is not None:
            placeholders = ",".join("?" for _ in selected) or "NULL"
            settings = selected_settings(db, selected)
            scopes = selection_scopes(settings, selected)
            for row in settings:
                binding = json.loads(row["library_binding"] or "{}")
                refs.update(
                    (r.get("id"), r.get("revision"))
                    for r in binding.values()
                    if isinstance(r, dict)
                )
                assets.add(binding.get("expression_asset_id"))
                for column in ("character_id", "persona_id", "world_id"):
                    ref = row[column] or ""
                    if ref.startswith("created_") and "@" in ref:
                        asset, revision = ref.rsplit("@", 1)
                        creators.add((asset, int(revision)))
            for row in db.execute("SELECT * FROM library_versions"):
                if (row["id"], row["revision"]) in refs:
                    document = json.loads(row["document_json"])
                    assets.update(
                        a.get("asset_id") for a in document.get("assets", []) if a.get("asset_id")
                    )
        for table in TABLES:
            query, args = f"SELECT * FROM {table}", []
            if selected is not None and table in SESSION_TABLES and table != "memories":
                query += f" WHERE {SESSION_TABLES[table]} IN ({placeholders})"
                args = selected
            elif selected is not None and table == "memory_events":
                scope_placeholders = ",".join("?" for _ in scopes) or "NULL"
                query += f" WHERE memory_id IN (SELECT id FROM memories WHERE source_session_id IN ({placeholders}) OR (source_session_id IS NULL AND scope IN ({scope_placeholders})))"
                args = [*selected, *scopes]
            rows, size = [], 0
            results = (
                settings
                if selected is not None and table == "session_settings"
                else db.execute(query + " ORDER BY rowid", args)
            )
            for result in results:
                row = dict(result)
                if selected is not None:
                    if table == "memories" and not selected_memory(row, selected, scopes):
                        continue
                    if table == "library_versions" and (row["id"], row["revision"]) not in refs:
                        continue
                    if (
                        table == "creator_versions"
                        and (row["asset_id"], row["revision"]) not in creators
                    ):
                        continue
                    if table == "library_assets" and row["id"] not in assets:
                        continue
                if include_assets and table == "library_assets":
                    if not re.fullmatch(r"[0-9a-f]{64}", row["id"]):
                        raise CloudError("invalid_sync_asset")
                    asset_path = (asset_directory or path.parent / "library_assets") / row["id"]
                    if asset_path.is_symlink() or not asset_path.is_file() or asset_path.stat().st_size > SYNC_IMAGE_BYTES:
                        raise CloudError("sync_image_too_large_or_invalid", 413)
                    raw = asset_path.read_bytes()
                    if len(raw) > SYNC_IMAGE_BYTES or hashlib.sha256(raw).hexdigest() != row["id"]:
                        raise CloudError("invalid_sync_asset")
                    yield {"table": table, "rows": [row], "assets": {
                        row["id"]: {"media_type": row["media_type"], "base64": base64.b64encode(raw).decode("ascii")},
                    }}
                    continue
                if table == "library_versions":
                    row["original_id"] = None
                # A text row must fit the validated classifier context. Large total
                # databases are supported; an oversized single document is explicit.
                length = len(json.dumps(row, ensure_ascii=False).encode())
                if length > row_bytes:
                    raise CloudError("sync_document_too_large", 413)
                if size + length > row_bytes and rows:
                    yield {"table": table, "rows": rows}
                    rows, size = [], 0
                rows.append(row)
                size += length + 4
            if rows:
                yield {"table": table, "rows": rows}
    finally:
        db.close()


class PageRows(Sequence):
    def __init__(self, service, file, table):
        self.service, self.file, self.table = service, file, table

    def __len__(self):
        with connection(self.file) as db:
            return db.execute(
                "SELECT COALESCE(SUM(count),0) FROM pages WHERE name=?", (self.table,)
            ).fetchone()[0]

    def __iter__(self):
        with connection(self.file) as db:
            for (payload,) in db.execute(
                "SELECT payload FROM pages WHERE name=? ORDER BY seq", (self.table,)
            ):
                yield from json.loads(self.service.store.decrypt(payload))["rows"]

    def __getitem__(self, index):
        if not isinstance(index, int) or index < 0:
            raise IndexError(index)
        for i, row in enumerate(self):
            if i == index:
                return row
        raise IndexError(index)


class PageAssets(Mapping):
    """Indexed encrypted images; never assemble all base64 data in memory."""
    def __init__(self, service, file):
        self.service, self.file = service, file

    def __len__(self):
        with connection(self.file) as db:
            return db.execute("SELECT COUNT(*) FROM asset_index").fetchone()[0]

    def __iter__(self):
        with connection(self.file) as db:
            for (key,) in db.execute("SELECT id FROM asset_index ORDER BY seq"):
                yield key

    def __getitem__(self, key):
        with connection(self.file) as db:
            row = db.execute("SELECT payload FROM pages JOIN asset_index ON pages.seq=asset_index.seq WHERE asset_index.id=?", (key,)).fetchone()
        if not row:
            raise KeyError(key)
        return json.loads(self.service.store.decrypt(row[0]))["assets"][key]


class Transfers:
    def __init__(self, store, sync):
        self.store, self.sync = store, sync

    def directory(self, owner):
        directory = self.store.config.root / "transfers" / str(UUID(owner))
        if directory.is_symlink():
            raise CloudError("invalid_transfer_directory")
        directory.mkdir(parents=True, exist_ok=True)
        return directory

    def file(self, owner, transfer):
        return self.directory(owner) / (str(UUID(transfer)) + ".db")

    def meta(self, db):
        row = db.execute("SELECT payload FROM meta").fetchone()
        if not row:
            raise CloudError("transfer_not_found", 404)
        result = json.loads(self.store.decrypt(row[0]))
        if result["expires"] <= time.time():
            raise CloudError("transfer_expired", 410)
        return result

    def update_meta(self, db, value):
        db.execute("UPDATE meta SET payload=?", (self.store.encrypt(json.dumps(value)),))

    def create(self, owner, *, direction, selected, revision, request_id=None, image_consent=False):
        validate_selection(selected)
        directory = self.directory(owner)
        for file in directory.glob("*.db"):
            try:
                with connection(file) as db:
                    meta = self.meta(db)
            except CloudError as exc:
                if exc.code == "transfer_expired":
                    file.unlink()
                    continue
                raise
            if meta["direction"] == direction:
                raise CloudError("transfer_already_exists_cancel_or_finish", 409)
        if shutil.disk_usage(directory).free < self.store.entitlements(owner).storage_bytes * 3:
            raise CloudError("transfer_capacity_not_available", 503)
        transfer = str(uuid4())
        file = self.file(owner, transfer)
        with connection(file) as db:
            db.executescript(
                "CREATE TABLE meta(payload TEXT); CREATE TABLE pages(seq INTEGER PRIMARY KEY,name TEXT,count INTEGER,hash TEXT,payload TEXT); CREATE INDEX page_table ON pages(name,seq); CREATE TABLE asset_index(id TEXT PRIMARY KEY,seq INTEGER);"
            )
            value = dict(
                direction=direction,
                selected=selected,
                revision=revision,
                request_id=request_id,
                expires=time.time() + TTL,
                next=0,
                size=0,
                chain="",
                ready=False,
                result=None,
                image_consent=image_consent,
            )
            db.execute("INSERT INTO meta VALUES(?)", (self.store.encrypt(json.dumps(value)),))
        return transfer

    def inspect(self, owner, transfer):
        file = self.file(owner, transfer)
        if not file.exists():
            raise CloudError("transfer_not_found", 404)
        with connection(file) as db:
            return self.meta(db)

    def has_page(self, owner, transfer, index, page):
        meta = self.inspect(owner, transfer)
        if meta["direction"] != "upload" or meta["result"]:
            raise CloudError("invalid_transfer_direction", 409)
        if type(index) is not int or index < 0:
            raise CloudError("invalid_transfer_page")
        with connection(self.file(owner, transfer)) as db:
            row = db.execute("SELECT hash FROM pages WHERE seq=?", (index,)).fetchone()
        if row:
            if row[0] != fingerprint(page):
                raise CloudError("transfer_page_conflict", 409)
            return True
        if index != meta["next"]:
            raise CloudError("transfer_page_order", 409)
        return False

    def validate_page(self, owner, transfer, page, path):
        meta = self.inspect(owner, transfer)
        if (
            not isinstance(page, dict)
            or set(page) not in ({"table", "rows"}, {"table", "rows", "assets"})
            or page["table"] not in TABLES
        ):
            raise CloudError("invalid_transfer_page")
        rows = page["rows"]
        if not isinstance(rows, list) or not rows or len(rows) > 1000:
            raise CloudError("invalid_transfer_rows")
        size = len(json.dumps(page, ensure_ascii=False).encode())
        if (
            size > PAGE_BYTES
            or meta["size"] + size > self.store.entitlements(owner).storage_bytes * 2
        ):
            raise CloudError("transfer_too_large", 413)
        # Use the Core schemas/ownership checks before spending on screening.
        partial = dict(
            version=1, selected_sessions=meta["selected"], assets={}, tables={t: [] for t in TABLES}
        )
        partial["tables"][page["table"]] = rows
        # Cross-document references are validated once all pages have arrived.
        if page["table"] == "library_assets":
            if not self.store.config.image_storage_enabled:
                raise CloudError("cloud_image_screening_not_validated", 503)
            if meta.get("image_consent") is not True:
                raise CloudError("image_provider_consent_required", 403)
            if len(rows) != 1:
                raise CloudError("invalid_transfer_rows")
            partial["assets"] = page.get("assets", {})
            with connection(self.file(owner, transfer)) as db:
                if any(db.execute("SELECT 1 FROM asset_index WHERE id=?", (key,)).fetchone() for key in partial["assets"]):
                    raise CloudError("duplicate_sync_asset", 409)
        elif "assets" in page:
            raise CloudError("invalid_transfer_page")
        decoded = validate_snapshot({**partial, "selected_sessions": None})
        if any(len(raw) > SYNC_IMAGE_BYTES for raw, _ in decoded.values()):
            raise CloudError("sync_image_too_large_or_invalid", 413)
        if page["table"] != "session_settings":
            partial["tables"]["session_settings"] = PageRows(
                self, self.file(owner, transfer), "session_settings"
            )
        with connection(path) as db:
            db.row_factory = sqlite3.Row
            db.execute("BEGIN")
            apply_rows(db, partial, validate_only=True)
            db.rollback()
        return size

    def append(self, owner, transfer, index, page):
        file = self.file(owner, transfer)
        with connection(file) as db:
            db.execute("BEGIN IMMEDIATE")
            meta = self.meta(db)
            prior = db.execute("SELECT hash FROM pages WHERE seq=?", (index,)).fetchone()
            hashed = fingerprint(page)
            if prior:
                if prior[0] != hashed:
                    raise CloudError("transfer_page_conflict", 409)
                return
            if index != meta["next"] or meta["ready"]:
                raise CloudError("transfer_page_order", 409)
            size = len(json.dumps(page, ensure_ascii=False).encode())
            if (
                size > PAGE_BYTES
                or meta["size"] + size > self.store.entitlements(owner).storage_bytes * 2
            ):
                raise CloudError("transfer_too_large", 413)
            db.execute(
                "INSERT INTO pages VALUES(?,?,?,?,?)",
                (
                    index,
                    page["table"],
                    len(page["rows"]),
                    hashed,
                    self.store.encrypt(json.dumps(page)),
                ),
            )
            for key in page.get("assets", {}):
                db.execute("INSERT INTO asset_index VALUES(?,?)", (key, index))
            meta["next"] += 1
            meta["size"] += size
            meta["chain"] = hashlib.sha256((meta["chain"] + hashed).encode()).hexdigest()
            meta["expires"] = time.time() + TTL
            self.update_meta(db, meta)

    def download(self, owner, path, selected):
        revision = self.sync.revision(owner)
        transfer = self.create(
            owner, direction="download", selected=selected, revision=revision["revision"]
        )
        try:
            for i, page in enumerate(snapshot_pages(path, selected, row_bytes=PAGE_BYTES - 512, include_assets=True)):
                self.append(owner, transfer, i, page)
            with connection(self.file(owner, transfer)) as db:
                meta = self.meta(db)
                meta["ready"] = True
                self.update_meta(db, meta)
            return dict(transfer_id=transfer, pages=meta["next"], **revision)
        except BaseException:
            self.delete(owner, transfer)
            raise

    def page(self, owner, transfer, index):
        if type(index) is not int or index < 0:
            raise CloudError("invalid_transfer_page")
        meta = self.inspect(owner, transfer)
        if meta["direction"] != "download" or not meta["ready"]:
            raise CloudError("transfer_not_ready", 409)
        with connection(self.file(owner, transfer)) as db:
            row = db.execute("SELECT payload FROM pages WHERE seq=?", (index,)).fetchone()
            meta["expires"] = time.time() + TTL
            self.update_meta(db, meta)
        if not row:
            raise CloudError("transfer_page_not_found", 404)
        return json.loads(self.store.decrypt(row[0]))

    def snapshot(self, owner, transfer):
        file = self.file(owner, transfer)
        meta = self.inspect(owner, transfer)
        return dict(
            version=1,
            selected_sessions=meta["selected"],
            assets=PageAssets(self, file),
            tables={table: PageRows(self, file, table) for table in TABLES},
        )

    def commit(self, owner, transfer, path, *, pages, chain):
        meta = self.inspect(owner, transfer)
        if meta["direction"] != "upload" or meta["next"] != pages or meta["chain"] != chain:
            raise CloudError("transfer_incomplete", 409)
        if meta["result"]:
            return meta["result"]
        snapshot = self.snapshot(owner, transfer)
        hashed = fingerprint(
            {
                "base_revision": meta["revision"],
                "selected": meta["selected"],
                "pages": pages,
                "chain": chain,
            }
        )
        result = self.sync.push(
            owner,
            path,
            request_id=meta["request_id"],
            base_revision=meta["revision"],
            snapshot=snapshot,
            streamed_hash=hashed,
        )
        with connection(self.file(owner, transfer)) as db:
            meta["result"] = result
            self.update_meta(db, meta)
        return result

    def check_capacity(self, owner, transfer, path):
        """Measure the resulting DB, including selected-sync retained rows."""
        import tempfile

        snapshot = self.snapshot(owner, transfer)
        validate_snapshot(snapshot, streamed=True)
        with tempfile.TemporaryDirectory(dir=self.directory(owner)) as tmp:
            preview = Path(tmp) / "preview.db"
            source, dest = sqlite3.connect(path), sqlite3.connect(preview)
            try:
                source.backup(dest)
                dest.row_factory = sqlite3.Row
                dest.execute("BEGIN IMMEDIATE")
                apply_rows(dest, snapshot)
                dest.commit()
                dest.execute("VACUUM")
            finally:
                source.close()
                dest.close()
            # Existing orphan/retained files still consume physical quota.
            extra = sum(
                p.stat().st_size
                for p in path.parent.rglob("*")
                if p.is_file()
                and not p.is_symlink()
                and p.name not in {path.name, path.name + "-wal", path.name + "-shm"}
            )
            new_assets = sum(len(raw) for key, (raw, _) in validate_snapshot(snapshot, streamed=True).items() if not (path.parent / "library_assets" / key).exists())
            if preview.stat().st_size + extra + new_assets > self.store.entitlements(owner).storage_bytes:
                raise CloudError("cloud_storage_full", 413)

    def delete(self, owner, transfer):
        self.file(owner, transfer).unlink(missing_ok=True)


class DatabaseRows(Sequence):
    def __init__(self, path, table):
        self.path, self.table = path, table

    def __len__(self):
        with connection(self.path) as db:
            return db.execute(f"SELECT COUNT(*) FROM {self.table}").fetchone()[0]

    def __iter__(self):
        with connection(self.path) as db:
            db.row_factory = sqlite3.Row
            for row in db.execute(f"SELECT * FROM {self.table} ORDER BY rowid"):
                yield dict(row)

    def __getitem__(self, index):
        if not isinstance(index, int) or index < 0:
            raise IndexError(index)
        with connection(self.path) as db:
            db.row_factory = sqlite3.Row
            row = db.execute(
                f"SELECT * FROM {self.table} ORDER BY rowid LIMIT 1 OFFSET ?", (index,)
            ).fetchone()
            if row is None:
                raise IndexError(index)
            return dict(row)


class DirectoryAssets(Mapping):
    def __init__(self, path):
        self.path = path

    def __len__(self):
        return len(DatabaseRows(self.path, "library_assets"))

    def __iter__(self):
        return (r["id"] for r in DatabaseRows(self.path, "library_assets"))

    def __getitem__(self, key):
        with connection(self.path) as db:
            row = db.execute("SELECT media_type FROM library_assets WHERE id=?", (key,)).fetchone()
        if not row:
            raise KeyError(key)
        raw = (self.path.parent / "library_assets" / key).read_bytes()
        return {"media_type": row[0], "base64": base64.b64encode(raw).decode("ascii")}


def apply_download(path, selected, pages):
    """Build an isolated stage then atomically adopt it; retain the caller's backup."""
    import tempfile
    from .sync import validate_snapshot

    validate_selection(selected)
    with tempfile.TemporaryDirectory(dir=path.parent) as directory:
        stage = Path(directory) / "data.db"
        source, dest = sqlite3.connect(path), sqlite3.connect(stage)
        source.row_factory = sqlite3.Row
        try:
            source.backup(dest)
            dest.row_factory = sqlite3.Row
            dest.execute("BEGIN IMMEDIATE")
            empty = dict(
                version=1, selected_sessions=None, assets={}, tables={t: [] for t in TABLES}
            )
            apply_rows(dest, empty)
            for page in pages:
                if (
                    not isinstance(page, dict)
                    or set(page) not in ({"table", "rows"}, {"table", "rows", "assets"})
                    or page["table"] not in TABLES
                ):
                    raise CloudError("invalid_transfer_page")
                if "assets" in page and page["table"] != "library_assets":
                    raise CloudError("invalid_transfer_page")
                value = {**empty, "assets": page.get("assets", {}), "tables": {**empty["tables"], page["table"]: page["rows"]}}
                decoded = validate_snapshot(value)
                from .sync import save_assets
                save_assets(stage.parent, decoded)
                for row in page["rows"]:
                    schema = {
                        r["name"] for r in dest.execute(f"PRAGMA table_info({page['table']})")
                    }
                    if set(row) != schema:
                        raise CloudError("sync_schema_mismatch", 409)
                    # Abort on identity collisions; never overwrite another session.
                    columns = list(row)
                    dest.execute(
                        f"INSERT INTO {page['table']}({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
                        tuple(row.values()),
                    )
            dest.commit()
            if dest.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise CloudError("sync_integrity_failed", 409)
            snapshot = dict(
                version=1,
                selected_sessions=selected,
                assets=DirectoryAssets(stage),
                tables={table: DatabaseRows(stage, table) for table in TABLES},
            )
            decoded = validate_snapshot(snapshot, streamed=True)
            created = []
            try:
                source.execute("BEGIN IMMEDIATE")
                apply_rows(source, snapshot)
                created = save_assets(path.parent, decoded)
                source.commit()
            except BaseException:
                source.rollback()
                for asset in created:
                    asset.unlink(missing_ok=True)
                raise
        finally:
            dest.close()
            source.close()
