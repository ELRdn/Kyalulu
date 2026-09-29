# Kyalulu Remote — encrypted Relay / Host / Android PWA

Status: implemented development candidate, **not an approved v1.0.0 release**.
Android physical-device testing, real Gemma acceptance, production TLS/operations,
24-hour endurance and external security review are release gates. Nothing is
automatically deployed, registered at Windows startup, or migrated by installing
this source tree.

## What runs where

The PWA and Host each open outbound WSS to Relay. Host runs the existing Runtime
and retains the character library, SQLite history and memories; LE runs separately.
Relay stores owner/device routing metadata and token hashes, never Noise keys,
conversation text or an offline message queue. One owner may have two Hosts and
five approved mobile devices. A mobile registration belongs to one Host; another
Host needs its own QR registration. Switching Hosts does not synchronize history.

The original [direct HTTPS PWA](ANDROID_PWA.md) remains supported. Remote adds a
transport, not cloud inference. PC sleep/offline means unavailable. There is no
automatic cloud fallback, inference purchase, push notification or P2P.

## Set up Relay and the PWA

Use the [deployment/operator guide](../deploy/remote/README.md) for one Linux VPS,
two real DNS names and Caddy. Initial target budget is JPY 3,000/month; this is a
budget, **not a verified provider quote**. Include transfer, backup and domain
charges before contracting. Deployment and purchase need explicit operator action.

Build the managed PWA with the exact Relay origin (example names only):

```powershell
pnpm install --frozen-lockfile
$env:VITE_RELAY_ORIGIN = 'https://relay.example.com'
pnpm --filter web build
Remove-Item Env:VITE_RELAY_ORIGIN
```

Serve the generated `apps/web/dist` on the APP domain. Keep the Relay origin
matching Caddy `RELAY_DOMAIN`. A managed build refuses an unconfigured or different
Relay. Direct/Desktop builds omit `VITE_RELAY_ORIGIN`. Do not deploy Vite's dev
server. Its loopback HTTP exception is only for local acceptance tests.

## Register and run a PC Host

Install the pinned optional dependencies:

```powershell
uv sync --frozen --all-packages --all-extras
```

Create a one-use invitation using the Relay operator CLI. On the PC, register from
an interactive terminal; the invitation is entered without echo and is never a
command-line argument:

```powershell
.venv/Scripts/python.exe scripts/remote_host.py register --invite `
  --relay https://relay.example.com --app-origin https://app.example.com `
  --vault .artifacts/remote-host/host.vault --data-dir .artifacts/remote-host/data

.venv/Scripts/python.exe scripts/remote_host.py serve `
  --vault .artifacts/remote-host/host.vault --data-dir .artifacts/remote-host/data
```

These paths are for evaluation. Choose a durable backed-up directory for real
operation. On Windows the vault is protected by current-user DPAPI; run Host and
its logon task under that same Windows user. On POSIX, vault files require 0600
permissions. Neither mechanism protects against malicious code already running
with that user's privileges. Vault loss requires Host/device re-enrollment.

Host binds its management/Runtime HTTP listener to **127.0.0.1:8766 only**. No PC
inbound firewall rule is necessary. LE must run independently so closing Desktop
does not stop an LE child that Desktop owns.

To use the existing Desktop renderer with this Host, launch Desktop with
`KYALULU_API_BASE=http://127.0.0.1:8766`. A healthy pre-existing API is treated as
external and left alive on Desktop exit. For local Web development, instead set
`KYALULU_API_URL=http://127.0.0.1:8766` before starting Vite; do not set
`VITE_RELAY_ORIGIN` for this PC management UI.

### Use existing conversations, without moving them

Stop **all** old Runtime/Desktop instances that use that data directory first.
Check the actual directory: packaged Desktop and development use different paths.
Run registration with the same `--data-dir` plus **`--adopt-existing-data`**.
The CLI creates a SQLite backup and marks ownership without moving or replacing
the existing DB. Preserve the library assets alongside the DB in your own backup.
Current Runtime versions share an OS-released directory lock and refuse concurrent
use. Older already-running versions do not know that lock; stop them first.

The implementation/test run does not perform this adoption on your real data.

### Pair Android

1. In the PC's Profile/settings screen, open **このPCから、会話を持ち歩く**.
2. Choose **スマホを登録する**, and scan the QR with Android's camera.
3. The PWA removes the registration fragment from the URL immediately. Enter a
   mobile device name and choose **このPCに登録する**.
4. Enter the six-digit code displayed on the phone into the PC approval screen.
5. Choose **会話を開く** on Android and install the PWA from Chrome.

