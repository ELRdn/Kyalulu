"""In-process Relay adapter; no sockets, lifespan, storage or crypto ownership.

Host integration: share the running ASGI app with principal-aware MobileSecurity
and a synchronous host-only authorize_device(device_id) -> bool callback.
Never take device_id or session credentials from an untrusted request envelope.
request()/resume() are async iterators, not coroutines returning iterators. A
request starts on first iteration. WebSocket handlers may close/cancel their
iterator, but only runtime shutdown may call aclose(). Cancellation is an ordinary
POST to the existing generation cancel endpoint, with its session_id query.

Frames are JSON-compatible. Sequence numbers cover response/chunk/end/error.
Resume repeats the original response (same seq, replay=True) before new frames;
clients must not advance their cursor backwards for this metadata frame.
Buffers are volatile, bounded by encoded JSON bytes, and expire after 300 seconds
(including during long generations). Gaps never trigger a new HTTP request.
Ordinary HTTP bodies apply backpressure at a 256 KiB live delivery window.
Generation requests never wait for followers; their bounded replay can gap.
The Host owns upload aggregation (also bounded at 16 MiB), Noise and wire I/O.
Request IDs are NOT durable idempotency keys: bounded tombstones expire. Noise
prevents transport replay; durable generation_id deduplication belongs to storage.
No mutation is ever automatically retried, including after an expired request ID.
"""

import asyncio
import base64
import json
import re
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from contextlib import aclosing
from dataclasses import dataclass, field
from urllib.parse import unquote, urlsplit
from uuid import UUID

MAX_BODY = 16 * 1024 * 1024
MAX_REPLAY = 2 * 1024 * 1024
MAX_TOTAL_REPLAY = 32 * 1024 * 1024
RETENTION = 300
CHUNK_SIZE = 24 * 1024
LIVE_WINDOW = 256 * 1024
REQUEST_HEADERS = frozenset({"accept", "content-type", "range", "if-range"})
RESPONSE_HEADERS = frozenset(
    {
        "content-type",
        "content-length",
        "content-disposition",
        "content-range",
        "accept-ranges",
        "etag",
        "last-modified",
        "cache-control",
        "retry-after",
        "x-content-type-options",
    }
)


class BridgeError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


REMOTE_SCOPE_KEY = "kyalulu.remote"


@dataclass(frozen=True)
class RemotePrincipal:
    """Host-authenticated identity, never deserialized from a wire envelope.

    MobileSecurity must check this type and authorized(), force non-admin,
    enforce permitted()/validate_remote_session() and remote response projections.
    Presence of the key alone must NEVER confer privileges.
    """

    device_id: str
    authorizer: Callable[[str], bool] = field(repr=False, compare=False)

    def authorized(self) -> bool:
        try:
            return self.authorizer(self.device_id) is True
        except Exception:
            return False


