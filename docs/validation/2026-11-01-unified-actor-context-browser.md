# Unified Device actor context: browser acceptance (2026-11-01)

Status: **PASS — 84/84 cases on frozen source, exit 0.** Before/after/current source fingerprints match. The independent owned-process check confirms all 10 recorded processes exited. This is browser actor-projection/input/persistence acceptance within the limits below.

## Scope and unchanged boundaries

The existing actual Device/IndexedDB generation fixture and Python driver retain the 84-case matrix: 36 normal cases (local/sync × legacy/world/shared × send/regenerate × success/stopped/invalid JSON), 36 fault cases, and 12 reload/recovery cases. Only the inference Worker transport and fictional model-ready OPFS metadata are synthetic. Product generation, source reads, segmented storage, memory domains, receipts, concurrency guards, rollback, recovery, draft and fixed outbox persistence use the actual implementation.

This worker changes only `tests/fixtures/generation-commits.html`, `tests/e2e_generation_commits.py`, this document and `.artifacts/actor-context-browser-*`. There are no product/unit changes, dependencies, Git operations, provider calls, model downloads or production requests. Parent reports 1,530 Web tests in 94 files and the integrated build (including TypeScript) passing; those checks are parent-owned and are not rerun or substituted for browser evidence here.

The driver's existing default output remains `.artifacts/generation-commits-browser`; optional `--output` permits a fresh evidence directory. Existing assertions and the 600-second overall deadline remain. The regeneration before-state assertion now checks the deliberately distinct original tail `before.state`, making use of `opened.latest` observable instead of allowing current state to accidentally satisfy the check.

## Added assertions

### Real helper return values, beyond parser roots

The fixture directly calls actual `readDeviceGenerationSource('actor', owner)` against seeded segmented IndexedDB, then again after normal pending/terminal writes and reload recovery. It verifies exactly `{source, header, messages, latest}`:

- Every projected message has exactly `id`, `uuid`, `role`, `content`, `imported_state`, including all corresponding original values. No historical `before`, `after` or unknown field can hide on an older row or the projected tail.
- `latest` equals the complete original last message, with its state, memory and settings snapshots and nested unknown data. The test also covers a new user tail, completed assistant tail, and unchanged assistant after failed regeneration.
- Source metadata equals all original non-message payload fields. The body token/revision match the real IndexedDB source stamp. The public header equals the original header with payload and internal memory references excluded; storage manifest/selection do not leak into it.
- Direct return-value evidence is recorded independently of the existing parser root-message observation. Root retention zero alone is never used to prove callback retention.

All 79 historical messages contain small authored before/after settings/state snapshots and nested unknown fields. One case only, `commit-local-legacy-True-success`, additionally contains two settings strings of at least 2 MiB each and a 128 KiB unknown scalar. This exercises multiple-MiB snapshots without inflating the remaining matrix. Imported stopped/interrupted/completed states exercise filtering while retaining their original saved values.

### Original storage preservation

The snapshot helper reads the real manifest's IndexedDB `parts`, assembles the original UTF-8 bytes, decodes strictly, and verifies the exact raw JSON prefix containing the first 79 original messages. Pending/terminal/fault/recovery invariants compare that stored UTF-8 prefix, its byte count and SHA-256, and the fully decoded original messages. Successful send also preserves message 80; successful regeneration intentionally replaces only message 80. Stopped/invalid regeneration keeps that old tail unchanged.

This preserves the old full-history assertions and adds stored-byte/hash comparison; it does not replace equality with a count, preview or hash alone. Existing manual correction content/provenance/detachment, model-memory invalidation, own-versus-peer memory separation, state/summaries, unsent draft, exact segmented outbox bytes, atomic receipt/domain writes, source revision/body-token races and idempotent reload recovery assertions remain.

### Actual Worker input and raw prompt

The synthetic transport captures the arguments passed by the real `MobileRuntime.generate` at its actual `postMessage` boundary. A reference uses the complete decoded original history, not `readDeviceGenerationSource.messages`, to assemble expected input. The unchanged prompt-compile API, portable assembler and memory retrieval/render helpers are reused; this is an actor-input/persistence parity test, not independent validation of those unchanged helpers. The reference explicitly selects current state for send and complete original tail `before.state` for regeneration, excludes stopped/interrupted imports and invalidated old model memories, and includes real scoped peer recall.

Every admitted inference compares complete Worker messages by exact `JSON.stringify` equality, and checks generation settings and structured-output grammar. Every successful generation additionally checks the saved `raw_prompt` string against the actual Worker messages exactly and saved compiled prompt against the original-settings reference. Digests/counts in the report summarize those already-enforced complete comparisons.

## Execution and evidence

The product/unit freeze includes the parent's private generation-session return-type annotation and unit byte-comparison correction. No product or fixture edit occurs during the accepted run.

The initial `01` and `02` sandbox attempts produced no browser cases. A minimal diagnostic proved event-loop startup stalls at `asyncio.new_event_loop → _make_self_pipe → _fallback_socketpair → socket.accept`, before the driver's `main` and Vite startup. The original `51824` handle disappeared and its owned PIDs `103336`/`92792` were verified absent before starting the escalated run. This restart follows a demonstrated sandbox socketpair failure, not an observation timeout. The timeout, fixture assertions and product were unchanged. Evidence is retained in `.artifacts/actor-context-browser-edit-baseline/sandbox-event-loop-probe.log`, `sandbox-process-inspection.json`, `sandbox-process-state.json` and `sandbox-cleanup.json`.

