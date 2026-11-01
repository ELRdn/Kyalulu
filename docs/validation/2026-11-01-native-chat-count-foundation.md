# Native chat-count integration: implementation and remaining execution gates

This change replaces the final GGUF UTF-8 admission estimate with a public,
patched wllama 3.8.1 `countChatTokens` API. It renders through the same native
OpenAI chat parser and tokenizer as completion. It does not enqueue completion,
evaluate tokens, or change the default 2,048-token context / 256-token output
reserve. The UTF-8 heuristic remains only a bounded optional-history selector.

The corrected diagnostic and **pure production standard/compat GPU probes now
pass** on the fixed real GGUF. An immutable UI build and its actual compiled
standard Worker also pass full structured completion, large-history omission,
native overflow, stop and recovery checks. Complete packaged/physical-device/
production acceptance remains separate. CPU stock-Mocha generation hit its
explicit 600-second probe deadline and remains unresolved.

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

## Pure production SDK and compiled Worker result

Both ordinary WASM variants were rebuilt from the restored pure source and the
actual public SDK builder completed: **25 SDK source inputs, 56 emitted SDK
files, 4 matched native assets**. Neither source nor native binaries contain
the diagnostic extension. The SDK build record intentionally retains
`native_count_verified=false` and `release_accepted=false`; building alone is
not an execution attestation.

| Asset | Bytes | SHA-256 |
|---|---:|---|
| Standard glue | 139,467 | `9b05511cbc017a1598e981582c4494ab6583cdc0d237ad891005854e94c7b3fa` |
| Standard WASM | 8,791,107 | `e2b639414175f13a05e905e28bb13b97ab4714b074dc213c9cae984b6ebe3b5e` |
| Compat glue | 172,589 | `c17c308d55f3cfe0c25a917abf6bbe6eb8fee396c8376df877938a60d05b89a4` |
| Compat WASM | 16,040,959 | `6673b9daca867affc34fc1a84af9255941399534bde1d8d555693b399d3fb1af` |

`production-model-gpu-02` then exits successfully using those ordinary binaries
and that SDK on both variants: five exact previously measured inputs, actual
1,792/1,793 boundaries, invalid kwargs, preabort, two bounded real completions,
same post-generation counts, PLE reads unchanged on counts, and no diagnostic
debug fields. External/API requests, page errors and prohibited storage
attempts are zero; owned browser/server cleanup passes. The earlier `-01`
browser result also passed, but its Python summary crashed when an absent
diagnostic property became `None`; the formatter was corrected and the entire
probe repeated as `-02`, rather than presenting that failing command as success.

The immutable **77d967f** UI export built with the matching SDK/assets and native
Vite configuration loader. TypeScript and unified build pass; audit verifies
all **1,203 source files and 60 SDK/native input files unchanged**, the four
output native hashes, actual SDK/count wire markers, required UI entry documents
and absence of diagnostic markers. Node v26.5.1 and reused installed dependencies
were used. There was no dependency installation or clean-install acceptance.

`compiled-worker-01` uses the real immutable `MobileRuntime` and **built standard
Worker/SDK**, with no model or inference mock. Its test bootstrap only restricts
storage access and imports the compiled Worker; requests/results are unchanged.
It reads existing public model readiness metadata only from the `models` store;
conversation stores, other DBs, writes, local/session storage and external/API
traffic are forbidden. It verifies the cached model shards before use.

- Stock Mocha/world/memory/grammar completes a **101-token valid structured
  result** under the unchanged 2,048 context / 256 output default. Observed load
  5.18s, first output 1.82s, total generation 4.43s on this desktop/headless GPU
  test; these are not phone or cross-backend performance guarantees.
- **3,360,883 logical bytes / 28 old runs** remain in the original input but are
  absent from both Worker packets. Each transported message array is below
  2,048 bytes; native mandatory count is 389 and omitted count is 28.
- An actual **1,793-token** mandatory input is rejected without output.
- Aborting on the real native count event prevents window continuation and
  output; a subsequent real generation succeeds on the same runtime.

The JSON envelope passes the production schema, but the sampled reply contains
unusual quotation/bracket fragments. This is transport/schema evidence, not
conversational-quality or long-term-memory acceptance. No conversation is saved
by this probe. Full UI/account persistence, actual CPU stock completion, ONNX,
physical phones, clean OS and complete packaged/production acceptance remain
open. Exact manifests/results are private under
`native-chat-count-build-20261101/{ui-build-audit.json,compiled-worker-01}`.

## Distribution reproduction correction

Fresh immutable77 Native/Cloud candidates were built and archive-audited with
the actual production SDK/native inputs. The audit also exposed two source-offer
documentation gaps: generated `BUILD.md` omitted the now-mandatory SDK build
step, and this report plus the preceding d0cb5a2 delivery report were outside
the explicit source allowlist. Both were reproduced by failing tests before
correction. The collector now includes both reports and orders WASM preparation
before the public SDK build and the gated UI builds. Mobile/unified/deployment
instructions also name the SDK stage, both patches, matching manifests and fresh
isolated output requirements. The source-collector suite passes **16 tests**.
Existing immutable77 candidates are retained as prior evidence; the corrected
recipe/source-offer needs a new fixed-source candidate before final delivery.

## Fresh 7bae72f delivery and packed acceptance

An immutable **7bae72f05d4c02bfad3f29960b307589e122049d** export subsequently
reproduced the corrected recipe. Both source offers contain the same **1,118
files**, including the two missing reports and SDK build instruction. All
**101 changed paths** are included without documentation exceptions; 881
required source files and the original license/precache/manifest checks pass.
Fresh SDK output (25 inputs / 56 outputs) and all four native hashes match the
ordinary production inputs above. Packed-source tests pass 29 with one
deselected; archive-audit self-checks pass 14. Installed dependencies and the
hash-verified Python interpreter are reused; this is not a clean-install proof.

| Candidate | Bytes | SHA-256 |
|---|---:|---|
| Windows Native | 142,425,795 | `f27bae79ce9f25d7604df3136e945a36d5ee5bc738e5dad35cac6d84099bf822` |
| Unified Cloud | 67,161,019 | `cad10b21bb2ffc217cc0dd35ec7bed7109bfe57a1b9c2f50a73b49ec34f9a767` |

