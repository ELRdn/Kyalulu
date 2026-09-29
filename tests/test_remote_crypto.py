"""Noise adapter regression tests. Install pinned dependencies before running."""
import secrets

import pytest

from python.remote.crypto import (
    MAX_PLAINTEXT, MAX_TRANSPORT_FRAMES, NoiseSession, RemoteCryptoError,
    generate_keypair,
)

PROLOGUE = b"kyalulu-remote-v1"


def sessions(*, pinned=True):
    a_sk, a_pk = generate_keypair()
    b_sk, b_pk = generate_keypair()
    a = NoiseSession(a_sk, True, b_pk, PROLOGUE)
    b = NoiseSession(b_sk, False, a_pk if pinned else None, PROLOGUE)
    return a, b, (a_sk, a_pk, b_sk, b_pk)


def handshake(a, b, payload=b""):
    assert b.read(a.write()) == b""
    assert a.read(b.write()) == b""
    assert not a.finished and not b.finished
    assert b.read(a.write(payload)) == payload
    assert a.finished and b.finished
    assert a.handshake_hash == b.handshake_hash
    assert len(a.handshake_hash) == 32


def assert_closed(session):
    assert not session.finished
    assert session.peer_key == session.handshake_hash == b""
    for operation in (lambda: session.write(), lambda: session.read(b""),
                      lambda: session.encrypt(b""), lambda: session.decrypt(bytes(16))):
        with pytest.raises(RemoteCryptoError):
            operation()
    session.close()
    session.close()


@pytest.mark.parametrize("pinned", [False, True])
def test_pairing_and_registered_reconnect(pinned):
    a, b, keys = sessions(pinned=pinned)
    secret = secrets.token_bytes(32) if not pinned else b""
    handshake(a, b, secret)
    assert (a.peer_key, b.peer_key) == (keys[3], keys[1])
    for plaintext in (b"", "暗号テスト".encode(), secrets.token_bytes(MAX_PLAINTEXT)):
        assert b.decrypt(a.encrypt(plaintext)) == plaintext
        assert a.decrypt(b.encrypt(plaintext)) == plaintext
    a.close()
    b.close()
    assert_closed(a)
    assert_closed(b)


def test_static_key_roundtrip_and_fresh_handshake():
    a, b, (a_sk, a_pk, b_sk, b_pk) = sessions()
    handshake(a, b)
    previous_hash = a.handshake_hash
    stale = a.encrypt(b"previous session")
    c = NoiseSession(bytes.fromhex(a_sk.hex()), True, bytes.fromhex(b_pk.hex()), PROLOGUE)
    d = NoiseSession(bytes.fromhex(b_sk.hex()), False, bytes.fromhex(a_pk.hex()), PROLOGUE)
    handshake(c, d)
    assert c.handshake_hash != previous_hash
    with pytest.raises(RemoteCryptoError):
        d.decrypt(stale)
    assert_closed(d)


@pytest.mark.parametrize("bad_side", ["host", "client"])
def test_wrong_static_key_pin_closes_before_payload_release(bad_side):
    a, b, (a_sk, a_pk, b_sk, b_pk) = sessions()
    wrong_sk, _ = generate_keypair()
    if bad_side == "host":
        b = NoiseSession(wrong_sk, False, a_pk, PROLOGUE)
    else:
        a = NoiseSession(wrong_sk, True, b_pk, PROLOGUE)
    b.read(a.write())
    if bad_side == "host":
        with pytest.raises(RemoteCryptoError):
            a.read(b.write())
        assert_closed(a)
    else:
        a.read(b.write())
        with pytest.raises(RemoteCryptoError):
            b.read(a.write(secrets.token_bytes(32)))
        assert_closed(b)


@pytest.mark.parametrize("attack", ["tamper", "replay", "reorder", "truncate", "oversize"])
@pytest.mark.parametrize("reverse", [False, True])
def test_transport_attacks_close(attack, reverse):
    a, b, _ = sessions()
    handshake(a, b)
    if reverse:
        a, b = b, a
    packet = a.encrypt(b"first")
    if attack == "tamper":
        packet = packet[:-1] + bytes([packet[-1] ^ 1])
    elif attack == "replay":
        assert b.decrypt(packet) == b"first"
    elif attack == "reorder":
        packet = a.encrypt(b"second")
    elif attack == "truncate":
        packet = packet[:8]
    else:
        packet = bytes(65536)
    with pytest.raises(RemoteCryptoError):
        b.decrypt(packet)
    assert_closed(b)


