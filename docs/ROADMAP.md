# ROADMAP — Kyalulu

> SPEC: `PROJECT_SPEC.md` 93章 Suggested Milestones / 90章 v0.1 Definition of Done を正とする。
> 最終更新: 2026-08-30

## Phase / Milestone 対応

| Phase | Milestone | 概要 | 状態 |
|---|---|---|---|
| Phase 0 Foundation | M1 Skeleton | monorepo, Frontend, FastAPI, schemas, SQLite, provider interface, health | ✅ 完了 |
| Phase 0 Foundation | **M2 First Chat** | Ollama/LM Studio/streaming/基本チャット/モデルレジストリ | ✅ 完了 |
| Phase 0 Foundation | **M3 Character Runtime** | character YAML, persona, world, prompt compiler, state, structured output, validation | ✅ 完了 |
| Phase 0 Foundation | **M4 Experiments** | scenario実行, 3-run, metadata, storage, JSON export | ✅ 完了 |
| Phase 0 Foundation | **M5 Research UI** | A/B/C grid, inspectors, ratings, telemetry | ✅ 完了 |
| Phase 0 Foundation | **M6 Official Benchmark** | E:mocha / M:senior_cool / H:butler + N-E:mocha_night(ほのめかし) / N-H:butler_night(行為) + 5シナリオ + nsfwフラグ + metrics/leaderboard | ✅ **完了** |
| Phase 0 Foundation | M7 Immersion (experimental) | 同一ランタイムの簡略チャット + Debug Drawer (Ctrl+Shift+D) | ✅ **完了 (v0.1)** |
| Phase 1 | **M8 Electron Desktop (Win)** | Electron + React (electron-vite) 案A薄ラッパー、IPC/CORS、nsisビルド | ✅ **scaffold完了** |
| Phase 1 | Memory Lab | Semantic/Episodic/Relationship Memory | ⬜ |
| Phase 2 | Advanced Benchmark | 30/50/100 turns, 長文脈 | ⬜ |

## M1-M2 完了詳細

- [x] monorepo (pnpm 10 + uv 0.12) / TypeScript+React+Vite / FastAPI+Pydantic / SQLite
- [x] Provider抽象化: ollama / lm_studio / openai_compatible / responses / mock + factory + health
- [x] SSEストリーミング (EventSourceResponse, Vite proxy回避)
- [x] モデルレジストリ: `models/*.yaml` → SQLite同期
- [x] チャット: 履歴永続化 (session_id), タイプライター, Markdown, ダークモード, プリセット

## M3 完了
- [x] 共通スキーマ: `Character / Persona / World / Prompt / State` (Pydantic + Zod)
- [x] サンプルYAML: `characters/mocha.yaml`, `personas/default_male.yaml`, `worlds/beast_world.yaml`
- [x] Prompt Compiler + State + catalog API + 右ドロワー/Inspector + DB migration

## M4 完了
- [x] Scenario/Experiment スキーマ + Runner + CLI/API + 20turn×3runs 検証

## M5 完了
- [x] Research UI (A/B/C独立スクロール/stickyヘッダ/Inspector/★1-5 rating) + NSFWトグル準備

## M6 完了
- [x] スキーマに `nsfw / nsfw_level` 追加
- [x] キャラ追加: `senior_cool` (M) / `butler` (H) + NSFW: `mocha_night` (Eほのめかし) / `butler_night` (H行為)
- [x] シナリオ追加: `senior_daily_001` / `butler_daily_001` / `mocha_night_E` / `butler_night_H` (+既存mocha_dailyで計5本)
- [x] Runner/CLI `--nsfw` ガード + API `include_nsfw` / `list_experiments(nsfwフィルタ)` + Research NSFWトグル
- [x] 簡易自動メトリクス（文字数/repetition/失敗率/empty/avg_elapsed） — `runtime/python/core/metrics.py` + `metrics.json` + `meta.metrics`
- [x] 公式リーダーボード集計（SFWのみ） — `GET /api/leaderboard?scope=official|all` + Research UI

## M7 完了 (experimental → v0.1)
- [x] 同一ランタイムの簡略チャット（Immersion/Researcher切替） — `App.tsx` `my-zeta-researcher` トグル
- [x] Debug Drawer (`Ctrl+Shift+D`) — `Chat.tsx` で Researcherのみ表示、compiled prompt / token_breakdown / state を表示
- [x] トークン内訳 (`prompt_compiler.py` `token_breakdown`) + `GET /api/chat/debug`
- [x] Beginnerでは技術詳細をデフォルト非表示、没入UIを優先

## M8 完了 — Electron Desktop (Win) scaffold
- [x] `apps/desktop` 新設（electron-vite: `main` / `preload` / `renderer`）
- [x] `src/main/index.ts` — BrowserWindow + IPC `get-app-path`/`get-api-base`/`check-python-health`、devは `http://localhost:5173` を薄ラッパー表示
- [x] `src/preload/index.ts` — `contextBridge` + `sandbox:true`
- [x] `src/renderer` — `@web/App` を再利用（`@web` エイリアス）
- [x] `runtime/python/api/main.py` CORS 拡張（`allow_origin_regex=".*"` で `file://`/`app://` 対応）
- [x] `electron-builder.yml`（nsis, `out/`）+ ルート `package.json` に `dev:desktop`/`build:win` 追加
- [ ] `pnpm build:win` でインストーラ生成検証（次PR）
- [ ] Python sidecar 同梱（案B）は Phase 1.5 で別途