class RuntimeAdapter:
    """Call the full ASGI app with an internal principal consumed by MobileSecurity.

    The Host owns the existing app lifespan. MobileSecurity owns route and remote
    session checks; do not pass a bare router or an app without that middleware.
    """

    def __init__(self, app, *, authorize_device, origin="https://relay.invalid"):
        self.app = app
        self.authorize_device = authorize_device
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
            or origin != "https://" + parsed.netloc
            or any(ord(c) < 33 or ord(c) > 126 for c in origin)
            or "\\" in origin
        ):
            raise ValueError("origin must be an exact HTTPS origin")
        _ = parsed.port
        self.origin = origin

    def authorize(self, device_id):
        if not isinstance(device_id, str) or not device_id:
            raise BridgeError("authentication_required")
        principal = RemotePrincipal(device_id, self.authorize_device)
        if not principal.authorized():
            raise BridgeError("authentication_required")
        return principal

    def prepare(self, method, path, headers, body, device_id):
        principal = self.authorize(device_id)
        if not isinstance(body, bytes):
            raise BridgeError("invalid_body")
        if len(body) > MAX_BODY:
            raise BridgeError("request_too_large")
        # Decode once, exactly as ASGI routing sees it. Reject escaped separators,
        # dot traversal and double encoding before the middleware allowlist runs.
        if (
            not isinstance(path, str)
            or len(path) > 8192
            or not path.startswith("/api/")
            or any(ord(c) < 33 or ord(c) > 126 for c in path)
            or "\\" in path
            or "#" in path
        ):
            raise BridgeError("invalid_path")
        raw_route, _, query = path.partition("?")
        if re.search(r"%(?![0-9a-fA-F]{2})", raw_route) or re.search(
            r"%(?:2f|5c|2e|25|3f|23)", raw_route, re.IGNORECASE
        ):
            raise BridgeError("invalid_path")
        try:
            route = unquote(raw_route, encoding="utf-8", errors="strict")
        except UnicodeDecodeError:
            raise BridgeError("invalid_path") from None
        if (
            "//" in route
            or any(ord(c) < 32 or ord(c) == 127 for c in route)
            or any(p in {".", ".."} for p in route.split("/"))
        ):
            raise BridgeError("invalid_path")
        if not isinstance(method, str) or method not in {
            "GET",
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
            "HEAD",
            "OPTIONS",
        }:
            raise BridgeError("admin_required")
        if not isinstance(headers, dict) or len(headers) > 16:
            raise BridgeError("invalid_headers")
        clean = []
        seen = set()
        for name, value in headers.items():
            if (
                not isinstance(name, str)
                or name.lower() not in REQUEST_HEADERS
                or name.lower() in seen
                or not isinstance(value, str)
                or len(value) > 8192
                or any(ord(c) < 32 or ord(c) > 126 for c in value)
            ):
                raise BridgeError("invalid_headers")
            seen.add(name.lower())
            clean.append((name.lower().encode("ascii"), value.encode("ascii")))
        origin = self.origin
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or not parsed.hostname:
            raise BridgeError("remote_disabled")
        clean.extend(
            [
                (b"host", parsed.netloc.encode("ascii")),
                (b"origin", origin.encode("ascii")),
                (b"content-length", str(len(body)).encode("ascii")),
            ]
        )
        scope = {
            REMOTE_SCOPE_KEY: principal,
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.3"},
            "http_version": "1.1",
            "method": method,
            "scheme": "https",
            "path": route,
            "raw_path": raw_route.encode("ascii"),
            "query_string": query.encode("ascii"),
            "root_path": "",
            "headers": clean,
            "client": ("192.0.2.1", 0),
            "server": (parsed.hostname, parsed.port or 443),
        }
        return scope

    async def invoke(self, scope, body, send):
        sent = False
        never_disconnected = asyncio.Event()

        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            # This is the runtime-owned connection, not the WebSocket connection.
            await never_disconnected.wait()
            return {"type": "http.disconnect"}

        await self.app(scope, receive, send)


@dataclass
class _Stream:
    device_id: str
    request_id: str
    generation: bool = False
    followers: dict = field(default_factory=dict)
    progress: asyncio.Event = field(default_factory=asyncio.Event)
    frames: deque = field(default_factory=deque)
    size: int = 0
    next_seq: int = 0
    response: dict | None = None
    response_size: int = 0
    done: bool = False
    changed: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    expiry: asyncio.TimerHandle | None = None


