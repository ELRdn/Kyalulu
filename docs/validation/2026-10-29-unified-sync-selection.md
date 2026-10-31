# Browser sync selection acceptance — 2026-10-29

## Scope

`receiveSyncPage` and acknowledgment persistence in `apps/web/src/lib/appSync.ts`
now walk owner records one at a time, retaining the identity set and numeric-ID
maximum while retaining bodies only for target entities and referenced current/
historical Library/creator documents. This replaces the two whole-owner `getAll`
arrays and Maps in those write transactions. Wire format and DB version remain
unchanged. Existing source/branch preservation, immutable snapshots and atomic
commit still apply.

The driver reuses `local_vite`, installed Playwright Chromium and
`tests/fixtures/unified-history.json`. Every scenario starts in a fresh browser
context, verifies empty localStorage/IndexedDB and uses fictional accounts only.
Service workers are blocked. Only the owned loopback Vite origin is allowed;
actual API and external requests are aborted. Ack tests use an in-page fictional
status/pull peer and an already applied outbox receipt, without uploading data.
Vite logs are temporary and removed by the driver; JSON evidence is printed to
stdout and may be redirected to an ignored local evidence file.

## Scenarios

1. Receive two conversations amid 160 unrelated owner conversations. Allocate
   above their message-ID maximum (50,000), ignore a foreign owner's 9,000,000,
   preserve an existing UUID's numeric ID, rebind current/historical memory and
   summary sources, retain Library/creator revisions 1/2 and local current revision
   3, preserve unrelated records, and commit cursor/remote receipts. A separate
   Library ID occurs only in historical settings; a separate creator ID occurs
   only in historical state. Both have preexisting local revisions that must
   survive, detecting omissions from the selected-reference ID set.
2. Missing historical Library and creator revisions independently reject a page
   after a valid earlier conversation; compare all entity/meta values before/after.
3. Conflicting immutable Library and creator revisions independently reject the
   entire page with the same full rollback comparison.
4. Protect an unsent dirty original; reject a device-only overwrite, a deletion
   recovery UUID colliding with an unrelated record, and a branch acknowledgment
   colliding with an unrelated record. Failed transactions retain the outbox.
5. Apply a cached branch acknowledgment using owner-wide numeric maxima; retain
   the original, rebind the copy and atomically clear the outbox.
6. Switch owner on cursor row 23, separately during receive and acknowledgment;
   preserve entities, cursor, sequence and receipts/outbox exactly.

During sync write transactions containing `entities` and `meta`, calling
`entities.getAll` aborts and fails the test. Real cursor success events are
counted, including any foreign-owner row. Readonly assertion snapshots and
existing readonly sync orchestration reads are outside this guard.

## Execution

The receive/ack fixture at `6c8cdf4` was rerun after the skipped-payload compatibility
adjustment and passed **6/6 scenarios** on installed **Chromium 151.0.7922.34**,
using real IndexedDB. Exit code: **0**. Web typecheck and **53 appSync unit tests**
also passed. The added unit cases preserve handling of malformed remote payloads
that dirty/newer local revisions already skip, and cover unrelated numeric maxima
and unrelated recovery/branch identity collisions.

Tested `apps/web/src/lib/appSync.ts` SHA-256:
`d7f355ee004c530590e2bbbdc17c09d6ebde2b1333c94ee053ee0023cceec1b0`.

| Scenario | Result | Receive cursor rows | Ack cursor rows | Evidence |
| --- | --- | ---: | ---: | --- |
| receive | PASS | 165 | 0 | Existing ID 42 retained; seven new IDs 50001–50007; historical-only references and local current versions retained |
| missing | PASS | 320 | 0 | Missing Library and creator revisions each roll back the whole page |
| mismatch | PASS | 324 | 0 | Conflicting Library and creator revisions each roll back the whole page |
| protections | PASS | 644 | 161 | Unsent original retained; device-only overwrite, recovery collision and ack branch collision rejected |
| ack | PASS | 323 | 161 | Branch gets ID 50001, original retained, outbox cleared atomically |
| owner-switch | PASS | 184 | 23 | Two owner switches injected at cursor row 23; entities/meta remain identical |

