# 記録済みrevisionの共通メッセージ列とNative分岐

2026-10-25 JST。架空アカウント・隔離SQLite・in-process API・storage mockのみ。
本番会話の消去・公開反映・実モデル試験は行っていない。

## 実装と境界

- Cloudにrevisionごとの暗号化manifestを追加。受理済みpayloadのSHA-256と、
  メッセージUUID・role/content/model/revisionのハッシュ列を保存する。
  本文・記憶・作品設定を履歴表へ複製しない。
- 競合や明示分岐では、同じownerの指定revision・現在head・受信データに共通する
  メッセージの先頭列を計算する。clientが送った「検証済み」宣言は採用しない。
  記録されていない過去revision、UUID不足、他ownerや消去済みの祖先はunverified。
  証明は分岐成立時の`branch_revision: 1`に固定し、後続編集後の本文の同一性を主張しない。
- 数値IDの差を証明に混入させない。異なる継続の本文・記憶・作品設定はそれぞれの
  会話に保持し、共通列があることを理由に記憶を混合しない。
- 同期済みNative会話からの分岐は、共通のmessage/memory/summaryのcanonical IDと
  Library/Creator対応表、分岐元のentity/revision・切断message UUIDを継承する。
  最終同期後に追加したmessageのUUIDも親子で同時に確定する。
  native数値IDは別に採番し、同期対象への追加は利用者の選択を必要とする。
- Nativeのowner/origin namespaceを継承し、別アカウントによる分岐の取得を拒否する。
  Cloudで競合分岐した受領はBrowser/Nativeの保存・baselineへ反映し、同じ版を
  再送し続けないようにする。
- manifestの暗号化後サイズを既存容量へ加算。容量不足は受領と全変更をrollback。
  確認済みentity消去・Cloud会話消去の双方で該当manifestも削除する。

これはメッセージ列の証明であり、過去の記憶/設定の同一性証明や、祖先本文の復元用
アーカイブではない。新機能以前の失われたrevisionは捏造しない。
一度も同期登録していないNative会話からの分岐のcanonical ID移行、旧DB全面復元、
大容量分割、3方式の実UI/実モデル・物理端末検証は引き続き残る。

## 検証

- `tests/test_unified_lineage.py`：共通先頭列、古いrevision照合、偽の証明・他owner、
  旧UUID不足、再送、容量超過rollback、manifest暗号化と確認済み消去。
- `tests/test_unified_history_snapshots.py`：過去設定/記憶を使うNative/Cloud分岐と
  canonical UUID継承、分岐の暗黙upload禁止、別アカウントへの取得禁止。
- `tests/test_native_sync_client.py`：競合受領を保存した後の再起動・再送境界。
- `tests/test_unified_runtime_bridge.py`：Cloud会話消去が同じtransactionでmanifestも消す。
- `apps/web/src/lib/appSync.test.ts`：Cloudからの証明を競合受領に保存。

実行結果：

```powershell
.venv/Scripts/python.exe -m pytest tests/test_unified_lineage.py tests/test_unified_history_snapshots.py tests/test_native_sync_client.py tests/test_unified_runtime_bridge.py tests/test_conversation_parity.py tests/test_unified_app.py -q --tb=short --basetemp=.artifacts/canonical-lineage-final -o cache_dir=.artifacts/unified-pytest-cache --junitxml=.artifacts/canonical-lineage-final/results.xml
pnpm --filter web test -- src/lib/appSync.test.ts --pool threads --maxWorkers 1
pnpm typecheck
```

- Python関連 **105 passed**。その後の証明対象revision明示に対してlineage **4 passed**を再確認。
- Browser同期 **32 passed**、workspace型検査成功。
- 全Python実行は **1000 passed / 7 subtests passed / 1 failed**。失敗は既存の
  `test_concurrent_checkout_capacity_cannot_sell_same_disk_twice`で、workspace内の
  架空backupディレクトリを2スレッドで作る際のsandbox `WinError 5`だった。
  コードを変えず同じ試験をsandbox外のworkspace隔離ディレクトリで実行し **1 passed**。
  全体実行は最後の追加fixture 1件より前に収集されており、その追加を含むhistory
  **21 passed**も別に確認。全体が単一実行で成功したとは扱わない。
- 全体ログ：`.artifacts/unified-lineage-full/results.xml`。
  今回は実UI/実モデル・実機試験と署名済み配布を追加していない。
