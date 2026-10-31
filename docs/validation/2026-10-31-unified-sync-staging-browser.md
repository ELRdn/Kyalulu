# Initial sync staging: independent Chromium / IndexedDB validation

Date: 2026-10-31 (Asia/Tokyo). Repository: `D:/VibeCoding/my zeta`, branch `codex/unified-app-integration`, oracle baseline `21ba2fa`.

Status: PASS. Final immutable combined-source proof completed after the parent froze product sources and the worker froze its driver/fixtures: 30/30 browser results, exit code 0. No production/provider/model requests, downloads, Git changes, or CI/source-collector edits were made by this worker.

## Reproduce

Use the already installed virtual environment and Chromium. The only sandbox escalation needed is for the owned loopback Vite server:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
./.venv/Scripts/python.exe tests/e2e_sync_staging.py --accept-current-source
./.venv/Scripts/python.exe tests/e2e_sync_staging.py --print-source-hash
./.venv/Scripts/python.exe tests/e2e_sync_staging.py --frozen-source <printed-sha256>
```

`--scenario NAME` can be repeated for focused diagnosis. The complete driver runs 29 scenarios with an additional page reload/resume verification, producing 30 results. `--accept-current-source` still fails if any fingerprinted file changes during the run; `--frozen-source` additionally rejects a mismatched starting hash before Chromium starts.

The driver uses existing `tests/browser_fixture_server.py:local_vite`, a fresh browser context per scenario, actual Chromium IndexedDB, and only JS-level fictional sync transport. Playwright blocks non-owned origins/ports and actual API/model/download routes, blocks non-owned WebSockets, disables service workers, and rejects any unexpected download. No browser/model installation is performed.

## Independence and assertions

`tests/fixtures/sync-staging-oracle.ts` contains the frozen baseline `appSyncData.ts` implementation and a pure equivalent of baseline `prepareSyncBatch` cursor selection. It does not import the new stage/helper. The driver reconstructs the old module from the embedded fixture and checks its pinned baseline SHA-256 without invoking Git. The two fixture-only import/type changes are reversed before hashing; the baseline module SHA-256 is `8a1e01c6a6c6731ff35eee201695fa1190a1cb1e78779a0f0703438240916528`. The normalized complete oracle/selection-adapter SHA-256 is pinned as `8d02a0834b4e35abd1b1d79eb258c372b6407e23b2c59e66b33211e37f0c5868`. All seven schemas used by that oracle are also checked against pinned SHA-256 constants derived from the same baseline. These checks are mandatory in collected source without `.git`; no integrity check is skipped.

Fixture originals, not product-parsed bodies, feed the oracle. Actual staged header and physical `changesParts` bytes are captured from IndexedDB after measurement. Browser `TextDecoder`/`JSON.parse`/Web Crypto independently validate them. Python then decodes captured base64 parts with its standard library and independently checks JSON semantics, exact UTF-8 `JSON.stringify` bytes/order, manifest size, chunk count/order, and SHA-256. Successful transport cases also compare the upload manifest with independently framed fixed-outbox bytes.

The representative initial changes array is 2,806,605 bytes with SHA-256 `ec080a1c7a65fdb6d58b2b9c51bc16581ee52504c6401eaa609abeed459af65a`, occupying three actual parts. It contains four large Unicode messages, before/after settings, settings and state-only world/persona references, multiple historical library versions, source provenance, memories/summaries with source IDs, unknown fields including an own `__proto__` property, and an unsent draft. Local diagnostic redaction is compared to the old oracle exactly; unknown authored fields remain intact.

Both product source passes are instrumented at `JsonStream.value`, `punctuation`, `feed`, and `finish`. Root `messages` retention must remain zero throughout parsing, while the per-message callback must be observed in both readonly preparation and readwrite staging. The check covers real product parser instances, and fails on `entities.getAll` during measurement. It imposes no invented scalar/heap ceiling: one message, compact metadata/settings, and legacy inline bodies may remain whole.

Every scenario compares original entity headers and every physical source part hash/length/key before and after. Concurrent source edit tests permit only their explicitly injected header revision/token change; all original source part bytes still must match. Failure cases require no published outbox and no orphan output parts.

| Coverage | Scenarios / invariant |
| --- | --- |
| New initial stage | No pre-existing outbox; exact old changes semantics/bytes/order/SHA; complete two-pass source read |
| Historic references | Current and before/after library/world/persona snapshots; state-only creator reference; embedded fallback snapshots; missing historical library/creator references reject |
| Storage layouts | Segmented, all-legacy inline, mixed segmented/inline/nonconversation, preset-only |
| Selection | Owner-scoped key ordering; 50-record cap; unselected missing reference never read; local/pending/foreign records excluded |
| Deletions | First deletion beyond the cap replaces the whole selection; revision-bound confirmed/unconfirmed flags preserved |
| Bad source tails | Corrupt final checksum; missing final part; invalid JSON or UTF-8 with an independently recomputed correct checksum |
| Second pass | Corruption injected only during writer's last source-part read, after a tentative output part actually succeeds; whole outbox transaction rolls back |
| Context fences | Late owner/busy change during both first and second source scans; consent revoked by a real queued IDB writer before staging |
| Source CAS | Real queued user writes change source revision or body token between prepare and staging; stale source rejected |
| Quota | A later output `add` throws `QuotaExceededError` only after one output part succeeds; source unchanged and tentative output rolled back |
| Winner protection | Old legacy outbox already present; competing old outbox committed after readonly preparation; no product output writes replace either |
| Post-stage fences | After fixed stage commit, owner/busy/consent changes prevent every upload POST and preserve the fixed payload |
| Reload resume | Actual navigation destroys JS state; same context's IDB resumes identical request/header/parts without re-staging source |

## Exploratory findings

Installed Chromium: `151.0.7922.34`. First focused run passed initial exact-byte parity, quota rollback, and second-pass corruption (3/3). The first full trial passed 26/27 results; its only failure was a fixture accounting error that counted the fixture's injected winner write as a product write. The injection now calls the captured native `put` directly, preserving the original strict zero-product-writes assertion. The corrected concurrent-winner scenario and all three post-stage authorization-change scenarios subsequently passed (4/4). The corrected full exploratory run then passed all 30 browser results, with zero blocked-network attempts, page errors, or downloads, but the driver correctly rejected the run because the parent changed `segmentedStorage.ts` while it was executing. That run's aggregate changed from `b52d45e2050359b5f58ce855e9f5363ba390287af9fc5f30b90ee97bb2a267da` to `237c7ca05be80f85490ba0047ad792bf5115c8cdbfdf1ec126e6db3592fc96c5`. No concrete product failure has been found so far. These exploratory runs are not the final source-freeze acceptance.

## Final immutable proof

Original source-frozen run: 2026-10-31, approximately 22:05 JST. Its original complete stdout was not retained; the recovered tool record is explicitly partial. A single replacement run with complete retained stdout/results was authorized and passed 30/30 at 2026-10-31T13:11:43.838588+00:00 through 2026-10-31T13:12:05.445142+00:00 (UTC; approximately 22:11-22:12 JST). No product/runner/fixture was changed or further browser rerun performed. Installed Chromium `151.0.7922.34`. Command:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
./.venv/Scripts/python.exe tests/e2e_sync_staging.py --frozen-source 8a5779420296b89c6685e185ec6e3919a3d3992965bb7b167292ef1f9542c52c
```

