# Changelog

## 0.1.2 — 2026-09-27

The literal no-headings/no-lists checker now recognizes common line-leading Japanese bullet markers. An explicit offline `regrade` command updates saved evaluations without regenerating model responses, archives old/new evaluations, and records generation and grading versions separately. This corrected 11 false surface passes in the Gemma 4 full-run pilot; it does not change the fixed corpus or Core prompt.

## 0.1.1 — 2026-09-27

Added an observed no-thinking assertion for OpenAI-compatible responses and a verified LM Studio Gemma 4 preset. Token-limit or non-normal-finish replies are retained for audit but excluded from scoring and dialogue history. Explicit retries archive prior failed/skipped records locally; failure-only retry concurrency can be reduced and is recorded. Reports now separate single-turn and dialogue surface compliance, show strict-JSON diagnostic field breakdowns, and label self-judging. The public synthetic corpus and Core prompt are unchanged; scores from runs created under 0.1.0 must retain their recorded version.

## 0.1.0 — 2026-09-27

Initial standalone engineering pilot. Original Japanese corpus, reference state oracle, OpenAI-compatible streaming harness, session-adapter contract, snapshot-based resume, literal checkers, rubric judges, reversed-order pairwise comparisons, blind offline human arena, JSON/CSV/HTML reporting and stdlib tests.

Pre-release testing identified and fixed in-place selection shuffling that changed the stored corpus order while retaining the old dataset hash. Regression coverage now protects source-order immutability. Semantic-judgment coverage, stale-judgment filtering and MOCK warnings are explicit. SQLite connections and HTTP error streams are closed explicitly for portability.

No actual model benchmark or human-validity claim accompanies this release.
