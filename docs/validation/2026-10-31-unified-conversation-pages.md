# Conversation page reader

This adds a store-level reader for conversation windows. Runtime API and screen
adapters are not connected yet; full-history rendering, generation, mutations, sync
and export still need their existing complete data.

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

## Local checks

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

Active-chat history/settings/session summaries/policy/recovery must use compatible
projections before a UI memory claim is possible. Streamed mutation, shared-memory
validation, Worker context/Lore selection, fixed sync snapshots, receive/ACK and
exports remain separate work. The previous 1 GB full-tree restoration failure stays
unaccepted; a successful page sample must not replace that result.
