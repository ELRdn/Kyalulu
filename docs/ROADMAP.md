# ROADMAP — Kyalulu

> SPEC: `PROJECT_SPEC.md` 93章 Suggested Milestones / 90章 v0.1 Definition of Done を正とする。
> 最終更新: 2026-09-06

## 現状サマリー（2026-09-06）

- 確認基準は `main` の `b749852` と作業ツリー。M1〜M6、M7旧UI、M8 scaffoldはコミット済み。以下の「完了」は既存の実装到達点を表し、今回の動作試験合格を意味しない。
- Consumer UI刷新は作業ツリーに実装中。新規ページ・共通UI・設計資料・アイコン等は未追跡、既存UI・依存定義・lockfileにも未コミット変更がある。この文書更新のコミットには含めない。
- 現行UIは10ルートに分割済み。Createは予告画面、Studioは入口のみ。新UIとDesktopの統合、回帰試験、配布検証が残る。
- `PROJECT_SPEC.md` は基盤仕様を維持する。ローカルの `PRODUCT_SPEC.md` / `Kyalulu_DESIGN.md` / `Kyalulu_NEWDESIGN.md` は未コミットの設計資料として参照し、仕様の採用・優先関係はUI変更のレビュー時に確定する。

## Phase / Milestone 対応

| Phase | Milestone | 概要 | 状態 |
|---|---|---|---|
| Phase 0 Foundation | M1 Skeleton | monorepo, Frontend, FastAPI, schemas, SQLite, provider interface, health | ✅ 完了 |
| Phase 0 Foundation | **M2 First Chat** | Ollama/LM Studio/streaming/基本チャット/モデルレジストリ | ✅ 完了 |
| Phase 0 Foundation | **M3 Character Runtime** | character YAML, persona, world, prompt compiler, state | 最小実装済み・構造化出力は未完了 |
| Phase 0 Foundation | **M4 Experiments** | scenario実行, 3-run, metadata, storage, JSON export | ✅ 完了 |
| Phase 0 Foundation | **M5 Research UI** | A/B/C grid, inspectors, ratings, 簡易計測 | UI実装済み・詳細telemetryは未完了 |
| Phase 0 Foundation | **M6 Official Benchmark** | E:mocha / M:senior_cool / H:butler + N-E:mocha_night(ほのめかし) / N-H:butler_night(行為) + 5シナリオ + nsfwフラグ + metrics/leaderboard | ✅ **完了** |
| Phase 0 Foundation | M7 Immersion (experimental) | 同一ランタイムの簡略チャット + Debug Drawer | 旧UI実装済み／新UIへの移行確認中 |
| Phase 1 | **M8 Electron Desktop (Win)** | Electron + React (electron-vite) 案A薄ラッパー、IPC/CORS、nsisビルド | ✅ **scaffold完了** |
| Phase 1 | Consumer UX刷新 | Home / Discover / Chats / Character Entry / Profile + Studio / Status | 🚧 作業ツリーで実装中・未受け入れ |
| Phase 1 | Memory Lab | Semantic/Episodic/Relationship Memory | ⬜ |
| Phase 2 | Advanced Benchmark | 30/50/100 turns, 長文脈 | ⬜ |

## M1-M2 完了詳細

- [x] monorepo (pnpm 10 + uv 0.12) / TypeScript+React+Vite / FastAPI+Pydantic / SQLite
- [x] Provider抽象化: ollama / lm_studio / openai_compatible / responses / mock + factory + health
- [x] SSEストリーミング (EventSourceResponse, Vite proxy回避)
- [x] モデルレジストリ: `models/*.yaml` → SQLite同期
- [x] チャット: 履歴永続化 (session_id), タイプライター, Markdown, ダークモード, プリセット

