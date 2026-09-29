"""Outbound Relay Host. Relay routing metadata is never application authorization.

All secrets/pins are owned by Vault; Noise cipher state is ephemeral. The caller
owns the Runtime lifespan. Disconnect closes followers, not bridge generations.
Only stop() shuts down the bridge. Control-plane and socket clients are injectable
for isolated tests; production clients verify TLS and do not use ambient proxies.
"""

import asyncio
import base64
import copy
import hashlib
import io
import json
import secrets
import time
from dataclasses import dataclass, field
from urllib.parse import quote, urlsplit
from uuid import UUID

from .bridge import BridgeError, RelayBridge, RuntimeAdapter
from .uploads import Uploads

MAX_CONNECTION_BYTES = 64 * 1024 * 1024
MAX_CONNECTION_SECONDS = 600
MAX_NOISE_FRAME = 65535
OUTGOING_BYTES_PER_SECOND = 2 * 1024 * 1024
OUTGOING_FRAMES_PER_SECOND = 200


class HostError(ValueError):
    """Public, non-sensitive management error code."""


def exact_origin(value):
    parsed = urlsplit(value)
    loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
    if (
        parsed.scheme not in ({"https", "http"} if loopback else {"https"})
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
        or value != f"{parsed.scheme}://{parsed.netloc}"
        or any(ord(c) < 33 or ord(c) > 126 for c in value)
        or "\\" in value
    ):
        raise HostError("invalid_origin")
    _ = parsed.port
    return value


def uuid(value):
    if not isinstance(value, str) or str(UUID(value)) != value:
        raise HostError("invalid_id")
    return value


def confirmation_code(handshake_hash):
    if not isinstance(handshake_hash, bytes) or len(handshake_hash) != 32:
        raise HostError("invalid_handshake")
    return f"{int.from_bytes(handshake_hash[:4], 'big') % 1_000_000:06d}"


def decode_secret(value):
    if not isinstance(value, str) or len(value) != 43:
        raise HostError("invalid_enrollment")
    try:
        raw = base64.b64decode(value + "=", altchars=b"-_", validate=True)
    except ValueError:
        raise HostError("invalid_enrollment") from None
    if len(raw) != 32 or base64.urlsafe_b64encode(raw).decode().rstrip("=") != value:
        raise HostError("invalid_enrollment")
    return raw


def qr_image(url):
    import qrcode

    output = io.BytesIO()
    qrcode.make(url).save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()


@dataclass
class Connection:
    id: str
    device_id: str
    cloud_pending: bool
    noise: object
    created: float
    bytes_used: int = 0
    approved: bool = False
    name: str = ""
    code: str = ""
    expires: float = 0
    attempts: int = 0
    uploads: Uploads = field(default_factory=Uploads)
    followers: dict = field(default_factory=dict)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    timer: asyncio.Task | None = None


