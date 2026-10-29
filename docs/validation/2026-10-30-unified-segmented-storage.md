# Browser segmented persistence: isolated implementation and validation

Task baseline: `5ed8a8312db7d576970479e59f483e0e5931a863` (detached).
Only checkout: `C:/Users/hiron/.codex/worktrees/segmented-browser-storage/my zeta`.
The original `D:/VibeCoding/my zeta` was read only. No commits, Git state mutations, deployment, real API, real accounts, production DB, existing browser profile, or port 5187 were used. The parent's WASM scripts, `.gitattributes`, collector changes and unrelated dirty files are outside this diff. No dependency or lockfile change.

## Implemented contract

- `kyalulu-app-v1` opens at IndexedDB **v3**, adding `parts` and retaining `entities`, `meta`, and `sync-outbox-state`. v1/v2 upgrade does not rewrite entities/outboxes. Inline legacy and segmented records coexist.
- Logical `AppEntity.payload` is serialized by existing `jsonChunks` into sequential UTF-8 byte pieces of at most **1,048,576 bytes**, restored with existing `JsonStream`, and checked with synchronous `Sha256`. The manifest is `{token,size,chunks,sha256}`; each expected piece length and aggregate size/hash are checked. No whole JSON stringify, async crypto, network or promise await advances a live storage transaction.
- Entity pieces are keyed `[owner,'entity',id,token,index]`; independently owned fixed outbox pieces use `[owner,'outbox','fixed',token,index]`. Headers retain identity/revisions/unknown entity fields; JSON payload fields, Unicode, historical before/after snapshots and references round trip.
- Stored selection headers contain policy/cache/pending flags, maximum message ID and its validity, deletion confirmation revision, and only the four source identity fields needed by import duplicate checks. Old inline fallbacks compute the same metadata. Sync scans/counts do not decode unselected segmented bodies. Device import duplicate checks no longer use a whole-owner body `getAll`.
- Sequential transaction-local writes preserve `add` collision rejection, validate old segmented bytes before replacement, and remove surplus/retired owned pieces. Missing/corrupt body parts abort reads/replacements, leaving stored originals intact. Payload/parts, receipts, cursor, recovery, message sequence and original-import bytes remain in their existing atomic transaction boundaries. Quota failures roll all stores back.
- Metadata-only open/pin updates retain physical manifests. The cache stub retains message/memory identities, provenance fields and preview; unconfirmed sync deletion retains its original body. Explicit permanent local deletion may erase its body.
- Fixed outboxes retain independent immutable payload bytes. Request ID/revisions/withdrawal/receipt/count/change descriptors stay in control metadata. Legacy boolean/missing withdrawal flags normalize once to indexable numeric zero. Per-upload guards, withdrawal and cancellation control checks do not restore body parts. Confirmed ACK/cancel cleanup deletes owned part keys sequentially without reading the body; replacement validates the old body first. Missing/corrupt outboxes fail closed on restore/replacement; an explicit confirmed protocol cancellation can still remove its known owned keys.
- Batch preparation remains a readonly entity/reference snapshot followed by a **separate** atomic publish. It is not one transaction across those phases or across network calls. First-deletion priority beyond the 50-item cap and exact revision confirmation remain unchanged.
- Owner and sync-generation fences are checked across segmented I/O callbacks. New DB connections close on `versionchange`; blocked opens reject; rejected late-success connections close. Synchronous action errors retain their original status.
- Device branch's existing `openEntity` recency update occurs before its separate branch transaction. Branch rollback checks permit that `opened` field only; body, revision, sequence, receipts and physical parts still must match.

## Final verification

All commands below run from the isolated checkout. Chromium version: **151.0.7922.34**. Every browser driver uses owned random loopback ports and fresh fictional contexts; no parent browser data is reused. A bounded payload in the new fixture is **4,324,092 UTF-8 JSON bytes**; maximum physical piece is **1,048,576 bytes**.

