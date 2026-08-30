# Kyalulu — Local-first Character AI Runtime / Benchmark

> **Status:** M6 Official Benchmark 着手中 — 詳細は [`docs/ROADMAP.md`](./docs/ROADMAP.md) / [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) を参照

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
| M1 Skeleton | monorepo / FastAPI / SQLite / provider interface | ✅ |
| M2 First Chat | Ollama/LMStudio/OpenAI/Responses + SSE + 履歴/プリセット/ダークモード | ✅ |
| M3 Character Runtime | Character/Persona/World YAML + Prompt Compiler + State + 右ドロワー | ✅ |
| M4 Experiments | 20ターン×3ラン / metadata / JSON export | ✅ |
| M5 Research UI | A/B/C Grid + Inspectors + Ratings + NSFWトグル | ✅ |
| **M6 Official Benchmark** | E:mocha / M:senior_cool / H:butler + N-E:mocha_night / N-H:butler_night | 🚧 **着手中** |
| M5 Research UI | A/B/C Grid + Inspectors + Ratings | ⬜ |
| M6 Benchmark | 公式3キャラ (Easy/Med/Hard) | ⬜ |
| M7 Immersion | 簡略チャット + Debug Drawer (30% - 現行チャットがプロトタイプ) | 🔶 |

## プライバシー

ローカルファースト。実験データはデフォルトで外部送信されません。

## ライセンス

未定 (TBD)
