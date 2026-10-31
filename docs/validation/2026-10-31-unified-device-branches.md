# Device branch: bounded independent browser validation (2026-10-31)

Scope: real installed Chromium, IndexedDB, `deviceFetch('POST /api/chat/sessions/<id>/branch')`.
The driver and fixture verify the streamed branch implementation in `deviceBranch`,
the shared receiver/binder and segmented copy writer. CI and the corresponding-source
collector include this driver. No dependency, external API or inference is added.

## Independent expectation

`tests/fixtures/device-branches.html` embeds the old branch preamble, complete
`receiveConversation` / `rebindConversation` / diagnostic-removal functions and their
state/settings schemas verbatim from Git `6787167`. It also embeds executable JavaScript
transpiled from exactly those strings with the installed TypeScript compiler.
The strings were checked against that immutable Git revision during development
(initial `--self-check` and legacy/local pilot). Runtime checks pinned audited SHA-256
values for every raw block and checks the executable against a fresh transpilation before
launching the browser; it requires no `.git` or full-depth history. The browser
oracle uses these frozen definitions, never the live product's receive/bind/branch helpers.
An explicit small prefix/state/attribution/draft self-check also exercises the oracle.

The complete output payload is compared structurally to the frozen expected payload,
including every prefix message, UUID, sequential numeric ID, before/after snapshot,
state/settings, memory source IDs and session attribution, automatic/manual summaries,
unknown JSON keys (including `__proto__`), draft and other top-level metadata.
Only random allocated memory `id` values are normalized by stable memory UUID.
Before normalization, all occurrences must form a fresh UUID bijection: the same stable
UUID must always receive the same new ID and different stable UUIDs must never share one.
The returned branch UUID is an input to the expectation, validated independently as UUIDv4.

The existing memory fixture contributes only pinned, fail-closed IDB/part/hash plumbing;
independent canonical equality is supplied by this fixture. Product functions are not
replaced. The decoder observer and native IndexedDB fault instrumentation are restored
in `finally` blocks.

## Coverage

- Six local/sync × legacy/world/shared flows, each branching at user and assistant
  first/middle/end positions (indices 0, 1, 38, 39, 78, 79). Additional final-user and
  missing-next-before cases exercise the earlier-assistant snapshot fallback.
- Fictional source has 80 messages, at least 3 MiB and at least four real 1 MiB parts.
  Each successful branch requires at least two complete decoder finishes for all 80
  source messages, zero retained root messages, and at most one active callback message.
  Full compatibility GET and full entity restoration happen outside that observer.
- Entire unchanged source entity/header, its part tokens and bytes, peer entity,
  pre-existing metadata/domain/receipts and the actual segmented `sync:<owner>:outbox`
  header/token/parts are compared before and after branch creation. Only branch rows,
  branch parts and the exact expected owner message sequence may be added/changed.
- World/shared branches are activated through public memory routes into `session:<branch>`;
  old pools must remain identical. Branch-only clearing must preserve the source and peer,
  retained branch history/snapshots and outbox. Pool migration must be refused.
- Missing/nonnumeric IDs and unavailable assistant/user snapshots are refused. Invalid
  method/body and the owner execution lease must refuse without changing stores/sequence.
- Corrupt/missing last source part, even after a one-message selected prefix, must reject.
  Hash-valid invalid JSON in the discarded last message also must reject.
  A second-pass late fault is separately injected after verified preflight and tentative
  branch parts; both tentative output and the injected source corruption must roll back.
  Externally corrupted fixtures are repaired only after full refusal/store invariance
  has passed, then retry must produce a complete branch that survives reload.
- Quota is injected at the native IndexedDB sequence-write boundary after complete
  tentative branch parts/header. Every store, source, receipt, outbox and sequence must
  roll back; a fresh retry must succeed.
- Owner switches during the last source part must refuse atomically; restoring the owner
  permits retry.
- Revision and same-revision body-token competitors commit actual new source part bytes
  and a different draft after a complete inspected source decoder finish, before branch
  commit. The rejected branch must preserve the complete winner and unchanged sequence;
  a fresh retry must branch the winner.
- Low and missing sequence cases independently require allocation above all same-owner
  conversation maxima, including tombstones, while ignoring a larger foreign-owner ID.
  Normal old-contract comparisons seed sequence 20000 above all existing owner maxima.
- A pending source worker remains on the original while the independent copy clears its
  pending worker, matching frozen receiver semantics.
- Every scenario reloads fresh module state and compares complete persisted entities and
  hashes of every physical store, domain and fixed outbox. Quota cases additionally
  close/relaunch the owned Chromium process with the same disposable profile.

## Execution and evidence

Use the installed `.venv`, installed Playwright Chromium and shared owned loopback Vite
server. The driver starts/stops only its own Vite/Chromium processes and creates a separate
temporary profile per case. Artifacts default to system TEMP, outside tracked workspace.
All network requests except this exact loopback fixture origin are denied; `/api` HTTP
requests are denied too, so tested routes must execute in `deviceFetch`. WebSockets are
closed and off-origin sockets count as failures. Service workers are blocked.
The fixture uses the standard bare `zod` dependency. Because Vite serves `/@fs/` HTML
without transforming its inline module, the driver supplies a standard import map to
the installed Zod ESM entry resolved by Node from the schema package. Dependencies are
not vendored into the source archive and no collector rule is changed. The entry path
and SHA-256 are recorded; frozen schema definitions remain independent of product schemas.

