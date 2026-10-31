# Unicode token estimate allocation (2026-10-31)

Device memory retrieval and saved token-budget telemetry call `estimateTokens`.
Portable prompt compilation uses a separate estimate for Lore admission and prompt
metadata. Both estimates previously created a complete Unicode character array;
memory estimation also created a filtered array.

The two estimators now count code points with string iteration. Their existing
classification (`codePoint > 0x2e80`), divisors, minimums and rounding are unchanged.
They still scan the complete string. Case folding, prompt assembly, Worker fitting,
raw_prompt and research persistence are unchanged. No dependency or API was added.

## Validation

- Six related Web files: **117 passed** in **6.27 s**. This includes existing
  Native-derived memory/story/Portable fixtures, generation and Research tests.
- New checks compare the former array algorithm for empty/ASCII/CJK/astral/combining
  text, the exact U+2E80/U+2E81 classification boundary, unpaired surrogates and a
  1,000,000-code-point message. Lore admission is checked at and just below its
  existing budget. A guarded `Array.from` refuses full input character arrays.
- TypeScript check passed.
- The existing actual Chromium generation-persistence driver passed **84/84** on
  the changed source: ordinary/regenerated local/sync legacy/world/shared results,
  stopped/invalid responses, receipt quota, account/revision/body-token competitors
  and reload recovery. All **293 input hashes** stayed unchanged, **318** write
  source parsers retained zero root messages; external attempts/page errors/native
  Workers were zero and owned Vite stopped. Inference alone was synthetic.
- Corresponding-source fixture/helper closure: **3 passed, 10 deselected** in
  **12.23 s**; a read-only pytest cache warning did not affect the checks.

Logs: `.artifacts/unicode-token-estimates-targeted-final.log` and
`.artifacts/unicode-token-estimates-typecheck.log`.
Browser log: `.artifacts/unicode-token-estimates-browser-final.log`.
Result retained as `.artifacts/unicode-token-estimates-generation-result.json`
(SHA-256 `c54cb1ebe23affaa2b1a64f7355b585419b7650aac6d6f89e9480d5c7fe6fb23`).
Source fingerprint: `fbc74542c3ee7c7e9078e9e6e68302f947577d368d16e7828eea8c4494facede`.
Source-closure log: `.artifacts/unicode-token-estimates-source-closure.log`.

The first sandboxed unit attempt failed to read Vitest's temporary SSR cache before
five suites could load; using task-owned project TEMP/TMP resolved this. The first
browser launch was interrupted after sandbox execution stalled; its exact Python/
Vite processes were confirmed absent before rerunning in the normal local test
environment. These initial attempts are not counted as successful verification.

## Limits

These remain estimates, not exact model tokenizer counts. No end-to-end heap/RSS
measurement, real model, physical-device or 1 GB generation acceptance is claimed.
Actor history/input/pre-fit raw_prompt still remain whole, and case folding and
other text-processing operations may still allocate character arrays.
