# Conversation branch ACK: independent real-browser validation

Worker scope: only the new browser driver, HTML fixture, small frozen old ACK/event adapter, and this document. No product, parser, CI, collector, Git state, provider, production, download, or Guilduo changes by this worker.

## Contract and oracle

The fixture calls the public `syncNow(owner)` contract unchanged in installed Chromium with real IndexedDB. JavaScript `fetch` accepts only fictional status, empty receive pages, and a request-ID cache lookup returning a branched acknowledgment. Browser HTTP interception independently rejects all actual API/model/provider/download traffic. Service workers and downloads are disabled; WebSockets are rejected. The server is an owned loopback-only Vite subprocess, using the existing `.venv` and installed Chromium without installing anything.

`sync-staging-oracle.ts` is reused, not duplicated. Its receiver/binder prefix was compared directly with `git show f9c8d2c:apps/web/src/lib/appSyncData.ts` during preparation and is identical. Its unrelated Library snapshot collection suffix differs; branch acceptance does not use that suffix. The new adapter contains the old `acknowledgeEntity`, the old event mapping as a pure adapter, and the old branch operation order: first rebind, receive, second rebind, clear `last_generation`. Deleted sources take target body from the frozen sent change; their events still map from the **current deleted source**, including retained historical memories. The old event map uses the last occurrence of an old memory ID after root, before, and after memories.

Runtime checksum verification needs no Git executable, history, or `.git` directory. It checks the entire adapter, exact old ACK, reused receiver/binder prefix, entire existing frozen oracle, and baseline schema hashes. Pins:

| Input | SHA-256 |
| --- | --- |
| New frozen branch/event adapter | `6cc86c59cf156957702ed473d18994861baa5b10d46f607c9a5c5fea9164cf45` |
| f9c8d2c acknowledgeEntity | `f5114e8e366e0e3c264b56b50fd35151c41ffd841800325c5236aee535ed394b` |
| f9c8d2c receiver/binder prefix | `d5bbdcb2f055ee8d19b0b2b2f4ed3c06c8ace99bcbb886a8493d291add8f4c88` |

The browser compares complete entities and event arrays. Python separately decodes captured physical target parts with stdlib UTF-8/JSON/base64/SHA-256, verifies the part manifest, and compares complete target payloads and events against the frozen old result. Fresh random memory allocation IDs are checked for freshness, UUID shape, uniqueness, and consistency, then renamed bijectively by their unchanged stable UUID for comparison; message numeric IDs and stable UUIDs are compared exactly. Root/historical snapshots, memories, summaries including extractive references, provenance, unknown extension fields, lineage, branch/fork IDs, draft, and source events are included. Expected data crosses Playwright as JSON strings so own `__proto__` data survives serialization.

## Coverage

The seed has a Unicode conversation above 2 MiB, a saved changes **array** whose selected source is index 1, and a different huge first payload. Sent/current edits differ; both a real tombstone and a deleted conversation with retained body are exercised. History includes overlapping old memory IDs with different stable UUIDs; the deleted current history can name a UUID absent from the sent target. Owner numeric allocation is bounded by all own headers or the saved sequence, and ignores a foreign owner's larger maximum. Legacy inline, segmented current, segmented outbox, and mixed layouts are exercised.

Live and selected outbox parser containers are observed at punctuation/feed/finish boundaries: their retained `messages` arrays must stay empty; unselected payloads in the new array selector must have zero retained keys. Individual strings, metadata, identity maps, and event arrays remain whole. This is bounded history streaming evidence, **not** a 1 GB/RSS or arbitrary-metadata capacity acceptance.

