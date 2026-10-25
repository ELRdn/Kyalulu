"""Separate hosted API. The unrestricted local/admin app is never mounted here."""

import asyncio
import json
import re
import time
from contextlib import asynccontextmanager
from dataclasses import asdict
from uuid import uuid4
from urllib.parse import urlsplit
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse, FileResponse
from fastapi.routing import APIRoute
from sse_starlette.sse import EventSourceResponse
from python.storage.context import CloudStorageContext, storage_context, get_db_path
from python.storage import db as storage, generations
from .auth import SupabaseAuth, SESSION_COOKIE, FLOW_COOKIE, provider_consent_version
from .backups import Backups, storage_usage
from .billing import StripeBilling
from .config import CloudConfig
from .account_profile import AccountProfile
from .contracts import PLANS
from .generation import CloudGenerations, CloudChat
from .queue import GenerationQueue
from .safety import declared_sfw
from .store import CloudStore, CloudError, digest, fingerprint
from .sync import SyncService, export_snapshot, validate_snapshot, TABLES
from .transfers import Transfers, SYNC_IMAGE_BYTES
from .router import backend_block, public_route, require_current_consent
from .router import public_routes

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def create_app(config=None, *, transport=None, ad_provider=None):
    config = config or CloudConfig.from_env()
    store = CloudStore(config)
    profiles = AccountProfile(store)
    auth, sync, backups = SupabaseAuth(config, store, transport), SyncService(store), Backups(store)
    locks, initialized = {}, set()
    jobs = CloudGenerations(store, GenerationQueue(), sync, locks, transport)
    billing = StripeBilling(store, backups, transport)
    transfers = Transfers(store, sync)
    from .community import Community, public_document
    community = Community(config.root / "community.db")
    app_community_enabled = config.community_enabled and config.legal_approved and not config.private_test

    @asynccontextmanager
    async def lifespan(app):
        from python.storage.runtime_lock import RuntimeLock

        with RuntimeLock(config.root):
            store.recover()
            billing_worker = None if config.private_test else asyncio.create_task(billing.worker())
            try:
                yield
            finally:
                if billing_worker:
                    billing_worker.cancel()
                    await asyncio.gather(billing_worker, return_exceptions=True)
                await jobs.shutdown()

    app = FastAPI(
        title="Kyalulu Cloud", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan
    )
    app.state.store, app.state.auth = store, auth
    app.state.jobs, app.state.sync = jobs, sync
    app.state.billing = billing
    app.state.transfers = transfers
    from .unified import UnifiedService, install_routes
    unified = UnifiedService(store, region_policies=dict(config.region_policies), ad_provider=ad_provider)
    app.state.unified = unified
    install_routes(app, unified)

    @app.exception_handler(CloudError)
    async def cloud_error(request, exc):
        return JSONResponse({"error": exc.code, "code": exc.code}, status_code=exc.status)

    @app.exception_handler(ValueError)
    async def bad_input(request, exc):
        return JSONResponse({"error": "invalid_input"}, status_code=400)

    @app.exception_handler(Exception)
    async def safe_error(request, exc):
        return JSONResponse({"error": "cloud_unavailable"}, status_code=503)

    async def ensure(owner):
        if owner not in initialized:
            async with locks.setdefault(owner, asyncio.Lock()):
                if owner not in initialized:
                    await storage.init_db()
                    await generations.recover_interrupted()
                    initialized.add(owner)

    async def pending():
        import aiosqlite

        async with aiosqlite.connect(get_db_path(storage.DB_PATH)) as db:
            if await (
                await db.execute("SELECT 1 FROM generations WHERE status='pending'")
            ).fetchone():
                raise CloudError("stop_generation_before_editing", 409)

    async def screen(owner, value, images=(), *, allow_assets=False):
        declared_sfw(value, allow_assets=allow_assets and config.image_storage_enabled)
        if images:
            raise CloudError("cloud_image_screening_not_validated", 503)
        if len(json.dumps(value, ensure_ascii=False).encode()) > 60_000:
            raise CloudError("safety_input_too_large", 413)

    class Boundary:
        def __init__(self, app):
            self.app = app

        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                return await self.app(scope, receive, send)
            request = Request(scope)
            # Guests can only read the SFW native catalog and explicitly public
            # snapshots. No anonymous account or tenant database is created.
            public_read = request.method == "GET" and (
                request.url.path in {"/api/capabilities", "/api/characters", "/api/worlds"}
                or re.fullmatch(r"/api/community/(?:works(?:/[^/]+(?:/comments)?)?|authors/[^/]+)", request.url.path) is not None
            )
            public = request.url.path in {
                "/api/health",
                "/api/mobile/status",
                "/api/cloud/status",
                "/api/cloud/auth/login",
                "/api/cloud/auth/logout",  # Local revocation must work while Supabase is unavailable.
                "/auth/callback",
                "/api/cloud/billing/webhook",
                "/api/cloud/app/rewards/webhook",
                "/api/cloud/app/eligibility",
            }
            try:
                if request.headers.get("host") != urlsplit(config.origin).netloc:
                    raise CloudError("invalid_host", 400)
                if config.private_test and request.url.path.startswith("/api/cloud/billing/"):
                    raise CloudError("not_found", 404)
                if (
                    request.method not in SAFE_METHODS
                    and request.url.path not in {"/api/cloud/billing/webhook", "/api/cloud/app/rewards/webhook"}
                ):
                    if request.headers.get("origin") != config.origin or request.headers.get(
                        "sec-fetch-site", "same-origin"
                    ) not in {"same-origin", "none"}:
                        raise CloudError("same_origin_required", 403)
                chunks, size = [], 0
                while True:
                    event = await receive()
                    if event["type"] == "http.disconnect":
                        return
                    size += len(event.get("body", b""))
                    if size > 16_000_000:
                        raise CloudError("request_too_large", 413)
                    chunks.append(event.get("body", b""))
                    if not event.get("more_body"):
                        break
                body = b"".join(chunks)
                delivered = False

                async def buffered():
                    nonlocal delivered
                    if not delivered:
                        delivered = True
                        return {"type": "http.request", "body": body, "more_body": False}
                    return await receive()

                async def private_send(message):
                    if message["type"] == "http.response.start":
                        headers = [
                            (k, v)
                            for k, v in message.get("headers", [])
                            if k.lower() != b"cache-control"
                        ]
                        headers += [
                            (b"cache-control", b"no-store"),
                            (b"x-content-type-options", b"nosniff"),
                            (b"referrer-policy", b"no-referrer"),
                        ]
                        message["headers"] = headers
                    await send(message)

                owner = None
                if not public and request.url.path.startswith("/api/"):
                    bearer = request.headers.get("authorization", "")
                    if bearer.startswith("Bearer "):
                        native_sync = ((request.url.path == '/api/cloud/app/sync' and request.method in {'GET', 'POST'})
                            or re.fullmatch(r'/api/cloud/app/sync/cancel/[^/]+',request.url.path) is not None and request.method=='POST'
                            or request.url.path == '/api/cloud/app/sync/device' and request.method == 'GET'
                            or re.fullmatch(r'/api/cloud/app/sync/transfers(?:/[0-9a-f-]{36}/(?:parts/\d+|commit))?', request.url.path) is not None
                                and request.method in {'GET', 'POST'}
                            or re.fullmatch(r'/api/cloud/app/entities/[^/]+', request.url.path) is not None and request.method == 'GET')
                        if not request.url.path.startswith("/api/cloud/sync") and not native_sync:
                            raise CloudError("sync_token_scope_required", 403)
                        token = bearer[7:]
                        with store.transaction() as db:
                            if native_sync:
                                device = db.execute('SELECT owner,expires,session_hash,id FROM app_sync_devices WHERE hash=?', (digest(token),)).fetchone()
                            else:
                                device = db.execute('SELECT owner,expires,session_hash FROM sync_devices WHERE hash=?', (digest(token),)).fetchone()
                        if not device or device[1] <= time.time():
                            raise CloudError("sync_device_expired", 401)
                        owner = await auth.owner(token, session_hash=device[2])
                        if owner != device[0]:
                            raise CloudError("sync_device_invalid", 401)
                        if native_sync:
                            request.state.app_sync_device = device[3]
                    else:
                        try:
                            owner = await auth.owner(request.cookies.get(SESSION_COOKIE))
                        except CloudError as exc:
                            if not public_read or exc.status != 401:
                                raise
                if owner:
                    expected_owner = request.headers.get('x-kyalulu-owner')
                    sync_scope = request.url.path.startswith(('/api/cloud/app/sync', '/api/cloud/app/runtime-consent', '/api/cloud/app/entities/'))
                    bootstrap = request.url.path == '/api/cloud/app/sync/device' and request.method == 'GET' and getattr(request.state, 'app_sync_device', None)
                    if (sync_scope and not bootstrap or expected_owner is not None) and expected_owner != owner:
                        raise CloudError('sync_account_changed', 403)
                    if config.unified_enabled and (
                        request.url.path.startswith(('/api/cloud/quotes', '/api/cloud/app/sync', '/api/cloud/app/runtime-consent', '/api/cloud/app/entities/', '/api/cloud/app/daily', '/api/cloud/app/rewards', '/api/cloud/app/publications', '/api/cloud/billing/checkout'))
                        or request.url.path.startswith('/api/chat') and request.method not in SAFE_METHODS
                    ):
                        unified.require_general(owner)
                    context = CloudStorageContext.for_owner(config.root / "tenants", owner)
                    context.directory.mkdir(parents=True, exist_ok=True)
                    scope.setdefault("state", {})["owner"] = owner
                    with storage_context(context):
                        await ensure(owner)
                        return await self.app(scope, buffered, private_send)
                return await self.app(scope, buffered, private_send)
            except CloudError as exc:
                return await JSONResponse(
                    {"error": exc.code, "code": exc.code}, status_code=exc.status
                )(scope, receive, send)

    app.add_middleware(Boundary)

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "version": "0.1.0", "runtime": "cloud-beta"}

    @app.get("/api/capabilities")
    async def hosted_capabilities():
        from python.api.capabilities import capabilities
        return {**capabilities(cloud=True, community=app_community_enabled, media=config.image_storage_enabled),
                "safety_screening": False, "credit_reservation": False}

    async def community_call(request, method, *args, **kwargs):
        import anyio
        from functools import partial
        if not app_community_enabled:
            raise CloudError("community_awaiting_acceptance", 503)
        # An empty read-only viewer identity is never registered or persisted.
        return await anyio.to_thread.run_sync(partial(method, getattr(request.state, "owner", ""), *args, **kwargs))

    async def community_body(request):
        try:
            value = await request.json()
        except ValueError as exc:
            raise CloudError("invalid_community_request") from exc
        if not isinstance(value, dict):
            raise CloudError("invalid_community_request")
        return value

    @app.get("/api/community/works")
    async def public_works(request: Request, q: str = "", tag: str = ""):
        if len(q) > 200 or len(tag) > 100:
            raise CloudError("invalid_search")
        return await community_call(request, community.list, q, tag)

    @app.get("/api/community/works/{work_id}")
    async def public_work(work_id: str, request: Request):
        return await community_call(request, community.detail, work_id)

    @app.post("/api/community/works")
    async def publish_work(request: Request):
        import anyio
        from python.storage.library import get_item
        if not app_community_enabled:
            raise CloudError("community_awaiting_acceptance",503)
        body = await community_body(request)
        if set(body) != {"item_id", "revision"} or not isinstance(body["item_id"],str) or type(body["revision"]) is not int:
            raise CloudError("invalid_publication")
        async with locks.setdefault(request.state.owner, asyncio.Lock()):
            existing = await community_call(request, community.publication, body["item_id"], body["revision"])
            if existing:
                return existing
            item = await anyio.to_thread.run_sync(get_item, body["item_id"], body["revision"])
            if not item:
                raise CloudError("library_item_not_found",404)
            snapshot = public_document(item.document)
            await screen(request.state.owner,snapshot)
            name = profiles.read(request.state.owner).get("display_name") or "Creator"
            return await community_call(request, community.publish, name, item.id, item.revision, snapshot)

    @app.delete("/api/community/works/{work_id}")
    async def withdraw_work(work_id: str, request: Request):
        return await community_call(request,community.withdraw,work_id)

    @app.put("/api/community/works/{work_id}/reaction")
    async def public_reaction(work_id: str, request: Request):
        body = await community_body(request)
        return await community_call(request,community.reaction,work_id,body.get("kind"),body.get("active"))

    @app.get("/api/community/works/{work_id}/comments")
    async def public_comments(work_id: str, request: Request):
        return await community_call(request,community.comment,work_id)

    @app.post("/api/community/works/{work_id}/comments")
    async def public_comment(work_id: str, request: Request):
        if not app_community_enabled:
            raise CloudError("community_awaiting_acceptance",503)
        body = await community_body(request)
        text = body.get("text")
        if not isinstance(text,str) or not 1 <= len(text.strip()) <= 2000:
            raise CloudError("invalid_comment")
        from uuid import UUID
        try:
            request_id = str(UUID(body["request_id"])) if body.get("request_id") else None
        except (ValueError, TypeError, AttributeError) as exc:
            raise CloudError("invalid_comment_request") from exc
        async with locks.setdefault(request.state.owner,asyncio.Lock()):
            await community_call(request,community.detail,work_id)
            if request_id and await community_call(request,community.comment_replay,work_id,text,request_id):
                return await community_call(request,community.comment,work_id)
            await screen(request.state.owner,{"comment":text})
            name = profiles.read(request.state.owner).get("display_name") or "Reader"
            await community_call(request,community.register,name)
            return await community_call(request,community.comment,work_id,text,request_id)

    @app.get("/api/community/authors/{author_id}")
    async def public_author(author_id: str, request: Request):
        return await community_call(request,community.author,author_id)

    @app.put("/api/community/authors/{author_id}/follow")
    async def follow_author(author_id: str, request: Request):
        return await community_call(request,community.relation,author_id,(await community_body(request)).get("active"))

    @app.put("/api/community/authors/{author_id}/block")
    async def block_author(author_id: str, request: Request):
        return await community_call(request,community.relation,author_id,(await community_body(request)).get("active"),block=True)

    @app.post("/api/community/reports")
    async def report_work(request: Request):
        body = await community_body(request)
        return await community_call(request,community.report,body.get("work_id"),body.get("reason"))

    @app.get("/source.tar.gz")
    async def corresponding_source():
        import os
        from pathlib import Path

        file = Path(os.getenv("KYALULU_SOURCE_ARCHIVE", "kyalulu-source.tar.gz"))
        if not file.is_file():
            raise CloudError("source_archive_not_built", 503)
        return FileResponse(file, media_type="application/gzip", filename="kyalulu-source.tar.gz")

    @app.get("/api/mobile/status")
    @app.get("/api/cloud/status")
    async def status(request: Request):
        authenticated = False
        owner = None
        try:
            owner = await auth.owner(request.cookies.get(SESSION_COOKIE))
            authenticated = True
        except CloudError:
            pass
        return {
            "cloud_mode": True,
            "remote_mode": False,
            "authenticated": authenticated,
            "owner_scope": owner,
            "administrative": False,
            "sfw": True,
            "safety_screening": False,
            "credit_reservation": False,
            "private_test": config.private_test,
            "login_available": bool(config.supabase_url and config.supabase_key
                                    and (config.legal_approved or config.private_test)),
            "billing_available": config.billing_enabled and backend_block(config) is None,
            "ads_available": False,
            'app_commercial': {'enabled': config.unified_enabled, 'subscriber': False,
                               'ads_available': False, 'banner': None},
            "images_available": config.image_storage_enabled and backend_block(config) is None,
            "inference_available": backend_block(config) is None,
            "operator_route": public_route(config),
            "provider_consent_version": provider_consent_version(config),
            "registration_limit": config.signup_limit,
        }

    @app.post("/api/cloud/auth/login")
    async def login(request: Request):
        body = await request.json()
        if (
            body.get("operator_backend") != config.operator_backend
            or body.get("provider_consent_version") != provider_consent_version(config)
            or body.get("provider_disclosure_version") != provider_consent_version(config)
        ):
            raise CloudError("provider_consent_renewal_required", 403)
        flow, result = await auth.begin(
            provider=body.get("provider"),
            email=body.get("email"),
            consent=body.get("consent") is True,
            country=body.get("country"),
            eligibility_ticket=body.get('eligibility_ticket'),
        )
        response = JSONResponse(result)
        response.set_cookie(
            FLOW_COOKIE, flow, secure=True, httponly=True, samesite="lax", max_age=600, path="/"
        )
        return response

    @app.get("/auth/callback")
    async def callback(request: Request):
        try:
            if request.query_params.get("error"):
                raise CloudError("login_cancelled", 401)
            token = await auth.finish(request.cookies.get(FLOW_COOKIE), request.query_params.get("code"))
        except CloudError as exc:
            allowed_errors = {"login_cancelled", "account_not_allowed", "verified_email_required",
                              "authentication_flow_expired", "provider_consent_renewal_required"}
            label = exc.code if exc.code in allowed_errors else "authentication_failed"
            response = RedirectResponse(config.origin + "/#/?login_error=" + label, status_code=303)
            response.delete_cookie(FLOW_COOKIE, secure=True, httponly=True, path="/")
            return response
        response = RedirectResponse(config.origin + "/#/", status_code=303)
        response.set_cookie(
            SESSION_COOKIE,
            token,
            secure=True,
            httponly=True,
            samesite="lax",
            max_age=30 * 86400,
            path="/",
        )
        response.delete_cookie(FLOW_COOKIE, secure=True, httponly=True, path="/")
        return response

    @app.post("/api/cloud/auth/logout")
    async def logout(request: Request):
        auth.logout(request.cookies.get(SESSION_COOKIE))
        response = JSONResponse({"ok": True})
        response.delete_cookie(SESSION_COOKIE, secure=True, httponly=True, path="/")
        return response

    @app.get("/api/models")
    async def models():
        routes = public_routes(config)
        return {
            "models": [
                {
                    "id": r["id"],
                    "display_name": r["display_name"],
                    "provider_type": r["provider"],
                    "provider_model": r["model"],
                    "context_length": 32768,
                    **{key: r[key] for key in ("available", "unavailable_reason", "upstream", "reasoning_effort",
                        "reasoning_summary_supported", "pricing", "privacy_note", "service_tier", "retains_prompts",
                        "training", "training_consent_required") if key in r},
                }
                for r in routes
            ]
        }

    @app.get("/api/cloud/account")
    async def account(request: Request):
        owner = request.state.owner
        plan = store.entitlements(owner)
        return {
            "identity": json.loads(store.secret(owner, "identity") or json.dumps({"id": owner})),
            "profile": profiles.read(owner),
            "private_test": config.private_test,
            "private_budget": store.private_budget(),
            "wallet": store.public_wallet(owner),
            "entitlements": asdict(plan),
            "plans": [asdict(PLANS["free"])] if config.private_test else [asdict(p) for p in PLANS.values()],
            "routes": public_routes(config),
            "storage_bytes": storage_usage(get_db_path(storage.DB_PATH).parent),
            "byok_configured": bool(store.secret(owner, "deepseek")),
            "sync": sync.settings(owner),
            "billing_available": config.billing_enabled and backend_block(config) is None,
            "billing_portal_available": bool(config.stripe_key and store.account(owner)["customer"]),
            "ads_available": False,
            'unified_sync_available':config.unified_enabled,
        }

    @app.get("/api/cloud/profile")
    async def account_profile(request: Request):
        return profiles.read(request.state.owner)

    @app.put("/api/cloud/profile")
    async def save_account_profile(request: Request):
        return profiles.update(request.state.owner, await request.json())

    @app.put("/api/cloud/byok")
    async def byok(request: Request):
        body = await request.json()
        if set(body) != {"key", "consent"} or body.get("consent") is not True:
            raise CloudError("provider_consent_required", 403)
        key = body["key"]
        if not isinstance(key, str) or len(key) > 256 or (key and not key.startswith("sk-")):
            raise CloudError("invalid_provider_key")
        store.secret(request.state.owner, "deepseek", key if key else None, delete=not key)
        return {"configured": bool(key)}

    @app.post("/api/cloud/quotes")
    async def quote(body: CloudChat, request: Request):
        async with locks.setdefault(request.state.owner, asyncio.Lock()):
            return await jobs.quote(request.state.owner, body)

    async def start(body, request):
        owner = request.state.owner
        directory = get_db_path(storage.DB_PATH).parent
        if storage_usage(directory) + 128_000 > store.entitlements(owner).storage_bytes:
            raise CloudError("cloud_storage_full", 413)
        backups.create(owner, directory / "data.db")
        return await jobs.start(owner, body)

    @app.post("/api/chat")
    async def chat(body: CloudChat, request: Request):
        task = await start(body, request)
        return await asyncio.shield(task)

    @app.post("/api/chat/stream")
    async def chat_stream(body: CloudChat, request: Request):
        task = await start(body, request)

        async def stream():
            yield {
                "event": "meta",
                "data": json.dumps(
                    {"generation_id": body.generation_id, "model_id": body.model_id}
                ),
            }
            last = None
            while not task.done():
                progress = jobs.progress.get((request.state.owner, body.generation_id))
                if progress and progress["stage"] != last:
                    last = progress["stage"]
                    yield {"event": "progress", "data": json.dumps(progress)}
                await asyncio.wait({task}, timeout=0.1)
            result = await asyncio.shield(task)
            progress = jobs.progress.get((request.state.owner, body.generation_id))
            if progress and progress["stage"] != last:
                yield {"event": "progress", "data": json.dumps(progress)}
            if result.get("status") == "completed":
                yield {"event": "done", "data": json.dumps(result, ensure_ascii=False)}
            else:
                yield {
                    "event": "error",
                    "data": json.dumps({"error": result.get("error", "generation_failed")}),
                }

        return EventSourceResponse(stream(), headers={"Cache-Control": "no-store"})

    @app.get("/api/chat/generations/{generation_id}")
    async def generation_status(generation_id: str, session_id: str):
        return await generations.status(generation_id, session_id)

    @app.post("/api/chat/generations/{generation_id}/cancel")
    async def cancel(generation_id: str, session_id: str, request: Request):
        result = await generations.cancel(generation_id, session_id)
        task = jobs.tasks.get((request.state.owner, generation_id))
        if result["status"] == "cancelled" and task:
            task.cancel()
            await asyncio.shield(asyncio.gather(task, return_exceptions=True))
        return result

    @app.get("/api/cloud/sync")
    async def sync_head(request: Request):
        return {**sync.revision(request.state.owner), **sync.settings(request.state.owner)}

    @app.put("/api/cloud/sync")
    async def sync_setting(request: Request):
        return sync.settings(request.state.owner, (await request.json()).get("mode"))

    @app.post("/api/cloud/sync/device")
    async def sync_device(request: Request):
        import secrets

        if request.headers.get("authorization"):
            raise CloudError("browser_session_required", 403)
        token = secrets.token_urlsafe(32)
        with store.transaction() as db:
            row = db.execute(
                "SELECT * FROM sessions WHERE hash=?",
                (digest(request.cookies.get(SESSION_COOKIE, "")),),
            ).fetchone()
            if not row:
                raise CloudError("authentication_required", 401)
            count = db.execute(
                "SELECT COUNT(*) FROM sync_devices WHERE owner=? AND expires>?",
                (request.state.owner, time.time()),
            ).fetchone()[0]
            if count >= 5:
                raise CloudError("sync_device_limit", 429)
            db.execute(
                "INSERT INTO sync_devices VALUES(?,?,?,?)",
                (digest(token), row["owner"], time.time() + 30 * 86400, row["hash"]),
            )
        return {"token": token, "expires_in": 30 * 86400}

    @app.delete("/api/cloud/sync/devices")
    async def revoke_sync_devices(request: Request):
        if request.headers.get("authorization"):
            raise CloudError("browser_session_required", 403)
        with store.transaction() as db:
            db.execute("DELETE FROM sync_devices WHERE owner=?", (request.state.owner,))
        return {"ok": True}

    @app.get("/api/cloud/sync/snapshot")
    async def sync_export(request: Request):
        owner = request.state.owner
        async with locks.setdefault(owner, asyncio.Lock()):
            selected = request.query_params.getlist("session") or None
            return {
                **sync.revision(owner),
                "snapshot": export_snapshot(get_db_path(storage.DB_PATH), selected),
            }

    @app.post("/api/cloud/sync/snapshot")
    async def sync_push(request: Request):
        owner, body = request.state.owner, await request.json()
        if (
            type(body.get("base_revision")) is not int
            or not isinstance(body.get("request_id"), str)
            or not 0 < len(body["request_id"]) <= 128
        ):
            raise CloudError("invalid_sync_request")
        async with locks.setdefault(owner, asyncio.Lock()):
            await pending()
            snapshot = body["snapshot"]
            assets = validate_snapshot(snapshot)
            if assets:
                if not config.image_storage_enabled:
                    raise CloudError("cloud_image_screening_not_validated", 503)
                if body.get("image_consent") is not True:
                    raise CloudError("image_provider_consent_required", 403)
                if any(len(raw) > SYNC_IMAGE_BYTES for raw, _ in assets.values()):
                    raise CloudError("sync_image_too_large_or_invalid", 413)
            signature = fingerprint({"base_revision": body["base_revision"], "snapshot": snapshot})
            with store.transaction() as db:
                replay = db.execute(
                    "SELECT hash,result FROM sync_requests WHERE owner=? AND id=?",
                    (owner, body["request_id"]),
                ).fetchone()
                if replay:
                    if replay[0] != signature:
                        raise CloudError("sync_request_conflict", 409)
                    return json.loads(replay[1])
            head = sync.revision(owner)
            if body["base_revision"] != head["revision"]:
                raise CloudError("sync_revision_conflict", 409)
            if head["deleted"]:
                raise CloudError("cloud_copy_deleted", 409)
            # Screen rows in bounded batches. No raw image is accepted without a
            # separately validated vision capability for the chosen provider.
            batch, size = [], 0
            for table, rows in snapshot["tables"].items():
                for row in rows:
                    encoded = len(json.dumps(row, ensure_ascii=False).encode())
                    if size + encoded > 50_000 and batch:
                        await screen(owner, batch, allow_assets=True)
                        batch, size = [], 0
                    batch.append({"table": table, "row": row})
                    size += encoded + 100
            if batch:
                await screen(owner, batch, allow_assets=True)
            if assets:
                for image in assets.values():
                    await screen(owner, {}, images=[image])
            directory = get_db_path(storage.DB_PATH).parent
            growth = len(json.dumps(snapshot).encode()) * 2
            if storage_usage(directory) + growth > store.entitlements(owner).storage_bytes:
                raise CloudError("cloud_storage_full", 413)
            backups.create(owner, directory / "data.db")
            return sync.push(
                owner,
                directory / "data.db",
                request_id=body["request_id"],
                base_revision=body["base_revision"],
                snapshot=snapshot,
            )

    @app.delete("/api/cloud/sync/snapshot")
    async def sync_delete(request: Request):
        async with locks.setdefault(request.state.owner, asyncio.Lock()):
            sync.delete(request.state.owner, get_db_path(storage.DB_PATH))
            return sync.revision(request.state.owner)

    @app.post("/api/cloud/sync/transfers")
    async def transfer_begin(request: Request):
        owner, body = request.state.owner, await request.json()
        async with locks.setdefault(owner, asyncio.Lock()):
            await pending()
            selected = body.get("selected_sessions")
            path = get_db_path(storage.DB_PATH)
            if body.get("direction") == "download":
                return await asyncio.to_thread(transfers.download, owner, path, selected)
            if (
                body.get("direction") != "upload"
                or type(body.get("base_revision")) is not int
                or not isinstance(body.get("request_id"), str)
                or not 0 < len(body["request_id"]) <= 128
            ):
                raise CloudError("invalid_sync_request")
            mode = sync.settings(owner)["mode"]
            if mode == "off" or (mode == "selected" and selected is None):
                raise CloudError("sync_not_enabled", 403)
            head = sync.revision(owner)
            if head["deleted"] or head["revision"] != body["base_revision"]:
                raise CloudError("sync_revision_conflict", 409)
            transfer = transfers.create(
                owner,
                direction="upload",
                selected=selected,
                revision=body["base_revision"],
                request_id=body["request_id"],
                image_consent=body.get("image_consent") is True,
            )
            return {"transfer_id": transfer, "page_bytes": 2_000_000, "expires_in": 3600}

    @app.put("/api/cloud/sync/transfers/{transfer_id}/pages/{index}")
    async def transfer_upload(transfer_id: str, index: int, request: Request):
        owner, page = request.state.owner, await request.json()
        async with locks.setdefault(owner, asyncio.Lock()):
            if not transfers.has_page(owner, transfer_id, index, page):
                transfers.validate_page(owner, transfer_id, page, get_db_path(storage.DB_PATH))
                images = ()
                if page["table"] == "library_assets":
                    partial = {"version": 1, "selected_sessions": None, "tables": {t: [] for t in TABLES}, "assets": page["assets"]}
                    partial["tables"]["library_assets"] = page["rows"]
                    images = list(validate_snapshot(partial).values())
                await screen(owner, {"table": page["table"], "rows": page["rows"]}, images=images, allow_assets=True)
                transfers.append(owner, transfer_id, index, page)
            return {"received": index, "chain": transfers.inspect(owner, transfer_id)["chain"]}

    @app.get("/api/cloud/sync/transfers/{transfer_id}/pages/{index}")
    async def transfer_download(transfer_id: str, index: int, request: Request):
        return transfers.page(request.state.owner, transfer_id, index)

    @app.post("/api/cloud/sync/transfers/{transfer_id}/commit")
    async def transfer_commit(transfer_id: str, request: Request):
        owner, body = request.state.owner, await request.json()
        async with locks.setdefault(owner, asyncio.Lock()):
            await pending()
            meta = transfers.inspect(owner, transfer_id)
            directory = get_db_path(storage.DB_PATH).parent
            if not meta["result"]:
                await asyncio.to_thread(
                    transfers.check_capacity, owner, transfer_id, directory / "data.db"
                )
                backups.create(owner, directory / "data.db")
            return await asyncio.to_thread(
                transfers.commit,
                owner,
                transfer_id,
                directory / "data.db",
                pages=body.get("pages"),
                chain=body.get("chain"),
            )

    @app.delete("/api/cloud/sync/transfers/{transfer_id}")
    async def transfer_delete(transfer_id: str, request: Request):
        async with locks.setdefault(request.state.owner, asyncio.Lock()):
            transfers.delete(request.state.owner, transfer_id)
            return {"ok": True}

    @app.get("/api/cloud/backups")
    async def backup_list(request: Request):
        return {"backups": backups.list(request.state.owner)}

    @app.get("/api/cloud/export")
    async def manual_export(request: Request):
        from .exports import build_export
        from starlette.background import BackgroundTask
        import shutil

        owner = request.state.owner
        async with locks.setdefault(owner, asyncio.Lock()):
            file = await asyncio.to_thread(
                build_export, get_db_path(storage.DB_PATH), config.root / "exports" / owner
            )
        return FileResponse(
            file,
            media_type="application/zip",
            filename="kyalulu-cloud.zip",
            background=BackgroundTask(shutil.rmtree, file.parent),
        )

    @app.post("/api/cloud/backups/{backup_id}/restore")
    async def restore(backup_id: str, request: Request):
        async with locks.setdefault(request.state.owner, asyncio.Lock()):
            await pending()
            initialized.discard(request.state.owner)
            backups.restore(request.state.owner, backup_id, get_db_path(storage.DB_PATH))
            await storage.init_db()
            initialized.add(request.state.owner)
            sync.bump(request.state.owner)
            return {"ok": True, **sync.revision(request.state.owner)}

    @app.post("/api/cloud/billing/checkout")
    async def checkout(request: Request):
        body = await request.json()
        from uuid import UUID

        request_id = str(UUID(body["request_id"]))
        return await billing.checkout(request.state.owner, body.get("sku"), request_id)

    @app.post("/api/cloud/billing/portal")
    async def portal(request: Request):
        return await billing.portal(request.state.owner)

    @app.post("/api/cloud/billing/webhook")
    async def webhook(request: Request):
        return await billing.webhook(
            await request.body(), request.headers.get("stripe-signature", "")
        )

    # Reuse Character Core handlers only from this explicit allowlist. Never mount
    # providers, LE, filesystem imports, hub fetchers, benchmarks or Remote controls.
    from python.api import chat as core_chat, catalog, library, memory, creator

    chat_allowed = {
        "/chat/context/{session_id}",
        "/chat/context/{session_id}/summaries/{summary_id}",
        "/chat/sessions/{session_id}/branch",
        "/chat/sessions/{session_id}/data",
        "/chat/settings",
        "/chat/history",
        "/chat/history/{msg_id}",
        "/chat/sessions",
        "/chat/intro/inject",
        "/chat/debug",
    }
    library_allowed = {
        "/imports/preview",
        "/imports/text/preview",
        "/imports/{preview_id}/commit",
        "/library",
        "/library/{item_id}",
        "/library/{item_id}/revisions",
        "/library/{item_id}/export",
        "/library/assets/{asset_id}",
    }
    for router, allowed in (
        (core_chat.router, chat_allowed),
        (catalog.router, None),
        (library.router, library_allowed),
        (memory.router, None),
        (creator.router, None),
    ):
        for route in router.routes:
            if not isinstance(route, APIRoute) or allowed is not None and route.path not in allowed:
                continue
            handler = route.get_route_handler()

            async def wrapped(request, handler=handler, route_path=route.path):
                owner = getattr(request.state, "owner", None)
                if owner is None and request.method == "GET" and route_path in {"/characters", "/worlds"}:
                    if request.query_params.get("include_nsfw", "false").lower() not in {"false", "0"}:
                        raise CloudError("cloud_sfw_only", 403)
                    # The core catalog also merges a private library. Guests
                    # must read native files directly without invoking it.
                    from python.core.prompt_compiler import list_available, CHAR_DIR, WORLD_DIR
                    key, directory = ("characters", CHAR_DIR) if route_path == "/characters" else ("worlds", WORLD_DIR)
                    return JSONResponse({key: [item for item in list_available(directory) if not item.get("nsfw")]})
                if request.method in SAFE_METHODS:
                    if request.query_params.get("include_nsfw", "false").lower() not in {
                        "false",
                        "0",
                    }:
                        raise CloudError("cloud_sfw_only", 403)
                    response = await handler(request)
                else:
                    async with locks.setdefault(owner, asyncio.Lock()):
                        if ((request.method == "POST" and route_path == "/library") or
                            (request.method == "PUT" and route_path == "/library/{item_id}")):
                            from uuid import UUID
                            from pydantic import ValidationError

                            try:
                                key = request.headers.get("Idempotency-Key")
                                request_id = str(UUID(key)) if key is not None else None
                                value = await request.json()
                                edit = library.EditDocument.model_validate(value) if request.method == "PUT" else None
                                document = edit.document if edit else library.PortableDocument.model_validate(value)
                            except (ValueError, ValidationError):
                                return await handler(request)
                            try:
                                saved = library.library.replay_save(document, request.path_params.get("item_id"),
                                    edit.expected_revision if edit else None, request_id=request_id) if request_id else None
                            except library.library.LibraryConflict as exc:
                                return JSONResponse({"error": str(exc)}, status_code=409)
                            if saved:
                                return JSONResponse(saved.model_dump(mode="json"))
                        await pending()
                        if request.url.path == "/api/imports/preview":
                            form = await request.form()
                            if form.get("remote"):
                                raise CloudError("cloud_hub_import_not_available", 403)
                            file = form.get("file")
                            if not file or not hasattr(file, "read"):
                                raise CloudError("invalid_import")
                            raw = await file.read(50_001)
                            await file.seek(0)
                            if len(raw) > 50_000:
                                raise CloudError("cloud_import_too_large", 413)
                            try:
                                text = raw.decode("utf-8")
                            except UnicodeDecodeError:
                                raise CloudError("cloud_image_screening_not_validated", 503)
                            from python.core.portable_formats import parse_import

                            documents, assets = parse_import(file.filename or "character.txt", raw)
                            if assets:
                                raise CloudError("cloud_image_screening_not_validated", 503)
                            value = {
                                "source_text": text,
                                "documents": [d.model_dump(mode="json") for d in documents],
                            }
                        else:
                            value = await request.json() if await request.body() else {}
                            if request.url.path == "/api/imports/text/preview":
                                from python.core.portable_formats import parse_import

                                documents, assets = parse_import(
                                    value.get("filename", "character.txt"),
                                    value.get("text", "").encode(),
                                )
                                if assets:
                                    raise CloudError("cloud_image_screening_not_validated", 503)
                                value = {
                                    **value,
                                    "documents": [d.model_dump(mode="json") for d in documents],
                                }
                        if request.method != "DELETE":
                            await screen(owner, value)
                            # Screen compiled references as well as the submitted settings.
                            if request.url.path.endswith(
                                "/chat/settings"
                            ) or request.url.path.endswith("/prompt/compile"):
                                from python.core.prompt_compiler import compile_prompt

                                compiled = compile_prompt(
                                    **{
                                        k: value[k]
                                        for k in (
                                            "character_id",
                                            "persona_id",
                                            "world_id",
                                            "library_binding",
                                        )
                                        if k in value
                                    },
                                    extra_system_prompt=value.get(
                                        "system_prompt", value.get("extra_system_prompt", "")
                                    ),
                                )
                                await screen(owner, compiled.model_dump())
                            directory = get_db_path(storage.DB_PATH).parent
                            if (
                                storage_usage(directory)
                                + len(json.dumps(value).encode()) * 3
                                + 16_384
                                > store.entitlements(owner).storage_bytes
                            ):
                                raise CloudError("cloud_storage_full", 413)
                            backups.create(owner, directory / "data.db")
                        if route_path == "/chat/sessions/{session_id}/data" and request.method == "DELETE":
                            from python.storage import conversation
                            try:
                                response = JSONResponse(await conversation.purge(
                                    request.path_params["session_id"], cloud_revision=(store.path, owner, store.encrypt('{}'))))
                            except generations.Conflict as exc:
                                raise CloudError("stop_generation_before_delete", 409) from exc
                        else:
                            response = await handler(request)
                        if response.status_code < 400:
                            if route_path != "/chat/sessions/{session_id}/data":
                                sync.bump(owner)
                if response.status_code >= 500:
                    return JSONResponse({"error": "cloud_unavailable"}, status_code=503)
                return response

            copy = APIRoute(
                "/api" + route.path,
                route.endpoint,
                methods=list(route.methods),
                response_model=route.response_model,
            )
            # Preserve original validation/dependency behavior; only boundary changes.
            from fastapi.routing import request_response

            copy.app = request_response(wrapped)
            app.router.routes.append(copy)

    if config.web_dist:

        @app.get("/{path:path}")
        async def web(path: str):
            if path in {'migration', 'migration/', 'migration/index.html'}:
                candidate = config.web_dist / 'migration/index.html'
                if not candidate.is_file():
                    raise CloudError('migration_shell_not_built', 503)
                return FileResponse(candidate, headers={
                    'Cross-Origin-Opener-Policy': 'unsafe-none',
                    'Cross-Origin-Embedder-Policy': 'unsafe-none',
                    'Cache-Control': 'no-cache',
                    'Referrer-Policy': 'no-referrer',
                    'Content-Security-Policy': "default-src 'none'; script-src 'self'; "
                        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
                        "connect-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
                })
            isolated = path in {'device', 'device/', 'device/index.html'}
            if isolated:
                candidate = config.web_dist / 'device/index.html'
                if not candidate.is_file():
                    raise CloudError('device_shell_not_built', 503)
                return FileResponse(candidate, headers={
                    'Cross-Origin-Opener-Policy': 'same-origin',
                    'Cross-Origin-Embedder-Policy': 'require-corp',
                    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                        "worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                        "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co; "
                        "frame-src 'none'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
                })
            candidate = (config.web_dist / path).resolve()
            if candidate.is_relative_to(config.web_dist.resolve()) and candidate.is_file():
                return FileResponse(candidate)
            if path.startswith("api/"):
                raise CloudError("not_found", 404)
            return FileResponse(config.web_dist / "index.html")

    return app
