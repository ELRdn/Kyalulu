"""Account-scoped unified sync and funded rewards; external providers are opt-in."""
from datetime import datetime, timezone
import hashlib
import json
import math
import secrets
import time
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from .contracts import TARIFF, PRICING_VERSION, purchase_terms
from .store import CloudError, fingerprint


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    id: str = Field(min_length=1, max_length=200)
    kind: str = Field(pattern=r"^(conversation|character|persona|world|preset|profile)$")
    base_revision: int = Field(ge=0)
    payload: dict = Field(default_factory=dict)
    deleted: bool = False
    delete_confirmed: bool = False


DDL = """
CREATE TABLE IF NOT EXISTS app_entities(owner TEXT,id TEXT,kind TEXT,revision INTEGER,
 payload TEXT,deleted INTEGER,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS app_changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,owner TEXT,id TEXT,revision INTEGER);
CREATE INDEX IF NOT EXISTS app_change_owner ON app_changes(owner,seq);
CREATE TABLE IF NOT EXISTS app_sync_requests(owner TEXT,id TEXT,hash TEXT,result TEXT,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS app_sync_cancellations(owner TEXT,id TEXT,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS app_runtime_consent(owner TEXT PRIMARY KEY,revision INTEGER,selected TEXT,accepted INTEGER);
CREATE TABLE IF NOT EXISTS app_entity_deletions(owner TEXT,id TEXT,revision INTEGER,created REAL,PRIMARY KEY(owner,id));
CREATE TABLE IF NOT EXISTS app_sync_devices(id TEXT PRIMARY KEY,hash TEXT UNIQUE,owner TEXT,name TEXT,
 session_hash TEXT,expires REAL,created REAL);
CREATE TABLE IF NOT EXISTS app_reward_offers(id TEXT PRIMARY KEY,owner TEXT,seconds INTEGER,
 credits INTEGER,state TEXT,created REAL,expires REAL,event TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS app_reward_reserves(offer TEXT,fund TEXT,amount INTEGER,PRIMARY KEY(offer,fund));
CREATE TABLE IF NOT EXISTS app_reward_events(id TEXT PRIMARY KEY,hash TEXT);
CREATE TABLE IF NOT EXISTS app_free_reserves(source TEXT PRIMARY KEY,owner TEXT,amount INTEGER,expires REAL);
CREATE TABLE IF NOT EXISTS app_ad_revenue(source TEXT PRIMARY KEY,amount INTEGER,created REAL);
CREATE TABLE IF NOT EXISTS app_age_receipts(owner TEXT PRIMARY KEY,country TEXT,adult INTEGER,
 verified REAL,expires REAL,policy TEXT,receipt TEXT);
CREATE TABLE IF NOT EXISTS app_publications(id TEXT PRIMARY KEY,owner TEXT,revision INTEGER,
 rating TEXT,status TEXT,payload TEXT,reason TEXT,created REAL);
"""


