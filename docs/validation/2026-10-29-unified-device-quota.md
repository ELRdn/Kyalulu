# 統合App: 実ChromiumのIndexedDB quota拒否・原子性・再開

2026-10-29、既存Chromium **151.0.7922.34** で **4/4ケース成功**。
`context.new_cdp_session(page)` → `Storage.overrideQuotaForOrigin` による
**128 KiB（131,072 bytes）** のorigin上限で、実IndexedDB transactionの
`abort` / **`QuotaExceededError`** を取得した。prototype変更、例外注入、
duplicate-keyによる代用は一切行っていない。

## 実行

リポジトリルートで、既存Python / Playwright / Chromiumを使う。
この環境ではsandboxの分離LocalAppDataにChromiumがないため、
ホストの既存Chromiumを使う実行環境で次を実行した。新規installは不要。

```powershell
python tests/e2e_device_quota.py
```

既存 `tests/browser_fixture_server.py::local_vite` を再利用し、空きportの
loopback originを起動する。各ケースは新しい非永続browser contextで分離。
実際の `appStore.ts` の `appTransaction` / `saveEntity` / `entity` /
`allEntities` と、`appContext.ts` のowner切替をそのまま使用する。

自動生成する証跡:

- `.artifacts/device-quota-browser/results.json`: Chrome version、quota設定前後と
  解除後のCDP応答、native error、保存失敗、rollback、再開、再読込、終了状態。
- `.artifacts/device-quota-browser/vite.log`: 専用Viteの起動ログ。

## 4ケースの結果

| owner | 操作 | quota中 | 解除後・再読込後 |
| --- | --- | --- | --- |
| `quota-owner-a` | 新規conversation | 保存拒否・全件保持 | revision 1で保存 |
| `quota-owner-a` | 同一conversation更新 | 保存拒否・revision 3保持 | revision 4で保存 |
| `quota-owner-b` | 新規conversation | 保存拒否・全件保持 | revision 1で保存 |
| `quota-owner-b` | 同一conversation更新 | 保存拒否・revision 3保持 | revision 4で保存 |

全ケースで架空owner 2つをseedする。同じconversation IDを使うが原本の本文は
ownerごとに異なる。どちらも未同期 `dirty=true`、`revision=3`、
`serverRevision=1` とし、owner別の永続outbox、outbox内receipt、既存import
receipt、consentを保持する。seed後のCDP使用量は **8,396 bytes** だった。

試験の順序と判定:

1. **最初のIndexedDB openより前**に128 KiBを設定し、CDP応答の
   `overrideActive=true` と `quota=131072` を確認してから既存データをseed。
2. 決定的な低圧縮率の **1 MiB（1,048,576 bytes）のASCII本文**を使い、
   実 `appTransaction` でmeta markerとconversationを書き込む診断probeを実施。
   native `abort` イベントの `transaction.error.name=QuotaExceededError` を記録。
   entities/meta全件がseed時とJSON等価で、markerも残らないことを確認。
3. 同じ上限で製品の **`saveEntity`** を呼ぶ。実際の戻り値は
   `Device save failed / 端末への保存に失敗しました` という汎用エラー。
   保存候補と新規receiptを同じtransactionに渡し、拒否後のentities/meta全件を
   seed時と比較する。本文、revision、serverRevision、dirty、outboxes、
   既存receiptsが変わらず、新規conversation / receiptが残らないことを確認。
4. ページ再読込後も同じ比較を行い、owner切替後の既定owner list / lookupが
   それぞれ自分の原本だけを返すことを確認。
5. `quotaSize` を省略してoverrideを解除し、`overrideActive=false` を確認。
   同じ決定的本文・ID・expectedRevision・receiptで `saveEntity` を再実行。
   新規はrevision 1、更新は3→4だけ進み、本文とreceiptが原子的に保存される。
   既存outboxes / receipts / 他owner原本は変わらず、再読込後も確認できる。

native errorの取得は製品helperと同じDB/storeを使う**診断probe**による。
`saveEntity` 自体の例外からDOMException名を読み取ったという主張ではない。
同一quota下の製品保存拒否と全件rollback、解除後の成功を別途必須判定する。

## 設定順の制約と失敗時の扱い

初回探索では、seed後にquotaを下げたところ、CDPのquota値は131072に変わったが、
1 MiBのprobeが成功した。既存のwrite budgetが影響する可能性があるため、
最終E2Eは **空のcontextで初回DB open前に制限する**。この条件では4ケースとも
native quota拒否を再現した。既存DBへ後から上限を下げる方式の受入れは未達。

DOMException名が取れない、overrideが効かない、保存が成功する等の場合は
assertで非ゼロ終了し、取得済み結果をJSONに残す。擬似quotaへのfallbackや
成功扱いはしない。probeではnative terminalイベントの完了まで待ってから
判定するため、helperのPromise rejectionとイベントlistenerの順序に依存しない。

## 分離・終了と未達

HTTP(S)はfixture originだけ許可し、Viteがproxyする `/api` を遮断。
外部通信は遮断、全WebSocketを接続前にclose、Service Workerはblockする。
外部/API/provider要求とpage errorは全ケース **0件**。
実ユーザーデータ、provider、Cloud API、モデルは使用しない。

巨大なfill loopはなく、各ケースの本文は1 MiBに固定。実運用ディスクを
埋めない。成功・失敗ともfinallyでquota解除、CDP detach、専用context close、
browser closeを行い、既存helperが専用Viteを終了・waitする。suiteは120秒で
timeout。最終証跡は全context終了、browser切断、Vite終了を記録する。

手動の直接変更は以下の新規3ファイルだけ。製品変更、新規依存、Git操作はなし。

- `tests/e2e_device_quota.py`
- `tests/fixtures/device-quota.html`
- `docs/validation/2026-10-29-unified-device-quota.md`

未検証: 実ディスク枯渇、Android / iPhone、ブラウザプロセスやOS再起動、
UIの容量不足案内、250 MB / 1 GB会話、製品のimport / sync送受信全経路。
ページ再読込と実Chromiumの保存層を対象とする局所受入れであり、これらの
実機・運用受入れを代替しない。
