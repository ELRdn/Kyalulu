# Device history mutation browser acceptance — 2026-10-31

## Scope and independent oracle

The public driver is `tests/e2e_history_mutations.py` with `tests/fixtures/history-mutations.html`. It verifies the streamed history changes in `deviceApi`, the source/domain stores and segmented writer. CI invokes the driver and the source collector includes its inputs. No dependency, deployment, inference or external API changes are required.

Before the parent edited `deviceApi.ts`, the complete working-file `changeHistory` implementation at HEAD `3688179` was read and frozen verbatim as `goldenChangeHistorySource` inside the HTML. Its TypeScript annotations are removed only for a separate expected-value function. Mock persistence captures expected payloads and cloned pools; the oracle never replaces or invokes a product history mutation helper. All tested mutations invoke the actual exported `deviceFetch` and existing public routes. The baseline's `appendScopeEvent` behavior is reproduced separately for expected events. A fixed clock makes event comparison exact.

Frozen original SHA-256: `cd6d8798f93156d025e7d77490cc0e6df7c5047730093710fa83f23554887318` (33 lines, preserving original CRLF). A read-only `git show 3688179:apps/web/src/lib/deviceApi.ts` comparison independently confirmed equality after line-ending normalization. Legacy fixtures also exercise a model memory with `source_generation_id: ''` and a matching empty-ID receipt, preserving the old accepted generation-ID behavior.

Seeding uses the actual built-in `mocha_sfw` character and `beast_world` world from the generated catalog, `PortableDocumentSchema`, and `compilePortable`, with the same character/persona/world version selection as `deviceApi`'s compiled identity resolver. Shared bindings are created through real scope migration, retaining both the original world pool and the shared pool. No fake version strings are substituted for catalog versions.

The IDB header/part helpers, physical snapshot hashing and `JsonStream` observer are extracted from the existing `memory-source-projection.html` helper definitions. That file is neither modified nor executed as a test. Extraction markers fail closed if its helper layout changes.

## Bounded cases

Each disposable profile starts with 80 descending, non-contiguous numeric message IDs, preserved message UUIDs, and an actor history over 2 MiB in at least three real IDB parts. Unknown payload/header properties include a literal `__proto__` key, Unicode, escapes, nested extension data, draft, sequence, state/settings, complete before/after snapshots, and legacy fields. A peer conversation retains independent own-only projections. Generation-only model provenance includes last-generation precedence over a conflicting stored receipt, a matching stored receipt, a different-session receipt, and an absent receipt. Manual memories and summaries retain IDs on edit and detach IDs on deletion/clear; automatic summaries and affected model memories are removed according to the frozen implementation.

| Case | Main acceptance |
| --- | --- |
| `flow-legacy-local`, `flow-legacy-sync` | PUT, PATCH, DELETE, clear; exact complete golden payload; compatibility GET; policy/revision |
| `flow-world-local`, `flow-shared-sync` | Same operations plus all-pool ownership, invalidation events/holders, retired pool, peer retention, binding revision |
| `late-part` | Actor's final part has a bad hash; edit and clear reject without changing persisted bytes; repair then successful retry |
| `invalid-json` | Valid SHA-256 manifest over a >2 MiB body with an invalid late JSON escape; edit/clear reject; repair then retry |
| `quota-legacy`, `quota-scoped`, `quota-clear` | Inject quota after tentative actor parts/header, and after domain parts for scoped writes; exact all-store rollback; retry |
| `owner-switch` | Switch account on the final actor-part read; reject and preserve every store; restore owner and retry |
| `cas-revision`, `cas-token` | Commit a competing real IDB revision or same-revision replacement body token after source admission; preserve that winner exactly, reject the stale mutation; fresh retry |
| `contracts` | Empty/oversize/non-string content, missing numeric ID, held execution lock, pending-generation fence |

Every successful mutation compares the complete payload to the frozen oracle, including every remaining message and snapshot, then compares all pool rows/events/holders. Peer entity identity and full contents, generation receipt values, fixed outbox logical contents and physical header/part bytes must remain unchanged. Obsolete actor parts must be absent. The observer asserts zero retained root messages during every feed and finish, at most one callback message, and a complete actor stream. Compatibility GET is intentionally tested outside this mutation observer because the full-history GET contract is unchanged.

Every successful case reloads the page and compares SHA-256 over all physical entity/meta/part records plus complete entities/domain/outbox. `quota-clear` also closes and relaunches Chromium against the same disposable profile. Product SHA-256 fingerprints before/after each case and the whole run prevent accepting results across concurrent parent edits.

## Driver and evidence

From `D:/VibeCoding/my zeta`, using installed dependencies:

```powershell
.venv/Scripts/python.exe -B tests/e2e_history_mutations.py
```

`--scenario NAME` can be repeated to isolate a failure. `--output PATH` selects the artifact directory; by default it is a retained system TEMP directory outside the repository. The driver prints that path before running. It records `result.json`, an owned Vite log, and failure screenshots/progress. It closes owned persistent browsers and terminates only its own loopback Vite process. Each scenario has an independent temporary browser profile. Network interception permits only the fixture's loopback origin, blocks HTTP `/api` calls and external requests, closes WebSockets, and blocks service workers.