| Command | Result |
| --- | --- |
| `pnpm install --offline --frozen-lockfile --ignore-scripts --store-dir D:/.pnpm-store` | 558 packages from existing pinned cache; zero downloads |
| `pnpm --filter web typecheck` | pass |
| `pnpm --filter web test -- --pool threads --maxWorkers 1` | 66 files, 853 tests pass (851 existing + 2 message-ID validation regressions) |
| `pnpm --filter web test -- src/lib/appSync.test.ts src/lib/device-library.test.ts src/lib/deviceReads.test.ts --pool threads --maxWorkers 1` | 121 pass |
| `python tests/e2e_segmented_storage.py` | 20/20 pass; no blocked external requests or page errors |
| `python tests/e2e_sync_selection.py` | 10/10 pass; no whole-owner `getAll`, no foreign cursor rows; same readonly reference snapshot |
| `python tests/e2e_offline_cache.py` | 6/6 pass, including restart/race/rollback/fences; maximum 1 outstanding production entity request |
| `python tests/e2e_outbox_guard.py` | 11/11 pass; legacy/segmented fixed bytes; upload guards do not reread physical parts |
| `python tests/e2e_device_quota.py` | 4/4 pass, two fictional owners x new/update, real CDP 128 KiB quota, native `QuotaExceededError`, rollback/reload/retry |
| `python tests/e2e_device_import.py` | setup + reload pass, 48 import cases and 11 media cases |
| `python tests/e2e_device_export.py` | setup + reload pass; original bytes, fixed revisions, duplicate races, rollback and exports |
| `$env:PYTHONDONTWRITEBYTECODE='1'; & 'D:/VibeCoding/my zeta/.venv/Scripts/python.exe' tests/e2e_unified_entry.py` | 2/2 JA/EN actual UI scenarios pass using existing environment, isolated source and temporary fictional backend |
| Python `ast.parse` on all 5 changed/new Python drivers/helpers | pass |
| `git diff --check` with explicit isolated work-tree and `GIT_OPTIONAL_LOCKS=0` | pass |

The 20 new browser scenarios cover Unicode/huge scalar/historical/unknown-field roundtrip; shortened update cleanup; metadata manifest preservation; independent outbox/removal; missing/hash/size corruption; owner isolation and callback fence; failure after two successful part writes and reopen/retry; entity/part add collisions; explicit v1/v2 upgrade and mixed legacy; blocked/late-success/versionchange; receive recovery quota/generation rollback; cached branch ACK rollback/retry/cleanup; exact deletion reconfirmation, withdrawal and cancellation with **zero part reads**; Mobile import receipt/sequence rollback/replay/add collision; real device historical branch/add collision/permanent local removal; and the actual SessionPolicy pin UI.

## Failures encountered and resolved

- First offline install used the default incomplete cache and failed on `@electron-toolkit/utils`. Repeated with the existing `D:/.pnpm-store` used by the parent; all pinned packages were available, with no downloads.
- Early fixture loads timed out because `@fs` relative helper URLs omitted `.ts`; fixed the URLs. A missing SessionPolicy import was found and fixed by typecheck.
- Unit mock adaptation initially lost cursor IDs, original synchronous errors, and deliberate fixture mutations after decoding. Corrected the shared queued 3-store harness and explicit test writes; affected and full suites passed.
- Physical snapshots sent through Python changed undefined values; normalized test snapshots. JSON property order differed after logical restore; replaced order-sensitive equality with canonical equality. Neither failure was data loss.
- Cache race instrumentation counted fixture-generated reads as production requests; excluded only the known fixture race transaction. Production outstanding request bound remains asserted.
- Late-success/versionchange tests initially raced native event dispatch; made their injection/observation deterministic. Branch's legitimate separate recency write is now explicitly accounted for.
- Export quota injection watched `put`, while new imports correctly use `add`; moved the fault to the actual add path.
- Default Python lacked `aiosqlite` for full entry UI. Reused the existing Python environment read only, disabling bytecode writes there; no install.
- A sandboxed `py_compile` could not write the isolated checkout cache; used read-only AST checks instead. Node's existing localStorage experimental warnings did not fail tests.

No known connected-slice check failure remains. This is bounded persistence acceptance, not a deployment or capacity acceptance.

## Optional Windows capacity measurement

The later opt-in driver `tests/e2e_storage_capacity.py` uses a fresh owned Chromium 151 profile, a random loopback origin, fictional independently generated message strings, and the real `appStore` API. Exact UTF-8 JSON sizes are generated without creating a whole JSON string. Only counts/hashes cross CDP. API/external requests, WebSockets and Service Workers are blocked. It is deliberately outside default CI; `--self-check` runs a small save/exit/relaunch/hash case and `--run` opts into 250,000,000 bytes followed by a headroom-gated 1,000,000,000 bytes.

Each size has a 480-second budget, a sampled **4 GiB sum of owned processes' working sets**, a **4 GiB hard Windows Job committed-memory cap**, and a system-available-memory floor. Working-set sums may double-count shared pages; they are neither private bytes nor JS heap. All owned descendants are terminated on failure, and no unrelated process is stopped. These are test safety limits, **not user-specified product capacity requirements**.

