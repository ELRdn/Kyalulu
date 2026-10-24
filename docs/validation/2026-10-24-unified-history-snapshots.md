# 履歴の状態・記憶スナップショット — 部分的な方式間互換

2026-10-24。隔離SQLite・Mockのみ。本番反映や実モデル品質の合格ではない。

## 実装と境界

- Pythonの成功したgeneration確定と同じトランザクションで、応答前後の状態と
  会話に帰属するactive記憶を保存する。別会話や帰属不明の共有記憶を含めない。
- Deviceの既存before/after形式をPythonの同期コピーに取り込む。状態・記憶・
  出典message ID・memory UUID/revisionを対応表で変換し、生成履歴を再構築する。
  providerのraw prompt、compiled、attemptsや認証情報はこの形式で転送しない。
- モデルが作った記憶を対応するgenerationへ結び付け、再生成・履歴編集時の
  無効化を元会話から分離する。分岐の記憶は現在の行から再構成せず、当時の保存値を使う。
- 分岐に複製したgeneration内のsession/message/memory/generation参照を変換する。
  新しい数値IDを割り当て、元会話の数値IDと現在の記憶を変更しない。
- 応答時点だけでなくuser発言時点でも、対応するbefore状態から分岐する。
  最初のuser発言は後続の確定応答に保存されたbeforeを使う。
- 不完全な前後ペア、未来のsource message/turn、重複memory、型・turnの不整合を拒否。
  不正な取込みは会話・generation・Cloud受領をまとめてrollbackする。
- 古い同期データに履歴スナップショットがない場合は、分岐・再生成の禁止を維持する。
  当時の記憶が保存されていない履歴を、現在の記憶で捏造しない。

## 検証

共通fixture：`tests/fixtures/unified-history.json`。
現在の記憶はcoffee/version 4、最初の応答時点はtea/version 3という会話を使用する。

- Pythonへの取込み・再書出し、応答時点の分岐、最初/途中のuser発言時点の分岐。
- tea/version 3だけの分岐と、元会話のcoffee/version 4が混ざらないこと。
- state_beforeによる再生成準備、複製generationの無効化が元会話を変更しないこと。
- 後からDBの記憶を変更しても、成功確定時のスナップショットが変わらないこと。
- 共有・不明記憶やprovider内部情報の不送信、破損取込みの全体rollback。
- TypeScriptで同じfixtureを読み、独立した数値ID・安定UUIDと記憶revisionを検査。
  Device APIでも3か所の分岐を検査し、未来の記憶を拒否する。

実行結果：

```powershell
.venv/Scripts/python.exe -m pytest tests/test_unified_history_snapshots.py tests/test_unified_runtime_bridge.py tests/test_native_sync_api.py tests/test_native_sync_client.py tests/test_native_sync_scopes.py tests/test_unified_app.py tests/test_generation.py tests/test_conversation_parity.py tests/test_cloud.py tests/test_cloud_sync.py tests/test_remote_bridge.py tests/test_remote_host.py -q --basetemp=.artifacts/unified-backend-commit-01 -o cache_dir=.artifacts/unified-pytest-cache
pnpm --filter web test -- --pool threads --maxWorkers 1
pnpm --filter web typecheck
```

バックエンド **246 passed**、フロント **434 passed / 39 files**、型検査成功。
日付はローカル検証日。実スマホの20ターン・ロック復帰の証拠ではない。

## 続行する残件

この実装だけで分岐・同期の全要件を完了したとは扱わない。

- 各応答時点のsystem prompt・temperature・Library/Worldの固定版など、
  **履歴の作品設定全体**を独立したsnapshotとして渡し、分岐先の設定に復元すること。
  現時点ではstateに含む過去のCreator参照とその文書は保持するが、設定全体の復元ではない。
- 共通祖先を検証できるentity revision履歴、Native分岐のcanonical UUIDとlineage。
- 旧データの履歴不足の明示、復元との全面照合、大容量分割protocol。
- 3方式の実UI/実モデル/物理端末、配布・本番切替。

前段の登録・撤回は[Native sync](2026-10-24-unified-native-sync.md)、
ブラウザ撤回は[Browser withdrawal](2026-10-24-unified-browser-withdrawal.md)を参照。
