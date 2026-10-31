# Fixed outbox stream: independent browser validation

Status: the final frozen browser run passed all 79 scenarios (81 records including two post-reload resumes). The first run's network-fence failure is preserved separately below. Acceptance is limited to the synthetic browser scope stated here.

Authoritative checkout: `D:/VibeCoding/my zeta`, branch `codex/unified-app-integration`, starting HEAD `e76cc81c809dfc3b3b75961cdb7fd041d6f0480a`.

Only these new files belong to this work: `tests/e2e_outbox_stream.py`, `tests/fixtures/outbox-stream.html`, and this report. Product, existing fixtures, Git state, and CI configuration are owned by the parent task.

## Reproduction and source fence

Use the existing `.venv/Scripts/python.exe` and installed Playwright Chromium. No downloads or package installation:

```powershell
.venv/Scripts/python.exe tests/e2e_outbox_stream.py --prepare-only
# Share the printed source_fingerprint; wait for the implementation owner's freeze.
.venv/Scripts/python.exe tests/e2e_outbox_stream.py --frozen-source <shared-sha256>
# CI adopts its checkout's before fingerprint and requires per-case/after equality:
.venv/Scripts/python.exe tests/e2e_outbox_stream.py --accept-current-source
```

The runner hashes Web source (including unit tests), relevant config, runner, fixture, and shared Vite server before, per case and after. CI configuration, collector and docs are excluded. A mismatched supplied fingerprint prevents execution; any source drift invalidates the run. No-flag execution remains prohibited; `--accept-current-source` is the explicit CI opt-in. Results and owned Vite logs go to a new `TEMP/kyalulu-outbox-stream-*` directory, including failures. Every case uses a separate disposable browser context. The runner closes its own contexts, browser and Vite only. Browser routing blocks real API, model, inference, provider and external requests; the fixture's HTTP responses are entirely in memory.

## Assertions prepared

- More than 3 MiB of synthetic JSON, multiple persisted IndexedDB parts, exact independent legacy `JSON.stringify` oracle generated from the original seed, full bytes, 1 MiB output framing, per-part and total SHA-256.
- Direct source/upload helper and actual `syncNow`, interrupted upload followed by page reload with identical request ID and next index greater than zero; committed receipt without resend; exact small inline body and old large inline receipt fallback.
- Independent owner, generation busy, consent, manifest, revision, compact control, count and request replacement mutations at hashing, transfer-open response, first-part response and last-part response boundaries. Real `syncNow` mutations cover owner/busy/consent/manifest/revision/control. Serializer races check the fence at the HTTP call itself.
- Late missing/corrupt part, wrong full SHA, correct-hash malformed JSON/UTF-8/over-depth/wrong-root shape rejection; no terminal commit or implicit receipt; unchanged source/header/parts/local unsent history relative to the deliberately mutated baseline.
- Actual `JsonStream.feed` live root/discarded-frame and `finish` observation for payload-free controls, including cached normal and withdrawn receipt ACK; nested/root controls retained; source part transaction mode observed. The observer measures only the product parser, with the fixture's complete oracle outside that measurement.

## Preparation evidence

Preparation-only execution used installed Playwright Chromium `151.0.7922.34`, real IndexedDB, a 3,659,537-byte independent wire oracle and four saved outbox parts. The oracle SHA-256 was `7b38600e8db4a81da804e71c2cd78236c047fdf61e88f69d01e9771e51006b85`. The preparation result reported zero guarded network attempts and page errors, with unchanged before/after source hashes. Python and module-script syntax checks passed. The runner now enumerates 79 unique scenarios, including raw-source midway changes, real `syncNow` last-response changes and cached withdrawn receipt recovery.

Private preparation logs are under the executing user's `TEMP/kyalulu-outbox-stream-*` directory. A Windows sandbox loopback `asyncio.socketpair` stall was diagnosed; the owned local browser smoke completed under the permitted escalated runner without changing timeout or assertions. This is preparation evidence only, preceding the final source freeze and final fixture fingerprint.

## Frozen run 1: network fence failure

