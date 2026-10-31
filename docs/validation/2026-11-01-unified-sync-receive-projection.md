# Previous-conversation projection during sync receive — 2026-11-01

Normal receive previously restored every required local conversation's complete
history before deciding whether to skip it or merge incoming numeric/UUID
identities. A paged download's already-received check also restored the complete
local body merely to inspect its server revision and cache state.

`selectSyncRecords` now uses the existing verified part reader and per-message
JSON callback for segmented conversations. The receiver retains root metadata
and `{id, uuid}` for each old message, which are the only old-message fields used
by `conversationReceiver`. Root memories retain their stable UUID→local-ID map.
No projected history is persisted. Nonconversation records and legacy inline
values keep their previous paths. A source appearing as deleted anywhere in the
page keeps its complete-history path for **all** occurrences in that page, so
an earlier skipped update cannot discard unsent content needed by later recovery.

Every used segmented source still verifies every part, size, SHA-256, UTF-8 and
JSON before applying the page. Owner/generation guards and atomic source/library/
cursor writes remain. Message bodies and historical snapshots leave the parser
one at a time and are not stored in the old-message projection; root metadata
and one current message remain whole.

The download skip uses an owner/generation-guarded local header and the existing
`entitySelection` cache flag. A same-kind, already-received server revision with
no eviction needs no body read or network payload download. This is a metadata
skip, **not** verification that the unread local body is healthy. Evicted/newer/
missing content retains the download path and its original validation.

## Evidence

- Targeted sync units **90/90**, including five new receive cases: multi-part
  old history, old numeric/UUID and memory-ID preservation, foreign-ID exclusion,
  late-part corruption/missing failures with full rollback, same-ID update then
  deletion recovery, and header-only payload-reference skip with zero body reads.
- Full Web **1,499/1,499**, 93 files, **18.32s**; TypeScript and unified build
  **10.54s** pass.
- Existing Chromium sync matrix **15/15** passes with original quota, owner,
  receive, branch and acknowledgment assertions.
- [Independent Chromium proof](2026-11-01-unified-sync-receive-projection-browser.md)
  passes **26/26 executions across 25 scenarios**, including reload. Python
  independently decodes and compares **87 complete entities/events** with the
  frozen old full receiver. Coverage includes a second selected history,
  historical-only settings, deletion recovery, valid-JSON checksum corruption,
  invalid UTF-8/JSON with correct SHA, late quota and body/header guards.
  Parent verifies all **333** input hashes still match the before/after freeze,
  all **53** stdout JSONL records, complete results and owned cleanup. Aggregate:
  `c1af0e2a86309b40a50d7bead6355756b491becd6db80bf712dc0c27cd4d0b98`.
- Independent static review found no missing previous-data use or concrete
  guard/data-loss defect. No product defect was found by the browser matrix.
- Final corresponding-source module/fixture/Python-helper closure **3/3** passes,
  10 deselected, **26.53s**, after all browser files were finalized.

Logs: `.artifacts/sync-receive-projection-focused-first.log`,
`sync-receive-projection-web-all-first.log`, `sync-receive-projection-typecheck-first.log`,
`sync-receive-projection-build-first.log`,
`sync-receive-projection-existing-sync-first.{log,result.json}`.
Final independent artifacts:
`.artifacts/sync-receive-projection-browser/frozen-20261101-005/`;
parent check: `.artifacts/sync-receive-projection-parent-evidence-check.json`.
Final source-closure log: `.artifacts/sync-receive-projection-source-closure-final.log`.

## Remaining scope

The downloaded remote payload, receiver's cloned incoming tree, persisted output,
root metadata/memories/identity maps, nonconversation/inline records and deletion
recovery remain whole. Hydration still returns a complete entity. This removes
unneeded previous-history restoration, not the complete receive memory bound.
No 1 GB/RSS, real provider/model, physical device, production or release acceptance
is established by these bounded synthetic-input checks.
