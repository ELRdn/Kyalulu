# Device memory scope contract and atomic storage

2026-10-30. **Foundation and erasure integration, not chat-adapter acceptance.**
The Browser `/scope-migrate` endpoint still returns 409. This batch does not
replace it with a successful isolated copy or claim that normal Device chat
already searches the new shared pools.

## Data and ownership

- Six fixed fixtures match the actual Python normalized identity and logical
  world/shared IDs. They cover real catalog versions, Unicode library references,
  expression-only changes and the distinction between persona `none` and null.
  Same-asset version drift requires explicit preview/migration. Legacy and branch
  scopes remain independent; explicit sharing retains the original pool.
- Migration deduplication includes the attributable source session in both Python
  and Browser. Equal manual facts from separate sources survive either source's
  erasure. This does not reconstruct rows lost by older deduplication.
- Browser domains are keyed by the JSON tuple of owner and storage policy. The
  body also records both values, so an old-account snapshot cannot be committed
  into the next account. Local and sync domains remain separate.
- Shared retrieval rows and their audit events live outside canonical conversation
  bodies. Only attributable own memories enter a conversation projection, with
  source-message IDs present in that conversation's own history. Independent
  branches/recoveries rebind ownership while retaining the original session field.
- Domain state uses existing v3 metadata and checksummed parts, not a new database
  version. A commit checks the domain revision and every captured source revision;
  own projections and generation receipts commit together. A pending domain fences
  ordinary conversation writers; a terminal receipt resolves that pending commit.
- The current domain body is decoded as a whole. Physical segmentation is not a
  proof of bounded decoded RAM, high memory-count performance or 1 GB acceptance.

## Live erasure and API changes

The existing confirmed erasure transaction now erases attributable copies in both
Browser domains, preserves source tombstones, and scrubs referenced local generation
records and debug snapshots. It keeps unrelated memories, authored replies and
conversation state. Failures roll back the source tombstone and both domains.
Entity headers index the diagnostic source/row references and bind that index to
the immutable body token. Verified unrelated bodies are skipped, even if corrupt;
missing, malformed or stale indexes fall back to body inspection. A referenced
corrupt body aborts the whole erasure, retaining the original source and domains.
Incoming deletion pages and local memory/branch/erase mutations acquire the same
owner execution lease as inference, including percent-encoded route paths.
Audit events retain source attribution when the canonical memory row is removed,
so later source erasure also removes retired-row text and diagnostic references.

The common generation-status route can resolve an orphaned domain under the free
owner lease. It verifies the pending receipt/worker marker and preserves newer
canonical messages, memories and drafts; it never replaces them with old snapshots.
A different pending ID or failed save leaves both domain and receipt pending.
Missing/deleted sources stay missing/deleted and their retained copies are erased.

Conversation-panel manual additions now pass an optional source session. Python
checks tenant-local existence, erasure, scope and pending generation state in the
same write transaction as creation. Browser checks the existing own conversation
and uses its revision for admission; mutations also acquire the existing execution
lock. Source-less global additions retain their previous NULL ownership.
Older unowned shared rows are not reassigned by text matching. The conversation
erasure confirmation explicitly excludes shared memories without an originating
conversation, rather than promising an association that the saved data cannot prove.

Private retrieval/compiled/raw/attempt diagnostics and worker leases are excluded
from synchronization summaries, including legacy incoming copies. Authored replies,
state and ordinary summary fields remain. The debug drawer distinguishes an actual
saved prompt, a current-settings preview and an unavailable original prompt.

## Fresh evidence

- Full Web: **1,187 passed / 78 files**; TypeScript check passed. The pure scope
  contract has 20 cases and the transaction harness has 33 cases, including
  selective reads, stale indexes and corrupt-body erasure rollback.
- Python scope/manual-source/conversation/restore/source-offer selection:
  **128 passed**. The added API cases include tenant separation, history-only
  sessions, rejected scope/pending/erased sources and rollback.
- Real Chromium/IndexedDB: shared copy/deduplication, own canonical sources,
  pending writer fencing, metadata quota rollback, source revision fencing,
  erasure/redaction, erasure rollback, owner/policy isolation, a **two-part >1MiB**
  domain, checksum rejection/verified chunk repair and full document reload passed.
  The generation API also passed orphan recovery and rollback with a newer saved
  draft; erasure removed audit text after its canonical memory row was removed.
  Private report: `.artifacts/device-memory-scopes-browser/result.json`.
- Existing JA/EN memory UI **3 cases**, memory API/dirty recovery **2 cases** and
  cross-document/legacy generation recovery passed. No external/API network
  requests or page errors occurred in these browser fixtures. Owned processes
  and contexts closed. They use fictional data and no actual inference.
- The final source passed all **10 selective-sync Chromium cases**, the memory
  scope fixture, the **2 memory API/recovery cases**, and cross-document lease
  recovery/deletion tests. This remains local browser evidence.
- CI `0deaa87` passed Windows but failed the new lock test on Ubuntu: waiting on
  a Promise-valued query predicate was not a reliable broker barrier. The test now
  awaits an actual queued lock acquisition after document close. It passed locally;
  the new commit still requires clean cross-platform CI.

## Remaining adapter work

Connect scope resolution, mutation and retrieval to the Device memory routes and
normal generator. Preserve own before/after snapshots, make regeneration invalidate
its source generation's copies, reconcile source changes and policy transitions,
and exercise the implemented orphan recovery with scoped inference. Then
verify actual shared behavior through the common UI, cross-document races and the
Python fixtures. Physical devices, real-model behavior, capacity, fixed artifacts
and production reflection remain separate requirements.
