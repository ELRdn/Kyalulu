# 登録前のNative分岐IDと、受領前のowner継承

架空アカウント、隔離SQLite、in-process Cloudでの検証。本番DB・残高・台帳への操作はない。

## 実装

- `unified_local_links` はアカウント未割当の端末内対応表。会話のID、数値IDからの
  message UUID/revision/digest、memory/summaryのIDと出典対応を持つ。本文は複製しない。
  分岐時に親と子の対応表を同じtransactionで保存し、既存数値IDは書き換えない。
- 初回の選択captureでも対応表を確定する。これにより、登録後・初回受領前の分岐にも
  同じcanonical IDを使える。既存の同期済みnamespace対応表がある場合はそちらを優先する。
- 同期設定の明示選択だけがアカウント対応表へ採用する。子を作るだけでは選択・送信しない。
  中立対応表の `local_parent_session` はローカル制御用で、wire payloadへ送らない。
- ownerのclaimは受領前にも存在するので、新しい子もそのclaimを引き継ぐ。
  別アカウントの選択は既存の `sync_account_copy_required` で拒否する。
- 親が先に同期済みなら、子の初回選択時にそのアカウントで記録済みの親revisionを
  共通message列の証明対象にする。分岐時に過去のCloud版が存在したとは主張しない。
  親子を初回に同時選択する場合は送信順を問わず両方を保存し、`fork_revision: 0` は
  `unverified`のまま。未記録の祖先を捏造してverifiedにはしない。
- 分岐後の記憶・設定を自動で混合しない。親に後から保存した記憶は子へ入れない。
  記録がない旧分岐は、本文が同じでも独立IDを採番し、親子と推定しない。
- 会話消去と復元時の消去適用では対象の中立対応表だけを消す。別の分岐は残す。
  旧論理snapshotはこの対応表を含まないため、復元対象の中立対応表を破棄し、
  再利用された数値IDへ古い証明を当てない。選択外の会話の対応表は維持する。

## 検証

- 既存のhistory/native-client/runtime-bridge/conversationと追加の最初の5件：
  **90 passed**、`.artifacts/native-local-identity-regression.xml`。
- 最終の `test_native_local_identity.py`：**9 passed**、
  `.artifacts/native-local-identity-final.xml`。上記と重複する集合であり合算しない。
  登録前のmessage/memory/summary UUID、明示選択、親の先行同期、記憶の独立性、
  初回送信順、同じ本文の旧データ、壊れた対応表の全transaction rollback、
  受領前のowner拒否、消去と部分論理復元を確認。
- 試験fixtureの初回には無効なscope modeとNativeにないsummary methodが含まれていたため、
  正式な `legacy` / `user_edited` に修正して再確認。製品側の入力検証を弱めていない。
- `e2e_remote.py` はlocaleを `ja-JP` に固定し **9 checks passed**。
  `.artifacts/remote-v1/e2e-70d2e243/acceptance.json`。実browser→loopback Relay→Host→隔離Runtime。
  `503627d`のLinux CIで見つかった日本語locatorと既定英語localeの不一致を修正するもの。
  実TLS/公開Relay/物理Androidの証拠ではない。
- D容量のため、この区切りの中間架空DBだけを整理した。JUnit XML、最終9件のDBと
  Remoteの証拠は保持する。既存の台帳・残高・予算・他作業のartifactは触っていない。

## 復旧・残件

追加DDLは既存DBへ `CREATE TABLE IF NOT EXISTS` で適用。SQLiteのCore全体バックアップは
この表も含む。旧バックアップや関係を保存していない旧分岐から、失われた対応表を復元した
扱いにはしない。旧版へ戻すと新しい分岐はこの表を更新しないので、同期を停止してから戻し、
再更新時はバックアップと対応表を照合する。

祖先本文の復元アーカイブ、旧DB全面復旧/Native既存linkの論理復元、アカウント間の明示的な
独立コピー導線、大容量保存・実UI/実モデル/実機受け入れは残る。同期未登録の子が
自動的にCloudでverifiedになる実装ではない。全体計画は `UNIFIED_DELIVERY.md` で継続する。