class RelayBridge:
    def __init__(
        self,
        adapter,
        *,
        max_requests=64,
        max_device_requests=16,
        max_replay_bytes=MAX_TOTAL_REPLAY,
        max_completed=256,
        max_tombstones=4096,
        clock=time.monotonic,
    ):
        self.adapter = adapter
        self.max_requests = max_requests
        self.max_device_requests = max_device_requests
        self.max_replay_bytes = max_replay_bytes
        self.max_completed = max_completed
        self.max_tombstones = max_tombstones
        self.clock = clock
        self._streams = {}
        self._tombstones = OrderedDict()
        self._closed = False

    @property
    def retained_bytes(self):
        return sum(s.size + s.response_size for s in self._streams.values())

    def _forget(self, stream):
        if stream.expiry:
            stream.expiry.cancel()
            stream.expiry = None
        self._expire(stream)
        if self._streams.pop(stream.request_id, None) is not None:
            self._tombstones[stream.request_id] = self.clock() + RETENTION
            while len(self._tombstones) > self.max_tombstones:
                self._tombstones.popitem(last=False)

    def _maintain(self):
        now = self.clock()
        while self._tombstones and next(iter(self._tombstones.values())) <= now:
            self._tombstones.popitem(last=False)
        for stream in list(self._streams.values()):
            self._prune(stream)
            if stream.done and not stream.frames:
                self._forget(stream)

    def _bound_completed(self):
        completed = [s for s in self._streams.values() if s.done]
        for stream in completed[: max(0, len(completed) - self.max_completed)]:
            self._forget(stream)

    def _bound_total(self):
        while self.retained_bytes > self.max_replay_bytes:
            candidates = [s for s in self._streams.values() if s.frames]
            if not candidates:
                break
            # Prioritize replay history over bytes still owed to a live download.
            expendable = [
                s
                for s in candidates
                if s.generation
                or not s.followers
                or s.frames[0][2]["seq"] <= min(s.followers.values())
            ]
            if expendable:
                candidates = expendable
            oldest = min(candidates, key=lambda s: s.frames[0][0])
            _, size, _ = oldest.frames.popleft()
            oldest.size -= size
            if not oldest.frames:
                oldest.response = None
                oldest.response_size = 0
            oldest.changed.set()

    def _prune(self, stream):
        cutoff = self.clock() - RETENTION
        while stream.frames and stream.frames[0][0] <= cutoff:
            _, size, _ = stream.frames.popleft()
            stream.size -= size
        if not stream.frames:
            stream.response = None
            stream.response_size = 0

    def _age(self, stream):
        # Expire idle detached buffers too, not just buffers read by a subscriber.
        stream.expiry = None
        self._prune(stream)
        if stream.frames:
            delay = max(0.001, stream.frames[0][0] + RETENTION - self.clock())
            stream.expiry = asyncio.get_running_loop().call_later(delay, self._age, stream)
        elif stream.done:
            self._forget(stream)
        stream.changed.set()

    async def _download_capacity(self, stream):
        if stream.generation:
            return
        window = min(LIVE_WINDOW, max(CHUNK_SIZE * 2, self.max_replay_bytes // 2))
        while stream.followers:
            acknowledged = min(stream.followers.values())
            pending = sum(size for _, size, frame in stream.frames if frame["seq"] > acknowledged)
            if pending < window:
                return
            stream.progress.clear()
            await stream.progress.wait()

    def _expire(self, stream):
        stream.frames.clear()
        stream.size = 0
        stream.response = None
        stream.response_size = 0
        stream.changed.set()

    def _append(self, stream, id, kind, **fields):
        frame = {"type": kind, "id": id, "seq": stream.next_seq, **fields}
        size = len(json.dumps(frame, separators=(",", ":")).encode())
        if size > MAX_REPLAY // 2:
            raise BridgeError("response_too_large")
        if kind == "response" and size > 64 * 1024:
            raise BridgeError("response_too_large")
        stream.next_seq += 1
        self._prune(stream)
        if kind == "response":
            stream.response = frame
            stream.response_size = size
        stream.frames.append((self.clock(), size, frame))
        stream.size += size
        while stream.frames and stream.size + stream.response_size > MAX_REPLAY:
            _, removed, _ = stream.frames.popleft()
            stream.size -= removed
        if stream.expiry is None:
            stream.expiry = asyncio.get_running_loop().call_later(RETENTION, self._age, stream)
        self._bound_total()
        stream.changed.set()

    async def _run(self, stream, id, scope, body):
        ended = False

        async def send(message):
            nonlocal ended
            if message["type"] == "http.response.start":
                headers = {}
                for key, value in message.get("headers", []):
                    name = key.decode("latin1").lower()
                    if name in RESPONSE_HEADERS:
                        headers[name] = value.decode("latin1")
                self._append(stream, id, "response", status=message["status"], headers=headers)
            elif message["type"] == "http.response.body":
                data = message.get("body", b"")
                for offset in range(0, len(data), CHUNK_SIZE):
                    await self._download_capacity(stream)
                    self._append(
                        stream,
                        id,
                        "chunk",
                        data=base64.b64encode(data[offset : offset + CHUNK_SIZE]).decode("ascii"),
                    )
                    await asyncio.sleep(0)  # yield to consumers without socket backpressure
                if not message.get("more_body", False):
                    self._append(stream, id, "end")
                    ended = True

        try:
            self.adapter.authorize(stream.device_id)
            await self.adapter.invoke(scope, body, send)
            if not ended:
                self._append(stream, id, "error", code="incomplete_response")
        except asyncio.CancelledError:
            self._append(stream, id, "error", code="host_shutdown")
            raise
        except Exception:
            if not ended:
                self._append(stream, id, "error", code="runtime_error")
        finally:
            stream.done = True
            stream.changed.set()
            self._bound_completed()

    async def request(self, id, method, path, headers, body, device_id):
        """Submit once. Repeated IDs return duplicate_request; use resume instead."""
        try:
            if not isinstance(id, str) or str(UUID(id)) != id:
                raise BridgeError("invalid_request_id")
            if self._closed:
                raise BridgeError("host_shutdown")
            scope = self.adapter.prepare(method, path, headers, body, device_id)
            self._maintain()
            if id in self._streams or id in self._tombstones:
                raise BridgeError("duplicate_request")
            live = [s for s in self._streams.values() if not s.done or s.followers]
            if (
                len(live) >= self.max_requests
                or sum(s.device_id == device_id for s in live) >= self.max_device_requests
            ):
                raise BridgeError("bridge_capacity")
            generation = method == "POST" and scope["path"] in {
                "/api/chat",
                "/api/chat/stream",
                "/api/chat/suggest",
            }
            stream = _Stream(device_id, id, generation=generation)
            self._streams[id] = stream
            stream.task = asyncio.create_task(self._run(stream, id, scope, body))
        except (ValueError, AttributeError):
            yield {"type": "error", "id": id, "seq": 0, "code": "invalid_request_id"}
            return
        except BridgeError as exc:
            yield {"type": "error", "id": id, "seq": 0, "code": exc.code}
            return
        async with aclosing(self._follow(id, stream, -1, device_id)) as frames:
            async for frame in frames:
                yield frame

    async def resume(self, id, after_seq, device_id):
        try:
            self.adapter.authorize(device_id)
            self._maintain()
            if not isinstance(id, str):
                raise BridgeError("replay_gap")
            stream = self._streams.get(id)
            if stream is None or stream.device_id != device_id:
                raise BridgeError("replay_gap")
            if type(after_seq) is not int or not -1 <= after_seq <= stream.next_seq - 1:
                raise BridgeError("invalid_cursor")
        except BridgeError as exc:
            yield {"type": "error", "id": id, "code": exc.code}
            return
        async with aclosing(self._follow(id, stream, after_seq, device_id, replay=True)) as frames:
            async for frame in frames:
                yield frame

    async def _follow(self, id, stream, cursor, device_id, *, replay=False):
        follower = object()
        stream.followers[follower] = cursor
        try:
            if replay and stream.response is not None and cursor >= 0:
                yield {
                    **stream.response,
                    "headers": dict(stream.response["headers"]),
                    "replay": True,
                }
            while True:
                if self._closed:
                    yield {"type": "error", "id": id, "code": "host_shutdown"}
                    return
                try:
                    self.adapter.authorize(device_id)
                except BridgeError as exc:
                    yield {"type": "error", "id": id, "code": exc.code}
                    return
                self._prune(stream)
                first = stream.frames[0][2]["seq"] if stream.frames else stream.next_seq
                if cursor + 1 < first:
                    yield {
                        "type": "error",
                        "id": id,
                        "code": "replay_gap",
                        "after_seq": cursor,
                        "first_seq": first,
                    }
                    return
                frame = next((f for _, _, f in stream.frames if f["seq"] > cursor), None)
                if frame is not None:
                    cursor = frame["seq"]
                    yield (
                        {**frame, "headers": dict(frame["headers"])}
                        if "headers" in frame
                        else dict(frame)
                    )
                    stream.followers[follower] = cursor
                    stream.progress.set()
                elif stream.done:
                    return
                else:
                    stream.changed.clear()
                    await stream.changed.wait()
        finally:
            stream.followers.pop(follower, None)
            stream.progress.set()

    async def aclose(self):
        """Runtime shutdown only; a transport disconnect must never call this."""
        self._closed = True
        tasks = [s.task for s in self._streams.values() if not s.task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for stream in self._streams.values():
            stream.done = True
            if stream.expiry:
                stream.expiry.cancel()
            self._expire(stream)
