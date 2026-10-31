# Device actor history projection

Normal Device generation previously retained every original message, including all historical before/after state, settings, memory snapshots and unknown authored fields. `readDeviceGenerationSource` now verifies the same entire source but returns an explicit transient context: source metadata/token, public header, message `id/uuid/role/content/imported_state`, and the complete latest message for regeneration. It no longer returns a purported complete `session` entity.

The private Device API adapter builds its actor context from that projection. Regeneration reads the complete latest `before` snapshot for state and memories; Research keeps its existing independent `scope.session` path. Prompt compilation, Worker input, pre-fit raw prompt and chapter summaries consume retained fields. Stopped/interrupted input filtering and the original numeric IDs/UUIDs remain unchanged.

Persistence never adopts projected history. Existing guarded generation commits reread the complete stored source and stream the admission append, terminal append or latest-assistant replacement. All retained historical fields, draft, snapshots, unknown values and unrelated fixed outbox remain in storage. Existing source revision/token, whole-body hash/UTF-8/JSON, pending domain, generation receipt and owner fences remain active. Inline legacy input still materializes its stored body; it uses the same transient projection after reading.

## Evidence

- Full Web: **1,530 tests / 94 files passed**. Unified build, including TypeScript: **passed (5.55s)**.
- New units exercise segmented and inline contexts with historical state/memory/settings/unknown fields, complete latest regeneration data, zero retained parser-root messages on the segmented path, exact records/meta/part byte preservation, corrupt final part rejection and foreign-owner rejection. Existing admission/completion, quota rollback, pending receipt and competing body-token cases remain.
- A multi-MiB typed-array deep comparison exceeded the unchanged unit deadline in the first full run. The final test compares the same ordered keys and every byte with the existing `Buffer.compare` pattern; fixture size, product logic and deadline were retained.
- Independent static review traced all actual callers, source-delta commits, prompt/raw-input/summary reads, regeneration/manual memory handling and Research. It found no concrete data-loss or behavior regression. Static review does not establish runtime or capacity acceptance.
- [Real Chromium generation and projection evidence](2026-11-01-unified-actor-context-browser.md): **84/84** cases, 156 direct projection reads, 120 historical-byte comparisons, 66 complete Worker-input comparisons and 12 exact saved raw-prompt comparisons. The large case contains 4,356,192 historical snapshot bytes. All 301 source fingerprints remain unchanged; owner processes and context close. Root-message counts and actual returned projections are observed separately.
- Corresponding-source fixture/module/Python-helper closure: **3/3 passed** after all changes.

Logs: `.artifacts/actor-context-web-all-final.log`, `.artifacts/actor-context-build-final.log`. Earlier failed/exploratory logs are preserved separately.

## Limits

All message text and its identity array still remain in actor memory; root metadata and one complete latest message are also whole. Worker structured cloning, assembled input, pre-fit `raw_prompt`, ONNX fitting and active Research serialization remain capacity work. There is no truncation of authored history and no claim of full 1 GB generation, peak RSS, physical-device, real-model quality, provider, clean-OS or production acceptance. No schema, dependency, public API wire format or production data changes are involved.
