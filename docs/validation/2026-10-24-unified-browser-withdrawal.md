# ブラウザ同期の同意撤回 — 永続要求と受領照合

2026-10-24。部分検証。本番データや本番認証を使用していない。

## 変更

- 同期の同意をオフにすると、同意フラグと既存outboxのwithdrawnを同じIndexedDB
  トランザクションで確定する。新規outboxの保存にも同意を再確認する。
- 撤回済み要求は元本文を送らず、owner付きの`POST /sync/cancel/{request_id}`へ
  空オブジェクトだけを送信する。Cloudのcancel fenceは同じIDの遅延送信も拒否する。
- 適用済みの場合は、対応する受領記録をoutboxに保存する。同意オフの間は本文・
  ローカルrevisionへ採用せず、次回の処理・文書再読込でも追加通信しない。
- 利用者が再同意した後、保存済み受領記録を採用する。古い本文を再送しない。
  応答到着前後のローカル編集はdirtyのまま保持する。
- 受領の件数・ID・重複・revision・削除/分岐型を、本文を変更する前に検証する。
  採用時にも現在のoutbox request IDを照合し、後発の確認要求を消さない。
- 撤回済み削除要求は再確認で上書きできない。容量不足・アカウント切替時は
  元のoutboxを保持し、生成中の採用を避ける。処理末尾で同意オフになった場合も
  画面を「同期済み」に戻さない。

## 検証

フロント全体は **424 passed / 39 files**。続けて、処理末尾の同意撤回を1件追加し、
影響範囲`appSync.test.ts`の **27 passed**を確認した。
型検査と統合Appビルド成功。旧Mobileのbundle経路はこの変更で変わらない。

実ブラウザでは製品のappStore/appSync、実IndexedDB、隔離Cloud APIを使用した。
専用画面は`apps/web/.artifacts/browser-withdrawal.html`、隔離サーバーは
`.artifacts/native-sync-ui/server.py`。事業者への通信はfixture transportで禁止した。

1. 未送信要求を撤回。通信はstatus GETとcancel POSTだけで、POST本文は`{}`。
   同じIDの遅延送信が409 `sync_request_canceled`で拒否されることも確認。
   ローカルの未送信本文とdirty状態は維持した。
2. Cloud適用済みで応答を採用していない要求を撤回。本文再送0件、受領をoutboxへ保存。
3. 文書を再読込して再検査。受領記録とpending=1を保持し、同期処理の通信0件。
4. ローカル本文を編集して再同意。保存済み受領だけを採用し、serverRevision=1、
   新しい編集はdirtyのまま。通信はstatus/pullのGETのみで、本文再送0件。

文書再読込の画面証拠：`.artifacts/native-sync-ui/browser-receipt-reload.jpg`。
操作結果は専用画面のassertで検証し、同じ結果をDOMにも表示した。

## 復旧と限界

通信・容量不足ではoutboxを削除しない。接続復旧後に同じrequest IDで照合する。
受領記録がある間は、同意オフのまま追加通信する必要はない。
同意オフは既に確定済みのCloudコピーの消去を意味しない。
完全消去は別の明示確認・revision照合を必要とする。

ブラウザ/processの終了やスマホ再起動の証拠ではなく、文書再読込の証拠である。
大容量同期、共通祖先付き分岐、historical snapshot、配布・本番切替・物理端末の
受け入れは引き続き残る。
