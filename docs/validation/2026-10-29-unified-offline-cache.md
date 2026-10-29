# Offline cache selection and sequential eviction

The automatic cache pass retains the ten most recently opened conversations plus
pinned, unsent, device-only, unacknowledged and pending-generation records. It now
walks IndexedDB one record at a time and retains only selection metadata. It no
longer loads every conversation body through `getAll` to select those ten.
Evictions also read and write one conversation at a time inside the same atomic
transaction. No database version, wire format or stored identity changes.

Immediately before replacing a body with its existing offline stub, the pass
rechecks owner, kind, storage policy, deletion, dirty/pinned/pending flags,
revision, server revision and opened timestamp. A concurrent edit, reopening,
pin, generation, local-only change or server acknowledgment prevents replacement.
An aborted write transaction retains every original, including earlier writes
from that transaction.

## Fresh local evidence

`python tests/e2e_offline_cache.py` passed six real Chromium/IndexedDB cases:

- Normal eviction: 48 owner records, 46 conversations with 10,551,296 UTF-8 bytes
  of fictional message content. The ten recent and six protected older records,
  deleted record and Library document retain their complete values. Thirty older
  clean bodies become existing offline stubs; numeric IDs, UUIDs, revisions and
  preview text are preserved. A separate owner's record remains byte-equivalent.
- A new page in the same browser context reads the persisted stubs and original
  unsent message. This is page restart evidence, not OS/browser-process restart.
- Eight inter-transaction edits retain their full bodies; 22 other bodies are
  evicted. The injected edits cover reopening, unsent revision, pin, pending
  generation, device-only storage, server revision, deletion and kind change.
- An asynchronous IndexedDB error on the second write rolls back the first
  replacement as well. The fixture injects a duplicate-key constraint error;
  actual disk exhaustion or a browser quota limit was not reproduced.
- Account changes during selection and before writing abort without modifying
  either owner's data.

Instrumentation rejects `entities.getAll` during the pass and observed at most
one outstanding body read/write request. Network access is limited to loopback
module loading; no real API, provider or advertising service is contacted.
The existing 43 sync unit cases and Web typecheck also passed.

## Remaining limits

The cursor still materializes one entity at a time. It does not segment a single
large conversation, remove `getAll` from other UI/sync operations, or establish
an application RSS bound. 250 MB/1 GB conversation capacity, real quota pressure,
Android/iPhone behavior and production migration acceptance remain unverified.
