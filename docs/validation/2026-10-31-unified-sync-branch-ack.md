# Conversation branch acknowledgments without whole-history restoration — 2026-10-31

Conflict receipts previously restored the complete fixed outbox and source
conversation, then cloned/rebound the whole branch. `acknowledgeBranch` now uses
the existing guarded ACK transaction, conversation binder/receiver and segmented
writer. No destination, authentication, billing or sync consent policy changes.

A live source is scanned twice: first for message identities and memory-event
mapping, then for per-message remapping/output. A deleted source is scanned once
for its current event mapping; its target body comes from two verified scans of
the selected payload in the frozen sent changes array. Bodyless tombstones and
deleted sources retaining history both keep their old semantics. The parser
validates all saved bytes, JSON, UTF-8 and depth, discarding other payloads and
retaining no selected `messages` array.

The existing first-bind → receive → second-bind order, source attribution,
snapshots, UUIDs, numeric allocation floor, memory-event last-occurrence mapping,
local/server revisions and dirty/deleted flags are preserved. Events finish
writing before the ACK advances. Live source parts remain byte-for-byte intact;
only their header's dirty flag changes. Deleted source headers/parts remain intact.
The target uses `add`, so an identity collision aborts instead of replacing data.

Both initial and terminal ACK guards now compare true consent, request ID and
immutable outbox controls for inline and segmented layouts. Only then can the
sequence/cursor advance and the outbox be removed. All target parts, events and
header changes roll back together on corruption, quota or guard failure. Conflict
branches are conversation-only, matching the server's existing contract; other
synthetic branch receipts are rejected. The 1,000,000,000-byte transfer ceiling
is enforced by staging, rather than limiting the shared local-body writer.

## Evidence

- Full Web **1,492/1,492**, 93 files; focused **153/153**, four files;
  TypeScript and unified build **9.19s** pass.
- [Independent real Chromium matrix](2026-10-31-unified-sync-branch-ack-browser.md):
  **47/47 executions across 46 scenarios**, source aggregate
  `cb26a5aa1b80d6422dd752fb9830e44123900c441a295c56726be73b85e82902`.
  Parent reread the complete 95-record stdout, result and before/after manifests;
  all **332** inputs still match their hashes. Nineteen successful outputs are
  independently decoded and compared with the checksum-frozen old oracle; 28
  guarded/withdrawn/initial-reload results preserve all original physical rows.
- Current/selected root message retention and unselected payload retained keys
  stay zero. Coverage includes live edits, deleted retained history/tombstones,
  inline/mixed layouts, target index 1, memory-ID collisions, same-owner allocation
  floor/foreign-owner exclusion, malformed last parts, late corruption/quota,
  pending domains, invalid events, two-ACK rollback and reload/resumed receipt.
- Two strict consent failures were reproduced before terminal guard hardening,
  then passed unchanged. They mutate consent inside the same ACK transaction;
  normal independent IndexedDB transactions serialize, so this is fault-injection
  evidence, not a reproduced concurrent user withdrawal.
- Existing sync **15/15** passes with **330** source hashes unchanged.
  Initial staging **30/30** passes with **328** input hashes unchanged, aggregate
  `34b5f1e13391b06ffef38c77f0fcddd42713e7ad7c16c14ba4f9fa4f5690c3fd`.
- [Export diagnostic follow-up](2026-10-31-unified-device-export-ci.md) passes
  setup/reload and all six formats. Parent verifies all 64 frozen inputs still
  match and the nine evidence-file digests match. This export result does not
  exercise the branch ACK and does not establish the old CI timeout's cause.
- Corresponding-source browser/module/Python-helper closure **3 passed /10
  deselected**, 18.20s. The collected source includes all imported local fixtures.
  Static review of the product changes found no additional concrete defect.

Logs: `.artifacts/sync-branch-ack-{focused,web-all,typecheck,build}-final.log`,
`sync-branch-ack-existing-{sync,staging}-final.log` and
`sync-branch-ack-parent-evidence-check.json`. Frozen browser artifacts are in
`.artifacts/sync-branch-ack-browser/20261031T141616538027Z/`; earlier failures
remain preserved. CI and the corresponding-source collector include the new
runner, fixture, frozen oracle and validation records.

## Limits

Root metadata/scalars, identity maps, event arrays and one message remain whole;
legacy inline records already contain full histories. Every scan still reads
the whole body and writes need temporary storage. Remote conflict receive,
hydration/export, actor history/Worker input/pre-fit raw prompt, ONNX fitting
and active Research serialization retain whole-tree paths. No complete 1 GB/RSS,
real-model, provider, physical-device, production or legal acceptance is claimed.
