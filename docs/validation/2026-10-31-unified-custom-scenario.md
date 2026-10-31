# 独自Scenarioの公式判定修正 — 2026-10-31

対象: `D:/VibeCoding/my zeta`、`codex/unified-app-integration`。
本記録が対象とする既存実装・回帰ケース:

- `runtime/python/core/experiment.py`
- `runtime/python/api/experiments.py`
- `tests/test_experiments.py`

**最終関連試験は20 passed in 12.10s。実Remoteブラウザーでも `character=None` のまま完了した。**

## caller確認と最小修正

`run_single` のcallerを `runtime`、`tests`、`scripts` から検索し、APIのrun/rerun、
CLI、benchmark、比較・ローカル検証scriptが共通のrunnerを呼ぶことを確認した。
シグネチャ、データ形式、provider選択、保存処理の変更は不要。

旧判定では未登録IDかつ `character=None` が
`OFFICIAL_SCENARIOS.get(scenario.id) == scenario.character` を満たし、
公式内容照合の `load_scenario(scenario.id)` が `FileNotFoundError` を発生させる。
入力の独自YAML自体はパスから正常に読み込めているのに、APIは500になる。

最終実装は `core/experiment.py` の **`is_official_scenario`** を
`run_single` と `GET /api/scenarios` のcatalog表示で共有する。
helperはSFW、`scenario.id in OFFICIAL_SCENARIOS`、公式IDとcharacterの一致、
公式Scenario全体との一致を検査する。
未登録IDでは公式ファイルの再読込を短絡し、通常の独自実験として保存・完了する。
runner固有のextra promptなし、memory無効、履歴制限なし、という既存条件も保持した。
catalogも同じ公式性の基準を使い、未登録IDや公式IDを流用した改変内容を公式と表示しない。

## 再現から回帰確認

既存 `isolated` fixtureの `tmp_path` に架空の未登録IDのYAMLを作成し、
既存 `mock-echo` と `httpx.ASGITransport` で実API、runner、保存処理を通した。
API/loader/runnerの応答を偽造していない。

- 修正前: 新規APIテストは **1 failed / 1 passed**。
  `character=None` のみHTTP 500、元の `experiment.py:118` から
  `FileNotFoundError: scenario private_unregistered_scenario not found` を確認。
  比較対象の `character=mocha_sfw` は200。
- 修正後: 同じ2ケースが200、completed、official=false。
  保存済み `meta.json` とAPI metadataの一致、1 turnのMock応答、
  保存snapshotからのrerunがcompletedかつofficial=falseとなることを確認。
- 公式IDを流用し、characterをNone/別キャラへ変更した場合と、
  公式characterを維持してdescriptionだけを改変した場合も非公式扱い。
- catalogの5ケースは、未登録ID＋character=None/指定ありをいずれも非公式、
  正規の公式内容を公式、公式ID＋description改変/character改変を非公式と表示する。
- 正規の公式Scenarioに明示extra prompt、memory=true、履歴制限を個別に指定すると非公式扱い。
- 既存の公式3Scenario × 20 turns × 3 runsはofficial=trueを維持。
  既存のNSFW拒否、不正出力の保存・ランキング除外、export/rating/rerunも通過。
- 関連するmemory probeとbenchmarkのmemory比較・snapshot/replay試験も通過。

最終の関連試験は `.artifacts/custom-scenario-catalog-green.log` に
**20 passed in 12.10s** と記録されている。実験18件（catalog5件を含む）と、
`tests/test_memory.py::test_experiment_memory_on_off_with_probes`、
`tests/test_benchmark.py::test_paired_long_runs_snapshots_metrics_and_replay` の関連2件。
以前の15 passed in 12.66sはcatalog追加前の途中結果であり、最終集計には使わない。

初期再現のartifactは `.artifacts/custom-scenario-before-393c4b2eef1c493c989f69c19b3d80d9/`。
最初のsandbox既定tempでの2 setup errorsは、repo内の専用basetempへ変更して解消した履歴。

## 最終Remoteブラウザーの証拠

`.artifacts/remote-management-final-browser.log` は **19 checks成功**。
対応する `.artifacts/remote-v1/e2e-75b7817c/acceptance.json` では管理27要求が期待statusと一致し、
実PWA → Noise → loopback Relay → Host → isolated Runtimeの経路で研究操作を完了している。
架空の未登録scenario、`mock-echo`、1 turn × 1 run、seed 42、memory無効を使用した。

保存先は同fixture内の `experiments/52d30859-67e0-4f24-9bec-da8d05059600/`。
`meta.json` の `status=completed`、`provider=mock`、`character_id=null`、`official=false` を確認した。
driver差分でも入力 `character=None` と保存結果をassertしており、
既存SFW characterを明示する回避策は使っていない。
結果5ファイルを保存し、管理失効後のSHA-256不変、ブラウザーentities/登録済み鍵の不変、
Relayに研究canaryの平文がないこと、`external_attempts=[]` を確認した。

関連するRelay修正は消えたsession宛の遅延frameだけを破棄し、cross-host拒否を保持する。
`.artifacts/relay-late-frame-green.log` は **135 passed / 2 failed in 32.20s**、
失敗2件（operations-only subprocessのPermissionError、async unitの実行設定）の再実行は
`.artifacts/relay-late-frame-final-two.log` で **2 passed in 4.37s**。
これは**135件成功＋失敗2件の再実行成功**であり、137件を最終状態で一括再実行した証拠ではない。

## 検証範囲

DB、実験出力、独自YAMLは専用fixture内。実API/runner/保存処理と実Remoteブラウザーの
Mock検証であり、実LLM、外部provider、本番、物理端末/TLS、別PC接続のstorage隔離は未検証。
Remoteの2device権限分離は2principalのunit検証で、2つの実ブラウザーの同時接続実証ではない。
