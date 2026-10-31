# Device generation commits: actual browser validation (2026-10-31)

Status: **PASS for the bounded generation persistence contracts below.** After the parent stability announcement, the complete driver passed 84 cases with identical before/after source fingerprints. This is not full actor bounded-memory or release acceptance.

The actual Device API now commits generation deltas through the shared storage/domain layer. The driver and fixture verify that implementation; CI and the corresponding-source collector include their inputs. No dependency or provider is added.

## Execution and evidence

Run from the repository root:

```powershell
.venv/Scripts/python.exe tests/e2e_generation_commits.py
```

The driver uses the existing owned loopback Vite server, Playwright Chromium, and a disposable browser context. It writes `.artifacts/generation-commits-browser/result.json` and `vite.log`. Git is never invoked or required. The oracle consists of explicit old-contract expected values, rather than a runtime `git show` or a copied implementation.

The result contains each case, actual transaction observations, browser version, before/after SHA-256 fingerprints and file hashes, blocked requests, page errors, and acceptance limits. Final status remains false on any contract violation or source change during the run. Any failure preserves the evidence gathered before that failure.

### Final run

| Evidence | Observed result |
| --- | --- |
| Driver | Exit 0, `ok: true` |
| Browser | Chromium 151.0.7922.34 |
| Normal contracts | 36 / 36 pass |
| Fault contracts | 36 / 36 pass |
| Reload/recovery contracts | 12 / 12 pass |
| Seeded actor payload bytes | 3,455,716–3,456,249 bytes; 80 original messages; four parts in every case |
| Source part reads | 1,184 readwrite; 384 readonly |
| Write source parsers | 318; every parser finished; maximum retained root messages 0 |
| Readonly source parsers | 120; reported separately, with no whole-actor memory claim |
| Synthetic inference calls | 66; pending-quota cases and reload retry attempts invoked none |
| External/API/model network requests | 0 |
| Native Workers / page errors | 0 / 0 |
| Owned Vite process | Stopped by driver |
| Source fingerprint | Identical before/after, 293 files |

Source fingerprint SHA-256:

```text
752837af27dcf5ab84ade64eb5a76d2bf6f3fd1892a9d41627ffceb2192f8797
```

Full evidence: `.artifacts/generation-commits-browser/result.json`. Its SHA-256 at completion is:

```text
e45c80a2b840b4ec99c2a631f1a54301b310e1ebc6da19779fa45e2c123bb876
```

The fingerprint covers web source, schemas, the driver, fixture, server helper, and Vite configuration. This validation document is excluded so the final evidence can be recorded without changing the tested source fingerprint. Earlier partial pilots are separate artifacts and are not substituted for this final run. Parent-owned full Web tests, build, packaging, diagnostics and unrelated publication CI are outside this sidecar's acceptance claim.

Parent integration additionally passes **1,440 Web tests / 91 files**, TypeScript,
the unified build (9.43 s), and **74** related Native history/bridge/client/lineage
cases. The [confirmed-correction follow-up](2026-10-31-unified-regeneration-correction.md)
uses one JSON fixture in TypeScript/Python and actual manual-edit/regenerate/branch
operations. The complete 84-case browser driver was rerun after that source change;
the hashes above refer to this final run. The initial successful JSON is retained
separately as `.artifacts/generation-commits-before-manual-roundtrip.json`.

## Data and inference boundary

Each case seeds a real segmented IndexedDB conversation with exactly 80 original messages, at least 3 MiB, and at least four 1 MiB storage parts. A separate peer conversation and a fixed, already segmented outbox are seeded using existing storage helpers. All generation admission, completion/failure, receipts, shared-domain writes, orphan recovery, source checks, and reload retry checks use actual `deviceFetch` generation APIs and actual IndexedDB. Product persistence is never mocked.

The only synthetic components are fictional model-ready OPFS metadata and the inference Worker transport, reusing the existing `prepareRuntime` fixture boundary. The replacement Worker has no native Worker realm, fetch method, model engine, or network implementation. It holds inference until the actual pending save is durable, then emits valid structured JSON, a stopped result, or invalid JSON. Browser routing rejects external requests, network `/api/` calls, and model/binary extensions; native Worker creation is checked, service workers are blocked and WebSockets closed. There are no model weights, downloads, provider calls, or production requests.