| Fictional single payload | Save | Full browser exit/relaunch and verification | Measured peak working-set sum (save / reload) |
| --- | --- | --- | --- |
| 250,000,000 JSON bytes; 3,810 messages, 239 parts | pass, 6,849.6 ms | all part hashes + restored body hash/count pass; restore 4,964.8 ms | 1,456,377,856 / 2,116,321,280 bytes |
| 1,000,000,000 JSON bytes; 15,240 messages, 954 parts | pass, 33,732.8 ms | physical part/hash checks pass; full `entity()` restore stopped at the safety limit | 2,934,947,840 / 4,306,423,808 bytes |

Maximum physical part: **1,048,576 bytes**. In a separate fresh-browser diagnostic, `entity()` restore was attempted *before* the physical verification scan. It also did not complete under the same limits: target closed near the hard Job cap (peak committed bytes 4,298,362,880; sampled working-set sum 4,277,788,672). Thus the preceding verification scan alone does not explain the unaccepted restore. No forced GC, raised limits or product-code workaround was used. This does not establish that 1 GB can never be read on another budget or device; **1 GB restoration is unaccepted under this test configuration**.

Main evidence: `.artifacts/unified-capacity-20261030/20261030-015835-84dac275/results.json`; restore-first diagnosis: `20261030-020434-diagnostic-712c6bf3/results.json` under the same evidence root. Small final self-check: `20261030-020705-474e4aaf/results.json`, pass. Initial sandbox browser startup refusal and earlier intermediate driver revisions remain separate, unaccepted records. Production data was never used. Both large-size runs and the diagnosis ended with zero owned PIDs remaining. Stored fictional profiles are retained.

Final evidence index: `.artifacts/unified-capacity-20261030/acceptance-summary.json`. The driver now explicitly isolates Vite caches and checks this path; the initial attempt's temporary cache-write scope was not established. It did not use production data. The `previous_case` bookkeeping regression checks passed 3/3 after the rename.

This checks persistence for this synthetic distribution, not full chat UI/rendering, generation, sync transfer, private memory, physical-phone capacity or a universal maximum. Decoded object trees remain resident. A later driver bookkeeping fix separates the diagnostic input from the preceding-case variable; the recorded 1 GB restore failure remains unchanged.

## DB compatibility and rollback

**An old client calling `indexedDB.open('kyalulu-app-v1',2)` cannot reopen an upgraded v3 DB**; the browser returns `VersionError`. Never delete, clear, downgrade, or recreate the user's DB as a rollback technique. Preserve `entities`, `meta` and `parts` together.

Before rollout, keep a tested **v3-compatible** recovery/rollback bundle. If upgrade is blocked, let writes finish, close older tabs/connections, update/reload to a v3-compatible client and retry. A rejected late-success connection is closed. If a body is missing/corrupt, keep the original stores and references for explicit recovery/export; do not substitute empty history. Rolling application behavior back still requires a client that understands v3 manifests and legacy inline records.

## Integration and remaining gates

- Apply only the attached isolated diff. Do not replace a directory tree or overwrite the parent's current collector/WASM/`.gitattributes` edits. The focused source JSON lists every changed file and SHA-256; add its new files to the parent's release source collection when assembling the integrated source. This slice deliberately does not edit that parent's collector.
- `e2e_mobile_migration.py` and `e2e_unified_pwa.py` now use a v3-aware same-snapshot logical raw DB reader, and their Python syntax is checked. Their **complete built-bundle runs were not executed here**: they require independently verified unified/Mobile/WASM/legacy artifacts from the parent. Production Mobile import logic is exercised directly by the 20-scenario fixture; this is not a claim that the full migration channel or service-worker build was revalidated.
- WASM build/runtime verification, real model checks, release/source collection integration and production rollout remain with the parent. Existing Chrome profile/5187 is untouched.
- Decoded trees, huge scalar strings, `allEntities` return arrays, library/history/UI clones and Native/Python materialization remain. There is **no 250 MB / 1 GB decoded-memory/RSS acceptance** or mobile-device capacity claim.

## Parent integration and independent review

The isolated patch was applied selectively to `D:/VibeCoding/my zeta` after the WASM tooling commit `fb36822`. Independent review identified a writer/reader nesting mismatch: the writer accepted 65 container levels while `JsonStream` accepts 64. The shared writer now rejects a 65th container. Object/array unit boundaries and a real IndexedDB scenario cover 64-level roundtrip, rejection of new/replacement 65-level records, unchanged original/parts, and a readable library afterward.

