# Bounded browser Runtime communication privacy — 2026-10-31

Validated in the shared `D:/VibeCoding/my zeta` checkout on
`codex/unified-app-integration`, inspected HEAD
`65cb1b8cee3bdec9ba1efb1f7ef282d4285b2309`.
Only the following three source files belong to this change:

- `tests/e2e_runtime_privacy.py`
- `tests/fixtures/runtime-privacy.html`
- `docs/validation/2026-10-31-unified-runtime-privacy.md`

No product fix was needed. Existing dirty files, including the lockfile and
`idbHarness.test-support.ts`, were preserved. No commit, push, production request,
provider login, private credential or real model was used. Parent-owned Remote
generation/switching tests and Windows CI diagnosis remain separate.

## What this adds

The existing transport tests already reject an unselected PC and PC-only
enrollment routes; RemoteRpc unit tests already check its header allowlist.
This driver reuses `browser_fixture_server.local_vite`, `e2e_remote.MemoryVault`
and `port`, the real Relay/Host/Noise implementation, and the existing
`DeviceResearch.browser-fixture` actual-app mount helper (including its
`prepareRuntime`).
It adds browser evidence across those boundaries rather than another mocked
transport unit test or another pairing UI test.

1. An isolated Chromium context receives a fictional HttpOnly Cloud cookie.
   Explicit same-origin Cloud profile requests before and after Remote Runtime
   calls positively verify that cookie, a fictional bearer and the Cloud owner
   header are actually present. These two Cloud responses are intercepted locally.
2. Actual browser enrollment, pinned Noise handshake, explicit Host approval and
   real encrypted Remote `/api/health` and `/api/chat/sessions` calls succeed.
   The Host captures the decrypted envelopes **before** its second header filter:
   only `accept` and `content-type` arrive. Four canaries (bearer, cookie, owner,
   CSRF) are absent from both those envelopes and Relay HTTP/WebSocket handshake
   headers. The Relay is `localhost`; the browser is `127.0.0.1`, because cookies
   are host scoped, not port scoped. No authentication values are printed.
3. With the Remote selection and Cloud cookie retained, the fixture explicitly
   closes that connection and mounts the actual Device App/RuntimeGate/Home,
   including its AdBanner. Real `apiFetch` routes memory save and a completed
   streamed turn into real IndexedDB. The existing synthetic model metadata/Worker
   supplies inference. The record remains `storage_policy=local`, has two messages,
   retains its manual memory and completed generation, and creates no sync outbox.
   A subsequent fictional external model ID returns **409**, with no Cloud fallback
   or extra persisted message. `syncNow` with no consent stays off. No ad slot or
   iframe appears.
4. All browser HTTP is guarded before navigation; only owned Vite assets, the two
   intercepted Cloud controls and owned Relay traffic are allowed. Any Device API
   HTTP, external request or new Device WebSocket fails the test. Service workers
   are blocked. The final result requires **zero blocked attempts and page errors**,
   not merely successful interception of forbidden requests. React effects are
   flushed before the final checks. Browser/context, Host, Relay thread and Vite
   cleanup are awaited; temporary fixture data is removed.

## Commands and results

From the repository root, PowerShell:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
.venv/Scripts/python.exe tests/e2e_runtime_privacy.py
```

**PASS, exit 0** on installed Chromium **151.0.7922.34** (build 1234): one combined
scenario, two decrypted Remote requests, two Cloud positive controls, zero Cloud
canaries at Remote, local completed generation and memory, external model 409,
consent false, outbox false, sync off, zero ad frames, zero blocked requests,
zero page errors. Owned server cleanup completed. The final browser run includes
the external-model refusal; an earlier successful run preceded that assertion.

From `apps/web`:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/transport.test.ts src/lib/remoteRpc.test.ts --pool threads --maxWorkers 1
```

**PASS, exit 0: 33 tests / 2 files.** Node emitted the existing experimental
localStorage warning. Initial browser attempts were not passes: sandbox Temp
permissions and fixture-only React/router import failures were corrected by
using a repository-local temporary directory and the existing mount helper.
No product behavior was weakened to make the fixture pass.

## Evidence limits

This is a development-source Chromium/loopback proof with fictional identities,
not deployed HTTPS/OAuth/provider acceptance. It captures the Remote envelope
before Host sanitization, but does not claim coverage of every API/body, browser,
cookie-domain configuration, extension or arbitrary script. The device inference
Worker and model-file metadata are synthetic; real inference, model download and
real Worker egress are not established here. The actual Device UI is English/Home,
not the complete language/screen/advertising matrix. No physical device is used.

`device` execution and `storage_policy=local` are not a universal network firewall:
the current transport deliberately keeps explicit Cloud/community APIs reachable,
and separately consented sync is supported. This test establishes **no automatic
Cloud/sync/external-AI/ad dispatch for the exercised local conversation with sync
consent absent**, including stale selected Remote state and a Cloud cookie. It
does not claim that an explicitly invoked Cloud API or newly consented sync is
blocked merely by selecting Device. Do not mark the entire delivery privacy row,
current-source CI or production acceptance complete from this bounded result.
