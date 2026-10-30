# Device memory provenance and common API (2026-10-30)

## Problem and change

Browser memory proposals previously used the user quotation/message ID for all
source kinds, including AI story events and work canon. Manual corrections also
replaced provenance with `origin=manual` and `supported=true`, and arbitrary body
fields could overwrite saved identity. The debug endpoint omitted the memory
trace used by the common Inspector; ordinary chat did not save its actual prompt.
Reserved search/events/scopes paths were treated as memory IDs, and detail GET
returned a list rather than the requested memory.

- Match Python commit decisions: statement/correction use user evidence; fictional
  story events use the assistant reply; model work-canon proposals are unsupported.
  Model proposals stay unverified, even when wording overlaps. Preserve source
  generation/revision and the correct user/assistant message ID. Inject source
  labels and the fictional-story warning using the same reference prompt text.
- Match manual memory source fields, whitespace/Unicode limits, no-op corrections
  and soft-delete semantics. Only declared mutable fields can change; keep
  original generation/message provenance and mark corrections user-confirmed.
  Preserve the old Browser PUT alias; the common client uses PATCH.
- Supply debug/telemetry enabled/scope/stored/retrieval/proposal/evidence fields,
  actual compiled/raw prompt and state before generation. Memory-off stores no
  proposals/events and injects no memories. Access counts change only on successful
  generation; search preview does not mutate them.
- Implement owner-scoped scope listing, read-only retrieval preview, detail/event
  reads and explicit method checks. Unknown/ambiguous memory IDs do not select
  another conversation. New local audit keys encode `[owner,session]` as JSON so
  colons in either value cannot cause another account's history to be selected.
- Persist memory operations/retrieval evidence in the same IndexedDB transaction
  as the entity. Explicit scope/conversation erasure removes the related local
  audit records. A remote erasure preserves dirty memory and its audit records
  in a new device-only recovery; remap local IDs and retain the original scope/ID.
  Sync conflict copies preserve the same local evidence. Audit metadata itself
  stays on that device; this does not add it to the Cloud wire contract.

## Evidence

The shared `unified-memory-provenance.json` fixture exercises source kinds,
unsupported canon, invented user facts, fictional events, duplicates/short text,
Unicode quote limits, reply evidence and exact prompt labels. Python tests use
real `memories.commit` plus fictional temporary SQLite databases. TypeScript
checks the same decisions, preserving existing proposal selection behavior.

API tests cover identity-field forgery, deleted-memory resurrection, no-op
updates, owner changes, separator collisions, preview without access-count writes,
source-preserving corrections, metadata failure and explicit scope erasure.
Generation tests verify actual adapter traces, source message IDs, prompt labels,
access counts, snapshots and disabled-memory behavior. Sync tests retain unsent
memory/evidence through a received tombstone and preserve the other owner's data.

`tests/e2e_device_memory.py` runs the actual API and IndexedDB in disposable
Chromium contexts, Japanese/393px/light and English/1280px/dark. It checks a
metadata-write QuotaExceededError after the entity write, unchanged body/revision
and event log, retry, preview, document reload, source correction, owner isolation,
deleted-memory rejection, explicit scope erasure/reload, and remote deletion with
unsent source evidence retained locally. Only the prior open/access timestamp is
allowed to change on a rejected update. Both cases passed, external/API network
requests and page errors were zero, owned contexts/Vite closed normally.
The quota error is injected into real IndexedDB; it is not physical disk exhaustion.

Private evidence: `.artifacts/device-memory-api-browser/result.json`.
Full Web verification passed 1,107 tests/76 files and typecheck. The first full
run caught a Research isolation assertion tied to the old empty JSON-memory
prompt; it now checks absent memory blocks on each experiment's first turn and
actual source-labeled content on later turns. The isolation criterion is retained.
Python shared commit/source-fingerprint tests passed 51; earlier source collection
and parity selection passed 64 before the final rendering cases were added.
The Memory UI browser check also passed three JA/EN/width/theme cases, preserving
quote revocation, canceled erasure and actual saved memory/summary edits.
No real model or production database was used for these changes.

## Remaining scope

This does not complete the full unified plan. Explicit Browser world/shared-scope
migration still returns 409 rather than providing Python's scope-copy operation;
world identity/version separation needs its own implementation and evidence.
Full large-conversation/OS/device/real-model parity remains open. Audit arrays are
not a new large-data capacity acceptance. The earlier fixed 4bca277 Cloud/Native
artifacts do not include this batch; updated fixed-source packaging/image checks
are required before selecting a new deployment candidate. Production backup and
cutover remain awaiting the separate operation authorization, with no merge.


Migration and model-storage language follow-up uses notice/progress codes and
render-time exact first-party translations. Waiting/completion, model names,
selection, raw drafts, abort controls, source revisions and unknown diagnostics
are retained across language switches. Component/error tests cover popup waiting,
mid-transfer percentages, quota/download/manifest failure, model removal,
cancellation/account changes and no repeated writes/downloads on language change.
Those new async-label cases have component evidence, not a new deployed-origin or
physical-device transfer acceptance. CreatorSettings already used the shared
error renderer and was left unchanged.


The existing actual Device Research browser fixture also passed JA/393/light and
EN/1280/dark: eight-turn shared generation, ratings/reload, account separation,
PC-management denial, explicit/navigation cancellation and zero synchronized
conversation entities. Its inference Worker is synthetic. Product-wide model
quality, physical-device and all-world-scope equivalence are not inferred.
