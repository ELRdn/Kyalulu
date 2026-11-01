# Native chat-count integration: implementation and remaining execution gates

This change replaces the final GGUF UTF-8 admission estimate with a public,
patched wllama 3.8.1 `countChatTokens` API. It renders through the same native
OpenAI chat parser and tokenizer as completion. It does not enqueue completion,
evaluate tokens, or change the default 2,048-token context / 256-token output
reserve. The UTF-8 heuristic remains only a bounded optional-history selector.

The corrected diagnostic **standard and compat GPU probes now pass** on the
fixed real GGUF. Pure production WASM/SDK and integrated application acceptance
remain separate pending gates. The CPU stock-Mocha generation hit its explicit
600-second probe deadline and remains unresolved.

Main validates every original message before omission, transports mandatory
runs first, then sends only selected optional runs. Worker recounts each entire
candidate and removes whole old units when necessary. The same busy operation,
model/revision/reserve fence, and abort controller cover count, continuation,
and generation. An event-loop checkpoint permits already-queued stop messages
to run before completion. Failed/stopped admission retains the submitted user
turn and follows existing failed-receipt/scoped-memory cleanup.

The build prepares the count patch after the unchanged PLE patch, compiles the
public SDK against its generated wire types, and binds SDK output to both WASM
variants by hash. Native/unified/mobile production UI builds fail closed without
matching prepared inputs. Artifact consumers verify the source/asset manifests
before building. Diagnostic native instrumentation is explicitly forbidden by
the application SDK builder.

## Evidence

- Foundation Python tests: **38 passed in 5.23s**, including public method and
  generated-wire behavior, hidden getters, payload bounds, preparation
  idempotence, diagnostic-source rejection, and artifact workflow checks.
- Consumer-focused Vitest: **137 passed**, with type checking and diff checks
  passing in the delegated implementation. Vite configuration: **40 passed**.
- `native-count-admission-transport-20261101/generation-commits-stable/result.json`:
  **84 cases**, plus separate mock overflow/rescue probes. These use fictional
  inference; they prove persistence/rollback behavior, not native token counts.
- `native-count-admission-transport-20261101/queued-worker-stable/result.json`:
  **3 real Worker queue cases**, no completion on stopped admission, with a
  checkpoint-removal negative control. Engine/count outputs are fictional.
- Corresponding-source closure: missing new e2e/fixture reproduced before the
  allowlist fix; **3 related tests passed in 15.10s** afterward.

All artifact paths above are relative to the private `.artifacts/` directory.

## Real model evidence and explicit limits

The model-only browser probe uses the existing dedicated test profile's five
cached, SHA-256-verified shards (3,125,578,496 bytes), with external/API traffic,
IndexedDB, and local/session-storage APIs blocked. No model is downloaded and
no conversation database or owner's authenticated browser is opened.

`native-chat-count-build-20261101/model-standard-05/result.json` records native
standard CPU counts using the actual GGUF/template:

| Input | Native input tokens | Previous estimate |
|---|---:|---:|
| Japanese greeting | 23 | 351 |
| Unicode, NUL and special-token text | 32 | 339 |
| Stock Mocha + beast_world + fictional memory + output contract | 389 | 1,903 |
| Same stock input with response grammar | 389 | 1,903 |
| Adjacent system messages | 29 | 469 |

Actual 1,792 and 1,793 token boundary inputs were measured. Invalid native
template-kwarg handling and pre-aborted public counting passed. The first normal
completion's observed rendered prompt and full native token-ID vector matched
count preprocessing. Eleven count/error state comparisons matched sequence-0
serialized KV bytes, reader IDs, next request ID, and PLE-read totals.

**The first complete real-model probe did not pass:** the linker `--wrap` decode
counter remained zero during positive generation, so its instrumentation was
not an adequate control. The failed assertion was retained, not relaxed.
Diagnostic-only direct entry hooks were then corrected as described below.
These measurements
do not establish opaque queue/sampler/RNG internals or the later consumed GPU
task vector. At that initial probe, compatibility-WASM and default GPU had not
been tested; the later result is below. Pure production assets and integrated
application execution remain unverified for this change.

The earlier standard-04 timeout had unhandled invalid-URL errors: its harness
overrode SDK URL normalization with a relative WASM URL. Standard-05 uses an
absolute URL and preserves bounded in-progress logs. Its browser and owned
server both closed; the original baseline toolchain/assets remain retained.

The successful Windows/Ubuntu public CI run **41252295156** belongs to the
earlier published implementation `d0cb5a2`; it is not CI evidence for this change.
No production rollout, merge, provider activation, or physical-phone acceptance
is implied. Region/provider confirmation, Supabase actual URL settings, Android/
iPhone testing, and the other previously recorded release gates remain open.

