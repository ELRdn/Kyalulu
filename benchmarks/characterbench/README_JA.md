# Kyalulu CharacterBench v0.1 — 起動ガイド

このMITライセンスの評価パイロットはKyaluluリポジトリ内の独立したベンチマークです。以下のコマンドはこのディレクトリで実行します。生成結果の `runs/` はGitに含めません。`benchmarks/official/` のKyalulu本体ベンチとは別の評価系です。

**解凍 → デモ確認 → ローカルLLMに接続 → 生成・採点・比較**までを実行する、日本語キャラクターAI用のベンチマークです。

この版は「動く評価ツール＋公開・合成パイロット問題集」です。[Gemma 4のno thinking実機パイロット](docs/GEMMA4_NO_THINKING_PILOT_2026-09-27.md)には探索的な集計を載せていますが、実応答の生データは同梱せず、人間により妥当性を検証した公式ランキングでもありません。

## 1. 最初に用意するもの

- **Python 3.10以上**。実行時の依存関係は標準ライブラリのみ。`pip install` は不要です。
- このリポジトリの `benchmarks/characterbench` ディレクトリを作業場所にしてください。
- 実モデルを測る場合のみ、モデルをロードしたOpenAI互換チャットサーバー。モデル本体は含まれません。

このリポジトリ版にはZIP配布版のHTMLランチャーは含まれません。Windows 11 / Python 3.14.6で単体テストとLM Studio実機接続を確認済みです。Ubuntu/WindowsのPython 3.11 CI設定も追加しています。ホストCIの結果は別途確認してください。検証範囲は `docs/ACCEPTANCE_TESTS.md` を確認してください。

### まず画面を見たい

以下の `demo` コマンドでMOCK固定応答のレポートを生成できます。実モデル性能の測定ではありません。

### 実行の流れを確認したい

生成・機械採点・MOCK採点者・A/B比較・人間評価画面まで新しいフォルダーへ生成します。

ターミナル派は、解凍したルートフォルダーで次を実行します。

```powershell
py -3 -m kcb demo --out runs/my-demo --open
```

`py` がない環境では `python`、Linux/macOSでは `python3` に置き換えてください。既存のデモ結果は上書きしません。再実行時は別の出力フォルダー名を指定します。

## 2. 実モデルを最初に測る

### LM Studio

LM Studioでチャットモデルをロードし、ローカルサーバーを起動します。公式に `/v1/models` と `/v1/chat/completions` が用意されています。既定例の接続先は `http://127.0.0.1:1234/v1` です。[S17]

ルートで次を実行します。

```powershell
py -3 -m kcb doctor --config configs/lmstudio.json
py -3 -m kcb run --config configs/lmstudio.json --suite smoke --out runs/first-smoke
```

完了後、`runs/first-smoke/report.html` を開きます。`smoke` は **22応答**です。最初から全モデルを長時間回す前に、接続・日本語出力・JSON形式・トークン上限を確認してください。

`model: auto` は候補が1個のときだけ自動選択します。複数表示された場合、`doctor` の `model_ids` に出た**正確なID**を `--model` に指定します。UIでの表示名やHugging Face名とは異なる場合があります。

```powershell
py -3 -m kcb run --config configs/lmstudio.json --model "ここをサーバーが返した実際のモデルIDに置き換える" --label "candidate-A" --suite smoke --out runs/a-smoke
```

対話式の `py -3 -m kcb launch` なら番号でモデルを選べます。複数のCLI実行を同じ出力フォルダーへ同時に書き込まないでください。

### その他の接続先

| 構成 | プリセット | 既定のbase_url |
|---|---|---|
| LM Studio | `configs/lmstudio.json` | `http://127.0.0.1:1234/v1` |
| Ollama互換API | `configs/ollama.json` | `http://127.0.0.1:11434/v1` |
| llama.cpp server | `configs/llamacpp.json` | `http://127.0.0.1:8080/v1` |
| 自分で開設したSSHトンネル | `configs/runpod_tunnel.json` | `http://127.0.0.1:18000/v1` |
| 参考Systemアダプター | `configs/system-bridge.json` | `http://127.0.0.1:8766/kcb/v1` |

