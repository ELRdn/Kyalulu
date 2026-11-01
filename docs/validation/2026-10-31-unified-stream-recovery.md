# Streamed Device orphan recovery

Orphan recovery previously restored and serialized the complete conversation to
clear `pending_generation`. It now streams messages through the existing JSON
decoder and chunk serializer, retaining one current message and metadata. All
message bodies, snapshots and unknown payload fields remain present. JSON property
order/serialization and the body token/hash may change; this is a semantic rewrite,
not a byte-preserving copy. No database version or sync wire changes are introduced.

New pieces are tentative in the same IndexedDB transaction. Every old part,
length, whole-body checksum, UTF-8 sequence and JSON structure must validate before
the new header is adopted. Success updates the revision, pending flag, summary,
message-ID selection and memory-reference hash, then removes the old pieces.
Quota, checksum, syntax, owner or revision failures abort the transaction, including
already-written tentative output. Repeated root `messages` keys are rejected in
callback/rewrite mode because earlier callback output cannot be retracted; existing
full/window/ID readers keep their previous contracts.

Both legacy standalone and memory-domain orphan recovery use this path while the
owner execution lease is held. Domain pending state and its terminal receipt commit
with the conversation. A newer pending generation is never cleared. A source which
is already cleared is verified without advancing its revision. Missing/deleted
source handling retains the existing tombstone and memory-erasure behavior.
Unsent canonical edits, dirty state, server revision and fixed outboxes are retained.
Legacy recovery still requires explicit confirmation of the currently inspected
revision; inspection alone does not write, and a concurrent edit invalidates it.

Local validation:

- TypeScript, unified build and **1,321 Web tests / 84 files** pass, including
  callback values/completion/errors, bounded root history, malformed JSON/UTF-8,
  root duplicate rejection and compatibility of existing decoder modes.
- **41 real Chromium/IndexedDB scenarios** pass. Multi-part orphan fixtures retain
  all messages, snapshots, unknown data and fixed outbox; regenerate valid header
  selections; remove old pieces; and do not apply recovery twice. New fault cases
  cover failure after two tentative writes, missing final old part, owner change,
  stale legacy revision and duplicate root arrays, with unchanged originals.
- Existing shared-memory and execution-lock browser fixtures pass, including later
  canonical edits, receipt/pool rollback and account/source isolation. External
  requests and page errors are zero. These fixtures use synthetic model readiness
  and inference, not real-model or physical-device acceptance.

Limits: every repair scans and rewrites the whole body and temporarily needs room
for its new pieces. One message, scalar values, metadata and memory domains remain
whole. Inline legacy rows are cloned by IndexedDB before processing. Generation,
editing/branching, sync/outbox, hydration and export still have full-tree paths.
The original 1 GB full-tree restoration failure remains unaccepted; the bounded
checks above do not prove 1 GB overall or production readiness.

## Separate historical 1 GB rewrite diagnostic

A hash-matched copy of the original fictional 1,000,000,000-byte profile completed
pending seeding, recovery and streamed verification of **all 15,240 messages**.
Every ID, UUID, role, state and independently generated body matched; concatenated
body SHA-256, count, UTF-8 bytes and UTF-16 units matched the historical baseline.
Other metadata was preserved except the final `pending_generation:null`. Each of
the two rewrites and the verification retained an empty root message array. Old
parts were removed and the owner execution lease covered both writes.

Seeding took 45,729 ms, recovery 42,774 ms and verification 32,578 ms; the measured
operations totaled 121,086 ms. Aggregate owned-process sampled working-set peak was
1,306,820,608 bytes; OS Job peak commit was 787,542,016 bytes. These are distinct
metrics. The unchanged limits were 4 GiB Job/working set, 480 seconds and at least
2 GiB available memory, with an additional 8 GiB disk floor. No forced GC or heap
snapshot was used. All old parts/checksums were validated in each pass; original
profile and fourteen measured source/helper files retained their hashes. External
requests and page errors were zero, with no owned browser PID remaining afterward.

The first attempt could not launch Chromium under the sandbox; the next completed
both writes but hit a diagnostic assumption that old optional reference caches
always exist. After correcting that diagnostic, a fresh original-profile copy
completed the entire sequence under the same resource limits. Product code and
acceptance limits were not changed between these attempts.

This accepts the named orphan rewrite diagnostic on this host. Body manifest hashes
change on rewrite; the final serialized size is 1,000,000,026 bytes because the
original body lacked the pending key. It does not accept full-tree restoration,
generation, sync, UI responsiveness, universal RAM/quota requirements, physical
devices or production. Shared memory domains remain outside this large fixture.