@pytest.mark.parametrize("step", [2, 3])
def test_handshake_tamper(step):
    a, b, _ = sessions(pinned=False)
    b.read(a.write())
    packet = b.write()
    victim = a
    if step == 3:
        a.read(packet)
        packet = a.write(secrets.token_bytes(32))
        victim = b
    packet = packet[:-1] + bytes([packet[-1] ^ 1])
    with pytest.raises(RemoteCryptoError):
        victim.read(packet)
    assert_closed(victim)


@pytest.mark.parametrize("operation", ["early_encrypt", "read_first", "double_write", "early_payload", "large_frame"])
def test_state_and_input_misuse_closes(operation):
    a, _, _ = sessions()
    with pytest.raises(RemoteCryptoError):
        if operation == "early_encrypt":
            a.encrypt(b"private")
        elif operation == "read_first":
            a.read(b"")
        elif operation == "double_write":
            a.write()
            a.write()
        elif operation == "early_payload":
            a.write(b"must not leak")
        else:
            a.write()
            a.read(bytes(65536))
    assert_closed(a)


@pytest.mark.parametrize("direction", ["send", "receive"])
def test_frame_limit_closes(direction):
    a, b, _ = sessions()
    handshake(a, b)
    if direction == "send":
        a._sent = MAX_TRANSPORT_FRAMES
        operation = lambda: a.encrypt(b"")
    else:
        a._received = MAX_TRANSPORT_FRAMES
        operation = lambda: a.decrypt(b.encrypt(b""))
    with pytest.raises(RemoteCryptoError):
        operation()
    assert_closed(a)


def test_invalid_constructor_inputs():
    private, public = generate_keypair()
    for args in ((private, True, None, PROLOGUE), (private[:-1], False, None, PROLOGUE),
                 (private, True, public[:-1], PROLOGUE), (private, True, public, "text")):
        with pytest.raises(RemoteCryptoError):
            NoiseSession(*args)


def test_prologue_mismatch():
    a, _, (_, a_pk, b_sk, _) = sessions()
    b = NoiseSession(b_sk, False, a_pk, b"different context")
    b.read(a.write())
    with pytest.raises(RemoteCryptoError):
        a.read(b.write())
    assert_closed(a)


def test_zero_ephemeral_key():
    _, b, _ = sessions(pinned=False)
    b.read(bytes(32))
    with pytest.raises(RemoteCryptoError):
        b.write()
    assert_closed(b)


def test_oversized_plaintext_closes():
    a, b, _ = sessions()
    handshake(a, b)
    with pytest.raises(RemoteCryptoError):
        a.encrypt(bytes(MAX_PLAINTEXT + 1))
    assert_closed(a)


@pytest.mark.parametrize("size", [1024, 1025])
def test_m3_payload_boundary(size):
    a, b, _ = sessions(pinned=False)
    b.read(a.write())
    a.read(b.write())
    if size == 1024:
        assert b.read(a.write(bytes(size))) == bytes(size)
    else:
        with pytest.raises(RemoteCryptoError):
            a.write(bytes(size))
        assert_closed(a)


def test_oversized_inbound_m3_from_standard_library_closes():
    # The peer is a raw standard library, so it does not share our payload cap.
    from noise.connection import NoiseConnection, Keypair
    private, _ = generate_keypair()
    host_private, _ = generate_keypair()
    peer = NoiseConnection.from_name(b"Noise_XX_25519_ChaChaPoly_SHA256")
    peer.set_as_initiator()
    peer.set_prologue(PROLOGUE)
    peer.set_keypair_from_private_bytes(Keypair.STATIC, private)
    peer.start_handshake()
    host = NoiseSession(host_private, False, None, PROLOGUE)
    host.read(bytes(peer.write_message()))
    peer.read_message(host.write())
    with pytest.raises(RemoteCryptoError):
        host.read(bytes(peer.write_message(bytes(1025))))
    assert_closed(host)
