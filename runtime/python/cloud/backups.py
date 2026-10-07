"""Chunk-authenticated encrypted SQLite backups; originals remain on rollback."""

import json
import os
import shutil
import sqlite3
import struct
import tempfile
import time
from pathlib import Path
from uuid import uuid4
from .store import CloudError

MAGIC = b"KYALULU-BACKUP-1\n"
CHUNK = 1024 * 1024


class Backups:
    def __init__(self, store):
        self.store = store

    def directory(self, owner):
        from uuid import UUID

        root = self.store.config.backup_root
        if root is None or root.resolve() == self.store.config.root.resolve():
            raise CloudError("offsite_backup_not_configured", 503)
        path = root / str(UUID(owner))
        if path.is_symlink():
            raise CloudError("invalid_backup_directory", 503)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def admission(self, owner, plan, *, hold_until=None):
        directory = self.directory(owner)
        from .contracts import PLANS

        def required(storage, days):
            # Include DB, images, encryption and restore/backup staging overhead.
            return storage * (max(1, days) + 2) * 2

        now = time.time()
        if hold_until is not None and not now < hold_until <= now + 400 * 86400:
            raise CloudError("invalid_backup_capacity_hold")
        # Serialize admission across all customers. Checking just the candidate
        # against free space would oversell the same disk to concurrent checkouts.
        with self.store.transaction() as db:
            commitments = {}
            active_owner = None
            for row in db.execute("SELECT id,plan,plan_until FROM accounts WHERE plan_until>? AND plan IN ('plus','pro')", (now,)):
                existing = PLANS[row["plan"]]
                commitments[row["id"]] = required(existing.storage_bytes, existing.restore_days)
                if row["id"] == owner:
                    active_owner = (existing.storage_bytes, existing.restore_days,
                                    row["plan_until"] + existing.restore_days * 86400)
            for row in db.execute("SELECT * FROM backup_capacity WHERE expires>?", (now,)):
                commitments[row["owner"]] = max(commitments.get(row["owner"], 0),
                    required(row["storage_bytes"], row["restore_days"]))
            commitments[owner] = max(commitments.get(owner, 0), required(plan.storage_bytes, plan.restore_days))
            # Free space excludes already-written backups; reserving complete
            # future commitments in addition is intentionally conservative.
            if shutil.disk_usage(directory).free < sum(commitments.values()):
                raise CloudError("backup_capacity_not_available", 503)
            if hold_until is not None:
                old = db.execute("SELECT * FROM backup_capacity WHERE owner=? AND expires>?", (owner, now)).fetchone()
                choices = [(plan.storage_bytes, plan.restore_days)]
                if old:
                    choices.append((old["storage_bytes"], old["restore_days"]))
                if active_owner:
                    choices.append(active_owner[:2])
                storage, days = max(choices, key=lambda pair: required(*pair))
                db.execute("INSERT INTO backup_capacity VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET storage_bytes=excluded.storage_bytes,restore_days=excluded.restore_days,expires=excluded.expires",
                           (owner, storage, days, max(hold_until, old["expires"] if old else 0,
                                                     active_owner[2] if active_owner else 0)))

    def list(self, owner):
        days = self.store.entitlements(owner).restore_days
        if not days:
            return []
        directory = self.directory(owner)
        return [
            {"id": p.stem, "created": p.stat().st_mtime}
            for p in sorted(directory.glob("*.kybackup"))
            if p.stat().st_mtime >= time.time() - days * 86400
        ]

    def create(self, owner, path, *, force=False):
        import zipfile

        directory = self.directory(owner)
        days = max(1, self.store.entitlements(owner).restore_days)
        recent = list(directory.glob("*.kybackup"))
        if not force and any(p.stat().st_mtime > time.time() - 20 * 3600 for p in recent):
            return None
        backup_id = uuid4().hex
        destination = directory / (backup_id + ".kybackup")
        with tempfile.TemporaryDirectory(dir=directory) as tmp:
            tmp = Path(tmp)
            src = sqlite3.connect(path)
            dst = sqlite3.connect(tmp / "data.db")
            try:
                src.backup(dst)
            finally:
                src.close()
                dst.close()
            with zipfile.ZipFile(tmp / "snapshot.zip", "w", zipfile.ZIP_DEFLATED) as archive:
                archive.write(tmp / "data.db", "data.db")
                assets = path.parent / "library_assets"
                if assets.is_dir() and not assets.is_symlink():
                    for asset in assets.iterdir():
                        if not asset.is_symlink() and asset.is_file():
                            archive.write(asset, "library_assets/" + asset.name)
            with (
                (tmp / "snapshot.zip").open("rb") as source,
                destination.with_suffix(".tmp").open("wb") as output,
            ):
                output.write(MAGIC)
                index = 0
                while raw := source.read(CHUNK):
                    token = self.store.cipher.encrypt(struct.pack("!Q", index) + raw)
                    output.write(struct.pack("!I", len(token)) + token)
                    index += 1
                footer = self.store.cipher.encrypt(
                    json.dumps({"owner": owner, "chunks": index}).encode()
                )
                output.write(struct.pack("!I", len(footer)) + footer)
                output.flush()
                os.fsync(output.fileno())
            destination.with_suffix(".tmp").replace(destination)
        for old in recent:
            if old.stat().st_mtime < time.time() - days * 86400:
                old.unlink()
        return backup_id

    def restore(self, owner, backup_id, path):
        import re
        import zipfile

        if not re.fullmatch(r"[0-9a-f]{32}", backup_id) or backup_id not in {
            r["id"] for r in self.list(owner)
        }:
            raise CloudError("backup_not_available", 404)
        directory = self.directory(owner)
        with tempfile.TemporaryDirectory(dir=path.parent) as tmp:
            tmp = Path(tmp)
            with (
                (directory / (backup_id + ".kybackup")).open("rb") as source,
                (tmp / "snapshot.zip").open("wb") as output,
            ):
                if source.read(len(MAGIC)) != MAGIC:
                    raise CloudError("invalid_backup")
                index = 0
                while True:
                    prefix = source.read(4)
                    if len(prefix) != 4:
                        raise CloudError("truncated_backup")
                    length = struct.unpack("!I", prefix)[0]
                    if not 0 < length < CHUNK * 2:
                        raise CloudError("invalid_backup_chunk")
                    raw = self.store.cipher.decrypt(source.read(length))
                    if raw.startswith(b"{"):
                        if json.loads(raw) != {"owner": owner, "chunks": index} or source.read(1):
                            raise CloudError("backup_owner_mismatch")
                        break
                    if len(raw) < 8 or struct.unpack("!Q", raw[:8])[0] != index:
                        raise CloudError("invalid_backup_order")
                    output.write(raw[8:])
                    index += 1
            with zipfile.ZipFile(tmp / "snapshot.zip") as archive:
                names = set()
                for item in archive.infolist():
                    if item.filename in names:
                        raise CloudError("duplicate_backup_member")
                    names.add(item.filename)
                    parts = Path(item.filename).parts
                    if item.filename != "data.db" and not (
                        len(parts) == 2
                        and parts[0] == "library_assets"
                        and re.fullmatch(r"[0-9a-f]{64}", parts[1])
                    ):
                        raise CloudError("invalid_backup_member")
                    if item.file_size > self.store.entitlements(owner).storage_bytes * 2:
                        raise CloudError("backup_too_large")
                archive.extractall(tmp / "restored")
            restored = tmp / "restored/data.db"
            con = sqlite3.connect(restored)
            try:
                if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise CloudError("backup_integrity_failed")
                con.execute(
                    "UPDATE generations SET status='cancelled',result_json='{}' WHERE status='pending'"
                )
                con.commit()
            finally:
                con.close()
            # Preserve current data before replacing it; the caller holds the tenant lock.
            self.create(owner, path, force=True)
            from python.local_backup import promote_core

            promote_core(restored, path.parent, tmp / "restored/library_assets")


def storage_usage(directory):
    return sum(
        p.stat().st_size
        for p in directory.rglob("*")
        if p.is_file() and not p.is_symlink() and p.suffix not in {".tmp", ".lock"}
    )
