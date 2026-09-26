# Kyalulu ロードマップ

更新: 2026-09-26（LE 統合・コンシューマーUI刷新・ライセンス決定）。
Phase 0 M1〜M7のMock受け入れは維持。LE・互換実装の完了と、Phase 0全体の実モデル受け入れ完了は区別する。

## 今回の到達点（2026-09-26）

- **LE（Kyalulu Local Engine）** を別リポジトリ [ELRdn/LE](https://github.com/ELRdn/LE) に作成。Locally Uncensored からのフォークで、UI を持たないヘッドレスな daemon として動く。設計は [LE_ARCHITECTURE.md](../LE_ARCHITECTURE.md)。
  - LE-0：`/le/v1/version`・`health`・`shutdown`、ループバック限定、Bearer トークン必須、構造化エラー、要求ID。
  - LE-1：OpenAI互換 `/v1/models`・`chat/completions`・`embeddings`（Ollama／LM Studio／llama.cpp／OpenAI互換へ振り分け）。
  - LE-1：GGUF のダウンロード（SHA-256・形式検証・原子的配置）、llama-server によるロード／アンロード、ハードウェア情報。
  - LE-1：ジョブ（冪等キー、キャンセル、永続化、再起動時は `interrupted`）、SSE イベント（再送対応）。
  - 子プロセスは Windows Job Object と pid 記録で後始末する。
- **Kyalulu 統合**：`le` Provider、LE 配信モデルの自動列挙（`le:<id>`）、`/api/le/*` 中継、`/api/commands`。チャット欄の `/le` スラッシュコマンドでロード・アンロード・ダウンロード・ジョブ操作ができる。
- **Desktop**：Electron が LE を検出し、必要なら起動・終了時に停止する。
- **コンシューマーUI**：Soft Mystic Portal へ刷新、キャラプロフィール、返事の候補、作り直した返事の履歴。
- **実機確認**：Kyalulu → LE → Ollama（qwen3.5:9b）で会話成功。LE 単体で GGUF のロード→会話（通常・ストリーム）→アンロード、LE 強制終了時の子プロセス停止、ダウンロード中断後の再起動、RX 7600／RX 9070 XT の検出を確認。
- **試験**：Python 124試験、LE（Rust）32試験、Web 型チェックに合格。
- **ライセンス**：Kyalulu を `AGPL-3.0-only` に決定（LE・上流と同一）。名称・マスコット・アイコン画像はコードのライセンス対象外。

## 前回の到達点（2026-09-06 Hub）

- TavernCardの内蔵SFW検索、SillyTavern Contentの確認済み一覧、RisuRealm／GitHub／Hugging Faceの公開URL取り込みを追加した。
- DiscoverとCreateに7サイトの外部Hubボタンを追加。新しいタブで開き、取り込み途中の入力を維持する。PC／スマホ・ライト／ダークで操作確認済み。
- 出典・原本ハッシュ・取得経路・版を保存。下書き復元、同一原本の明示的な複製／更新、限定取得先とOrigin検証を実装した。
- Hub画面4条件、Risuの実ブラウザー取得、公開TavernCard PNG／GitHubカード／HF生成設定JSONの取り込みに合格。詳しくは [Hub受け入れ記録](HUB_ACCEPTANCE.md)。

- CC／SillyTavern／BYAF／Risu拡張／Character.AIの5系統を取り込み、編集・保存・チャット・書き出しへ接続した。
- 原本と不変の編集版、画像、選択した履歴を保存。プレビュー／確定、再送防止、版競合、会話の版固定を実装した。
- 外部キャラ用のロール別プロンプトと毎ターンのLore採用をChat／SSE／Runnerへ統合した。
- Python 116試験、Web 13試験、型チェック・ビルドに合格。公式Mock 180ターンと既存画面4条件も回帰合格。
- 互換画面は1440px／390px × ライト／ダークに合格。取り込み、保存失敗後の再試行、挨拶、表情、履歴復元、書き出し、BYAF履歴選択、STプリセット適用を確認した。
- 指定Gemma 4をVulkan／RX7600限定で検証。Hubから取得したSFWカード＋試験用Loreで応答と構造化Stateが再試行なしで合格。表示開始108.44秒、完了117.67秒で、速度改善は継続課題。

対応範囲は [互換対応表](COMPATIBILITY.md)、試験手順と実測は [互換受け入れ記録](COMPATIBILITY_ACCEPTANCE.md) を参照。
Kyalulu内の往復試験と外部アプリでの受け入れは別扱い。後者は未実施であり、全面的な互換保証とはしない。
Webは `http://127.0.0.1:5174/`、APIは8000番。モデル検証後は専用の検証インスタンスをアンロードした。
既存Desktop変更・ローカル設定・設計草稿は今回のコミットから除外する。

## Phase 0

| 範囲 | 実装・確認済み | 残る評価 |
|---|---|---|
| M1 環境・Provider | lockfile復旧、Python試験依存、5 Provider、レジストリ解決、対応パラメータ伝達、要求/適用/未対応の記録 | 個々の外部サーバーによる互換差 |
| M2 Chat | 遅い初回応答、SSE境界・切断・中断、設定保存待ち、会話切替時の競合防止 | 実モデル長時間運用 |
| M3 Runtime | 通常Chat/SSE/Runner共通化、replyとstate_updateを同一生成、JSON検証・初回+最大2回、各試行記録 | モデルごとの品質・長文脈での状態維持 |
| 永続化 | SQLite移行、要求ID重複防止、セッション内排他、保存後done、編集/削除後スナップショット無効化 | 複数APIプロセス運用は対象外（単一プロセス起動） |
| M4 Experiments | 20ターン×3回、途中失敗保存、JSON export、保存設定・プロンプトからreplay | 実機で同規模の実験 |
| M5 計測 | 初回チャンク/返答開始/全体時間、Providerトークン・思考トークン、速度、ローカルCPU/RAM、範囲・欠測理由 | RX7600 VRAMピークの自動測定は未取得、nullとして明示 |
| M6 Research | 実スクロール同期、A/B Focus、6 Inspector、評価者/コメント/保存エラー、公式SFW識別、invalid/Mock除外 | Human品質評価の蓄積 |
| M7 Immersion | ActiveChat、新規/キャラ紐付け/編集/再生成/復元/文体保存、Researcher Debug、Ctrl+Shift+D | 継続利用の快適さ・実機性能調整 |

## Phase 0の初回受け入れ記録

- Python: 34試験合格。Provider模擬HTTP、分割JSON、日本語/エスケープ、検証再試行、通信失敗、中断、旧DB移行、排他・二重保存、編集・再生成を確認。
- Web: 6単体試験合格。初回9秒待機でも生成要求1回、SSE途中切断、返答置換、中断を確認。
- Mock: 公式3シナリオ×20ターン×3回=180ターン合格。保存・評価・再実行・エクスポート・invalid/Mock除外を確認。
- Playwright: 1440px/390px × ライト/ダークの4条件合格。スクロール同期、Focus、Inspector、評価、export/replay、履歴復元、編集、再生成、会話切替、中断、設定保存失敗、キャラ紐付け、文体保存を確認。
- 型チェック: 全共有パッケージ/Web合格。schemasビルド/Web本番ビルド合格。
- Gemma 4: 指定GGUFをLM Studio Vulkan / RX7600専用で読み込み、SFW構造化1ターンが初回検証で合格。最終測定の表示開始87.11秒、全体97.97秒。通常利用の速度は要改善。

## 優先順位

正式なフェーズ定義は [PROJECT_SPEC.md 91章](../PROJECT_SPEC.md#91-phase-roadmap) を維持する。
Phase 3の互換／Creator機能を先行実装し、残作業を次の順に進める。

| 順序 | 作業単位 | 成果物・完了条件 |
|---|---|---|
| 済 | Hub検索・URL取り込み | 公開SFW検索→内容確認→保存→会話を実装・検証済み |
| 済 | LE-0 / LE-1 と Kyalulu 統合 | 上記「今回の到達点」。LE 経由の会話と `/le` コマンドによるモデル操作まで |
| 1 | LE-1 の残り：直接接続との比較と自動設定 | バックエンド直結と LE 経由で返答開始時間・全体時間・tok/s・State JSON 成功率・再試行・キャンセル・20ターン安定性・再ロード回数・RAM/VRAM を比較。空きVRAMとレイヤー数から `-ngl` を決める配置計画、GPU選択、中断ダウンロードの再開（HTTP Range） |
| 2 | Phase 0の残作業：実モデル性能と受け入れ | Gemma 4 / RX7600 Vulkan を基準に、返答開始/完了時間と構造化成功率を比較。LE 経由の実行も同じ条件で測る。20ターン×3回と3ローカルモデル比較へ進む |
| 3 | M8 Desktop：日常利用の起動基盤 | LE 監督は実装済み。Python API の起動・停止、接続診断、モデル未ロード時の案内（`/le load` への誘導）、Windows 再起動後の履歴／ライブラリ復元を確認 |
| 4 | Phase 1：Memory Lab | 好み・事実、出来事、関係性の記憶を分離。由来と取り出した記憶をInspectorで確認し、Memory有無を同条件比較 |
| 5 | LE-2 以降 | ComfyUI による画像・動画（VRAM の受け渡しと会話モデルの復帰を含む）、音声、ツール／エージェント。範囲は [LE_ARCHITECTURE.md 18章](../LE_ARCHITECTURE.md) |

Phase 0の正式受け入れには、[仕様94章](../PROJECT_SPEC.md#94-initial-acceptance-test) の**3ローカルモデル比較**が残る。
現在指定済みのGemma 4以外の2モデルと実行条件は未確定。モデル登録だけでは比較完了にならない。
Muse Spark 1.3 Contributor APIは、ローカル性能が実用条件に届かない場合の代替候補として保持する。
製品からのAPI接続・速度・品質は未検証であり、API比較を3ローカルモデルの条件に数えない。
受け入れ前にM8の独立した作業を進める場合も、Phase 0の未完了項目は残して管理する。

M8では、今回の手動再起動を減らすために起動・停止・状態確認の共通手順を先に作る。
Python sidecar同梱は配布構成の別判断とし、APIを別起動する最初のDesktop版と区別する。

## Phase 1の最初の実装範囲（提案）

- Semantic / Episodic / Relationship Memoryのスキーマ、由来となる会話・時刻・バージョンを保存する。
- 書き込み・検索・編集・削除と、セッションをまたいだ復元を実装する。現在のRuntime Stateとは別の保存領域として扱う。
- Memory Inspectorに検索候補、採用した記憶、プロンプトへの追加量、検索時間を表示する。
- 同一モデル・設定・シナリオでMemory無効/有効を比較する。事実忘れ、誤った記憶、矛盾、不要な記憶の混入を別々に集計する。
- 完了条件：記憶の保存/訂正/削除/復元と比較実験を再現でき、モデルの能力とMemory機能の効果を区別して評価できること。

## 仕様上の後続フェーズ

| Phase | 内容 | 現在の状態 |
|---|---|---|
| 1 — Memory Lab | 3種の記憶、Memory Inspector、検索実験・失敗分類 | 未実装。上記の最小範囲を提案 |
| 2 — Advanced Benchmark | 30/50/100ターン、キャラ/シナリオ拡張、長文脈、好みへの適応、自動指標拡充 | 未着手 |
| 3 — Immersion Product | Character/Persona/World Creator、物語操作、import/export、Character Card対応 | 現行チャットと今回の互換／キャラ編集は先行実装済み。Persona/World Creator、物語操作などは後続 |
| 4 — Optimization | 計測に基づくプロンプト/State/Memory/推論最適化、必要に応じたネイティブ化 | 未着手。直近のGemma設定調整とは別の拡張フェーズ |
| 5 — Post-training Research | SFT、選好最適化、合成データ、キャラ特化学習 | RuntimeとBenchmarkが安定した後。未着手 |

## 境界

既存の成人向け素材を保持し、公式SFW用に `mocha_sfw` と安全な文体ファイルを整備。
通常のチャットでは技術情報を隠し、実プロンプト・保存状態・計測・失敗履歴はResearcher Debugへ集約。
LE は別リポジトリ・別プロセスとし、Kyalulu へソースを取り込まない（HTTP/SSE と設定可能な URL のみで接続）。
LE のトークンは API サーバーだけが持ち、Web へは中継とコマンド結果だけを返す。
Desktop 配布版（Python API と LE の同梱）、製品からのMuse API代替検証は未実施。コーディング補助へのMuse呼び出しは製品の推論検証には数えない。
既存5系統の外部アプリでの出力確認、実ユーザープリセットの差分収集は継続する。
