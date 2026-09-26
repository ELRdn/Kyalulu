"""Immutable Persona/World revisions. Session IDs name an exact revision."""
import json
import re
import sqlite3
from contextlib import contextmanager
from uuid import uuid4

from . import db as storage
from .library import LibraryConflict

REF = re.compile(r"^(created_[0-9a-f]{32})@(\d+)$")


@contextmanager
def _connect():
    db = sqlite3.connect(storage.DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def _item(row):
    return {**json.loads(row["document_json"]), "id": f"{row['asset_id']}@{row['revision']}",
            "asset_id": row["asset_id"], "revision": row["revision"], "kind": row["kind"],
            "version": f"1.0.{row['revision'] - 1}", "created_at": row["created_at"]}


def get(reference: str, kind: str | None = None):
    match = REF.fullmatch(reference)
    if not match or not storage.DB_PATH.exists():
        return None
    with _connect() as db:
        row = db.execute("SELECT * FROM creator_versions WHERE asset_id=? AND revision=?",
                         match.groups()).fetchone()
    return _item(row) if row and (kind is None or row["kind"] == kind) else None


def list_latest(kind: str):
    with _connect() as db:
        rows = db.execute("SELECT * FROM creator_versions v WHERE kind=? AND revision="
                          "(SELECT MAX(revision) FROM creator_versions WHERE asset_id=v.asset_id) "
                          "ORDER BY created_at DESC, asset_id", (kind,)).fetchall()
    return [_item(row) for row in rows]


def history(reference: str):
    item = get(reference)
    if not item:
        raise ValueError("保存した設定が見つかりません")
    with _connect() as db:
        rows = db.execute("SELECT * FROM creator_versions WHERE asset_id=? ORDER BY revision DESC",
                          (item["asset_id"],)).fetchall()
    return [_item(row) for row in rows]


def save(kind: str, document: dict, reference: str | None = None):
    before = get(reference, kind) if reference else None
    if reference and not before:
        raise ValueError("保存した設定が見つかりません")
    asset_id = before["asset_id"] if before else "created_" + uuid4().hex
    revision = before["revision"] + 1 if before else 1
    with _connect() as db:
        db.execute("BEGIN IMMEDIATE")
        latest = db.execute("SELECT MAX(revision) FROM creator_versions WHERE asset_id=?", (asset_id,)).fetchone()[0]
        if before and latest != before["revision"]:
            raise LibraryConflict("別の編集が保存されています。一覧から最新版を開き直してください")
        db.execute("INSERT INTO creator_versions(asset_id,revision,kind,document_json) VALUES(?,?,?,?)",
                   (asset_id, revision, kind, json.dumps(document, ensure_ascii=False)))
    return get(f"{asset_id}@{revision}", kind)
