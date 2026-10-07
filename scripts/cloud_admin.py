"""Offline operations. No management API is exposed to cloud users."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import sys
import tarfile
import tempfile
from contextlib import closing
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "runtime"))
from python.cloud.config import CloudConfig
from python.cloud.store import CloudStore
from python.cloud.backups import MAGIC, CHUNK
from python.storage.runtime_lock import RuntimeLock


def disaster_backup(store, destination):
    if destination.exists():
        raise ValueError("Destination already exists")
    with (
        RuntimeLock(store.config.root),
        tempfile.TemporaryDirectory(dir=destination.parent) as tmp,
    ):
        tmp = Path(tmp)
        control = sqlite3.connect(store.path)
        copied = sqlite3.connect(tmp / "control.db")
        try:
            control.backup(copied)
        finally:
            control.close()
            copied.close()
        with tarfile.open(tmp / "snapshot.tar", "w") as archive:
            archive.add(tmp / "control.db", arcname="control.db")
            tenants = store.config.root / "tenants"
            if tenants.exists():
                for directory in tenants.iterdir():
                    if directory.is_symlink():
                        raise ValueError("Invalid tenant directory")
                    UUID(directory.name)
                    archive.add(
                        directory,
                        arcname="tenants/" + directory.name,
                        filter=lambda i: None if i.issym() or i.islnk() else i,
                    )
            # Retained user restore points must survive a Runtime disaster too.
            if store.config.backup_root and store.config.backup_root.exists():
                import re

                for directory in store.config.backup_root.iterdir():
                    # The current backup's own staging directory lives here when
                    # the destination is inside the configured backup root.
                    if directory == tmp:
                        continue
                    if not directory.is_dir() or directory.is_symlink():
                        continue
                    UUID(directory.name)
                    for file in directory.glob("*.kybackup"):
                        if not file.is_symlink() and re.fullmatch(
                            r"[0-9a-f]{32}\.kybackup", file.name
                        ):
                            archive.add(
                                file,
                                arcname="backups/" + directory.name + "/" + file.name,
                            )
        with (
            (tmp / "snapshot.tar").open("rb") as source,
            destination.open("xb") as output,
        ):
            output.write(MAGIC)
            index = 0
            while raw := source.read(CHUNK):
                token = store.cipher.encrypt(struct.pack("!Q", index) + raw)
                output.write(struct.pack("!I", len(token)) + token)
                index += 1
            token = store.cipher.encrypt(
                json.dumps({"kind": "disaster", "chunks": index}).encode()
            )
            output.write(struct.pack("!I", len(token)) + token)
    return hashlib.file_digest(destination.open("rb"), "sha256").hexdigest()


def disaster_restore(store, source):
    if (store.config.root / "tenants").exists():
        raise ValueError(
            "Restore only into a new empty destination; preserve the original"
        )
    with store.transaction() as db:
        if db.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
            raise ValueError("Destination control plane is not empty")
    if (
        store.config.backup_root
        and store.config.backup_root.exists()
        and any(store.config.backup_root.iterdir())
    ):
        raise ValueError("Destination backup store is not empty")
    with (
        RuntimeLock(store.config.root),
        tempfile.TemporaryDirectory(dir=store.config.root) as tmp,
    ):
        tmp = Path(tmp)
        with source.open("rb") as input, (tmp / "snapshot.tar").open("wb") as output:
            if input.read(len(MAGIC)) != MAGIC:
                raise ValueError("Invalid encrypted backup")
            index = 0
            while True:
                prefix = input.read(4)
                if len(prefix) != 4:
                    raise ValueError("Truncated encrypted backup")
                length = struct.unpack("!I", prefix)[0]
                if not 0 < length < CHUNK * 2:
                    raise ValueError("Invalid encrypted chunk")
                raw = store.cipher.decrypt(input.read(length))
                if raw.startswith(b"{"):
                    if json.loads(raw) != {
                        "kind": "disaster",
                        "chunks": index,
                    } or input.read(1):
                        raise ValueError("Invalid backup footer")
                    break
                if struct.unpack("!Q", raw[:8])[0] != index:
                    raise ValueError("Invalid chunk order")
                output.write(raw[8:])
                index += 1
        with tarfile.open(tmp / "snapshot.tar") as archive:
            for member in archive:
                parts = Path(member.name).parts
                if member.name != "control.db":
                    if len(parts) < 2 or parts[0] not in {"tenants", "backups"}:
                        raise ValueError("Invalid backup member")
                    UUID(parts[1])
                if (
                    member.issym()
                    or member.islnk()
                    or member.name.startswith("/")
                    or ".." in parts
                ):
                    raise ValueError("Unsafe backup member")
            archive.extractall(tmp / "restored", filter="data")
        for database in (tmp / "restored").rglob("*.db"):
            with closing(sqlite3.connect(database)) as con:
                if con.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Invalid database integrity")
        for item in (tmp / "restored").iterdir():
            if item.name == "backups":
                if store.config.backup_root is None:
                    raise ValueError("Restore requires a configured backup store")
                store.config.backup_root.parent.mkdir(parents=True, exist_ok=True)
                if store.config.backup_root.exists():
                    store.config.backup_root.rmdir()
                import shutil

                shutil.move(str(item), store.config.backup_root)
            else:
                item.replace(store.config.root / item.name)
        store.recover()


def upload(file):
    import httpx
    from urllib.parse import urlsplit

    destination = os.environ["KYALULU_OFFSITE_UPLOAD_URL"]
    if urlsplit(destination).scheme != "https":
        raise ValueError("Offsite upload requires HTTPS")
    with (
        file.open("rb") as data,
        httpx.Client(timeout=300, follow_redirects=False) as client,
    ):
        response = client.put(destination, content=iter(lambda: data.read(CHUNK), b""))
        if not response.is_success:
            raise ValueError("Offsite upload failed")
    print(
        json.dumps(
            {
                "uploaded": True,
                "sha256": hashlib.file_digest(file.open("rb"), "sha256").hexdigest(),
            }
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("backup", "restore", "upload", "budget", "grant"))
    parser.add_argument("--file", type=Path)
    parser.add_argument("--owner", help="Account UUID shown after a verified Web login")
    parser.add_argument("--credits", type=int)
    parser.add_argument("--source", help="Stable grant ID; reuse to avoid duplicate issuance")
    parser.add_argument("--days", type=int, default=30)
    args = parser.parse_args()
    if args.command == "upload":
        upload(args.file)
    else:
        store = CloudStore(CloudConfig.from_env())
        if args.command == "grant":
            if not args.owner or not args.credits or not args.source:
                parser.error("grant requires --owner, --credits and --source")
            print(json.dumps(store.admin_grant(args.owner, args.credits, args.source, days=args.days)))
        elif args.command == "backup":
            print(json.dumps({"sha256": disaster_backup(store, args.file)}))
        elif args.command == "restore":
            disaster_restore(store, args.file)
            print('{"restored":true}')
        else:
            with store.transaction() as db:
                print(
                    json.dumps(
                        {
                            "available_nano_usd": store._available_funds(db),
                            "budget_debt_nano_usd": db.execute("SELECT COALESCE(SUM(amount),0) FROM budget_debt").fetchone()[0],
                            "provider_overrun_incidents": db.execute("SELECT COUNT(*) FROM budget_debt WHERE source LIKE 'provider-overrun:%' AND amount>0").fetchone()[0],
                            "operations": [
                                dict(r)
                                for r in db.execute(
                                    "SELECT state,COUNT(*) AS count,SUM(actual_cost) AS cost FROM operations GROUP BY state"
                                )
                            ],
                        }
                    )
                )