class HostService:
    def __init__(
        self,
        app,
        vault,
        *,
        control=None,
        connector=None,
        noise_factory=None,
        render_qr=qr_image,
        le_probe=None,
        clock=time.time,
        monotonic=time.monotonic,
    ):
        self.app, self.vault = app, vault
        self.config = vault.read()
        if self.config.get("version") != 1:
            raise HostError("unsupported_vault")
        exact_origin(self.config["relay"])
        exact_origin(self.config["app_origin"])
        uuid(self.config["owner_id"])
        uuid(self.config["host_id"])
        self.config.setdefault("devices", {})
        self.config.setdefault("pairings", {})
        self.control = control or self._http_control
        self.connector = connector
        self.noise_factory = noise_factory
        self.render_qr, self.le_probe = render_qr, le_probe
        self.clock, self.monotonic = clock, monotonic
        self.bridge = RelayBridge(RuntimeAdapter(app, authorize_device=self.authorized))
        self.connections = {}
        self.connected = False
        self.runtime = False
        self.le = {"status": "unknown"}
        self.socket = None
        self._runner = None
        self._health_task = None
        self._stopped = False
        self._send_lock = asyncio.Lock()
        self._next_send_at = 0.0
        self._pace_sleep = asyncio.sleep
        self._state_lock = asyncio.Lock()

    async def _http_control(self, method, path, body=None):
        import httpx

        async with httpx.AsyncClient(
            base_url=self.config["relay"], timeout=10, trust_env=False, follow_redirects=False
        ) as client:
            response = await client.request(
                method,
                path,
                json=body,
                headers={
                    "Authorization": "Bearer " + self.config["host_token"],
                },
            )
        if not 200 <= response.status_code < 300:
            raise HostError("relay_control_failed")
        return response.json() if response.content else {}

    def _save(self, value):
        self.vault.write(value)
        self.config = value

    def authorized(self, device_id):
        device = self.config["devices"].get(device_id)
        return bool(
            not self._stopped
            and device
            and device.get("approved") is True
            and not device.get("revoked")
        )

    def status(self):
        return {
            "installed": True,
            "connected": self.connected,
            "runtime": self.runtime,
            "le": dict(self.le),
            "pending": [
                {"device_id": c.device_id, "name": c.name}
                for c in self.connections.values()
                if c.noise.finished and not c.approved and c.expires > self.clock()
            ],
            "devices": [
                {"device_id": id, "name": d["name"]}
                for id, d in self.config["devices"].items()
                if d.get("approved") and not d.get("revoked")
            ],
        }

    async def pair(self):
        if not self.connected or self._stopped:
            raise HostError("host_not_connected")
        async with self._state_lock:
            now = self.clock()
            pending = {k: v for k, v in self.config["pairings"].items() if v > now}
            if len(pending) >= 10:
                raise HostError("pairing_capacity")
            issued = await self.control("POST", "/v1/pairings", {"ttl": 300})
            uuid(issued["pairing_id"])
            expires = min(float(issued["expires_at"]), now + 300)
            if expires <= now:
                raise HostError("pairing_expired")
            secret = secrets.token_bytes(32)
            pending[hashlib.sha256(secret).hexdigest()] = expires
            value = copy.deepcopy(self.config)
            value["pairings"] = pending
            self._save(value)
            payload = {
                "version": 1,
                "relay": self.config["relay"],
                "ownerId": self.config["owner_id"],
                "hostId": self.config["host_id"],
                "pairingId": issued["pairing_id"],
                "token": issued["token"],
                "secret": base64.urlsafe_b64encode(secret).decode().rstrip("="),
                "hostKey": self.config["public_key"],
                "expires": expires,
            }
            url = (
                self.config["app_origin"]
                + "/#remote="
                + quote(json.dumps(payload, separators=(",", ":")), safe="")
            )
            return {"url": url, "qr": self.render_qr(url), "expires": expires}

    async def approve(self, device_id, code):
        uuid(device_id)
        async with self._state_lock:
            connection = next(
                (c for c in self.connections.values() if c.device_id == device_id and c.code), None
            )
            if (
                not connection
                or connection.expires <= self.clock()
                or connection.attempts >= 5
                or connection.approved
            ):
                raise HostError("approval_unavailable")
            connection.attempts += 1
            if not isinstance(code, str) or not secrets.compare_digest(code, connection.code):
                raise HostError("invalid_confirmation")
            # Persist the pin BEFORE asking cloud approval, but leave it disabled.
            value = copy.deepcopy(self.config)
            value["devices"][device_id] = {
                "name": connection.name,
                "public_key": connection.noise.peer_key.hex(),
                "approved": False,
                "revoked": False,
            }
            self._save(value)
            result = await self.control("POST", f"/v1/devices/{device_id}/approve")
            if result.get("device_id") != device_id or result.get("pending") is not False:
                raise HostError("relay_approval_failed")
            value = copy.deepcopy(self.config)
            value["devices"][device_id]["approved"] = True
            self._save(value)
            connection.approved = True
        if self.connections.get(connection.id) is connection:
            await self._send_frame(connection, {"type": "ready", "version": 1})

    async def revoke(self, device_id):
        uuid(device_id)
        await self._revoke(device_id)

    async def _revoke(self, device_id, acknowledge=None):
        async with self._state_lock:
            value = copy.deepcopy(self.config)
            old = value["devices"].get(device_id, {})
            value["devices"][device_id] = {**old, "approved": False, "revoked": True}
            self._save(value)
        try:
            if acknowledge is not None:
                await self._send_frame(acknowledge, {"type": "revoked"}, allow_revoked=True)
        finally:
            for connection in list(self.connections.values()):
                if connection.device_id == device_id:
                    await self._close_connection(connection.id, notify=True)
        # A failure here cannot restore local authorization. Explicit revoke retries
        # are safe/idempotent; never roll the persisted revocation back.
        await self.control("DELETE", f"/v1/devices/{device_id}")

    async def _wire_send(self, message, *, connection=None):
        async with self._send_lock:
            socket = self.socket
            if socket is None:
                raise HostError("host_disconnected")
            size = len(message.encode("utf-8")) if isinstance(message, str) else len(message)
            delay = self._next_send_at - self.monotonic()
            if delay > 0:
                await self._pace_sleep(delay)
            if socket is not self.socket:
                raise HostError("host_disconnected")
            if connection is not None and self.connections.get(connection.id) is not connection:
                raise HostError("connection_closed")
            # One shared no-burst schedule for auth, controls and every device.
            # Charge routing UUID, Noise overhead and UTF-8 text bytes as sent.
            self._next_send_at = self.monotonic() + max(
                1 / OUTGOING_FRAMES_PER_SECOND, size / OUTGOING_BYTES_PER_SECOND
            )
            await asyncio.wait_for(socket.send(message), 5)

    def _budget(self, connection, size):
        if (
            self.monotonic() - connection.created >= MAX_CONNECTION_SECONDS
            or connection.bytes_used + size > MAX_CONNECTION_BYTES
        ):
            raise HostError("fresh_handshake_required")
        connection.bytes_used += size

    async def _send_frame(self, connection, frame, *, allow_revoked=False):
        async with connection.send_lock:
            if self.connections.get(connection.id) is not connection:
                raise HostError("connection_closed")
            if (
                connection.approved
                and not allow_revoked
                and not self.authorized(connection.device_id)
            ):
                raise HostError("device_revoked")
            plaintext = json.dumps(frame, separators=(",", ":"), ensure_ascii=True).encode()
            self._budget(connection, len(plaintext) + 16)
            encrypted = connection.noise.encrypt(plaintext)
            if len(encrypted) > MAX_NOISE_FRAME:
                raise HostError("frame_too_large")
            await self._wire_send(UUID(connection.id).bytes + encrypted, connection=connection)

    async def _deadline(self, connection):
        try:
            await asyncio.sleep(30)  # bound incomplete handshakes
            if not connection.noise.finished:
                await self._close_connection(connection.id, notify=True)
                return
            while self.connections.get(connection.id) is connection:
                if not connection.approved and connection.expires <= self.clock():
                    await self._close_connection(connection.id, notify=True)
                    return
                if self.monotonic() - connection.created >= MAX_CONNECTION_SECONDS:
                    await self._close_connection(connection.id, notify=True)
                    return
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass

    async def _open(self, frame):
        id, device_id = uuid(frame["connection_id"]), uuid(frame["device_id"])
        if type(frame.get("pending")) is not bool:
            raise HostError("invalid_open")
        if (
            id in self.connections
            or len(self.connections) >= 10
            or any(c.device_id == device_id for c in self.connections.values())
        ):
            raise HostError("connection_capacity")
        device = self.config["devices"].get(device_id)
        if device and device.get("revoked"):
            await self._wire_send(json.dumps({"type": "close", "connection_id": id}))
            return
        approved = self.authorized(device_id)
        if not approved and not frame["pending"]:
            await self._wire_send(json.dumps({"type": "close", "connection_id": id}))
            return
        if self.noise_factory is None:
            from .crypto import NoiseSession

            factory = NoiseSession
        else:
            factory = self.noise_factory
        noise = factory(
            bytes.fromhex(self.config["private_key"]),
            initiator=False,
            expected_peer=bytes.fromhex(device["public_key"]) if device else None,
            prologue=(
                f"kyalulu-remote-v1|{self.config['owner_id']}|{self.config['host_id']}|{device_id}"
            ).encode(),
        )
        connection = Connection(id, device_id, frame["pending"], noise, self.monotonic())
        self.connections[id] = connection
        connection.timer = asyncio.create_task(self._deadline(connection))

    async def _handshake(self, connection, message):
        payload = connection.noise.read(message)
        if not connection.noise.finished:
            if payload:
                raise HostError("invalid_handshake")
            reply = connection.noise.write()
            self._budget(connection, len(reply))
            await self._wire_send(UUID(connection.id).bytes + reply, connection=connection)
            return
        data = json.loads(payload)
        if (
            not isinstance(data, dict)
            or set(data) != {"version", "secret", "name"}
            or type(data["version"]) is not int
            or data["version"] != 1
            or not isinstance(data["name"], str)
            or not 1 <= len(data["name"].strip()) <= 80
            or any(ord(c) < 32 for c in data["name"])
        ):
            raise HostError("invalid_enrollment")
        connection.name = data["name"].strip()
        device = self.config["devices"].get(connection.device_id)
        if self.authorized(connection.device_id):
            if (
                connection.cloud_pending
                or data["secret"] is not None
                or connection.noise.peer_key.hex() != device["public_key"]
            ):
                raise HostError("invalid_reconnect")
            connection.approved = True
            await self._send_frame(connection, {"type": "ready", "version": 1})
            return
        if not connection.cloud_pending or (device and device.get("revoked")):
            raise HostError("device_not_approved")
        secret = decode_secret(data["secret"])
        digest = hashlib.sha256(secret).hexdigest()
        async with self._state_lock:
            expires = self.config["pairings"].get(digest, 0)
            if expires <= self.clock():
                raise HostError("enrollment_expired")
            value = copy.deepcopy(self.config)
            del value["pairings"][digest]
            self._save(value)  # single use, including failed/rejected local approvals
        connection.expires = min(expires, self.clock() + 300)
        connection.code = confirmation_code(connection.noise.handshake_hash)
        await self._send_frame(connection, {"type": "approval_required", "code": connection.code})

    async def _forward(self, connection, id, iterator):
        try:
            async for frame in iterator:
                await self._send_frame(connection, frame)
        except asyncio.CancelledError:
            raise
        except Exception:
            await self._close_connection(connection.id, notify=True)
        finally:
            await iterator.aclose()
            connection.followers.pop(id, None)

    async def _application(self, connection, message):
        frame = json.loads(connection.noise.decrypt(message))
        if not isinstance(frame, dict):
            raise HostError("invalid_frame")
        if not connection.approved or not self.authorized(connection.device_id):
            raise HostError("approval_required")
        if frame.get("type") == "revoke_self":
            await self._revoke(connection.device_id, acknowledge=connection)
            return
        id = frame.get("id")
        try:
            uuid(id)
            if id in connection.followers:
                raise BridgeError("request_in_progress")
            if len(connection.followers) >= 16:
                raise BridgeError("bridge_capacity")
            if frame.get("type") == "resume":
                iterator = self.bridge.resume(id, frame.get("after_seq"), connection.device_id)
            else:
                if frame.get("type") == "request":
                    raw = frame.get("body", "")
                    if not isinstance(raw, str):
                        raise BridgeError("invalid_body")
                    try:
                        body = base64.b64decode(raw, validate=True)
                    except ValueError:
                        raise BridgeError("invalid_body") from None
                    assembled = {
                        "id": id,
                        "method": frame.get("method"),
                        "path": frame.get("path"),
                        "headers": frame.get("headers"),
                        "body": body,
                    }
                else:
                    assembled = connection.uploads.accept(frame)
                if assembled is None:
                    return
                iterator = self.bridge.request(**assembled, device_id=connection.device_id)
            connection.followers[id] = asyncio.create_task(self._forward(connection, id, iterator))
            # Start the bridge submission before accepting a queued socket close.
            # Once a complete request is received, only its follower is disposable.
            await asyncio.sleep(0)
        except (BridgeError, HostError) as exc:
            await self._send_frame(connection, {"type": "error", "id": id, "code": str(exc)})

    async def receive(self, message):
        """Process one authenticated Relay control/binary frame in wire order."""
        if isinstance(message, str):
            if len(message) > 2048:
                raise HostError("invalid_control")
            frame = json.loads(message)
            if frame.get("type") == "open":
                await self._open(frame)
            elif frame.get("type") == "close":
                await self._close_connection(uuid(frame["connection_id"]))
            else:
                raise HostError("invalid_control")
            return
        if not isinstance(message, bytes) or not 16 < len(message) <= MAX_NOISE_FRAME + 16:
            raise HostError("invalid_frame")
        id = str(UUID(bytes=message[:16]))
        connection = self.connections.get(id)
        if connection is None:
            raise HostError("unknown_connection")
        try:
            self._budget(connection, len(message) - 16)
            if connection.noise.finished:
                await self._application(connection, message[16:])
            else:
                await self._handshake(connection, message[16:])
        except Exception:
            await self._close_connection(id, notify=True)

    async def _close_connection(self, id, *, notify=False):
        connection = self.connections.pop(id, None)
        if connection is None:
            return
        current = asyncio.current_task()
        tasks = [task for task in connection.followers.values() if task is not current]
        if connection.timer and connection.timer is not current:
            tasks.append(connection.timer)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        connection.uploads.items.clear()
        connection.noise.close()
        if notify and self.socket:
            try:
                await self._wire_send(json.dumps({"type": "close", "connection_id": id}))
            except Exception:
                pass

    async def _run(self):
        if self.connector is None:
            from websockets.asyncio.client import connect

            def connector(url):
                return connect(
                    url,
                    origin=None,
                    proxy=None,
                    max_size=65552,
                    max_queue=32,
                    open_timeout=10,
                    close_timeout=5,
                )
        else:
            connector = self.connector
        relay = self.config["relay"]
        url = (
            ("wss" if relay.startswith("https:") else "ws")
            + relay[relay.index(":") :]
            + "/v1/socket"
        )
        backoff = 1
        while not self._stopped:
            try:
                async with connector(url) as socket:
                    self.socket = socket
                    await self._wire_send(
                        json.dumps({"role": "host", "token": self.config["host_token"]})
                    )
                    greeting = await asyncio.wait_for(socket.recv(), 5)
                    if not isinstance(greeting, str) or json.loads(greeting) != {"type": "ready"}:
                        raise HostError("relay_not_ready")
                    self.connected = True
                    backoff = 1
                    async for message in socket:
                        await self.receive(message)
            except asyncio.CancelledError:
                break
            except Exception:
                pass  # Never log socket URLs, handshake bodies or credentials.
            finally:
                self.connected = False
                self.socket = None
                for id in list(self.connections):
                    await self._close_connection(id)
            if not self._stopped:
                await asyncio.sleep(backoff)
                backoff = min(30, backoff * 2)

    async def _health(self):
        while not self._stopped:
            try:
                if self.le_probe is None:
                    from python.providers.le import LEProvider

                    result = await asyncio.wait_for(LEProvider().health_check(), 5)
                else:
                    result = await asyncio.wait_for(self.le_probe(), 5)
                status = result.get("status")
                self.le = {
                    "status": status if status in {"ok", "offline", "unauthorized"} else "unknown"
                }
            except Exception:
                self.le = {"status": "offline"}
            await asyncio.sleep(30)

    async def start(self):
        """Call only after the shared Runtime lifespan has started."""
        if self._stopped:
            raise HostError("host_stopped")
        if self._runner is not None:
            return
        self.runtime = True
        self._runner = asyncio.create_task(self._run())
        self._health_task = asyncio.create_task(self._health())

    async def stop(self):
        self._stopped = True
        self.runtime = False
        self.connected = False
        for task in (self._runner, self._health_task):
            if task:
                task.cancel()
        await asyncio.gather(
            *(t for t in (self._runner, self._health_task) if t), return_exceptions=True
        )
        for id in list(self.connections):
            await self._close_connection(id)
        await self.bridge.aclose()
