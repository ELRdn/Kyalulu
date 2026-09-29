"""Standard Noise XX adapter. Authentication is not enrollment or bridge approval.

Dependencies: noiseprotocol==0.3.1, cryptography==50.0.1 (validated versions).
No custom Noise, key derivation, cipher, nonce, or REKEY implementation.
The caller enforces session age/byte budgets and renews via a fresh XX handshake.
"""
from __future__ import annotations

import hmac

from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from noise.connection import Keypair, NoiseConnection

PROTOCOL = b"Noise_XX_25519_ChaChaPoly_SHA256"
MAX_MESSAGE = 65535
MAX_PLAINTEXT = MAX_MESSAGE - 16
MAX_HANDSHAKE_PAYLOAD = 1024
# Defense in depth. Normal 64 MiB / Client 9 min, Host 10 min renewal is earlier.
MAX_TRANSPORT_FRAMES = 1 << 20


class RemoteCryptoError(ValueError):
    """The session is unusable; create a new one rather than retrying a frame."""


def _bytes(value: bytes, name: str, *, length: int | None = None) -> bytes:
    if not isinstance(value, bytes) or (length is not None and len(value) != length):
        raise RemoteCryptoError(f"Invalid {name}")
    return value


def generate_keypair() -> tuple[bytes, bytes]:
    key = X25519PrivateKey.generate()
    return key.private_bytes_raw(), key.public_key().public_bytes_raw()


class NoiseSession:
    """Three-message XX, followed by ordered authenticated transport.

    Initiators MUST supply expected_peer (the trusted Host public key).
    Responders may omit it only for initial pairing; registered reconnects must
    supply the stored client public key. Only m3 may carry a handshake payload.
    Getters return b'' before available or after close. Call sequentially.
    """

    def __init__(self, private_key: bytes, initiator: bool,
                 expected_peer: bytes | None, prologue: bytes):
        _bytes(private_key, "private key", length=32)
        _bytes(prologue, "prologue")
        if len(prologue) > MAX_MESSAGE or not isinstance(initiator, bool):
            raise RemoteCryptoError("Invalid session options")
        if expected_peer is not None:
            _bytes(expected_peer, "peer key", length=32)
        if initiator and expected_peer is None:
            raise RemoteCryptoError("Initiator requires a pinned Host key")
        self._expected = expected_peer
        self._initiator = initiator
        self._step = 0
        self._peer_key = b""
        self._handshake_hash = b""
        self._finished = False
        self._closed = False
        self._sent = 0
        self._received = 0
        self._noise: NoiseConnection | None = None
        try:
            noise = NoiseConnection.from_name(PROTOCOL)
            self._noise = noise
            if initiator:
                noise.set_as_initiator()
            else:
                noise.set_as_responder()
            noise.set_prologue(prologue)
            noise.set_keypair_from_private_bytes(Keypair.STATIC, private_key)
            noise.start_handshake()
        except Exception as exc:
            self.close()
            raise RemoteCryptoError("Noise initialization failed") from exc

    @property
    def finished(self) -> bool:
        return self._finished and not self._closed

    @property
    def peer_key(self) -> bytes:
        return self._peer_key

    @property
    def handshake_hash(self) -> bytes:
        return self._handshake_hash

    def close(self) -> None:
        # Python/library immutable copies are managed by the runtime; no claim
        # of guaranteed erasure. No cipher state is exposed for resumption.
        self._noise = None
        self._expected = None
        self._peer_key = b""
        self._handshake_hash = b""
        self._finished = False
        self._closed = True

    def _active(self, *, transport: bool) -> NoiseConnection:
        if self._closed or self._noise is None or self.finished != transport:
            raise RemoteCryptoError("Invalid Noise session state")
        return self._noise

    def _turn(self, writing: bool) -> NoiseConnection:
        noise = self._active(transport=False)
        should_write = (self._step % 2 == 0) == self._initiator
        if self._step >= 3 or should_write != writing:
            raise RemoteCryptoError("Invalid handshake order")
        return noise

    def _advance(self, noise: NoiseConnection) -> None:
        self._step += 1
        if noise.handshake_finished:
            if not self._peer_key or self._step != 3:
                raise RemoteCryptoError("Missing authenticated peer")
            self._handshake_hash = bytes(noise.get_handshake_hash())
            self._finished = True

    def write(self, payload: bytes = b"") -> bytes:
        try:
            noise = self._turn(writing=True)
            _bytes(payload, "handshake payload")
            if (self._step != 2 and payload) or len(payload) > MAX_HANDSHAKE_PAYLOAD:
                raise RemoteCryptoError("Only m3 may contain a bounded payload")
            message = bytes(noise.write_message(payload))
            if len(message) > 96 + MAX_HANDSHAKE_PAYLOAD:
                raise RemoteCryptoError("Handshake frame too large")
            self._advance(noise)
            return message
        except Exception as exc:
            self.close()
            raise RemoteCryptoError("Noise handshake write failed") from exc

    def read(self, message: bytes) -> bytes:
        try:
            noise = self._turn(writing=False)
            _bytes(message, "handshake frame")
            if len(message) > MAX_MESSAGE:
                raise RemoteCryptoError("Handshake frame too large")
            # noiseprotocol 0.3.1 drops its handshake_state on Split. Keep this
            # reference only during the call to read the authenticated peer.
            state = noise.noise_protocol.handshake_state
            payload = bytes(noise.read_message(message))
            if (self._step != 2 and payload) or len(payload) > MAX_HANDSHAKE_PAYLOAD:
                raise RemoteCryptoError("Unexpected handshake payload")
            if self._step in (1, 2):
                peer = bytes(state.rs.public_bytes)
                if self._expected is not None and not hmac.compare_digest(peer, self._expected):
                    raise RemoteCryptoError("Peer key mismatch")
                self._peer_key = peer
            self._advance(noise)
            return payload
        except Exception as exc:
            self.close()
            raise RemoteCryptoError("Noise handshake read failed") from exc

    def encrypt(self, plaintext: bytes) -> bytes:
        try:
            noise = self._active(transport=True)
            _bytes(plaintext, "plaintext")
            if len(plaintext) > MAX_PLAINTEXT or self._sent >= MAX_TRANSPORT_FRAMES:
                raise RemoteCryptoError("Transport limit; reconnect")
            message = bytes(noise.encrypt(plaintext))
            self._sent += 1
            return message
        except Exception as exc:
            self.close()
            raise RemoteCryptoError("Noise encrypt failed") from exc

    def decrypt(self, ciphertext: bytes) -> bytes:
        try:
            noise = self._active(transport=True)
            _bytes(ciphertext, "ciphertext")
            if not 16 <= len(ciphertext) <= MAX_MESSAGE or self._received >= MAX_TRANSPORT_FRAMES:
                raise RemoteCryptoError("Transport limit; reconnect")
            plaintext = bytes(noise.decrypt(ciphertext))
            self._received += 1
            return plaintext
        except Exception as exc:
            self.close()
            raise RemoteCryptoError("Noise decrypt failed") from exc
