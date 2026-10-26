# PC entity同期 — 隔離検証

2026-10-24。統合計画の部分検証。本番反映・一般公開合格・実機合格ではない。
実ユーザーの会話や認証情報は使用していない。

## 実装範囲

- Cloudはcookie認証で同期専用トークンを発行。保存するのはhashのみ。
  entity同期・受領照会・entity取得に限定し、旧バックアップトークンとは分離。
  30日、有効な親ログインセッションに従属し、同時に有効な端末は5本まで。
  失効済みセッションの端末は一覧・上限に残さない。
- `/api/local/app-sync`はPCのloopbackかつloopback Hostだけ。
  LAN、public Host、forwardedヘッダー、管理権限付きRelay、Cloud tenantも拒否。
  ブラウザtransportもlocal以外では新旧のPC同期設定を送信前に拒否する。
- origin変更は再登録を必須とし、旧トークンを新originへ送らない。
  GET・設定保存結果にトークンを返さず、UIの永続Web保存にも入れない。
  PCデータディレクトリ内の`app-sync.json`だけに登録する。
- originとアカウントでSQLiteリンク・受領履歴・outboxを分離。
  選択したPC会話だけ送信し、同期済みアカウント会話は別コピーとして取り込む。
  別アカウントに結び付いた元会話を再送信しない。既存数値IDを保持する。
- 15秒間隔の自動同期。outboxと受領・cursorを同じRuntime DBに永続化し、
  再起動・応答損失後も同じrequest IDを使用する。
  生成中は未確定データを送信せず、失効トークンの再試行を止める。
- 同意・選択の撤回は要求をwithdrawnにする。本文を再送せず、request IDだけで
  適用済みreceiptか永続cancel fenceを確定する。通信できない間は未確定記録を保持。
  会話完全消去後に古いoutbox本文を再送しない。
- 削除は承認済み条件の範囲でowner・安定ID・revision・明示確認を照合。
  競合は再確認とし、撤回済み要求の再確認を拒否する。
  未送信変更を端末限定回復として残し、他アカウントのコピーを変更しない。
- 設定・手動同期・解除・削除確認はexpected ownerを照合。
  Native設定はローカル実行時だけ表示し、会話ヘッダーに保存先と同期状態を表示。
  同期トークンのコピー操作、JA/EN、チェックボックスと入力欄の共通スタイルを接続。
  未送信の変更を確認せず「同期済み」と表示することは避けている。

## 自動検証

```powershell
.venv/Scripts/python.exe -m pytest tests/test_native_sync_api.py tests/test_native_sync_client.py tests/test_native_sync_scopes.py tests/test_unified_runtime_bridge.py tests/test_unified_app.py tests/test_cloud.py::test_sync_token_is_scoped_and_revocable tests/test_cloud_sync.py tests/test_cloud_download_conflict.py -q --basetemp=.artifacts/native-api-02 -o cache_dir=.artifacts/unified-pytest-cache
pnpm --filter web test -- --pool threads --maxWorkers 1
pnpm --filter web typecheck
pnpm --filter web build:app
pnpm --filter web build:mobile
git -c core.whitespace=cr-at-eol diff --check
```

- バックエンド **87 passed**。実SQLiteとin-process Cloud APIを使用。
- フロント **416 passed / 39 files**。新たな送信先拒否を含む。
- 型検査、統合Appと旧Mobileビルド成功。UI検証後の修正にも型検査・Appビルドを適用。
- 差分検査成功。既存の改行変換警告、Viteの非module script・WASM依存・chunkサイズ警告あり。
- スマホ実機、外部事業者、実モデルの成功証拠は含まない。

## 実ブラウザ

使い捨てRuntime DB・Cloud DBと架空ログインを使うloopbackサーバー8769、
検証用Vite5197を使用。実Supabase・決済・広告・生成APIには接続しない。
製品のNativeSyncSettings / SyncDevices / SessionPolicyを読み込む専用画面で確認した。

- トークン発行 → コピーボタン → PC入力欄に貼付 → 会話1件の選択・同意・登録 → 手動同期。
- Cloud側を別revisionへ更新した架空会話で、削除競合・ID・v2・件数と最終確認説明を表示。
  確認ダイアログはキャンセルした。消去確定・二重適用・未送信保持は自動試験で確認。
- 同期オフで保留要求を撤回し、削除確認項目を消す。登録解除後も端末限定会話を保持。
- JA/EN切替、明暗表示、会話ヘッダーの「自動同期が有効」「同期停止中」「同期対象外」。
- 表示幅726pxと511pxで観測。390pxのスマホ幅、実機、IMEは今回の証拠に含めない。

画面証拠：`.artifacts/native-sync-ui/confirm-en.jpg`、`confirm-ja.jpg`、`stopped-light.jpg`。
これらは製品全体のE2Eではなく、隔離した同期画面の証拠。

## 復旧と残件

- 接続障害時はRuntime DBと`app-sync.json`を保持して再起動する。
  同意撤回後の未確定receiptもDB内に残る。トークン再登録後、cancel照会で解決する。
  receiptが未確定のままDBを消去しない。
- 401/403時はCloudで新しいトークンを発行し、対象PCで登録し直す。
  古い画面の操作はowner不一致として拒否し、設定を再読込する。
- アカウント変更は明示確認が必要。元アカウントの会話はそのPCに保持する。
  別アカウントで利用するなら利用者が別コピーとして書き出し・取込みする。
- 単一会話の2MB超の分割protocol、250MB/1GBスケール、共通祖先付きbranch lineage、
  historical generation snapshots、旧バックアップ復元との全面照合は未完。
- ブラウザ側の同意撤回は後続の
  [専用検証](2026-10-24-unified-browser-withdrawal.md)でcancel fenceへ接続した。
- 本番ドメイン切替・配布・物理端末・未契約事業者の接続は別の完了項目。
