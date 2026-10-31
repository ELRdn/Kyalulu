# Research storage independent browser acceptance — 2026-10-31

## Scope

Authoritative checkout: `D:/VibeCoding/my zeta`, branch `codex/unified-app-integration`, baseline HEAD `cc0b95fae3f9dead5a0649b90714aeec79aae412`.
The independent browser author edits only this document, `tests/e2e_research_storage.py`, and `tests/fixtures/research-storage.html`.
Product/helper/routes/unit tests belong to the parent. Git, CI, collector and existing fixtures are not changed by this author.

The fixture imports the actual `appStore`, `deviceResearchStore`, `segmentedStorage`, serializer, and `deviceFetch`.
IndexedDB transactions, keys, bytes, commits, aborts, locks and reloads run in installed desktop Chromium.
There is no memory database replacement, inference Worker, model readiness override, inference, model download or HTTP API.
The fixture creates a correct `newEntity('conversation', 'exp:'+uuid, ..., owner)` session with local storage policy.

## Independent oracle

Expected values are created separately from the helper and compared as complete JSON trees, including unknown top-level/session/payload/turn fields, Unicode, escapes and literal `__proto__` keys.
The body is the entire Experiment, including meta/revision/job_id and extensions. The header contains only format/meta/revision/job_id/bodyParts/catalog_sha256.
The owner/id/summary/manifest catalog binding is independently recomputed with WebCrypto. Baseline new-format headers always come from the actual writer; fault cases deliberately alter copies of those headers.
Physical concatenated parts are compared against native `JSON.stringify` UTF-8 bytes, exact size, and an independent WebCrypto SHA-256, then decoded and compared to the full expected Experiment.
Every write verification enumerates all owner/id research keys to reject obsolete/unreferenced parts.
The fixture never uses the product's read result as its expected payload.

GET detail/export oracles explicitly reproduce the existing public response shape (`meta`, `turns`, `raw_prompt`, `ratings`, `metrics`) and export disposition.
List order and leaderboard rows/counts are independently specified from the seeded metadata/ratings. Private session/revision fields must not leak.
Part-read instrumentation rejects bulk parts access and counts native IndexedDB reads while catalog/recovery/Device list/leaderboard run.
Completed experiments must have zero parts reads, including recovery alongside a running experiment.

## Cases

| Case | Required behavior |
| --- | --- |
| legacy-roundtrip | Read-only inline roundtrip, unchanged old record; migrate to >=3 MiB / >=4 parts; exact full Experiment and public detail/export |
| optional-job | Legacy migration and summary preserve an absent optional job_id |
| repeated-write | Two more revisions; changed contents/extensions preserved; no old tokens remain |
| catalog / recovery | No payload in helper summaries; zero completed body reads in list/leaderboard/recovery; running experiment becomes interrupted |
| owner-isolation | Same UUID under separate owners; helper fences, catalog/detail separation, originals retained |
| catalog-binding | Transplant an actual header to another owner/id; read/list/write reject before parts access |
| cas | Stale revision rejected; two real concurrent transactions produce exactly one winner |
| late-missing / late-corrupt | Final part absent/checksum corrupted; read and replacement fail closed with exact physical rollback |
| missing-manifest / manifest-tamper / header-tamper | Marker without manifest, changed manifest size and changed header metadata; read/list/write reject before parts access |
| body-tamper | Valid-checksum body with revision/job/meta/session owner/id/kind/policy mismatch rejected |
| quota-legacy / quota-rewrite | Quota at new header after tentative parts, or second new part after old-body verification; all stores unchanged |
| quota-cleanup | Quota during second old-part deletion after new parts/header; all stores unchanged |
| owner-read / owner-write | Switch owner during final old-part read or second tentative new-part write; abort and preserve every original store |

Every case fingerprints the real unrelated sync entity, completed request/benchmark, ratings and real serialized fixed-outbox header/parts before and after.
Every case reloads and checks all persisted physical fingerprints plus original full body hash/size (or persistent corruption rejection).
All three quota cases and owner-write also close/relaunch Chromium with the same disposable profile, then remove the profile.
Body semantic tampering recalculates the changed part manifest and catalog hash (using the real writer/serializer); each semantic rejection must read all declared parts, preventing accidental early catalog rejection from masquerading as body validation.
Late checksum corruption changes an ASCII property name while keeping JSON well formed. Replacement verifies all old parts in a readwrite transaction; corrupt originals must reject before any new part write.

## Running and evidence

```powershell
.venv/Scripts/python.exe -B tests/e2e_research_storage.py
```

