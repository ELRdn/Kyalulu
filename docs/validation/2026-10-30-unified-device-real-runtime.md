# Device structured replies with an actual cached model

2026-10-30. These probes run the normal Device API, IndexedDB coordinator,
MobileRuntime and actual GGUF Worker on PC Chrome. The existing dedicated
`.artifacts/mobile-test-browser` profile is used; no production conversation,
Cloud provider or model download is involved.

## Defects reproduced and repaired

The original `486f8cb` path rejected the standard character plus the structured
reply contract before inference: the conservative UTF-8 context bound exceeded
the 2,048-token context. Removing runtime bookkeeping from the model's state and
describing the current response shape once, plus compact memory instructions,
keeps this default case within its budget. Character text, narrative summaries,
the five editable state fields, source kinds, fictional-event distinction and
server-owned RPG/cast instructions remain. Neither the context allocation nor
the conservative bound was relaxed.

The actual model then returned plain text instead of the required JSON. Native
chat JSON-schema handling admitted a reasoning prefix, exhausting all 256 output
tokens without a reply; diagnostic native chunks confirmed that distinction.
Changing only the reasoning display format did not solve it and did not make
the output valid. Those failures kept the pending input, applied no story/memory
changes and were retained privately.

The Device request now carries an explicit root GBNF grammar for the existing
response contract. Field names/enums come from the shared schemas. It constrains
JSON from the first generated token, keeps up to three memory proposals, and
still requires the normal schema/provenance validation before saving. Native
reasoning budget/display overrides are limited to structured requests; plain
Mobile requests retain their prior options. ONNX still uses prompt instructions
and validation, not native grammar, and reports that distinction in telemetry.

## Real execution boundary

- Model: experimental `kyalulu-iq3m`, source repository
  `Naotaka0127/Kyalulu-E2B-JP-Rolepaly-beta-GGUF`, source revision
  `afa8d2cf7d521cf045d8ac90a790670083d320a4`, distribution revision
  `4d37b2546568cb4f1d413966483eb8391fe67b92`. All five cached shards, totaling
  **3,125,578,496 bytes**, were size/SHA-256 checked before execution.
- PC Chrome 156, actual standard WASM/WebGPU and lazy PLE. Context 2,048,
  output reserve 256, temperature 0, seed 12345 and top-p 1. GPU/RSS and physical
  phone memory ceilings are not established by this check.
- The exact JS/WASM assets came from fixed artifact CI **41045793166**. All four
  standard/compat output hashes matched the earlier accepted **41010931510**
  inputs. No unverified root `.artifacts/mobile-wasm` binary was substituted.
- A manual fact from a peer was injected into turn one. The source was then
  erased through the common API: foreign raw diagnostics were removed and the
  authored reply was retained. Turn two completed without the erased source.
  Canonical memories stayed attributable to the current conversation.
- Both replies parsed and committed through the actual storage coordinator.
  The first turn retained two messages; the second retained four. Conservative
  context fitting omitted the first pair from the second inference input while
  retaining all four saved messages. This is not full-history model recall.
- Diagnostic runs observed native chunks separately. The subsequent successful
  run used the unmodified Worker; no instrumented code is accepted as release
  evidence. External/API requests and page errors were zero. Owned Chrome/Vite
  processes closed and the cached model files were retained.

Private input/code hashes, failed attempts, raw artificial responses and final
results live under `.artifacts/real-device-memory-486f8cb/`. The directory name
identifies the base commit; the report records the tested working-tree file
hashes separately. These files, model caches and profile data are excluded from
Git. No reasoning text is published in this report.

The small probe establishes structured generation, shared retrieval and save/
erasure behavior. It does not establish conversational quality, persona ranking,
semantic use of the recalled fact, twenty-turn stability, ONNX/CPU/compat parity,
Android/iPhone acceptance, or completion of the entire unified plan. New
fixed-source packages must include the runtime repair before selection.

## Final source audit and bounded checks

The final audit read the Device/runtime diffs, shared response schemas, callers
and affected fixtures/tests. No further implementation repair was needed. The
four implementation hashes in the successful real-model report match the current
files. That existing two-turn probe was inspected, not rerun during this audit.

The earlier 1,248-pass log and build predate the final Worker/test edits, so the
audit reran typechecking (`tsc --noEmit --incremental false`), the default Web
Vite build into a separate output directory, and the full Web tests. All passed:
**82 files, 1,248 tests**. SHA-256 snapshots of 384 source/config/fixture/document
inputs matched before and after the checks; only this audit note was added later.

Logs and snapshots are private under
`.artifacts/device-grammar-final-audit-20261030-120312Z/`. The first test attempt
could not read sandbox temporary SSR files (`ENOENT`); it is retained separately.
The successful run used its own repository-local TEMP/TMP and disabled the test
cache, without deleting shared caches or locks. Typechecking avoided shared
build-info writes. Existing build/localStorage warnings remain non-fatal.

This adds no new real-model, ONNX/CPU/compat, physical-device, deployment or
release-package acceptance. Production recovery documents/helpers were untouched.
