# 暗号化された転送一時データの保持・清掃・再開

2026-10-25 JST。架空アカウント・会話、隔離SQLite、in-process Cloud APIのみ。
本番の保存領域へこの清掃処理を実行していない。

## 保持範囲

- 対象は`entity-transfers/<owner UUID>/<transfer UUID>.db`の暗号化一時データだけ。
  旧`transfers/`、会話本体、Native/Browserのoutbox、受領、request manifest、撤回fence、
  残高・台帳・原資には書き込まない。control DB全tableのdump不変も試験する。
- CloudのRuntimeLock取得・通常recover後、リクエスト受付前に1回実行する。
  同じCloud lifespanのworkerが60秒間隔で再実行し、終了時にそのworkerを停止・回収する。
  統合機能を無効にした場合も、既存の一時データの清掃は継続する。公開APIは新設しない。
- 正常な一時データは既存の1時間TTLを使用する。断片書込みは従来どおりTTLを更新する。
  期限切れ、永続受領で確定済みのupload、撤回fenceが確定したupload、取得元が欠落・
  削除・別revisionになったdownloadを破棄する。現在revisionのdownloadと有効uploadは保持する。
- SQLiteの書込みlockでmetadata確認と断片writerを直列化し、DBを閉じてからunlinkする。
  このworkerとCloud転送routeは同一event loopで同期処理を実行する。
- root/owner/fileの解決先とUUIDを確認し、symlinkや別の解決先を辿らない。
  復号・SQLite・metadataの不明/破損、権限やファイル使用中のエラーではデータを残す。
  他の正常な一時データの処理は続ける。ログは件数だけで、会話・owner・request・パスを出さない。

## 再開・復旧手順

1. 一時データの期限切れ/清掃後も、元端末のoutbox・request ID・本文・revisionを保持する。
   同じownerで通常の同期を再試行する。manifestのsize/SHA-256と一致する本文に対し、
   新しい転送を予約して先頭断片から送り直す。生成POSTは再送しない。
2. 既にcommitした要求は、残った一時DBを清掃した後も永続受領で照合できる。
   撤回済み要求はfenceで拒否される。一時DBの有無を確定/未確定の根拠にしない。
3. downloadで元revisionが変わった場合は同期一覧を取り直し、現revisionの新しい参照を取得する。
   部分受信データで会話やcursorを確定しない。
4. 復旧ではoperator DBの受領/manifest/fence/残高/台帳/予算とtenant/native DBを整合して扱う。
   一時DBは唯一の復旧元ではない。破損・復号不能の一時DBは自動消去せず、処理を止めた
   隔離環境で暗号鍵と元端末のoutboxを照合する。鍵や本文を公開ログへ貼らない。
5. 旧Native DBに分岐元記録がない場合は本文の類似で結び付けない。
   既存の数値IDを保持し、canonical identity移行と祖先復元は未完のまま追跡する。

## 検証

- `test_entity_transfer_cleanup.py` **15 passed**（下記75件の内数）。期限切れ、確定/撤回後の
  crash残骸、他owner、旧転送領域の保持、元revision変更/削除、破損/未知形式、非数値・NaN
  metadata、symlink、unlink失敗と再試行、起動前清掃、定期実行、所有taskだけの終了を検査。
- 実Nativeの多MB会話で断片受領を失い、Cloudの一時DBを期限切れ清掃した後、同じoutboxを
  保持した別NativeSyncインスタンスが先頭から再送して1回だけ確定。元会話の数値ID・本文は不変。
- guard/client/API/scopes/entity transfersとcleanupの関連実行は **60 passed**。
  その後追加したunlink失敗試験を含むCloud/統合/旧転送互換・消去回帰は **75 passed**。
  これらは重複を含む別の実行であり、合算した固有試験件数ではない。
- C側sandbox TEMPを使った試行はpytestの一時ディレクトリ作成で失敗した。
  `.artifacts/transfer-cleanup-cloud-final`へ戻して、同じ試験75件の成功を確認した。

```powershell
.venv/Scripts/python.exe -m pytest tests/test_entity_transfer_cleanup.py tests/test_unified_entity_transfers.py tests/test_native_outbox_guard.py tests/test_native_sync_client.py tests/test_native_sync_api.py tests/test_native_sync_scopes.py -q --tb=short --basetemp=.artifacts/transfer-cleanup-final -o cache_dir=.artifacts/unified-pytest-cache --junitxml=.artifacts/transfer-cleanup-final/results.xml
.venv/Scripts/python.exe -m pytest tests/test_entity_transfer_cleanup.py tests/test_cloud.py tests/test_unified_app.py tests/test_transfer_compatibility_parity.py tests/test_transfer_erasure_parity.py -q --tb=short --basetemp=.artifacts/transfer-cleanup-cloud-final -o cache_dir=.artifacts/unified-pytest-cache --junitxml=.artifacts/transfer-cleanup-cloud-final/results.xml
```

最初のコマンドの60件はunlink失敗試験追加前の実行。結果XMLは各basetempに保存する。
App/Desktopビルドと実Chromium5ケースは先行f3e7d88の検証で、今回のbackend追加後に
フロントを変更していないため再実行していない。先行CIの成功も今回のheadのCIと区別する。

単一JSONの分割保存・ストリーム投影、250MB/1GB実容量、旧snapshot全体復元、
大量のstage走査によるevent loop待ち時間、実機・本番配信の合格証拠は引き続き必要。
破損・未知形式の手動復旧/保持期間は運用で決める必要があり、自動で推測して消さない。