Parent verification independently rehashes both archives. Actual packed CLI
checks and fresh JA/EN packed browser checks both exit zero: fictional
restart/history/memory, backup/restore/rollback, seven pointer faults, actual
PID exit, draft/target/receipt/restart and a credential/referrer-free fictional
Cloud handoff. Browser inference remains mocked. A separate hash binding
matches the packed Worker, SDK chunk and native four files (six files total)
to the compiled real-model integration above; it does not relabel mocked
packed browser calls as model inference. Prior77 outputs and retained toolchain
baseline hashes are unchanged. Private evidence:
`portable-delivery-7bae72f-20261101/{results.json,logs}` and
`packed-acceptance-7bae72f-20261101/{result.json,commands.json,packed-model-code-binding.json}`.
These unsigned, unpublished candidates do not contain later source fixes.

## Actual persisted Device API: defects remain visible

The immutable77 Device API and compiled production Worker/SDK were also used
with the cached real GGUF through normal settings, stream, generation status,
memory and events routes. Only fresh UUID probe DBs were writable; existing
model metadata/shards were read-only, and private app DBs/storage, external
requests and Cloud Auth were forbidden. Source1,203 / built86 / execution99
files and the model's five shards were hash-checked. No model or transport mock
replaced this run. This used desktop GPU, not physical phones.

Mocha completes one turn; stock Librarian30 completes20/20. Librarian100
completes16 turns, then turn17 exhausts the unchanged256 output tokens and
ends in incomplete JSON. No retry, larger budget or turn18+ was attempted.
The100 scenario shares the normal world memory scope with30 and starts with
its two memories; it is not an independent empty-baseline benchmark.
All38 receipts (37 completed, one failed) survive read-only browser restart
unchanged, with425 saved-data assertions. The failed turn keeps the exact
authored user, old state/history/memories, null assistant and cleared pending.
Successful canonical diagnostics preserve original pre-fit input. Peer access
metadata changes are separately reconciled, rather than reported as a fully
unchanged peer entity.

Memory quality fails: the source asks about nearby shops, but a proposed memory
asks about bookshelf organization. Shared request wording produces12/17
bigram overlap, exceeding0.3, so the wrong topic is saved as supported and
actually injected later. A correct English translation of a Japanese flower
statement stays unsupported. Source IDs/quotes alone do not prove the proposed
content. Grammar also permits enough whitespace and free text that valid
prefixes need not close within256 tokens. These are product defects, not
storage-corruption evidence. Private full report and preserved failures:
`real-device-memory-77d967f-20261101/{REPORT.md,acceptance-summary.json,memory-support-defect.json,failed-librarian100-turn17.json}`.

Conversational quality, long-term recall, actual CPU stock completion,
250MB/1GB capacity, physical devices, license grants, clean OS/signing,
Supabase callback values, regional/provider conditions and production
recovery/cutover remain unaccepted. Supabase is user-authenticated, but CUA
startup still fails with missing kernel assets; desktop fallback returns
USER_CONTROL. URL settings are unread and unchanged. No re-login or Auth
save was attempted.

## Source correction: conservative user grounding and bounded failures

Python and Device now require complete-utterance equality for user-statement
and user-correction proposals, collapsing Unicode whitespace only. Negation,
qualification, case, punctuation and original language are retained. The
same-kind user duplicate check uses this exact rule, so a nearby opposite
statement cannot be suppressed by approximate bigram overlap. Other proposal
types and reply-wording `evidenced` telemetry retain their prior semantics.
This is textual correspondence, not a factuality or semantic verifier.

Retrieval and duplicate suppression also recheck old model-origin user rows
against their saved quote and explicit source kind, rather than trusting an
old `supported=true/null`. Missing provenance or a mismatched quote remains
inspectable but cannot be injected or suppress a new proposal. Original rows,
stored flags and source metadata are not rewritten or deleted. Explicitly
unsupported rows remain quarantined until manual confirmation/editing;
manual memories and confirmed/edited rows remain usable. Correct paraphrases,
translations, multi-statement fragments and truncated quotes can therefore
be excluded. No prompt, grammar, stock content, sampling or context/output
setting was changed to pass the regression.

The normal Device failure path now persists its bounded reason (2,000 UTF-16
units), actual returned measurement when available, one raw-output prefix
(8,192 UTF-16 units) and explicit original length/truncation. Its minimal
injected-memory ID/source links let existing source erasure remove raw/error
diagnostics. No reply/state/memory is applied and no retry occurs. Failed
receipts remain inline, with a shared complete-encoded-size ceiling of64KiB
for conversation and Research; unexpected fields, oversized diagnostics,
owner/revision conflicts and quota still reject atomically. A failed terminal
write retains the durable pending record. Public failure SSE retains only the
error message. The original256-token incomplete JSON remains unresolved;
diagnostic preservation is not a repair of model generation.

Shared33 proposal/provenance cases and19 legacy eligibility cases cover wrong
topics, negation, exact corrections, translations, mixed utterances, source
absence and manual confirmation without changing originals. Python90 tests
and focused TS117 pass. Parent validation passes all1,832 Web tests /101 files,
TypeScript and16 source-collector tests. Sandbox-specific asyncio socketpair
and forked-test temporary-file failures were retained; the fictional Python
and full Web tests pass in the ordinary scoped Windows environment. Private
evidence: `memory-grounding-20261101/{summary.json,python-tests-fixed.log,ts-tests-final.log}`.
Parent's actual Chromium Device generation matrix also passes84 cases plus
mandatory-overflow/mock-rescue probes. It checks bounded raw diagnostics,
actual returned mock measurements, minimal peer-source links and erasure
projection, exact status rereads, old history/draft preservation, failed
terminal-write pending retention, source/owner conflicts and reload recovery.
Original input and source fingerprints remain unchanged; external requests
and page errors are zero, and owned context/browser/Vite cleanup succeeds.
The private cache/native loader changes only the test server launcher.
Evidence: `generation-failure-diagnostics-20261101/browser/result.json` and
`owned-cleanup.json`. Inference is synthetic in these84 cases; native count,
real model and physical-phone claims remain tied to their separate runs.
An immutable4cd3673 export subsequently passes TypeScript and the gated unified
Vite build using copied, verified ordinary SDK/native inputs. All1,203 source
files match the exact Git archive byte-for-byte and remain unchanged; all60
SDK/native inputs are unchanged and all four emitted native hashes match.
Only four explicit installed-dependency junctions and the documented public
`VITE_RELAY_ORIGIN=https://relay.kyalulu.com` build constant are supplied. No
Relay connection, install, model execution or production access occurs.
Initial sandbox junction denial, a projection missing package-local dependency
links, and a missing Relay constant are retained as failed harness attempts;
the complete04 attempt exits zero. Private evidence:
`unified-source-check-4cd3673-20261101-04/{result.json,source-binding.json,command-0.log,command-1.log}`.
This is an exact-source UI build, not a new full Native/Cloud package or an
execution attestation for the newly compiled Worker.
New real-model quality, a new fixed-source distribution and production are
not inferred from these unit tests or the earlier7bae72f package.

