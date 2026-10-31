# Device generation diagnostics: one canonical stored receipt

Device completion previously copied diagnostic prompts, compiler output and memory
traces into both the generation receipt and conversation/Research bodies. Debug
and experiment detail also restored those copies as complete trees. New completed
generations now store diagnostic sections once under an owner/holder-bound
`device-generation@1` manifest; authored conversation/Research rows retain compact
references. Conversation history, drafts, numeric IDs and pending-generation
guards remain in the existing atomic transaction.

## Storage and compatibility

- `deviceGenerationRecords.ts` is the transaction-only writer/erasure leaf.
  `deviceGenerationStore.ts` supplies verified reads and incremental export.
  Sections contain receipt, exact pre-fit input, compiler, memory, telemetry and
  attempts. Equal memory aliases share one section; unequal aliases remain exact.
- Input is serialized directly with the existing chunk writer instead of making
  a second complete `raw_prompt` string. Compatibility export reconstructs the
  same JSON string and aliases, preserving unknown receipt extensions.
- Small reads retain their former self-contained shape. The 1,500,000-byte inline
  limit covers the entire expanded receipt, including both memory aliases.
  Larger reads expose stored byte count/SHA-256 and an explicit export action.
  Export chunks are at most 1 MiB; owner, holder, section hash/size/JSON and catalog
  are checked through successful EOF, including after the closing brace. Invalid
  BOM-prefixed section JSON is rejected even after the inline parser is released.
- Debug uses bounded history metadata and the original saved portable snapshot for
  story cast. Missing/corrupt/erased diagnostics never substitute current settings
  for the original generation prompt. Research detail applies the combined-result
  boundary; experiment and per-turn exports reconstruct the canonical turns.
- Older inline diagnostics are retained before replacement. Missing eligible
  receipts can be converted; conflicting/invalid originals abort the transaction.
  No eager conversion of old databases is required.
- Holder deletion removes its physical section closure and retains a tombstone.
  Memory-source erasure scans all owned generation headers, prunes referenced
  traces and removes prompt/compiler/attempt sections while preserving authored
  replies. Compact references make the memory index unknown, never falsely empty.
- Sync send/receive/rebind removes local diagnostic references and reply hashes.
  Already-frozen inline or segmented outboxes containing such references fail
  before network transmission and retain their exact original bytes.

## Upgrade and recovery

The existing IndexedDB version fence advances from 3 to 4 so an older client
cannot modify canonical records without understanding their parts. Stores and
indexes remain compatible; v3 entity/outbox headers and physical parts are not
rewritten by the upgrade. Test-only readers use versionless opens after creation.

Close other app tabs and explicitly update the PWA before retrying a blocked or
old-client open. Do not delete the database or force an in-place downgrade. A v3
client cannot reopen an upgraded v4 database; source rollback alone is therefore
not a device-data rollback. Keep originals and use the existing separate-copy
restore/migration procedure with a compatible client. Production restore and real
browser-profile recovery were not performed by this change.

## Defects reproduced during validation

Independent helper checks reproduced catalog mutation/abort after the final
export chunk. EOF fences now reject both. Two malformed-BOM regressions also
failed before the shared section guard was added. Actual 100-turn Chromium
Benchmark caught compact Research rows losing typed user/message IDs; the compact
field list and single/combined large-result assertions now preserve them.

Four final read/erasure regressions reproduced stale diagnostic disclosure when
another tab erased a memory source or deleted the holder between reading a
receipt and the final debug catalog check. Both inline data and large saved cast
could survive the error branch. That branch now drops the cached generation
diagnostics and story before returning the verification failure. The regressions
perform the actual erasure transaction, rather than only forging its response.

## Validation

| Scope | Result | Evidence boundary |
|---|---|---|
| Full Web | 1,683 tests / 99 files; TypeScript and unified build pass | Development dependencies; fictional HTTPS Relay origin |
| Final erasure/read race | Four failures before the fix; 117 related read/storage/UI tests pass afterward | Actual erasure code with fictional transactional IDB harness |
| Source/bundle/fingerprint/runner tests | 47 pass | One pytest-cache write warning; no test failure |
| Segmented IndexedDB | 54/54, including v1/v2/v3 upgrade, exact v3 physical preservation, blocked/late opens and versionchange | Real isolated Chromium; no existing browser profile |
| Initial sync staging | 30/30, unchanged old oracle and independent Python decoding | No assertion/deadline relaxation |
| Generation commits | 84/84 normal/scoped/regeneration/stop/quota/owner/revision/token cases | Synthetic Worker, complete receipt reconstructed by test oracle |
| Memory scopes | Identity, shared provenance/dedup, orphan recovery, atomic erasure, quota, owner/policy and reload checks pass | Real IDB/Web Locks; no real inference |
| Research / Benchmark | JA393/light and EN1280/dark, 2/2 each; paired 32 turns, export shape, cancellation/reload/owner checks; EN load timeout and 100 turns | Synthetic inference; 100 turns were not also run in JA |
| File saving | 16/16; exact bytes/checksum and original-file preservation | Real OPFS sink; native OS picker substituted |
| Receive projection | 26/26; source hashes unchanged, owned contexts/browser/server closed | Current local source; not a reproduction of the hosted failure below |

The seven-driver final suite pins **352** input hashes and requires identical
sources after every driver and at exit. Evidence is retained privately in
`.artifacts/diagnostic-store-canonical-final-browser-20261101/` and its log;
full Web/type/build and source-test logs use the `diagnostic-store-canonical-`
prefix. The extra receiver run is in
`.artifacts/diagnostic-canonical-projection-20261101/`.
Staging's whitespace check then removed one redundant trailing CRLF from
`deviceGenerationStore.ts`. Reconstructing that exact prior byte representation
matches the frozen hash; the other 351 inputs remain byte-identical. This sole
formatting difference is recorded in `post-run-whitespace.json` beside the suite.

These results follow the final stale-debug correction. Earlier successful runs
before that correction, the earlier unstable-source browser run, and the older
typed-ID Benchmark failure are not substituted for this final source snapshot.

Published parent `543c903` PR run `41242147737` succeeded on Ubuntu but failed on
Windows: 25/26 receive-projection results passed; `quota` failed at **Page.goto**
with `net::ERR_NO_BUFFER_SPACE`, before the fixture assertion. The current local
unchanged driver passes all 26 cases. This does not establish the hosted resource
failure's cause or resolution. No retry, longer deadline or weakened assertion was
added. The parent's push run `41242143247` Windows result was still pending at
the last check; no aggregate CI success is claimed.

## Remaining limits

This is fictional data and synthetic inference on a development PC. Real model,
Android/iPhone, native OS picker, disk exhaustion, 250 MB/1 GB/RSS and release
acceptance remain open. Actor admission/Worker clone, compiler/Lore concatenation,
ONNX counting, legacy inline scalars, saved authored Research bodies and active
Research metrics still have whole-value allocations. No full diagnostic backup
or cross-device transfer of this private canonical store is claimed. Native/Cloud
packages need rebuilding from the final source; older package evidence does not
cover this change. Provider/region gates and production cutover remain closed.