## New-head CI correction

The first `8868886` PR run **41259533309** failed the old grammar fixture on both
OSes (1 failed, 1,786 passed / 101 files). It still sent raw GGUF `generate`,
which the new admission contract intentionally rejects, and its mock lacked
the native count API. The same failure was reproduced locally before editing.
The fixture now exercises mandatory count and window continuation, retains all
grammar/plain-reasoning assertions, and additionally requires final count and
completion to receive the same options object. The corrected grammar fixture
and admission Worker suite pass **60 tests / 2 files**; product guards are not
weakened. This is not yet hosted-CI or real-tokenizer acceptance.

Further source inspection explains the ineffective legacy decode counters:
this pinned server calls `llama_process`, which uses the context's extended-batch
encode/decode methods directly. Diagnostic hooks on those actual methods are
being rebuilt. Unchanged output from the unused legacy-entry experiment is
retained as diagnostic failure evidence; LTO was not established as the cause.

The diagnostic exclusion gate also rejects the `countProbe` marker in either
actual WASM input, even when source files have already been restored and all
manifest hashes match. Standard/compat negative cases failed before this fix
at both SDK creation and all three production UI build modes. Afterward the
foundation Python suite passes **40 tests**, and Vite configuration passes
**42 tests**. This marker rejects this known diagnostic build; it is not a
substitute for provenance review or native execution acceptance.

An independent immutable **8868886** source-only audit collected **881 files**
(879 tracked + 2 generated), with zero manual supplements. It verifies all 192
tracked test inputs (147 Python files under `tests/`), 40 Runtime/Web script
entrypoints, 51 named inputs across both collected workflows, and 1,699 local
reference edges. All archive members pass size/hash/path checks; 292 Python
files pass syntax checks and **40 focused tests pass directly from the export**,
without changing source bytes. The source-only archive is 16,855,097 bytes,
SHA-256 `dd969aed22127d527b612918a95e647f7e171a30add49b0359ec9ad67b647203`.
This audit retains the known 886 grammar-fixture failure and does not include
subsequent commits, installed dependencies, complete Web CI, or packaged builds.

## Corrected real GPU proof and CPU limit

`native-chat-count-build-20261101/model-gpu-01/result.json` passes on both standard
and compat diagnostic WASM. The observed adapter reports AMD / RDNA 4,
`isFallbackAdapter=false`; native logs confirm **36/36 layers offloaded to GPU**.
Both variants measure exactly the five counts in the table and the 1,792/1,793
boundaries, reject invalid native kwargs, and post no native action for preabort.

Each variant performs two bounded eight-output-token completions (greeting and
stock Mocha/memory/grammar). Full prequeue rendered prompts and independently
tokenized native ID vectors match counting; generation exercises the actual
context evaluation hooks and PLE reads. **14 count/error state comparisons per
variant pass**, including after both generations. Exact serialized sequence-0
state sizes include 24, 461,800 and 7,308,976 bytes; reader IDs, next request ID,
PLE totals and evaluation counters remain unchanged for counts. These are
observed state boundaries, not opaque queue/sampler/RNG or GPU task-vector proof.
The eight-token grammar result is intentionally partial, not full structured
reply or model-quality acceptance.

The browser records zero external/API requests, page errors, or prohibited
storage attempts; owned browser/server cleanup passes. All 65 diagnostic files
and matching asset pairs are retained separately. Nine original toolchain and
baseline asset files match their pre-build SHA-256 values.

The corrected standard CPU probe `model-standard-06` completed the greeting,
with real evaluation and PLE-read positive controls and identical post-generation
count, but reached its **600-second deadline** during stock Mocha/grammar
generation. No completed CPU Mocha result is claimed or replaced with GPU
evidence. Original input/default limits and the deadline are unchanged.

Diagnostic source has been restored only in the isolated work directory. Its
four public patch inputs match applying the published patch to the retained
pinned PLE snapshot, allowing only explicit CRLF-to-LF normalization. Original
context source matches the retained baseline exactly. Both pure WASM variants
are being rebuilt; SDK markers/hash checks and fresh application testing are
required before treating this as a delivery candidate.

The next hosted-CI failure on d145492 is the shared synthetic UI Worker still
expecting the former `messages` packet. Its history-paging failure was reproduced
before the fixture fix. The fixture now performs count/window exchange and
preserves ONNX raw generation, pause/hold/stop/terminate behavior. Fresh tests
pass history paging **2/2**, target switching **2/2**, runtime privacy **1/1**,
and a private protocol self-check **20/20**, without assertion/timeout changes.
These remain fictional inference and do not establish native acceptance.