Parent integration checks: typecheck and **855 Web tests / 66 files** passed; real Chromium **151.0.7922.34**, **21/21 segmented scenarios** passed with zero blocked requests/page errors. The release collector includes the new helpers/fixtures and changed built-PWA/Mobile-migration drivers; CI now runs the segmented suite. These parent counts supersede the isolated slice's 853/20 counts only for the named suites. The integrated code was committed as `897737fbe63e424f51b225467a81685ef0b7bccd`; the fixed clean corresponding source separately passed **855/855** Web tests and both App/Mobile builds with the fresh WASM inputs.

The parent's connected real-browser regressions also passed: outbox **11/11**, sync selection **10/10**, offline cache **6/6**, native quota **4/4**. Corresponding-source collection has **8 passing tests**, including fixture module/Python-helper closure and Windows LF export. The first parent source-test attempt failed before fixture setup because sandbox temporary-directory creation was refused; a dedicated fictional temporary directory run succeeded.

Built PWA acceptance passed **4/4** combinations: JA/393/light, EN/393/dark, JA/1280/dark, EN/1280/light. Actual explicit update, other-tab refusal, Japanese drafts, creation/Library editing and language-switch preservation, uncertain replies without resend, and full owned-browser offline restart were checked. API, external requests and page errors were zero. Screenshots were retained; the parent visually inspected the JA/393 entry.

The actual old Mobile worker (`02e69ee875c5b202578f`, SHA-256 `8323c1a0b22ca1a904524a8b6a8c63d57ea1e9b4af8b76aa4923db44dda73676`) and all **34** assets were fetched anonymously and checked against the previously recorded hashes. Caddy 2.10.2 was checked against its official **SHA-512** release checksum. Loopback HTTPS tests with the exact App/Mobile hostnames passed at **393/light** and **1280/dark**: active old worker, neutral popup/opener, consent/cancel, multi-chunk fictional history, language changes, hash-corrupt rejection, replay preserving cleared/pending drafts, explicit Mobile update and source IDB/OPFS marker preservation. Both runs recorded zero API/external/page errors. No model was transferred and no public/OS DNS or trust setting changed.

Evidence: `.artifacts/segmented-storage-parent-20261030.log`, `.artifacts/segmented-parent-*-20261030.log`, `.artifacts/unified-897737f-clean-tests.log`, `.artifacts/unified-897737f-pwa.log`, `.artifacts/unified-mobile-migration-v3-20261030/results.json` and `.artifacts/unified-mobile-migration-v3-desktop-20261030/results.json`. Fixed candidate details are in [Native/Mobile packages](2026-10-30-unified-native-mobile.md). A temporary verification-script CRLF parsing error and SHA-256/SHA-512 mismatch were fixed before using the input; no unchecked executable was run. A Mobile static audit report variable typo was corrected and the complete audit rerun successfully.

## Exact changed source files

All paths below are relative to the isolated checkout; no parent-only file is included.

- `apps/web/src/components/SessionPolicy.tsx`
- `apps/web/src/lib/appStore.ts`
- `apps/web/src/lib/appSync.test.ts`
- `apps/web/src/lib/appSync.ts`
- `apps/web/src/lib/appTransfers.ts`
- `apps/web/src/lib/device-library.test.ts`
- `apps/web/src/lib/deviceApi.ts`
- `apps/web/src/lib/deviceImport.ts`
- `apps/web/src/lib/deviceReads.test.ts`
- `apps/web/src/lib/idbHarness.test-support.ts`
- `apps/web/src/lib/segmentedStorage.ts`
- `apps/web/src/pages/Migration.tsx`
- `docs/validation/2026-10-30-unified-segmented-storage.md`
- `tests/browser_storage.py`
- `tests/e2e_mobile_migration.py`
- `tests/e2e_segmented_storage.py`
- `tests/e2e_unified_entry.py`
- `tests/e2e_unified_pwa.py`
- `tests/fixtures/device-export.html`
- `tests/fixtures/device-quota.html`
- `tests/fixtures/offline-cache.html`
- `tests/fixtures/outbox-guard.html`
- `tests/fixtures/segmented-storage.html`
- `tests/fixtures/session-policy.tsx`
- `tests/fixtures/storage-fixture.ts`
- `tests/fixtures/sync-selection.html`
