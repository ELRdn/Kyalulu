# Kyalulu ロードマップ

更新: 2026-09-06。Phase 0 M1〜M7の実装とMock受け入れを完了。現行10ルートとデザインを採用。
実装完了、試験合格、実モデルの評価範囲を区別する。詳細は [受け入れ結果](PHASE0_ACCEPTANCE.md)。

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

## 受け入れ状態

- Python: 34試験合格。Provider模擬HTTP、分割JSON、日本語/エスケープ、検証再試行、通信失敗、中断、旧DB移行、排他・二重保存、編集・再生成を確認。
- Web: 6単体試験合格。初回9秒待機でも生成要求1回、SSE途中切断、返答置換、中断を確認。
- Mock: 公式3シナリオ×20ターン×3回=180ターン合格。保存・評価・再実行・エクスポート・invalid/Mock除外を確認。
- Playwright: 1440px/390px × ライト/ダークの4条件合格。スクロール同期、Focus、Inspector、評価、export/replay、履歴復元、編集、再生成、会話切替、中断、設定保存失敗、キャラ紐付け、文体保存を確認。
- 型チェック: 全共有パッケージ/Web合格。schemasビルド/Web本番ビルド合格。
- Gemma 4: 指定GGUFをLM Studio Vulkan / RX7600専用で読み込み、SFW構造化1ターンが初回検証で合格。最終測定の表示開始87.11秒、全体97.97秒。通常利用の速度は要改善。

## 次の優先順位

1. **Gemma 4実機性能**: 現在の25% offloadを基準に、RX7600 Vulkan限定でコンテキスト・思考/出力枠・メモリ使用量を調整する。計測値を比較して快適さを評価する。
2. **実モデル受け入れ**: 20ターン×3回、複数シナリオの状態維持、Human評価、仕様94章の3モデル比較。単一ターン合格やMockを代用しない。
3. **M8 Desktop**: Electron Router/ThemeProvider・API base/IPCを統合し、renderer build、NSIS生成、インストール/起動を確認する。現在はscaffold。今回の既存Desktop変更はコミット対象外。
4. **後続**: Create/Character Sheet Builderの作成・保存API、Memory Lab、Python sidecar、30/50/100ターンの長文脈ベンチ。

## 境界

既存の成人向け素材を保持し、公式SFW用に `mocha_sfw` と安全な文体ファイルを整備。
通常のチャットでは技術情報を隠し、実プロンプト・保存状態・計測・失敗履歴はResearcher Debugへ集約。
push、配布、Desktop本実装、外部APIでのMuse代替検証は実施していない。