Source fingerprint: `0d651eb1f67efd3210c91bba01380f18512faca79de2f7b2c9f65fb2483b08cc`. Existing runner handle `58149` was followed to exit 1; sources were not edited or the run interrupted. All before/per-case/after fingerprints matched. The result contains 76 passing scenarios (78 passing records including two post-reload resumes) and one failing scenario. The remaining two scenarios were not reached.

`serialize-manifest-owner` failed with `HTTP called after fence changed: ["/transfers"]`. Its JSON.stringify observer changes the fictional owner while constructing the transfer manifest. `uploadSync` reached the provided network callback after that change. The callback guard prevented any actual API request. The diagnosed ordering is `await active(); call(path, post(body))`: constructing `post(body)` after the active check leaves this race. The implementation owner was notified; this browser-only work did not modify product code, relax assertions/data/timeouts, or restart the unchanged source. `serialize-part-busy` and `serialize-commit-owner` were not executed in this first run.

The already-passing cases include exact wire/oracle checks, reload/resume, committed/no-resend, inline/legacy fallback, all four mutation boundaries, second-pass missing/corrupt parts, malformed correct-hash inputs, raw-source changes and actual `syncNow` last-part header changes. Both cached normal and withdrawn receipts ACKed without resend. Their actual parser observers recorded zero retained payload trees/messages/live payload keys/discarded-frame keys, maximum decode 1,048,576 bytes, maximum parsed scalar 29 characters and four readonly outbox part reads. These observations exclude the fixture's full oracle allocation.

Private evidence: `TEMP/kyalulu-outbox-stream-78o_58sg/results.json` and adjacent `vite.log`. The report records zero real network attempts and page errors; owned browser/context/Vite cleanup completed.

## Frozen run 2: all scenarios passed after the product fix

The implementation owner changed the upload ordering to construct `post(value)` fully, then `await active()`, then call the network callback for manifest, parts and commit. After the owner's renewed freeze, the identical 79-scenario runner and fixture were executed with the explicit fingerprint `d79cda322309b9fb5a807a4008c3abf25cd68be3f22b4e05c20446d1c74f4a89`. The existing handle `84714` was followed to exit 0 without interruption or edits during execution.

All 79 unique scenarios passed, producing 81 successful records including helper and real `syncNow` reload/resume continuations. All per-case source comparisons passed and before/after fingerprints both equal the explicit fingerprint above. Comparing the source manifests from the failed and passing runs shows changes only to `apps/web/src/lib/appTransfers.ts` and `apps/web/src/lib/appTransfers.test.ts`; the browser runner, fixture, data, assertions, timeout and observer scope were unchanged.

The three serialization races now each reach the intended mutation, then fail closed with `active fence changed`, no network-fence violation and no terminal commit/inline send. The manifest race makes zero transfer-open calls; the part race opens a transfer but sends zero parts; the commit race sends the four already-validated parts but makes zero commit calls. Both cached receipt variants again ACK without resend and retain zero payload trees, messages, live payload keys or discarded-frame keys in the actual parser; maximum decode remains 1 MiB and maximum parsed scalar remains 29 characters.

The 3,659,537-byte wire still matches the independent original-seed `JSON.stringify` oracle, per-part framing/hash and total hash. All corruption/control-change tests reject without unintended source/header/receipt/unsent-local-history changes. Real API/model/provider/external network attempts and page errors are both zero. The owned browser contexts, browser and Vite were closed on normal completion.

Private final evidence: `TEMP/kyalulu-outbox-stream-yigxubm5/results.json` and adjacent `vite.log`; first-failure evidence remains in `TEMP/kyalulu-outbox-stream-78o_58sg/` and was not overwritten.

## Acceptance limits

Preparation or synthetic browser passes do not prove full 1 GB capacity, initial `prepareSyncBatch` memory bounds, local-deleted branch recovery, Native/Cloud parity, provider integration, production behavior, or real-device performance. Fixture oracle construction deliberately allocates the whole synthetic body. Parser payload omission is bounded client-side evidence, not whole-process memory acceptance. Final results must record the frozen source fingerprint and distinguish unexecuted cases from passes.
