# My Zeta — Local-first Character AI Runtime / Benchmark

> **Status:** Project Definition v1.0 (2026-08-15) / Skeleton Milestone 1 準備中  
> 詳細仕様は [`PROJECT_SPEC.md`](./PROJECT_SPEC.md) を参照

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

## クイックスタート（骨組み）

```bash
# Python ランタイム
uv sync --directory runtime
uv run --directory runtime fastapi dev python/api/main.py

# Web フロントエンド
pnpm install
pnpm dev
```

## 技術スタック

- Frontend: TypeScript + React + Vite
- Backend: Python + FastAPI + Pydantic
- Storage: SQLite
- Providers: Ollama / LM Studio / OpenAI互換

## ロードマップ

- Phase 0 (v0.1): Runtime Core, Provider抽象化, 静的20ターン×3ラン ベンチ
- Phase 1: Memory Lab
- Phase 2: Advanced Benchmark (30/50/100ターン)
- Phase 3: Immersion Product
- Phase 4/5: Optimization / Post-training

## プライバシー

ローカルファースト。実験データはデフォルトで外部送信されません。

## ライセンス

未定 (TBD)
