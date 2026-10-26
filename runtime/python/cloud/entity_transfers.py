"""Resumable entity bytes use the existing encrypted transfer-page store."""
import base64
import asyncio
import hashlib
import json
import logging
import math
import re
import shutil
import time
from uuid import UUID

from .store import CloudError
from .transfers import Transfers, connection
from .json_stream import JsonStream

CHUNK_BYTES = 1024 * 1024
INLINE_BYTES = 1_500_000


def json_chunks(value):
    """Preserve compact JSON bytes while bounding the additional UTF-8 buffers."""
    # shortcut: JSONEncoder retains one encoded scalar; segment stored strings before claiming bounded single-value memory.
    pending = bytearray()
    for text in json.JSONEncoder(ensure_ascii=False, separators=(',', ':')).iterencode(value):
        for start in range(0, len(text), CHUNK_BYTES // 4):
            raw = text[start:start + CHUNK_BYTES // 4].encode()
            offset = 0
            while offset < len(raw):
                length = min(len(raw) - offset, CHUNK_BYTES - len(pending))
                pending.extend(raw[offset:offset + length]); offset += length
                if len(pending) == CHUNK_BYTES:
                    yield bytes(pending)
                    pending.clear()
    if pending:
        yield bytes(pending)


class EntityTransfers:
    def __init__(self, service):
        self.service, self.store = service, service.store
        self.pages = Transfers(self.store, None, entity=True)

    def cleanup(self):
        """Reap disposable ciphertext only; durable requests/entities/outboxes stay intact."""
        counts = {'removed': 0, 'retained': 0, 'unreadable': 0}
        root = self.store.config.root / self.pages.root
        try:
            if not root.exists(): return counts
            if root.is_symlink() or root.resolve() != self.store.config.root.resolve() / self.pages.root:
                raise ValueError('Linked transfer root')
            for directory in root.iterdir():
                if not directory.is_dir(): continue
                try:
                    if str(UUID(directory.name)) != directory.name or directory.is_symlink() or directory.resolve() != root.resolve() / directory.name:
                        raise ValueError('Invalid transfer directory')
                except ValueError:
                    counts['unreadable'] += 1
                    continue
                for file in directory.glob('*.db'):
                    try:
                        if str(UUID(file.stem)) != file.stem or file.is_symlink() or file.resolve() != directory.resolve() / file.name:
                            raise ValueError('Invalid transfer file')
                        # Serialize expiry inspection with page writers before removing a closed DB.
                        with connection(file) as db:
                            db.execute('BEGIN IMMEDIATE')
                            row = db.execute('SELECT payload FROM meta').fetchone()
                            meta = json.loads(self.store.decrypt(row[0]))
                            direction, expires = meta['direction'], meta['expires']
                            if (not isinstance(direction, str) or not direction.startswith(('app-upload:', 'app-download:'))
                                or type(expires) not in (int, float) or not math.isfinite(expires)):
                                raise ValueError('Invalid stage metadata')
                            obsolete = expires <= time.time() or self._obsolete(directory.name, meta)
                        if obsolete:
                            self.pages.delete(directory.name, file.stem)
                            counts['removed'] += 1
                        else: counts['retained'] += 1
                    except Exception:
                        # Unknown/corrupt stages need operator recovery, never guessed deletion.
                        counts['unreadable'] += 1
        except Exception:
            counts['unreadable'] += 1
        if counts['unreadable']:
            logging.getLogger(__name__).warning('entity_transfer_cleanup_unreadable count=%s', counts['unreadable'])
        if counts['removed']:
            logging.getLogger(__name__).info('entity_transfer_cleanup_removed count=%s', counts['removed'])
        return counts

    def _obsolete(self, owner, meta):
        if meta['direction'].startswith('app-upload:'):
            try: return self._receipt(owner, meta['request_id']) is not None
            except CloudError as exc:
                if exc.code != 'sync_request_canceled': raise
                return True
        if meta['direction'].startswith('app-download:'):
            with self.store.transaction() as db:
                current = db.execute('SELECT revision,deleted FROM app_entities WHERE owner=? AND id=?',
                                     (owner, meta['direction'][len('app-download:'):])).fetchone()
                return not current or bool(current['deleted']) or current['revision'] != meta['revision']
        raise ValueError('Unknown entity transfer direction')

    async def worker(self):
        while True:
            await asyncio.sleep(60)
            self.cleanup()

    def _receipt(self, owner, request_id):
        with self.store.transaction() as db:
            row = db.execute('SELECT result FROM app_sync_requests WHERE owner=? AND id=?', (owner, request_id)).fetchone()
            if row: return json.loads(self.store.decrypt(row[0]))
            if db.execute('SELECT 1 FROM app_sync_cancellations WHERE owner=? AND id=?', (owner, request_id)).fetchone():
                raise CloudError('sync_request_canceled', 409)

    def discard_upload(self, owner, request_id):
        for file in self.pages.directory(owner).glob('*.db'):
            try: meta = self.pages.inspect(owner, file.stem)
            except CloudError as exc:
                if exc.code != 'transfer_expired': raise
                self.pages.delete(owner, file.stem)
                continue
            if meta['direction'].startswith('app-upload') and meta['request_id'] == request_id:
                self.pages.delete(owner, file.stem)

    def begin(self, owner, request_id, size, sha256):
        self.service.available()
        if (not isinstance(request_id, str) or not 0 < len(request_id) <= 100
            or type(size) is not int or size < 1 or not isinstance(sha256, str) or not re.fullmatch('[a-f0-9]{64}', sha256)):
            raise CloudError('invalid_entity_transfer')
        capacity = self.store.entitlements(owner).storage_bytes
        with self.store.transaction() as db:
            prior = db.execute('SELECT size,sha256 FROM app_transfer_manifests WHERE owner=? AND request_id=?', (owner, request_id)).fetchone()
            if prior and tuple(prior) != (size, sha256): raise CloudError('sync_request_conflict', 409)
            if not prior and db.execute('SELECT 1 FROM app_sync_requests WHERE owner=? AND id=?', (owner, request_id)).fetchone():
                return {'inline_receipt_required': True}
            if not prior and size > capacity: raise CloudError('cloud_storage_full', 413)
            db.execute('INSERT OR IGNORE INTO app_transfer_manifests VALUES(?,?,?,?)', (owner, request_id, size, sha256))
        receipt = self._receipt(owner, request_id)
        if receipt:
            self.discard_upload(owner, request_id)
            return {'result': receipt}
        if size > capacity: raise CloudError('cloud_storage_full', 413)
        reserved = 0
        for file in self.pages.directory(owner).glob('*.db'):
            try: meta = self.pages.inspect(owner, file.stem)
            except CloudError as exc:
                if exc.code != 'transfer_expired': raise
                self.pages.delete(owner, file.stem)
                continue
            if meta['direction'].startswith('app-upload'):
                try: applied = self._receipt(owner, meta['request_id'])
                except CloudError as exc:
                    if exc.code != 'sync_request_canceled': raise
                    applied = True
                if applied:
                    self.pages.delete(owner, file.stem)
                    continue
            if meta['direction'].startswith('app-upload') and meta['request_id'] == request_id:
                if meta.get('raw_size') != size or meta.get('raw_sha256') != sha256:
                    self.pages.delete(owner, file.stem)
                    continue
                return {'transfer_id': file.stem, 'next': meta['next'], 'chunk_bytes': CHUNK_BYTES}
            if meta['direction'].startswith('app-upload'): reserved += meta.get('raw_size', 0)
        if reserved + size > capacity * 2:
            raise CloudError('transfer_capacity_not_available', 503)
        transfer = self.pages.create(owner, direction='app-upload:' + request_id, selected=[], revision=0, request_id=request_id)
        with connection(self.pages.file(owner, transfer)) as db:
            meta = self.pages.meta(db)
            meta.update(raw_size=size, raw_sha256=sha256)
            self.pages.update_meta(db, meta)
        return {'transfer_id': transfer, 'next': 0, 'chunk_bytes': CHUNK_BYTES}

    def append(self, owner, transfer, index, data, sha256):
        self.service.available()
        meta = self.pages.inspect(owner, transfer)
        if not meta['direction'].startswith('app-upload'): raise CloudError('invalid_transfer_direction', 409)
        self._receipt(owner, meta['request_id'])
        if meta['raw_size'] > self.store.entitlements(owner).storage_bytes: raise CloudError('cloud_storage_full', 413)
        if type(index) is not int or not 0 <= index < math.ceil(meta['raw_size'] / CHUNK_BYTES):
            raise CloudError('invalid_transfer_page')
        expected = min(CHUNK_BYTES, meta['raw_size'] - index * CHUNK_BYTES)
        if not isinstance(data, str) or len(data) > 4 * math.ceil(CHUNK_BYTES / 3): raise CloudError('invalid_transfer_page')
        try: raw = base64.b64decode(data, validate=True)
        except ValueError as exc: raise CloudError('invalid_transfer_page') from exc
        if len(raw) != expected or hashlib.sha256(raw).hexdigest() != sha256: raise CloudError('transfer_hash_mismatch', 409)
        self.pages.append(owner, transfer, index, {'table': 'app_entity_bytes', 'rows': [{'data': data, 'sha256': sha256}]})
        return {'next': self.pages.inspect(owner, transfer)['next']}

    def commit(self, owner, transfer, *, runtime_path=None):
        self.service.available()
        meta = self.pages.inspect(owner, transfer)
        if not meta['direction'].startswith('app-upload'): raise CloudError('invalid_transfer_direction', 409)
        receipt = self._receipt(owner, meta['request_id'])
        if receipt:
            self.discard_upload(owner, meta['request_id'])
            return receipt
        if meta['next'] != math.ceil(meta['raw_size'] / CHUNK_BYTES): raise CloudError('transfer_incomplete', 409)
        # shortcut: decoded objects/scalars remain whole; segment storage before 1 GB single-batch acceptance.
        parser, digest, size = JsonStream(), hashlib.sha256(), 0
        try:
            with connection(self.pages.file(owner, transfer)) as db:
                for (encoded,) in db.execute('SELECT payload FROM pages ORDER BY seq'):
                    part = json.loads(self.store.decrypt(encoded))['rows'][0]
                    raw = base64.b64decode(part['data'], validate=True)
                    size += len(raw); digest.update(raw); parser.feed(raw)
            if size != meta['raw_size'] or digest.hexdigest() != meta['raw_sha256']:
                raise CloudError('transfer_hash_mismatch', 409)
            body = parser.finish()
        except CloudError: raise
        except (ValueError, UnicodeError) as exc: raise CloudError('invalid_sync_request') from exc
        if not isinstance(body, dict) or set(body) != {'request_id', 'changes'} or body['request_id'] != meta['request_id']:
            raise CloudError('invalid_sync_request')
        result = self.service.push(owner, body['request_id'], body['changes'], runtime_path=runtime_path, verified_transfer=True)
        self.pages.delete(owner, transfer)
        return result

    def download(self, owner, entity, *, inline_limit=INLINE_BYTES):
        self.service.available()
        size, digest = 0, hashlib.sha256()
        for raw in json_chunks(entity['payload']):
            size += len(raw)
            if size > 1_000_000_000: raise CloudError('transfer_too_large', 413)
            digest.update(raw)
        if size <= inline_limit: return entity
        direction = 'app-download:' + entity['id']
        for file in self.pages.directory(owner).glob('*.db'):
            try: meta = self.pages.inspect(owner, file.stem)
            except CloudError as exc:
                if exc.code != 'transfer_expired': raise
                self.pages.delete(owner, file.stem)
                continue
            if meta['direction'] == direction:
                if meta['revision'] == entity['revision'] and meta['ready']:
                    return {key: value for key, value in entity.items() if key != 'payload'} | {'payload_ref': meta['entity_ref'], 'message_count': len(entity['payload'].get('messages', []))}
                self.pages.delete(owner, file.stem)
        if shutil.disk_usage(self.pages.directory(owner)).free < size * 3:
            raise CloudError('transfer_capacity_not_available', 503)
        transfer = self.pages.create(owner, direction=direction, selected=[], revision=entity['revision'])
        ref = {'transfer_id': transfer, 'size': size, 'sha256': digest.hexdigest(),
               'chunk_bytes': CHUNK_BYTES, 'chunks': math.ceil(size / CHUNK_BYTES), 'id': entity['id'], 'revision': entity['revision']}
        try:
            with connection(self.pages.file(owner, transfer)) as db:
                meta = self.pages.meta(db)
                meta['download_size'] = size
                self.pages.update_meta(db, meta)
            for index, raw in enumerate(json_chunks(entity['payload'])):
                self.pages.append(owner, transfer, index, {'table': 'app_entity_bytes', 'rows': [
                    {'data': base64.b64encode(raw).decode(), 'sha256': hashlib.sha256(raw).hexdigest()}]})
            with connection(self.pages.file(owner, transfer)) as db:
                meta = self.pages.meta(db)
                meta.update(ready=True, entity_ref=ref)
                self.pages.update_meta(db, meta)
        except BaseException:
            self.pages.delete(owner, transfer)
            raise
        return {key: value for key, value in entity.items() if key != 'payload'} | {'payload_ref': ref, 'message_count': len(entity['payload'].get('messages', []))}

    def part(self, owner, transfer, index):
        self.service.available()
        meta = self.pages.inspect(owner, transfer)
        if not meta['direction'].startswith('app-download:') or not meta['ready']: raise CloudError('invalid_transfer_direction', 409)
        ref = meta['entity_ref']
        if type(index) is not int or not 0 <= index < ref['chunks']: raise CloudError('invalid_transfer_page')
        with self.store.transaction() as control:
            current = control.execute('SELECT revision,deleted FROM app_entities WHERE owner=? AND id=?', (owner, ref['id'])).fetchone()
            if not current or current['deleted'] or current['revision'] != ref['revision']:
                raise CloudError('transfer_source_changed_restart_download', 409)
            with connection(self.pages.file(owner, transfer)) as db:
                row = db.execute('SELECT payload FROM pages WHERE seq=?', (index,)).fetchone()
                if not row: raise CloudError('transfer_incomplete', 409)
                return json.loads(self.store.decrypt(row[0]))['rows'][0]