## Actual4cd3673 Device API and newly built Worker

A subsequent desktop GPU run uses the immutable4cd3673 source and its actual
compiled production Worker/SDK/native assets, with no engine/model/output
replacement. The transparent Worker bootstrap adds storage guards and imports
that built module. Both stock Librarian scenarios complete20/20, preserving
the original authored inputs and unchanged2,048/256 context/output and
0.85/64/0.95/0.05/1.1 sampling settings. No fixed seed or paired A/B is claimed.
They retain the normal shared world scope; the second run can see the first
run's stored candidates and is not an independent empty baseline.

The browser checks647 saved-data assertions. A separate offline audit checks
all40 canonical pre-fit prompts against complete original role/content
history plus the new user, exact source hashes and single user/assistant/state
advancement. Each proposed user memory is independently checked using the
complete-whitespace-normalized source utterance; ungrounded candidates are
excluded from injection192 times.30 stores six unsupported user candidates;
100 stores one unsupported user candidate and one supported fictional story
event. **No newly proposed user fact is supported in this sample.** Incorrect
topics, translations and invented details remain inspectable but are not
accepted user facts. This validates quarantine, not useful long-term recall
or response quality. The prior incomplete-JSON failure remains valid; no
new incomplete JSON happened in this40-turn sample, so it is not a termination
fix or a guarantee.

A separate single-generation test uses stock Mocha references, observes the
first real native delta and stops through the normal generation-cancel API.
The failed receipt preserves its actual two UTF-16 units, stop reason and
available returned measurement, with no assistant, state/memory advancement
or retry. Its14 assertions and read-after-save checks pass. Two fresh browser
launches then read only the exact retained UUID DBs: all40 success receipts
and the one stopped receipt match completely. No model executes during that
read-only inspection. The earlier failed source, model and receipts are kept.

All1,203 immutable source files,86 built files and60 SDK/native inputs remain
unchanged. The five cached GGUF shards (3,125,578,496 bytes) match their exact
catalog hashes before/after each actual model run. Existing model metadata
is read-only; only new UUID probe app DBs are writable. Original conversation
DBs and real local/session storage are never delegated to. External/API HTTP
is blocked, WebSockets are closed, owned browsers/helpers exit, and evidence
DBs are retained. The helper uses a separate ephemeral port and fulfills the
owned test origin; it neither binds nor reuses an owner's5187 server.

Initial harness attempts are retained: navigation stalled before any routed
request until the owned page explicitly bypassed its existing Service Worker;
then missing script-destination headers made Vite return raw JSON rather than
a module. Correcting those headers fixes only the test proxy. The first
cancellation setup also correctly rejected a guessed missing persona before
inference; the completed test uses actual public `mocha_memory_001` references.
No registration/cache/DB deletion or timeout extension was used.

Private evidence: `real-device-memory-4cd3673-20261101/acceptance-summary.json`,
`run-03`, `cancel-02`, `restart-run-03`, `restart-cancel-02` and independent
`audit_results.py`.40 completions plus one deliberate stop are separate from
the earlier77 natural failure and from later source changes. These desktop
API checks do not establish complete rendered UI, physical phones, CPU
completion, whole-capacity or current full-package/production acceptance.

## Python Research caller and the next CI fixture correction

The1b79f06 PR run41267562242 fails the same Python test on both OSes; Windows
otherwise passes1,498 tests and seven subtests, Ubuntu1,495 with its additional
platform skips. The quality-control fixture proposed a paraphrase of one part
of a multi-sentence user utterance and assumed it would be injected after a
history reset. That contradicts the new complete-utterance rule. Parent
reproduces the failure, then tests both complete-source retrieval and
unsupported-paraphrase quarantine. Existing reset/schema/state/stored-count
assertions remain, with exact source quote, eligibility and injection checks
added. All24 mocked quality-control tests pass; no paid request is made.

The caller audit also finds that Python Research passed concatenated user
history to memory commit while normal Python and Device pass the current user
utterance. Research now passes `turn.user`; generation history and recall
probe context are unchanged. A synthetic three-turn test reproduces the old
failure, then proves current-only support and quote, old-topic quarantine,
exact turn/generation/session provenance, reset behavior, retained history
and shared experiment scope. Four related tests pass. Its new test path is
explicitly added to corresponding-source collection after reproducing a
missing-source failure; all16 collector tests then pass.

Evidence: `openrouter-grounding-ci-20261101`,
`research-user-evidence-20261101/summary.json`, and the retained public CI log
`lore-stream-scan-20261101/ci-1b79f06-failed.log`. This closes the caller/fixture
gap, not a real external-provider or Research model-quality acceptance.

## Fixed d09742f full Python and fresh delivery

An exact1,204-file d09742fd0fb39de5ce38007e441bb8765a7e71b1 export passes
TypeScript and the gated unified UI build with matching ordinary SDK/native
inputs. The complete Python suite then passes **1,501 tests and seven
subtests**, with one explicit skip for an absent optional pre-patch PLE
snapshot. No test, assertion or deadline is deselected/weakened. Source and
all supplied dependency inputs remain unchanged.

The first local test environment correctly rejected its outside-workspace
dependency junction in four source-collection tests. A separate physical
renderer-input projection fixed that boundary but exposed two missing
explicit TypeScript-API prerequisites. Both failures remain recorded.
The final environment copies3,086 installed metadata/license inputs and three
TypeScript API/package/license files with hashes, passes the19-test/one-skip
prerequisite check, then reruns the entire suite successfully. Python imports
are pinned to the fixed export. This is reused local dependencies, not a
clean install or a third-party grant determination. Private evidence:
`unified-d09742f-validation-20261101/{python-complete-result.json,python-complete.log,python-complete.xml,python-complete-inputs.json}`.

