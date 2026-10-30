# Bounded browser acceptance: scoped memory source projections

The independent fixture exercises the current uncommitted Web implementation in
real installed Chromium and IndexedDB. It imports the product modules directly;
there is no API server, inference Worker, model download or provider request.
Product code, Git state and other tests are outside this change.

## Changed files

- `tests/e2e_memory_source_projection.py`: owned loopback Vite, disposable browser
  profiles, network guard, scenario evidence and browser restart orchestration.
- `tests/fixtures/memory-source-projection.html`: synthetic sources and direct
  `readMemorySource` / `scopedSessionMemory` / `scopedMemoryAddress` /
  `saveScopedMemory` acceptance assertions.
- This validation note.

The fixture reuses `tests/browser_fixture_server.local_vite` and
`tests/fixtures/storage-fixture.ts` (`physicalSnapshot`, `fixedOutbox`). Sources
are created by real `commitDeviceMemoryDomain` commits. Both source conversations
use `bindMemoryScope` with identical world identity, placing them in one pool.

## Evidence and reproduction

From `D:\VibeCoding\my zeta`, with the already installed Python dependencies:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
python -u tests/e2e_memory_source_projection.py 2>&1 | Tee-Object -FilePath .artifacts/memory-source-projection-browser/run.log
```

The installed local browser-path default applies only on Windows. Ubuntu uses
Playwright's normal browser discovery; an explicit environment setting wins on
either platform. Ubuntu execution is left to the parent's CI run.

The recorded run passes **13/13 scenarios**, using installed Chromium
**151.0.7922.34**. Each large peer has **80 messages, 2,305,905 UTF-8 JSON bytes
(about 2.20 MiB), and 3 physical parts**. Histories include nonsequential IDs,
UUIDs, Unicode, escaped strings, before/after snapshots and extension fields.

Parent-usable raw evidence (absolute paths):

- `D:\VibeCoding\my zeta\.artifacts\memory-source-projection-browser\result.json`
  — per-case assertions, observations, injected-write counts, rejection errors,
  restart outcomes, browser version and before/after SHA-256 of the five relevant
  product files.
- `D:\VibeCoding\my zeta\.artifacts\memory-source-projection-browser\run.log`
  — raw command output and per-case timing.
- `D:\VibeCoding\my zeta\.artifacts\memory-source-projection-browser\vite.log`
  — owned fixture-server output.

The runner updates `result.json` after each case, keeps failed cases red and exits
nonzero on failure. Product hashes must remain unchanged during the run for the
overall result to pass; it never writes those files. Each normal case reloads the
page and verifies complete entity, domain, receipt and fixed-outbox hashes from
fresh module state. The quota case instead closes Chromium and reopens the same
disposable profile before verifying those hashes. Browser contexts are closed,
their browser connections are checked disconnected, and owned Vite is stopped.
The successful run closes **14 persistent contexts**, including **one browser
restart**. External/API requests, WebSockets and page errors are **zero**.

## Cases

| Case | Required observed behavior |
| --- | --- |
| `read-projection` | All three parts parsed; `finish().messages.length === 0`, count 80, no message callbacks. Returned `MemorySource` and scoped records have metadata without `messages` or a full `payload`. Both session and address context loading use this representation. Physical storage is unchanged. |
| `rewrite-local` | Only changed peer projection is written; no full actor update. Source validation and streamed rewrite each count 80 callback messages, keep zero messages in the completed root, and invoke one message callback at a time. Peer revision/token advance; `dirty` remains false. |
| `rewrite-sync` | Same streamed behavior with `dirty === true`; unchanged actor remains physically unchanged. |
| `isolation` | Equal conversation IDs in a second account remain untouched. Local and sync domains stay separate. Cross-account reads/commits and cross-policy commits reject. A forged cached local policy cannot authorize a source whose verified body says sync. |
| `revision-conflict` | A concurrently saved draft makes the old context fail without changing any persisted bytes. A fresh context succeeds and preserves that draft. |
| `body-token-conflict` | A replacement token with unchanged revision makes the old context fail. A fresh context succeeds. |
| `corrupt-late-part` | A valid JSON ASCII substitution in the last part, without updating its checksum, rejects both read and commit. All stored bytes stay unchanged by the rejected operations. Verified part restoration permits retry. |
| `missing-late-part` | Missing final part rejects read and commit; verified restoration permits retry. |
| `invalid-discarded-json` | A multi-part body has a matching SHA-256 but an invalid `\q` escape in discarded message content after byte 1,100,000. Read and commit reject without persisted changes. Repair restores the original header and all original parts before retry. |
| `rewrite-late-corruption` | Initial source validation passes. On the writer's second scan, a bad last part is injected inside the transaction only after tentative peer output exists. Full actor, tentative peer output and injected corruption all roll back; the same context then succeeds. |
| `owner-switch-read` | Switching account during a peer-part read rejects without writes; restoring the owner permits retry. |
| `owner-switch-write` | Switching account during source verification rejects the commit without persisted changes; restoring the owner permits retry. |
| `quota-atomic` | A real pending domain/actor/receipt is seeded. Completion updates a full actor and streamed peer projection together. Injected domain-header `QuotaExceededError` aborts all changes; retry completes and survives an actual Chromium close/relaunch. |

In the dedicated rewrite checks, the entire canonical payload except top-level
`memories` is compared with its baseline. This includes every message, draft,
summary, before/after snapshot, unknown field, message ID and UUID. The updated
memory must keep its ID, UUID, own source session and source message IDs. Unknown
header fields, server revision, pin and deletion state are preserved. Old peer
body parts are removed after successful replacement. The full actor update in
the quota case is independently compared with the requested payload and retains
its unknown header. Fixed outbox header, token, all part hashes and logical body
stay unchanged in every case.

The quota injection occurs after **one actor header, one peer header, four entity
parts and one domain part** have been issued, exactly at the domain-header put.
Receipt writes occur later, so the failed completion makes **zero receipt-write
attempts**: its original pending receipt must remain unchanged. Every entity,
metadata entry and part is compared before/after rollback (part length and
SHA-256 cover every stored byte). Retry checks the completed receipt, cleared
pending domain and both committed source revisions.

A development run initially mislocated the late-rewrite fault by requiring two
flushed output parts before the final input part. The writer legitimately has
one flushed part and buffered output there. The fixture now requires observable
tentative output before injecting, while retaining the full rollback assertions.
That fixture-only failure is retained as
`fixture-instrumentation-failure.result.json` and
`fixture-instrumentation-failure.run.log` in the evidence directory; it was not a
product failure. No product workaround was introduced.

## Parent integration checks

The parent change adds a distinct `MemorySource` metadata type instead of casting
partial data to `AppEntity`. `readMemorySource` validates all stored parts with a
zero-message parser. Memory-only writes validate message IDs and before/after
source references sequentially, then rewrite the complete history with only the
top-level memory projection changed. Owner, revision, body token, verified body
policy, domain binding and generation receipt checks remain in the same commit.
Full actor updates retain the existing complete-entity contract.

The integrated source passes all **1,378 Web tests / 86 files**, including **11 new
projection unit cases**, TypeScript checking and the unified production build.
The parent also reran `tests/e2e_device_memory_scopes.py`: actual common memory UI
at JA/393px and EN/1280px, synthetic generation/shared recall, original snapshots,
explicit migration, erasure and reload checks pass with no external/API requests
or page errors. These checks use existing installed dependencies.

The new driver is wired into both OS jobs in `runtime-web.yml`; the driver,
fixture and its local helper imports are included in corresponding sources.
The Windows-only browser-cache fallback is conditional on `os.name == 'nt'`;
Ubuntu uses Playwright's normal installed browser location. CI results remain a
separate gate.

## Remaining limits

This accepts the bounded storage/projection mechanism, not memory usage at
arbitrary scale. Assertions observe zero retained root messages during feeds and
at finish, metadata-only returned records, and sequential single-message
callbacks. They do not measure process RSS/heap or prove a universal RAM ceiling.
Metadata, scalars and each callback's decoded message may remain whole; the
physical snapshot helper deliberately materializes bytes outside the observed
product operation for comparison.

No new real-model or API-generation acceptance, 1 GB capacity, UI, physical-device,
abrupt-kill recovery, sync transport, CI, deployment or production claim follows.
`tests/e2e_device_memory_scopes.py` covers the separate generation/API workflow;
it and the parent's unit/TypeScript checks were not rerun by this task. Source
isolation refinements by the parent require a fresh run against the new hashes.
