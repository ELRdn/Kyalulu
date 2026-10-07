"""Opt-in, single-process home runtime security and same-origin PWA serving.

Session secrets are hashed in memory: restart revokes every device. Run one worker.
Never trust forwarded headers for local administration.
"""

from python.storage.context import get_db_path
import hashlib
import ipaddress
import os
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.staticfiles import StaticFiles

from python.api.origins import trusted_origins

COOKIE = "__Host-kyalulu_device"
CODE_TTL = 120
SESSION_TTL = 30 * 24 * 3600
router = APIRouter(prefix="/mobile")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class Config:
    remote_mode: bool = False
    public_origin: str = ""
    web_dist: Path | None = None

    @classmethod
    def from_env(cls):
        enabled = os.getenv("KYALULU_REMOTE_MODE", "0")
        if enabled not in {"0", "1"}:
            raise ValueError("KYALULU_REMOTE_MODE must be 0 or 1")
        origin = os.getenv("KYALULU_PUBLIC_ORIGIN", "")
        if enabled == "1":
            parsed = urlsplit(origin)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.username
                or parsed.password
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.netloc != parsed.netloc.lower()
                or origin != "https://" + parsed.netloc
                or any(c.isspace() for c in origin)
                or "\\" in origin
            ):
                raise ValueError(
                    "KYALULU_PUBLIC_ORIGIN must be an exact HTTPS origin (no trailing slash)"
                )
            _ = parsed.port  # reject invalid port syntax at startup
        dist = os.getenv("KYALULU_WEB_DIST")
        directory = Path(dist).resolve() if dist else None
        if directory and not (directory / "index.html").is_file():
            raise ValueError("KYALULU_WEB_DIST must contain built index.html")
        return cls(enabled == "1", origin, directory)


class Devices:
    def __init__(self):
        self.code_hash = None
        self.code_expires = 0
        self.attempts = 0
        self.sessions = {}
        self.window = 0
        self.requests = 0

    def issue(self):
        code = f"{secrets.randbelow(100_000_000):08d}"
        self.code_hash = digest(code)
        self.code_expires = time.time() + CODE_TTL
        self.attempts = 0
        return {"code": code, "expires_in": CODE_TTL}

    def prune(self):
        now = time.time()
        self.sessions = {k: v for k, v in self.sessions.items() if v["expires_at"] > now}

    def session(self, token):
        self.prune()
        return self.sessions.get(digest(token)) if token else None

    def pair(self, code, name):
        now = time.time()
        if now - self.window >= 60:
            self.window, self.requests = now, 0
        self.requests += 1
        if self.requests > 30:
            return error("pair_rate_limited", 429, {"Retry-After": "60"})
        if self.attempts >= 5:
            return error("pair_code_locked", 429)
        self.attempts += 1
        if (
            not self.code_hash
            or now >= self.code_expires
            or not secrets.compare_digest(self.code_hash, digest(code))
        ):
            return error("invalid_pair_code", 400)
        self.prune()
        if len(self.sessions) >= 32:
            return error("device_limit", 409)
        self.code_hash = None  # one use; no await between validation and consumption
        token = secrets.token_urlsafe(32)
        device = {
            "id": secrets.token_hex(16),
            "name": name,
            "created_at": now,
            "expires_at": now + SESSION_TTL,
        }
        self.sessions[digest(token)] = device
        response = JSONResponse({"authenticated": True, "device_name": name})
        response.set_cookie(
            COOKIE,
            token,
            max_age=SESSION_TTL,
            secure=True,
            httponly=True,
            samesite="strict",
            path="/",
        )
        return response


def error(code, status, headers=None):
    return JSONResponse({"error": code, "code": code}, status_code=status, headers=headers)


def loopback(host):
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def local_admin(request):
    # Public-host requests and proxied requests must NEVER inherit localhost privileges.
    return (
        "kyalulu.remote" not in request.scope
        and request.client is not None
        and loopback(request.client.host)
        and request.url.hostname in {"localhost", "127.0.0.1", "::1"}
        and not any(k.lower().startswith(("forwarded", "x-forwarded-")) for k in request.headers)
        and COOKIE not in request.cookies
    )