Fresh offline Native and unified Cloud candidates contain matching1,119-file
source offers, including the new Research test; all113 changed paths are
offered without documentation exceptions. The original archive/manifest/
precache/license/vendor/interpreter checks pass, fresh SDK25→56 outputs match,
and29 packed-source tests pass.9 generated wrapper and9 RECORD differences
retain their narrow provenance checks.5,676 retained input files plus the
nine-file root baseline remain hash-identical. Neither candidate is signed,
published or production-selected.

| Candidate | Bytes | SHA-256 |
|---|---:|---|
| Windows Native | 142,444,929 | `bccd805c54362ae407deccd8d6f290f806ccb43a9aebe7e25e387e9ff7236705` |
| Unified Cloud | 67,184,506 | `a2b460c7d5dd7610e2fe347146fdc7b2cf72c03b9e6034f12683ee4fd26f8be2` |

Parent independently rehashes both archives and verifies the actual installed
packed CLI: restart/history/memory, fictional backup/restore/rollback, seven
pointer faults and process exit pass. Fresh JA/EN packed browser checks pass
draft/target/receipt/history/restart and credential/referrer-free fictional
Cloud handoff with two mock generations and zero external/page errors.
The installed Worker/SDK/native six files exactly match the real4cd execution
code; the new selector separately matches all40 saved complete compiled
objects. These code bindings do not relabel mocked packed calls as inference.
Private evidence: `portable-delivery-d09742f-20261101/results.json` and
`packed-acceptance-d09742f-20261101/{result.json,commands.json,packed-model-code-binding.json}`.

Current Hosted CI, useful user-fact/response quality, JSON termination,
CPU stock completion, whole-capacity/ONNX/Research paths, physical devices,
primary grants/signing/clean OS/current Linux and Auth/region/provider/
production gates remain separate. Full objective completion is not claimed.

## Target-switch failed receipt fixture

Hosted d09742f PR run41271016167 reaches the Device target-switch driver on
Ubuntu, then fails its exact terminal-receipt comparison. The same failure
is reproduced locally: the old expected object omits the bounded failed-output
diagnostics already written by the product. Only that fixture expectation is
updated, adding the complete validation, empty telemetry and single empty
attempt (including truncation and UTF-16 length). The exact full-object check
and all identity, revision, stop/verification lock, saved-history, draft,
restart and no-network/no-resend assertions remain intact.

Actual Chromium151 passes both JA393px/light and EN1280px/dark cases after
the correction, with one Worker generation per case, one persisted failed
receipt and no external/API requests or page errors. This is a synthetic
Worker test, without model/provider or production use. Private evidence:
`device-target-switch-receipt-20261101/{results.json,source-sha256.json}`.
The d09742f full-suite/package evidence above stays pinned to that commit;
those archives do not contain this later test-only correction. Hosted
current-head aggregate CI remains unaccepted.

The user has authenticated Supabase in the right-side browser. A fresh CUA
reset and exact-project URL-configuration navigation still fail before UI
access with missing kernel assets; the desktop alternative returns
USER_CONTROL. Site URL/Redirect URLs remain unread and settings unchanged.
This is an automation failure, not evidence of a login problem or approval
to change Auth, region/provider conditions or production deployment.

## Canonical input replay from a pinned conversation source

Normal Device completion now saves its complete pre-fit diagnostic input by
replaying the pending conversation source inside the receipt/history/domain
transaction. The internal descriptor pins owner, conversation ID, revision and
body token, the compiled order, the already assembled summary contract, and
the optional replaced reply ID. It never enters exported JSON. The transient
assembled input array is released before the save. Research and legacy array/
raw-string inputs retain their existing contracts.

Each history slot rereads and verifies the complete source while emitting
ordered role/content JSON into existing1MiB parts. Repeated slots, imported
stopped/interrupted exclusions and regeneration retain the old assembler's
complete byte sequence; a compiler without a history slot still requires a
verified source. Header/receipt/history/domain adoption stays atomic, including
quota, checksum, owner/revision/body-token and replacement failures.

Focused generation/storage/audit tests91 and the complete Web suite1,875/101
files pass with338 input hashes unchanged; typecheck passes. New cases compare
literal source-derived inputs and the unchanged old assembler, including
multi-MiB JSON, escaping, Unicode and an unpaired surrogate. Real Chromium
passes the existing84-case local/sync × legacy/world/shared generation/fault/
restart matrix and mock overflow/rescue, with314 source inputs unchanged and
owned processes closed. JA/EN Research browser checks also pass. All inference
in these browser tests is synthetic. Corresponding-source/fingerprint tests45
pass; the initial sandbox temporary-directory setup failure and a nonfatal
pytest cache warning are separate environment limitations.

Private evidence: `conversation-input-replay-20261101/{parent-web-result.json,source-tests.log,browser/result.json,research-browser/results.json}`.
Independent static review finds no concrete defect in the replay/guard/caller
slice. Main actor/compiler/GGUF planning still retain complete history during
inference; ONNX, active Research, UI restoration and real250MB/1GB/RSS remain
open. This completes the canonical-write replay step, not whole-capacity or
model-quality acceptance. Fixed d09742f packages and real4cd model evidence
remain pinned to those older sources until a new candidate is built/verified.

The separate primary-license audit verifies all26 installed package files
against exact public tarballs and rechecks both d09742f archives. None of the
three missing rights-holder grant texts is resolved; C MIT and V8 notices are
not substitutes for wrapper/primary grants. Private evidence:
`primary-license-grants-20261101/REPORT.md`. `license_reviewed` remains false.

Fixed207ed85273d6c8172e5c188234ce709b149a494e export also passes typecheck,
unified production build and all1,875 Web tests from the committed source,
without the unrelated working-tree harness changes. All1,205 source files and
60 SDK/native inputs remain hash-identical; four emitted runtime assets match
their pinned inputs. Installed dependencies are reused through explicit
junctions, not reinstalled. Private evidence:
`conversation-input-replay-20261101/fixed-validation/{result.json,source-binding.json,web-tests.log}`.
This fixed-export UI build is separate from the complete packages below and
from real4cd model evidence; it does not constitute a new real-model run.

## Complete207ed85 packages and installed acceptance

New Native/unified UI builds from the exact207ed85 source are packaged with
hash-bound reused SDK/native outputs, offline dependencies and CPython. SDK
input/output25/56 and the broader152-source/config proof match; no new native
compilation or clean dependency installation is claimed. Both archives offer
the same1,120 source files, including every one of115 changed paths, and pass
the existing manifest/precache/license/vendor/wrapper/RECORD/interpreter guards.
Native has9,052 members; Cloud236. Prior7,188 input files and root9 baseline
files remain hash-identical. Transient sidecar copy/offline-install setup
failures are retained, and final recovery stays inside the new artifact root.