Final run uses `sandbox_permissions=require_escalated`, an unused output directory, a fresh Chromium launch and disposable `browser.new_context`, with no existing browser profile reused:

```powershell
.venv/Scripts/python.exe -B -u tests/e2e_generation_commits.py --output .artifacts/actor-context-browser-freeze-20261101-03
```

### Final observed results

| Evidence | Final result |
| --- | --- |
| Execution handle | `69853`, escalated; completed with exit 0 |
| Chromium | 151.0.7922.34 |
| Time (JST) | 2026-11-01 02:22:03.575993–02:24:25.204089, 141.63 seconds |
| Normal / fault / reload-recovery | 36 / 36 / 12, all pass |
| Actual helper-return observations | 156; every projected row contains exactly five fields; every latest complete |
| Stored historical UTF-8/hash/decoded comparisons | 120 exact comparisons |
| Actual Worker inputs versus full-original reference | 66 exact comparisons, including settings/grammar checks |
| Saved raw prompt versus actual Worker input | 12 exact comparisons, all successful generations |
| Multiple-MiB historical snapshot case | Exactly 1; 4,356,192 historical snapshot/unknown bytes excluded from projected rows |
| Total actor payload | 3,486,755–7,812,188 bytes |
| Write source parsers | 318 finished, retained root-message maximum 0 |
| Readonly source parsers | 276, retained root-message maximum 0; separate from direct projection evidence |
| Native Workers / page errors / blocked requests | 0 / 0 / 0 |
| Real inference / production requests | 0 / 0 |
| Cleanup | Context/browser closed; Vite stopped; 10/10 recorded owned PIDs absent at 02:25:08 JST |
| Source closure | 301 files; before = after = independently recomputed current fingerprint |
| Full stdout/stderr | 73 JSON lines: 72 normal/fault completion lines plus final 84-case summary; reload results are in `result.json` |

Source closure SHA-256:

```text
0696fe797410f61281c3ed143beaaccb5c56aaf00a67762b3faddd3a31f4aa67
```

Final artifact SHA-256 values (paths under `.artifacts/actor-context-browser-freeze-20261101-03/`):

| Artifact | SHA-256 |
| --- | --- |
| `result.json` | `b546ca6f13475064724252424fc070cd27ea3716de7db69d40b2dcc9adb1595a` |
| `stdout.log` | `a5f741e8dc6eeef7e1c98ec2d2e630160f71db0a13e40f661e8ffb3b2603794b` |
| `vite.log` | `653ba23ddf1f66a8d509e1ee10eef886d3494082477ee5448b31a9d8469b314d` |

Frozen tested source SHA-256:

| Source | SHA-256 |
| --- | --- |
| `apps/web/src/lib/deviceMemoryStore.ts` | `1ab1ba16852f6aa78fcf008da8b6df94b48e717ba93e01a889cf581319c17e4c` |
| `apps/web/src/lib/deviceApi.ts` | `196c0b7419d504846013e7630a81adde72909b16af4811c0388b92d57521561f` |
| `tests/fixtures/generation-commits.html` | `b66bacf830eb030b99a39659087158383e5428634dc55151343a4dc8e1fb8a05` |
| `tests/e2e_generation_commits.py` | `21089171ac5b4146c2daf8d26c9d9cfcd562d85214008018699e6439d38cf467` |

`verified-summary.json` records the independent result/stdout/exit-code/current-source cross-check. `owned-processes-start.json` and `cleanup.json` record the owned process tree and its verified disappearance. Fixture/driver diffs against the pre-edit copies were inspected: no existing matrix, failure fence, durable-data equality, or timeout assertion was removed or weakened. No concrete product defect was found, and no additional browser run was needed after freeze03.

All stdout/stderr is retained in that directory's `stdout.log`, with `result.json`, `vite.log`, `exit-code.txt` and owned-process cleanup evidence. Network routing permits only the owned loopback Vite origin, rejects network `/api/` and model/binary extensions, blocks service workers/WebSockets, and rejects native Worker creation. Local/sync are storage-policy cases, not a production server connection.

The driver retains per-file SHA-256 fingerprints before and after, covering Web source, schemas, driver, fixture, server helper and Vite configuration. Documentation and unrelated parent collector files are outside that existing closure. Existing dirty files are preserved. Acceptance requires identical before/after fingerprints and all 84 case results; no earlier partial trial substitutes for it.

## Limits

This verifies removal of older snapshots from actor context and exact retention of the latest regeneration source. Actor context still retains full role/content history, all non-message metadata, and one complete latest message; a large scalar or latest snapshot can still be large. Test oracles deliberately decode originals. No peak-heap/RSS bound or full actor bounded-memory claim follows from this run.

Chromium with synthetic inference is not physical mobile hardware, real model quality, native runtime, disk-exhaustion, production deployment, CI or release acceptance. Quota errors remain injected at the receipt-write boundary. No new model or provider is used.