# Exact method/path pairs: new routes remain forbidden until explicitly reviewed.
ALLOWED = {
    "GET": [
        r"/api/health",
        r"/api/models",
        r"/api/mobile/(status|models)",
        r"/api/(characters|personas|worlds)",
        r"/api/chat/(settings|history|sessions)",
        r"/api/chat/generations/[^/]+",
        r"/api/prompts/presets",
        r"/api/library",
        r"/api/library/lib_[0-9a-f]{32}",
        r"/api/library/assets/[0-9a-f]{64}",
        r"/api/library/lib_[0-9a-f]{32}/export",
        r"/api/imports/[0-9a-f]{32}",
        r"/api/memory",
        r"/api/memory/(scopes|events)",
        r"/api/memory/mem_[0-9a-f]{12}",
        r"/api/memory/session/[^/]+",
        r"/api/creator/(persona|world)",
        r"/api/creator/(persona|world)/created_[0-9a-f]{32}@[0-9]+",
        r"/api/creator/(persona|world)/created_[0-9a-f]{32}@[0-9]+/export",
    ],
    "POST": [
        r"/api/mobile/logout",
        r"/api/chat",
        r"/api/chat/(stream|suggest|intro/inject)",
        r"/api/chat/generations/[^/]+/cancel",
        r"/api/memory",
        r"/api/memory/search",
        r"/api/creator/(persona|world)",
        r"/api/library",
        r"/api/library/assets",
        r"/api/imports/preview",
        r"/api/imports/text/preview",
        r"/api/imports/[0-9a-f]{32}/commit",
        r"/api/prompts/presets",
        r"/api/prompt/compile",
    ],
    "PUT": [
        r"/api/chat/settings",
        r"/api/chat/history/[0-9]+",
        r"/api/memory/session/[^/]+",
        r"/api/creator/(persona|world)/created_[0-9a-f]{32}@[0-9]+",
        r"/api/library/lib_[0-9a-f]{32}",
        r"/api/prompts/presets/preset_[0-9a-f]{8}",
    ],
    "PATCH": [r"/api/memory/mem_[0-9a-f]{12}"],
    "DELETE": [
        r"/api/chat/history",
        r"/api/chat/history/[0-9]+",
        r"/api/memory/mem_[0-9a-f]{12}",
        r"/api/prompts/presets/preset_[0-9a-f]{8}",
    ],
}


def permitted(method, path):
    return any(re.fullmatch(pattern, path) for pattern in ALLOWED.get(method, []))


def valid_session_id(value):
    return (
        isinstance(value, str)
        and 0 < len(value) <= 200
        and value == value.strip()
        and not value.startswith("__")
        and not any(ord(c) < 32 for c in value)
    )


async def validate_remote_session(request, receive):
    """Scope remote conversation operations; never let defaults target global data."""
    import json

    path, method = request.url.path, request.method
    body_paths = {"/api/chat", "/api/chat/stream", "/api/chat/suggest", "/api/chat/settings"}
    if method in {"POST", "PUT"} and path in body_paths:
        raw = bytearray()
        original_receive = receive
        while True:
            message = await original_receive()
            if message["type"] == "http.disconnect":
                return error("request_disconnected", 400), receive
            raw.extend(message.get("body", b""))
            if len(raw) > 2 * 1024 * 1024:
                return error("request_too_large", 413), receive
            if not message.get("more_body", False):
                break
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return error("invalid_json", 400), receive
        if not isinstance(body, dict) or not valid_session_id(body.get("session_id")):
            return error("session_id_required", 400), receive
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": bytes(raw), "more_body": False}
            return await original_receive()

        receive = replay
    query_scoped = (
        (method == "DELETE" and path == "/api/chat/history")
        or (method == "POST" and path == "/api/chat/intro/inject")
        or re.fullmatch(r"/api/chat/generations/[^/]+(?:/cancel)?", path)
    )
    if query_scoped:
        ids = request.query_params.getlist("session_id")
        if len(ids) != 1 or not valid_session_id(ids[0]):
            return error("session_id_required", 400), receive
    if method == "PUT" and path.startswith("/api/memory/session/"):
        if not valid_session_id(path.removeprefix("/api/memory/session/")):
            return error("session_id_required", 400), receive
    if method in {"PUT", "DELETE"} and re.fullmatch(r"/api/chat/history/[0-9]+", path):
        # Existing edit/delete UI identifies a message by ID. Validate its actual
        # session rather than trusting a caller-supplied session assertion.
        import aiosqlite

        from python.storage.db import DB_PATH, init_db

        await init_db()
        async with aiosqlite.connect(get_db_path(DB_PATH)) as db:
            row = await (
                await db.execute(
                    "SELECT session_id FROM chat_history WHERE id=?", (int(path.rsplit("/", 1)[1]),)
                )
            ).fetchone()
        if row and not valid_session_id(row[0]):
            return error("reserved_session", 403), receive
    return None, receive


