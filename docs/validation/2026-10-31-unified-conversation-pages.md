# Conversation page reader

This adds a store-level reader for conversation windows and connects the Device
chat screen to pages of at most 50 saved messages. Cloud and PC history contracts
are unchanged. Generation, mutations, sync, recovery verification and export still
use their existing complete data.

`conversationPage` returns a separate type with messages, metadata, total count and
positional ranges. It cannot be passed as an `AppEntity` to the typed save API. Its
cursor binds owner, conversation, revision, body token and explicit start/end
positions. Message IDs need not be sorted. Short pages at either end navigate without
overlap. A metadata-only pin/open update retains the body cursor; changed revision or
token requires a fresh read.

The shared JSON decoder retains the selected range or a bounded tail array. Discarded
strings and numbers are validated incrementally without accumulating their tokens.
UTF-8, JSON syntax, depth and all part lengths/checksums remain validated before a
result is returned. Duplicate keys retain the platform's last-value semantics and
`__proto__` remains an own data property. Default full reads keep their contract.

No schema version, saved manifest or sync wire changes. Reads use a single readonly
transaction and recheck owner after completion. Missing, deleted, wrong-kind, evicted
or malformed conversations do not become successful empty histories.

## Original reader checks (1836a57)

- The JSON suite checks range/tail results and duplicate keys, the shared syntax
  corpus and byte boundaries, discarded invalid UTF-8/escapes/numbers, nesting,
  million-character discarded strings/numbers, tail count bounds and option copying.
- Real Chromium/IndexedDB passes 29 scenarios. Six page scenarios cover bidirectional
  ranges, legacy inline data, metadata preservation, readonly behavior, stale/foreign
  cursors, owner changes during parts and on completion, and first/last part corruption.
  Valid checksums do not bypass malformed JSON or UTF-8, including discarded data.
- Full Web suite passes 1,263 tests in 83 files; TypeScript and a unified production
  build pass. These checks do not establish physical-device or production acceptance.

## Separate 1 GB sample diagnostic

An SHA-256-matched copy of the existing fictional 1,000,000,000-byte profile was read
with Chromium 151 under the unchanged 4 GiB owned-Job/working-set limits, 480-second
deadline and 2 GiB available-memory floor. No forced GC or heap snapshot was used.

Latest, first and middle windows of 50 messages each matched the original deterministic
generator, including the shorter final message. Each read validated all 954 parts;
the manifest matched the historical baseline and the stored header was unchanged.
All 15,240 messages were counted, but only 150 decoded bodies were compared.

The three reads took 61,355 ms in total. Sampled aggregate working-set peak was
1,207,033,856 bytes; Job peak commit was 637,190,144 bytes. These are different
metrics, not a physical-device RAM requirement. No owned process remained after
cleanup, and no blocked external request or page error was recorded. Source profile
and measured source hashes were preserved.

This passes the named page sample under the test budget. It does not accept the old
full-tree restore, all decoded bodies, UI, generation or sync at this size. Repeated
full scans also leave substantial latency to address before claiming a responsive UI.

## Limits and remaining integration

Every page scans and validates the entire payload: I/O is O(total bytes). This is not
an indexed random-access reader. Metadata, selected scalar values and the current
tail candidate remain whole. Legacy inline records are already cloned in full by
IndexedDB before slicing. Message count alone is not a universal memory bound.

The Device history/settings/session summaries/policy now use compatible projections.
Recovery verification, generation, mutation, shared-memory validation, fixed sync
snapshots, receive/ACK and exports retain full reads. The previous 1 GB full-tree
restoration failure stays unaccepted; a successful page sample must not replace it.

## Device screen integration

- The Device API shares only in-flight latest-page reads between settings and
  history. Completed page payloads are not cached. Opening updates only `opened`,
  after body validation and owner/revision/token checks.
- New conversation writes include a token-bound count and 160-character preview
  in their existing header. Legacy or stale summaries fall back to a verified tail
  read. Listing does not hydrate evicted rows or mark conversations opened. Header
  policy reads avoid restoring the body; no database version or sync wire changes.
- Previous/next/latest replace the visible window. Sending and regeneration require
  the latest page; the composer draft survives navigation, stale cursor rejection
  and reload. Editing blocks page navigation; background history reads preserve an
  unsaved message editor. Settings autosave resumes after paging.
- Memory, summary and story tools load when opened in the visible panel. Closing
  tools retains their edit drafts. Fixed story labels support JA/EN; authored cast
  data retains its original language.

Current local checks: TypeScript, unified production build, **1,298 Web tests in
84 files**, **32 Chromium/IndexedDB scenarios**, **3 memory UI cases**, and
**24 commercial UI cases** pass. The new real-App fixture passes JA/393/light and
EN/1280/dark: one initial conversation body read, at most 50 rendered messages,
bidirectional navigation, concurrent revision rejection, editing, draft reload,
send/regeneration retaining all 152 saved messages, lazy tools, retained memory
draft and account isolation. Loopback/API network leakage and page errors are zero.
The new fixture is included in Windows/Ubuntu CI.

These screen checks use 150 seeded messages, synthetic OPFS readiness and a fake
inference Worker. They establish neither real inference nor 1 GB UI/generation/
recovery/sync acceptance, physical-device acceptance or production readiness.
The earlier 1 GB sample above was measured on the original reader revision.
