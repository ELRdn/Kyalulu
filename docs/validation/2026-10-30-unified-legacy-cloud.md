# Legacy Cloud origin retirement

This is code and loopback evidence, not a production change. The outstanding
production-backup approval has not been extended to stopping services, retrieving
keys or deploying this configuration. No production account or data was modified.

## Current public delivery

Anonymous public GETs at 2026-10-30 00:36 UTC returned 200 from App, Cloud and
Mobile roots. App `/device/`, `/migration/`, `/api/health` and `/auth/callback`
returned 404. The latter request carried no code. `local.kyalulu.com` failed DNS
resolution from this PC; that does not establish global DNS absence. The roots
have distinct body hashes. Mobile alone had COOP/COEP isolation headers.

An additional Cloud `/sw.js` GET returned JavaScript, SHA-256
`a9b9fef2c433aa95f60b60aa85ed90378922e6844159a1ee127214947816310e`.
Lexical markers show install/activate/fetch/message, cache and skipWaiting/claim
behavior. This is not browser execution of the production Worker. `/registerSW.js`
returned the root HTML, consistent with the old SPA fallback. Detailed public
header/hash observations are retained privately under
`.artifacts/unified-public-origins-20261030/`; no cookies or OAuth values were used.

## Implementation

`deploy/cloud/Caddyfile.cloud-migration.example` provides the old-host half of the
canonical cutover. It must replace the old Cloud site only when the canonical
Runtime and OAuth origin have been selected; keep Relay/global no-log settings.
The entry page has Japanese/English re-login guidance and a literal canonical link.
It neither reflects incoming parameters nor redirects. Old APIs, callbacks and
other requests return 410 JSON. No Runtime receives old cookies, codes or bodies.

The old-host `/sw.js` is a small network-only retirement Worker. It accepts only
the existing explicit `APPLY_UPDATE` message from an in-scope window, blocks a
second window and preserves every cache/private store. It does not skip waiting
at install. An accepted update claims clients and stops returning cached shells;
fetches stay on the old origin with redirects forbidden. Before applying this
update an old tab can still display its cached shell; server-side APIs are closed.

The document CSP prohibits scripts/connections. The Worker has a separate
same-origin connection policy. A real proxy check caught the general header
overwriting that Worker policy; the general CSP now excludes `/sw.js`. Each
response has exactly one CSP. The bundle includes this config only in unified
mode, and corresponding source/fingerprint coverage includes the new input.

## Verification

- Packaging, source closure and source-fingerprint suites: **39 passed**.
- Actual **Caddy 2.10.2** and Chromium: expanded `tests/e2e_unified_proxy.py` passed
  all **16 boolean delivery assertions** with zero page errors, CSP violations or
  external requests. The executable SHA-256 is
  `586d4a4cd74bdfd2951b6b81766a32904ffa69c4f1c3d521da3870a2120f1d31`.
- Private fixture CA and leaf SPKI pins cover distinct loopback hostnames;
  OS trust is unchanged. App/Device/Mobile-migration documents, actual inference
  Worker isolation and closed commercial/region gates retain their prior checks.
- Four old navigation URLs omit Location/Set-Cookie/Clear-Site-Data and do not echo
  fictional query/cookie/bearer markers. Four methods across four old API/callback
  paths return exactly 410 with the canonical link and no forwarding/redirect.
- A **fictional cache-first predecessor**, not the actual production Cloud shell,
  proves update waiting, unknown-message refusal, another-tab refusal and explicit
  activation. Old-host POST reaches 410 after activation. IndexedDB outbox/body,
  localStorage draft, OPFS original and the old cache content compare equal after
  reload into the real migration page. The link opens the exact canonical root;
  the old HttpOnly cookie is absent on the other hostname.
- The 393px migration screenshot was inspected. Test-owned proxy/Runtime/browser
  processes were stopped. Evidence: `.artifacts/unified-cloud-migration-https-20261030-final/`.

Public TLS/DNS/Caddy/OAuth changes, actual old Cloud UI update controls, Android/
iPhone, full old-browser data and production cutover remain unverified. The accepted
897737f image predates this template and the later admin fixes. Do not reuse its
image acceptance as evidence for a newly packaged candidate. The independent
backup operator package remains unchanged; it does not deliver this site config.


## Follow-up: managed Relay must survive packaging

A fresh clean 5ace6a7 Cloud build used the explicit existing managed Relay origin.
It produced 66,044,982 bytes, SHA-256
`67803314f9f1a1c72dbe8910e699424ab548dd51f0982c5666ec8cb737003389`.
All **224** manifest files, **61** precache hashes and **580** raw-equal committed
source files were checked; its source archive has **805** files. Runtime Python
bytes match 897737f, but Web bytes do not. This is an intermediate local candidate,
not an accepted Linux image or a production selection.

Inspection of the older 897737f JavaScript found no compiled managed Relay URL;
the freshly configured build contains it. Since production `relayOrigin()` rejects
unconfigured Remote registration and `RemoteSetup` hides its managed entry, the
older artifact must not be selected as a complete three-target delivery. Its prior
image/hash checks did not prove this feature. No production change was made.

Unified production builds now reject an absent or non-exact HTTPS Relay origin.
Legacy/Mobile builds and development remain available. The error does not print
the configured value. **11** config tests cover absent/malformed/path/query/
credential/HTTP/WebSocket values, the valid origin and unaffected modes. Typecheck
and all **866 Web tests / 67 files** passed. An actual Vite invocation with no
Relay setting exited 1 before changing an existing fictional output index.
Corresponding source includes the
new config tests and explicit build-environment instructions.

The clean configured 5ace6a7 Web build passed the expanded HTTPS check with **17**
boolean assertions, including the actual unregistered-PC heading and destinations
region. Zero external requests were made; no real PC pairing is claimed.
Evidence is under `.artifacts/unified-cloud-migration-managed-relay-20261030/`.
The build guard is a later source change; the intermediate 5ace6a7 archive does
not contain it. Regenerate/fix the final candidate before image selection.
