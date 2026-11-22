"""Adult unlock (35): self-declaration where no law requires a check, Yoti facial age
estimation where one does. The region policy's ``adult_method`` picks the path."""
import secrets
import time

import httpx

from .store import CloudError

YOTI = "https://age.yoti.com"
VALID_FOR = 365 * 86400
DDL = """CREATE TABLE IF NOT EXISTS app_age_sessions(id TEXT PRIMARY KEY,owner TEXT,reference TEXT,
 country TEXT,policy TEXT,created REAL);"""


class AgeCheck:
    def __init__(self, service, client=None):
        self.service, self.store = service, service.store
        self.client = client  # tests inject an httpx.AsyncClient with a mock transport
        with self.store.transaction() as db:
            db.executescript(DDL)

    def _adult_owner(self, owner):
        value = self.service.publications.general(owner)
        policy = self.service.regions.get(value['country'], {})
        method = policy.get('adult_method') if policy.get('adult_accepted') is True else None
        if method == 'yoti' and not (self.store.config.yoti_sdk_id and self.store.config.yoti_api_key):
            method = None
        return value, method

    def status(self, owner):
        value, method = self._adult_owner(owner)
        try:
            self.service.require_adult(owner, country=value['country'])
            verified = True
        except CloudError:
            verified = False
        return {'method': method, 'verified': verified, 'adult_band': value['age_band'] == 'adult'}

    def _require(self, owner, wanted):
        value, method = self._adult_owner(owner)
        if method != wanted:
            raise CloudError('age_method_unavailable', 403)
        if value['age_band'] != 'adult':
            raise CloudError('adult_verification_required', 403)
        return value

    def declare(self, owner, confirmed):
        """The user states they are 18+; only regions whose policy allows declaration."""
        if confirmed is not True:
            raise CloudError('age_declaration_required')
        value = self._require(owner, 'self')
        self.service.record_age_result(owner, country=value['country'], adult=True,
                                       expires=time.time() + VALID_FOR,
                                       receipt=f"self-declared:{time.time():.0f}", policy=value['policy'])
        return self.status(owner)

    def _headers(self):
        cfg = self.store.config
        return {'Authorization': f'Bearer {cfg.yoti_api_key}', 'Yoti-SDK-Id': cfg.yoti_sdk_id,
                'Content-Type': 'application/json'}

    async def _call(self, method, path, **kwargs):
        try:
            if self.client:
                response = await self.client.request(method, YOTI + path, headers=self._headers(), **kwargs)
            else:
                async with httpx.AsyncClient(timeout=15) as client:
                    response = await client.request(method, YOTI + path, headers=self._headers(), **kwargs)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise CloudError('age_provider_unavailable', 502) from exc

    async def start(self, owner):
        value = self._require(owner, 'yoti')
        reference = secrets.token_hex(16)
        back = self.store.config.origin + '/profile/age'
        # ponytail: one estimation threshold with a document fallback; confirm the method mix
        # against the Yoti sandbox once keys exist (estimation alone fails most 18-24s).
        session = await self._call('POST', '/api/v1/sessions', json={
            'type': 'OVER', 'ttl': 900, 'reference_id': reference,
            'callback': {'url': back, 'auto': True}, 'cancel_url': back, 'synchronous_checks': True,
            'age_estimation': {'allowed': True, 'threshold': 25, 'level': 'PASSIVE', 'retry_limit': 1},
            'doc_scan': {'allowed': True, 'threshold': 18, 'retry_limit': 1},
            'digital_id': {'allowed': False}, 'credit_card': {'allowed': False}, 'mobile': {'allowed': False}})
        session_id = session.get('id') if isinstance(session, dict) else None
        if not isinstance(session_id, str) or not 1 <= len(session_id) <= 100:
            raise CloudError('age_provider_unavailable', 502)
        with self.store.transaction() as db:
            db.execute('DELETE FROM app_age_sessions WHERE owner=? OR created<?', (owner, time.time() - 3600))
            db.execute('INSERT INTO app_age_sessions VALUES(?,?,?,?,?,?)',
                       (session_id, owner, reference, value['country'], value['policy'], time.time()))
        return {'url': f"{YOTI}?sessionId={session_id}&sdkId={self.store.config.yoti_sdk_id}"}

    async def finish(self, owner, session_id):
        """Read the result server-to-server; the browser only says which session to look at."""
        if not isinstance(session_id, str) or not 1 <= len(session_id) <= 100:
            raise CloudError('invalid_age_session')
        self._require(owner, 'yoti')
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM app_age_sessions WHERE id=? AND owner=?', (session_id, owner)).fetchone()
        if not row:
            raise CloudError('age_session_not_found', 404)
        result = await self._call('GET', f'/api/v1/sessions/{session_id}/result')
        if not isinstance(result, dict) or result.get('reference_id') != row['reference'] or result.get('type') != 'OVER':
            raise CloudError('age_provider_unavailable', 502)
        state = result.get('status')
        if state == 'COMPLETE':
            self.service.record_age_result(owner, country=row['country'], adult=True,
                                           expires=time.time() + VALID_FOR, receipt='yoti:' + session_id,
                                           policy=row['policy'])
        if state in ('COMPLETE', 'FAIL', 'ERROR', 'CANCELLED', 'EXPIRED'):
            with self.store.transaction() as db:
                db.execute('DELETE FROM app_age_sessions WHERE id=?', (session_id,))
        return {**self.status(owner), 'result': state.lower() if state in ('COMPLETE', 'FAIL', 'ERROR', 'CANCELLED', 'EXPIRED') else 'pending'}
