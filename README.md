# Kyalulu — Local-first Character AI Runtime / Benchmark

> **Status (2026-09-06):** M1〜M6基盤実装あり（一部要件未完了） / M7 UI移行中 / M8 Desktop scaffold / Consumer UI刷新は未コミット・検証待ち — 詳細は [`docs/ROADMAP.md`](./docs/ROADMAP.md) / [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) を参照

## 概要

ローカル完結・OSSの Character AI ランタイムとベンチマーク基盤。
Model / Character / Prompt / Persona / World / State / Memory / Sampling / 評価 を分離し、再現可能に比較する。

- **Research Mode:** A/B/C比較、静的ベンチ、Inspector、Human Rating
- **Immersion Mode:** 同一ランタイムを使った没入型チャット（実験的）

## リポジトリ構成

```
.
├─ apps/web/          # TypeScript + React + Vite フロントエンド
├─ runtime/python/    # Python FastAPI + Character Runtime
├─ packages/
│  ├─ schemas/        # 共通スキーマ (Zod / Pydantic 対応予定)
│  └─ ui/             # 共通UIコンポーネント
├─ benchmarks/official/
├─ characters/ personas/ worlds/ prompts/ models/
├─ docs/
└─ experiments/       # ローカル実験結果（gitignore）
```

## 必要環境

- Python 3.11+ / [uv](https://docs.astral.sh/uv/) 0.12+
- Node.js 20+ / pnpm 10+

## クイックスタート

```bash
# 0. 環境変数 (初回)
cp .env.example .env
# → 必要なら .env を編集 (OLLAMA_URL / LM_STUDIO_URL / OPENAI_COMPATIBLE_URL)

# 1. Python ランタイム (http://127.0.0.1:8000)
$env:UV_CACHE_DIR="D:\VibeCoding\my zeta\.uv-cache"  # Windowsでcache権限エラー時のみ
uv sync --directory runtime
uv run --directory runtime uvicorn python.api.main:app --reload --port 8000
# 別: uv run --directory runtime fastapi dev python/api/main.py

# 2. Web フロントエンド (http://localhost:5173)
pnpm install
pnpm dev
```

### 動作確認 (MockでOK)

- ブラウザで `http://localhost:5173` → モデル `Mock Echo` を選んで送信
- 外部APIで試す: `.env` に `OPENAI_COMPATIBLE_URL` と `OPENAI_COMPATIBLE_API_KEY` を入れて再起動 → `gpt-4o-mini-external` で会話
- API直接: `curl http://127.0.0.1:8000/api/models` / `/api/providers/health` / `POST /api/chat/stream` (SSE)

### モデル追加

`models/*.yaml` を追加 → 再起動で自動でDBへ同期 (YAMLが正, SQLiteはキャッシュ)

## 技術スタック

- Frontend: TypeScript + React + Vite
- Backend: Python + FastAPI + Pydantic
- Storage: SQLite
- Providers: Ollama / LM Studio / OpenAI互換

## ロードマップ

> 詳細: [`docs/ROADMAP.md`](./docs/ROADMAP.md)

| Milestone | 概要 | 状態 |
|---|---|---|
| M1〜M3 Foundation / Runtime | monorepo、Provider、SSE、履歴、Character / Persona / World、Prompt Compiler | 最小実装済み。構造化State更新・検証は未完了 |
| M4〜M6 Experiments / Research / Benchmark | シナリオ実行、A/B/C比較、評価、5シナリオ、簡易metrics / leaderboard | 実装あり。詳細telemetry・実動作再検証は未完了 |
| M7 Immersion | 簡略チャット、Researcher設定、Debug | 旧UI実装済み／新UIへの移行確認中 |
| M8 Electron Desktop (Win) | Electron薄ラッパー、IPC、NSIS設定 | scaffoldのみ。新UI統合・配布検証は未完了 |
| Consumer UX刷新 | Home / Discover / Chats / Character Entry / Profile / Studio / Status | 未コミットの実装あり・受け入れ前。Createは予告画面 |
| 後続 | Character Sheet Builder、Memory Lab、Python sidecar、長文脈ベンチ | 未完了 |

2026-09-06の確認では、依存不足により型チェック・ビルド・pytest収集が停止。詳細と次の受け入れ条件は [`docs/ROADMAP.md`](./docs/ROADMAP.md) を参照。

## プライバシー

ローカルファースト。実験データはデフォルトで外部送信されません。

## ライセンス

未定 (TBD)