OllamaはOpenAI APIの一部との互換性を提供します。任意の追加パラメーターまで同じとは限りません。[S18] llama.cpp側でもサーバーの版・チャットテンプレート・ロード済みモデルを確認してください。[S19] **このツールはサーバーを自動ダウンロード／起動／モデルロードしません。**

本ツールのSSE/HTTP互換処理はローカルのプロトコルシミュレーターで試験済みです。これら各製品の実機や、全モデル・全バージョンでの接続成功を保証するものではありません。

## 3. 全件・反復・料金

```powershell
py -3 -m kcb plan --suite all --repeats 3
py -3 -m kcb run --config configs/lmstudio.json --suite all --repeats 3 --out runs/candidate-a
```

| 設定 | 候補モデルの採点対象応答 | 自由文の採点単位 |
|---|---:|---:|
| smoke・1反復 | 22 | 7 |
| all・1反復 | 264 | 84 |
| all・3反復 | 792 | 252 |

採点単位は、通常の単発応答なら1個、12ターンの対話なら**対話全体で1個**です。全件1反復で状態診断48問、自由文単発72問、対話144応答を生成します。別LLMでのrubric採点は最大84呼び出し、2モデル間の順序反転A/Bは最大168呼び出し／採点者／反復です。ウォームアップ、接続probe、明示的な再試行は別に呼び出しを消費します。

`plan` はネットワークを呼びません。実サーバーの速度・token数が不明なため、所要時間や費用を勝手に推定しません。

既定は `temperature=0.7`, `top_p=0.95`, `max_tokens=768`, `workers=1`, `stream=true`。サーバーへのseed送信は互換性を考慮し既定OFFです。実行順のseedは別に記録します。

### Thinking / MTP / 量子化を比べるとき

手元のLM Studioで確認したGemma 4 26B用のno thinking設定は `configs/lmstudio-think-off.json` です。`extra_body.reasoning_effort=none` を送信し、`require_no_reasoning=true` で別フィールドの思考出力・報告された思考token・可視の `<think>` タグを検知した応答を採点対象から外します。サーバーが設定を無視しても、観測可能な思考出力は合格扱いにしません。思考出力が0でもモデル内部の処理を完全に証明するものではありません。モデル名にMTPが含まれても、MTP推論が有効とは限らず、ロード設定を別途記録してください。

```powershell
py -3 -m kcb doctor --config configs/lmstudio-think-off.json --probe
py -3 -m kcb run --config configs/lmstudio-think-off.json --suite smoke --out runs/gemma4-off-smoke
py -3 -m kcb run --config configs/lmstudio-think-off.json --suite all --out runs/gemma4-off-all
```

`finish_reason=length` 等で切れた本文は監査用に保存しますが、採点せず、対話の後続へも渡しません。設定を変えた場合は新しい出力先を使い、以前の結果と条件を混ぜないでください。

採点チェッカーの修正後、保存済みの応答を新しい規則で採点し直す場合だけ `py -3 -m kcb regrade --run runs/対象ラン` を明示的に実行します。モデルへの再送信はなく、旧評価と新評価の差は `regrade_history.jsonl` に残ります。manifestとレポートには生成版・採点版を分けて記録します。同じ採点版を二重適用しません。

`think med` のような設定は全サーバーで共通ではありません。ベンチは有効化・無効化を推測しません。サーバーの公式仕様を確認して設定し、`model_metadata` にモデル重みのSHA、量子化、バックエンドの版、thinking、MTP等を記録します。追加の対応パラメーターは `extra_body` に書けますが、制御済みの `messages`、`max_tokens` 等は上書き不可です。

思考出力が本文に漏れる、JSONが途中で切れる、`finish_reason=length` が多い場合は、接続・テンプレート・推論設定を見直して**別条件の新規run**にしてください。通常応答に混じった `<think>` を採点時に黙って削ることはしません。サーバーが返す別フィールドのreasoning本文は保存せず、文字数のみ記録します。

サーバーが `usage` を返さなければtoken数や料金は未測定です。`stream_usage: true` はサーバーが `stream_options.include_usage` に対応する場合だけ設定してください。対応しないパラメーターをエラー後に黙って外して成功扱いにする処理はありません。

## 4. 中断しても再開する

```powershell
py -3 -m kcb run --config configs/lmstudio.json --suite all --repeats 3 --out runs/candidate-a --resume
```

