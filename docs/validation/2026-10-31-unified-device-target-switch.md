# Device起点の実行先切替 — ブラウザー受け入れ検証

対象: `tests/e2e_device_target_switch.py`。実行先切替の後続修正を含む作業ツリーで、既存のApp/Device推論fixtureを再利用して検証する。共有fixtureやモデル準備・推論契約は変更していない。

## 実行条件と結果

2026-10-31、共有ワークスペース `D:/VibeCoding/my zeta` の既存 `.venv` とインストール済みChromiumを使用。

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
.venv/Scripts/python.exe tests/e2e_device_target_switch.py
```

結果: **2/2 PASS**。Chromium **151.0.7922.34**（インストール済みrevision 1234）。JA・393×852・lightとEN・1280×852・darkで同じ契約を検証した。

実行記録: `.artifacts/device-target-switch-browser/results.json`、所有するloopback Viteのログ: 同ディレクトリの `vite.log`。各実行で上書きされる。結果JSONには動的generation ID、保存済みterminal receipt、履歴proof、revisionとbody tokenを記録する。

## 構成

- `mock.patch.dict(os.environ, {'VITE_UNIFIED_APP': '1'})` 内で既存 `local_vite` を起動し、終了時にそのプロセスとブラウザーを閉じる。
- 既存 `tests/fixtures/device-research.html` と `DeviceResearch.browser-fixture.tsx` の `mount`、その内部の `prepareRuntime`、`pause`、`status`、`api` を再利用。実際のApp、RuntimeGate、ActiveChat、DeviceApi、useChatRecovery、IndexedDBを通す。モデル準備用OPFS情報とWorkerだけが既存fixtureの合成実装で、重みは取得しない。
- Appは一度だけmount。fixtureが持たない実際の `ExecutionPicker` を、`/@id/react`、`/@id/react-dom/client`、`/src/components/UnifiedEntry.tsx` から読み込み別DOM rootにmountする。
- `Response.prototype.json` にテスト内だけの保留を置く。実際のDeviceApiがIndexedDBから生成した履歴proofを読み取った後、呼び出し元への返却だけを明示的なPromiseで止める。status・history・API応答内容・保存処理を置き換えない。これによりterminal保存済みでもuseChatRecoveryの照合が完了していない時間を検証する。
- Contextごとに空のブラウザーストレージを使用。所有Vite originの静的HTTPだけ許可し、すべてのネットワーク `/api/` と外部HTTPを拒否して失敗条件にする。Service Workerを無効化し、WebSocketを接続せず閉じる。両ケースで拒否対象リクエスト **0**、page error **0**。DeviceApiのローカル呼び出しはネットワーク要求とは区別する。

## 確認した契約

| 段階 | 両ケースで確認した内容 |
| --- | --- |
| 初期状態 | local会話1件にbaseline user/assistantの2発言。assistantのmodelは`kyalulu-iq3m`。実際のcomposerとpickerが使用可能。指定themeをDOMで確認。 |
| 生成中 | Workerをpauseしてcomposerから送信。Worker generate呼び出し1回、`generationBusy=true`、picker無効。直接`switchTarget('cloud'/'device'/'pc')`をすべて実行し、指定のbusyエラーで拒否。URL・localStorage全体・アプリIndexedDBのentities/parts/metaの全キーと値が不変。 |
| 実際のStop | composerのStopをクリック。保存receiptは`status=failed`、`user_id=3`、`assistant_id=null`。user内容SHA-256とexecution lockを含むterminal metadata全体を照合。履歴proofも同じgeneration/session/status/IDを持ち、user入力1件だけを示す。proofと保存エンティティのrevisionが一致。 |
| 保存結果確認待ち | 実際のproofを返す直前で保留。pending recovery IDが残り、pickerは無効、Stop and checkが表示されたまま。3実行先への直接切替も再び拒否し、URL・localStorage・IndexedDBが不変。 |
| 照合完了 | 保留Promiseを明示解除するとpickerが使用可能になる。recovery pendingはnull、入力`DEVICE_STOP_keep_input`を復元。IndexedDBはbaseline2発言＋停止入力1発言の計3件を保持し、assistantを捏造しない。会話のpending_generationはnull、memoryは空、state.turnは0。 |
| 確認modalのCancel | 未送信draftを`DEVICE_UNSENT_after_stop`に編集しPCを選ぶ。実際の転送しない旨の説明を確認してCancel。実行先はDevice、composer・URL・localStorage全体が不変。 |
| PC→Device往復 | 実際のpicker/modalから`/#/`の未登録PCへ遷移。activeRemoteなし・登録PC0件・接続画面を確認し、Device draftが保存されたまま。実際のpickerで`/device/#/`へ戻り、元会話を開くとdraftとbaselineが復元。元payload・revision・全履歴・terminal receiptを完全一致で照合。conversation1件、generation receipt1件のままで、自動転送・再送による生成の追加なし。 |

DeviceのStopはPython Runtimeの未確定ターンcancelと異なり、受理したuser発言を保存したまま`failed`で終わり、未確定assistantは作らない。テストはこの実装契約を明示的に検証し、Python側の`cancelled / user_id=null`を要求しない。

## 限界と担当境界

- 合成Workerによるローカルブラウザー受け入れ検証。実モデル推論、GPU、実機スマートフォン、production、登録済みRemote PC、Cloud provider、切断復旧の受け入れ証拠ではない。
- 戻り先はfixtureの再mountではなく実際のmain `/device/`。モデルが未準備でも会話・draftの復元を確認する。戻った後の新規生成や重みdownloadは行わない。
- ActiveChat上の生成・明示Stop・保存確認・切替を対象とする。親が別途調査中の「未確認pendingを残してProfile等へ移動し、ActiveChat unmount後に切り替える」経路はこのテストに含めず、その修正完了を主張しない。appContext/chatRecovery/UnifiedEntryには触れていない。
- 初回のEN確認で共有既定値の日本語Cancelを発見し、ExecutionPickerが言語別のcancelLabelを渡すよう修正した。最終の両ケースでは日本語`キャンセル`・英語`Cancel`をそれぞれ操作している。
- 専用scriptのみ実行。全面回帰、CI、型チェック、build、スクリーンショットによる見た目の審査は行っていない。インストール、外部API呼び出し、Git操作なし。
