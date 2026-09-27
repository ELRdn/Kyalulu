# System adapter契約

**同梱bridgeはKyalulu本体ではない。** 状態隔離とresetの契約を動作確認する、full-history転送の参考実装である。RAG、メモリ要約、外部ツール、Kyalulu既存コードは組み込んでいない。

## 参考bridgeを起動する

既にモデルをロードしたサーバーに対し、ターミナル1で次を実行する。

```console
python tools/system_bridge.py --backend-config configs/lmstudio.json
```

ターミナル2で接続を確認してからrunする。

```console
python -m kcb doctor --config configs/system-bridge.json --probe
python -m kcb run --config configs/system-bridge.json --suite smoke --out runs/reference-system
```

bridgeは `127.0.0.1:8766` のみで待ち受ける。backendの外部URLを使う場合はbridge自身にも `--allow-remote` が必要。認証付き本番サービスとして公開するための実装ではない。

## GET /kcb/v1/models

```json
{"data":[{"id":"実際のbackendモデルID"}]}
```

## POST /kcb/v1/step

```json
{
  "protocol":"kcb-system-step-0.1",
  "session_id":"runID:unitID:r0",
  "reset":true,
  "turn_index":1,
  "character":{"name":"澄野ミラ","role":"星灯図書室の司書"},
  "messages":[
    {"role":"system","content":"固定プロトコルと公開キャラカード"},
    {"role":"user","content":"こんにちは。"}
  ],
  "generation":{"model":"model-ID","temperature":0.7,"top_p":0.95,"max_tokens":768,"extra_body":{}}
}
```

実際の `character` にはallowlistにある公開属性が入る。goldやevalは入れない。unit/反復ごとに新しいsession ID、初回はreset=true、以後はfalse。warmupやprobeにも採点外の別session IDを使う。

### 応答

```json
{
  "session_id":"runID:unitID:r0",
  "reset_ack":true,
  "text":"こんにちは。今日は何を探しているの？",
  "usage":null,
  "finish_reason":"stop",
  "model":"実際のbackendモデルID",
  "runtime_id":"reference-full-history-bridge-v0.1",
  "replayed_response":false,
  "mock":false
}
```

一致するsession IDと、初回のreset_ack=trueが必須。usageはなければnull。APIは完了したJSON応答なので、KCBのTTFTは未測定。キャッシュの同一応答を再配信した場合はreplayed_response=trueとし、生成速度に数えない。

## 再開と副作用

参考bridgeはSQLiteへ最後のturn・リクエストhash・応答を保存する。同じsession/turn/hashなら同一応答を返す。未登録sessionの2ターン目や順序不整合を黙って修復しない。KCBのrun.sqlite3だけ残ってもbridgeのsession DBが消えた場合は、system会話の途中再開ができないことがある。新規runで開始するか、独自アダプター側に検証可能な復元を実装する。

HTTPタイムアウト後にbackend処理が実行済みかどうかは分散システム固有の不確実性がある。実サービスのadapterではidempotencyと同時処理、sessionごとの状態隔離を明示する。本参考bridgeは更新を単純に直列化し、本番throughput試験用ではない。

KCBのconfigに宣言したruntime_idが評価条件として保存される。adapter返却runtime_idとのバージョン整合は運用者が確認する。ベンチは外部メモリの実装内容や復元の正しさを自動証明しない。