| Candidate | Bytes | SHA-256 |
|---|---:|---|
| Windows Native | 142,476,516 | `ba59252f847486ec8c0012196007a6feb2628528e5686e366596d17297e47f3f` |
| Unified Cloud | 67,181,425 | `e14b871d42bd10aec7ed39bb1034d9c620c46f77d6544365b621c6f9d3653125` |

Packed-source tests pass29 cases; one Git fixture case was deselected by the
delivery agent's narrow no-Git scope. Parent separately executes that unchanged
case against the extracted source with a new fictional temporary repository:
one pass, without altering the real repository. Parent independently rehashes
both archives, then verifies actual installed CLI restart/history/memory,
fictional backup/restore/rollback, seven pointer faults and process exit. Fresh
JA/EN packed browser draft/target/receipt/restart and credential/referrer-free
fictional Cloud handoff pass with two mock generations and zero external/page
errors. Six installed Worker/SDK/native files match prior real4cd execution
bytes. The Device API has changed since that model run: no new inference or
quality acceptance is inferred from this binding.

Private evidence: `portable-delivery-207ed85-20261101/results.json` and
`packed-acceptance-207ed85-20261101/{result.json,commands.json,source-git-fixture.log,packed-model-code-binding.json}`.
At recording,9788's Ubuntu CI has passed the corrected target-switch check and
progressed to Remote, while d00c232's CI is still running; neither whole-run
nor current-head aggregate success is claimed. Windows full Python is live,
and its in-progress log endpoint returns404. No process is declared hung or
restarted on that observation alone. Whole-capacity/ONNX/Research, useful memory/
response quality, CPU completion, physical devices, current Linux, signing,
three primary grants, Auth/region/provider and production gates remain open.

## Source-backed normal GGUF generation

Normal Device/GGUF actor reads now retain at most1,001 projected messages plus
the complete latest regeneration snapshot. Lore's existing maximum1,000-message
scan and removal of the latest assistant keep the old compiler inputs. Default
unbounded helper callers, ONNX, Research and old Mobile array paths retain their
contracts; no original history is truncated in storage or canonical diagnostics.

A verified pending-source pass computes complete summaries, original merged-run
roles/UTF-8 sizes and the original per-message token estimate. Existing source-
linked system summaries join the same contract. The original conservative
window/native mandatory rescue policy selects descriptors; only mandatory and
selected history bodies are reread. Each replay checks owner/id/revision/body
token and the complete source before exposing a result. Worker model/revision/
output reserve and final exact native count remain unchanged. Async stop/reset,
duplicate counts and failed replays cannot send stale windows or retry.

Static review found three async aliasing issues. Compiled order is now copied/
frozen before the first await, prior summaries are cloned, and selected runs
are copied before replay. Controlled read-time mutation regressions pass and
the reviewer confirms all three corrections. Unit tests also check1,206-message
normal/regenerated legacy/world API calls,2,050-message source reads, exact
Lore boundary, full original diagnostics/summary/source IDs, corruption,
revision/body/account/abort fences and unchanged originals.

The complete working-source Web suite passes1,928 tests/103 files with341 input
hashes unchanged; typecheck and source/fingerprint45 tests pass. The existing
real Chromium84-case generation/fault/restart matrix plus forced overflow and
native-count mock rescue pass with317 source inputs unchanged, no external/API
requests or page errors, and owned cleanup. JA/EN target-switch and Research
checks also pass. The browser observer deliberately replays all runs for comparison to the
independent old original-history assembler; its full replay is not production
memory evidence. Unmerged saved input bytes and selected Worker packets remain
fully checked. The native-window100-poll guard and whole-run600-second deadline
remain; the new asynchronous preparation explicitly rendezvous at its first
Worker packet before the former native-window wait starts.

Private evidence: `gguf-source-replay-20261101/{parent-web-result.json,source-tests.log,source-long-history-01.log,source-one-pass.log,browser/result.json,target-browser/results.json,research-browser/results.json}`.
These browser calls use synthetic inference, not a new real-model/native-count
acceptance. Full metadata/run catalogs and latest state still scale; ONNX whole-
candidate tokenization, active Research/probe history, UI restoration, commercial
aggregate capacity and real250MB/1GB/process memory gates remain open. The prior
207ed85 packages/model bindings do not contain or prove this later API/runtime
change. Fixed-source build, new-source real inference and current packages are
separate evidence to collect before deployment; production remains held.

Fixed b88671c6d44a810d9cc923b6941f143077cdf1a5 export passes typecheck,
unified production build and all1,928 Web tests without the unrelated working-
tree harness edits. All1,208 source files and60 SDK/native inputs are unchanged;
the four emitted runtime assets match, and the built Worker remains byte-equal
to prior real4cd execution. Dependencies are reused, not clean-installed.
Private evidence: `gguf-source-replay-20261101/fixed-validation/{result.json,source-binding.json,web-tests.log}`.
This code/asset binding does not prove the new asynchronous Device API with
actual inference; that scoped check is tracked separately and not yet accepted.

A follow-up3MiB metadata-only cancellation regression reproduces four source
part requests after abort where two are expected. The source-read transaction
now checks its AbortSignal at every guarded storage step, including metadata
chunks without message callbacks, and preserves the original abort/account
reason. The corrected test uses exact Buffer byte comparisons to avoid slow
multi-MiB assertion traversal; the5-second test deadline is unchanged. Related
73 tests and the complete Web suite1,929/103 files plus typecheck pass, with341
input hashes unchanged. Private evidence: `gguf-source-replay-20261101/abort-metadata-before.log`,
`gguf-source-replay-20261101/cancel-guard-after-02.log` and
`gguf-source-cancel-20261101/{parent-web-result.json,typecheck.log}`.
The immutable b886 model/build/source evidence remains separately pinned;
this later abort-guard correction is not silently included in that cohort.

## Completed source protocol and capacity evidence

The fixed ba37ae6637c1b787122b505da2444ce0a8951181 export now also passes
typecheck, unified production build and all1,929 Web tests. Its1,208 sources
and60 SDK/native inputs remain unchanged, and four emitted runtime assets
match. Private evidence: `gguf-source-cancel-20261101/fixed-validation/{result.json,source-binding.json,web-tests.log}`.
The following model/capacity cohorts remain pinned to earlier b88671c; they
do not exercise the later metadata cancellation correction.