Each scenario reported **0 forbidden getAll attempts**, **0 foreign cursor rows**,
**0 actual API/external requests** and **0 uncaught page errors**. All successful
scenarios also asserted DB version **2**. Row totals include repeated subcases
and, for ack orchestration, the empty download pages before/after receipt adoption.
The ack fixture seeds the numeric sequence at 50,000 so failed ack transactions
can be compared value-for-value with their initial values; the receive fixture
starts the sequence at 7 and independently proves discovery of the unrelated
50,000 maximum. Every row count is an event count, not a memory measurement.

```powershell
python -B tests/e2e_sync_selection.py
```

The host's installed Chromium was used because the sandbox has no browser
installation. No new dependency is installed.

## Outgoing selection and count follow-up

The remaining `allEntities(owner)` calls in `synchronize` are removed. A readonly
owner-ranged cursor retains the first 50 dirty sync entities in key order while
continuing to search for the first deletion, which still takes the entire batch.
It resolves only the selected conversations' current/historical Library/creator
references with individual reads in that same readonly transaction. Embedded
snapshot fallback, immutable validation, source revisions and exact deletion
confirmation fields retain the existing behavior. Final dirty counts include
device-only records and exclude foreign accounts without retaining body arrays.

Four additional real IndexedDB scenarios cover:

- 55 dirty sync conversations plus a dirty device-only and foreign conversation;
  one batch of 50 in key order, six remaining owner records and no automatic
  second batch. An unselected missing reference is never resolved.
- The first deletion beyond the 50-record cap, both exact/mismatched confirmation
  revisions, and retained bodies/outbox after the fictional peer rejects it.
- Current/historical references from stored or embedded snapshots, deleted-source
  fallback, invalid revisions, and a concurrent writer proving all reference
  reads use the selection transaction's snapshot.
- Nine owner/generation/consent changes during selection, reference lookup and
  final counts. No stale batch is sent or staged and entity bodies stay intact.

The final-count consent case first reproduced a stale `saved` status after
withdrawal (**9/10 scenarios passed**). Rechecking consent before reporting the
final status fixed it. The final fixture passed **10/10 scenarios** on Chromium
**151.0.7922.34**, with **0 forbidden getAll calls**, **0 foreign cursor rows**,
**0 real API/external requests** and **0 uncaught page errors**. The final
**63 appSync unit tests** also passed. LF-normalized `appSync.ts` SHA-256:
`b980d6ead603f1d6e9b3a42d8f883832696f02e038dc772c9238998897a1421c`.
Local JSON evidence is `.artifacts/sync-selection-outgoing-20261029.json`.

## Fixed source and package provenance

The clean corresponding-source export of
`6c8cdf4634274e90557055ffdcc0264f7529ce0f` passed **831 Web tests / 66 files**
and `build:app` with `VITE_RELAY_ORIGIN=https://relay.kyalulu.com`. Its locally
prepared Cloud archive has SHA-256
`110b3a137d78d14180846badc98dc0fda5cb610c7cd3f6f3d9535018ab214893`.
All **223 manifest entries** and **61 Service Worker precache entries** were
verified; **220 packaged files** matched the clean build/source and **558
corresponding-source files** matched the committed export byte for byte. The
source archive contains 783 files including installed dependency license texts.
These counts use different scopes from the earlier renderer/Runtime-only count.

WASM inputs are reused fixed outputs. This archive was not uploaded to the VPS
or built as a Linux image. The separately accepted
[`bf83d03` image](2026-10-29-unified-container.md) predates these client changes;
its container results do not validate this archive. Subsequent source changes
require a new build, audit and matching image evidence before deployment.

## Limits

This is functional and read-method evidence on synthetic local IndexedDB data.
It does not measure peak memory/RSS or prove that no full-body references remain
elsewhere. UI lists and other storage paths still include account-wide reads.
Sync still scans account records and retains identity sets; selected/decoded
bodies, up to 50 outgoing entities plus referenced documents, and one cursor row
still load complete entities. It does not accept
250MB/1GB capacity, production authentication/wire interoperability, physical
devices, process termination durability or deployment readiness. DB version 2 is
asserted; product wire/schema compatibility requires the parent's separate checks.
