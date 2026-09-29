# KCB-JA synthetic pilot / Dataset card

**Status:** Original, AI-authored synthetic public pilot. Not human-validated. Not a private test set. No benchmark result has been used to claim that a particular real model is best.

## Scope

Japanese, original adult fictional characters in small community creative/educational settings. Twelve characters with different voices, values and permitted behavioral ranges. No reproduction of commercial characters, copyrighted benchmark items, personal conversation logs, romantic/sexual scenarios, or graphic situations.

12 characters × 10 single-turn probes =120. Four diagnostic families per character (48) and six natural families per character (72). Twelve additional twelve-turn dialogues =144 responses. Total132 units,264 responses per repeat.

`characters.json` contains public cards. `cases.jsonl` contains `id`, `character_id`, `mode`, `family`, `turns`. Each turn contains a user message and `eval` metadata. The latter includes mechanical check definitions, diagnostic gold where appropriate, rubric dimensions and notes. Only the public card and the user message go to a candidate model.

## Creation / provenance

Newly authored for this deliverable, inspired by cited evaluation design principles. `tools/build_dataset.py` regenerates the same corpus. No upstream benchmark data or code is vendored. The public-task event oracle recomputes the diagnostic answer independently from the stored gold; tests check equality. This checks implementation consistency, not independent human agreement.

The scripted MOCK fixture deliberately uses the public-task solver. It is test infrastructure, not a model. Its perfect diagnostic score is not a benchmark finding. Its natural replies are canned, not evidence of a language model's conversational ability.

## Intended uses

Local server integration checks; comparison of configured models under a fixed Japanese protocol; inspecting response errors; collecting human labels; prototyping Kyalulu evaluation and debugging continuity.

Not intended for definitive commercial claims, safety certification, population-wide preference rankings, clinical personality diagnosis, or measuring real multi-day memory. A System bridge without actual memory is not evidence for Kyalulu memory performance.

## Known biases / limitations

Templates are shared across characters. A changed name does not create an independent new task. Scenes emphasize exhibitions, information sharing, courtesy and small-scale collaboration. The same upper response-length constraint favors a concise product style, not all forms of literary roleplay. Neither accents nor highly adversarial safety coverage nor many-character theatrical narration is comprehensively represented.

The fixed twelve-turn user scripts may not respond naturally to every model response. The tests do not simulate all users. Strict JSON tests also measure format adherence. The natural track deliberately avoids forcing a single ideal response and accepts contextually appropriate behavioral variation.

There is no train/dev/private split in v0.1. All shipped items are public development/pilot material. If used for training or prompt optimization, report scores as in-sample. For a future held-out release, create disjoint characters AND scenario families, audit leakage, freeze versions and keep access logs. Merely changing a random seed or secret filename is insufficient.

## Review before public claims

Have multiple Japanese-speaking reviewers inspect cards, gold, scenario plausibility, alternative acceptable answers and judge reasons. Log item defects, version changes and exclusions before comparing final test results. Keep easy anchor tasks when they verify essential behavior. Do not remove items solely because they hurt a preferred model.
