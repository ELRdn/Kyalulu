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