Actual b886 Device API/source Runtime, production Worker/SDK/WASM and cached
GGUF complete two stock Librarian turns and one public cancellation after the
first nonempty native delta. Context2,048/output256 and default sampling are
unchanged, with no fixed seed or output edits.69 fixture assertions, two
independent Python original-input/old-window comparisons and three observed
native counts pass. Each source call performs mandatory/history replay. The
cancelled call preserves the exact native prefix and failed receipt without
assistant/story/memory advancement or automatic retry. A fresh read-only browser
restart exactly matches all three receipts. All five model shards, totaling
3,125,578,496 bytes, are rehashed unchanged, along with source/build/native
inputs. Only the fresh owned application DB is writable; original model/profile
metadata are read-only. No operator browser or production is used, and owned
browser/server processes exit.

Private evidence: `real-gguf-source-20261101/acceptance-summary.json` and
`real-gguf-source-20261101/run-eb2a80a1-b559-4f70-a3a9-d52be2800b46/`.
An additional actual successful generation with a mismatched observer-module
identity is retained separately. Earlier setup failures and that observer defect
are preserved; no natural model failure is discarded to produce this cohort.
The prior40-turn useful-memory failure and natural JSON termination failure
remain valid. This accepts protocol/persistence only, not semantic quality,
whole capacity, physical devices or release.

Separate fresh-process source-component checks pass at exactly250,000,000 and
1,000,000,000 JSON bytes. The original independently filled Unicode/escape body
generator,1MiB physical parts and complete part/stream hashes are preserved.
Required generation metadata adds572 bytes charged against each final target;
this payload deviation is recorded explicitly. An independent full-history old
assembler establishes expected values during save. After browser exit, the new
source helper verifies the physical stream, bounded1,001-row tail, full latest
snapshot, provenance, summaries, token estimate and run descriptors, then
materializes mandatory and deterministic selected older runs. That deterministic
selection is data verification, not actual native fitting or inference.

| Exact JSON bytes | Save sampled peak WS | Fresh source sampled peak WS | Save/source peak Job commit |
| ---: | ---: | ---: | ---: |
|250,000,000|1,839,312,896|1,868,488,704|1,513,275,392 /1,365,245,952|
|1,000,000,000|3,497,062,400|2,142,511,104|3,184,656,384 /1,586,212,864|

The4GiB Job committed-memory/working-set limits,480-second per-size deadline,
2GiB system floor and original250MB-to-1GB gate are unchanged. Both250MB phase
WS peaks are below2GiB and available memory at the gate is27,531,370,496 bytes.
There are no unmeasured samples, external/page/WebSocket errors or remaining
owned processes. Sampled WS sums can double-count shared pages; they are not
private memory, heap or RSS measurements.1GB uses954 physical parts,15,241 run
descriptors and838 summaries; complete decoded-tree/UI restoration, generation
save/export, actual native fitting, ONNX/Research/aggregate/device/production
capacity remain open. `whole_capacity_accepted=false` is retained.

Private evidence: `gguf-source-capacity-20261101/runs/20261101-145816-e990076f/results.json`;
small immutable self-check and four unchanged watchdog tests:
`gguf-source-capacity-20261101/runs/20261101-144242-d7ec2d0e/results.json`.
All observed product-module hashes match the fixed b886 source binding and
inputs remain unchanged. No dependency installation or original WASM rebuild
is claimed. Full Native/Cloud packages remain207ed85, not b886 or ba37.