Guards cover final source/outbox part corruption/missing parts, invalid JSON/UTF-8/excessive depth with recomputed correct SHA-256, second-pass corruption after tentative output, later output quota, owner/busy/consent changes during reads/output, local/sync pending domains, branch identity collision, invalid events, and two-ACK group rollback after first branch parts were written. Failure assertions compare every original header, meta row, part key, and byte without product decoding. Persisted physical artifacts retain headers and exact part digests; successful target bytes and full old expected JSON are retained separately. Cached receipts never POST; a fictional transfer cache hit must reuse the saved request ID with no part/commit resend. Withdrawal and a same-context page reload/resumed receipt are included.

## Reproduction and parent integration

Run from `D:/VibeCoding/my zeta` with existing `.venv/Scripts/python.exe`:

```powershell
.venv/Scripts/python.exe tests/e2e_sync_branch_ack.py --check-oracle
.venv/Scripts/python.exe tests/e2e_sync_branch_ack.py --accept-current-source
.venv/Scripts/python.exe tests/e2e_sync_branch_ack.py --print-source-hash
.venv/Scripts/python.exe tests/e2e_sync_branch_ack.py --frozen-source <approved-sha256>
```

`--scenario NAME` is repeatable. Each run creates a new `.artifacts/sync-branch-ack-browser/<UTC timestamp>/`, never overwrites earlier failures, and starts retaining `stdout.jsonl` immediately. `result.json`, complete `source-before.json` / `source-after.json`, Vite log, per-case physical snapshots, and successful target/oracle/event JSON are retained. A changed fingerprint fails the run. Product freeze must be coordinated with the parent before calling a run final acceptance; a stable exploratory run alone does not establish that coordination.

Parent-owned CI/collector additions: `tests/e2e_sync_branch_ack.py`, `tests/fixtures/sync-branch-ack.html`, `tests/fixtures/sync-branch-ack-oracle.ts`, plus product `apps/web/src/lib/appSyncBranch.ts`. Existing runtime dependencies must remain included: `tests/e2e_sync_staging.py`, `tests/browser_fixture_server.py`, `tests/fixtures/sync-staging-oracle.ts`, `tests/fixtures/unified-history.json`, schema and imported product sources. The runner supports CI `--accept-current-source`; only the parent changes CI/collector.

## Run record

Status: **final frozen browser proof complete: 47/47 executions across all 46 scenarios**. This includes every original strict scenario plus the requested early legacy outbox control mutation. The parent-frozen product and unit sources are included; start/end/current aggregates match. All prior failures and final attempts remain preserved.