## M3 最小実装済み
- [x] 共通スキーマ: `Character / Persona / World / Prompt / State` (Pydantic + Zod)
- [x] サンプルYAML: `characters/mocha.yaml`, `personas/default_male.yaml`, `worlds/beast_world.yaml`
- [x] Prompt Compiler + State + catalog API + 右ドロワー/Inspector + DB migration
- [ ] LLM構造化出力によるState更新と検証。現行 `runtime/python/core/state.py` はターン数の閾値に基づく簡易ルール。

## M4 完了
- [x] Scenario/Experiment スキーマ + Runner + CLI/API（20turn×3runsは旧ロードマップに検証記録あり、今回再実行なし）

## M5 UI実装済み・計測は最小構成
- [x] Research UI (A/B/C独立スクロール/stickyヘッダ/Inspector/★1-5 rating) + NSFWトグル
- [x] 最小計測: 各ターンのelapsed_ms、実行環境のplatform / Python version。
- [ ] TTFT（最初の応答までの時間）/ tokens毎秒 / VRAM・RAM等の詳細telemetry。

## M6 完了
- [x] スキーマに `nsfw / nsfw_level` 追加
- [x] キャラ追加: `senior_cool` (M) / `butler` (H) + NSFW: `mocha_night` (Eほのめかし) / `butler_night` (H行為)
- [x] シナリオ追加: `senior_daily_001` / `butler_daily_001` / `mocha_night_E` / `butler_night_H` (+既存mocha_dailyで計5本)
- [x] Runner/CLI `--nsfw` ガード + API `include_nsfw` / `list_experiments(nsfwフィルタ)` + Research NSFWトグル
- [x] 簡易自動メトリクス（文字数/repetition/失敗率/empty/avg_elapsed） — `runtime/python/core/metrics.py` + `metrics.json` + `meta.metrics`
- [x] 公式リーダーボード集計（SFWのみ） — `GET /api/leaderboard?scope=official|all` + Research UI

リーダーボードのauto_scoreは失敗率・反復率から計算する仮式。正式な品質指標としての妥当性検証は残る。

## M7 実装済み・現行UIへ移行中

- [x] 旧UIでImmersion/Researcher切替、Debug Drawerを実装済み（コミット履歴）。
- [x] バックエンドに `prompt_compiler.py` の `token_breakdown` と `GET /api/chat/debug` が存在。
- [ ] 新UIの機能同等性を受け入れ確認。作業ツリーでは `Chat.tsx` を削除し、`ActiveChat.tsx` / `lib/mode.ts` へ移行中。
- [ ] Debug表示を確認。現行 `Ctrl+Shift+D` はResearcher用の詳細設定Sheetを開く。Inspectorは `compiled.system_prompt` を表示するが、旧ロードマップのtoken内訳・state表示の同等性は未達。

## M8 完了 — Electron Desktop (Win) scaffold
- [x] `apps/desktop` 新設（electron-vite: `main` / `preload` / `renderer`）
- [x] `src/main/index.ts` — BrowserWindow + IPC `get-app-path`/`get-api-base`/`check-python-health`、devは `ELECTRON_RENDERER_URL` 優先、未設定時は `http://localhost:5173` を表示
- [x] `src/preload/index.ts` — `contextBridge` + `sandbox:true`
- [x] `src/renderer` — `@web/App` を再利用（`@web` エイリアス）
- [x] `runtime/python/api/main.py` CORS設定を拡張（`allow_origin_regex=".*"`。配布時の接続・許可範囲は要検証）
- [x] `electron-builder.yml`（nsis, `out/`）+ ルート `package.json` に `dev:desktop`/`build:win` 追加
- [ ] `pnpm build:win` でインストーラ生成検証（次PR）
- [ ] Python sidecar 同梱（案B）は Phase 1.5 で別途

## Consumer UX刷新 — 作業ツリーの実装状況

以下は2026-09-06のソース確認結果。未コミットの実装であり、実機での合格判定ではない。

