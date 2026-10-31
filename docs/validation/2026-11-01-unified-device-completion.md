# Device completion events: shared public Runtime contract

PC Runtime and Cloud already omit `attempts`, `compiled` and `raw_prompt` from
public completion results. Device instead serialized the complete saved receipt
again into its SSE `done` event. Large diagnostic prompts were unnecessarily
encoded, buffered and parsed by normal chat clients.

Device now applies the same three-field omission only when sending `done`.
The complete receipt and conversation `last_generation` are saved first and are
unchanged; explicit local debug reads still return the original prompt/compiler
data. No request option, schema change, history truncation, Worker-input change,
billing change or persistence-fence change is introduced. Public non-diagnostic
fields equal the saved receipt's complete remaining JSON value.

Research persists full results through its scoped save callback before consuming
the terminal event. Its turn diagnostics, experiment session, detail API and
exports remain complete, even though its internal terminal notification is now
compact too. Cloud's stricter hosted diagnostic-retention policy is unchanged.

Evidence on source based on `81e5927` plus this change:

- A new Device regression fails on the original public completion shape. After
  correction it checks the exact complete public payload, absent diagnostic
  fields, a diagnostic-only canary absent from the stream, and unchanged stored
  receipt / last generation / explicit debug values.
- Research unit assertions compare original captured input with retained raw
  prompts/compiler output, latest saved session and the detail API. All 23
  existing Research tests pass before and after public-payload correction.
- Full Web suite: **1,541 passed / 95 files**; TypeScript and unified build pass.
  The build uses an explicit fictional Relay origin, not production configuration.
- Real Device/IndexedDB browser: **84/84 passed**, retaining normal/regenerated,
  local/sync, legacy/world/shared, stopped/invalid-output and quota/owner/revision/
  body-token cases. All 12 successful public completion payloads exactly match
  the persisted receipt minus the three diagnostic keys. Complete saved receipt
  JSON is **3,359,551–3,363,048 bytes**; public completion JSON is
  **4,471–7,703 bytes**. These are distinct measured representations, not a
  general latency or peak-memory claim.
- The same browser run retains 156 actor projections, 120 historical-byte pairs,
  66 complete Worker-input comparisons, 12 exact saved raw prompts and the
  multiple-MiB historical snapshot case. Measured source hashes remain unchanged;
  no blocked requests/page errors/native model Workers. Owned browser/Vite close.
- Actual Research UI passes JA/393/light and EN/1280/dark: eight-turn execution,
  diagnostic export, rating/reload, owner separation, explicit/navigation stop
  and denial of linked-PC administration. Synthetic inference only.
- Native real ASGI/SQLite/Mock contract checks the same absent public fields and
  full saved debug prompt/compiler/attempts, retaining replay/edit protection.
  Native storage plus source-closure suite: **10 passed**. A source regression
  first detects the missing Native contract test; adding it to the collector
  closes that omission.

Private evidence under `.artifacts/`: `device-completion-{red,web-all,typecheck,
build,native-contract}-20261101.log`, `device-completion-browser-20261101/result.json`,
`device-completion-research-browser-20261101/results.json` and
`device-research-done-regression/`. The full browser fixture uses the same assembler
for its history-input expectation; independent assembler coverage remains in the
separate prompt-allocation report.

Full actor history, stored diagnostic strings and their persistence serialization,
metadata/latest-message retention, Worker clones, merge/ONNX fitting and active
Research remain whole paths. This does not prove 1 GB generation/RSS, real-model,
physical-device, Linux package, commercial-provider or production acceptance.
