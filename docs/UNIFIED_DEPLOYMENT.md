# Canonical app delivery and cutover

Target: `https://app.kyalulu.com` serves the unified UI, Cloud API and OAuth
callback on the same origin. `/device/` is isolated; `/migration/` is neutral.
Relay stays a separate encrypted transport. This runbook does not accept public
launch, provider contracts, regional policies or real-device behavior.

## Reviewed delivery path

- Build the unified Web entry with the existing managed Relay origin configured.
  Export `VITE_RELAY_ORIGIN=https://relay.kyalulu.com` into the build process
  (`$env:VITE_RELAY_ORIGIN='https://relay.kyalulu.com'` in PowerShell).
  Unified production builds reject a missing/non-origin value; a development or
  legacy/Mobile build does not imply this configuration is present.
  Run `pnpm --filter web build:app`, then
  `python scripts/prepare_cloud_bundle.py --unified --output .artifacts/unified-cloud`.
  Use a clean committed source tree, the existing locked dependencies and verified
  WASM inputs; do not package a dirty operator workspace.
- When extracting an audited archive into a new private release/validation root,
  explicitly set its **public build-context directories** to 0755 before Docker
  COPY; a restrictive operator umask can otherwise make them unreadable by UID
  10002. Keep the enclosing root private. Apply this only inside the newly owned,
  verified bundle, never to production volumes or secret/configuration roots.
- The unified bundle includes `deploy/cloud/Caddyfile.unified.example` in addition
  to the legacy example. Install only the APP site block into the existing Caddy
  configuration. Preserve its global no-log settings and Relay site/container.
  `APP_DOMAIN` is the canonical hostname; `RELAY_DOMAIN` is the existing Relay
  hostname. `CLOUD_UPSTREAM` defaults to `kyalulu-cloud-runtime:8000` on the existing
  external Docker network. Do not point container Caddy at host loopback.
- The unified bundle also includes `deploy/cloud/Caddyfile.cloud-migration.example`.
  At the coordinated cutover, replace the old Cloud site block with this example;
  do not append a duplicate host or proxy it into a Runtime with a different origin.
  It serves a bilingual re-login link and returns 410 for old APIs/callbacks, without
  redirects, code/cookie/body forwarding, Clear-Site-Data or data deletion. Keep
  `APP_DOMAIN` identical to the canonical site. Old OAuth flows must restart there.
  Its `/sw.js` waits for the existing explicit `APPLY_UPDATE` protocol and rejects
  another open tab. Activation switches shell requests to the old host's network
  migration responses while retaining caches, IndexedDB, OPFS and drafts. Users
  who have not applied the update can still see a cached old shell; its API access
  is closed by the server. Confirm this with the actual old UI before selection.
- `KYALULU_CLOUD_ORIGIN` and the Supabase Site URL/callback allowlist must match the
  exact canonical HTTPS origin. Do not rewrite Host or Origin at the proxy to
  bypass Runtime validation. The callback is `/auth/callback`.
- Proxy API, callback, static files and source offer to the same Runtime. Runtime
  owns device/inference-worker/migration CSP and isolation headers; Caddy supplies the main-shell
  policy without adding a second CSP to those documents. Main CSP retains the
  pinned Relay connection and keeps third-party frames closed pending ad review.
- Static responses include `no-transform` to preserve Service Worker integrity
  through the edge. `/sw.js` declares `Service-Worker-Allowed: /`. Missing assets,
  private paths and missing nested device/migration paths never receive app HTML.
- The real inference Worker response must carry its own COEP/CSP, including when
  precached. Apply the explicit PWA update to replace old cached Worker headers;
  the build includes the generated delivery policy in the Service Worker version.

## Before a production change

1. Record the current Pages deployment and source hashes, DNS records, Caddy
   configuration, Cloud image, volume bindings and configuration fingerprints.
   Keep private env values and Remote keys out of logs and public evidence.
2. Preserve control/tenant databases, media, durable outboxes, receipts, erasures,
   funded credits and private-budget history. Make an independent encrypted
   disaster backup and verify its hash/offsite copy. Restore only into a new
   isolated root and compare recorded rows before selecting a production release.
   Use the updated admin/recovery tool: the snapshot includes Community and both
   transfer trees as well as control/tenant DBs and retained versions. Existing
   data in any control table or durable destination must cause refusal. Preserve
   the compatible recovery tool with the backup; older readers reject the added
   archive members. See the separate fictional recovery evidence and its limits.