| Artifact directory suffix | Result and explanation |
| --- | --- |
| `20261031T133922609748Z` | 0/4. Fixture's own >=2 MiB guard rejected undersized generated history; increased seed size, preserved guard. |
| `20261031T134025158530Z` | 0/4. JS old-oracle comparison passed for live/deleted retained; Python exposed Playwright dropping own `__proto__` from expected objects. Failure snapshot also exposed receive-page sequence floor initialization; guard cases now start at the actual owner floor, with a separate low-sequence successful case. |
| `20261031T134214718309Z` | 6/8. Tombstone parser-proof check incorrectly required current messages when tombstone has none; corrected precondition. Late outbox injection used a live body path that never reads sent payload; changed that guard's source to deleted retained so the selected outbox path is exercised. No product assertion was removed. |
| `20261031T134324430394Z` | 39/41 (40 scenarios including reload twice), stable source `a91ba15f5ab307a963bbf87ca230d72e8992abae93a7b341fa544688b4ea3c00`, Chromium `151.0.7922.34`. Guard failures at that historical source: `consent-body`, `consent-output`. |
| `20261031T134651683226Z` | 6/6 added/affected cases passed, source unchanged `926ac0dec856cf58f8fa5f8012ac4306bc3b813c256b9ad883f994ead0ff20e9`. Exact cache digest, deleted inline/segmented combinations, messages-first selected payload, and distinct parser-instance counts passed. |
| `20261031T134914819426Z` | 1/3, source unchanged `53a3f3cc8650b99f2b5f3ace23a07d7106aa06aeaa4754e3c20de398d5b29109`. Lossless physical JSON serialization passed; the same two strict consent injections still failed. |
| `20261031T135028822482Z` | 2/2 live/deleted retained passed, source unchanged `1e0288d2689b71e5727c9363840c0fc5fa9d7f166dffe219c0bd614baef0ccc3`. Historical ancestor/recovery provenance specifically distinguishes the first and second rebind stages. |
| `20261031T135630738385Z` | 43/45 full updated matrix, source unchanged `2df90fed8d51977bae6af0dcc4269e71c086d348310a25ea012250fd90406300`. Only the same two strict consent injections failed. |
| `20261031T135816611873Z` | 1/1 deleted retained passed after changing current root memory ID as well as historical UUID; source unchanged `690db8c43fc8f4ef73185d4f2c157ae18a12839926a95e29770865bf09a48e87`. |
| `20261031T135920751250Z` | 0/2 fixture preparation. Strengthening pending-domain seeds with schema validation revealed a missing pending session binding. Replaced raw metadata seeding with the existing binding/domain writer so pending guards use valid persisted domain headers and parts. |
| `20261031T140026190003Z` | 2/2 valid persisted pending-domain guards passed, source unchanged `8172899cf0301ce8a3082107da18842f819b5d864ad9468903dd36f8f5396a27`. |
| `20261031T140314484225Z` | 1/3 after parent removed nonconversation branch fallback: invalid profile branch receipt rejected with every original physical row/byte preserved; both strict consent injections still failed. Source unchanged `bc78aa307ba2f6c63f99f853f3f664e88f536d326679727ed1e8a5fd7a5ef4ee`. |
| `20261031T140459871720Z` | 2/2 unchanged strict consent cases passed after the parent added the terminal control recheck. Both whole ACK transactions aborted and every original physical row/byte was preserved. Source unchanged `7408988fab2a9c38ae1fa65825ed8782848babe2150f09fa3a01aed9874dd235`. |
| `20261031T140606328017Z` | First frozen full attempt: 46/46 passed, source unchanged `116065520afdd01e2bc1c84a0e2bdbbbef2ccf6c734e6d4b933e88fd8540460c`. Parent subsequently added focused unit tests and tightened inline-outbox ACK controls, so refreshed proof was required. |
| `20261031T140942450495Z` | Refresh preflight refused stale requested hash `645b10c2ce539307dae2e9c93b3b8b642099c0a2c51c9a7f26c2aad4468dd593`: current source had become `bb7df9eb060497728bd495e762265d9efd2a688c26fed557336157ed965faea9`. Zero browsers/cases started; stdout, failure result, and both manifests retained. |
| `20261031T141024333142Z` | **Final refreshed full proof: 46/46 passed**, all 45 scenarios, source unchanged `bb7df9eb060497728bd495e762265d9efd2a688c26fed557336157ed965faea9`. Current source rechecked equal after completion. |
| `20261031T141541236503Z` | 1/1 requested early legacy outbox same-request revision mutation passed. Fresh ACK read-result revision changed; initial guard rejected before any source body reads or target part writes, preserving every original physical row/byte. Source unchanged `cb26a5aa1b80d6422dd752fb9830e44123900c441a295c56726be73b85e82902`. |
| `20261031T141616538027Z` | **Final post-freeze expanded matrix: 47/47 passed**, all original scenarios plus the requested early legacy same-request revision case. Actual `--print-source-hash` followed by `--frozen-source`; start/end/current aggregate all `cb26a5aa1b80d6422dd752fb9830e44123900c441a295c56726be73b85e82902`, all 332 files identical. |

