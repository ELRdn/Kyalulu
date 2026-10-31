# GGUF admission before the content-bearing Worker message

Normal Device, Research and legacy Mobile call `MobileRuntime.generate`. It now
validates every original turn and selects GGUF context before `postMessage`.
Descriptors retain original ranges and compute UTF-8 cost from bounded original
strings plus the exact two LF separators, without concatenating omitted runs.
Only retained merged runs are materialized and cloned into the Worker. The
original pre-fit array stays unchanged for canonical diagnostic storage/export.

## Protocol and preserved behavior

The conservative selector is shared with the existing `fitContext` fast path.
Required systems, the latest user suffix, system barriers, complete removal units,
empty fragments, Unicode and omitted **merged-run** counts retain the old policy.
Tests compare against an independent pinned removal loop rather than the new
shared selector. Each original turn still has the 128,000 UTF-16-unit limit,
including omitted turns; sparse/prototype-provided array positions are rejected.

The main side reuses the existing `sampling` function and a successfully loaded
model identity. Its distinct `generate-admitted` operation carries model ID,
distribution/source revision, applied output reserve and omission count. The
Worker recomputes sampling and validates these fields, message shape and the
conservative context bound before inference. A matching-field array masquerading
as admission metadata was reproduced and is now rejected.

The Worker consumes admitted runs directly. It never re-merges newly adjacent
systems or fits a second time, which would change the accepted input. Grammar,
sampling, stop/busy handling, unload/reset and original receipt transactions
remain. Raw Worker generation remains compatible; all current `MobileRuntime`
GGUF callers use the admitted operation. An old/mismatched Worker does not
silently receive the complete input as fallback.

ONNX retains the original exact whole-candidate tokenizer path and sequential
removal order. Its input clone, template/token/tensor allocations remain. A mock
tokenizer checks every candidate and final template call; this is not actual
tokenizer/model acceptance.

## Earlier synthetic-fixture limitation exposed

The former fake Worker accepted all GGUF prompts without running the context
guard. Moving the same guard to the real main-side path exposed that the existing
Mocha memory fixture exceeds the default 2,048 context / 256 output reserve.
Its observed system fragments are **768, 95, 96, 450, 153 bytes**, before merge
separators, per-run overhead and the latest user. The original real Worker would
also reject this input. The installed pinned Wllama public API exposes no native
chat tokenizer/count method; no heuristic replacement or private API was added.

Product prompts, catalog, context size and default output reserve are unchanged.
No mandatory content is shortened or silently dropped. **Usable GGUF conditions
for this stock Mocha/memory case remain unresolved**, and this change is not a
declaration that all bundled characters/scenarios work with GGUF. The same direct
probe fails Mocha memory on turn 1 and Librarian 30/100 memory on turn 5. Native
tokenizer/template integration and real-model calibration remain required work.

The normal 84-case persistence matrix now uses an immutable short Library
character with actual binding/revision identity, preserving the original large
history, snapshots, shared peer-recall, ownership, quota and erasure assertions.
The unmodified stock Mocha case is retained as an additional negative check:
no generation content reaches the Worker, the error resolves pending state,
and old authored history, draft, outbox, story and memory remain exact.

Long Research/Benchmark UI/persistence tests explicitly select the pinned ONNX
transport with synthetic inference. The paired 32-turn and EN100-turn checks are
**not GGUF capacity or real ONNX tokenizer evidence**. Readiness remains synthetic;
no new model files are downloaded and no actual model runs. This separates valid
pipeline testing from the unresolved GGUF scenario requirement, rather than
relabelling former synthetic passes as engine acceptance.
The shared-memory UI adapter likewise records `onnx-synthetic`; the separate
84-case GGUF matrix retains positive shared peer-recall and own-snapshot checks.

## Validation

- Context/runtime/Worker: **83 tests** pass, including default and custom reserve,
  2.4 MB omitted runs, 4,096-fragment instrumentation, independent role-sequence
  oracle comparisons, model/revision/reserve forgery, metadata array rejection,
  malformed input, no re-merge, stop/busy/unload and unchanged ONNX call order.
- Full Web: **1,760 tests / 101 files**, TypeScript and unified build pass. Default
  worker parallelism and deadlines are unchanged. The first sandbox run failed
  SSR imports in sandbox TEMP with ENOENT; a fresh workspace TEMP run outside that
  sandbox passes. This was a terminal startup failure, not an observation timeout.
- The final five-driver Chromium suite passes with **354 input hashes unchanged**:
  generation **84/84** plus the original Mocha negative case; shared-memory
  identity/provenance/erasure/quota/reload and JA/EN UI adapters; JA393/light and
  EN1280/dark Research **2/2**, Benchmark **2/2** with paired32 and EN100 turns;
  file saving **16/16** with a real OPFS sink replacing the native OS picker.
- The 84-case matrix observes **156** direct IDB projections, **120** complete
  original-history byte comparisons, **66** independently fitted Worker inputs,
  and **12** exact original pre-fit diagnostic prompts/public completions. The
  observed message JSON is **3,350,114–3,350,361 bytes** before fitting versus
  **1,014–1,261 bytes** sent to the Worker, with 76 merged runs omitted. These
  sizes exclude the unchanged grammar/settings and admission envelope; they are
  not a measured RAM peak. One source retains **4,356,192 bytes** of historical
  snapshots and all authored fields while its older snapshots stay out of the
  actor projection.
- The same common fixture's other consumers, history paging and target switching,
  each pass JA/EN **2/2** with unchanged source hashes, retained hidden history,
  drafts, cancellation and saved-status switch fences. Their evidence is separate
  from the five-driver suite. Source collection/bundle/fingerprint/runner checks
  pass **47** cases.

Private evidence uses `.artifacts/gguf-admission-*20261101*`. The failed oversized
fixture and source-stable failed revision preflight are retained, not counted as
successful acceptance. The earlier standalone private selector prototype had
diagnostic-source drift; it is not substituted for integrated tests.
The successful final suite is `.artifacts/gguf-admission-final-proof-20261101/`;
the extra UI proof is `gguf-admission-other-ui-proof-20261101.json`. Earlier
storage54/staging30 runs passed before the last fixture adjustments, and are
retained as scoped earlier evidence rather than relabelled a current full-suite
rerun. No product runtime logic changed after those passes.

## Remaining work

Main-side compilation, Lore/summary strings, original arrays, diagnostic input
and active Research records can still be large. Descriptor memory is proportional
to merged runs; per-original encoding is bounded by the existing turn limit.
There is no total peak-RAM, 250 MB/1 GB, actual native tokenizer, real model,
physical-device, complete-package or production acceptance. Timing measurements
inside the Worker exclude the newly main-side selection work; end-to-end latency
must be measured separately. Full integration and production rollout remain open.
