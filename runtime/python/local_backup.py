"""Offline/online Core export; restore validates before touching current data."""

import json
import re
import sqlite3
import tempfile
import zipfile
from pathlib import Path


def promote_core(restored, data, new_assets):
    """Caller holds the runtime/tenant lock. DB copying is SQLite-atomic."""
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
        backup(data, before)
        from python.storage.runtime_lock import RuntimeLock

        with RuntimeLock(data):
            promote_core(restored, data, tmp / "restored/library_assets")
    return str(before)


if __name__ == "__main__":
    import sys

    command, data, file = sys.argv[1:]
    print((backup if command == "backup" else restore)(data, file))