The original two consent failures inject `meta.put(false, consentKey)` inside the same ACK transaction while reading the last current source part / writing the second target part. Before the parent's fix, observed after commit: `branch-target` existed, source and other rows had `dirty=false`, sequence was `50004`, consent was false, cursor was zero, and outbox had been removed. A normal independent consent-withdrawal transaction is serialized by IndexedDB, so this is explicitly a stricter **same-transaction fault injection**, not a claim of a reproduced real concurrent user withdrawal. Parent accepted it as a hardening gap and added a terminal fresh consent/request/fixed-outbox check before sequence/cursor/outbox settlement. Both strict cases now pass unchanged. No hook, deadline, or fail-closed assertion was weakened, and this worker made no product edits.

After this full run, the worker added deleted-source inline/segmented combinations and `messages`-first selected payload coverage. Parser counters now count distinct instances rather than observation samples, and selected outbox success requires exactly two completed selected-payload scans. The synthetic request-ID cache lookup also independently verifies the exact saved request size and SHA-256. These additions are included in the final frozen full run below.

The current matrix contains 46 scenarios / 47 executions including reload. The one additional case was requested to cover the initial legacy outbox control check, not to increase counts: its fresh ACK read retains the request ID but changes the revisions map, and must fail before any source body reads or target writes. This is an injected fresh read-result mutation; persisted original bytes remain unchanged. `--check-oracle` also passed with an empty `PATH`, confirming the delivered verifier does not invoke Git/history. Physical snapshot artifacts cross the browser bridge as JSON strings too, preserving own `__proto__` fields in legacy inline headers. After the latest full 43/45 run, the changed-root-ID, valid persisted pending-domain seeds, and invalid profile branch receipt passed targeted checks. Parent's authoritative server read and this worker's static check of `runtime/python/cloud/unified.py::_write_change` establish the legal branch contract: conflict branches are conversation-only. The browser independently confirms the client rejects a synthetic nonconversation branch receipt. No server/provider network execution is claimed. The full frozen browser run below passed every scenario after the parent's final control recheck. This completes the bounded synthetic-transport browser proof; it does not establish production or provider acceptance.


## Final frozen full proof

- Run: `20261031T141616538027Z`, installed Chromium `151.0.7922.34`.
- Result: **47/47 executions, all 46 scenarios**, including reload's failed first attempt and successful resumed acknowledgment.
- A fresh actual `--print-source-hash` returned the same aggregate immediately before the run.
- Command: `.venv/Scripts/python.exe tests/e2e_sync_branch_ack.py --frozen-source cb26a5aa1b80d6422dd752fb9830e44123900c441a295c56726be73b85e82902`.
- Aggregate at start **and** end: `cb26a5aa1b80d6422dd752fb9830e44123900c441a295c56726be73b85e82902`; all **332 files identical**, `changed_sources=[]`. A post-run current-source check matched the same aggregate.
- Frozen unit source `apps/web/src/lib/appSync.test.ts` is included in all 332-file aggregates, SHA-256 `e13631dcbf2bff1b4c7c94a4c5432eee83e24135329edf9ae438c8b82080de84` at both boundaries. Product and unit hashes are identical to the prior complete 46/46 proof; only this worker's driver/fixture changed for the requested early control case.
- The refreshed final full attempt passed. Complete raw stdout was retained from startup: **95 JSONL records**, independently reread with no truncation or missing records. Tool-display truncation did not lose artifact evidence.
- **19** successful outputs independently decoded and fully compared with the old oracle by Python; **28** guard/withdrawal/initial reload executions preserved every original physical row and byte. Both consent hooks and their deadlines/assertions are unchanged.
- Current and selected parser retained message arrays stayed **0**; unselected outbox payload retained keys stayed **0**. Deleted retained: current scan 1, selected payload scans 2; live current scans 2. Tombstones with no messages are accepted.
- No unexpected real network requests, page errors, or downloads. All 46 owned contexts closed, Chromium disconnected, and owned Vite stopped.

