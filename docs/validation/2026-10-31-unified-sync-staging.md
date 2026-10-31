# Initial sync staging without restoring complete histories — 2026-10-31

Before this change, initial sync restored up to50 selected conversation bodies,
cloned their complete histories while resolving snapshots, then serialized the
whole change array into a fixed outbox. Streaming an already-saved outbox did not
remove this initial memory cost.

`stageSyncBatch` now reads selected headers and scans segmented histories with
per-message callbacks. It retains root metadata and deduplicated historical
setting references, resolves the same pinned library/creator snapshots, and uses
the existing snapshot validation and diagnostic removal. The original50-record
key order, first-deletion priority, explicit deletion revision and owner/local/
pending-generation filters remain.

A second transaction checks consent, gives any existing fixed outbox priority,
and compares every selected source header/revision/body token with preparation.
It serializes complete messages one at a time into tentative1MiB outbox parts,
verifies the full source again, and publishes the compact header only after all
part writes succeed. Original entity parts are never replaced. Late source,
owner/generation changes, corruption or quota failure abort the whole transaction.
The new writer enforces the existing1,000,000,000-byte transfer ceiling and handles
both a pending final part and writes that finished before stream closure.

The resulting changes array retains the old JSON.stringify property order, bytes,
values and SHA-256. Existing fixed/legacy outboxes and upload/receipt behavior keep
their prior paths. No Cloud/Remote authentication, billing, storage policy or
automatic destination behavior changes.

## Fresh evidence

- Focused sync/data/outbox **118 passed**,5.30s. Includes exact80-message multipart
  output/snapshots/hash, root-message retention0 in both scans, complete source
  preservation, quota/owner/busy/consent/checksum failures and existing-outbox
  priority. Writer boundaries17bytes/1MiB/2MiB+17 match Node's independent SHA-256
  and all bytes after prior writes drain.
- Full Web **1,479 passed /93 files**,15.56s; TypeScript passes; unified build
  **9.70s** with the documented HTTPS Relay origin.
- Existing real Chromium sync matrix **15/15** preserves receive, branching,
  normal/lineage acknowledgments, corruption, quota and late-owner protections.
  Source fingerprints before/after agree; all contexts/browser/Vite close.
- [Independent initial staging browser matrix](2026-10-31-unified-sync-staging-browser.md)
  **30/30 results** includes exact2,806,605-byte/3part old-oracle parity, complete
  physical source preservation, second-pass corruption after tentative writes,
  actual revision/token competitors, owner/busy/consent, quota, existing winner
  and reload/resume.327source input hashes agree before/after, aggregate
  `8a5779420296b89c6685e185ec6e3919a3d3992965bb7b167292ef1f9542c52c`.
- Corresponding-source fixture/helper closure **3 passed /10 deselected**,11.67s.
  The first closure run rejected a directory-only schema import in the frozen
  oracle; its explicit index.ts path fixes that without relaxing the scanner.
  Pinned old helper/oracle/schema checks also work without Git/history, including
  tamper-negative checks. The runner/fixture/oracle ship in source and run in CI.

Logs: `.artifacts/sync-stage-focused-final.log`, `sync-stage-web-all-final.log`,
`sync-stage-typecheck-final.log`, `sync-stage-build-final.log`,
`sync-stage-existing-sync-browser.log`, `sync-stage-source-closure-final.log`.
Existing sync structured result: `.artifacts/sync-selection-browser/result.json`,
SHA-256 `4ff373e5ca0bfa63d30cb16531745db2d8b306f9cfbe2a14c7c6731ea4359adc`.
The independent browser record separates final frozen-source proof from exploratory runs.

## Remaining scope

Metadata, scalar strings, one message and referenced documents remain whole;
multiple selected metadata objects are retained. Legacy inline entities already
contain full bodies and keep that compatibility path. This bounded proof does not
establish complete1GB staging/sync, process RSS or physical-device performance.
Branch receipt/receive, hydration/export and actor prompt construction still have
whole-tree paths. No real provider/model/production operation is part of these checks.