class MobileSecurity:
    def __init__(self, app, config, devices):
        self.app, self.config, self.devices = app, config, devices

    async def __call__(self, scope, receive, send):
        if scope["type"] not in {"http", "websocket"}:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 1008})
        request = Request(scope)
        path = request.url.path
        api = path == "/api" or path.startswith("/api/")

        started = False

        async def secured_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if not (api and k.lower() in {b"cache-control", b"pragma", b"expires"})
                ]
                headers += [
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"x-frame-options", b"DENY"),
                ]
                if api:
                    headers += [
                        (b"cache-control", b"no-store, private"),
                        (b"pragma", b"no-cache"),
                        (b"expires", b"0"),
                    ]
                message["headers"] = headers
            await send(message)

        async def reject(code, status):
            await error(code, status)(scope, receive, secured_send)

        # This value is an in-process Python object, never an HTTP header, cookie
        # or deserialized wire field. The Host owns its live revocation callback.
        internal = "kyalulu.remote" in scope
        if internal:
            from python.remote.bridge import RemotePrincipal

            principal = scope["kyalulu.remote"]
            if not isinstance(principal, RemotePrincipal) or not principal.authorized():
                return await reject("authentication_required", 401)
            if not api or not permitted(request.method, path):
                return await reject("admin_required", 403)
            if request.method == "POST" and path == "/api/mobile/logout":
                return await reject("use_remote_device_revocation", 409)
            if request.method == "GET" and path == "/api/mobile/status":
                response = JSONResponse({"remote_mode": True, "authenticated": True,
                                         "administrative": False, "device_name": "Remote端末"})
                return await response(scope, receive, secured_send)

        local = local_admin(request)
        origin = request.headers.get("origin")
        if internal:
            valid = True
        elif not self.config.remote_mode:
            if not request.client or not loopback(request.client.host):
                return await reject("remote_disabled", 403)
            valid = origin in trusted_origins() or (
                request.url.hostname in {"localhost", "127.0.0.1", "::1"}
                and origin == str(request.base_url).rstrip("/")
            )
        else:
            public_host = urlsplit(self.config.public_origin).netloc
            if not local and (
                request.headers.get("host") != public_host or request.url.scheme != "https"
            ):
                return await reject("invalid_remote_origin", 403)
            valid = origin in trusted_origins() if local else origin == self.config.public_origin
            if local:
                valid = valid or origin == str(request.base_url).rstrip("/")
        if api and (
            (origin is not None and not valid)
            or request.headers.get("sec-fetch-site") == "cross-site"
        ):
            return await reject("untrusted_origin", 403)
        if self.config.remote_mode and not local and api and not internal:
            if (
                request.method not in {"GET", "HEAD", "OPTIONS"}
                and origin != self.config.public_origin
            ):
                return await reject("origin_required", 403)
            public = (
                request.method == "GET" and path in {"/api/mobile/status", "/api/health"}
            ) or (request.method == "POST" and path == "/api/mobile/pair")
            if not public:
                if not self.devices.session(request.cookies.get(COOKIE)):
                    return await reject("authentication_required", 401)
                if not permitted(request.method, path):
                    return await reject("admin_required", 403)
        # Hide framework introspection remotely as well as future non-API routes.
        if (
            self.config.remote_mode
            and not local
            and path in {"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}
        ):
            return await reject("admin_required", 403)
        try:
            if (self.config.remote_mode or internal) and not local and api:
                problem, receive = await validate_remote_session(request, receive)
                if problem is not None:
                    return await problem(scope, receive, secured_send)
            if (
                (self.config.remote_mode or internal)
                and not local
                and request.method == "GET"
                and path == "/api/models"
            ):
                response = JSONResponse(await mobile_models())
                return await response(scope, receive, secured_send)
            if (
                (self.config.remote_mode or internal)
                and not local
                and request.method == "GET"
                and re.fullmatch(r"/api/imports/[0-9a-f]{32}", path)
            ):
                # The legacy HubRoute restricts browser origins to desktop. This
                # lookup reads an existing local preview; it never fetches a URL.
                from python.storage.db import init_db
                from python.storage.library import get_preview

                await init_db()
                try:
                    response = JSONResponse(get_preview(path.rsplit("/", 1)[1]))
                except ValueError:
                    response = error("preview_not_found", 404)
                return await response(scope, receive, secured_send)
            await self.app(scope, receive, secured_send)
        except Exception:
            if started:
                raise
            # Even unhandled API errors must not be cached or expose internals.
            if not api:
                raise
            import logging

            if internal:
                logging.getLogger(__name__).error("Remote API request failed")
            else:
                logging.getLogger(__name__).exception("API request failed")
            await reject("internal_error", 500)


def state(request):
    return request.app.state.mobile_config, request.app.state.mobile_devices


@router.get("/status")
async def status(request: Request):
    config, devices = state(request)
    session = devices.session(request.cookies.get(COOKIE))
    result = {
        "remote_mode": config.remote_mode,
        "administrative": not config.remote_mode or local_admin(request),
        "authenticated": not config.remote_mode or local_admin(request) or session is not None,
    }
    if session:
        result["device_name"] = session["name"]
    return result


class Pair(BaseModel):
    code: str = Field(pattern=r"^[0-9]{8}$")
    name: str = Field(min_length=1, max_length=80)


@router.post("/pair")
async def pair(body: Pair, request: Request):
    config, devices = state(request)
    if not config.remote_mode:
        return error("remote_disabled", 403)
    name = body.name.strip()
    if not name or any(ord(c) < 32 for c in name):
        return error("invalid_device_name", 400)
    return devices.pair(body.code, name)


@router.post("/logout")
async def logout(request: Request):
    _, devices = state(request)
    token = request.cookies.get(COOKIE)
    if token:
        devices.sessions.pop(digest(token), None)
    response = Response(status_code=204)
    response.delete_cookie(COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    return response


@router.post("/admin/code")
async def issue_code(request: Request):
    config, devices = state(request)
    if not config.remote_mode or not local_admin(request):
        return error("admin_required", 403)
    return devices.issue()


@router.get("/admin/devices")
async def list_devices(request: Request):
    _, devices = state(request)
    if not local_admin(request):
        return error("admin_required", 403)
    devices.prune()
    return {"devices": list(devices.sessions.values())}


@router.delete("/admin/devices/{device_id}")
async def revoke(device_id: str, request: Request):
    _, devices = state(request)
    if not local_admin(request):
        return error("admin_required", 403)
    for key, value in list(devices.sessions.items()):
        if value["id"] == device_id:
            del devices.sessions[key]
            return Response(status_code=204)
    return error("device_not_found", 404)


@router.get("/models")
async def mobile_models():
    from python.core.registry import list_le_models, list_models_from_db

    models = [*await list_models_from_db(), *await list_le_models()]
    return {
        "models": [
            {"id": m["id"], "display_name": m.get("display_name", m["id"])}
            for m in models
            if m.get("id")
        ]
    }


class WebDist(StaticFiles):
    """SPA fallback only for extensionless HTML navigations, never API or missing assets."""

    async def get_response(self, path, scope):
        from starlette.exceptions import HTTPException

        path = path.replace("\\", "/").lstrip("/")
        if (
            path == "api"
            or path.startswith("api/")
            or any(p.startswith(".") for p in Path(path).parts)
        ):
            raise HTTPException(404)
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if (
                exc.status_code != 404
                or Path(path).suffix
                or "text/html" not in Request(scope).headers.get("accept", "")
            ):
                raise
            response = await super().get_response("index.html", scope)
        response.headers["Cache-Control"] = "no-cache"
        if Path(path).name in {"sw.js", "service-worker.js"}:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Service-Worker-Allowed"] = "/"
        return response