```powershell
.venv/Scripts/python.exe tests/e2e_device_branches.py --self-check
.venv/Scripts/python.exe tests/e2e_device_branches.py --pilot --scenario flow-legacy-local
.venv/Scripts/python.exe tests/e2e_device_branches.py --output "$env:TEMP/kyalulu-device-branches-final-20261031"
```

`result.json` records each scenario, complete payload comparison hashes, decoder
observations, fault activation evidence, reload results, browser version/executable,
closed owned contexts, network/page errors, and SHA-256 maps before/after every case and
the complete run. Fingerprints include the driver, fixtures/helper/server, all Web lib
and mobile TS/TSX/JSON sources and schema TS sources; any drift fails acceptance.
`--pilot` and selected subsets can never set `acceptance: true`. Only all scenarios,
unchanged inputs, no denied external attempt/page errors and owned server shutdown can.

Initial legacy/local pilot: passed all six points and reload. World/local, shared/sync,
hash-valid invalid discarded JSON, quota, body-token CAS and low-sequence probes passed.
These are development evidence, not final acceptance. The first complete run was stopped
after five successful flows to remove runtime Git dependence and a direct node_modules
import for source archive/CI compatibility. Final run status is recorded below.

### Final bounded result

**PASS: 24/24 scenarios, `ok: true`, `acceptance: true`.** Product checkout was
`a88b8c5`; all **158 input fingerprints matched** before/after every scenario and the
complete run. Scenario time totaled **173.327 seconds**. This completed run was not
restarted because of observation timeouts.

Evidence: `C:/Users/hiron/AppData/Local/Temp/kyalulu-device-branches-final-portable-20261031/result.json`
(SHA-256 `bd7bd9947d281a8ad3d8d6200d466053ad8e37af8a7ac059998fe5f826cb9cda`).
The adjacent `vite.log` records the owned loopback server.

- Installed Chromium **151.0.7922.34**, executable
  `C:/Users/hiron/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe`.
- Fictional source sizes **3,828,671–3,871,778 bytes**, **80 messages**, **4 parts**.
  All 36 main prefix cases passed complete frozen-payload comparisons; source scans
  retained **zero root messages**, with at most one active callback message.
- All 24 reload/reopen checks passed complete entities and physical stores. The two
  quota cases closed/relaunched Chromium; **26 owned contexts closed**, **2 restarts**,
  owned Vite stopped. No production use, model load or inference.
- Quota occurred after **4 tentative branch parts + 1 header** in each policy; every
  persisted byte and message sequence rolled back. Second-pass late corruption occurred
  after **3 tentative branch parts**, with source and branch changes both rolled back.
- Both real inspected-source competitors preserved their complete winning payload/draft
  and sequence, then a fresh branch succeeded. Low/missing sequence cases allocated
  above the same-owner tombstone maximum **40001**, ignoring foreign maximum **90001**.
- **0** denied network attempts, page errors, request failures or console errors.

Portable-source validation: the fixture-import and Python-helper source-closure tests
passed (**2 passed**, 5.99 s). Runtime oracle self-check passed with Git/history lookup
disabled, verifying all four audited blocks and fresh TypeScript transpilation. Browser
probe with the standard import map also passed pending-copy and second-pass rollback.
Parent integration additionally passes all three browser/module/Python source-closure
checks. The final product has **1,408 Web tests / 89 files**, related **237** tests,
TypeScript and unified build (9.39 s) passing. The actual existing history **13/13**
and memory projection **14/14** drivers also pass after the shared storage-header change.
Logs: `.artifacts/device-branches-web-all.log`, `device-branches-related-final.log`,
`device-branches-typecheck-final.log`, `device-branches-unified-build.log`,
`device-branches-history-regression-browser.log`, `device-branches-memory-regression-browser.log`.
The corrected real-outbox-key unit is separately repeated for inline/segmented storage:
**2 passed**, `.artifacts/device-branches-real-outbox-unit.log`.
The separate [exact 1 GB diagnostic](2026-10-31-unified-branch-capacity.md) covers one
middle assistant branch, including independent full source/output verification.

Audited frozen block SHA-256 values (checked against `6787167` during development):

| Block | SHA-256 |
| --- | --- |
| Old branch preamble | `ac1b91d19211f2d9a793eddc1dab8d3907806afad6c3b1f77b239e78a3249e29` |
| Receiver/binder/diagnostic functions | `6d6a86675221a63c4153821960d96a713af747965dc5ea0ea7e2e8055fff0d52` |
| Frozen state/settings schemas | `ba425f0ac105a42407ae2e16451cdef8ceb963cad4d35e6f70434c4184087d8d` |
| Transpiled executable | `58279ab6cabf122594dab69a55c1d3b858dd0e7660aef740363f2b8cc9ed1ea9` |

## Limits

This is a bounded mechanism test, not a 1 GB capacity, heap/RSS or physical-device claim.
The product may retain metadata, identity maps, historical snapshots and one callback
message. Quota is an injected native boundary failure, not physical disk exhaustion.
Queued real IDB competition is not a general two-device scheduling test. Reload and
owned browser reopen are graceful, not crash/power-loss recovery. No model is loaded and
no production service is contacted.