Hosted CI7b1f209 [run41275097567](https://github.com/ELRdn/Kyalulu/actions/runs/41275097567)
and d00c232 [run41274170638](https://github.com/ELRdn/Kyalulu/actions/runs/41274170638)
complete successfully. Two e76d901 runs remain in progress at the check; no
current-head aggregate success is claimed. Supabase remains user-authenticated,
but CUA still fails kernel initialization and desktop fallback returns
USER_CONTROL. Site/Redirect values are unread and settings untouched. Draft PR,
region/provider and production holds remain unchanged.

## Align memory instructions with complete-utterance validation

The retained real-model sample has no supported new user fact. Comparing the
current model instructions with the unchanged validator finds a concrete
contract mismatch: Python asks for short memories and Device only says not to
invent facts, while both validators require the complete current user utterance
with whitespace collapse only. Device and Python now explicitly request the
complete current user message verbatim, reject summarization/translation/
fragments in the instruction, and ask for omission when it exceeds the existing
200-character content limit. Empty proposals remain allowed. No validator,
schema, existing memory, authored prompt, model or sampler is changed.

The shared provenance fixture supplies the exact instruction to generation-path
tests. Both old Python prompt paths and the Device path reproduce its absence
before correction. The Python test also retains previous conversation turns
and verifies an exact proposal against the current utterance and rejects it
against an older one. Existing provenance/negation/paraphrase quarantine remains.

The complete Device contract no longer passes the byte-only conservative
estimate in the stock shared-memory regression. That test now explicitly checks
this overflow and the native-admission route while retaining the full character,
memory labels, response shape and merged repeated-user input. It is a mocked
transport test, not proof of actual native fit. A fresh fixed-source build and
actual native count are required; prior b886/4cd execution does not prove the
new prompt fits. The earlier useful-memory and JSON failures remain valid, and
neither instruction correctness nor synthetic output establishes quality.

Working-source validation before the final explicit200-character wording passes
all1,929 Web tests/103 files, typecheck and102 Python generation/memory/provenance
tests. The final wording and source-archive/fingerprint checks are tracked in
private `memory-proposal-contract-20261101/`; immutable build, actual native
fit and current package acceptance remain separate. Original root-level Vitest
invocation searched artifact copies unintentionally, so its exact owned process
was stopped and its lack of remaining children verified. Validation runs use
`apps/web` as cwd. A missing parent temporary directory caused a Python setup
failure; after creating the private artifact directory the unchanged102 tests
pass. No failed attempt is counted as success.

Fixed e31df3c06a0e46fbe45f1a427b7ab328223b08be subsequently passes typecheck,
unified production build and all1,929 Web tests with the final explicit limit.
All1,208 fixed sources and60 SDK/native inputs remain unchanged; four emitted
runtime assets match. Final working-source Python generation/memory/provenance
and source/fingerprint tests pass147 cases. Private evidence:
`memory-proposal-contract-20261101/{python-results.xml,fixed-validation/result.json,fixed-validation/source-binding.json,fixed-validation/web-tests.log}`.
Dependencies/compiler outputs are reused, not clean-installed/recompiled.
Actual native admission and real-model quality are still separate gates.

The actual fixed e31 Device API/source Runtime and production Worker/SDK/native
subsequently complete the original two stock Librarian turns and one first-delta
cancellation, without sampler/context/output edits or retries.72 fixture checks,
two independent Python original-input/window comparisons and three exact
read-only restart receipts pass. The exact shared instruction is present in
all mandatory packets. Observed mandatory native input counts are290/306/318
against the unchanged1,792-token input budget. These are mandatory counts, not
the unexported final fitted count. Librarian byte estimates are1,543/1,592/1,624,
so this cohort does not prove the separate Mocha/shared-memory heuristic-
overflow regression fits natively. No such crossing is inferred from these
Librarian results.

All five cached shards totaling3,125,578,496 bytes, original model metadata and
source/build/SDK/native inputs remain unchanged; parent independently verifies
the before/after manifest equality. Both owned browser stages close and Vite
exits, with no remaining owned runner/server process. No production/operator
browser or unrelated DB is used. Prior useful-memory and JSON failures remain
valid; this is protocol/admission/persistence evidence, not semantic quality.
Private evidence: `real-memory-proposal-contract-20261101/run-bf264db1-7a31-42ad-bf38-b8090550f6be/{acceptance-summary.json,mandatory-count-audit.json,terminal-process-proof.json}`.

A separate actual count-only check closes that narrower Mocha input-fit gap.
It extracts the unchanged fixed regression's identity/source/seed/turn setup,
removes TypeScript annotations only, and replaces mocked storage/API with the
real source Device API in a fresh UUID DB. The full default Mocha, original
shared salmon fact, repeated complete user run, new instruction and fixture
temperature0.8 remain. Only the fixture model ID becomes the cached real GGUF.
The complete captured input is mandatory: its byte heuristic is1,998, while
the one actual production Worker native count is401, below1,792. No input,
history, character or memory is shortened. The count listener invokes the real
runtime stop before its admission-window handler; zero windows, generation
contexts or native deltas are reached, with one real stop acknowledgement and
no retry. This is not another semantic generation attempt or response-quality
test. Model/source/build/native and original metadata remain unchanged; the
owned browser closes and server exits. No final fitted-count export is invented.
Private evidence: `real-memory-proposal-contract-20261101/count-only-b0ab3f84-b367-4625-8bb7-e2aba19fdba7/{native-count-audit.json,run-result.json,cleanup.json}`.

## Current fixed e31 Native and Cloud candidates

Both complete candidates now include the e31 instruction correction. Their
independent immutable export has1,208 files; corresponding source offers are
identical at1,123 files and cover all119 changed paths. Native has9,055 archive
members and Cloud236. New Native/unified UI builds reuse hash-bound SDK/native,
offline dependencies and CPython3.13.7; this is not clean installation or a new
native compilation. SDK25 input/56 output files and the delivered source build
recipe are verified. All30 packed-source tests pass, including the unchanged
temporary-Git newline case; no real repository Git is modified by that test.
The146 focused UI checks pass. Installed packed CLI restart/history/memory,
fictional backup/restore/rollback and seven pointer-fault cases pass. Its
fresh JA/EN browser checks preserve drafts, targets and receipts through restart
and credential/referrer-free fictional Cloud handoff, with two mock generations,
zero external requests/page errors and runtime process exit. This packaged
browser test does not perform model inference or approve regional policy.

| Fixed candidate | Bytes | SHA-256 |
| --- | ---: | --- |
|Windows Native|142,524,664|`4e7b502eda3b6144435e24e9cab71bbca5e9a8f41fd764862c48259c3e887df3`|
|Unified Cloud|67,209,954|`037a697afa26a5baa14b303a8c2982bb45dd863c73d415514096472cf6b4e920`|

Parent independently recomputes both sizes/hashes. Private evidence:
`portable-delivery-e31df3c-20261101/{results.json,packed-cli-result.json,packed-browser-result.json,sdk-closure-console.log}`.
The earlier a89 candidates remain separate and unchanged. Three primary grants,
current Linux image, signing, clean OS/macOS, physical devices, whole capacity,
semantic quality and production conditions remain open. The local Docker CLI
is installed but its Linux engine pipe is unavailable; no daemon is started or
VPS scope expanded. No package is published, signed or production-selected.

Hosted e76d901 [run41277633819](https://github.com/ELRdn/Kyalulu/actions/runs/41277633819)
and [run41277630503](https://github.com/ELRdn/Kyalulu/actions/runs/41277630503)
are now successful. a89 and e31 runs remain in progress at the latest check;
current-head aggregate success is not inferred. Draft and production holds
remain in effect.

## Follow-up source, UI and hosted image validation

Runtime sync now passes the selected language to unnamed conversation labels;
JA/EN switching preserves authored names, selection state and request counts.
The related27 UI tests pass. The fixed23b8e2b Cloud candidate is67,214,762 bytes,
SHA-256 `a08534deb7e4c88023375b36921bdd5fe0d8557cdd4c72607e73b05bfeb5ca33`.
Its typecheck/unified build, source59 tests and unmodified Windows ASGI9 checks
pass. That probe skips the three Linux-only UID/network/rootfs checks; no image
acceptance is inferred. The candidate predates the following fixes.

Hosted e31 [run41281267568](https://github.com/ELRdn/Kyalulu/actions/runs/41281267568)
fails both OSes in the generation matrix because its independent reference
contract omits the new current-user memory instruction. Local reproduction
finds the same first difference at758. Commit7e012bc adds that complete
instruction to the reference; it changes no product code, comparison, original
history/window policy,100-poll guard or600-second deadline. All84 actual
Chromium generation/fault/restart cases plus mocked overflow/rescue pass with
317 input hashes unchanged, no external/page errors and owned cleanup. The
read-only fixed SDK's61 files also remain unchanged. Earlier private runner
setup failures are retained, not counted as the reproduced product-test failure.
The same hosted e31 run separately passes full Python: Ubuntu1,500 plus7
subtests/4 skips, Windows1,503 plus7 subtests/1 skip. These passing steps do not
make the whole run successful.

The canonical fingerprint includes all public `deploy/cloud` inputs, but the
shared source collector omitted `VPS.md`. Commit2e81c93 adds that single public
runbook without changing the fingerprint algorithm or private-path exclusions.
A fixed23b export plus the two explicit correction files now reproduces its
complete583-input fingerprint from offered source; this replaces the earlier
overlap-only observation. Related67 tests and one final regression pass. The
older e31/23b source archives retain that documentation omission and are not
retroactively marked corrected. Private evidence:
`source-fingerprint-vps-20261101/{results.json,final-result.json}` and
`generation-contract-ci-20261101/{before-04/result.json,after/result.json,after/cleanup.json}`.

Both Cloud Dockerfiles also omitted the official scenario directory. Commit
1a0cb08 copies it and verifies the real three-scenario loader as well as the
complete image file set/content hashes. The existing hosted workflow now sends
the unchanged image fixture over stdin, uses network none/read-only/no host
binds or published ports,256MiB/0.25CPU/pids64 and only fictional tmpfs data.
The default Uvicorn command is checked through container loopback health/device
bytes and isolation headers. Reports bind manifest/source/device/code hashes;
Cloud uploads contain only JSON/hash evidence. Combined final workflow/source/
SDK regression tests pass95 cases, after correcting an initial missing parent
temporary-directory setup. Bash syntax checks pass. The current actual run is
[41286381032](https://github.com/ELRdn/Kyalulu/actions/runs/41286381032), pinned to
1a0cb08c42f6f5228b107c12b00f348b5708d4c4. Its wasm job is live at verification;
Native/macOS/Cloud image results remain pending. No duplicate dispatch, signing,
image push, publication, production change or merge is performed.

## Rejected full-tree restoration experiments

Two private variants retain the original exact-size generator, complete decoded
tree and full physical/body hashes. Neither becomes product code. Per-part
readonly transactions restore250MB correctly but peak at2,384,379,904 sampled
WS bytes, failing the unchanged below2GiB gate for a1GB run.16KiB decoder feeds
pass that gate;1GB saves and verifies all954 physical parts, then restoration
hits the4GiB Job budget (peak commit4,295,708,672 bytes, sampled WS4,255,903,744).
No complete1GB restored-body result exists. The480-second/4GiB/2GiB system-floor
conditions, dataset and gates are unchanged, with no forced GC or missing
samples. Exact helpers/fixtures and fixed e31 product inputs remain unchanged;
all owned browser/server processes exit. The four watchdog tests pass in each
small self-check. Private evidence: `full-restore-transactions-20261101/audit-summary.json`.
This rejects two hypotheses, not a product-size limit or a claim that corrupted
data caused the failure. Whole UI/ONNX/Research/aggregate capacity remains open.

Local Docker Desktop normal startup also ends with context deadline exceeded;
no engine version/image is observed. Stalled owned read-query CLIs are stopped
after exact identity checks; Desktop/backend are not force-reset. Hosted Linux
validation is used instead. ConoHa's supplied server-detail URL is retained, but
the browser kernel failure and desktop USER_CONTROL still prevent reading its
connection details. No ConoHa setting or authentication is changed.

## Completed same-run hosted delivery and new e31 memory observations

[Run41286381032](https://github.com/ELRdn/Kyalulu/actions/runs/41286381032)
finishes successfully for exact1a0cb08c42f6f5228b107c12b00f348b5708d4c4:
WASM, Linux Cloud, Windows x64 Native and macOS arm64 Native all pass. The parent
downloads only Cloud check JSON/hash files, Native acceptance records/screenshots
and manifests. Their cross-record hashes agree; the three reported CI/fixture/
Dockerfile code hashes match exact committed Git bytes. The parent does not
download or independently hash the executable archives, or execute downloaded code.

Cloud checks227 copied files, all three official scenarios, UID10002/network
none/read-only, closed unapproved Auth/region/billing/ads, and the unmodified
default Uvicorn health/Device bytes and headers. The source-offer hash is
`e7a2216c78f9d72c7bc521f5072ff210c4a1006d0dd949dc1d6fa07a562e98bd`.
Native CLI acceptance on both development hosts verifies start/restart,
fictional backup/restore/rollback and seven pointer faults with process exit.
JA/EN browser entry checks retain draft/target/receipt/history over restart,
with two mock generations and zero external requests/page errors per host.
The reported Native archive hashes are Windows
`6bfb4d02621ec5f778002526b80ab0f5c279e148387ba1602e18448814233567`
and macOS `5f476e5b00f6bf8566acbd6ce2bfc9049cd390fe70f83f3ab9be1b8022988945`.
This is actual hosted packaging/fictional-data acceptance, not clean OS,
first public download, real inference, physical-device or production acceptance.
Separate Runtime/Web CI is still tracked independently. Private retained evidence:
`hosted-delivery-1a0cb08-20261101/{run.json,parent-audit.json}`.

A separate real-model cohort reuses the immutable tested e31 source/build and
original cached model, runs exactly the first20 stock Librarian30 turns once,
and retains2048/256, stock sampling, no seed override/retry and the existing
2400-second bound. All20 complete;460 fixture assertions,20 independent full
original-input/window comparisons and20 exact fresh-read-only-restart receipts
pass. All3,125,578,496 cached model bytes, original model metadata and source/
build/native inputs remain unchanged. Owned browsers/server exit and the exact
dedicated profile is free. Only the restart observer's old three-attempt
cardinality is corrected to20 during the run; before/after hashes are retained
in `observer-correction.json`. No generation input or comparison is changed.

There are four native memory proposals. Two exact-source supported proposals
occur at turns9/20, but both are general requests for suggestions. The explicit
flower, drink, meeting plan and changed preference at turns1/2/3/15 produce no
proposal. Two source-mismatched candidates remain unverified and are excluded
from injection on12 candidate observations. Textual correspondence therefore
works in this bounded sample; useful fact selection/recall and response quality
remain unaccepted. Replies also include a changed meeting date and literal
structured-output text inside an accepted reply string; valid outer JSON is not
conversational quality. No seeded A/B, full30-turn recall or guarantee against
earlier JSON failures is claimed. Private evidence:
`real-memory-quality-e31-20261101/run-402f5e76-1ed6-44c3-bfb9-43b6d0628755/{acceptance-summary.json,memory-injection-audit.json}`.

Draft/region/provider and production holds remain in effect.