Final full run: **13/13 passed** with Chromium `151.0.7922.34`; aggregate case time 59.918 seconds. Source bodies were 3,615,305–3,701,119 bytes (approximately 3.45–3.53 MiB), 80 messages, and four parts. All 16 normal-flow mutations and nine fault/contract retries passed the frozen complete-payload comparison. Every observed mutation/retry retained zero root messages, with at most one active callback message.

Evidence directory: `C:/Users/hiron/AppData/Local/Temp/kyalulu-history-mutations-acnkhzcv/`. It retains `result.json` and `vite.log`; browser profiles were disposed. All ten product fingerprints matched both per-case and across the entire run. The JSON records every product fingerprint, fixture/helper fingerprints, parser observations, quota write counts, rejection responses, actual competing-IDB header evidence, and reload results.

| Final evidence | Result |
| --- | --- |
| Page errors / forbidden network requests | 0 / 0 |
| Root history retained / maximum active callback messages | 0 / 1 |
| Quota legacy edit | 4 tentative entity parts, actor-header attempt, full rollback |
| Quota scoped edit | 4 tentative entity parts, actor header, 1 domain part, full rollback |
| Quota shared clear | 1 tentative entity part, actor header, 1 domain part, full rollback |
| Revision/token CAS | Real competing transaction committed; stale route rejected; exact winner preserved; fresh retry passed |
| Reopen | All 13 page/profile reopens passed; clear also passed Chromium process close/relaunch |
| Cleanup | 14 owned persistent contexts closed; owned Vite stopped |
| Product failures remaining | None reproduced in the final unchanged-product run |

Initial pilot: `flow-legacy-local`, `flow-world-local`, `flow-shared-sync` passed (`.../kyalulu-history-mutations-bmmxty7z/result.json`). An intermediate full run (`.../kyalulu-history-mutations-dx_vb2pm/result.json`) was rejected because product SHA drifted during the parent's compatibility correction and the last case timed out on module reload. It is not counted as acceptance. Early fixture-only failures were missing helper closure arguments, temporally invalid snapshot/peer seed references, and a competing token that was not a valid UUID manifest token; these were fixed without changing product code or weakening assertions. Stable final execution reproduced no outstanding failure.

## Hydrated history follow-up

Independent review found that hydrated conversations keep their old `opened`
time and advance revision/body token. Immediate cache trimming could evict the
source again, while comparing the hydrated revision against the stub rejected
the operation as a conflict. Stub message IDs are deliberately retained by
`offlineStub`, so numeric history routes can encounter this path.

Cache trimming now accepts the currently hydrating conversation as a protected
ID without changing its recency before a successful mutation. A numeric route
checks that its message still exists in the complete hydrated source, then uses
that fresh source's revision/token for the existing atomic commit. Non-hydrated
source comparisons and owner/pending/domain/receipt guards remain intact.
The optional message callback reuses the existing complete source scan.

Related units pass **134/134**, including PUT/PATCH/DELETE/clear after hydration
and rejection of an ID removed by hydration with its winning data/recency intact.
The real offline-cache driver passes **7 cases**, including the protected source,
normal/reload, competing edits, quota and account-switch rollback. These use
actual IndexedDB; API hydration in the focused units is a controlled fixture.
TypeScript also passes. Logs: `.artifacts/history-hydration-green-final.log`,
`.artifacts/history-hydration-cache-browser.log`, `.artifacts/history-hydration-typecheck.log`.
The earlier 1 GB diagnostic predates this follow-up and is explicitly frozen-source.

Final-source regression: **1,403 Web tests / 89 files** pass
(`.artifacts/history-final-web-all.log`); unified build passes in 11.11 s
(`.artifacts/history-hydration-unified-build-final.log`, explicit documented HTTPS
Relay build origin). Final real history **13/13** passes in
`%LOCALAPPDATA%/Temp/kyalulu-history-mutations-0mpf3vhc/result.json`, console
`.artifacts/history-final-browser.log`: 14 contexts closed, one browser restart,
unchanged product fingerprints, no denied attempts/page errors, owned Vite stopped.
Final memory source projection **14/14** also passes with the default browser cache
(`.artifacts/memory-projection-history-final-browser.log`). No new 1 GB measurement
is claimed for these final source fingerprints.

## Limits

This verifies the bounded history-mutation mechanism in desktop Chromium, not 1 GB capacity, heap/RSS, crash recovery, mobile/physical-device behavior, inference, sync server delivery, or production readiness. Metadata/scalars and one decoded callback message may remain whole. CAS schedules a real competing IndexedDB write at the generation-receipt read gate after source admission; it does not claim a two-tab scheduler race. No network API or inference is invoked; all history actions use the real local `deviceFetch` routes. Runtime logs are retained in TEMP and remain subject to normal system cleanup.
