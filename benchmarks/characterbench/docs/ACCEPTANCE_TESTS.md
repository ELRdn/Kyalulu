# リリース検証記録

## リポジトリ取り込み後の追加確認（2026-09-27）

Windows 11 / Python 3.14.6で `py -3 -m unittest discover -s tests -q` を実行し、136試験が合格した。no thinking設定の無視検出、可視思考タグ検出、token上限・非正常終了の応答の非採点と対話停止、自己採点の明示、単発・対話の表面仕様内訳、厳密JSONのフィールド別誤答内訳、日本語の箇条書き検出、旧評価を退避するオフライン再採点を含む。GitHub ActionsにはUbuntu/WindowsのPython 3.11試験を追加した。ホストCIはこの記録時点で未確認。

実機ではLM Studio / Gemma 4 26B-A4B Q4_K_Mの `reasoning_effort=none` で22応答のsmokeが22/22生成成功、別フィールドの思考出力0だった。さらに失敗分のみの再試行を含む全264応答も完了したが、初回はSSEエラー10件・依存スキップ27件であり、意味品質は未校正。条件別のrun manifest、summaryおよび [実機パイロット記録](GEMMA4_NO_THINKING_PILOT_2026-09-27.md)を参照する。

以下は元のv0.1.0配布ZIPの検証記録であり、上記の新しいソース版の結果とは区別する。

確認日: 2026-09-27 / Python: 3.13.5 / OS: Linux x86_64

## 実行済み

`python -m unittest discover -s tests -v` — **128 tests / 128 passed**, 21.706 seconds in the recorded run. Detailed output: `test-log.txt`.

Covered: dataset schema/counts; diagnostic oracle recomputation; source-order immutability; public-card allowlist; no evaluation canary leakage over HTTP; strict JSON types/duplicate keys; rejection of code-like text; network opt-in; no HTTP redirect credential forwarding; visible-text TTFT; malformed/incomplete SSE; missing usage; exact run resume; changed settings/hash refusal; interrupted run; failed dialogue suffix; explicit retry; concurrent persistence; correct actual response history; judge evidence/null/error handling; partial judgment coverage; A/B order reversal; unresolved order sensitivity; blind labels; vote deduplication/conflict; Core/System separation; System reset/probe/MOCK propagation; CLI exit statuses.

The HTTP tests use an actual local HTTP/SSE server, but its responses are scripted. **It is not LM Studio, Ollama, llama.cpp or a real LLM.**

Full demo: two scripted candidates, **264 generations each**, then 84 MOCK rubric units for the fixture, 84 pairwise targets with two orientations (168 MOCK judge responses), paired state comparison and 84 blank human tasks. The fixture's score is only a software-test expected value. No model weights, external inference API or GPU were used.

## Browser checks

System Chromium rendered the generated HTML via in-memory `page.set_content`. The container's administrator policy prevented navigation to file URLs and loopback HTTP; this policy was not removed. Therefore direct file-opening, persistent file-origin storage and the OS download dialog were not independently verified here.

Verified: 264 response rows; search hides/restores matches; no original model labels in the blind HTML; five vote choices; save button constructs a valid JSON Blob; decoded JSON can be imported by CLI; comparison/index render; no JavaScript errors; no external page requests. Desktop width 1440 and mobile width390 were checked. A narrow-screen table overflow was fixed before release; document width then remained390 at viewport390. Details: `browser-test-summary.json`.

The browser-generated sample used an explicit `AUTOMATED_BROWSER_TEST_NOT_A_HUMAN` ID and scripted choices. It was used only to test import and calibration plumbing, **not to measure human preference**, and those mock votes are not included as research annotations.

## Portability / clean extraction

The release is re-extracted to a new directory containing spaces and Japanese characters and then validated, self-tested and smoke-demoed. Results of that packaging check are recorded in the separately delivered release verification summary. The package itself contains Windows launchers and a Windows/Linux CI matrix, but **Windows execution and hosted CI runs have not been performed in this environment**.

## Not established by these tests

Real-model chat-template compatibility, actual candidate quality, GPU performance/VRAM/cost, human agreement, independent judge validity, scientific reliability of a public leaderboard, long-term memory, or Kyalulu's actual runtime integration. Passing engineering tests is not a substitute for these evaluations.