| Final evidence | Observed result |
| --- | --- |
| Browser results | 30/30 PASS; process exit code 0 |
| Source fingerprint count | 327 |
| Before aggregate SHA-256 | `8a5779420296b89c6685e185ec6e3919a3d3992965bb7b167292ef1f9542c52c` |
| After aggregate SHA-256 | `8a5779420296b89c6685e185ec6e3919a3d3992965bb7b167292ef1f9542c52c` |
| Changed source paths | Empty |
| Representative initial payload | 2,806,605 exact bytes, three output parts; frozen-old JSON and independently decoded Python output match |
| First / write source parser root messages | 0 / 0 throughout observed parser mutations |
| First / write source message callbacks | 4 / 4 for the representative initial stage |
| Quota failure | Second output add fails after one successful tentative part; original source unchanged; no fixed header or output parts remain |
| Writer-only corruption | Last source read corrupts after one tentative output success; checksum rejection and full transaction rollback |
| Original source preservation | All original physical entity parts/headers preserved in every scenario, apart from the declared competing source-header edit in CAS tests |
| Existing outbox / concurrent winner | Same winner retained; zero product output writes |
| Reload resume | Header SHA-256 `3287a0d6dc028eabcabe16f366c980d224fd5f69087d365ddccd854dc51379d5` before and after navigation; same request ID and part bytes; zero source re-stage reads/writes |
| Post-stage owner / busy / consent changes | Fixed payload survives; zero upload POSTs |
| Unexpected network attempts / page errors / downloads | 0 / 0 / 0 in all results |
| Product failures | None detected by this matrix |

