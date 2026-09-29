# Stage A Noise browser / Python interoperability

**Current status: PASS_BOUNDED_DEVELOPMENT_CANDIDATE.** The actual wrappers use
unmodified `noise-c.wasm@0.4.0` and `noiseprotocol==0.3.1`, tested with
`cryptography==50.0.1`, for standard `Noise_XX_25519_ChaChaPoly_SHA256`.
Production security review remains an external release gate.

Authoritative implemented API: `apps/web/src/lib/remoteCrypto.contract.md`.
Product files: `apps/web/src/lib/remoteCrypto.ts`, its narrow vendor declarations,
and `runtime/python/remote/crypto.py`. Python tests: `tests/test_remote_crypto.py`.

The accepted policy is bounded sessions: main enforces 64 MiB and Client 9 min /
Host 10 min, then a fresh pinned XX handshake with new ephemeral keys. Optional
in-session REKEY is deliberately unused. m3 carries caller-supplied authenticated
UTF-8 JSON, <=1024 bytes. Host pin is checked before Client sends m3; registered
Client pin is checked before Host returns m3 data. Pairing and bridge approval are
main-owned, not consequences of `finished`.

## Current acceptance

```powershell
node scripts/remote_crypto_build_wrapper.mjs
.venv/Scripts/python.exe scripts/remote_crypto_wrapper_interop.py
.venv/Scripts/python.exe -m pytest tests/test_remote_crypto.py -q
node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
```

The actual Vite production bundle ran in Chromium 151.0.7922.34 against Python
3.13.5. The isolated build uses main's installed production package when present,
with a pinned PoC fallback only before installation. No app manifest/lockfile/Git
mutation was performed by this crypto task.

Latest results: **31 Python tests, 27 real-browser check groups, Web and Desktop
typechecks passed**. The Vite build emits browser-externalization warnings for
unused Node branches (`crypto`, `fs`, `path`) in the upstream universal bundle;
the tested secure browser executes its WebCrypto/WASM branches successfully.

The browser report is `.artifacts/remote-v1/wrapper-interop-report.json`, with
source hashes. It covers pairing and reconnect, arbitrary context prologue,
authenticated m3 JSON, peer pins, matching transcript hash, empty/UTF-8/max-size
transport, wrong static keys, tamper/replay/reorder/truncation/oversize, invalid
state transitions, closure, and actual near-64-MiB bidirectional traffic followed
by a fresh pinned XX handshake. The budget driver accounts 67,108,032 bytes,
including handshake, below 67,108,864. Each direction sends 512 full-size frames.

That proves the crypto renewal workflow. Main's timers, policy enforcement,
manual approval, revoked registrations, secret expiry/single-use, DPAPI vault,
relay and bridge authorization need their own acceptance. This task does not
claim those are verified by the crypto test.

## Library qualification evidence retained

### Rejected clatterjs

`@lukeburns/clatterjs@1.0.0` initially passed XXpsk3/XX normal transport, but its
published cipher uses `0xfffffffffffffffn` (15 Fs, 2^60-1) for REKEY instead of
standard Noise's 2^64-1. Real browser / Python REKEY fails with
`NoiseInvalidMessage: Failed authentication of message`.

Public test vector (not a real identity/session key):

```text
input:   000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
Python:  50835543a205b22c9323f2022bc4f67d838f90e61d5ccf33c4513e01f85b5042
Browser: 08b0f66dc0b8649509b9d860db8b535a37487f0c795e09199a84e76a6d265074
```

`scripts/remote_crypto_library_probe.py` reproduces that historical failed
candidate and exits nonzero. `.artifacts/remote-v1/library-probe-report.json`
retains the evidence. Do not confuse that rejected candidate with the current
wrapper acceptance report.

### Adopted noise-c WASM, with explicit limitations

`noise-c.wasm@0.4.0` standard XX passed actual browser/Python transport and
negative tests. Its optional `CipherState.Rekey()` throws `Not implemented`,
and `_noise_cipherstate_rekey` is not exported in the compiled JS bundle.
`scripts/remote_crypto_wasm_probe.py` and
`.artifacts/remote-v1/wasm-probe-report.json` preserve the library-level finding.
The earlier REKEY-required gate was superseded by the user's explicit fresh-XX
renewal policy. No missing crypto was reimplemented or monkeypatched.

The wrapper repository is archived (GitHub last push 2021-01-09), and the package
pins upstream noise-c commit `40b64ab83d4ecfdbefcab319a91761507e9fb98c`. These are
production-review considerations, not standalone evidence of incompatibility or
an exploit. Memory erasure of all transient copies is not guaranteed by this
wrapper. The bounded tests found no further blocking crypto incompatibility;
they do not replace external security review.

Other initial candidates were surveyed: `noise-protocol@3.0.2` (no PSK modifiers),
`noise-handshake@4.2.0` (psk0 only), and libp2p-specific Noise. Their psk3/SHA256
mismatches were only limits of the initial preferred suite, **not user
requirements or permanent rejection of standard alternative suites**. No further
qualification of them was needed after the approved bounded XX candidate passed.
`@niomon/noise-js@2.0.1` returned an all-zero DH result for an all-zero remote key
in its published DH API; the isolated candidate probe records that concern.

Sources: [noise-c.wasm](https://github.com/nazar-pc/noise-c.wasm),
[noiseprotocol](https://github.com/plizonczyk/noiseprotocol), and the actual pinned
npm/PyPI distributions downloaded under the ignored PoC directory.

## Isolated dependency setup

Main owns product manifests/lockfiles. PoC dependencies can be installed only in
`.artifacts/remote-v1` (already ignored):

```powershell
npm.cmd install --prefix .artifacts/remote-v1 --cache .artifacts/remote-v1/npm-cache --registry https://registry.npmjs.org --no-save --package-lock=false --ignore-scripts --no-audit --no-fund noise-c.wasm@0.4.0
uv pip install --python .venv/Scripts/python.exe --target .artifacts/remote-v1/python --cache-dir .artifacts/remote-v1/uv-cache noiseprotocol==0.3.1 cryptography==50.0.1 cffi==2.1.1 pycparser==3.0
```

Tests use the project's existing Playwright installation and Vite/esbuild.
For Python unit tests before main installs production dependencies, set
`PYTHONPATH` to the absolute `.artifacts/remote-v1/python` directory.
Scripts close their isolated browser and loopback server. Reports never include
real credentials, random enrollment secrets, or random private test identities.