## Explicit old contracts

The normal matrix contains 36 cases: local/sync × legacy/world/shared × standard/regenerate-last × success/stopped/invalid JSON.

| Stage | Standard send | Regenerate last assistant |
| --- | --- | --- |
| Pending | Retains all 80 original messages and appends user ID 1001; total 81 | Retains all 80 original messages, including the old assistant, unchanged |
| Completed | Appends assistant ID 1002; total 82 | Replaces only the last assistant with ID 1001; total 80; existing user ID 79 is retained |
| Stopped/invalid JSON | Retains durable user ID 1001 and the full original prefix | Retains the exact old assistant and complete original history |

Success requires the explicit new reply, turn 41, new location, authored state summary, before/after state snapshots, own memory snapshots, matching `last_generation` and generation receipt, and matching source IDs. Existing authored chapter summary revision 7 remains exact. Four chapter summaries remain; the fourth chapter ends at ID 80 for a standard append and at replacement ID 1001 for regeneration.

Manual correction content, generation provenance, quote, and source revision survive regeneration. Only its reference to the replaced assistant is detached. Old model-generated facts from the replaced generation are removed. Failed generation preserves memories, state, summaries, previous `last_generation`, and shared memory pools exactly.

World/shared cases exercise actual peer recall. Peer source IDs must never enter the actor's own memory projection or any message snapshot. Shared scope migration legitimately creates new memory IDs; assertions locate the existing peer and manual facts in their actual migrated projections. Entire peer history and every byte of the fixed segmented outbox remain unchanged.

## Failure, recovery, and concurrency

The fault matrix contains 36 cases: local/sync × legacy/world/shared × the following six faults.

| Fault | Required result |
| --- | --- |
| Pending receipt quota | Admission fails; actor payload, domain and receipt roll back; inference is never invoked |
| Completed receipt quota | Completed state, own projection and shared pool roll back; a failed receipt is saved and the durable user remains |
| Failed receipt quota | Failed clear cannot commit; the exact pending actor/domain/receipt remain |
| Owner switch after pending | Terminal result is rejected and the original owner's pending actor/domain/receipt remain |
| Revision competitor after pending | A real competing IndexedDB entity write wins; stale terminal generation preserves the exact winner |
| Body-token-only competitor after pending | A real replacement body token at the same revision wins; stale terminal generation preserves the exact winner |

For failed-clear quota and owner switch, reload adds 12 recovery cases. Reusing the same generation ID must return 409 without invoking inference or changing durable data. The actual generation status API then resolves the orphan to failed, clears pending atomically, retains user/history/pools, and remains idempotent on a second status read.

Receipt quota is injected at the native object-store write boundary. Product transaction code, source parsing, checksums, manifests, metadata validation and rollback remain active. The winning competitor uses the existing real body writer, including a new body token, and is deliberately placed between pending admission and the terminal Worker event. It changes only the entity title/revision/body, leaving pending generation, receipt, and domain exactly as admitted. This isolates the revision/body-token guard: a changed receipt status or cleared pending flag cannot accidentally make the competitor case pass.

The observer verifies each normal pending/completed/failed receipt is committed exactly once in the same IndexedDB transaction as the actor entity and, for scoped conversations, its shared domain header.

## Parser observation and limits

The observer records the native `IDBRequest.result` getter's `this.source.transaction.mode` synchronously. The subsequent `JsonStream.feed` and `finish` are associated before the microtask clears that observation. Only entity-part source parsers whose root contains a message array are judged; memory-domain, outbox, metadata, and other non-message roots are excluded.

Every generation/recovery case must have at least one observed write source parser, every observed write source parser must finish, and its maximum retained root message count must be zero, including intermediate `feed` observations. Readonly source reads are reported separately. Initial full-history actor context decoding is allowed: **this work does not establish full actor bounded memory**. A readonly parser can itself retain zero root messages while its callback collects all messages for the actor; this observer does not measure that external collection. Worker input assembly and saved `raw_prompt` remain subject to that existing full-actor path.

Quota is an injected receipt-write error, not physical disk exhaustion. Validation uses fictional data and Chromium, not a physical mobile device or real model. These tests are persistence/contract evidence, not model quality, end-to-end peak RAM, deployment, or production acceptance.
