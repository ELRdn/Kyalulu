"""Immutable public snapshots with explicit human review and private appeals."""
import hashlib
import json
import time
from uuid import UUID, uuid4

from .community import Community, PUBLIC_KEYS
from .store import CloudError

DDL = """
CREATE TABLE IF NOT EXISTS app_publication_sources(id TEXT PRIMARY KEY,sha256 TEXT,
 item TEXT,source_revision INTEGER,author_id TEXT,author_name TEXT);
CREATE TABLE IF NOT EXISTS app_publication_requests(owner TEXT,request TEXT,hash TEXT,
 publication TEXT,PRIMARY KEY(owner,request));
CREATE TABLE IF NOT EXISTS app_publication_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,
 publication TEXT,revision INTEGER,actor TEXT,decision TEXT,reason TEXT,checks TEXT,sha256 TEXT,created REAL);
CREATE TABLE IF NOT EXISTS app_publication_reports(id TEXT PRIMARY KEY,owner TEXT,
 publication TEXT,revision INTEGER,reason TEXT,created REAL,UNIQUE(owner,publication,revision));
CREATE TABLE IF NOT EXISTS app_publication_appeals(id TEXT PRIMARY KEY,owner TEXT,
 publication TEXT,revision INTEGER,reason TEXT,created REAL,UNIQUE(publication,revision));
CREATE TABLE IF NOT EXISTS app_publication_blocks(owner TEXT,author TEXT,PRIMARY KEY(owner,author));
CREATE TABLE IF NOT EXISTS app_publication_adult_consent(owner TEXT PRIMARY KEY,
 country TEXT,policy TEXT,enabled INTEGER);
CREATE INDEX IF NOT EXISTS app_publication_source_lookup ON app_publication_sources(item,source_revision,sha256);
CREATE INDEX IF NOT EXISTS app_publication_public ON app_publications(status,rating,created);
CREATE INDEX IF NOT EXISTS app_publication_event_lookup ON app_publication_events(publication,revision);
"""
CHECKS = {'content_reviewed', 'prohibited_content_absent', 'rating_correct'}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def snapshot(payload, rating):
    if not isinstance(payload, dict) or rating not in ('general', 'adult'):
        raise CloudError('invalid_publication')
    if payload.get('kind', 'character') != 'character' or type(payload.get('nsfw', False)) is not bool:
        raise CloudError('invalid_publication')
    if payload.get('nsfw') and rating != 'adult':
        raise CloudError('publication_rating_mismatch', 403)
    name, data, style = payload.get('name'), payload.get('data', {}), payload.get('speaking_style', '')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120 or not isinstance(data, dict) or not isinstance(style, str):
        raise CloudError('invalid_publication')
    public = {}
    for key in PUBLIC_KEYS:
        if key not in data:
            continue
        value = data[key]
        if key in ('tags', 'alternate_greetings'):
            if not isinstance(value, list) or len(value) > (30 if key == 'tags' else 16) or any(not isinstance(item, str) or len(item) > (80 if key == 'tags' else 8000) for item in value):
                raise CloudError('invalid_publication')
        elif not isinstance(value, str):
            raise CloudError('invalid_publication')
        public[key] = value
    result = {'schema_version': 1, 'kind': 'character', 'name': name.strip(), 'data': public,
              'nsfw': rating == 'adult', 'speaking_style': style}
    if len(json.dumps(result, ensure_ascii=False).encode()) > 40_000:
        raise CloudError('public_work_too_large', 413)
    return result