3. Prove the complete required feature/compatibility matrix and accepted regional
   policies. Keep existing private-test, signup, budget, billing, advertising,
   image and provider restrictions. Never insert guessed policy approvals or
   reset financial state. Adult/guardian/ad/payment contracts are separate gates.
4. Prepare both origins' neutral migration documents before advertising direct
   Mobile transfer. Test the old active Service Worker, popup opener, exact origin
   allowlist, real OPFS capacity and model hashes. Keep file export/model download
   fallback and all old Mobile data. Do not replace the old Mobile URL with a
   blanket redirect.
5. Preserve the APP origin's browser databases and Remote key fingerprints. The
   DNS/hosting change must keep that exact origin. A new Cloud cookie is required
   at APP: the old `__Host-kyalulu_cloud` cookie cannot migrate across hostnames.
   Existing Cloud account IDs, encrypted data and balances stay in the same
   protected store; do not copy cookies or forwarding credentials across origins.
6. Retain a verified **v3-compatible browser recovery bundle** before publishing
   the segmented-storage client. Opening IndexedDB v3 is additive and preserves
   inline v1/v2 records, but a v2 client cannot reopen that database. Verify the
   recovery bundle with both inline and segmented records; preserve `entities`,
   `meta` and `parts` together. The earlier v2 UI alone is not a rollback option.

## Cutover and recovery conditions

- Drain pending jobs, stop the old Cloud process and retain its protected volumes.
  Never run two Runtime writers against them. Select the audited image, matching
  canonical origin and accepted configuration; preserve the master secret.
- Plan the old Cloud hostname separately. It must not reach a Runtime configured
  for a different Host. Retain a migration/re-login path and close old callback or
  write routes safely; do not relay OAuth codes, cookies or request bodies into
  a different origin. Real OAuth completion and old-link behavior require evidence.
- Validate the combined Caddy configuration with the deployed Caddy version
  before activation. The recorded 2.10.2 setup has admin disabled and requires a
  brief Caddy restart; do not assume a signal reload is supported. Preserve Relay.
- Verify public TLS and exact HTML/worker/source hashes, one CSP per document,
  device isolation, neutral migration opener, same-origin API/auth restrictions,
  re-login, old conversations, Remote re-pairing/reconnection and private gates.
  Compare all recorded account/ledger/budget/receipt/erasure state after startup.
- On failure, stop the new writer and return the recorded image/origin/Caddy/DNS
  configuration. Preserve new data and archives before any DB rollback. Use the
  reviewed Core/disaster recovery path; never overwrite current outboxes with an
  older DB or drop browser stores to make an old client start.
  For browser storage already upgraded to v3, serve the retained v3-compatible
  recovery UI even if server behavior is rolled back. Do not send those browsers
  back to a v2-only bundle or interpret `VersionError` as permission to clear data.

The local HTTPS proxy check is `tests/e2e_unified_proxy.py --caddy <verified-tool>
--dist <unified-build> --output <new-disposable-directory>`. It starts only
loopback services, uses a private fixture CA and pins its verified leaf key in
Chromium without installing OS trust. It is not public TLS, Cloudflare behavior,
OAuth, deployment or production recovery evidence. See the delivery checklist
and the separate validation record before changing any production configuration.


## Native distribution uses its own entry context

Do not package `.artifacts/unified-app` as the standalone PC UI. After the same
pinned WASM/catalog preparation and explicit `VITE_RELAY_ORIGIN`, run
`pnpm --filter web build:native`; `scripts/build_local_bundle.py` uses
`.artifacts/native-app` and requires its Native HTML marker. The manual native
artifact workflow builds/verifies WASM inputs before Windows/macOS packaging.
Already-built legacy archives are not rewritten by this change.

Native browser first-use calls `/api/local/eligibility` on its own Runtime.
`KYALULU_REGION_POLICIES` supplies explicit, versioned, approved regional rules;
absence is a closed state, not an implicit country approval. This check needs no
Cloud account, Cloud master key or online lookup. A general-use `native:` receipt
does not authenticate to Cloud or establish verified adult status. Real regional
policy approval is still a separate operator gate; fixture policies are not that
approval. For Cloud, explicit confirmation opens the canonical app separately,
without moving the local target/draft/receipt or forwarding sign-in information.
