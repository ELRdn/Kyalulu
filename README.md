# Kyalulu — Local-first Character AI Runtime / Benchmark

> **Status (2026-09-06):** Hub検索・URL取り込みを追加。Discoverから公開SFWカードを探し、Createで確認・編集して会話へ進める。TavernCard／SillyTavern Content／RisuRealm／GitHub／Hugging Faceに接続。HubカードをGemma 4・RX7600 Vulkanで短期確認済み。 [ロードマップ](docs/ROADMAP.md) / [互換対応表](docs/COMPATIBILITY.md) / [Hub検証結果](docs/HUB_ACCEPTANCE.md)

## 概要

ローカル保存を中心としたOSSの Character AI ランタイムとベンチマーク基盤。
Model / Character / Prompt / Persona / World / State / Memory / Sampling / 評価 を分離し、再現可能に比較する。

- **Research Mode:** A/B/C比較、静的ベンチ、Inspector、Human Rating
- **Immersion Mode:** 同一ランタイムを使った没入型チャット（実験的）

## リポジトリ構成

```
.
├─ apps/web/          # TypeScript + React + Vite フロントエンド
├─ runtime/python/    # Python FastAPI + Character Runtime
├─ packages/
│  ├─ schemas/        # 共通スキーマ (Zod / Pydantic 共通契約)
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
pnpm install --frozen-lockfile
pnpm dev
```

### 動作確認 (MockでOK)

- ブラウザで `http://localhost:5173` → モデル `Mock Echo` を選んで送信
- 外部APIで試す: `.env` に `OPENAI_COMPATIBLE_URL` と `OPENAI_COMPATIBLE_API_KEY` を入れて再起動 → `gpt-4o-mini-external` で会話
- API直接: `curl http://127.0.0.1:8000/api/models` / `/api/providers/health` / `POST /api/chat/stream` (SSE)

### キャラ・プリセットを移行する

Createでファイルを選ぶか設定を貼り付け、内容を確認して保存する。「キャラを開く」で挨拶を選んで会話を始められる。
既存キャラの編集、Lorebook、画像、保存済みプリセットの適用もCreateから行う。チャットの「✦ キャラ・プリセット」で会話用のLore・表情を選べる。
CCv2/v3 JSON・PNG、CCv3 CHARX、Kyaluluバックアップ、原本を書き出せる。変換の制限はダウンロード前に表示する。

原本と編集結果は別保存。同名でも上書きせず、既存会話は選んだ版を使い続ける。外部画像URL・スクリプト・認証・モデルロードを自動実行しない。
詳しい形式と保持のみの項目は [互換対応表](docs/COMPATIBILITY.md) を参照。

### Hubから探す・URLを取り込む

Discoverの「TavernCard」「SillyTavern Content」で検索し、「詳細を見る」→「取り込み内容を確認」でCreateへ進む。
初期表示のライブラリではHubへ通信しない。SillyTavern Contentは確認済みのCoding Senseiの固定版から開始する。

DiscoverとCreateの「外部Hubを開く」から、TavernCard・RisuRealm・SillyTavern Content・Tavernary・GitHub・Hugging Face・Character.AIを新しいタブで開ける。編集中の画面は残り、Character.AIは貼り付けによる手動移行に対応する。

CreateのURL欄はTavernCard／RisuRealmのコンテンツページ、GitHub／Hugging Faceの公開ファイルURLに対応する。
RisuRealmはブラウザーで取得し、CC・Lorebook・ST形式プリセットを選べる。独自Module・独自プリセット・CHARXの取得は対象外。
区分不明のファイルは内容確認後にSFW／成人向けを選ぶ。同一原本は既存項目の更新または明示的な複製を選択する。
プレビュー・編集中の下書きと保存再試行IDは同じブラウザータブ内で復元できる。出典はバックアップとResearcher Debugにも保持する。

標準以外の開発用ポートでは、API起動時に `KYALULU_TRUSTED_ORIGINS` にWebの正確なOriginをカンマ区切りで指定する（例：`http://127.0.0.1:5190`）。
標準はlocalhost／127.0.0.1の5173・5174番。任意サイトからローカル取得APIを呼び出すことは許可しない。

### モデル追加

`models/*.yaml` を追加 → 再起動で自動でDBへ同期 (YAMLが正, SQLiteはキャッシュ)

## 技術スタック

- Frontend: TypeScript + React + Vite
- Backend: Python + FastAPI + Pydantic
- Storage: SQLite
- Providers: Ollama / LM Studio / OpenAI互換 / Responses / Mock

## ロードマップ

> 詳細: [`docs/ROADMAP.md`](./docs/ROADMAP.md)

| Milestone | 概要 | 状態 |
|---|---|---|
| M1〜M3 | 共通生成・構造化State・最大2回検証再試行・SQLite世代管理 | 実装・Mock試験合格 |
| M4〜M6 | 実験保存・計測・Research・公式SFW 3シナリオ | 20ターン×3回×3シナリオ合格 |
| M7 | ActiveChat・設定保存・履歴復元・Debug | 1440px/390px、ライト/ダーク合格 |
| 実モデル | Gemma 4 26B A4B / RX7600 Vulkan | 既存キャラと取込SFWキャラを短期確認。取込キャラ表示開始約107秒、長時間評価待ち |
| 互換・Create（Phase 3先行） | CC / SillyTavern / BYAF / Risu / Character.AI、ライブラリ、Lore、入出力 | 実装・Mock・画面試験合格。外部アプリ検証は未実施 |
| Hub連携（Phase 3先行） | 内蔵SFW検索、限定公開URL、出典と版の保存 | 実装・公開ソース取得・4画面条件・Gemma Vulkan短期確認に合格 |
| M8 / 後続 | Desktop / Memory Lab / 3モデル比較 | 未完了。互換の次は実モデル性能・受け入れを優先 |

### Gemma 4をRX7600で使用

LM StudioでVulkanランタイムを選択し、ローカルAPIサーバーを1234番で起動する。
指定モデルのGPU設定を確実にするため、読み込みスクリプトを使用する。

```powershell
uv sync --directory runtime --extra dev --frozen
.venv/Scripts/python.exe scripts/verify_lmstudio_vulkan.py --load-only --keep-loaded
```

チャットのResearcher設定で `gemma4-rx7600-vulkan` を選ぶ。専用識別子で読み込んだモデルにだけ接続する。
GPU offload 25%、RX7600のみ、context 8192。8GB VRAMに対してモデルは約16.8GBのためCPU/RAMも使用する。
詳細な検証も実行する場合は `--load-only` を外す。既に同じ識別子が読み込まれている場合は二重起動せず、LM Studioで確認する。
読み込みは1時間のアイドルTTL付き。速度と実測の範囲は[受け入れ結果](docs/PHASE0_ACCEPTANCE.md)を参照。

### 自動試験

```powershell
.venv/Scripts/python.exe -m pytest -q
pnpm --filter web test
pnpm typecheck
pnpm --filter @kyalulu/schemas build
pnpm --filter web build
# 互換・Hub画面と実モデルの専用検証手順は docs/HUB_ACCEPTANCE.md
```

## プライバシー

ローカルファースト。実験データはデフォルトで外部送信されません。
外部Hubを選ぶと検索語・コンテンツID・ファイルパスを配布元へ送ります。会話履歴・モデル認証情報はHubへ送信しません。

## ライセンス

未定 (TBD)
