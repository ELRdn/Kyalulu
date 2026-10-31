# Stream an existing fixed outbox (2026-10-31)

Sync previously reconstructed a segmented fixed outbox's complete changes array
before upload or cached-receipt acceptance. `appOutbox.ts` now reads its saved JSON
parts and emits the same request_id/changes wire object in 1 MiB blocks.

## Data and fence contract

Each read uses a short readonly transaction: current owner/generation state, request
ID, manifest, count, revision map and compact change controls must still match the
captured source. The whole saved-array size/SHA is verified. A new JsonStream mode
omits only direct wire change payloads, validating their JSON/UTF-8 without retaining
them. Including the wire wrapper preserves the existing depth64 limit. Projected
controls must equal the durable compact header; payload objects cannot become
unverified substitutes for the saved body.

The uploader hashes the first wire pass, resumes the second at the server's next
index, and verifies second-pass size/SHA before commit. State is checked after JSON
request construction and before each network callback, including inline sends and
commit. Network-boundary checks include the captured fixed-source identity.

Receipt/withdrawal flags may change while immutable bytes are reconciled, so they
are excluded from source comparison. Existing consent/withdrawal checks still guard
every upload boundary; cached withdrawn receipts can be accepted after renewed
consent without resending payloads. Normal cached receipts verify the stream before
the atomic local ACK/outbox settlement. Branch acceptance retains its complete-record
fallback and rechecks the original fixed header before settlement.

Freshly staged outboxes are reread as compact headers. Legacy inline records keep
their original compatibility path. Small wire requests remain inline; old server
receipts that require a large inline body still use a complete JSON string.

## Final evidence

- Full Web **1,469 passed / 93 files**, **18.63 s**; focused **125 passed**,
  **9.08 s**; TypeScript; unified build **17.71 s**.
- Existing real sync matrix **15/15**, with source fingerprint unchanged, retains
  receive/branch/normal ACK/corruption/quota/owner/reference/deletion protections.
- Independent [outbox browser matrix](2026-10-31-unified-outbox-stream-browser.md):
  **79/79 scenarios, 81 successful records** including two reload/resume continuations.
  **3,659,537 wire bytes / four saved parts** match the independent original-seed
  JSON.stringify oracle, output framing, part hashes and full hash.
- Resume, committed receipt/no resend, inline/legacy fallback, cached normal and
  withdrawn receipts, all mutation boundaries, malformed correct-hash sources,
  second-pass corruption, and serialization-time owner/busy changes are covered.
  Actual source parsers retain zero payload trees/messages/live payload keys or
  discarded-frame keys; maximum decode is1MiB and parsed scalar29 characters.
- All **319** browser-source input hashes are fixed. Real network/provider/model
  attempts and page errors are zero; owned browser/context/Vite cleanup completes.
- Corresponding-source fixture/helper closure: **3 passed /10 deselected**, **13.02 s**.

The first frozen browser run found a real callback-fence ordering gap after 76
passing scenarios: manifest JSON construction could change owner after active()
returned. The fix constructs the request first, then checks active(), then calls
the transport. The same browser runner, input sizes, assertions and deadlines pass
all79 afterward; three new unit checks cover manifest/part/commit construction.
Original failure evidence is preserved separately.

Logs: `.artifacts/outbox-stream-unit-fence-final.log`, `outbox-stream-web-fence-final.log`,
`outbox-stream-typecheck-fence-final.log`, `outbox-stream-unified-build-fence-final.log`,
`outbox-stream-sync-fence-final.log`, `outbox-stream-source-closure.log`.
Final independent result: `.artifacts/outbox-stream-browser-result.json`, SHA-256
`24899a8b4baf5edbb4708a18e0da920b0a5956897df3194710005c5b9a27d41a`;
source fingerprint `d79cda322309b9fb5a807a4008c3abf25cd68be3f22b4e05c20446d1c74f4a89`.
Pre-fix result: `.artifacts/outbox-stream-browser-before-fence.json`.

## Remaining scope

Initial prepareSyncBatch, legacy inline values, branch receipt recovery, receive,
hydration/export and actor prompt construction still have whole-tree paths. Compact
metadata and scalar fields outside omitted payloads remain whole. Large legacy
inline fallback still requires a complete string. Fixture oracle construction also
holds full data outside the measured client parser. These checks do not establish
whole-process RSS, complete1GB sync/generation, real server/model/device or production
acceptance.