`--scenario NAME` repeats for focused pilots. `--output PATH` chooses a retained evidence directory; default is system TEMP outside the repository.
`--expected-source SHA256` requires the source closure fingerprint agreed with the parent at freeze before execution.
The source closure covers all Web/schema/UI source files, Vite/package/lock configuration, the fixture server, and both new test files, using raw file bytes (including Windows CRLF).
Fingerprints must match per case and across the entire run. Parent stability/freeze notification is required before the final acceptance run; preliminary runs are diagnostics only.
Import paths use Vite `/src/` modules and URL-quoted `/@fs/` absolute fixture paths; no hardcoded machine import map or generated package file is used.

Network routing allows only the owned loopback origin, blocks `/api`, model/weight/WASM paths and all external requests; service workers are blocked, WebSockets closed, and unexpected Workers fail acceptance.
Owned persistent browsers are closed and checked disconnected; profiles are removed; only the driver-owned Vite process is stopped.
JSON reports preserve source hashes, case timing, proof hashes/sizes, part observations, injected fault counters, reload checks, network/page errors, cleanup and failure diagnostics.

Final run after the parent's explicit product-source freeze: **19/19 passed**, Chromium **151.0.7922.34**, aggregate case time **38.571 seconds**.
Evidence: `C:/Users/hiron/AppData/Local/Temp/kyalulu-research-storage-o7x0o6y1/result.json` and the adjacent owned `vite.log`.
The retained report has all **325** source-file fingerprints; the source closure matched the expected SHA-256 before startup, after every case and after the entire run:

```text
b02787576905dd2afde3309817b9eaf6a5de5947edebeabda409eaf8aa6cc9b7
```

The baseline migrated body is **4,566,410 bytes (4.35 MiB), five parts**, SHA-256 `7c9da21e8e26004f35354c384a6888488efbd5e3624fd341f3b22f002ee6b52d`.
Its two additional successful replacements and the CAS winner each passed a complete physical-byte/full-Experiment oracle comparison with no obsolete research parts.

| Final evidence | Result |
| --- | --- |
| Legacy read/write, extensions and absent job_id | Exact roundtrip; old inline read is read-only |
| Helper catalog + actual Device list/leaderboard | Zero parts reads for completed experiments |
| Recovery beside completed experiments | Only running experiment read (two one-part reads across read/write validation); durable interrupted status; completed bodies untouched |
| Detail/export | Exact independent complete public payload and export disposition |
| Owner/id catalog transplant | Read/list/write reject without payload access |
| Stale and concurrent CAS | Stale write rejected; exactly one competing transaction wins |
| Late absent/checksum-corrupt parts | Read/replacement rejected; original physical state preserved |
| Manifest/header corruption | Read/list/write rejected before parts access |
| Correct-hash semantic body corruption | All parts read, then seven revision/job/meta/session mismatches rejected |
| Quota at legacy header, second new part, second old-part deletion | Exact entity/meta/part rollback; original survives browser process relaunch |
| Owner switch at final old read / second new write | Exact rollback and original retention after reopen |
| Fixed outbox / request / benchmark / ratings / synced entity | Original logical outbox roundtrip and physical bytes unchanged |
| Forbidden network / page errors / console errors / Workers | 0 / 0 / 0 / 0 |
| Cleanup | 23 owned contexts closed/disconnected; 19 profiles removed; four browser relaunches; owned Vite stopped |

The final source-sensitive measurement start and its expected hash were announced to the parent. Parent CI/collector/document edits were excluded from the source closure, and this document was updated only after the run.
The independent author's changed paths remain the three files listed under Scope; this author did not modify product, Git state, CI, collector or existing fixtures.

Diagnostic runs (not substituted for the final run): three-case pilot `.../kyalulu-research-storage-qeuzy_nn/`, 17-case pilot `.../kyalulu-research-storage-64kv39e4/`, and two additional atomic-cleanup/catalog-binding cases `.../kyalulu-research-storage-eprfhmmk/` passed.
An earlier sandbox-restricted browser launch was interrupted before usable browser evidence; all counted runs used the already installed Chromium with an owned loopback server. No assertion, size floor, deadline or product check was relaxed.

## Limits

This is bounded persistence/route acceptance over fictional multi-part data in desktop Chromium, not full actor bounded-memory, heap/RSS, 1 GB, mobile/physical-device, inference, server sync or production acceptance.
Quota is an injected native-store operation exception, not actual disk exhaustion. Reopen is graceful, not crash/power-loss recovery.
Research rerun execution and real-model behavior are outside these no-inference cases; detail/export/list/leaderboard and recovery use the real Device routes.