各応答をSQLiteへ保存します。再開にはモデルID・設定・データ・スイート・反復数・seed・workers・warmupを**前回と同じ値**で指定します。既存成功応答は再生成しません。Ctrl+Cで中断した実行も再開できます。並列処理中の中断は送信済みHTTP呼び出しが終了するまで待つ場合があります。

通信失敗が起きた対話では、その後のターンを `skipped_dependency` にします。架空の応答で穴埋めして会話を続けません。サーバー復旧後に失敗した箇所から再試行する場合のみ次を使います。

```powershell
py -3 -m kcb run --config configs/lmstudio.json --suite all --repeats 3 --out runs/candidate-a --resume --retry-errors
```

サーバーが並列実行で不安定だった場合は、元の `--workers` を変えずに `--retry-workers 1` を追加できます。再試行時だけ直列化し、その違いをmanifestに記録します。速度統計は並列数が混在するため、純粋な同時実行性能の比較には使わないでください。

これは「正解するまで生成して最良だけ採用」する機能ではありません。再試行前の失敗行・依存スキップ行はローカルの `retry_attempts.jsonl` に退避し、成功した既存応答は引き直しません。失敗した呼び出しの課金や部分生成は再試行前後で発生し得ます。予定内の全レコードが保存済みでも、`complete_with_errors` と品質・成功率は別に読みます。`run` の終了コードは、正常完了0、保存済みエラーを含む完了3、設定等の例外2、中断130です。

## 5. キャラらしさを別LLMで採点する

**`run` だけで出る状態診断の正答率は、キャラの魅力スコアではありません。** 自由文の意味評価は、別モデルまたは人間が必要です。

`configs/judge-local.json` をコピーし、採点用モデルIDと接続先を設定してください。候補生成が終わってから、同じGPUのモデルを採点用に入れ替えても構いません。採点時は候補を再生成しません。

```powershell
py -3 -m kcb judge --run runs/candidate-a --config configs/judge-local.json --limit 5
py -3 -m kcb judge --run runs/candidate-a --config configs/judge-local.json --resume
```

`--limit 5` は5個の採点単位だけを試します。続きは `--resume` で未処理分を採点します。**採点エラーとして保存済みのものも自動再試行しません。** 設定を修正して新しいjudge条件にするか、エラーを未評価として残してください。

独立した採点用モデルを二つ使う例：

```powershell
py -3 -m kcb judge --run runs/candidate-a --config configs/judge-a.json --config configs/judge-b.json
```

二人目用の設定ファイルは自分の環境で作成してください。同じモデルの設定ファイル名を変えただけでは独立した採点者にはなりません。自己採点は記録されますが、優先的に採用する根拠にはしません。

rubricは1〜5点・判断材料がなければnullです。応答中の根拠引用が実在することを検証しますが、**引用の実在＝採点の正しさではありません**。未校正であること、評価対象数・未評価数・採点エラーをレポートに表示します。

## 6. モデルAとBを比べる

Bも同じデータ・スイート・反復数で生成します。各runは独立した出力フォルダーへ保存してください。

```powershell
py -3 -m kcb compare --a runs/candidate-a --b runs/candidate-b --out runs/comparison-ab
py -3 -m kcb pairwise --a runs/candidate-a --b runs/candidate-b --config configs/judge-local.json --out runs/pairwise-ab
```

`compare` は状態診断の対応差と探索的95%区間を計算し、自由文のA/Bは `pairwise` が担当します。A/BとB/Aを両方採点し、結果が順序で変わる例を `order_sensitive` として残します。引き分けに偽装しません。

CoreとSystem、データハッシュ違い、プロトコル違いを混ぜません。未完了・異なる部分集合の比較は既定で拒否し、`--allow-partial` を明示した場合だけ共通部分を比較します。失敗の多いモデルの少数成功例だけを見て有利に解釈しないでください。

## 7. モデル名を伏せて人間に評価してもらう

```powershell
py -3 -m kcb human-export --a runs/candidate-a --b runs/candidate-b --out runs/human-ab
```

配布するのは **`runs/human-ab/blind-arena.html` だけ**です。HTML単体で開けます。モデル対応表の `PRIVATE_KEY_DO_NOT_SHARE_WITH_RATERS.json` は採点者に渡しません。応答本文がモデル名を自称している場合は完全なブラインドではなくなるので確認が必要です。

