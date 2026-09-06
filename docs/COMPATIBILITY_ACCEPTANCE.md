# 互換フェーズの受け入れ記録

実施日: 2026-09-06。Windows、Python 3.13.5、pnpm 10、Chromium 1234。
5系統の実装とKyalulu内の受け入れを確認した。外部アプリでの出力読み込みは未実施。
Phase 0の長期・3ローカルモデル比較を完了したという意味ではない。

## 自動試験

| 対象 | 結果 | 確認した内容 |
|---|---|---|
| pytest | **84 passed** | 既存34件＋互換50件。形式、API、保存、版固定、原本、再送、競合、ロール順序、マクロ、Lore、再現実験 |
| 公式Mockベンチ | **180ターン合格**（pytest内） | 公式3シナリオ×20ターン×3回。評価、export、replay、invalid／Mockの順位除外 |
| Web単体試験 | **6 passed** | 遅い初回応答、SSE境界・切断・中断・返答置換 |
| 型チェック | **合格** | 共有パッケージ、Web、既存Desktopの型チェック |
| ビルド | **合格** | schemas、Web本番ビルド。Viteの500 kBチャンク警告あり（失敗ではない） |
| Ruff | **合格** | 新規互換Python・API・保存・試験・実モデル検証スクリプトのFルール |
| 互換Playwright | **4条件合格＋個別フロー合格** | 1440px／390px、ライト／ダーク。取り込み→文体編集→保存失敗→再試行→PNG出力→再読み込み→挨拶→Mock会話→Debug→表情→再読込。BYAF候補・履歴選択、Character.AI貼付けとキャンセル、STプリセットのキャラへの適用も確認 |
| Phase 0 Playwright回帰 | **4条件合格** | Research独立／同期スクロール、Focus、Inspector、評価、保存失敗、export/replay、履歴復元・編集・再生成・中断・会話切替など |

形式fixtureは自作のSFWデータ。BYAFは公開v1のファイル参照・scenario直下のサンプラー・複数AI返答候補の形で固定した。
未知拡張、日本語、壊れたPNG、ZIP重複・symlink・パス逸脱、画像、Risuタプル形式、静的変数、部分的なCharacter.AI設定、Definition内のラベル文字列、CCv2への書き出しで古いCCv3 metadataが残らないことを確認した。
重複ZIPを作る負例fixtureによりpytestで1件のUserWarningが出る。テスト失敗はない。

スクリーンショットは `.artifacts/compat-e2e/` と `.artifacts/e2e/` に保存。スマホの長いキャラ名がヘッダーを押し出す点を修正し、画像でも確認した。
API8014／Web5189と専用データディレクトリを使用し、普段使いのライブラリ・履歴へfixtureを登録していない。

## Gemma 4実機

検証コマンド: `.venv/Scripts/python.exe scripts/verify_portable_vulkan.py`
記録: [実測JSON](evidence/portable-vulkan-2026-09-06.json)。全体ログは `.artifacts/portable-vulkan.json`。

| 項目 | 実測・設定 |
|---|---|
| モデル | HauhauCS Gemma4-26B-A4B-QAT-Uncensored Balanced Q4_K_M GGUF（指定ディレクトリ） |
| Provider | LM Studio OpenAI互換、構造化出力あり |
| 推論エンジン | **llama.cpp-win-x86_64-vulkan-avx2 2.33.0** |
| GPU | **AMD Radeon RX 7600、Vulkan**。mainGpu=0、内蔵GPU=1を無効化 |
| 読み込み | GPU offload 25%、context 8192、batch 128、KV GPU offloadなし、strict VRAM cap |
| ロード時間 | 16.77秒 |
| 入力 | 取り込んだSFW案内人＋「図書館の鍵は青色」のLore。「鍵は何色？」と質問 |
| 返答 | 「青色ですよ。」 |
| 構造化検証 | **成功、1試行、再試行0**。replyとstate_updateを同一生成 |
| 初回チャンク | 12.97秒 |
| 返答表示開始 | **107.28秒** |
| 生成完了 | **117.42秒** |
| Providerトークン | prompt 539 / completion 974 / thinking 866 |
| 速度 | 8.29 tokens/s（最終試行のprefillを含む全時間に対する値） |
| メモリ | PythonランタイムRSSピーク62,648,320 bytes。推論サーバーRAMではない。推論VRAMピークは取得できずnull |
| 終了後 | 専用検証インスタンスのみアンロード |

Vulkanの選択状態、GPU検出結果、要求したロード設定、実際のロード設定を検証してから生成した。CPU専用や内蔵GPUへ切り替えるフォールバックは行っていない。
モデル全体が8 GB VRAMへ収まらないため、GPU offloadとCPU/RAMを併用する。上表の短期確認は速度の実用合格、長時間の安定性、全形式の実モデル比較を意味しない。
今回、製品のMuse API推論試験は実行していない。コーディング補助へのMuse利用はモデル品質評価から除外する。

## 未検証・後続

- SillyTavern、Backyard AI、RisuAI等の実アプリ画面で、出力を再取り込みする操作は未実施。Kyalulu内での往復合格と別に扱う。
- 第三者の実キャラ／プリセット群での幅広い互換性確認。任意の拡張やマクロを全面再現する保証はない。
- スクリプト・動的変数・独自HTML・Text Completion専用整形・ST/BYAF専用形式への編集後exportは、今回の対象外。
- Gemma 4の返答開始時間改善、20ターン×3回、3ローカルモデル比較。Phase 0の残条件として維持する。
- M8 Desktop、Memory Lab、表情の自動切替、未参照資産の整理。

## 再実行

```powershell
uv sync --package kyalulu-runtime --extra dev --frozen
.venv/Scripts/python.exe -m pytest -q
pnpm --filter web test
pnpm typecheck
pnpm --filter @kyalulu/schemas build
pnpm --filter web build
```

画面試験は専用の空データディレクトリを使ってAPIを起動する。

```powershell
$env:KYALULU_DATA_DIR="$PWD/.artifacts/compat-data"
$env:KYALULU_EXPERIMENTS_DIR="$PWD/.artifacts/compat-experiments"
.venv/Scripts/python.exe -m uvicorn python.api.main:app --app-dir runtime --host 127.0.0.1 --port 8014
```

別ターミナルでWebを起動し、もう一つのターミナルで画面試験を実行する。`--chromium` はインストール済みChromiumの実行パスを指定するか、省略してPlaywrightの既定ブラウザーを使う。

```powershell
$env:KYALULU_API_URL='http://127.0.0.1:8014'
pnpm --filter web dev --host 127.0.0.1 --port 5189 --strictPort

.venv/Scripts/python.exe tests/e2e_compatibility.py --base http://127.0.0.1:5189 --chromium 'C:/path/to/chrome.exe'
```

Phase 0画面試験には、専用APIで公式3シナリオをMockで各1 run実行してResearch列を準備した後、`tests/e2e_phase0.py --base http://127.0.0.1:5189` を実行する。
実モデル試験は指定GGUFがローカルにあり、LM StudioのサーバーとVulkanランタイムが利用できる場合に限り、専用スクリプトを使う。
