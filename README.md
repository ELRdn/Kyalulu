# Kyalulu — Local-first Character AI Runtime / Benchmark

> **Status (2026-09-26):** ローカル実行エンジン LE と接続。LE が配信するモデルを `le:<id>` でそのまま会話に使え、チャット欄の `/le` コマンドでモデルのロード・アンロード・ダウンロードを操作できる。コンシューマーUIを刷新（Soft Mystic Portal）し、返事の候補と作り直し履歴を追加。 [ロードマップ](docs/ROADMAP.md) / [互換対応表](docs/COMPATIBILITY.md) / [LE設計](LE_ARCHITECTURE.md)

Memory Lab、30/50/100ターンの比較実験、Persona/World Creator、物語操作、DesktopのPython API監督を追加。Mockの長ターン360ターンとQwen3.5 9Bの短期比較を確認した。3ローカルモデルの正式受け入れ・長期品質・配布版同梱は継続中。 [今回の実装・検証記録](docs/validation/2026-09-26-roadmap-implementation.md)

## 概要

ローカル保存を中心としたOSSの Character AI ランタイムとベンチマーク基盤。
Model / Character / Prompt / Persona / World / State / Memory / Sampling / 評価 を分離し、再現可能に比較する。

- **Research Mode:** A/B/C比較、静的ベンチ、Inspector、Human Rating
- **Immersion Mode:** 同一ランタイムを使った没入型チャット（実験的）

