# Route-scoped browser Runtime reads

The browser Runtime previously loaded all of an account's entities before serving
almost every API request. Even health checks, generation receipts, one selected
conversation and a single Library export loaded unrelated conversation bodies.

The existing account-wide read now runs only in branches that need a list,
owner-wide message/memory-ID lookup, duplicate detection or history import.
Pure health/capability/diagnostic metadata needs no entity read. Selected
conversation, Library and creator operations use their existing direct reads.
These requests carry the owner captured at entry through conversation/prompt
lookups; the list helper and final response still reject account changes.
No API response contract, database version, generation logic or dependency changes.

## Fresh local evidence

- Web typecheck succeeded.
- `deviceReads.test.ts`: 41 cases passed. Health/status/capability routes return
  valid responses even when opening entity storage throws. Conversation reads
  select the requested owner/ID; Library bindings and old revisions, pending
  generation, unsent input and authored content survive writes. Generation status
  reads only its account metadata. Lists, ID lookup, duplicate detection and
  imported histories retain their existing behavior, including numeric message
  IDs above the owner's high-water mark. Account switches return 409 and retain
  both owners' data.
- Related Library, generation, research, import, sync and transport checks:
  seven files / 149 cases passed including those 41 cases.
- `tests/e2e_memory_language.py`: three actual Chromium/IndexedDB cases passed
  at JA/EN 393px light and EN 1280px dark, including saved memory edits, canceled
  erasure, quote-consent withdrawal and no horizontal overflow.
- `tests/e2e_device_export.py`: initial and new-document reads passed for six
  export formats, immutable revisions, original bytes, foreign-account denial,
  duplicate choice, atomic failure and concurrent replay. Native parsers decoded
  the fixture bytes; no external/API traffic was allowed.

## Remaining limits

Lists, owner-wide ID searches, sync and import still materialize account-wide
entities in their existing paths. A selected large conversation still loads as
one object. These tests establish read scope and preserved behavior, not browser
RSS, 250 MB/1 GB capacity, inference speed or Android/iPhone acceptance.
