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
This is a built UI, not a fresh complete Native/Cloud archive or a new real-model
run. Existing d09742f archives and real4cd evidence remain separately pinned.
