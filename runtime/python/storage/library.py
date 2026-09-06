"""Portable library revisions and transactional imports. Originals are immutable."""
from __future__ import annotations
import hashlib
import json
import re
import sqlite3
from contextlib import contextmanager
from uuid import uuid4
from python.core.portable_schema import ImportCommit, LibraryItem, PortableDocument
from . import db as database


class LibraryConflict(ValueError):
    pass


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


@contextmanager
def connect():
    con = sqlite3.connect(database.DB_PATH, timeout=15)
    try:
        with con:
            con.row_factory = sqlite3.Row
            yield con
    finally:
        con.close()


def _item(row):
    return LibraryItem(id=row['id'], revision=row['revision'],
                       document=PortableDocument.model_validate_json(row['document_json']),
                       original_id=row['original_id'])


def get_item(item_id: str, revision: int | None = None) -> LibraryItem | None:
    if not database.DB_PATH.exists():
        return None
    with connect() as con:
        if not con.execute("SELECT 1 FROM sqlite_master WHERE name='library_versions'").fetchone():
            return None
        row = con.execute('SELECT * FROM library_versions WHERE id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1',
                          (item_id, revision, revision)).fetchone()
        return _item(row) if row else None


def list_items():
    with connect() as con:
        return [_item(row) for row in con.execute('SELECT v.* FROM library_versions v JOIN (SELECT id,MAX(revision) AS revision FROM library_versions GROUP BY id) m USING(id,revision) ORDER BY v.created_at DESC,v.id')]


def asset_path(asset_id: str):
    if not re.fullmatch(r'[0-9a-f]{64}', asset_id):
        raise ValueError('invalid asset ID')
    return database.DB_PATH.parent / 'library_assets' / asset_id