The QR expires within five minutes and can authorize one enrollment only. It
contains a Host public-key pin plus an enrollment secret; treat it as private.
Relay ticket redemption alone never grants access to Runtime APIs. Noise identity,
one-use secret validation and local PC approval are required.

The PC settings screen can revoke each mobile device and disconnect active access.
Deleting a phone's locally stored key requires re-registration but is not the same
as revoking the server-side registration. Use PC revocation for a lost device.

Optional Windows logon startup is explicit:

```powershell
.venv/Scripts/python.exe scripts/remote_host.py autostart --enable-autostart `
  --vault .artifacts/remote-host/host.vault --data-dir .artifacts/remote-host/data
```

It registers a per-user hidden `pythonw.exe` task, does not immediately run it,
and does not overwrite an existing task. Remove it in Task Scheduler to disable
logon startup. **Remote接続を停止** closes access and shuts down this Host's bridge;
restart the Host process to re-enable it. It does not kill an independently owned LE.

## Security and recovery contract

- Standard `Noise_XX_25519_ChaChaPoly_SHA256`: `noise-c.wasm@0.4.0` in the browser,
  `noiseprotocol==0.3.1` / `cryptography==50.0.1` in Python. Dependencies are pinned.
  [Crypto evidence and limitations](../scripts/remote_crypto_stage_a.md).
- Registered static keys are pinned; changed keys require re-enrollment. Each
  connection binds owner, Host and device IDs in the authenticated prologue.
- Optional in-session REKEY is not used. Fresh pinned XX handshakes renew sessions
  before the byte/time limits (64MiB; client nine minutes, Host ten minutes).
  Authentication failures discard the cipher state; no nonce reset/retry occurs.
- This WASM wrapper is archived upstream. Successful interoperability/internal
  tests do **not** replace the external security review required before a public
  release. The rejected alternative and unsupported REKEY evidence are retained.
- E2EE hides payload from Relay but not IPs, times, endpoints or transfer sizes.
  A compromised PWA distributor or endpoint can capture plaintext; E2EE does not
  establish protection against that threat. PWA uses only same-origin application
  code, system fonts and a restrictive CSP, with no third-party scripts.
- Relay-origin credentials never grant localhost administrator authority. An
  internal typed principal, a live revocation check, exact API allowlist and scoped
  session validation apply before Runtime execution. No arbitrary URL forwarding.
- Browser API calls, media and downloads use the encrypted transport. Images are
  temporary Blob URLs, released on unmount; third-party portrait URLs are not
  fetched in Remote mode. SW caches explicit public build assets including WASM,
  never API responses, private images, conversation data or keys.
- Phone keys are in IndexedDB. Drafts/reply variants are device-local storage,
  separated by Relay/owner/Runtime/session. This is not encrypted-at-rest storage
  for a phone shared with other people. Changing Host reloads the application to
  discard old in-flight view state.
- A transport disconnect does not cancel an accepted generation. Reconnect
  performs Noise again, then resumes by request ID/sequence. Host retains five
  minutes / 2MiB per stream, with a global 32MiB bound; gaps fall back to durable
  generation status/history, never automatic submission.
- Generation IDs remain durable idempotency keys. General HTTP-shaped request IDs
  are bounded transport/replay identifiers, not permanent idempotency for every
  mutation. Ambiguous imports/edits must be inspected rather than automatically
  repeated. Host restart marks interrupted generation appropriately.
- Upload bodies are bounded to 16MiB including multipart encoding. Runtime format
  limits still apply. Slow peers are disconnected, not buffered without limit.

## Verification

```powershell
pnpm typecheck
pnpm --filter web test
pnpm --filter web build
pnpm --filter desktop build
.venv/Scripts/python.exe -m pytest tests -q
.venv/Scripts/python.exe tests/e2e_remote.py
node scripts/remote_crypto_build_wrapper.mjs
.venv/Scripts/python.exe scripts/remote_crypto_wrapper_interop.py
.venv/Scripts/python.exe scripts/remote_acceptance.py --duration 60
# Long, isolated loopback run; no real model or user's database:
.venv/Scripts/python.exe scripts/remote_acceptance.py --duration 86400
```

`e2e_remote.py` exercises the actual PWA/Noise/Relay/Host/Runtime with isolated
data and Mock inference. `remote_acceptance.py` tests bounded opaque routing for
10 owners/50 clients, backup/restore and limits; it does not measure AI quality or
real-network rendering latency. Windows DPAPI tests require the normal user's
profile, which some sandboxes do not expose. Do not silently substitute plaintext
vault storage when DPAPI fails.

See [the implementation validation record](validation/2026-09-29-remote.md) for
measured results and remaining release gates.
