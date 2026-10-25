# 分割転送中のoutbox確認と旧保存領域の互換性

2026-10-25 JST。架空アカウント・会話、隔離SQLite、新規Chromium contextのみ。
本番会話、既存ブラウザ領域、外部API、実モデルは使用していない。

## 変更

- Nativeの断片送信・status確認はoutboxのJSON本文を読まず、SQLiteのcovering
  expression indexと会話source表を参照する。同意・namespace・request ID・撤回・
  選択会話・削除記録・source件数を確認する。旧metadata表への書込みもSQL triggerで
  自動追従する。初回transactionで旧データをbackfillし、本文を変更しない。
- Browserは`kyalulu-app-v1`をschema 2に更新する。既存entities/metaは保持し、
  metaに`[request_id, withdrawn]`の索引を追加する。有効outboxの`withdrawn:0`は
  falseとして扱え、IndexedDBのkeyにもなる。撤回済み`true`は索引から外れる。
  各断片の前にはkey cursorと同意だけを読み、他ownerの本文は取得しない。
- 旧boolean/missing flagの有効outboxは一度だけ読み、本文・request IDを保持して
  `withdrawn:0`へ正規化する。撤回済みoutboxは再有効化しない。旧writerによる
  撤回・request差替えも次の断片で検出する。

## 検証

- Python関連 **46 passed**：Native guard/client/API/scopes/entity transfers。
  `test_native_outbox_guard.py`は多MBのfixtureで本文read・restageを禁止し、実SQLiteの
  EXPLAINでも本文Column読込とJSON関数の再実行がないことを確認する。backfill、
  旧SQL writer、purge、選択変更、request差替え、不完全sourceも検査する。
- フロント全体 **459 passed / 41 files**、workspace型検査成功。
- 実Chromium **5 passed**：legacy/freshは3断片を確定、withdrawal/replacement/accountは
  1断片で停止して未送信データを保持。各断片中の本文read件数増加なし、他owner本文read 0。
  本物のIndexedDB v1→v2を使用する。API応答はJavaScript fixtureで代替し、Python側で
  実API・外部通信を遮断する。遮断対象の通信試行も全ケース0。
- 統合App・Desktopビルド成功。既存WASM externalization/chunk-size等の警告あり。
- `runtime-web.yml`に実Chromium試験を追加。先行9f4699bのWindows/Linux CI成功は
  確認済みだが、この変更のCI結果とは区別する。

```powershell
.venv/Scripts/python.exe -m pytest tests/test_native_outbox_guard.py tests/test_native_sync_client.py tests/test_native_sync_api.py tests/test_native_sync_scopes.py tests/test_unified_entity_transfers.py -q --tb=short --basetemp=.artifacts/outbox-guard-native-final -o cache_dir=.artifacts/unified-pytest-cache --junitxml=.artifacts/outbox-guard-native-final/results.xml
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\hiron\AppData\Local\ms-playwright'
.venv/Scripts/python.exe tests/e2e_outbox_guard.py
pnpm --filter web test -- --pool threads --maxWorkers 1
pnpm typecheck
pnpm --filter web build:app
pnpm --filter desktop build
```

証拠：`.artifacts/outbox-guard-native-final/results.xml`、
`.artifacts/outbox-guard-browser/results.json`と`vite.log`。
途中でDドライブ空き容量不足を既存checkが検出した。checkは弱めず、このタスクが生成した
旧pytest fixtureだけを整理して再実行し、上記46件が成功した。

## 復旧と限界

schema 2を使用した後、`indexedDB.open(DB,1)`固定の旧clientへそのまま戻すと
VersionErrorになる。backendを戻す場合もschema 2対応clientを維持する。旧clientへの
復旧は別途互換clientまたは検証済みexport/importが必要で、DB削除で戻してはいけない。
Nativeは元metadataの3列を維持し、追加表・索引・triggerを残したまま旧writerを利用できる。

今回除去したのは断片ごとの全体再読込。stage・commit・受信では単一JSONを実体化するため、
250MB/1GB単一会話の運用合格には分割保存・ストリーム投影と実容量試験が引き続き必要。
Android/iPhone、ブラウザ全体の再起動、本番データ移行の証拠ではない。
