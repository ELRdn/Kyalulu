# Offline cache and direct Mobile migration — bounded validation

2026-10-24. Implementation and disposable fixtures only. No production deployment,
real conversation erasure, provider calls, model inference, Git mutation or contracts.
The user's conditional sync-erasure approval remains limited to the reviewed
implementation and artificial-data tests; it does not authorize production erasure.

## Offline retention

- Recent ten opened conversations, pinned conversations, dirty/local-only records
  and pending generations retain their bodies. Older clean acknowledged sync
  histories keep stable message/memory identities, title, count and short preview.
- Owner-scoped hydration reuses numeric IDs and the ordinary atomic receipt,
  checks consent and does not rewind the sync cursor. Failed hydration returns503.
- Pinning first hydrates the body; owner/revision checks prevent a false saved state.
- Failed generation cleanup now reports an SSE error even if persistence also
  fails. The original pending input stays protected rather than causing an
  unhandled rejection or being treated as disposable cache.
- Real IndexedDB fixture: 17 conversations, recent ten, pinned/dirty/pending/local
  protections, three evictions, hydration/pin and an unavailable uncached history.
  Transaction-abort injection preserved all original fixture records.
- A separate document with API fetching blocked reopened the previously hydrated
  conversations and retained the other protected account data.
- Evidence: `.artifacts/unified-cache-ui/cache-and-abort.jpg` and
  `.artifacts/unified-cache-ui/document-reload.jpg`.

This is document reload with unavailable APIs, not physical quota exhaustion,
full PWA-shell offline startup, or browser/process/device restart acceptance.

## Direct migration

- Both build modes emit a neutral top-level `/migration/` document. Exact origin,
  opener identity, one-use window nonce and explicit source consent gate the
  MessageChannel. There is no iframe storage-partition assumption.
- The source can read only the frozen backup and ready catalog-model files;
  no arbitrary URL/path requests, auth information, Cloud upload or source erase.
- The receiver validates the versioned manifest, bounded backup, selected model
  fingerprint (runtime/revision/distribution/file paths/size/hash), byte lengths
  and SHA-256. Requests are sequential with one-MiB backpressure and timeouts.
- Verified existing shards are reused. OPFS writable abort preserves old files;
  readiness is written last. Downloads/removal/import share a model Web Lock.
- Migration copies unused characters and historical character snapshots as well
  as conversations, stopped output and drafts. Owner-scoped receipts make retry
  idempotent. Drafts remain in IndexedDB if localStorage restoration fails, and
  restored composer drafts use the device-owner scope even on the neutral page.
- Current browser fixture ran between `127.0.0.1:5193` and `127.0.0.1:5194` with
  actual IndexedDB and OPFS, using a synthetic 2,097,171-byte file in three chunks.
  Normal transfer, exact destination hash, replay IDs, two characters, history
  and draft passed. A same-size corruption in chunk two was rejected without a
  ready status. Source OPFS hashes remained unchanged after both transfers.
- The first corrupt-fixture attempt had an incorrect cumulative character-count
  assertion after a preceding independent import. The assertion was scoped to
  its migration hash; fresh normal and corruption runs then both passed.
- Screenshot: `.artifacts/unified-migration-ui/verified.jpg`.

Tests cover spoofed origin/window/nonce/type, malformed/oversize manifests,
duplicate descriptors, multichunk Unicode, hash/length failures, ordering,
cancellation, concurrent reads, timeouts, invalid offsets, resume, quota denial,
atomic import failure, duplicate receipts, account separation and failed SSE saves.
Both production build modes and frontend typecheck passed. The final checks below
are reported per suite; overlapping checks are not added together.

- Final frontend full suite:396 passed; typecheck and both builds passed.
- Frontend full suite before the final import/SSE regressions:392 passed.
- Subsequent affected import/SSE suite:18 passed.
- Backend unified/bridge/source/bundle suite:59 passed.
- The rebuilt `/migration/` page rendered under its production CSP without a
  RuntimeGate/login dependency. Preview HTTP probes confirmed neutral migration
  headers and retained `/device/` isolation. A missing standalone spacing style
  was fixed and visually rechecked; `.artifacts/unified-migration-ui/built-page.jpg`.
  The production-page file chooser and production-domain popup were not exercised
  end-to-end; actual imports were checked through the storage/channel fixtures.

## Distribution and remaining gates

Pages headers use distinct root, `/device/*` and `/migration/*` policies so
isolation headers do not merge into contradictory values. The Cloud handler has
equivalent neutral/isolated document tests. Service Worker precache uses canonical
directory URLs for nested index documents, avoiding Pages index redirects while
retaining integrity and credential restrictions.

The old `.artifacts/unified-release-candidate/verification.json` now explicitly
marks its bundle historical and stale. It does not match this working tree and
must not be deployed as the current candidate.

The cross-origin fixture uses the real channel/storage helpers with loopback
origins, synthetic catalog metadata and no real model. It does not establish the
production-domain consent popup, actual Pages/Caddy headers, deployed PWA update,
large-model transfer, Safari OPFS, Android/iPhone, or full browser restart acceptance.
Contracts, public moderation, native-PC sync, parity/localization, deployment and
the full plan's other open acceptance rows remain tracked in `UNIFIED_DELIVERY.md`.
