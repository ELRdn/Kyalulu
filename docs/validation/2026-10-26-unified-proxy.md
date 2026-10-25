# Canonical HTTPS delivery through Caddy

This is implementation and loopback evidence, not a production cutover.
No DNS, Pages deployment, VPS configuration, production database or OAuth
allowlist was changed. Commercial, adult and unaccepted regional gates stay closed.

## Production observations

Anonymous HTTPS GETs confirmed the current separation:

| URL | Observed status |
|---|---|
| `https://app.kyalulu.com/` | 200, legacy Remote CSP |
| `https://app.kyalulu.com/api/cloud/status` | 404 |
| `https://app.kyalulu.com/device/` | 404, no isolation headers |
| `https://app.kyalulu.com/migration/` | 404 |
| `https://mobile.kyalulu.com/migration/` | 404 with the old isolated policy |
| `https://cloud.kyalulu.com/api/cloud/status` | 200, existing private test; billing/ads unavailable |

The old Mobile response does not prove a usable migration document. Canonical
API routing, OAuth/origin changes, migration publication and browser data/key
preservation must be accepted before a real cutover.

## Changes

- Cloud now reuses the existing Native `WebDist` handler for static delivery.
  Missing JS/images and private paths no longer receive the main application.
  Missing nested `/device/` or `/migration/` paths cannot fall back to that shell.
  Both runtimes retain the deliberate document-specific isolation policies.
- An additional real inference-Worker startup check exposed missing worker COEP
  and a conflicting main CSP. Runtime now isolates the exact built worker entry;
  Caddy leaves its CSP to Runtime. Pages, Vite development and preview also apply
  the worker policy. Header changes contribute to the Service Worker cache version
  so explicit update replaces previously cached unisolated worker responses.
- Cloud preserves default private `no-store` API behavior and adds `no-transform`
  to non-API responses, including HTML and the worker. Worker scope is explicit.
  Missing device/migration builds still return the existing closed 503 errors.
- `Caddyfile.unified.example` proxies the entire canonical origin without
  rewriting Host/Origin. The main CSP allows the pinned Relay; document-specific
  device/migration CSP is left to Runtime. There is one CSP per document.
  Third-party frames remain disabled pending an accepted advertising connection.
- Unified Cloud packaging includes this Caddy example, while preserving the
  legacy example and default legacy build selection. Corresponding sources
  include the template and [cutover/recovery runbook](../UNIFIED_DEPLOYMENT.md).

## Evidence

- Related static/Cloud/Native/bundle/source regression set: **182 passed**.
  Local JUnit: `.artifacts/unified-proxy-regression.xml`.
- Final bundle set: **3 passed**, including an added check that the default
  legacy build/proxy selection remains unchanged (two cases overlap the set above).
- `tests/e2e_unified_proxy.py` passed with actual **Caddy 2.10.2** and a disposable
  Cloud Runtime on loopback HTTPS, serving the previously verified unified build.
  No frontend application code changed in this phase.
- The Windows tool came from the official `v2.10.2` release and was checked using
  its published **SHA-512** manifest before execution. Binary SHA-256:
  `586d4a4cd74bdfd2951b6b81766a32904ffa69c4f1c3d521da3870a2120f1d31`.
- HTTP assertions verify the fixture CA and localhost hostname, exact HTML/worker
  bytes, one CSP, device isolation, neutral migration, worker scope/no-transform,
  missing/private-path denials, same-origin/unauthenticated rejection and closed
  commercial/region conditions. The disposable account, credit, funding,
  operation and secret tables remain empty.
- Actual Chromium loads the main shell, activates its Service Worker, opens the
  isolated Device UI and then the neutral migration page. English 393px has no
  document-width overflow. **Page errors, CSP violations and external requests
  are all 0**. The Device screenshot was visually inspected.
- The actual built inference Worker now starts without a model and reports
  `crossOriginIsolated=true` with `SharedArrayBuffer` available. The previous
  candidate's document-only success was insufficient; the added startup probe
  failed before the worker-header fix. Updated Native/Cloud static suites:
  **48 passed** (overlapping the regression set).
