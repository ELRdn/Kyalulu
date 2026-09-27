# Kyalulu CharacterBench v0.1

This MIT-licensed pilot is kept inside the Kyalulu repository as a separate benchmark. Run commands from this directory. Generated `runs/` data is local and excluded from Git. The Kyalulu runtime benchmark under `benchmarks/official/` is a different track.

**Japanese character-AI evaluation you can run locally.** Python 3.10+, standard library only, no required pip install. This is a runnable engineering pilot, **not a validated model leaderboard**.

→ **[日本語の起動手順・使い方](README_JA.md)**
→ **[研究比較・設計判断](docs/RESEARCH_AND_DESIGN_JA.md)**
→ **[計測方法と限界](docs/METHODOLOGY_JA.md)**
→ **[Gemma 4 no-thinking local pilot (Japanese)](docs/GEMMA4_NO_THINKING_PILOT_2026-09-27.md)**

In this source checkout, use the CLI below to run an offline MOCK demo or connect a local OpenAI-compatible chat server. The packaged ZIP's HTML launchers and pre-generated example are not part of this repository directory.

```console
python -m kcb validate
python -m kcb demo --out runs/my-demo
python -m kcb doctor --config configs/lmstudio.json
python -m kcb run --config configs/lmstudio.json --suite smoke --out runs/first
python -m kcb doctor --config configs/lmstudio-think-off.json --probe
python -m kcb run --config configs/lmstudio-think-off.json --suite all --out runs/gemma4-off-all
```

The corpus contains 12 original adult characters, 120 single-turn probes and 12 twelve-turn trajectories: **264 generations per model per repeat**. Separate structured state diagnostics, literal surface constraints, uncalibrated rubric judges, order-reversed pairwise comparisons and offline blind human review. No semantic score is inferred from a keyword check.

Core and System tracks cannot be mixed. The included System bridge is a reference session adapter, **not an integration with the actual Kyalulu app**. No model weights, API keys, raw real-model responses or real human annotations are bundled. An aggregate local Gemma 4 pilot is documented separately, with its limitations.

The report keeps exact-JSON diagnostic accuracy as the primary mechanical metric and adds per-field error breakdowns. The literal surface checker also recognizes common Japanese bullet markers. An explicit `python -m kcb regrade --run runs/YOUR_RUN` updates stored evaluations offline, archives the old ones, and records generation/grading versions separately. A response cut off at the token limit or returned with a non-normal finish reason is saved for audit but not scored or replayed into a dialogue. Neither field accuracy nor surface compliance is a character-quality score.

Source code and the newly authored corpus in this subdirectory: MIT (see its `LICENSE`). The surrounding Kyalulu repository keeps its own license. Primary research is credited in `docs/SOURCES.json`; upstream benchmark questions, answers and source code are not copied.
