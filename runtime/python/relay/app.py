"""Single-process FastAPI relay; only routing metadata is interpreted."""

import asyncio
import json
import os
import time
import uuid
from collections import OrderedDict
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.middleware.cors import CORSMiddleware

from .store import Store

MAX_PAYLOAD = 65536
QUEUE_SIZE = 32
SEND_TIMEOUT = 5
AUTH_TIMEOUT = 5


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Invitation(Model):
    invite: str = Field(min_length=32, max_length=128)
    name: str = Field(min_length=1, max_length=80)


class Pairing(Model):
    ttl: int = Field(default=300, ge=1, le=300)


class Redemption(Model):
    token: str = Field(min_length=32, max_length=128)
    name: str = Field(min_length=1, max_length=80)


class Limiter:
    """Bounded fixed-window limiter; trust only the actual transport peer IP."""

    def __init__(self):
        self.window = -1
        self.total = 0
        self.ips = OrderedDict()

    def allow(self, ip):
        window = int(time.monotonic() // 60)
        if window != self.window:
            self.window, self.total = window, 0
            self.ips.clear()
        self.total += 1
        count = self.ips.get(ip, 0) + 1
        self.ips[ip] = count
        if len(self.ips) > 2048:
            self.ips.popitem(last=False)
        return self.total <= 1200 and count <= 120


class Guards:
    """Bound HTTP reads before FastAPI parses JSON; no body/error logging."""

    def __init__(self, app, limiter):
        self.app, self.limiter = app, limiter

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def reject(code):
            await JSONResponse(
                {"detail": "request rejected"}, code, headers={"Cache-Control": "no-store"}
            )(scope, receive, send)

        if scope.get("query_string"):
            return await reject(400)
        if not self.limiter.allow((scope.get("client") or ("unknown",))[0]):
            return await reject(429)
        parts, size = [], 0
        try:
            async with asyncio.timeout(5):
                while True:
                    msg = await receive()
                    if msg["type"] == "http.disconnect":
                        return
                    part = msg.get("body", b"")
                    size += len(part)
                    if size > 4096:
                        return await reject(413)
                    parts.append(part)
                    if not msg.get("more_body"):
                        break
        except TimeoutError:
            return await reject(408)
        delivered = False

        async def bounded_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(parts), "more_body": False}
            return await receive()

        async def private_send(message):
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"cache-control", b"no-store"))
            await send(message)

        await self.app(scope, bounded_receive, private_send)


class Peer:
    def __init__(self, ws, device):
        self.ws, self.device = ws, device
        self.queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.stopped = asyncio.Event()
        self.code = 1000
        self.connection = None
        self.frames = self.bytes = 0
        self.window = time.monotonic()
        self.finished = asyncio.Event()

    def stop(self, code=1013):
        if not self.stopped.is_set():
            self.code = code
            self.stopped.set()

    def put(self, value):
        if self.stopped.is_set():
            return False
        try:
            self.queue.put_nowait(value)
            return True
        except asyncio.QueueFull:
            self.stop()
            return False

    def rate(self, size):
        now = time.monotonic()
        if now - self.window >= 1:
            self.window, self.frames, self.bytes = now, 0, 0
        self.frames += 1
        self.bytes += size
        return self.frames <= 256 and self.bytes <= 4 * 1024 * 1024

    async def writer(self):
        try:
            while True:
                value = await self.queue.get()
                async with asyncio.timeout(SEND_TIMEOUT):
                    if isinstance(value, bytes):
                        await self.ws.send_bytes(value)
                    else:
                        await self.ws.send_json(value)
        except Exception:
            self.stop()


class Hub:
    def __init__(self, store):
        self.store = store
        self.peers = {}
        self.sessions = {}
        self.connections = 0

    def attach(self, peer):
        device = peer.device
        # Recheck immediately before registration, without any await between them.
        if not self.store.alive(device["id"]):
            raise HTTPException(401)
        old = self.peers.get(device["id"])
        if old:
            raise HTTPException(409)
        host = None
        if device["role"] == "client":
            host = self.peers.get(device["host"])
            if not host or host.stopped.is_set():
                raise HTTPException(409)
        self.peers[device["id"]] = peer
        peer.put({"type": "ready"})
        if host:
            peer.connection = uuid.uuid4()
            self.sessions[peer.connection] = peer
            if not host.put(
                dict(
                    type="open",
                    connection_id=str(peer.connection),
                    device_id=device["id"],
                    pending=device["expires"] is not None,
                )
            ):
                peer.stop()

    def detach(self, peer):
        if self.peers.get(peer.device["id"]) is not peer:
            return
        self.peers.pop(peer.device["id"])
        if peer.connection:
            self.sessions.pop(peer.connection, None)
            host = self.peers.get(peer.device["host"])
            if host:
                host.put(dict(type="close", connection_id=str(peer.connection)))
        else:
            for other in list(self.peers.values()):
                if other.device["host"] == peer.device["id"]:
                    other.stop(1001)

    async def revoke(self, ids):
        peers = [p for ident in ids if (p := self.peers.get(ident))]
        for peer in peers:
            peer.stop(1008)
        if peers:
            await asyncio.gather(*(p.finished.wait() for p in peers))

    async def reader(self, peer):
        try:
            while not peer.stopped.is_set():
                msg = await peer.ws.receive()
                if msg["type"] == "websocket.disconnect":
                    return
                raw, text = msg.get("bytes"), msg.get("text")
                size = len(raw) if raw is not None else len((text or "").encode())
                limit = MAX_PAYLOAD + (16 if peer.device["role"] == "host" else 0)
                if size > limit:
                    peer.stop(1009)
                    return
                if not peer.rate(size) or not self.store.alive(peer.device["id"]):
                    peer.stop(1008)
                    return
                if peer.device["role"] == "client":
                    if raw is None:
                        raise ValueError()
                    host = self.peers.get(peer.device["host"])
                    if not host or not host.put(peer.connection.bytes + raw):
                        peer.stop(1013)
                        return
                else:
                    if raw is not None:
                        if len(raw) < 16:
                            raise ValueError()
                        connection = uuid.UUID(bytes=raw[:16])
                    else:
                        if size > 1024:
                            raise ValueError()
                        control = json.loads(text)
                        if (
                            not isinstance(control, dict)
                            or set(control) != {"type", "connection_id"}
                            or control["type"] != "close"
                        ):
                            raise ValueError()
                        connection = uuid.UUID(control["connection_id"])
                    client = self.sessions.get(connection)
                    if not client or client.device["host"] != peer.device["id"]:
                        raise ValueError()
                    if raw is None:
                        client.stop(1000)
                    elif not self.store.alive(client.device["id"]):
                        client.stop(1008)
                    else:
                        client.put(raw[16:])
        except Exception:
            peer.stop(1008)

    async def monitor(self, peer):
        while True:
            await asyncio.sleep(1)
            if not self.store.alive(peer.device["id"]):
                peer.stop(1008)
                return

    async def serve(self, peer):
        tasks = [
            asyncio.create_task(f(peer)) for f in (self.reader, lambda p: p.writer(), self.monitor)
        ]
        tasks.append(asyncio.create_task(peer.stopped.wait()))
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            peer.stop(1000)
            self.detach(peer)
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            try:
                async with asyncio.timeout(SEND_TIMEOUT):
                    await peer.ws.close(code=peer.code)
            except Exception:
                pass
            finally:
                peer.finished.set()


