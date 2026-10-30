# Streamed shared-memory source verification

Shared-memory commits previously restored each expected source conversation in
full just to compare its revision and storage policy. The commit now checks the
stored identity, kind, revision and deletion state, then verifies every original
part, byte length, SHA-256, UTF-8 sequence and JSON structure with the existing
zero-message decoder window. Message bodies and snapshots are validated without
being retained in the decoded tree. Policy is read from the verified body rather
than trusting the cached header selection.

This is a verification-only result, not a partial `AppEntity`. Canonical source
headers and pieces are not rewritten by this step. The domain, requested own
projections and generation receipts still commit together under the existing
owner, policy, revision, source-attribution and pending-generation checks. Inline
legacy bodies remain compatible; missing, deleted or conflicting sources retain
their existing rejection/update rules.

Local checks:

- TypeScript and unified build pass. All **1,325 Web tests / 84 files** pass.
  The new unit regression observes zero retained messages, checks every source
  part is read and confirms canonical source and fixed outbox preservation.
- **53 real Chromium/IndexedDB scenarios** pass. Five new source-verification
  scenarios cover a multi-part 120-message history, missing final part, malformed
  JSON in discarded content with a valid manifest hash, forged cached storage
  policy, owner switch during a source read and domain-write quota failure.
  Canonical source, independent fixed outbox and domain rollback are checked.
- Existing shared-memory UI/storage and cross-document execution-lock browser
  fixtures pass. They use fictional Worker readiness/inference. External requests
  and page errors are zero, and owned browsers/Vite processes are closed.

This removes one full-history restoration from the memory commit path. Generation
still loads its complete conversation, shared-memory context loading still keeps
source records and updates still accept complete canonical projections. Memory
domains, metadata, scalars and legacy inline rows remain whole. These checks do not
accept full-generation or large-domain capacity, real-model parity, physical-device
behavior, packages or production. Production cutover remains on hold and PR #9
stays Draft.

Windows push CI for `8d7f401` timed out at the default 5-second unit-test limit in
the newly added source-verification regression; its other 1,324 Web cases passed.
The regression compared complete megabyte-scale typed arrays through the assertion
framework. It now checks every source piece by length and SHA-256, retaining the
multi-part requirement, all-piece-read count, zero-message retention, unchanged
canonical header and fixed-outbox assertions. The deadline and runtime code are
unchanged. The local 34-case store suite passes in about 0.8 seconds; a new CI run
must establish Windows acceptance rather than treating the local timing as proof.

## Separate historical 1 GB source-verification diagnostic

A fresh SHA-matched copy of the original fictional 1,000,000,000-byte profile
completed the actual `commitDeviceMemoryDomain` source-verification path under
the owner execution lease. All **954 parts** and the complete manifest checksum,
UTF-8/JSON structure and policy were checked. The decoder counted **15,240
messages** while retaining zero message objects. Source header, token, manifest
hash and source part count remained unchanged; an empty memory domain committed
at revision 1. Message contents were deliberately discarded, so this diagnostic
does not independently compare every decoded message body to a generated baseline.

The commit took **27,354 ms**. Aggregate owned-process sampled working-set peak
was **992,874,496 bytes**, and OS Job peak committed memory was **418,975,744
bytes**; these are distinct metrics. Limits stayed at 4 GiB, 480 seconds, at least
2 GiB available memory and 8 GiB free disk. No forced GC or heap snapshot was used.
Original-profile and measured-source hashes matched before/after. External
requests, WebSockets and page errors were zero, owned browser processes exited
gracefully and the owned Vite server exited. This accepts this named verification
on this host. It does not replace the earlier failed full-tree restoration or
prove full generation, shared-domain scale, sync, UI, physical devices or production.