| 領域 | 確認できた実装 | 残作業・完了条件 |
|---|---|---|
| ナビゲーション | `App.tsx` に10ルート、`AppShell`、Web入口にHashRouter / ThemeProvider | 各ルートの直接遷移・再読み込み・モバイル表示を確認 |
| Home / Discover | catalog / sessions API呼び出し、検索・mood / worldフィルタ | API接続時と空データ・エラー時の表示確認 |
| Character Entry / Chats | キャラ詳細、新規セッション作成、履歴検索、ピン留め | キャラ紐付け、送信、履歴復元、セッション切替の回帰確認 |
| Active Chat | SSE送信、編集・再生成処理、文体設定、コンテキストパネル、Researcher設定 | ストリーム終了・中断・失敗、設定保存、M7 Debugの同等性確認 |
| Profile | 表示名・テーマ・Researcher設定・ピン留め（ローカル保存） | 保存・再読み込み確認。アカウント同期は未実装 |
| Studio / Research / Status | Studio入口、既存Research画面、health / provider状態取得 | Studioの設定本体はActiveChat内。比較・評価・leaderboardの回帰確認 |
| Create | Character Sheet Builderの予告画面 | 作成API・保存・編集は未実装。Builder設計後に別途実装 |
| ブランド素材 | Web favicon、Desktop icon設定・素材が作業ツリーに存在 | 配布物への収録と表示を確認 |

## 直近の優先順位・受け入れ条件

1. **検証環境の復旧とUI変更のレビュー**: 既存lockfileに沿って依存環境を整え、型チェック・ビルドを通す。未コミットのUI・設計資料・素材をレビューし、採用範囲を確定して別コミットにする。
2. **Consumer UIの回帰確認**: Mockで送信・再生成・履歴復元・キャラ選択・設定保存、Researchの比較・評価・NSFWフィルタを確認。デスクトップ幅とモバイル幅の画面・キーボード操作も確認する。
3. **Desktop統合**: `apps/desktop/src/renderer/main.tsx` にWeb側と同等のRouter / ThemeProviderがないため、新しい `App` との統合を修正・検証する。`apps/web/src/lib/api.ts` の相対 `/api/...` とIPCのAPI baseを統合し、`file://` 配信でのAPI接続を確認する。CORS設定の存在だけでは完了扱いにしない。
4. **Windows配布検証**: rendererビルド後にNSIS生成・インストール・起動・API接続を確認する。現行 `pnpm build:win` はelectron-builderのみを実行するため、事前に `pnpm build:desktop` が必要。Pythonランタイムは別途起動が必要な案Aのまま。
5. **基盤の未完了要件**: M3の構造化State更新・検証、M5の詳細telemetry、自動テストを整備し、v0.1 Definition of Doneを項目ごとに確認する。
6. **後続開発**: Character Sheet Builderの設計・作成API、Memory Lab（Semantic / Episodic / Relationship）、Phase 1.5のPython sidecar、Phase 2の30/50/100ターン長文脈ベンチを順次具体化する。いずれも完了扱いにしない。

## 今回の検証結果（2026-09-06）

| 確認 | 結果 | 根拠・制約 |
|---|---|---|
| Git履歴・差分・ソース確認 | 実施 | 基準 `b749852`。既存の未コミット変更を含む現状を確認 |
| `pnpm typecheck` | BLOCKED | `packages/schemas` / `packages/ui` で `tsc` が見つからず停止。ローカル依存不足の警告あり |
| `pnpm build` | BLOCKED | `packages/schemas` の `tsc -b` が起動できず停止 |
| `.venv/Scripts/python.exe -m pytest --collect-only -q -p no:cacheprovider tests` | BLOCKED | `No module named pytest`。`tests/` は空で、追跡済みのテストファイルも確認できず |
| UI / APIの実動作・実モデルベンチ | 未実施 | 今回はコード上の実装状況の確認。過去の20turn×3runsの記載を今回再検証したものではない |
| Windowsインストーラ生成・実機起動 | 未実施 | M8は引き続きscaffold段階 |

依存の追加・修復、アプリ実装変更、モデル呼び出し、配布は今回の文書更新に含めない。
