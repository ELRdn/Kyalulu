# Phase 0 M1〜M7 受け入れ結果

実施日: 2026-09-06。Windows / Python 3.14 / Node / pnpm。対象は共有Runtimeと現行Web 10ルート。
M8 Desktop、Createの本実装、Memory Lab、push/配布は対象外。

## 検証済み

| 試験 | 結果 | 主な確認範囲 |
|---|---|---|
| pytest | 34 passed | 5 Provider模擬HTTP、設定伝達、JSON構造化、3試行上限、通信失敗非再試行、JSON分割/日本語/エスケープ、中断、旧DB移行、要求ID・セッション排他、編集後状態破棄、再生成、旧実験互換 |
| Vitest | 6 passed | SSE分割・CRLF、多行、日本語、初回9秒待機、生成要求1回、reset、切断、中断 |
| Mock統合 | 180ターン合格 | 3公式シナリオ×20ターン×3回、状態更新/保存、評価、export/replay、invalid/Mock除外 |
| Playwright | 4条件合格 | 1440px/390px × light/dark、横はみ出しなし、実スクロール同期/A-B Focus/6 Inspector/評価と保存失敗/export/replay/履歴復元/編集/再生成/Debug/会話切替/停止/設定保存失敗/キャラ紐付け/文体保存 |
| TypeScript | 合格 | 全workspace型チェック、schemasビルド、Web本番ビルド。共有UIは型チェック対象（独立buildスクリプトなし） |
| Ruff F | 合格 | 変更した生成・保存・Provider・試験コードの未定義/未使用チェック |

実験・画面試験は `KYALULU_DATA_DIR` / `KYALULU_EXPERIMENTS_DIR` を `.artifacts/e2e-final-*` に向け、既存ユーザー履歴を使わず実施。
画面証跡は `.artifacts/e2e/`。pytestの実験データは一時ディレクトリへ保存する。

## Gemma 4実機

指定されたHauhauCS Gemma4-26B-A4B Q4_K_Mを使用。主GGUFは約16.8GB。
[機械可読の測定記録](validation/gemma4-rx7600-vulkan.json)にはエンジン・GPU検出情報・要求/実ロード設定・トークン・状態を保存。

- LM Studio llama.cpp Vulkan AVX2 2.33.0、Vulkan 1.3.290。
- GPU0 AMD Radeon RX7600、専用VRAM約8GB。内蔵GPU1を無効化し、CPU/RAMも使用。
- GPU offload 25%、context 8192、eval batch 128、KV cacheはCPU、strict VRAM cap。
- 通常挨拶: 11.46秒。共通RuntimeでのSFW構造化応答: 初回検証合格、再試行0。
- 最終測定: 初回チャンク24.80秒、返答表示開始87.11秒、完了97.97秒。
- Provider報告: 入力1487、出力741、うち思考617トークン。7.56 tokens/sはprefillを含む試行全体時間で除した値。
- RAMピーク61,370,368bytesはPython RuntimeのRSS。LM Studioや推論全体のメモリではない。RX7600 VRAMピークは未取得でnull。

最初のmax_tokens=128では思考で枠を使い切り空返答。長い既存プロンプト/1024枠では検証失敗とタイムアウト。
これらを合格にせず、SFW素材を修正して8192コンテキスト/2048出力枠で再検証した。
測定値には変動があり、先行試行では返答開始約135秒だった。現時点では快適な対話速度とは評価していない。

UIのモデルIDは `gemma4-rx7600-vulkan`。接続先はローカル1234番、明示ロードした識別子だけを使う。
再ロード手順は [README](../README.md)。スクリプトの `--keep-loaded` で1時間のアイドルTTL付きで保持可能。

## 未検証・残条件

Gemma 4での20ターン×3回、長時間の状態維持・OOM/温度/性能、Human品質評価、仕様94章の3モデル比較は未完了。
Muse Spark 1.3 Contributor APIによる製品の代替推論は未実施。Mock結果も、単一実機ターンも、これらの代替にしない。
Runtimeは単一APIプロセスで起動する。起動時に前回pendingをcancelledへ移すため、複数worker運用は対象外。
旧実験の閲覧は可能だが、保存設定/コンパイル済みプロンプトがない旧runのreplayは明示的に409。

## 再現

READMEの依存復旧と単体試験に加え、独立テスト用API/Viteを起動しMock実験を3件以上作成して実行する。

```powershell
.venv/Scripts/python.exe tests/e2e_phase0.py --base http://127.0.0.1:5174 --chromium <Chromium実行ファイル>
```

Playwrightブラウザが未導入なら `.venv/Scripts/python.exe -m playwright install chromium`。
今回の環境ではインストーラのキャッシュロックがEPERMだったため、既存Chromium 1234の実行ファイルを指定して試験した。
