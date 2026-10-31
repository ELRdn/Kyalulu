# Segmented Device Research persistence (2026-10-31)

Research previously placed the entire experiment, session history, result turns and
raw prompts in one IndexedDB meta value. Listing and interrupted-job recovery used
getAll and retained every full experiment even when only catalog metadata was needed.

## Change

`deviceResearchStore.ts` now owns the existing owner-scoped experiment key. Each new
write serializes the complete experiment through the existing 1 MiB part writer;
the meta value retains only catalog fields, revision and a body manifest. The full
body retains legacy extension fields. No experiment becomes a synced conversation.

The catalog checksum binds owner, experiment ID, metadata, revision, optional job
and body manifest. Reads verify every body part and compare decoded catalog fields
against the header; session owner, local storage policy and experiment identity must
match. This detects accidental corruption and mismatched local records, not an
attacker able to replace data and recompute all checksums in the same origin.

Writes compare the durable revision, verify previous part bytes before replacement,
and commit new parts, catalog and old-part removal in one guarded transaction.
Quota, corruption and account changes leave the previous durable record intact.
Existing inline experiments remain readable and migrate only on a successful write.
The original request/benchmark/ratings keys and public JSON contracts are preserved.

Catalog iteration retains only metadata per cursor step and never reads segmented
experiment bodies. Recovery and benchmark finalization reopen only experiments
marked running, one at a time; completed histories are not loaded for catalog work.
Details, replay and exports still read the selected complete body.

## Local validation

- Full Web: **1,450 passed / 92 files**, **12.09 s**.
- Focused Research route/store: **31 passed**, **5.98 s**. Store checks use the
  existing transaction harness; route tests mock the storage boundary separately.
  They cover legacy extensions, scoped roundtrip, superseded-part removal, unrelated
  outbox/entity preservation, quota/account/CAS rejection, missing/checksum/manifest/
  catalog corruption and rollback. Real IndexedDB evidence is recorded separately.
- TypeScript passed; unified Vite build **10.57 s** with the existing relay origin.
- Native importers verified **30 browser export contracts**.
- Existing real Research UI driver: **2/2**, JA/393/light and EN/1280/dark. Eight-turn
  synthetic inference, ratings/download, reload, account boundaries, explicit and
  navigation stop persistence passed with no external attempts or page errors.
- Existing BenchmarkLab UI driver: **2/2**, paired32-turn matrices, independent
  Native export validation, navigation continuity, cross-tab cancellation, reload
  interruption and owner separation. EN also verifies model-load timeout and all
  100 synthetic turns with IDs1..199; no synced entities or horizontal overflow.
  This full UI run took approximately seven minutes; it is functional evidence,
  not a speed target or a before/after performance comparison.
- Independent [multi-part browser acceptance](2026-10-31-unified-research-storage-browser.md):
  **19/19**, **4,566,410 bytes / five parts**, complete physical/full-body oracle,
  zero completed-catalog body reads, semantic-body corruption and late rollback,
  23 owned contexts closed and four process relaunches. All **325** input hashes
  were unchanged and rechecked against the final parent source.
- Corresponding-source fixture/helper closure: **3 passed, 10 deselected**, **11.47 s**.

Logs: `.artifacts/research-storage-web-all.log`, `research-storage-unit-final.log`,
`research-storage-typecheck-final.log`, `research-storage-unified-build.log` and
`research-storage-ui.log`. Browser UI result: `.artifacts/device-research-browser/results.json`.
Benchmark log/result: `.artifacts/research-storage-benchmark.log` and
`.artifacts/device-benchmarks-browser/results.json`.
Independent report retained as `.artifacts/research-storage-browser-result.json`,
SHA-256 `5b1c8459f7b4a65107f06fdafcc4360ccd4090244431a80f38525f66fa60e2af`;
source closure `b02787576905dd2afde3309817b9eaf6a5de5947edebeabda409eaf8aa6cc9b7`.
Closure log: `.artifacts/research-storage-source-closure.log`.

## Limits

Each write still walks the complete in-memory experiment and hashes prior part bytes;
this is segmented persistence, not an incremental result journal. The active Research
actor, selected detail/replay/export, raw_prompt strings, catalog metadata and current
messages remain whole. Legacy inline values are still cloned one at a time until
rewritten. No complete actor/RSS/1 GB, physical-device, real-model, crash/power-loss,
latest-package, hosted CI or production acceptance is inferred from these checks.
