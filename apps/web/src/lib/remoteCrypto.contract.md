# Remote crypto API — implemented bounded development candidate

Stage A status: **PASS_BOUNDED_DEVELOPMENT_CANDIDATE**. Production release still
requires the external security review and main-owned authorization/lifecycle
acceptance. Passing Noise does not authorize a pending pairing session.

Suite: `Noise_XX_25519_ChaChaPoly_SHA256`. Browser: `noise-c.wasm@0.4.0`.
Python: `noiseprotocol==0.3.1`, tested with `cryptography==50.0.1`.
These are unmodified existing Noise implementations; there is no homemade
handshake, cipher, key derivation, nonce implementation, or REKEY fallback.

## Implemented browser API

```ts
import { createNoise, generateKeypair } from './remoteCrypto';

const { privateKey, publicKey } = await generateKeypair(); // Uint8Array(32)
const session = await createNoise({
  privateKey,                  // bytes32; caller may decode stored hex
  expectedPeer: hostPublicKey, // bytes32 from trusted QR / stored registration
  prologue,                    // arbitrary Uint8Array, <=65535 bytes
});

session.write(payload?);       // Uint8Array, default empty; m1 then m3
session.read(message);         // Uint8Array; verifies pinned Host at m2
session.encrypt(plaintext);    // Uint8Array
session.decrypt(ciphertext);   // Uint8Array
session.finished;             // boolean
session.peerKey;               // Uint8Array copy
session.handshakeHash;         // Uint8Array copy
session.close();              // idempotent
```

After async creation, all methods are **synchronous**. The browser is the
initiator. The Host pin is mandatory. Input arrays are copied before awaiting
WASM initialization, so caller mutation cannot alter session configuration.
`peerKey` is empty before authenticated m2; `handshakeHash` is empty until m3
has been written. Both become empty on close. Returned getters are copies.

## Implemented Python API

```python
from python.remote.crypto import NoiseSession, generate_keypair, RemoteCryptoError

private_key, public_key = generate_keypair()  # bytes32
session = NoiseSession(
    private_key=private_key,
    initiator=False,
    expected_peer=registered_client_key,  # bytes32; None only for initial pairing
    prologue=prologue,                    # arbitrary bytes, <=65535
)
session.read(message)       # -> bytes
session.write(payload=b'')  # -> bytes
session.encrypt(plaintext)  # -> bytes
session.decrypt(ciphertext) # -> bytes
session.finished           # bool
session.peer_key           # bytes, empty before authentication/after close
session.handshake_hash     # bytes, empty before completion/after close
session.close()            # idempotent
```

Python can act as either role. An initiator cannot omit its Host pin. A responder
with `expected_peer=None` is suitable only for initial pairing; the caller must
supply the registered client key for reconnect. The adapter does not look up
registration, approval, expiry, revocation, or token state.

## Payloads and state

- Handshake: Client write m1 / Host read m1; Host write m2 / Client read m2;
  Client write m3 / Host read m3. Only m3 may have a nonempty payload.
- m3 payload is opaque bytes, **<=1024 bytes**. Main encodes authenticated
  enrollment JSON as UTF-8. The adapter neither invents a JSON schema nor treats
  an application secret as a Noise PSK. Reconnect m3 may carry main's JSON too.
- The complete Noise frame is authenticated and any expected static peer key is
  checked **before** `read` returns a payload. A Host pin mismatch closes Client
  before m3 can be sent. A registered Client pin mismatch closes Host before
  returning the enrollment payload.
- `finished` means the local handshake and pin check succeeded. It does not mean
  PC approval was granted. Client's local completion also does not prove Host
  accepted m3; wait for Host's authenticated application response.
- Main checks the one-time secret, pairing expiry, context, manual PC approval,
  and registered peer before authorizing ASGI/bridge access. Pending sessions
  must remain unauthorized. Relay ticket `token` is never a cryptographic key.
- Main supplies identical arbitrary prologue bytes on both sides, including
  owner/host/device context. The adapter does not hard-code or reinterpret it.
- Stored `privateKey` / `hostKey` strings are raw 32-byte keys encoded as 64 hex
  characters by main. Decode to bytes for this API. Keypair generation uses the
  library; supplying the stored private bytes imports the same identity.

## Bounds and renewal

Each operation handles one ordered Noise frame. Ciphertext <=65535 bytes;
transport plaintext <=65519 bytes. Invalid input, wrong call order, bad tag,
wrong pin, replay, or exceeded frame cap closes the session and invalidates its
public state. A closed session cannot resume. Call each session sequentially.

The explicit approved policy is **fresh XX**, not in-session REKEY:

- Main enforces **64 MiB total session ciphertext**, Client renewal at **9 min**,
  Host deadline at **10 min**; it closes and performs a new pinned XX handshake.
- The crypto adapter adds an independent **2^20 frames per direction** cap,
  many orders of magnitude below the cipher's nonce exhaustion boundary.
- There is no nonce setter, transport resumption, rekey, or static ephemeral key
  API. Every new session asks the library to generate fresh ephemeral keys.

The WASM library's optional `Rekey()` throws `Not implemented`; that fact remains
verified and is not claimed fixed. User explicitly approved fresh-session renewal.
Archive status is a production-review consideration, not itself a compatibility
failure. No additional blocking crypto incompatibility was found in the tested
bounded API. This is not a complete cryptographic audit.

## Evidence and scope

`tests/test_remote_crypto.py` validates the Python adapter. Build and run the
actual browser adapter with:

```powershell
node scripts/remote_crypto_build_wrapper.mjs
.venv/Scripts/python.exe scripts/remote_crypto_wrapper_interop.py
```

The actual Vite bundle is exercised in Chromium against the actual Python
adapter. Results are in `.artifacts/remote-v1/wrapper-interop-report.json`, with
source hashes. Checks cover arbitrary prologue, m3 JSON, peer pins and transcript,
max-size transport, wrong keys, tamper/replay/reorder/truncation, failures closing
sessions, and fresh pinned XX after actual near-64-MiB traffic.

The budget test sends 512 full ciphertext frames each way (67,108,032 accounted
bytes including handshake), then closes and creates a fresh XX session. It tests
crypto renewal under the approved budget, **not main's timer/relay enforcement**.
Manual approval, vault storage, secret consumption and real bridge authorization
remain main-owned integration gates. Native/JS/Python transient copies are
runtime-managed; the adapter does not claim guaranteed memory erasure.