The driver fingerprints all `apps/web/src` and `packages/schemas/src` files plus the Vite config, fixture server, runner, fixture, frozen oracle, and historic fixture. The evidence document is deliberately outside the executable-source aggregate so its completed results can be recorded without changing the verified runtime. Individual raw-file SHA-256 hashes recorded by the final driver:

| File | SHA-256 |
| --- | --- |
| `apps/web/src/lib/appSyncStage.ts` | `4468c50307ce628d40d709066c249261374f0274110201bb146b85b8a491781c` |
| `apps/web/src/lib/appSync.ts` | `e6d1ecda5e8a5eb6d8d9322391e8c81cd3454cff8514656f3c71df2bae1a2c4f` |
| `apps/web/src/lib/appSyncData.ts` | `600688cb7740aa8e4f20f3364e931ca7202bac672087f73004983e7a87dac4e0` |
| `apps/web/src/lib/segmentedStorage.ts` | `61db2250098203afe0840ca001150986e94a40497bcff8c654520f8a6625ddb9` |
| `apps/web/src/lib/appStore.ts` | `6c8219e10f3a33438f2ca797779e2fea74eaa0c6aaea8ff1b2226d2661e848ab` |
| `apps/web/src/lib/appOutbox.ts` | `0f3e8c8e740650dd4f9c3512b1c080c4ee01434af4965b65827c2fe4ca4da8ce` |
| `apps/web/src/lib/appTransfers.ts` | `5bb351308658f7e396be612c7ca75e7994ee34fbbf49859f90cd66b8bd9d893b` |
| `apps/web/src/lib/jsonStream.ts` | `60c74ead13b15b83b3365f70fcc0dbc0248203c4169b0cbcddd515bd740e941c` |
| `tests/e2e_sync_staging.py` | `b142e39c99e26341f9ec861c0c0a85eda1f9f40d3c2052b53b0cf96dadf6b911` |
| `tests/fixtures/sync-staging.html` | `6b0a9de50f0711f3de511baac0e25ddc41a4c0261c8f0987997cc85269f13cb6` |
| `tests/fixtures/sync-staging-oracle.ts` | `dd67b9b86debe350cb760f44539ff3b1a13325db89575fd00e8bd561039bd2cc` |

Raw-file hashes above reflect this frozen Windows checkout. The mandatory baseline-oracle integrity constants normalize text line endings so collected source on another platform can run the same integrity checks. The source-freeze aggregate intentionally hashes actual local bytes; obtain a new aggregate with `--print-source-hash` for another checkout, and keep before/after identical there.

## Parent integration paths

Worker-created files to include in the source allowlist:

- `tests/e2e_sync_staging.py`
- `tests/fixtures/sync-staging.html`
- `tests/fixtures/sync-staging-oracle.ts`
- `docs/validation/2026-10-31-unified-sync-staging-browser.md`

New product dependency: `apps/web/src/lib/appSyncStage.ts`. Existing runtime dependencies include `appSync.ts`, `appSyncData.ts`, `appStore.ts`, `appOutbox.ts`, `segmentedStorage.ts`, `appTransfers.ts`, `jsonStream.ts`, SHA-256, and the schemas. The parent owns source collector and CI edits; invoke this driver with `--accept-current-source` in CI. The delivered oracle uses the explicit `../../packages/schemas/src/index.ts` import accepted by the existing source-closure scanner. Runtime validation requires neither `.git` nor a Git executable/history fetch. A separate integrity self-check passed using only delivered oracle/schema reads and independently rejected modified oracle and schema content. The worker's closure pytest attempt was blocked during sandbox temporary-directory setup. The parent subsequently reported all three source-closure checks passing; that parent result is separate from this worker's browser proof.

