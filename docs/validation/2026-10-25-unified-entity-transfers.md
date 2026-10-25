# 統合会話の分割転送 — 2MBを超えるfixture

2026-10-25 JST。架空アカウント、隔離SQLite、Mock/ASGI transportのみ。
本番会話・決済・外部AI・実モデルは使用していない。

## データ契約と互換性

- 通常の`POST /api/cloud/app/sync`と既存DB/APIを維持する。
  大きなoutboxは`POST /api/cloud/app/sync/transfers`へrequest ID、UTF-8バイト数、
  全体SHA-256を登録し、1MiBごとのbase64断片と断片SHA-256を送る。
  既存`Transfers`の暗号化ページ・順序・再送照合・期限・ディスク確認を再利用する。
- 一時データは`entity-transfers/<owner>/`に分離する。旧バックアップ用のトークン・
  転送取消APIから新しい一時データを読んだり破棄したりできない。
- 最後までサイズ/全体SHA-256が一致した後に、既存の`UnifiedService.push`へ渡す。
  型、資格情報、成人データ、owner、revision、消去fence、容量、全体rollbackを維持する。
  公開APIの`verified_transfer`自己申告で2MB制限を迂回することはできない。
- request IDを転送予約と通常POSTの両方で照合する。予約済みのIDを別内容の通常POSTが
  先取りして、違う会話に対する受領として扱われることを防ぐ。
  更新前の通常POSTで確定済みの場合は、元のPOST経路で内容の同一性を再検証する。
  逆方向に、新クライアントで確定した同じ内容の受領を旧形式で取り直すこともできる。
- `GET /api/cloud/app/sync?paged=1`と`GET /api/cloud/app/entities/<id>?paged=1`は
  大きい会話を、owner・entity ID・revision・サイズ・SHA-256付きの参照として返す。
  応答全体のinline予算も制限し、小さな会話を多数まとめた場合の巨大応答を防ぐ。
  断片取得時に現在revisionと消去状態を再確認する。旧クライアントはpaged指定をせず
  既存形式を利用する。
- 同じ会話headは1ページ内で一度だけ返し、cursorは全変更eventを通過させる。
  Browser/Nativeに同じ版の本文が残っている場合は断片を再取得せず、追い出された
  キャッシュや新しい版は必ず取得する。

## 再開・撤回・競合

- Browser/Nativeの永続outboxに同じrequest IDと本文を保持する。断片の受領通知が
  失われても、サーバーに記録された次の断片から再開する。
  commit後に受領通知が失われた場合は、確定済みの受領を返す。
- owner・同意・生成状態・outbox撤回を断片ごとに確認する。撤回後に残りの本文や
  commitを送らない。取消fence確定後に、そのuploadの暗号化一時ファイルを破棄する。
- 複数端末のuploadを並行して保持できる。原資は既存プラン容量に結び付けた
  一時予約枠で制限し、逆順のcommitは既存の競合分岐へ接続する。
- プラン縮小後は新規書込みを制限するが、既に確定した受領の取得や、保存済み会話の
  downloadは停止しない。既存の本文と残高をリセットしない。
- downloadの全断片を検証してから既存の受信transactionへ渡す。
  不一致・途中失敗時はcursorと会話を確定しない。

## 証拠

- `test_unified_entity_transfers.py`：2MB超の28発言fixture、再開、二重送信、破損、
  偽の迂回、秘密の混入拒否、暗号化、一時枠、アカウント分離、トークン失効、
  旧同期との隔離、消去/更新fence、並行uploadの逆順commit、Nativeから別PCへの受信。
- `appTransfers.test.ts`：UTF-8の断片境界、サイズ/各SHA/全体SHA、古い受領との互換性、
  撤回後の停止。`appSync.test.ts`：失った受領からの永続outbox再開と同意撤回。
- Plus 250MB/Pro 1GBは、宣言サイズの許容境界と一時予約枠だけを検査。
  その容量の本文を実際に割り当て・転送・復元した証拠ではない。

検証コマンド：

```powershell
.venv/Scripts/python.exe -m pytest tests/test_unified_entity_transfers.py tests/test_native_sync_client.py tests/test_native_sync_scopes.py tests/test_native_sync_api.py tests/test_unified_app.py tests/test_unified_runtime_bridge.py tests/test_unified_history_snapshots.py tests/test_unified_lineage.py tests/test_cloud.py tests/test_cloud_parity.py tests/test_cloud_download_conflict.py tests/test_transfer_compatibility_parity.py tests/test_transfer_erasure_parity.py -q --tb=short --basetemp=.artifacts/entity-transfer-commit -o cache_dir=.artifacts/unified-pytest-cache --junitxml=.artifacts/entity-transfer-commit/results.xml
pnpm --filter web test -- --pool threads --maxWorkers 1
pnpm typecheck
pnpm --filter web build:app
pnpm --filter desktop build
```

フロント **453 passed / 41 files**、Python関連 **179 passed**、workspace型検査、
統合App・Desktopビルドが成功。Python結果は
`.artifacts/entity-transfer-commit/results.xml`に保存した。
旧バージョンc6ce1a9のWindows/Linux CIも成功を確認したが、今回の変更のCIとは区別する。

## 残る必須作業

現在のentity契約は本文を単一JSONとして保持するため、commit・受信・IndexedDB更新で
全体の実体化とコピーが必要になる。断片ごとのoutbox確認の全体読込は
[後続の索引化](2026-10-25-unified-outbox-guards.md)で除去した。
**250MB/1GB単一会話の運用合格には、ストリームでの投影と分割保存、メモリ上限、
アカウント全容量・旧snapshot復元を含む実容量試験が必要。**
一時downloadはrevision/消去fenceで直ちにアクセスを止め、既存の1時間期限と
次の転送開始時の清掃に従う。常駐清掃・復旧・暗号化一時データの保持方針も
本番反映前に確認する。実ブラウザ/実機の再起動・回線切替の証拠はまだ追加していない。
