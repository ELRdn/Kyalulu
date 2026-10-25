# Core全体復元の同期状態保護

条件付きの明示承認に基づく実装・架空データ検証。
[承認範囲](../UNIFIED_CORE_RESTORE_REVIEW.md)に従い、pytestの一時領域で作成した
SQLite、ZIP、in-process Cloudだけを使用した。本番DBの復元・削除・上書きやマージは行わない。

## 実装

- ローカル復元は入力ZIP・SQLiteの検証後、RuntimeLock内で独立した復元前Core ZIPを作成する。
  ロック拒否や復旧用ZIPの作成失敗時には、現在のDBと媒体を変更しない。
- ローカル・Cloudの共通promotionは、現在のDBを変更する前に復元用DBだけで同期状態を統合する。
  Cloud呼出し元のtenant lockと既存の暗号化復元前バックアップを維持し、二重にRuntimeLockを取得しない。
- 現在のNative metadata、outbox本文・request ID、owner対応、最新の同期リンクを保持する。
  現在DBで精算済みのoutboxを過去ZIPから復活させない。ownerやリンクの所有者が衝突したら拒否する。
- 受領revisionは最大値、削除済みフラグは両DBの論理和を採用する。会話の削除記録も統合して適用する。
- Native同期を停止し、現在outboxは本文を変えずwithdrawnにする。対象ごとの新しい確認IDを発行し、
  旧要求の受領照合が済むまで別コピーの送信を許可しない。照合は既存のcancel APIにrequest IDだけを送る。
- 現在DBに同期状態がない場合も、過去の同意・送信待ちを復活させない。
  DB自体がない新規復旧先ではZIP内のoutboxをwithdrawnにして保持し、自動送信しない。
- Cloudリンクにも復元確認markerを付ける。従来の同意が残っていてもcaptureを拒否し、
  再確認後は別entityにする。中立のローカルID対応表を破棄し、古い本文へ現在の同一性証明を流用しない。
- 媒体配置やSQLite backup中の例外では現在の媒体へ戻し、SQLiteのatomic rollbackを利用する。
  入力ZIPと独立した復元前ZIPを残す。台帳・残高・予算・認証は復元対象に加えない。

## 検証

- 関連Python集合 **132 passed**（うちCore境界20件）。
  Core、Native論理復元/client/scopes/API、旧Cloud同期/parity、バックアップ、Runtime bridge、
  ローカル同一性、Portableバックアップ形式の既存試験を含む。
  ローカル記録は `.artifacts/unified-core-restore-regression.xml`。
- 共用したmetadata初期化の追加確認として、Native outbox索引・送信ガードの既存5件も成功。
  `.artifacts/unified-core-restore-guards.xml` に記録した。
- Core境界では、未送信本文/request IDの保持、処理済み要求の復活防止、複数アカウント、
  cursor/除外状態/最新リンクの保持、owner衝突、受領tombstoneと会話削除記録の統合を確認。
- 未適用・応答喪失後の適用済み要求の両方で、本文再送なしの受領照合、同期停止、
  確認必須、別コピー化、元Cloud保持、非ゼロ残高保持を確認。
- 新旧媒体のrename失敗、SQLite backupのページ書込み中断、復旧用ZIP作成時の容量不足を注入し、
  現在DBの全SQL dump・媒体・無関係なファイル・入力ZIPの保持を照合。
  復元前ZIP内にも当時のDB全dumpと媒体が残る。
- 架空Cloudの実restore APIで暗号化Core ZIPを復元し、旧本文の回復と確認markerを照合。
  accounts、credit_lots、funds、operations、private_budgets、admin_grants、secrets、
  runtime同意、既存entity、登録端末の行を復元前後で比較。再確認後の新entityも検証。
- 不正なZIPパス・重複メンバー・壊れたSQLiteは、現在DBの変更・復旧用ZIP作成より前に拒否する。
  重複manifest fixtureを正した最終の入力検証3件も再実行して成功した（132件と重複）。
- 初回のsandbox一時パスではfixture作成が5件ともsetup errorになった。短い専用一時パスへ変更し、
  上記試験を完了。Cloud試験の台帳テーブル名と確認待ちエラーの期待値も既存仕様へ修正した。

## 復旧手順と制限

1. 対象Runtimeを停止する。Cloudでは既存のtenant lock付きAPIを使用する。
2. 入力と現在データを保持し、実装に対応するRuntimeで復元する。独立した復元前アーカイブを保管する。
3. Native設定で旧送信の受領を照合し、復元対象を確認して別コピーとして同期する。
   消えた選択対象はバックアップを確認するか明示的に選択解除する。確認IDやoutboxを手で削除しない。
4. エラー時は入力・復元前アーカイブ・現在DB/媒体を保持する。owner衝突をDB編集で回避しない。
   旧Runtimeへ戻す場合も、自動同期を再開する前に復元確認への互換性を確認する。

強制終了・電源断時のDBと媒体をまたぐ一括耐久性、実容量、実機、配布版をまたぐ全面復旧、
実TLS/OAuth、実提供元、本番復旧・反映は未検証。この記録は公開合格や全計画完了を意味しない。
Web/UIに変更はなく、今回のためのWeb全体試験・ビルド・ブラウザ再試験は重複実施していない。