Capacity beyond this roughly 2.8MB case, a strict heap/RSS ceiling, 1GB acceptance, provider/server correctness, production deployment, and physical mobile-device performance were not evaluated.


## Retained raw and structured evidence

All paths below are retained in the task repository, not in a disposable temporary directory. The replacement final run was necessary solely because the original final stdout was never written to disk and its first captured tool chunk was truncated. The replacement used the unchanged source-freeze hash `8a5779420296b89c6685e185ec6e3919a3d3992965bb7b167292ef1f9542c52c`. The original exploratory failures were recovered from the original session tool outputs without re-running failed scenarios.

Directory: `D:/VibeCoding/my zeta/.artifacts/sync-staging-browser-20261031-final/`.

| Evidence | Exact retained path | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Complete final stdout, direct process capture | [final.stdout.log](../../.artifacts/sync-staging-browser-20261031-final/final.stdout.log) | 29840 | `9c083d049ffd6a48d2d5365c3f1345895c7bdb0cd21ff266ba475ddb31fe4507` |
| Complete final stderr, empty | [final.stderr.log](../../.artifacts/sync-staging-browser-20261031-final/final.stderr.log) | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Structured 30 results, source lock/summary, command, UTC timestamps, stdout/stderr hashes | [final.results.json](../../.artifacts/sync-staging-browser-20261031-final/final.results.json) | 45649 | `fa87024355390003bbeaed4ffc5d5d31440933cbedbb12b220fe16ad95f01ff6` |
| All parsed final stdout JSON events | [final.events.jsonl](../../.artifacts/sync-staging-browser-20261031-final/final.events.jsonl) | 29747 | `0fca40dbd3f703fd9867ca634e4e64463da29f169112f6745fed214922362e94` |
| Original complete 26/27 exploratory tool-combined stdout/stderr; fixture winner accounting failure | [exploratory-01-winner-fixture-failure.combined.log](../../.artifacts/sync-staging-browser-20261031-final/exploratory-01-winner-fixture-failure.combined.log) | 26705 | `c472dea0cab0f3f95896b20eacbd03aa77df349ebc331895ee719bc44ed68083` |
| Original partial exploratory tool output; source-change rejection retained | [exploratory-02-source-change-failure.partial.log](../../.artifacts/sync-staging-browser-20261031-final/exploratory-02-source-change-failure.partial.log) | 16611 | `889c654913e1f92453955c6c7f2d79590fe28b9d7c21f9c9e37c9aa9064de334` |
| Original 22:05 final tool output, explicitly partial | [original-final-2205-tool-stdout.partial.log](../../.artifacts/sync-staging-browser-20261031-final/original-final-2205-tool-stdout.partial.log) | 26604 | `ed2f7555a8667165555f49dcd15486e7f675638ba3536ea0b17a5a5fa35b4c16` |
| Original six tool chunks plus session path, line numbers, call IDs and truncation flags | [original-tool-chunks.json](../../.artifacts/sync-staging-browser-20261031-final/original-tool-chunks.json) | 80396 | `0d9488def89a7000f07044e8b46b74fbd8520ffb4a379f6709bba22535bcb452` |
| Complete evidence file manifest | [evidence-manifest.json](../../.artifacts/sync-staging-browser-20261031-final/evidence-manifest.json) | 1409 | `a4198fd19be878c35c03071790807e50fa84d7737ab5e6ac21cad60cf98cd58c` |

The first exploratory combined log is complete, including the original failed assertion and traceback. Later recovered tool records contain literal truncation markers and must not be represented as complete stdout. `original-tool-chunks.json` preserves that distinction and the exact source locations in private provenance. Only relevant test outputs were exported; raw evidence stays in the local artifact directory and is excluded from Git.

`final.results.json` contains all 30 complete result objects (including per-pass parser counters, tentative write success counts, network/page-error/download observations, and Python independent decoder results), the final summary and critical source hashes. Its final source hashes both equal the approved freeze; changed paths are empty. The full direct final stdout is the reviewable execution record; the structured file is derived from that captured stdout.
