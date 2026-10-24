# 履歴の作品設定・固定版の方式間互換

2026-10-25 JST。隔離SQLiteとWorker/storage mockによる検証。
本番会話、外部AI、実モデル、実スマホを使用していない。

## 対応範囲

- 成功生成のbefore/afterに、実際のrequestのsystem prompt・temperatureと開始時の
  Character/Persona/World・intro・LibraryBindingを保存する。生成中の設定編集を混入させない。
- Python/Device間の取込み・再書出し・Native受信・user/assistant発言位置の分岐で、
  保存された設定と参照するLibrary/Creatorの過去版を保持する。
- 同じ作品の版を同一のnative asset familyへ対応付け、元の安定IDへ再書出しする。
  現在と履歴から必要な版だけを送信し、無関係な私的作品を含めない。
- 過去版の文書が不足・不整合の場合は会話、作品、受領記録、cursorをまとめてrollbackする。
- snapshot.settingsは任意項目として追加。旧snapshotは従来の現在設定copyへfallbackする。
  失われた過去設定を復元できたとは扱わない。履歴snapshot自体がない同期会話の
  分岐・再生成禁止も維持する。

## 証拠

共通fixture `tests/fixtures/unified-history.json` は、記憶tea/version 3と
coffee/version 4、OLD/NEW SYSTEM、temperature 0.4/1.1、Character/Worldの版1/2を持つ。
分岐した設定を本物のprompt compilerへ渡し、OLD ROLE/OLD RULE/OLD SYSTEMのみが
使われること、元会話の現在設定・記憶が変更されないことを確認した。
別の成功生成fixtureではrequestで上書きしたpromptとtemperatureを保存することも確認した。

実行コマンド：

```powershell
.venv/Scripts/python.exe -m pytest tests/test_unified_history_snapshots.py tests/test_unified_runtime_bridge.py tests/test_native_sync_api.py tests/test_native_sync_client.py tests/test_native_sync_scopes.py tests/test_unified_app.py tests/test_generation.py tests/test_conversation_parity.py tests/test_cloud.py tests/test_cloud_model_choices.py tests/test_mobile_generation.py -q --tb=short --basetemp=.artifacts/history-settings-final -o cache_dir=.artifacts/unified-pytest-cache
pnpm --filter web test -- --pool threads --maxWorkers 1
pnpm typecheck
pnpm --filter web build:app
pnpm --filter web build:mobile
pnpm --filter desktop build
```

- Python関連：**185 passed**。
- フロント全体：**438 passed / 39 files**。
- workspace型検査：成功。
- 統合App・旧Mobile・desktopのビルド：成功。署名済み配布や実行時品質の証拠ではない。

## 残件

検証できる共通祖先、Native分岐のcanonical UUID/lineage、大容量分割、旧復元の全面照合、
3方式の実UI/実モデル・実機、本番切替は別途必要。全統合計画の完了を示す記録ではない。