- Caddy's private fixture CA stays in the new output directory. OS trust is never
  installed. Chromium pins only the verified leaf public key for that test
  process; it does not use a general ignore-certificate-errors flag.
- Initial test corrections: the official manifest used SHA-512 rather than
  SHA-256; the first mismatched check stopped before binary execution. The built
  custom 404 HTML was incorrectly treated as main-app fallback. Playwright's
  string-based polling violated strict CSP, so polling now uses direct protocol
  evaluation. Context-level certificate exceptions did not cover the worker;
  verified leaf-key pinning resolved the fixture trust issue without changing CSP.
- Local result: `.artifacts/unified-proxy-browser-results.json`. This result is
  independent of the previous four-condition Portable/PWA browser acceptance.

## Remaining production conditions

Public TLS/Cloudflare transformation, real Google OAuth and cookie transitions,
exact old-link handling, old active-worker migration, real OPFS/model capacity,
existing Remote key fingerprints, target-VPS resources and financial/erasure
state reconciliation are not proven by this loopback test. No production
deployment or full-plan completion is claimed. Regional/guardian/ad/payment
approvals and complete runtime/device/recovery acceptance remain separate gates.

## Final retained candidates

Final application/build-policy source is `a6cbd98`; `7c9e8c0` aligned the test
Relay hostname beforehand. The earlier `1d021fc` candidate is superseded because
it lacked inference-worker isolation. No candidate was deployed.

- Clean final-source Web suite: **755 passed / 62 files**. Typecheck, unified
  App and legacy Mobile builds passed with the existing build warnings.
- The existing managed Relay origin is fixed to `https://relay.kyalulu.com` in
  the candidate build. Existing WASM outputs were reused, not rebuilt.
- Cloud candidate SHA-256:
  `3369452dfc163321abc91327f4140153f21eba695d0fab0060528c2275a09a49`.
  All **222** manifest entries, **747** corresponding-source files by inventory,
  and **61** precache entries, including three explicitly compressed runtime
  assets, were inspected. Each manifest/precache hash was independently checked;
  the selected Runtime, proxy, Vite and runbook files match the Git export.
- Exported source bytes preserve Windows CRLF. Raw export/package checks and
  LF-normalized comparisons against the Git blobs were kept separate; the first
  strict blob-byte comparison failed only on that line-ending difference.
- The actual tar contents were extracted into a new directory and passed the
  final Caddy/HTTPS/Chromium check, including the real inference Worker with
  shared memory. No accounts, credit lots, funding, operations or secrets were
  created in the disposable control store. Errors/CSP violations/external
  requests remained zero.
- The same extracted Web passed all four JA/EN, 393/1280px, light/dark PWA cases,
  including explicit update, Library/draft flows and offline browser restart.
  API/external/page-error counts were zero in every condition.
- The final and superseded builds have identical precache asset bytes and
  compressed-asset hashes, but the delivery-policy change updates cache version
  `43498873a862a1d01ee3` to `c06eec95044c658cffbc`. Both unified and Mobile `_headers`
  contain the isolated inference-worker rule.
- The legacy Mobile candidate includes **78** files, **40** verified precache
  entries, the four pinned model descriptors, source and license texts. All file
  hashes and corresponding-source ZIP hashes were independently checked; the
  largest file is **16,811,691 bytes**, below the Pages file limit. Model weights
  are not included. Source ZIP SHA-256:
  `53af2f678b043a12b68e90d0ce0a226577069737748ed37cf8e25a4ce715d04d`.

Candidates and hash reports are retained locally under
`.artifacts/unified-canonical-a6cbd98/`; the copy back from isolated staging was
hash-verified. Browser summaries are
`.artifacts/unified-proxy-browser-results.json` and
`.artifacts/unified-canonical-pwa-browser-results.json`.
Docker image creation, signatures, Windows candidate refresh, WASM recompilation,
public delivery/OAuth, physical devices and production-state reconciliation
remain unverified. Copied license texts and manifests are not legal acceptance.