class Publications:
    def __init__(self, service):
        self.service, self.store = service, service.store
        with self.store.transaction() as db:
            db.executescript(DDL)

    def accepted(self):
        cfg = self.store.config
        return cfg.unified_enabled and cfg.community_enabled and cfg.legal_approved and not cfg.private_test

    def general(self, owner):
        self.service.available()
        self.service.require_general(owner)
        return json.loads(self.store.secret(owner, 'app-eligibility'))

    def adult(self, owner):
        value = self.general(owner)
        if value['age_band'] != 'adult':
            raise CloudError('adult_verification_required', 403)
        self.service.require_adult(owner, country=value['country'])
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM app_publication_adult_consent WHERE owner=?', (owner,)).fetchone()
        return bool(row and row['enabled'] and row['country'] == value['country'] and row['policy'] == value['policy'])

    def consent(self, owner, enabled=None):
        if enabled is False:
            self.service.available()
            with self.store.transaction() as db:
                db.execute('DELETE FROM app_publication_adult_consent WHERE owner=?', (owner,))
            return {'enabled': False}
        value = self.general(owner)
        if enabled is not None:
            if type(enabled) is not bool:
                raise CloudError('invalid_adult_consent')
            if enabled:
                if value['age_band'] != 'adult':
                    raise CloudError('adult_verification_required', 403)
                self.service.require_adult(owner, country=value['country'])
            with self.store.transaction() as db:
                db.execute('INSERT INTO app_publication_adult_consent VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET country=excluded.country,policy=excluded.policy,enabled=excluded.enabled', (owner, value['country'], value['policy'], int(enabled)))
        try:
            active = self.adult(owner)
        except CloudError:
            active = False
        return {'enabled': active}

    def ratings(self, owner, *, public=False):
        self.service.available()
        if public and not self.accepted():
            raise CloudError('publications_awaiting_acceptance', 503)
        allowed = ['general']
        if owner:
            self.general(owner)
            try:
                if self.adult(owner):
                    allowed.append('adult')
            except CloudError:
                pass
        return allowed

    @staticmethod
    def _row(db, publication):
        row = db.execute('SELECT p.*,s.sha256,s.item,s.source_revision,s.author_id,s.author_name FROM app_publications p LEFT JOIN app_publication_sources s ON s.id=p.id WHERE p.id=?', (publication,)).fetchone()
        if not row:
            raise CloudError('publication_not_found', 404)
        return row

    @staticmethod
    def _document(row):
        document = json.loads(row['payload'])
        if row['sha256'] and digest(document) != row['sha256']:
            raise CloudError('publication_snapshot_changed', 409)
        return document

    @staticmethod
    def _revision(row, revision):
        if type(revision) is not int or row['revision'] != revision:
            raise CloudError('publication_revision_conflict', 409)

    @staticmethod
    def _event(db, row, actor, decision, reason, checks):
        db.execute('INSERT INTO app_publication_events(publication,revision,actor,decision,reason,checks,sha256,created) VALUES(?,?,?,?,?,?,?,?)',
                   (row['id'], row['revision'] + 1, actor, decision, reason, json.dumps(checks, sort_keys=True), row['sha256'], time.time()))

    def submit(self, owner, payload, rating, *, request_id=None, source=None, author_name='Creator'):
        document = snapshot(payload, rating)
        if rating == 'adult':
            if not self.adult(owner):
                raise CloudError('adult_content_enablement_required', 403)
        else:
            self.general(owner)
        if request_id is not None:
            try:
                request_id = str(UUID(request_id))
            except (ValueError, TypeError, AttributeError) as exc:
                raise CloudError('invalid_publication_request') from exc
        if source is not None and (not isinstance(source, dict) or set(source) != {'item_id', 'revision'} or not isinstance(source['item_id'], str) or not 1 <= len(source['item_id']) <= 200 or type(source['revision']) is not int or not 1 <= source['revision'] <= 2**53 - 1):
            raise CloudError('invalid_publication_source')
        if not isinstance(author_name, str) or not 1 <= len(author_name.strip()) <= 80:
            raise CloudError('invalid_publication_author')
        hash = digest({'document': document, 'rating': rating, 'source': source})
        snapshot_hash = digest(document)
        with self.store.transaction() as db:
            old = db.execute('SELECT hash,publication FROM app_publication_requests WHERE owner=? AND request=?', (owner, request_id)).fetchone() if request_id else None
            if old:
                if old['hash'] != hash:
                    raise CloudError('publication_request_conflict', 409)
                row = self._row(db, old['publication'])
                return {'id': row['id'], 'revision': row['revision'], 'status': row['status']}
            if source:
                existing = db.execute("SELECT p.id,p.revision,p.status FROM app_publications p JOIN app_publication_sources s ON s.id=p.id WHERE p.owner=? AND s.item=? AND s.source_revision=? AND s.sha256=? AND p.status!='withdrawn' ORDER BY p.created LIMIT 1", (owner, source['item_id'], source['revision'], snapshot_hash)).fetchone()
                if existing:
                    if request_id:
                        db.execute('INSERT INTO app_publication_requests VALUES(?,?,?,?)', (owner, request_id, hash, existing['id']))
                    return dict(existing)
            if db.execute('SELECT COUNT(*) FROM app_publications WHERE owner=? AND created>?', (owner, time.time() - 3600)).fetchone()[0] >= 20:
                raise CloudError('publication_rate_limit', 429)
            id = str(uuid4())
            db.execute('INSERT INTO app_publications VALUES(?,?,?,?,?,?,?,?)', (id, owner, 1, rating, 'pending', json.dumps(document, ensure_ascii=False), 'manual_review_required', time.time()))
            db.execute('INSERT INTO app_publication_sources VALUES(?,?,?,?,?,?)', (id, snapshot_hash, (source or {}).get('item_id'), (source or {}).get('revision', 1), Community.author_id(owner), author_name.strip()))
            if request_id:
                db.execute('INSERT INTO app_publication_requests VALUES(?,?,?,?)', (owner, request_id, hash, id))
        return {'id': id, 'revision': 1, 'status': 'pending'}

    def queue(self, owner):
        allowed, moderator = self.ratings(owner), owner in self.store.config.moderator_owners
        with self.store.transaction() as db:
            ids = db.execute("SELECT p.id FROM app_publications p WHERE (owner=? OR ?=1) AND rating IN ({}) ORDER BY CASE WHEN status='pending' OR EXISTS(SELECT 1 FROM app_publication_appeals a WHERE a.publication=p.id AND a.revision=p.revision) THEN 0 ELSE 1 END,created DESC LIMIT 100".format(','.join('?' for _ in allowed)), (owner, int(moderator), *allowed)).fetchall()
            items = []
            for item in ids:
                row = self._row(db, item['id'])
                if row['rating'] not in allowed:
                    continue
                value = {key: row[key] for key in ('id', 'revision', 'rating', 'status', 'reason')}
                value.update(document=self._document(row), snapshot_hash=row['sha256'] or digest(json.loads(row['payload'])), author_name=row['author_name'] or 'Creator', owned=row['owner'] == owner,
                             source={'item_id': row['item'], 'revision': row['source_revision'] or 1}, classification='unknown',
                             events=[{key: event[key] for key in ('revision', 'decision', 'reason', 'checks')} for event in db.execute('SELECT * FROM app_publication_events WHERE publication=? ORDER BY seq', (row['id'],))])
                value['reports'] = [dict(report) for report in db.execute('SELECT id,revision,reason FROM app_publication_reports WHERE publication=? ORDER BY created', (row['id'],))] if moderator else []
                value['appeals'] = [dict(appeal) for appeal in db.execute('SELECT id,revision,reason FROM app_publication_appeals WHERE publication=? ORDER BY created', (row['id'],))]
                items.append(value)
        from .account_profile import AccountProfile
        return {'publications': items, 'moderator': moderator, 'owner_scope': owner, 'account_name': AccountProfile(self.store).read(owner)['display_name']}

    def review(self, owner, publication, revision, decision, reason, checks=None):
        self.service.available()
        if owner not in self.store.config.moderator_owners:
            raise CloudError('moderator_required', 403)
        allowed = self.ratings(owner)
        if decision not in ('approved', 'rejected', 'hidden') or not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 1000:
            raise CloudError('invalid_review')
        if decision == 'approved' and (not isinstance(checks, dict) or set(checks) != CHECKS or any(value is not True for value in checks.values())):
            raise CloudError('explicit_content_review_required', 403)
        with self.store.transaction() as db:
            row = self._row(db, publication)
            if row['rating'] not in allowed:
                raise CloudError('publication_not_found', 404)
            self._revision(row, revision)
            if row['status'] == 'withdrawn':
                raise CloudError('publication_withdrawn', 409)
            document = self._document(row)
            if document != snapshot(document, row['rating']):
                raise CloudError('publication_requires_resubmission', 409)
            if not row['sha256']:
                db.execute('INSERT INTO app_publication_sources VALUES(?,?,?,?,?,?)', (row['id'], digest(document), None, 1, Community.author_id(row['owner']), 'Creator'))
                row = self._row(db, publication)
            self._event(db, row, owner, decision, reason.strip(), checks if decision == 'approved' else {})
            db.execute('UPDATE app_publications SET status=?,reason=?,revision=revision+1 WHERE id=?', (decision, reason.strip(), publication))
        return {'id': publication, 'status': decision, 'revision': revision + 1}

    def _visible(self, db, owner, id, allowed):
        row = self._row(db, id)
        reviewed = db.execute("SELECT 1 FROM app_publication_events WHERE publication=? AND revision=? AND decision='approved' AND sha256=?", (id, row['revision'], row['sha256'])).fetchone()
        blocked = db.execute('SELECT 1 FROM app_publication_blocks WHERE (owner=? AND author=?) OR (owner=? AND author=?)', (owner, row['author_id'], row['owner'], Community.author_id(owner))).fetchone()
        if row['status'] != 'approved' or row['rating'] not in allowed or not reviewed or blocked:
            raise CloudError('publication_not_found', 404)
        return row

    def _public(self, row, owner):
        doc = self._document(row)
        return {'id': row['id'], 'name': doc['name'], 'description': doc['data'].get('description', ''), 'tags': doc['data'].get('tags', []),
                'revision': row['source_revision'], 'moderation_revision': row['revision'], 'snapshot_hash': row['sha256'], 'rating': row['rating'],
                'author_id': row['author_id'], 'author_name': row['author_name'], 'document': doc,
                'likes': 0, 'saves': 0, 'comments': 0, 'owned': row['owner'] == owner}

    def catalog(self, owner, q='', tag='', *, author=None, rating='general'):
        allowed = self.ratings(owner, public=True)
        if not isinstance(q, str) or len(q) > 200 or not isinstance(tag, str) or len(tag) > 80:
            raise CloudError('invalid_search')
        if rating not in ('general', 'adult') or author is not None and (not isinstance(author, str) or len(author) != 24 or any(char not in '0123456789abcdef' for char in author)):
            raise CloudError('invalid_search')
        if rating not in allowed:
            raise CloudError('adult_verification_required', 403)
        allowed = [rating]
        with self.store.transaction() as db:
            rows = db.execute("SELECT p.id FROM app_publications p JOIN app_publication_sources s ON s.id=p.id WHERE p.status='approved' AND p.rating IN ({}) AND NOT EXISTS(SELECT 1 FROM app_publication_blocks b WHERE (b.owner=? AND b.author=s.author_id) OR (b.owner=p.owner AND b.author=?)) ORDER BY p.created DESC LIMIT 500".format(','.join('?' for _ in allowed)), (*allowed, owner, Community.author_id(owner))).fetchall()
            result = []
            for item in rows:
                try:
                    row = self._visible(db, owner, item['id'], allowed)
                except CloudError as error:
                    if error.status == 404:
                        continue
                    raise
                if author is not None and row['author_id'] != author:
                    continue
                work = self._public(row, owner)
                if q.casefold() in (work['name'] + ' ' + work['description'] + ' ' + ' '.join(work['tags'])).casefold() and (not tag or tag in work['tags']):
                    result.append(work)
        return {'works': result}

    def detail(self, owner, id):
        allowed = self.ratings(owner, public=True)
        with self.store.transaction() as db:
            return self._public(self._visible(db, owner, id, allowed), owner)

    def block(self, owner, author, active):
        self.general(owner)
        if not isinstance(author, str) or len(author) != 24 or any(char not in '0123456789abcdef' for char in author) or author == Community.author_id(owner) or type(active) is not bool:
            raise CloudError('invalid_author_relation')
        with self.store.transaction() as db:
            if active:
                db.execute('INSERT OR IGNORE INTO app_publication_blocks VALUES(?,?)', (owner, author))
            else:
                db.execute('DELETE FROM app_publication_blocks WHERE owner=? AND author=?', (owner, author))
        return {'active': active}

    def report(self, owner, publication, revision, reason):
        self.general(owner)
        allowed = self.ratings(owner, public=True)
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 1000:
            raise CloudError('invalid_report')
        with self.store.transaction() as db:
            row = self._visible(db, owner, publication, allowed)
            self._revision(row, revision)
            old = db.execute('SELECT id,reason FROM app_publication_reports WHERE owner=? AND publication=? AND revision=?', (owner, publication, revision)).fetchone()
            if old:
                if old['reason'] != reason.strip():
                    raise CloudError('report_request_conflict', 409)
                return {'id': old['id'], 'accepted': True}
            if db.execute('SELECT COUNT(*) FROM app_publication_reports WHERE owner=? AND created>?', (owner, time.time() - 60)).fetchone()[0] >= 5:
                raise CloudError('report_rate_limit', 429)
            id = str(uuid4())
            db.execute('INSERT INTO app_publication_reports VALUES(?,?,?,?,?,?)', (id, owner, publication, revision, reason.strip(), time.time()))
        return {'id': id, 'accepted': True}

    def appeal(self, owner, publication, revision, reason):
        allowed = self.ratings(owner)
        if not isinstance(reason, str) or not 1 <= len(reason.strip()) <= 1000:
            raise CloudError('invalid_appeal')
        with self.store.transaction() as db:
            row = self._row(db, publication)
            if row['owner'] != owner or row['rating'] not in allowed:
                raise CloudError('publication_not_found', 404)
            self._revision(row, revision)
            if row['status'] not in ('hidden', 'rejected'):
                raise CloudError('publication_not_appealable', 409)
            old = db.execute('SELECT id,reason FROM app_publication_appeals WHERE publication=? AND revision=?', (publication, revision)).fetchone()
            if old:
                if old['reason'] != reason.strip():
                    raise CloudError('appeal_request_conflict', 409)
                return {'id': old['id'], 'accepted': True}
            id = str(uuid4())
            db.execute('INSERT INTO app_publication_appeals VALUES(?,?,?,?,?,?)', (id, owner, publication, revision, reason.strip(), time.time()))
        return {'id': id, 'accepted': True}

    def withdraw(self, owner, publication, revision):
        self.service.available()
        with self.store.transaction() as db:
            row = self._row(db, publication)
            if row['owner'] != owner:
                raise CloudError('publication_not_found', 404)
            self._revision(row, revision)
            self._event(db, row, owner, 'withdrawn', 'author_withdrawal', {})
            db.execute("UPDATE app_publications SET status='withdrawn',reason='author_withdrawal',revision=revision+1 WHERE id=?", (publication,))
        return {'id': publication, 'revision': revision + 1, 'status': 'withdrawn'}
