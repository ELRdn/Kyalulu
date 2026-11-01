# Portable prompt allocation and large-history assembly

The Device prompt helper repeatedly case-folded the same Lore scan for each
entry and expanded history into `push(...messages)`. A 200,000-message fictional
history reproduces `RangeError: Maximum call stack size exceeded` in a Node fork
and in actual Chromium. The corresponding thread-pool case can pass because
argument limits vary by execution environment; no universal numeric limit is
assumed.

The shared helper now:

- Case-folds Unicode with the same pinned mapping through a reusable buffer of
  at most 4,096 mapped entries instead of a character array for the full input.
  The returned folded string still exists in full.
- Reuses one folded Lore scan per book/recursive pass, refreshing it after
  recursive additions. Case-sensitive matching, selective conditions, budgets,
  unsupported-condition rejection, selection order and audit records are unchanged.
- Collects summary strings and appends projected history messages directly.
  Each history slot retains its original position and creates independent
  role/content objects, without temporary filter/map arrays or variadic push.
  `forEach` preserves old sparse-array skipping; explicit null/undefined
  messages still reject. No caller, schema, dependency, token fitting, saved
  history, raw-prompt contract or persistence fence changes.

Evidence based on `33cd6e6` plus this change:

- The two new Lore regressions fail before the optimization and pass afterward.
  A 64-entry book folds its unchanged scan once; recursive scans refresh for
  each changed text. All mapped characters, representative unchanged Unicode,
  lone surrogates and long text match the old mapping exactly.
- Six small assembler cases compare complete output and JSON bytes with an
  independent copy of the old assembler, including multiple/missing history
  slots, summary prefixes, Unicode, frozen input and object identity. A sparse
  history regression caught a `for...of` difference during review; `forEach`
  restores the old behavior and retains explicit missing-message rejection.
- The large Node case checks all 200,000 role/content pairs and independent
  output objects without executing the old spread oracle on that case.
  The separate real Chromium probe reproduces the old spread failure and
  checks every message from the actual new helper, with no blocked requests
  or page errors. It is assembly-only, not a full-generation capacity result.
- Final related Web tests: **179 passed / 13 files**, including Runtime/Worker,
  context fitting, RPG, generation, shared scopes, Research and storage changes.
  Shared Python Portable fixtures and corresponding-source closure: **8 passed**.
- TypeScript and the unified production-mode build pass with an explicit
  fictional HTTPS Relay origin. The first build attempt correctly rejected an
  unset Relay origin; no production configuration was changed.
- Final actual Device/IndexedDB browser run: **84/84 passed**, covering normal and
  regenerated turns, local/sync storage, legacy/world/shared memory and stopped,
  invalid-output, quota and owner/revision/body-token conflicts. It compares 66
  complete Worker inputs and 12 saved raw prompts with its full-history fixture
  assembly; that fixture uses the same assembler, whose equivalence is checked
  separately by the independent small old oracle above. It also checks 156 actor
  projections and 120 original historical-byte pairs, retaining drafts. All
  measured source hashes remain unchanged.
  No blocked requests, page errors or native model Workers; browser/context and
  the owned Vite process close. Inference transport remains synthetic.

Private evidence includes `lore-fold-red-20261101.log`,
`portable-assembly-red-20261101.log`, `portable-assembly-sparse-red-20261101.log`,
`portable-prompt-reviewed-tests-20261101.log`,
`portable-prompt-python-fixture-20261101.log`,
`portable-prompt-reviewed-{typecheck,build}-20261101.log`,
`portable-prompt-200k-browser-20261101/result.json` and
`portable-prompt-reviewed-browser-20261101/result.json` under `.artifacts/`.
The 200k probe uses a private adapter; it is not a standalone published CI driver.

This removes specific temporary allocations and the argument-expansion failure.
Whole actor history, root metadata/latest message, result arrays, Worker cloning,
merge/fitting, pre-fit raw prompts, SSE diagnostics and active Research records
still retain whole paths. No peak RSS, total 1 GB generation, real model,
physical-device, complete package or production acceptance is claimed.

## Subsequent Lore history scan without a whole haystack

`selectLore` no longer joins the selected message bodies into a whole scan
string or folds that whole string. It walks references plus the original
newline separators in at most4,096-UTF-16-unit source chunks, keeps sufficient
boundary carry for the longest folded key, and computes matches once per
sensitivity/pass. Unicode folding, valid surrogate pairs and key matches
across chunks are preserved. Recursive additions become visible only on the
next pass, including the leading newline when the original scan is empty.

Candidate gathering reads only already-string keys and does not move key
validation forward. Disabled entries, constants, unsupported conditions and
inactive selective entries retain their old short circuits and error order.
The existing public casefold helper, entry/depth/budget limits, priority and
render/audit ordering, compile/assembly APIs and Python fixtures are unchanged.

An independent copied old loop compares complete selected/audit results,
render calls and exception class/message for250 deterministic mixed cases.
Boundary/folding expansion, surrogate and long/multiline keys,5,001-key lists,
empty scans/recursive passes, disabled/malformed aliases and budget errors
have targeted coverage. Instrumented tests reject history slice/map/join and
verify bounded source slices and equal source-fold work for two versus64
entries.82 focused tests and TypeScript pass. Parent's complete Web suite
passes1,864 tests/101 files with all337 Web/schema/UI source hashes unchanged;
all five shared Python portable-prompt fixtures pass independently. Private
evidence: `lore-stream-scan-20261101/{summary.json,parent-web.log,parent-web-result.json}`.

Carry still scales with the longest input key; huge key-list CPU/memory has
not received a separate acceptance. Original history is still held by the
main actor, and canonical input, ONNX whole-candidate tokenization, active
Research and full restoration remain separate paths. This eliminates a
specific full-history temporary allocation; it does not prove250MB/1GB total
capacity or a product RSS bound. The real4cd3673 model evidence predates this
source change and is not relabelled as a run of the new selector.

Parent also recompiles the portable snapshots and full saved histories from
all40 actual4cd model turns with the new selector: the complete compiled
objects match their frozen saved values. This is an offline compiler
equivalence check, not40 new model generations. The actual Chromium
generation matrix passes84 cases plus mock overflow/rescue with313 source
inputs unchanged and owned-process cleanup. Evidence:
`lore-stream-scan-20261101/{real-snapshot-compiler.json,browser/result.json}`.
