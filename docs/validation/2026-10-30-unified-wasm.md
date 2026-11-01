# Fresh WASM build and bounded real-model verification

Baseline: `5ed8a8312db7d576970479e59f483e0e5931a863`. Fresh sources and outputs were kept in `.artifacts/unified-wasm-20261030/project/.artifacts/mobile-wasm`; earlier outputs and release candidates were not replaced. No production setting, account, conversation or model download was used.

## Inputs and build

| Input | Fixed revision / version | Download SHA-256 |
| --- | --- | --- |
| wllama 3.8.1 | `7ed17361caf221a84aa1e80ca85a3d6324f3af85` | `e13ce494a8e518ce074a2cb153921418d5c5dfc7a53755b75a8157160812c55f` |
| llama.cpp | `46ca246de9bb1c35269722a6240d37d9dfd79cad` | `6e23aa560b74171fa078d762baef6925a370ac61c6f16d0def95bd192c87b99b` |
| Existing toolchain | Emscripten 4.0.20, CMake 3.31.6, Ninja 1.12.1, Dawn v20260317.182325 | five tool binaries and eighteen Dawn files matched before/after |

`prepare.py` produced the committed PLE patch SHA-256 `df9b38b92075969e46f13a1031760b3a18c03b32c087cfb2f4bde3aa4efb4fed`. All 3,796 prepared source files matched the earlier prepared tree byte for byte. WSL Ubuntu built both variants with four compiler jobs and `EM_FROZEN_CACHE=1`: standard 732.523 seconds, compat 866.264 seconds. The public builder was then run against the same isolated work/tool roots: both targets reported `ninja: no work to do`, exit 0.

| Variant | Output | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| standard | wllama.js | 139467 | `bbaeb389f6c30edc380da692aff00a8355bc33188cc09ff12419a2669c18b6e1` |
| standard | wllama.wasm | 8784206 | `360a9a3497de2356b9dbf8941ee5e25b399a2eea089bd4b93c8859839051f0f5` |
| compat | wllama.js | 172589 | `275a72bb99f85e479250ae28a6d4c2e19967defa2f7f538d48dbbe4029a0bf32` |
| compat | wllama.wasm | 16026579 | `dc0f5eefa1ef994797ef7103b5e2732a2e60c6539c250144c84842689f8b9669` |

These outputs differ from earlier binaries. This proves a fresh build from checked inputs, not bit reproducibility against the previous outputs. The earlier four output hashes remained unchanged. `.gitattributes` fixes the builder to LF; a fictional Git repository with `core.autocrlf=true` tests Windows source export.

## Actual model execution

Dedicated existing test profile only: `.artifacts/mobile-test-browser`, Chrome **156.0.8078.49**, AMD rdna-4. The cached public `kyalulu-iq3m` model was used without downloading: `Naotaka0127/Kyalulu-E2B-JP-Rolepaly-beta-GGUF`, revision `afa8d2cf7d521cf045d8ac90a790670083d320a4`. All five shards, totaling **3,125,578,496 bytes**, matched catalog sizes and SHA-256. The harness reads model OPFS files, not conversation databases.

Common settings: context 512, maximum output 8, temperature 0, seed 12345, one thread. JS and WASM hashes were checked before every run. API/external requests and service workers were blocked; zero blocked requests and zero page errors were recorded.

| Execution | GPU layers | Response | Load + generation ms | WASM heap bytes | Weight buffer bytes |
| --- | --- | --- | ---: | ---: | ---: |
| standard | 36/36 | こんにちは。 | 7693.825 | 774701056 | 1513315072 |
| compat | 36/36 | こんにちは。 | 6425.985 | 739377152 | 1513315072 |
| explicit CPU | 0 requested | お元気ですか？ | 51556.165 | 1815347200 | 1513307232 |

All three runs reported lazy PLE and nonzero PLE row reads. GPU variants returned identical text. CPU output differs; this is not CPU/GPU numerical or quality equivalence, a speed ranking, RSS measurement, or a sub-1GB total-memory result. This is short PC Chrome execution, not Safari/Android/iPhone or twenty-turn acceptance. Owned browser/server processes were stopped afterward.

## Failed attempts and verification repair

Two earlier attempts timed out at native load after 600 seconds; their records remain under `runtime/` and `runtime-diagnostics/`. Vite transformed the direct `/@fs/.../wllama.js` request from 139,467 to 625,318 bytes. The harness now imports raw glue with `?raw` and checks its original hash; all three subsequent real-model runs succeeded. It records stage/backend/page errors and avoids waiting for worker exit when model initialization never completed. An earlier synthetic smoke failed before execution because its server was already stopped; it is not runtime evidence.

An initial helper filename shadowed Python's `inspect` module and was renamed before building. Initial CMake probe outputs were matched against the isolated probe and moved into `initial-config-probes/`; no probe artifacts remain at the repository root.

Evidence root: `.artifacts/unified-wasm-20261030/`. `acceptance.json` joins the source/patch/build hashes, preservation checks and three real-model results; `runtime-raw-assets/runtime-variants.json` holds the execution records. These generated/private evidence files are not release source. Previous `b133ce0` candidates contain the earlier WASM and remain separate; a newly assembled candidate must explicitly include and recheck the fresh outputs.