def bearer(request):
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer ") or not 32 <= len(auth[7:]) <= 128:
        raise HTTPException(401, "invalid credentials")
    return auth[7:]


def create_app(db_path=None, origins=None):
    store = Store(db_path or os.environ.get("RELAY_DB", "relay.sqlite3"))
    hub, limiter = Hub(store), Limiter()
    allowed_origins = set(
        origins
        if origins is not None
        else filter(None, os.environ.get("RELAY_ORIGINS", "").split(","))
    )
    for origin in allowed_origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme not in ("https", "http")
            or not parsed.hostname
            or "*" in origin
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("RELAY_ORIGINS must contain explicit HTTP(S) origins")

    @asynccontextmanager
    async def lifespan(app):
        yield
        peers = list(hub.peers.values())
        for peer in peers:
            peer.stop(1001)
        if peers:
            await asyncio.gather(*(p.finished.wait() for p in peers))

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store, app.state.hub = store, hub
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(allowed_origins),
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=300,
    )
    app.add_middleware(Guards, limiter=limiter)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        return JSONResponse({"detail": "invalid request"}, status_code=422)

    @app.get("/healthz")
    async def health():
        with store.transaction() as db:
            db.execute("SELECT 1")
        return {"status": "ok"}

    @app.post("/v1/invitations/redeem")
    async def invite(body: Invitation):
        return store.redeem_invite(body.invite, body.name)

    @app.post("/v1/pairings")
    async def pairing(body: Pairing, request: Request):
        return store.pairing(bearer(request), body.ttl)

    @app.post("/v1/pairings/{ident}/redeem")
    async def redeem(ident: uuid.UUID, body: Redemption):
        return store.redeem_pairing(str(ident), body.token, body.name)

    @app.post("/v1/devices/{ident}/approve")
    async def approve(ident: uuid.UUID, request: Request):
        return store.approve(bearer(request), str(ident))

    @app.delete("/v1/devices/{ident}", status_code=204)
    async def revoke(ident: uuid.UUID, request: Request):
        await hub.revoke(store.revoke(bearer(request), str(ident)))
        return Response(status_code=204)

    @app.get("/v1/hosts")
    async def hosts(request: Request):
        rows = store.hosts(bearer(request))
        for row in rows:
            peer = hub.peers.get(row["host_id"])
            row["online"] = bool(peer and not peer.stopped.is_set())
        return {"hosts": rows}

    @app.websocket("/v1/socket")
    async def socket(ws: WebSocket):
        origin = ws.headers.get("origin")
        if (
            ws.scope.get("query_string")
            or (origin is not None and origin not in allowed_origins)
            or hub.connections >= 128
            or not limiter.allow(ws.client.host if ws.client else "unknown")
        ):
            await ws.close(code=1008)
            return
        hub.connections += 1
        peer = None
        try:
            await ws.accept()
            try:
                async with asyncio.timeout(AUTH_TIMEOUT):
                    msg = await ws.receive()
                text = msg.get("text")
                if text is None or len(text.encode()) > 1024:
                    raise ValueError()
                auth = json.loads(text)
                if (
                    not isinstance(auth, dict)
                    or set(auth) != {"role", "token"}
                    or auth["role"] not in ("host", "client")
                ):
                    raise ValueError()
                if (auth["role"] == "host" and origin is not None) or (
                    auth["role"] == "client" and origin not in allowed_origins
                ):
                    raise ValueError()
                if not isinstance(auth["token"], str) or not 32 <= len(auth["token"]) <= 128:
                    raise ValueError()
                device = store.authenticate(auth["token"], auth["role"])
                peer = Peer(ws, device)
                hub.attach(peer)
            except HTTPException as exc:
                await ws.close(code=1013 if exc.status_code == 409 else 1008)
                return
            except (ValueError, TypeError, TimeoutError):
                await ws.close(code=1008)
                return
            await hub.serve(peer)
        finally:
            hub.connections -= 1
            if peer:
                hub.detach(peer)
                peer.finished.set()

    return app