Artifacts: [complete stdout](../../.artifacts/sync-branch-ack-browser/20261031T141616538027Z/stdout.jsonl), [structured result](../../.artifacts/sync-branch-ack-browser/20261031T141616538027Z/result.json), [complete start fingerprints](../../.artifacts/sync-branch-ack-browser/20261031T141616538027Z/source-before.json), [complete end fingerprints](../../.artifacts/sync-branch-ack-browser/20261031T141616538027Z/source-after.json). Per-case actual IDB headers, payload bytes, event JSON, complete old expected payloads/events, and physical snapshots are in the same run directory.

Exact critical source hashes, **identical at start and end** (raw file bytes; checksum verifier also validates newline-normalized frozen old sources):

| Source | SHA-256 at both boundaries |
| --- | --- |
| `apps/web/src/lib/appSync.ts` | `a84e33e18ad19d2a87cbf93844aa6f87677b249025d711ce4cfdbbaf5237f461` |
| `apps/web/src/lib/appSyncBranch.ts` | `e495eff4db6a9f299fe1630f442acba737e65f8e7fc534a5ecac9392facce0c4` |
| `apps/web/src/lib/appStore.ts` | `8792d007f2e4ef650c127832a6d3ecef263a08f6acd8544fa22bd497bf28c2ae` |
| `apps/web/src/lib/segmentedStorage.ts` | `51156031e88a829094a43c2cd1c30a344ffef05c8d4004352c9aded8d176dd3c` |
| `apps/web/src/lib/jsonStream.ts` | `24634ca15eef32ac728b7e9dabbce9456743826783e6739afebe8bfc6fc18b48` |
| `apps/web/src/lib/appSyncStage.ts` | `2b3ce394350230daee7af93bd012651633f3f68ab84b1187e18aab4a472a48c4` |
| `apps/web/src/lib/appSyncData.ts` | `600688cb7740aa8e4f20f3364e931ca7202bac672087f73004983e7a87dac4e0` |
| `apps/web/src/lib/appOutbox.ts` | `0f3e8c8e740650dd4f9c3512b1c080c4ee01434af4965b65827c2fe4ca4da8ce` |
| `apps/web/src/lib/appTransfers.ts` | `5bb351308658f7e396be612c7ca75e7994ee34fbbf49859f90cd66b8bd9d893b` |
| `tests/e2e_sync_branch_ack.py` | `1d891fcf9abce826d6c885982e0e873718cefe9d071132ea44e1f157c639f88e` |
| `tests/fixtures/sync-branch-ack.html` | `aa6bc2b8b2a2e3bae6263f80177372cf55618ff365b9f0c00db4fbf404d74527` |
| `tests/fixtures/sync-branch-ack-oracle.ts` | `6cc86c59cf156957702ed473d18994861baa5b10d46f607c9a5c5fea9164cf45` |
| `tests/fixtures/sync-staging-oracle.ts` | `dd67b9b86debe350cb760f44539ff3b1a13325db89575fd00e8bd561039bd2cc` |

This final source proof supersedes the original `20261031T135630738385Z` **43/45 failure**, which remains intact with its original stdout, structured result, physical snapshots, and before/after fingerprints. The parent fixed the observed consent hardening gap; the worker preserved both strict fault hooks.

The first full final stdout/result are also preserved at [first final stdout](../../.artifacts/sync-branch-ack-browser/20261031T140606328017Z/stdout.jsonl) and [first final result](../../.artifacts/sync-branch-ack-browser/20261031T140606328017Z/result.json). The stale-freeze preflight is retained at [preflight result](../../.artifacts/sync-branch-ack-browser/20261031T140942450495Z/result.json). No failed or superseded attempt was overwritten.

Original preparation also attempted whole-helper equality and found only the unrelated Library snapshot suffix differs; narrowed equality to the receiver/binder functions actually reused.

## Boundaries

No real provider/network sync, model download, production rollout, 1 GB dataset, RSS acceptance, physical device, or full repository suite is claimed. This worker has not modified product code or Git state. The final browser source freeze is complete. CI/collector integration remains parent-owned.