class UnifiedService:
    def __init__(self, store, *, region_policies=None, ad_provider=None):
        self.store = store
        self.regions = region_policies or {}
        self.ad_provider = ad_provider
        with store.transaction() as db:
            db.executescript(DDL)
            db.execute('INSERT OR IGNORE INTO app_entity_deletions SELECT owner,id,revision,? FROM app_entities WHERE deleted=1', (time.time(),))
        store.unified_service = self

    def available(self):
        if not self.store.config.unified_enabled:
            raise CloudError("unified_app_awaiting_acceptance", 503)

    def general_eligibility(self, country, age, *, guardian=False):
        if not isinstance(country, str) or len(country) != 2:
            raise CloudError('region_policy_pending', 403)
        policy = self.regions.get(country)
        if not policy or policy.get("accepted") is not True:
            raise CloudError("region_policy_pending", 403)
        if type(age) is not int or not max(13, policy.get("minimum_age", 13)) <= age <= 120:
            raise CloudError("minimum_age_required", 403)
        if age < policy.get("guardian_below", 18) and not guardian:
            raise CloudError("verified_guardian_consent_required", 403)
        return {"country": country, "age_band": "adult" if age >= 18 else "teen",
                "policy": policy["version"]}

    def eligibility_ticket(self, country, age):
        result = self.general_eligibility(country, age)
        return {**result, 'ticket': self.store.encrypt(json.dumps({**result, 'age': age, 'expires': time.time() + 30 * 86400}))}

    def verify_eligibility_ticket(self, ticket, country):
        try:
            if not isinstance(ticket, str) or len(ticket) > 4000:
                raise ValueError()
            value = json.loads(self.store.decrypt(ticket))
            if value['country'] != country or value['expires'] <= time.time():
                raise ValueError()
            current = self.general_eligibility(country, value['age'])
            if current['policy'] != value['policy']:
                raise ValueError()
            return current
        except CloudError:
            raise
        except Exception as exc:
            raise CloudError('eligibility_confirmation_required', 403) from exc

    def require_general(self, owner):
        try:
            value = json.loads(self.store.secret(owner, 'app-eligibility') or '{}')
            policy = self.regions[value['country']]
            if (policy.get('accepted') is not True or value['policy'] != policy['version']
                    or value.get('age_band') not in {'teen', 'adult'}):
                raise ValueError()
        except (ValueError, KeyError, TypeError) as exc:
            raise CloudError('eligibility_confirmation_required', 403) from exc

    def require_adult(self, owner, *, country=None):
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM app_age_receipts WHERE owner=?", (owner,)).fetchone()
        policy = self.regions.get(row["country"] if row else country, {})
        if (not row or not row["adult"] or row["expires"] <= time.time()
                or policy.get("adult_accepted") is not True or row["policy"] != policy.get("version")
                or country is not None and row["country"] != country):
            raise CloudError("adult_verification_required", 403)

    def record_age_result(self, owner, *, country, adult, expires, receipt, policy):
        """Only a verified provider adapter calls this; never expose a browser claim API."""
        if (type(adult) is not bool or type(expires) not in {int, float}
                or not math.isfinite(expires) or not time.time() < expires <= time.time() + 366 * 86400
                or not isinstance(receipt, str) or not 1 <= len(receipt) <= 200
                or self.regions.get(country, {}).get("version") != policy):
            raise CloudError("invalid_age_receipt")
        with self.store.transaction() as db:
            db.execute("INSERT OR REPLACE INTO app_age_receipts VALUES(?,?,?,?,?,?,?)",
                       (owner, country, int(adult), time.time(), expires, policy,
                        hashlib.sha256(receipt.encode()).hexdigest()))

    def preferences(self, owner, value=None):
        if value is not None:
            allowed = {"genres", "moods", "activities", "favorites", "dismissed", "language"}
            if not isinstance(value, dict) or set(value) - allowed:
                raise CloudError("invalid_preferences")
            for key, items in value.items():
                if key == "language":
                    if not isinstance(items, str) or items not in {"ja", "en"}:
                        raise CloudError("invalid_preferences")
                elif (not isinstance(items, list) or len(items) > 500
                      or any(not isinstance(item, str) or not 0 < len(item) <= 200 for item in items)):
                    raise CloudError("invalid_preferences")
            self.store.secret(owner, "app-preferences", json.dumps(value))
        return json.loads(self.store.secret(owner, "app-preferences") or "{}")

    def runtime_consent(self, owner):
        self.available()
        with self.store.transaction() as db:
            row = db.execute('SELECT revision,selected,accepted FROM app_runtime_consent WHERE owner=?', (owner,)).fetchone()
        return {'revision': row['revision'], 'selected': json.loads(row['selected']), 'accepted': bool(row['accepted'])} if row else {'revision': 0, 'selected': [], 'accepted': False}

    def configure_runtime(self, owner, revision, selected, consent, *, runtime_path=None):
        self.available()
        if (type(revision) is not int or revision < 0 or type(consent) is not bool or not isinstance(selected, list)
                or len(selected) > 1000 or any(not isinstance(s, str) or not 0 < len(s) <= 200 or s.startswith('__') for s in selected)
                or len(set(selected)) != len(selected) or selected and not consent):
            raise CloudError('invalid_sync_consent')
        with self.store.transaction() as db:
            previous = db.execute('SELECT revision FROM app_runtime_consent WHERE owner=?', (owner,)).fetchone()
            if (previous[0] if previous else 0) != revision:
                raise CloudError('sync_consent_conflict', 409)
            db.execute('INSERT INTO app_runtime_consent VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET '
                       'revision=excluded.revision,selected=excluded.selected,accepted=excluded.accepted',
                       (owner, revision + 1, json.dumps(selected), int(consent)))
            if consent and runtime_path is not None:
                self._attach_consented_runtime(db, owner, runtime_path)
                for sid in selected:
                    link = db.execute('SELECT entity_id,mapping FROM runtime.unified_runtime_links WHERE session_id=?', (sid,)).fetchone()
                    if link and json.loads(link['mapping']).get('restored_from_snapshot'):
                        db.execute('UPDATE runtime.unified_runtime_links SET entity_id=?,revision=0,baseline=?,mapping=? WHERE session_id=?',
                                   (str(uuid4()), '', json.dumps({'recovery_from': link['entity_id']}), sid))
        return {'revision': revision + 1, 'selected': selected, 'accepted': consent}

    def _attach_consented_runtime(self, db, owner, path):
        from pathlib import Path
        from python.storage.entity_bridge import prepare
        consent = db.execute('SELECT selected FROM app_runtime_consent WHERE owner=? AND accepted=1', (owner,)).fetchone()
        erasures = db.execute('SELECT 1 FROM app_entity_deletions WHERE owner=? LIMIT 1', (owner,)).fetchone()
        if not consent and not erasures:
            return None
        expected = self.store.config.root / 'tenants' / owner / 'data.db'
        tenant_root = (self.store.config.root / 'tenants').resolve()
        if (Path(path).resolve() != expected.resolve() or not expected.is_file() or expected.is_symlink()
                or expected.parent.is_symlink() or expected.parent.resolve() != tenant_root / owner):
            raise CloudError('invalid_sync_runtime_scope', 403)
        db.execute('ATTACH DATABASE ? AS runtime', (str(expected),))
        if any(db.execute(f'PRAGMA {name}.journal_mode').fetchone()[0] != 'delete' for name in ('main', 'runtime')):
            raise CloudError('sync_atomic_journal_required', 503)
        prepare(db)
        return json.loads(consent['selected']) if consent else []

    def _reconcile_runtime_deletions(self, db, owner, selected, capacity):
        from python.storage.entity_bridge import apply_tombstones
        erased = db.execute('SELECT DISTINCT l.entity_id FROM runtime.unified_runtime_links l '
                            'JOIN runtime.session_deletions d ON d.session_id=l.session_id').fetchall()
        for row in erased:
            entity = db.execute('SELECT kind,revision,deleted FROM app_entities WHERE owner=? AND id=?', (owner, row[0])).fetchone()
            if entity and not entity['deleted']:
                self._write_change(db, owner, Change(id=row[0], kind=entity['kind'], base_revision=entity['revision'],
                                                    deleted=True, delete_confirmed=True), capacity)
        tombstones = db.execute('SELECT id,revision FROM app_entity_deletions WHERE owner=?', (owner,)).fetchall()
        deleted, recovered = apply_tombstones(db, tombstones)
        db.execute('CREATE TABLE IF NOT EXISTS conversation_erasures(owner TEXT,hash TEXT,PRIMARY KEY(owner,hash))')
        for sid in deleted:
            db.execute('INSERT OR IGNORE INTO conversation_erasures VALUES(?,?)', (owner, hashlib.sha256(sid.encode()).hexdigest()))
        remaining = [sid for sid in selected if sid not in {*deleted, *recovered}]
        if remaining != selected:
            db.execute('UPDATE app_runtime_consent SET selected=?,revision=revision+1 WHERE owner=?', (json.dumps(remaining), owner))
        return remaining

    def _write_change(self, db, owner, change, capacity):
        row = db.execute('SELECT * FROM app_entities WHERE owner=? AND id=?', (owner, change.id)).fetchone()
        revision = row['revision'] if row else 0
        entity_id, branch = change.id, False
        if change.deleted and not change.delete_confirmed:
            raise CloudError('sync_delete_confirmation_required', 409)
        tombstone = db.execute('SELECT revision FROM app_entity_deletions WHERE owner=? AND id=?', (owner, change.id)).fetchone()
        if tombstone:
            if change.deleted:
                return {'id': change.id, 'source_id': change.id, 'revision': tombstone[0], 'deleted': True}, {}
            raise CloudError('sync_entity_deleted', 409)
        if row and row['kind'] != change.kind:
            raise CloudError('sync_kind_conflict', 409)
        if row and row['deleted']:
            if change.deleted:
                return {'id': entity_id, 'source_id': change.id, 'revision': revision, 'deleted': True}, {}
            raise CloudError('sync_entity_deleted', 409)
        payload = {} if change.deleted else dict(change.payload)
        if change.base_revision != revision:
            if change.kind != 'conversation' or change.deleted or change.base_revision > revision:
                raise CloudError('sync_revision_conflict', 409)
            entity_id, branch, revision = str(uuid4()), True, 0
            payload.update(branch_of=change.id, fork_revision=change.base_revision)
            for key in ('settings', 'state'):
                if isinstance(payload.get(key), dict):
                    payload[key] = {**payload[key], 'session_id': entity_id}
        revision += 1
        encoded = self.store.encrypt(json.dumps(payload, ensure_ascii=False))
        used = db.execute('SELECT COALESCE(SUM(LENGTH(payload)),0) FROM app_entities WHERE owner=? AND id!=?', (owner, entity_id)).fetchone()[0]
        if not change.deleted and used + len(encoded) > capacity:
            raise CloudError('cloud_storage_full', 413)
        db.execute('INSERT INTO app_entities VALUES(?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET '
                   'revision=excluded.revision,payload=excluded.payload,deleted=excluded.deleted',
                   (owner, entity_id, change.kind, revision, encoded, int(change.deleted)))
        db.execute('INSERT INTO app_changes(owner,id,revision) VALUES(?,?,?)', (owner, entity_id, revision))
        if change.deleted:
            db.execute('INSERT INTO app_entity_deletions VALUES(?,?,?,?)', (owner, entity_id, revision, time.time()))
        return {'id': entity_id, 'source_id': change.id, 'revision': revision, 'branched': branch, 'deleted': change.deleted}, payload

    def _capture_runtime(self, db, owner, selected, capacity, *, defer_full=False):
        from python.storage.entity_bridge import capture, acknowledge_capture, validate
        db.execute('SAVEPOINT app_runtime_capture')
        try:
            changes = capture(db, selected)
            for change in changes:
                self._validate_payload(change['payload']); validate(change['payload'])
                if len(json.dumps(change['payload']).encode()) > 2_000_000:
                    raise CloudError('sync_batch_too_large', 413)
                record, stored = self._write_change(db, owner, Change.model_validate({k: change[k] for k in ('id', 'kind', 'base_revision', 'payload')}), capacity)
                change['payload'] = stored
                acknowledge_capture(db, change, record['id'], record['revision'])
            if changes:
                self._check_copy_capacity(db, owner, capacity, 0)
        except CloudError as exc:
            if not defer_full or exc.code != 'cloud_storage_full':
                raise
            db.execute('ROLLBACK TO app_runtime_capture'); db.execute('RELEASE app_runtime_capture')
            return exc.code
        db.execute('RELEASE app_runtime_capture')

    def _library_documents(self, db, owner, payload):
        from python.storage.entity_bridge import references
        snapshots = payload.get('library_snapshots', {})
        if not isinstance(snapshots, dict):
            raise CloudError('invalid_sync_library')
        documents = {}
        for ref in references(payload.get('settings', {})):
            document = snapshots.get(ref['id'] + '@' + str(ref['revision']))
            if document is None:
                row = db.execute("SELECT payload FROM app_entities WHERE owner=? AND id=? AND kind='character' AND deleted=0", (owner, ref['id'])).fetchone()
                stored = json.loads(self.store.decrypt(row[0])) if row else {}
                document = stored.get('versions', {}).get(str(ref['revision']))
            if document is None:
                raise CloudError('sync_library_revision_missing', 409)
            self._validate_payload(document)
            documents[(ref['id'], ref['revision'])] = document
        return documents

    def _check_copy_capacity(self, db, owner, capacity, growth):
        from .backups import storage_usage
        directory = self.store.config.root / 'tenants' / owner
        size = db.execute('PRAGMA runtime.page_count').fetchone()[0] * db.execute('PRAGMA runtime.page_size').fetchone()[0]
        entities = db.execute('SELECT COALESCE(SUM(LENGTH(payload)),0) FROM app_entities WHERE owner=?', (owner,)).fetchone()[0]
        if storage_usage(directory) - (directory / 'data.db').stat().st_size + size + entities + growth > capacity:
            raise CloudError('cloud_storage_full', 413)

    def push(self, owner, request_id, changes, *, runtime_path=None):
        self.available()
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 100:
            raise CloudError("invalid_sync_request")
        if not isinstance(changes, list) or not 1 <= len(changes) <= 100:
            raise CloudError("invalid_sync_batch")
        from pydantic import ValidationError
        try:
            parsed = [Change.model_validate(change) for change in changes]
        except ValidationError as exc:
            raise CloudError('invalid_sync_entity') from exc
        if len({c.id for c in parsed}) != len(parsed):
            raise CloudError("duplicate_sync_entity")
        if len(json.dumps(changes, ensure_ascii=False).encode()) > 2_000_000:
            raise CloudError("sync_batch_too_large", 413)
        for change in parsed:
            if change.payload.get("storage_policy") != "sync" and not change.deleted:
                raise CloudError("device_only_data_not_uploadable", 403)
            if change.payload.get("rating") == "adult":
                self.require_adult(owner)
            self._validate_payload(change.payload)
        digest = fingerprint(changes)
        capacity = self.store.entitlements(owner).storage_bytes
        with self.store.transaction() as db:
            old = db.execute("SELECT hash,result FROM app_sync_requests WHERE owner=? AND id=?",
                             (owner, request_id)).fetchone()
            if old:
                if old[0] != digest:
                    raise CloudError("sync_request_conflict", 409)
                return json.loads(self.store.decrypt(old[1]))
            if db.execute('SELECT 1 FROM app_sync_cancellations WHERE owner=? AND id=?',(owner,request_id)).fetchone():
                raise CloudError('sync_request_canceled',409)
            selected = self._attach_consented_runtime(db, owner, runtime_path) if runtime_path is not None else None
            if selected is not None:
                selected = self._reconcile_runtime_deletions(db, owner, selected, capacity)
                self._capture_runtime(db, owner, selected, capacity, defer_full=all(c.deleted and c.delete_confirmed for c in parsed))
            result = []
            for change in parsed:
                tombstone = db.execute('SELECT revision FROM app_entity_deletions WHERE owner=? AND id=?', (owner, change.id)).fetchone()
                if tombstone:
                    result.append({'id': change.id, 'source_id': change.id, 'revision': tombstone[0], 'deleted': True})
                    continue
                record, payload = self._write_change(db, owner, change, capacity)
                if selected is not None and change.kind == 'conversation' and not change.deleted:
                    from python.storage.entity_bridge import import_copy
                    self._check_copy_capacity(db, owner, capacity, len(json.dumps(payload).encode()))
                    record['runtime_session_id'] = import_copy(db, record['id'], record['revision'], payload,
                                                              self._library_documents(db, owner, payload))
                    self._check_copy_capacity(db, owner, capacity, 0)
                result.append(record)
            if selected is not None:
                self._reconcile_runtime_deletions(db, owner, selected, capacity)
            answer = {"changes": result}
            db.execute("INSERT INTO app_sync_requests VALUES(?,?,?,?)",
                       (owner, request_id, digest, self.store.encrypt(json.dumps(answer))))
            return answer

    def _validate_payload(self, payload):
        stack = [(payload, 0)]
        while stack:
            item, depth = stack.pop()
            if depth > 32:
                raise CloudError('invalid_sync_entity')
            if isinstance(item, dict):
                if any(k.casefold().replace('-', '_') in {'authorization', 'cookie', 'password', 'api_key',
                       'apikey', 'access_token', 'refresh_token', 'private_key', 'privatekey'} for k in item):
                    raise CloudError('credentials_not_syncable', 403)
                if item.get('nsfw') is True or item.get('rating') == 'adult':
                    # Adult data needs a separate accepted storage pipeline, not the SFW Cloud.
                    raise CloudError('adult_cloud_storage_awaiting_acceptance', 503)
                stack.extend((value, depth + 1) for value in item.values())
            elif isinstance(item, list):
                stack.extend((value, depth + 1) for value in item)
            elif isinstance(item, float) and not math.isfinite(item):
                raise CloudError('invalid_sync_entity')

    def cancel_sync_request(self,owner,request_id):
        self.available()
        if not isinstance(request_id,str) or not 0<len(request_id)<=100:raise CloudError('invalid_sync_request')
        with self.store.transaction() as db:
            row=db.execute('SELECT hash,result FROM app_sync_requests WHERE owner=? AND id=?',(owner,request_id)).fetchone()
            if row:return {'state':'applied','hash':row[0],'result':json.loads(self.store.decrypt(row[1]))}
            db.execute('INSERT OR IGNORE INTO app_sync_cancellations VALUES(?,?)',(owner,request_id))
        return {'state':'canceled'}

    def pull(self, owner, cursor=0, *, runtime_path=None):
        self.available()
        if type(cursor) is not int or cursor < 0:
            raise CloudError("invalid_sync_cursor")
        capacity = self.store.entitlements(owner).storage_bytes
        upload_blocked = None
        with self.store.transaction() as db:
            selected = self._attach_consented_runtime(db, owner, runtime_path) if runtime_path is not None else None
            if selected is not None:
                selected = self._reconcile_runtime_deletions(db, owner, selected, capacity)
                upload_blocked = self._capture_runtime(db, owner, selected, capacity, defer_full=True)
            rows = db.execute("SELECT c.seq,e.* FROM app_changes c JOIN app_entities e "
                              "ON c.owner=e.owner AND c.id=e.id WHERE c.owner=? AND c.seq>? "
                              "ORDER BY c.seq LIMIT 100", (owner, cursor)).fetchall()
        result = []
        for row in rows:
            payload = json.loads(self.store.decrypt(row["payload"]))
            if payload.get("rating") == "adult":
                self.require_adult(owner)
            result.append({"id": row["id"], "kind": row["kind"], "revision": row["revision"],
                           "deleted": bool(row["deleted"]), "payload": payload})
        return {"cursor": rows[-1]["seq"] if rows else cursor, "changes": result, "has_more": len(rows) == 100,
                **({'upload_blocked': upload_blocked} if upload_blocked else {})}

    def read_entity(self, owner, entity_id):
        self.available()
        if not isinstance(entity_id, str) or not 0 < len(entity_id) <= 200:
            raise CloudError('invalid_sync_entity')
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM app_entities WHERE owner=? AND id=?', (owner, entity_id)).fetchone()
            tombstone = db.execute('SELECT revision FROM app_entity_deletions WHERE owner=? AND id=?', (owner, entity_id)).fetchone()
        if tombstone:
            return {'id': entity_id, 'kind': row['kind'] if row else 'conversation', 'revision': tombstone[0], 'deleted': True, 'payload': {}}
        if not row:
            raise CloudError('sync_entity_not_found', 404)
        payload = json.loads(self.store.decrypt(row['payload']))
        self._validate_payload(payload)
        return {'id': row['id'], 'kind': row['kind'], 'revision': row['revision'], 'deleted': bool(row['deleted']), 'payload': payload}

    def _reserve_free(self, db, owner, source, credits, expires):
        if self.store.config.private_test:
            raise CloudError("free_rewards_disabled_in_private_test", 503)
        available = self.store._available_funds(db)
        cost = (credits * 100_000 + TARIFF.markup - 1) // TARIFF.markup
        # Keep a reward's backing beyond the month's subsidy expiry.
        funds = db.execute("SELECT * FROM funds WHERE kind IN ('subsidy','ad-revenue') AND expires>? "
                           "AND remaining>0 ORDER BY expires", (time.time(),)).fetchall()
        liability = db.execute("SELECT COALESCE(SUM(remaining),0) FROM credit_lots WHERE expires>?", (time.time(),)).fetchone()[0]
        liability += db.execute("SELECT COALESCE(SUM(amount),0) FROM credit_holds").fetchone()[0]
        backing = (liability * 100_000 + TARIFF.markup - 1) // TARIFF.markup
        if min(sum(row["remaining"] for row in funds), available - backing) < cost:
            raise CloudError("free_budget_exhausted", 409)
        remaining = cost
        for row in funds:
            take = min(remaining, row["remaining"])
            db.execute("UPDATE funds SET remaining=remaining-? WHERE id=?", (take, row["id"]))
            db.execute("INSERT INTO app_reward_reserves VALUES(?,?,?)", (source, row["id"], take))
            remaining -= take
            if not remaining:
                break
        db.execute("INSERT INTO app_free_reserves VALUES(?,?,?,?)", (source, owner, cost, expires))

    def _grant_reserved(self, db, owner, source, credits, expires, kind):
        row = db.execute("SELECT amount FROM app_free_reserves WHERE source=? AND owner=?", (source, owner)).fetchone()
        if not row:
            raise CloudError("reward_reserve_missing", 409)
        db.execute("INSERT INTO funds VALUES(?,?,?,'reward-backing')", ("reward:" + source, row[0], expires))
        self.store.grant(owner, credits, expires, kind, source, db)
        db.execute("DELETE FROM app_reward_reserves WHERE offer=?", (source,))
        db.execute("DELETE FROM app_free_reserves WHERE source=?", (source,))

    def daily(self, owner):
        self.available()
        if self.store.account(owner)['suspended']:
            raise CloudError('account_unavailable', 403)
        now = time.time()
        day = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%d")
        expires = (int(now) // 86400 + 1) * 86400
        source = "daily:" + owner + ":" + day
        with self.store.transaction() as db:
            if db.execute("SELECT 1 FROM credit_lots WHERE source=?", (source,)).fetchone():
                return {"granted": False, "credits": 100, "expires": expires}
            self._reserve_free(db, owner, source, 100, expires)
            self._grant_reserved(db, owner, source, 100, expires, "daily")
        return {"granted": True, "credits": 100, "expires": expires}

    def offer(self, owner, inventory):
        self.available()
        if self.store.account(owner)['suspended']:
            raise CloudError('account_unavailable', 403)
        if (not self.store.config.ads_enabled or not self.ad_provider
                or not self.store.config.legal_approved or self.store.config.private_test):
            raise CloudError("ad_provider_awaiting_acceptance", 503)
        seconds = inventory.get("seconds") if isinstance(inventory, dict) else None
        if type(seconds) is not int or not 1 <= seconds <= 30:
            raise CloudError("ad_duration_unavailable", 503)
        now, offer = time.time(), secrets.token_urlsafe(32)
        expires = now + 86400
        with self.store.transaction() as db:
            self._expire_offers(db, now)
            active = db.execute("SELECT id FROM app_reward_offers WHERE owner=? AND state='pending' AND expires>?",
                                (owner, now)).fetchone()
            if active:
                raise CloudError("reward_already_pending", 409)
            self._reserve_free(db, owner, offer, seconds * 10, now + 31 * 86400)
            db.execute("INSERT INTO app_reward_offers VALUES(?,?,?,?,?,?,?,NULL)",
                       (offer, owner, seconds, seconds * 10, "pending", now, expires))
        return {"id": offer, "duration_seconds": seconds, "credits": seconds * 10,
                "expires": expires, "state": "pending"}

    def _expire_offers(self, db, now):
        rows = db.execute("SELECT id FROM app_reward_offers WHERE state='pending' AND expires<=?", (now,)).fetchall()
        for row in rows:
            for reserve in db.execute("SELECT fund,amount FROM app_reward_reserves WHERE offer=?", (row[0],)).fetchall():
                db.execute("UPDATE funds SET remaining=remaining+? WHERE id=?", (reserve[1], reserve[0]))
            db.execute("DELETE FROM app_reward_reserves WHERE offer=?", (row[0],))
            db.execute("DELETE FROM app_free_reserves WHERE source=?", (row[0],))
            db.execute("UPDATE app_reward_offers SET state='expired' WHERE id=?", (row[0],))

    def complete_reward(self, event):
        """Input is a signature-verified, provider-normalized completion receipt."""
        if (not isinstance(event, dict) or set(event) != {"event_id", "offer_id", "seconds", "completed_at"}
                or not isinstance(event["event_id"], str) or not 1 <= len(event["event_id"]) <= 200
                or not isinstance(event['offer_id'], str) or not 1 <= len(event['offer_id']) <= 128
                or type(event["seconds"]) is not int or type(event["completed_at"]) not in {int, float}
                or not math.isfinite(event["completed_at"])):
            raise CloudError("invalid_ad_receipt")
        digest = fingerprint(event)
        with self.store.transaction() as db:
            old = db.execute("SELECT hash FROM app_reward_events WHERE id=?", (event["event_id"],)).fetchone()
            if old:
                if old[0] != digest:
                    raise CloudError("ad_receipt_conflict", 409)
                return {"granted": False}
            offer = db.execute("SELECT * FROM app_reward_offers WHERE id=?", (event["offer_id"],)).fetchone()
            if (not offer or offer["state"] != "pending" or event["seconds"] != offer["seconds"]
                    or not offer["created"] + offer["seconds"] <= event["completed_at"] <= min(time.time() + 5, offer["expires"])):
                raise CloudError("ad_receipt_not_completed", 409)
            expires = time.time() + 30 * 86400
            self._grant_reserved(db, offer["owner"], offer["id"], offer["credits"], expires, "ad")
            db.execute("UPDATE app_reward_offers SET state='granted',event=? WHERE id=?", (event["event_id"], offer["id"]))
            db.execute("INSERT INTO app_reward_events VALUES(?,?)", (event["event_id"], digest))
            return {"granted": True, "credits": offer["credits"]}

    def reward(self, owner, offer_id):
        with self.store.transaction() as db:
            self._expire_offers(db, time.time())
            row = db.execute("SELECT id,state,credits,seconds FROM app_reward_offers WHERE owner=? AND id=?",
                             (owner, offer_id)).fetchone()
        if not row:
            raise CloudError("reward_not_found", 404)
        return dict(row)

    def revenue(self, source, net_nano):
        if not isinstance(source, str) or not 1 <= len(source) <= 200 or type(net_nano) is not int or not 0 < net_nano <= 10**13:
            raise CloudError("invalid_ad_revenue")
        with self.store.transaction() as db:
            key = "ad-revenue:" + source
            old = db.execute("SELECT amount FROM app_ad_revenue WHERE source=?", (key,)).fetchone()
            if old:
                if old[0] != net_nano:
                    raise CloudError("ad_revenue_conflict", 409)
                return
            db.execute("INSERT INTO app_ad_revenue VALUES(?,?,?)", (key, net_nano, time.time()))
            db.execute("INSERT INTO funds VALUES(?,?,?,'ad-revenue')", (key, net_nano, time.time() + 45 * 86400))

    def submit(self, owner, payload, rating):
        self.available()
        if not isinstance(rating, str) or rating not in {"general", "adult"} or not isinstance(payload, dict):
            raise CloudError("invalid_publication")
        if rating == "adult":
            self.require_adult(owner)
        # Private conversation fields never enter a public snapshot.
        from .community import PUBLIC_KEYS
        raw = payload.get("data", {})
        if not isinstance(raw, dict) or len(json.dumps(payload).encode()) > 40_000:
            raise CloudError("invalid_publication")
        snapshot = {"schema_version": 1, "kind": "character", "name": str(payload.get("name", ""))[:120],
                    "nsfw": rating == "adult", "data": {k: v for k, v in raw.items() if k in PUBLIC_KEYS}}
        if not snapshot["name"].strip():
            raise CloudError("invalid_publication")
        publication = str(uuid4())
        with self.store.transaction() as db:
            db.execute("INSERT INTO app_publications VALUES(?,?,?,?,?,?,?,?)",
                       (publication, owner, 1, rating, "pending", json.dumps(snapshot), "", time.time()))
        return {"id": publication, "status": "pending", "revision": 1}

    def review(self, moderator, publication, revision, decision, reason):
        self.available()
        if moderator not in self.store.config.moderator_owners:
            raise CloudError("moderator_required", 403)
        if not isinstance(decision, str) or decision not in {"approved", "rejected", "hidden"} or not isinstance(reason, str) or not 1 <= len(reason) <= 1000:
            raise CloudError("invalid_review")
        with self.store.transaction() as db:
            row = db.execute("SELECT revision FROM app_publications WHERE id=?", (publication,)).fetchone()
            if not row:
                raise CloudError("publication_not_found", 404)
            if row[0] != revision:
                raise CloudError("publication_revision_conflict", 409)
            db.execute("UPDATE app_publications SET status=?,reason=?,revision=revision+1 WHERE id=?",
                       (decision, reason, publication))
        return {"id": publication, "status": decision, "revision": revision + 1}


def install_routes(app, service):
    from .auth import digest, SESSION_COOKIE
    from fastapi import Request

    @app.get('/api/cloud/app/devices')
    async def devices(request: Request):
        service.available(); service.require_general(request.state.owner)
        with service.store.transaction() as db:
            rows = db.execute('SELECT d.id,d.name,MIN(d.expires,s.valid_until) AS expires,d.created FROM app_sync_devices d JOIN sessions s ON s.hash=d.session_hash AND s.owner=d.owner WHERE d.owner=? AND d.expires>? AND s.valid_until>? ORDER BY d.created', (request.state.owner,time.time(),time.time())).fetchall()
        return {'devices':[dict(row) for row in rows]}

    @app.post('/api/cloud/app/devices')
    async def create_device(request: Request):
        service.available(); service.require_general(request.state.owner)
        if request.headers.get('authorization'):
            raise CloudError('browser_session_required',403)
        body=await request.json(); name=body.get('name') if isinstance(body,dict) else None
        if not isinstance(name,str) or not 0<len(name.strip())<=80 or any(ord(c)<32 for c in name):
            raise CloudError('invalid_device_name')
        token=secrets.token_urlsafe(32); now=time.time(); identifier=str(uuid4())
        with service.store.transaction() as db:
            session=db.execute('SELECT hash FROM sessions WHERE hash=? AND owner=? AND valid_until>?', (digest(request.cookies.get(SESSION_COOKIE,'')),request.state.owner,now)).fetchone()
            if not session: raise CloudError('authentication_required',401)
            if db.execute('SELECT COUNT(*) FROM app_sync_devices d JOIN sessions s ON s.hash=d.session_hash AND s.owner=d.owner WHERE d.owner=? AND d.expires>? AND s.valid_until>?', (request.state.owner,now,now)).fetchone()[0]>=5:
                raise CloudError('sync_device_limit',429)
            db.execute('INSERT INTO app_sync_devices VALUES(?,?,?,?,?,?,?)',(identifier,digest(token),request.state.owner,name.strip(),session[0],now+30*86400,now))
        return {'id':identifier,'token':token,'expires_in':30*86400,'protocol':'entity-v1'}

    @app.delete('/api/cloud/app/devices/{device_id}')
    async def revoke_device(device_id:str,request:Request):
        service.available(); service.require_general(request.state.owner)
        if request.headers.get('authorization'): raise CloudError('browser_session_required',403)
        with service.store.transaction() as db:
            db.execute('DELETE FROM app_sync_devices WHERE id=? AND owner=?',(device_id,request.state.owner))
        return {'ok':True}

    @app.get('/api/cloud/app/sync/device')
    async def sync_identity(request:Request):
        service.available(); service.require_general(request.state.owner)
        identifier=getattr(request.state,'app_sync_device',None)
        if not identifier: raise CloudError('entity_sync_token_required',403)
        return {'owner':request.state.owner,'device_id':identifier,'protocol':'entity-v1'}
    from fastapi import Request, Query

    @app.post('/api/cloud/app/eligibility')
    async def eligibility(request: Request):
        service.available()
        body = await request.json()
        if not isinstance(body, dict) or set(body) != {'country', 'age'}:
            raise CloudError('invalid_eligibility')
        return service.eligibility_ticket(body['country'], body['age'])

    @app.get("/api/cloud/app/status")
    async def app_status(request: Request):
        owner = request.state.owner
        account = service.store.account(owner)
        return {"enabled": service.store.config.unified_enabled, "pricing_version": PRICING_VERSION,
                "ads_available": bool(service.store.config.unified_enabled and service.ad_provider
                                      and service.store.config.ads_enabled and service.store.config.legal_approved
                                      and not service.store.config.private_test),
                "banner": None, "subscriber": account["plan"] != "free",
                "offers": {sku: purchase_terms(sku, subscriber=account["plan"] != "free")
                           for sku in ("plus", "pro", "credits_5", "credits_10")}}

    @app.get("/api/cloud/app/preferences")
    async def preferences(request: Request):
        service.available()
        return service.preferences(request.state.owner)

    @app.put("/api/cloud/app/preferences")
    async def save_preferences(request: Request):
        service.available()
        return service.preferences(request.state.owner, await request.json())

    @app.post("/api/cloud/app/sync")
    async def push(request: Request):
        from python.storage.context import get_db_path
        from python.storage import db as storage
        body = await request.json()
        if not isinstance(body, dict):
            raise CloudError('invalid_sync_request')
        return service.push(request.state.owner, body.get("request_id"), body.get("changes"), runtime_path=get_db_path(storage.DB_PATH))

    @app.post('/api/cloud/app/sync/cancel/{request_id}')
    async def cancel_sync(request_id:str,request:Request):
        service.require_general(request.state.owner)
        return service.cancel_sync_request(request.state.owner,request_id)

    @app.get("/api/cloud/app/sync")
    async def pull(request: Request, cursor: int = Query(default=0, ge=0)):
        from python.storage.context import get_db_path
        from python.storage import db as storage
        return service.pull(request.state.owner, cursor, runtime_path=get_db_path(storage.DB_PATH))

    @app.get('/api/cloud/app/runtime-consent')
    async def runtime_consent(request: Request):
        return service.runtime_consent(request.state.owner)

    @app.get('/api/cloud/app/entities/{entity_id}')
    async def read_entity(entity_id: str, request: Request):
        return service.read_entity(request.state.owner, entity_id)

    @app.put('/api/cloud/app/runtime-consent')
    async def configure_runtime(request: Request):
        from python.storage.context import get_db_path
        from python.storage import db as storage
        body = await request.json()
        if not isinstance(body, dict) or set(body) != {'revision', 'selected', 'consent'}:
            raise CloudError('invalid_sync_consent')
        return service.configure_runtime(request.state.owner, body['revision'], body['selected'], body['consent'], runtime_path=get_db_path(storage.DB_PATH))

    @app.post("/api/cloud/app/daily")
    async def daily(request: Request):
        return service.daily(request.state.owner)

    @app.post("/api/cloud/app/rewards")
    async def offer(request: Request):
        service.available()
        if not service.ad_provider:
            raise CloudError("ad_provider_awaiting_acceptance", 503)
        inventory = await service.ad_provider.inventory()
        result = service.offer(request.state.owner, inventory)
        result["frame_url"] = service.ad_provider.frame_url(result["id"])
        return result

    @app.get("/api/cloud/app/rewards/{offer_id}")
    async def reward(offer_id: str, request: Request):
        result = service.reward(request.state.owner, offer_id)
        if (result['state'] == 'pending' and service.ad_provider and service.store.config.ads_enabled
                and service.store.config.legal_approved):
            result['frame_url'] = service.ad_provider.frame_url(offer_id)
        return result

    @app.post("/api/cloud/app/rewards/webhook")
    async def completion(request: Request):
        if not service.ad_provider or not service.store.config.ads_enabled:
            raise CloudError("ad_provider_awaiting_acceptance", 503)
        # No browser payload can grant credits. The adapter verifies raw bytes first.
        event = service.ad_provider.verify(await request.body(), request.headers)
        return service.complete_reward(event)

    @app.post("/api/cloud/app/publications")
    async def submit(request: Request):
        body = await request.json()
        return service.submit(request.state.owner, body.get("document"), body.get("rating"))

    @app.get("/api/cloud/app/publications")
    async def publications(request: Request):
        owner = request.state.owner
        moderator = owner in service.store.config.moderator_owners
        with service.store.transaction() as db:
            rows = db.execute("SELECT * FROM app_publications WHERE owner=? OR ?=1 ORDER BY created DESC LIMIT 100",
                              (owner, int(moderator))).fetchall()
        return {"publications": [{**{k: row[k] for k in ("id", "revision", "rating", "status", "reason")},
                                  "document": json.loads(row["payload"])} for row in rows], "moderator": moderator}

    @app.put("/api/cloud/app/publications/{publication}")
    async def review(publication: str, request: Request):
        body = await request.json()
        return service.review(request.state.owner, publication, body.get("revision"), body.get("decision"), body.get("reason"))