def store_assets(assets):
    with connect() as con:
        for asset_id, (raw, media_type) in assets.items():
            if hashlib.sha256(raw).hexdigest() != asset_id:
                raise ValueError('asset checksum mismatch')
            path = asset_path(asset_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                temporary = path.with_suffix('.' + uuid4().hex + '.tmp')
                temporary.write_bytes(raw)
                temporary.replace(path)
            con.execute('INSERT OR IGNORE INTO library_assets VALUES (?,?)', (asset_id, media_type))


def read_asset(asset_id):
    path = asset_path(asset_id)
    with connect() as con:
        row = con.execute('SELECT media_type FROM library_assets WHERE id=?', (asset_id,)).fetchone()
    if not row or not path.is_file():
        raise ValueError('asset not found')
    return path.read_bytes(), row[0]


def document_assets(document):
    return {a.asset_id: read_asset(a.asset_id) for a in document.assets if a.asset_id}


def preview(filename, raw, documents, assets):
    store_assets(assets)
    source_hash = hashlib.sha256(raw).hexdigest()
    preview_id = uuid4().hex
    with connect() as con:
        con.execute('INSERT OR IGNORE INTO library_originals VALUES (?,?,?)', (source_hash, filename, raw))
        con.execute('INSERT INTO library_previews (id,original_id,documents_json) VALUES (?,?,?)',
                    (preview_id, source_hash, encode([d.model_dump() for d in documents])))
    return dict(preview_id=preview_id, filename=filename, source_hash=source_hash,
                documents=[d.model_dump() for d in documents])


def _write(con, document, original_id=None, target_id=None, expected_revision=None):
    # Source IDs and official flags cannot replace bundled characters.
    document = document.model_copy(deep=True)
    document.data.pop('official', None)
    if not document.name.strip():
        raise ValueError('name is required')
    document.data['name'] = document.name
    for asset in document.assets:
        if asset.asset_id:
            read_asset(asset.asset_id)
    item_id = target_id or 'lib_' + uuid4().hex
    old = con.execute('SELECT MAX(revision) FROM library_versions WHERE id=?', (item_id,)).fetchone()[0]
    if target_id and (old is None or expected_revision != old):
        raise LibraryConflict('Library changed; reload before updating')
    revision = (old or 0) + 1
    con.execute('INSERT INTO library_versions (id,revision,document_json,original_id) VALUES (?,?,?,?)',
                (item_id, revision, document.model_dump_json(), original_id))
    return LibraryItem(id=item_id, revision=revision, document=document, original_id=original_id)


def save_item(document, target_id=None, expected_revision=None):
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        old = con.execute('SELECT original_id FROM library_versions WHERE id=? ORDER BY revision DESC LIMIT 1', (target_id,)).fetchone()
        return _write(con, document, old[0] if old else None, target_id, expected_revision)


def commit(preview_id: str, body: ImportCommit):
    fingerprint = hashlib.sha256(encode({'preview_id': preview_id, **body.model_dump()}).encode()).hexdigest()
    with connect() as con:
        con.execute('BEGIN IMMEDIATE')
        saved = con.execute('SELECT * FROM library_commits WHERE request_id=?', (body.request_id,)).fetchone()
        if saved:
            if saved['fingerprint'] != fingerprint:
                raise LibraryConflict('request ID reused with different import')
            return json.loads(saved['result_json'])
        row = con.execute('SELECT * FROM library_previews WHERE id=?', (preview_id,)).fetchone()
        if not row:
            raise ValueError('import preview not found')
        sources = json.loads(row['documents_json'])
        if len({s.index for s in body.selections}) != len(body.selections):
            raise ValueError('duplicate selection')
        items, sessions = [], []
        for selection in body.selections:
            if selection.index >= len(sources):
                raise ValueError('invalid selection')
            doc = selection.document.model_copy(deep=True)
            source = PortableDocument.model_validate(sources[selection.index])
            # Provenance and preserved unsupported fields cannot be replaced by client assertions.
            doc.source, doc.source_format = source.source, source.source_format
            if any(not 0 <= idx < len(source.histories) for idx in selection.history_indices):
                raise ValueError('invalid history selection')
            doc.histories = [source.histories[idx] for idx in sorted(set(selection.history_indices))]
            doc.notices = source.notices
            item = _write(con, doc, row['original_id'], selection.target_id, selection.expected_revision)
            items.append(item.model_dump())
            for idx in sorted(set(selection.history_indices)):
                if doc.kind != 'character' or not 0 <= idx < len(source.histories):
                    raise ValueError('invalid history selection')
                history = source.histories[idx]
                sid = str(uuid4())
                binding = {'character': {'id': item.id, 'revision': item.revision}}
                con.execute('INSERT INTO session_settings (session_id,character_id,library_binding,intro,temperature) VALUES (?,?,?,?,?)',
                            (sid, item.id, encode(binding), doc.data.get('first_mes', ''), doc.profile.settings.get('temperature', 0.8)))
                for message in history.messages:
                    if message.get('role') not in {'user', 'assistant'}:
                        raise ValueError('unsupported history role')
                    cur = con.execute("INSERT INTO chat_history (session_id,role,content,model_id,created_at) VALUES (?,?,?,?,COALESCE(?,datetime('now')))",
                                      (sid, message['role'], message['content'], 'imported', message.get('created_at')))
                    con.execute('INSERT INTO imported_history VALUES (?,?)',
                                (cur.lastrowid, encode({'original_id': row['original_id'], 'history_index': idx, **message})))
                sessions.append({'session_id': sid, 'name': history.name, 'character_id': item.id})
        result = {'items': items, 'sessions': sessions}
        con.execute('INSERT INTO library_commits VALUES (?,?,?)', (body.request_id, fingerprint, encode(result)))
        return result


def original(original_id):
    with connect() as con:
        row = con.execute('SELECT filename,content FROM library_originals WHERE id=?', (original_id,)).fetchone()
        if not row:
            raise ValueError('original not found')
        return row['filename'], row['content']


def character_info(item):
    doc = item.document
    return dict(id=item.id, version=f'1.0.{item.revision}', display_name=doc.name,
                description=doc.data.get('description', ''), personality=doc.data.get('personality', ''),
                speaking_style=doc.speaking_style, intro=doc.data.get('first_mes', ''),
                tags=doc.data.get('tags', []), recommended_generation=doc.profile.settings,
                nsfw=doc.nsfw, official=False, library_revision=item.revision,
                alternate_greetings=doc.data.get('alternate_greetings', []),
                portrait_url=next((f'/api/library/assets/{a.asset_id}' for a in doc.assets if a.type == 'icon' and a.asset_id), None))