採点者は匿名IDを入力し、A／B／差がない／どちらも不十分／スキップを選び、最後に「採点JSONを保存」を押します。メール・本名・APIキーは不要です。外部通信はありません。採点はブラウザ内に保存されますが、ブラウザ設定によって保存されないこともあるため、JSONの保存を優先してください。

```powershell
py -3 -m kcb human-import --key runs/human-ab/PRIVATE_KEY_DO_NOT_SHARE_WITH_RATERS.json --votes votes/reviewer01.json votes/reviewer02.json --out runs/human-results
py -3 -m kcb calibrate --pairwise runs/pairwise-ab --human runs/human-results --out runs/judge-agreement
```

対応するrunスナップショットが違うと校正比較を拒否します。同一人・同一課題の重複は除去し、矛盾する票は明示的な解決を要求します。少人数の一致率を、一般ユーザー全体の好みと断定しないでください。

## 8. 保存物

| 保存物 | 内容 |
|---|---|
| `manifest.json` | 全設定、データ／プロトコルhash、環境、再試行履歴 |
| `dataset/` | 使用したデータの固定スナップショット |
| `run.sqlite3` | 応答ごとの再開用データベース |
| `responses.jsonl` | 実際の入力・応答・エラー・計測値 |
| `summary.json` | 欠測をnullのまま保存した集計 |
| `scores.csv` | UTF-8 BOM、表計算向けの応答別記録 |
| `report.html` | オフラインで開ける検索付きレポート |
| `judgements/` | 採点者設定・根拠・判断不能・エラー |

応答や会話履歴を公開する前に確認してください。独自データに個人情報が含まれていれば、その内容も保存されます。生の入力はベンチ再現用であり、自動匿名化は実装していません。

## 9. セキュリティとネットワーク

既定はlocalhost／loopbackだけです。LANも含む外部ホストは `--allow-remote` を付けたときだけ接続します。モデル名列挙でもこの制約を守ります。

APIキーはJSONへ書かず環境変数にします。

```powershell
$env:KCB_API_KEY = "自分のキー"
```

設定の `api_key_env` を変更すれば採点者と候補で別のキーを使えます。環境変数の値は結果へ保存しません。HTTPエラー本文の保存、リダイレクトへのAuthorization転送もしません。ただし保存する `extra_body` や自由記述metadataに秘密を埋め込まないことは利用者側でも守ってください。

本ツールは任意生成コードを実行しません。データ検証用にPython式を渡す機能もありません。

## 10. よくある問題

| 症状 | 確認箇所 |
|---|---|
| 接続できない | サーバー起動、port、base_url末尾の `/v1`、モデルロード |
| モデルが複数ある | `models` の正確なIDを `--model` またはconfigへ指定 |
| HTTP 400/404 | チャット互換endpoint、テンプレート、対応パラメーター。フォールバックは自動ではしない |
| JSON診断がほぼ0 | 応答全文・思考タグ・コードフェンス・余計な前置き・途中切れを確認 |
| `usage` やTTFTが未測定 | APIが返していない／非ストリーミング。0点や0円ではない |
| 出力フォルダーが使用済み | 新しい名前を使う、または同条件で `--resume` |
| 採点に失敗する | 採点モデルのJSON生成能力、max_tokens、根拠の完全一致、指定dimensionの欠落 |
| ベンチは動くのに人格点がない | 仕様どおり。別LLM採点または人間評価がまだ必要 |

## 11. 同梱ドキュメントと検証

`docs/RESEARCH_AND_DESIGN_JA.md` は一次資料の比較と採用理由、`docs/METHODOLOGY_JA.md` は計算方法、`docs/DATASET_CARD.md` は問題集の性質、`docs/IMPLEMENTATION_PLAN.md` は実装済み／今後の区別です。

```powershell
py -3 -m kcb selftest
py -3 tools/verify_release.py
```

後者はリリース時点のファイルhashを確認します。データや設定を自分で変更した後に不一致になるのは正常です。

### 接続資料

[S17] https://lmstudio.ai/docs/developer/openai-compat

[S18] https://docs.ollama.com/api/openai-compatibility

[S19] https://github.com/ggml-org/llama.cpp/tree/master/tools/server

参照確認日: 2026-09-27。対応先の現在の設定は公式資料で確認してください。