Kyalulu はキャラクター・記憶・会話状態の正本を持ち、モデルの実行は別プロセスの **LE（Kyalulu Local Engine）** に任せる。
LE は [Locally Uncensored](https://github.com/PurpleDoubleD/locally-uncensored) から派生したヘッドレスランタイム（[ELRdn/LE](https://github.com/ELRdn/LE)）で、HTTP/SSE でのみ接続する。

## リポジトリ構成

```
.
├─ apps/web/          # TypeScript + React + Vite フロントエンド
├─ apps/desktop/      # Electron シェル（Python API / LE の起動・停止を監督）
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
LE を使う場合は YAML 不要。LE が配信中のモデルは `/api/models` に `le:<LEのモデルID>` として自動で並ぶ（例：`le:ollama/qwen3.5:9b`）。

### 人物像・世界観・記憶を使う

CreateまたはStudioの「ペルソナ・世界観」で設定を作成する。JSON入出力と版履歴に対応し、既存チャットは選択した版を使い続ける。
チャットの情報パネルで「会話の設定」から人物像と舞台を選び、「物語の進め方」で場面・目標・ペースを指定する。

「覚えていること」の「会話を覚える」をオンにすると、好み・事実／出来事・約束／関係の記憶を保存・検索する。手動追加・訂正・削除も可能。
同じキャラと人物像の保存版を選んだ会話で記憶を共有し、キャラ未指定の場合はその会話内で使う。設定は初期状態でオフ。
根拠の薄い自動提案は確認待ちとして残し、訂正するまで会話に使わない。ResearcherモードのMemory Inspectorで由来・候補・注入・推定反映を確認できる。

### 比較実験を実行する

Studio →「比較実験」で最大3モデル、シナリオ、記憶条件、反復数・シードを指定する。
30/50/100ターンのシナリオに対応し、検索件数・推定トークン枠・可視会話長も保存する。画面を閉じても実行を継続し、中止・途中結果・JSON書き出しに対応する。APIは1プロセスで運用する。

```powershell
.venv/Scripts/python.exe scripts/run_benchmark.py --models mock-echo --scenarios advanced_mocha_sfw_30 --memory compare
.venv/Scripts/python.exe scripts/verify_local_model.py --model qwen3.5-9b-ollama --scenario mocha_memory_001 --turns 8 --memory --no-thinking --timeout 600
```

記憶オン/オフは同じシードを使い、偶数反復では実行順を反転する。Mockと記憶条件を変えた実験は公式比較とは別に扱う。キーワード一致は人手の品質評価の代わりにはならない。

### Desktopを使う

```powershell
pnpm dev:desktop
# ビルドした画面で確認
pnpm build:desktop
pnpm --filter desktop preview
```

既に動くKyalulu APIを利用し、未起動ならcheckoutの`.venv`または`uv`でPython APIを起動する。自分で起動したAPI/LEだけを終了時に停止する。
起動するシェルから`KYALULU_API_BASE`（既定`http://127.0.0.1:8000`）、`KYALULU_REPO_ROOT`、`KYALULU_DATA_DIR`、必要なら`KYALULU_API_COMMAND`を渡せる。
保存先を指定した場合、実験もその配下へ保存する（`KYALULU_EXPERIMENTS_DIR`で別指定可）。開発版の既定DBはcheckout内、配布用ビルドではElectronのuserData配下。
Statusの「接続診断」でAPI・保存データ・LE・モデルの準備状況を確認する。Python/LEをインストーラーへ同梱する配布作業は未完了。

### LE（ローカル実行エンジン）と接続する

1. [ELRdn/LE](https://github.com/ELRdn/LE) の `le-daemon` を起動する（既定 `127.0.0.1:8130`）。Ollama・LM Studio を自動で経由し、`LE_LLAMA_SERVER_BIN` を指定すると GGUF を自前でロードできる。
2. Kyalulu API は `LE_API_TOKEN`、なければ LE が生成した `%LOCALAPPDATA%/kyalulu-le/api-token` を読む。設定例は `.env.example` と `models/example-le.yaml`。
3. Desktop 版は LE が起動済みならそれを使い、`KYALULU_LE_BINARY` があれば自分で起動して終了時に止める。

LE のトークンはブラウザーに渡さない。Web は `/api/le/*`（状態・モデル・ジョブ・イベントの中継）と `/api/commands` だけを呼ぶ。

チャット欄で `/` を打つとコマンド候補が出る（↑↓で選択、Tab/Enterで補完、Escで閉じる）。結果は入力欄の上に表示し、会話履歴には残さない。

| コマンド | 内容 |
|---|---|
| `/help` | コマンド一覧 |
| `/le status` | LE の版・ロード中モデル・RAM/VRAM・実行中ジョブ |
| `/le models` | インストール済み GGUF と、バックエンドが配信中のモデル |
| `/le load <id> [ctx=8192] [ngl=99]` | GGUF をロード（最大120秒待ち、完了でモデル一覧を更新） |
| `/le unload [id]` | アンロード |
| `/le download <url> [filename] [sha256=...]` | GGUF をダウンロード（SHA-256・GGUF形式を検証してから配置） |
| `/le delete <id>` | インストール済みモデルを削除 |
| `/le jobs` / `/le cancel <job_id>` | ジョブの一覧・キャンセル（IDは先頭数文字で可） |

## 技術スタック

- Frontend: TypeScript + React + Vite
- Backend: Python + FastAPI + Pydantic
- Storage: SQLite
- Providers: LE / Ollama / LM Studio / OpenAI互換 / Responses / Mock
- Local engine: [LE](https://github.com/ELRdn/LE)（Rust / axum、別リポジトリ・別プロセス）

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
| コンシューマーUI | Soft Mystic Portal 刷新、キャラプロフィール、返事の候補・作り直し履歴 | 実装済み |
| LE-0 / LE-1 | 別プロセスの実行エンジン、モデル配信・ダウンロード・ロード、ジョブとイベント、Kyalulu 統合と `/le` コマンド | 実装・実機確認済み。直接接続との性能比較は未実施 |
| M8 | DesktopのAPI/LE監督・診断・復元 | 実ElectronでAPI起動/停止・記憶復元・SSE確認。OS再起動と配布版は未検証 |
| Phase 1 | Memory Lab・Inspector・同条件比較 | 初期実装とQwen短期比較を確認。未保存・虚偽想起など品質課題が残る |
| Phase 2 | 12個の30/50/100ターンシナリオ・比較UI/CLI | Mock360ターン確認。実モデル長期・3モデル正式比較は未完了 |
| Phase 3 追加 | Persona/World Creator・物語操作 | 版固定・JSON往復・会話設定と復元を確認 |

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
node --test scripts/test_desktop_supervision.cjs
pnpm build:desktop
node scripts/verify_desktop.cjs
# 互換・Hub画面と実モデルの専用検証手順は docs/HUB_ACCEPTANCE.md
```

## プライバシー

ローカルファースト。実験データはデフォルトで外部送信されません。
外部Hubを選ぶと検索語・コンテンツID・ファイルパスを配布元へ送ります。会話履歴・モデル認証情報はHubへ送信しません。

## ライセンス

[GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）。

- ネットワーク越しに改変版を提供する場合も、利用者へソースコードを公開する義務がある。
- LE は Locally Uncensored（AGPL-3.0-only）の派生物で、同じく AGPL-3.0-only。帰属と取り込み範囲は LE リポジトリの `UPSTREAM.md` に記録している。
- モデルの重み・LoRA・外部Hubから取り込んだキャラクターカードは、それぞれの配布元のライセンスに従う。Kyalulu のライセンスはそれらに及ばない。
- 「Kyalulu」の名称、マスコット、ロゴ・アイコン（`apps/web/public/`、`apps/desktop/resources/`、`reference/` の画像）はコードのライセンス対象外で、再配布・改変版での使用には許諾が必要。
