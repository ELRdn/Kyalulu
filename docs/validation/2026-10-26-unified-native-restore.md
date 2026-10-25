# Nativeの旧論理snapshot復元後の送信停止と別コピー確認

対象は `cloud.sync.apply_rows/apply_snapshot` が使う旧論理snapshot。SQLite DB全体の
Core復旧・旧配布版へのrollbackを全面受け入れした記録ではない。
架空アカウント、隔離DB、loopbackとin-process APIのみ。本番データは操作しない。

## 動作と境界

- 論理復元と同じSQLite transactionで、対象sessionのNative namespaceへ復元ごとの確認IDを
  `native_sync_meta` に保存する。部分復元では該当するアカウントだけ、全復元では
  関係する全namespaceの自動同期をオフにする。
- そのnamespaceの既存outboxは本文を保持したままwithdrawnにする。確認なしの再送と
  復元データの自動送信を止める。小さいinline送信も、送信直前に永続状態を再確認する。
  すでに送信境界を越えた要求は、request IDの確定結果で照合する。
- 完了応答を失った旧要求は `/sync/cancel/{request_id}` で照合する。未適用なら取り消し、
  適用済みならhashを照合して受領だけを採用する。本文は再送しない。照合不能なら
  outboxと復元内容をPCに保持し、新しいコピーの送信を拒否する。
- PC側設定で自動同期・通常の保存同意に加え、復元した対象の一覧と「別コピーとして同期」を
  確認する。既存Cloud会話を変更しないことを日英で表示する。
- APIは現在ownerと復元単位の確認IDを照合する。確認中に再復元された古いIDは拒否する。
  取消の外部要求より先に確認IDを照合する。未確定outboxが残る間は対応表を切り替えない。
- 受領確定後、旧Cloud entityをこのPCの再受信対象から外し、新しいentity ID/対応表で
  復元した同じnative会話を送信する。旧Cloud本文・数値ID・残高・台帳を上書きしない。
- 復元で消えた選択済みの会話は黙って削除せず、設定画面で選択解除かバックアップ確認を
  案内する。未選択の復元会話には確認IDを残し、送信を許可した扱いにしない。
- 壊れたoutboxの型は拒否し、復元データ/同期停止/確認IDの変更をまとめてrollbackする。
  PCの会話候補取得のSQLite接続も明示的に閉じ、Windowsの復旧用DBロックを残さない。

## 検証

- Native client/API/scopes、旧Cloud sync、backup、Runtime bridgeの関連集合：
  **79 passed**。`.artifacts/native-restore-regression-verified.xml`。
- 最終の復元境界集合：**9 passed**、`.artifacts/native-restore-fence-final.xml`。
  未送信/適用済みの旧outbox、応答喪失、取消時の本文未送信、初回受領前の復元、
  新ID、元Cloud保持、stale確認、部分/全復元のnamespace、送信直前の停止、
  owner拒否、壊れたoutboxのatomic rollbackを含む。関連集合とは重複する。
- その後の非ゼロ残高保持の追加確認：**1 passed**、`.artifacts/native-restore-balance.xml`。
  321以上の付与済み残高が復元・再同期後も同じであることを確認。
- フロント全体 **648 passed / 48 files**。追加4件では日英の警告、確認の取消時のAPI未実行、
  表示中のowner/確認IDだけを送ること、消えた会話の明示選択解除導線を確認。
- `tests/e2e_native_restore.py` **3条件成功**：393px/lightの日本語と英語、1280px/darkの英語。
  実共通部品→PC用API→隔離Native SQLite→Cloud ASGIを使い、取消後の同期停止、
  確認中の再復元拒否、再確認後の独立コピーと元Cloud保持をDBで照合。
  外部要求/pageerrorは0、横overflowなし。`.artifacts/native-restore-browser/results.json` と
  `review-*.png` を保存し、開くアニメーションを止めた画像も確認した。
- Web型検査、統合App、Desktop build成功。既存WASM/chunk警告あり。
  App初回はWASM一時コピー中にD容量不足で失敗した。今回生成した中間架空DBだけを
  絶対パス/リンク先の確認後に整理し、同じビルドを再実行して成功した。JUnitと最新fixtureは保持。
- 標準C sandbox TEMPへのpytest実行はfixtureディレクトリ作成で79件ともsetup error。
  コードを変更せずworkspace内の隔離TEMPへ戻し、上記79件の成功を確認した。
  その失敗記録 `.artifacts/native-restore-regression.xml` も残す。
- 新しい画面試験をWindows/Linux CIへ追加。先行 `13c6561` はLinux成功、Windowsは確認中。
  その結果を今回の変更後のCI成功とは扱わない。

## 復旧・残件

追加tableや依存はなく、既存meta tableの追加keyとlocal APIの任意フィールドを使う。
通常の既存同期設定リクエストは継続できる。復元確認の再開には今回のPC Runtime/UIが必要。
旧版へ戻す前は同期を停止し、`app-sync.json`とDB/outbox/確認IDをバックアップする。
復元確認IDを消して復旧した扱いにはしない。

SQLite Core全体の復旧、配布版をまたぐ全面復旧、大容量/実機、実TLS/OAuth、実提供元、
本番反映は残る。今回のブラウザbrokerはHost/Originをfixtureへ写像しており、LAN/Relay経由の
管理権限を許可したものではない。既存のlocal-only API境界試験を関連集合で維持する。
