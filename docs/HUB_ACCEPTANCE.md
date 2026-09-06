# Hub検索・URL取り込みの受け入れ記録

実施日: 2026-09-06。Phase 3の互換機能を先行実装。Phase 0の長期評価・3ローカルモデル比較とは別の受け入れ。

## 結果

| 対象 | 結果 | 範囲 |
|---|---|---|
| Python | 116 passed | 既存84＋Hub32。HTTP模擬、Origin、公開IP固定、リダイレクト、サイズ・切断・中断、出典、重複、版競合、バックアップ、PNG分割 |
| Web | 13 passed | 既存SSE6＋Hub7。Risu CORS・資格情報省略、未対応取得先、実受信量、403/404/429、中断 |
| 型チェック／ビルド | 合格 | 全共有パッケージ・Web・既存Desktop型チェック、schemas／Webビルド。Viteの500 kBチャンク警告は継続 |
| 公式Mock | 180ターン合格 | 3シナリオ×20ターン×3回。pytestの既存公式ベンチを回帰実行 |
| Hub画面 | 1440px／390px × ライト／ダーク合格 | 初期表示でHub通信なし、SFW一覧、検索・空結果、詳細、取得、名前・文体編集、再読込、保存失敗後の再試行、重複、キャンセル、会話、Debug、バックアップ出力 |
| 既存互換画面 | 4条件＋個別フロー合格 | CC画像往復、BYAF履歴、CAI貼り付け、STプリセット適用、既存会話復元 |
| Phase 0画面 | 4条件合格 | Research、各Inspector、同期スクロール、Focus、評価、export/replay、Chat/SSE回帰 |
| Gemma 4 | Vulkan／RX7600で合格 | 実Hubカード＋ローカル試験Lore、構造化応答1試行。検証インスタンスはアンロード済み |

画面試験は専用API8016／Web5190と`.artifacts/hub-data`・`.artifacts/hub-experiments`を使用し、通常の履歴・ライブラリにfixtureを登録しない。
画面記録は`.artifacts/hub-e2e`、`.artifacts/compat-e2e`、`.artifacts/e2e`。下書きは同じブラウザータブ内で復元する。タブ終了後の共有・別端末同期は対象外。

## 公開ソースの実接続

### 外部Hubボタンの追加確認（2026-09-06）

Discover／Createの各7リンクを、1440px／390px × ライト／ダークでPlaywright操作確認。Web型チェックに合格。Enterキーでの新規タブ表示、リンク先URL、openerの分離、元画面・URL入力の保持、横はみ出しなし、初期表示のHub通信なしを確認した。
この追加確認は通常Web5174上の新規ブラウザーコンテキストを使用し、ライブラリ・会話への書き込みは行っていない。画面記録は`.artifacts/hub-links`。リンク先の応答は固定HTMLに置き換えており、各サイトの稼働状況を確認した結果ではない。以下の実取得結果とは区別する。

### 取り込み元の実取得

