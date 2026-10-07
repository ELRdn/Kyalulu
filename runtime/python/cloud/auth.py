"""Supabase PKCE authentication with opaque HttpOnly application sessions."""

import base64
import hashlib
import json
import secrets
import time
import asyncio
from uuid import UUID
from urllib.parse import urlencode
import httpx
from .store import CloudError, digest

SESSION_COOKIE = "__Host-kyalulu_cloud"
FLOW_COOKIE = "__Host-kyalulu_flow"
CONSENT_VERSION = "2026-10-03-provider-routing-v2"


def provider_consent_version(config):
    # Go remains compatible with its existing explanation. Each other backend
    # has a distinct agreement; switching cannot reuse an earlier Go consent.
    return CONSENT_VERSION if config.operator_backend == "opencode-go" else (
        CONSENT_VERSION + ("-openrouter-inferencenet-deepseek-v2" if config.operator_backend == "openrouter"
                           else "-direct-deepseek"))


class SupabaseAuth:
    def __init__(self, config, store, transport=None):
        self.config, self.store, self.transport = config, store, transport
        self._locks = {}

    async def call(self, path, *, method="GET", token=None, body=None):
        if not self.config.supabase_url or not self.config.supabase_key:
            raise CloudError("authentication_not_configured", 503)
        headers = {"apikey": self.config.supabase_key}
        if token:
            headers["Authorization"] = "Bearer " + token
        try:
            async with httpx.AsyncClient(
                timeout=15, transport=self.transport, follow_redirects=False
            ) as client:
                response = await client.request(
                    method, self.config.supabase_url + "/auth/v1/" + path, headers=headers, json=body
                )
        except httpx.HTTPError as exc:
            raise CloudError("authentication_unavailable", 503) from exc
        if response.status_code >= 400:
            raise CloudError("authentication_failed", 401)
        try:
            data = response.json()
        except ValueError as exc:
            raise CloudError("authentication_failed", 401) from exc
        if not isinstance(data, dict):
            raise CloudError("authentication_failed", 401)
        return data

    async def begin(self, *, provider=None, email=None, adult=False, consent=False):
        if not self.config.legal_approved and not self.config.private_test:
            raise CloudError("legal_publication_pending", 503)
        if not adult or not consent:
            raise CloudError("adult_and_consent_required", 403)
        if not self.config.supabase_url or not self.config.supabase_key:
            raise CloudError("authentication_not_configured", 503)
        if provider not in {None, "google"}:
            raise CloudError("invalid_auth_provider")
        if provider is None:
            if not isinstance(email, str) or "@" not in email or len(email) > 254:
                raise CloudError("invalid_email")
            if self.config.allowed_emails and email.strip().casefold() not in self.config.allowed_emails:
                raise CloudError("account_not_allowed", 403)
        flow, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        with self.store.transaction() as db:
            db.execute("DELETE FROM flows WHERE expires<?", (time.time(),))
            if db.execute("SELECT COUNT(*) FROM flows").fetchone()[0] >= 100:
                raise CloudError("authentication_rate_limited", 429)
            db.execute(
                "INSERT INTO flows VALUES(?,?,?)",
                (digest(flow), self.store.encrypt(json.dumps({"verifier": verifier,
                    "consent": provider_consent_version(self.config), "backend": self.config.operator_backend})),
                    time.time() + 600),
            )
        callback = self.config.origin + "/auth/callback"
        if provider == "google":
            return flow, {
                "url": self.config.supabase_url
                + "/auth/v1/authorize?"
                + urlencode(
                    {
                        "provider": "google",
                        "redirect_to": callback,
                        "code_challenge": challenge,
                        "code_challenge_method": "s256",
                    }
                )
            }
        if not email or "@" not in email or len(email) > 254:
            raise CloudError("invalid_email")
        await self.call(
            "otp?" + urlencode({"redirect_to": callback}),
            method="POST",
            body={
                "email": email,
                "create_user": True,
                "code_challenge": challenge,
                "code_challenge_method": "s256",
            },
        )
        return flow, {"sent": True}

    async def finish(self, flow, code):
        if not flow or not code or len(code) > 4096:
            raise CloudError("authentication_flow_expired", 401)
        with self.store.transaction() as db:
            row = db.execute(
                "SELECT verifier,expires FROM flows WHERE hash=?", (digest(flow),)
            ).fetchone()
            if not row or row["expires"] <= time.time():
                raise CloudError("authentication_flow_expired", 401)
            try:
                agreement = json.loads(self.store.decrypt(row["verifier"]))
                if (agreement["consent"] != provider_consent_version(self.config)
                        or agreement["backend"] != self.config.operator_backend):
                    raise ValueError()
                verifier = agreement["verifier"]
            except (ValueError, KeyError, TypeError) as exc:
                raise CloudError("provider_consent_renewal_required", 403) from exc
            db.execute("DELETE FROM flows WHERE hash=?", (digest(flow),))
        session = await self.call(
            "token?grant_type=pkce",
            method="POST",
            body={"auth_code": code, "code_verifier": verifier},
        )
        user = await self.call("user", token=session.get("access_token"))
        owner = self.verified_owner(user)
        self.store.account(owner, consent=provider_consent_version(self.config))
        metadata = user.get("user_metadata")
        name = metadata.get("full_name", "") if isinstance(metadata, dict) else ""
        self.store.secret(owner, "identity", json.dumps({"id": owner, "email": user["email"],
            "display_name": name[:200] if isinstance(name, str) else ""}))
        self.store.trial(owner)
        token = secrets.token_urlsafe(32)
        self.save(token, owner, session)
        return token

    def verified_owner(self, user):
        if not user.get("email_confirmed_at"):
            raise CloudError("verified_email_required", 403)
        email = user.get("email")
        if not isinstance(email, str) or "@" not in email or len(email) > 254:
            raise CloudError("authentication_failed", 401)
        if self.config.allowed_emails and (not isinstance(email, str)
                or email.strip().casefold() not in self.config.allowed_emails):
            raise CloudError("account_not_allowed", 403)
        try:
            return str(UUID(user["id"]))
        except (KeyError, ValueError, TypeError) as exc:
            raise CloudError("authentication_failed", 401) from exc

    def save(self, token, owner, session, session_hash=None):
        access, refresh = session.get("access_token"), session.get("refresh_token")
        expires = session.get("expires_in")
        if not access or not refresh or type(expires) is not int or not 0 < expires <= 86400:
            raise CloudError("authentication_failed", 401)
        with self.store.transaction() as db:
            if session_hash:
                # A refresh must never recreate a session revoked during the HTTP call.
                updated = db.execute(
                    "UPDATE sessions SET access=?,refresh=?,expires=?,checked=? "
                    "WHERE hash=? AND owner=? AND valid_until>?",
                    (self.store.encrypt(access), self.store.encrypt(refresh), time.time() + expires,
                     time.time(), session_hash, owner, time.time()),
                )
                if updated.rowcount != 1:
                    raise CloudError("authentication_required", 401)
                return
            db.execute(
                "INSERT INTO sessions(hash,owner,access,refresh,expires,checked,valid_until) VALUES(?,?,?,?,?,?,?) ON CONFLICT(hash) DO UPDATE SET access=excluded.access,refresh=excluded.refresh,expires=excluded.expires,checked=excluded.checked",
                (
                    digest(token),
                    owner,
                    self.store.encrypt(access),
                    self.store.encrypt(refresh),
                    time.time() + expires,
                    time.time(),
                    time.time() + 30 * 86400,
                ),
            )

    async def owner(self, token, *, session_hash=None):
        key = session_hash or digest(token or "")
        # Serialize refresh-token rotation for concurrently mounted app components.
        lock = self._locks.setdefault(key, asyncio.Lock())
        try:
            async with lock:
                return await self._owner(token, key)
        finally:
            if not lock.locked() and not getattr(lock, "_waiters", None):
                self._locks.pop(key, None)

    async def _owner(self, token, session_hash):
        if not token or len(token) > 256:
            raise CloudError("authentication_required", 401)
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM sessions WHERE hash=?", (session_hash,)).fetchone()
        if not row:
            raise CloudError("authentication_required", 401)
        if row["valid_until"] <= time.time():
            with self.store.transaction() as db:
                db.execute("DELETE FROM sessions WHERE hash=?", (session_hash,))
            raise CloudError("authentication_expired", 401)
        access = self.store.decrypt(row["access"])
        try:
            if row["expires"] < time.time() + 30:
                session = await self.call(
                    "token?grant_type=refresh_token",
                    method="POST",
                    body={"refresh_token": self.store.decrypt(row["refresh"])},
                )
                owner = self.verified_owner(
                    await self.call("user", token=session.get("access_token"))
                )
                if owner != row["owner"]:
                    raise CloudError("authentication_failed", 401)
                self.save(token, owner, session, session_hash)
            elif row["checked"] < time.time() - 60:
                owner = self.verified_owner(await self.call("user", token=access))
                if owner != row["owner"]:
                    raise CloudError("authentication_failed", 401)
                with self.store.transaction() as db:
                    updated = db.execute(
                        "UPDATE sessions SET checked=? WHERE hash=? AND owner=? AND valid_until>?",
                        (time.time(), session_hash, owner, time.time()),
                    )
                    if updated.rowcount != 1:
                        raise CloudError("authentication_required", 401)
            account = self.store.account(row["owner"])
            if account["suspended"]:
                raise CloudError("account_unavailable", 403)
            return row["owner"]
        except CloudError as exc:
            if exc.status in {401, 403}:
                with self.store.transaction() as db:
                    db.execute("DELETE FROM sessions WHERE hash=?", (session_hash,))
            raise

    def logout(self, token):
        with self.store.transaction() as db:
            db.execute("DELETE FROM sync_devices WHERE session_hash=?", (digest(token or ""),))
            db.execute("DELETE FROM sessions WHERE hash=?", (digest(token or ""),))
