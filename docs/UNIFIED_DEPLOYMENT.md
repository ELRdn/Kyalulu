# Canonical app delivery and cutover

Target: `https://app.kyalulu.com` serves the unified UI, Cloud API and OAuth
callback on the same origin. `/device/` is isolated; `/migration/` is neutral.
Relay stays a separate encrypted transport. This runbook does not accept public
launch, provider contracts, regional policies or real-device behavior.

## Reviewed delivery path

- Build the unified Web entry with the existing managed Relay origin configured.
  Run `pnpm --filter web build:app`, then
  `python scripts/prepare_cloud_bundle.py --unified --output .artifacts/unified-cloud`.
  Use a clean committed source tree, the existing locked dependencies and verified
  WASM inputs; do not package a dirty operator workspace.
- The unified bundle includes `deploy/cloud/Caddyfile.unified.example` in addition
  to the legacy example. Install only the APP site block into the existing Caddy
  configuration. Preserve its global no-log settings and Relay site/container.
  `APP_DOMAIN` is the canonical hostname; `RELAY_DOMAIN` is the existing Relay
  hostname. `CLOUD_UPSTREAM` defaults to `kyalulu-cloud-runtime:8000` on the existing
  external Docker network. Do not point container Caddy at host loopback.
- `KYALULU_CLOUD_ORIGIN` and the Supabase Site URL/callback allowlist must match the
  exact canonical HTTPS origin. Do not rewrite Host or Origin at the proxy to
  bypass Runtime validation. The callback is `/auth/callback`.
- Proxy API, callback, static files and source offer to the same Runtime. Runtime
  owns device/migration CSP and isolation headers; Caddy supplies the main-shell
  policy without adding a second CSP to those documents. Main CSP retains the
  pinned Relay connection and keeps third-party frames closed pending ad review.
- Static responses include `no-transform` to preserve Service Worker integrity
  through the edge. `/sw.js` declares `Service-Worker-Allowed: /`. Missing assets,
  private paths and missing nested device/migration paths never receive app HTML.

## Before a production change

1. Record the current Pages deployment and source hashes, DNS records, Caddy
   configuration, Cloud image, volume bindings and configuration fingerprints.
   Keep private env values and Remote keys out of logs and public evidence.
2. Preserve control/tenant databases, media, durable outboxes, receipts, erasures,
   funded credits and private-budget history. Make an independent encrypted
   disaster backup and verify its hash/offsite copy. Restore only into a new
   isolated root and compare recorded rows before selecting a production release.
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

The local HTTPS proxy check is `tests/e2e_unified_proxy.py --caddy <verified-tool>
--dist <unified-build> --output <new-disposable-directory>`. It starts only
loopback services, uses a private fixture CA and pins its verified leaf key in
Chromium without installing OS trust. It is not public TLS, Cloudflare behavior,
OAuth, deployment or production recovery evidence. See the delivery checklist
and the separate validation record before changing any production configuration.