| ソース | 使用したサンプル | 確認 |
|---|---|---|
| TavernCard | [Priya Nair](https://www.taverncard.com/character/12c021b3-7efb-4157-85c7-134178fa6d81) | 公開APIのSFW判定、PNG取得・解析・画像保存。画像6,111,231 bytes、1536×2048、742 IDATチャンク |
| SillyTavern Content／GitHub | [Coding Sensei固定版](https://github.com/SillyTavern/SillyTavern-Content/blob/72acaca394237790106fa7b33e57ee50ea197127/assets/character/default_CodingSensei.png) | index、本文・ポートレート確認、固定SHA-256、Create→会話→出力の実取得。作者RossAscends、個別ライセンス不明 |
| RisuRealm | [KITTY](https://realm.risuai.net/character/a7a7b290-b0fd-4fe6-92e1-b093c05a0078) | 本文確認、`json-v3?cors=true`をブラウザーからguest取得。CORS応答、未判定区分の選択、出典の申告扱いを確認 |
| Hugging Face | [Qwen3-0.6Bの生成設定JSON](https://huggingface.co/Qwen/Qwen3-0.6B/blob/c1899de289a04d12100db370d81485cdf75e47ca/generation_config.json) | mainをコミットへ解決し239 bytesを取得。temperature=0.6／top_k=20／top_p=0.95をプリセットへ変換。モデル重みは取得しない |

TavernCardの実PNGは従来の200チャンク上限で失敗したため、総容量・CRC・画像寸法の検証を維持し、8,192チャンクとテキスト展開合計32 MiBの上限へ修正した。自作の多数IDATデータと上限超過の負例で回帰試験を追加した。
SillyTavernの一覧は確認済みファイルだけを登録する。全6キャラや全index項目のSFW確認を完了したという意味ではない。
HFは生成設定の実接続を確認したもので、HF上の全カード形式・全CDN・全LFSファイルを確認したわけではない。
RisuのLorebook／ST形式プリセットは模擬データで確認。今回の実ブラウザー確認はCC JSONであり、それらの実配布サンプルとRisu実アプリでの出力受け入れは未検証。

## Vulkan／RX7600

既存の厳密なハードウェア確認スクリプトを再利用。Hubの固定版を取得・ハッシュ確認し、原本と分けて「図書館の鍵は青色」の試験Loreと短い日本語応答の指示を追加した。

| 項目 | 結果 |
|---|---|
| モデル | 指定HauhauCS Gemma4-26B-A4B-QAT-Uncensored Balanced Q4_K_M |
| エンジン | llama.cpp-win-x86_64-vulkan-avx2 2.33.0 |
| GPU | AMD Radeon RX 7600、mainGpu=0、内蔵GPU=1を無効化 |
| ロード | GPU offload 25%、context 8192、batch 128、strict VRAM cap。13.86秒 |
| 応答 | 「図書館の鍵は青色です。」 |
| 構造化検証 | reply／state_update成功、試行1、再試行0 |
| 初回チャンク／表示開始／完了 | 18.74秒／108.44秒／117.67秒 |
| Providerトークン | prompt568／completion934／thinking833、7.94 tokens/s（prefill込み） |
| メモリ | Python RSS 66,662,400 bytes。推論サーバーRAM・VRAMの実測ではない。VRAMはnull |
| 終了 | 専用インスタンスのみアンロード |

短期の互換・構造化確認であり、速度の実用合格やPhase 0の3モデル比較達成ではない。Muse APIの製品推論検証は実施していない。
集約した実測は[Hub検証JSON](evidence/hub-2026-09-06.json)。原本や完全な生成プロンプトはこのリポジトリに再配布しない。

## 再実行

```powershell
.venv/Scripts/python.exe -m pytest -q
pnpm --filter web test
pnpm typecheck
pnpm --filter @kyalulu/schemas build
pnpm --filter web build
```

画面試験用APIを専用データで起動する。

```powershell
$env:KYALULU_DATA_DIR="$PWD/.artifacts/hub-data"
$env:KYALULU_EXPERIMENTS_DIR="$PWD/.artifacts/hub-experiments"
$env:KYALULU_TRUSTED_ORIGINS='http://127.0.0.1:5190'
.venv/Scripts/python.exe -m uvicorn python.api.main:app --app-dir runtime --host 127.0.0.1 --port 8016
```

別ターミナルでWebを起動し、さらに別ターミナルで試験する。

```powershell
$env:KYALULU_API_URL='http://127.0.0.1:8016'
pnpm --filter web dev --host 127.0.0.1 --port 5190 --strictPort
# 別ターミナル
.venv/Scripts/python.exe tests/e2e_hubs.py --base http://127.0.0.1:5190
.venv/Scripts/python.exe tests/e2e_compatibility.py --base http://127.0.0.1:5190
# Phase 0画面は公式3シナリオを専用APIでMock各1 run作成してから実行
.venv/Scripts/python.exe tests/e2e_phase0.py --base http://127.0.0.1:5190
# LM Studioと指定Vulkanランタイムが利用できる場合のみ
.venv/Scripts/python.exe scripts/verify_hub_vulkan.py
```

Hub画面試験と実モデルスクリプトは公開ネットワークを利用する。外部制限・障害は模擬試験の合格で置き換えず、実接続の未確認として記録する。
自前Hub、投稿・認証連携、任意URL、Risu独自実行、Desktop配布は今回の対象外。次はPhase 0のGemma性能・長期受け入れを優先する。
