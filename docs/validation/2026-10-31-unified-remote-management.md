# Remote管理権限の受入確認 — 2026-10-31

対象: `D:/VibeCoding/my zeta`、`codex/unified-app-integration`、開始HEAD `3688179`。
本記録は最終ログ・artifactと関連ソース差分を照合したもの。

**最終Remote driverは実ブラウザーで全19 checks成功。**
根拠は `.artifacts/remote-management-final-browser.log` の `passed: 19` と
`.artifacts/remote-v1/e2e-75b7817c/acceptance.json` の19 checks。
初期失敗を解消したRelay・独自scenarioの修正を含む最終状態で、停止結果確認/reload、
held saved-result barrier、Host再接続、device失効まで通過している。

## 実測した権限境界

既存の実PWA → Noise → loopback Relay → Host → isolated Runtimeを使用。
PC側の既存local API `PUT /api/remote/devices/{device_id}/management` で付与・失効した。
local呼出しはASGITransport、Remote呼出しはブラウザーの実 `apiFetch` を使用し、応答を偽造していない。

| 操作 | 会話権限のみ | 管理付与中 | 管理失効後 |
|---|---:|---:|---:|
| GET `/api/diagnostics` | 403 | 200 | 次のRemote要求で403 |
| GET `/api/commands` | 403 | 200 | 403 |
| GET `/api/providers` | 403 | 200 | 403 |
| POST `/api/commands` (`/help`) | 403 | 200 | 403 |
| GET `/api/experiments` | 403 | 200 | 403 |
| POST `/api/experiments/run` | 403 | 200 | 403 |

管理情報は実コマンド一覧、モデル管理コマンドのhelp、Mock providerのcapabilities。
実モデルの在庫照会、ロード、ダウンロード、外部providerへの接続を行ったという意味ではない。
研究操作は既存 `mock-echo`、架空の未登録scenario、**`character=None`**、
1 turn × 1 run、seed 42、memory無効。
実runnerでcompletedとなり、実ファイルを保存した。保存済み `meta.json` でも
`character_id=null`、`official=false` を確認した。既存SFW characterを指定する回避策は使っていない。

付与中でも以下の8操作はすべて403:

- GET `/api/remote/status`
- POST `/api/remote/pair`
- POST `/api/remote/approve`
- PUT `/api/remote/devices/{id}/management`
- DELETE `/api/remote/devices/{id}`
- POST `/api/remote/stop`
- POST `/api/mobile/admin/code`
- GET `/api/mobile/admin/devices`

管理失効の前後でHost ConnectionのIDとオブジェクトを照合し、同一接続であることを確認。
登録、Host側device設定、ブラウザーの登録済み鍵のSHA-256、会話履歴を維持した。
管理失効後も既存の次のMock会話が実行され、元の会話に計4メッセージが重複なく保存された。
`/api/mobile/status` の `administrative` は false → true → false、Hostの保存済みpermissionも一致した。

## 保存先と通信範囲

最終driver実行の証拠:
`.artifacts/remote-v1/e2e-75b7817c/acceptance.json`。
管理関係27要求が期待statusと一致し、`same_host_connections`、`registered_keys_unchanged`、
`browser_entities_unchanged` はすべてtrue、`external_attempts` は空。
内訳は会話権限のみ6件が403、付与中7件が200、付与中のlocal専用8件が403、
失効直後の次要求1件と残り5件が403。

対象PCのdata rootは `.artifacts/remote-v1/e2e-75b7817c/`。
診断の実DBパスがその直下の `data.db` と一致することをassertした。
実験は `experiments/52d30859-67e0-4f24-9bec-da8d05059600/` の1件だけ。
`meta.json`、`metrics.json`、`turns.json`、`turns.jsonl`、`raw_prompt.txt` の実在、内容、失効後のSHA-256不変を確認した。
管理前の拒否時には実験directoryが作られず、失効後の再実行拒否でも増えていない。

モデルregistryはfixtureにコピーしたMockだけ、provider health対象もMockだけ、LE tokenはfixture内の不存在ファイル。
RuntimeのHTTPは所有する2つのloopback origin以外を拒否する。
ブラウザーfetchはplaintext `/api/` と非fixture originを拒否し、WebSocketはnativeのまま接続先を観測する。
Relay SQLite/WAL等に架空研究canaryが平文で存在せず、ブラウザーのDevice entitiesにも保存されないことを確認した。
開始ブラウザーには通常のAPI結果/metadataが返る。Cloud/別PCへの保存・同期・export操作は行っていない。
別PCを接続してのstorage隔離検証や、物理端末/TLS/本番環境の検証ではない。

## Relay修正と2principalの回帰確認

`runtime/python/relay/app.py` は、既に消えたclient session宛のHost frameを
`client is None` の場合だけ破棄する。遅延binary/close frameでHostや他clientを切断せず、
再接続後の新sessionへ旧結果を混入させない回帰ケースが追加されている。
存在するsessionのhost不一致は引き続き拒否する。cross-hostのbinary/close注入と
不正frameはcode 1008で閉じる境界を保持している。

追加unitは既存 `test_remote_bridge.setup/submit/collect` と実 `HostService.set_management`、MemoryVaultを再利用。
2つの架空UUIDについて、双方拒否 → Aだけ許可 → 双方許可 → Bだけ許可 → 双方拒否を検証した。
各段階で保存済みpermissionとHost判定が一致し、両deviceの会話用healthは200を維持する。
これは2principalのunit検証であり、2つの実ブラウザーを同時接続した実証ではない。

保存済みの試験結果（今回の文書更新では再実行していない）:

| 証跡 | 結果と解釈 |
|---|---|
| `.artifacts/remote-management-final-browser.log` | 実ブラウザーの最終driver: **19 checks成功**。対応する最終 `acceptance.json` を生成 |
| `.artifacts/custom-scenario-catalog-green.log` | runner/catalog共通判定と関連回帰: **20 passed in 12.10s**。詳細は独自scenario記録 |
| `.artifacts/relay-late-frame-green.log` | **135 passed / 2 failed in 32.20s**。失敗はoperations-only subprocessの `PermissionError` とasync unitの実行設定 |
| `.artifacts/relay-late-frame-final-two.log` | 上記の失敗2件を対象とした再実行: **2 passed in 4.37s** |

広域試験は**135件成功＋失敗2件の再実行成功**という証拠であり、
最終ソースで137件を一括再実行して成功したという記録ではない。
cross-host拒否・遅延frame回帰は広域ログの失敗2件には含まれない。

最終driverの終了記録は `browser_closed=true`、`relay_shutdown_complete=true`、`vite_exit_code=1`。
Viteの1は所有fixtureのterminate後の終了値。既存プロセスやユーザーデータには終了操作を行っていない。

## 初期失敗の履歴と検証限界

- `.artifacts/remote-v1/e2e-5c7e35dc/partial-acceptance.json` は管理27要求を通過した後、
  消えたsession宛の遅延frameでHostが1008切断され、driverが未完了となった初期記録。
  最終結果では上記Relay修正後の停止結果確認/reloadまで通過している。
- `.artifacts/remote-v1/e2e-d9f420a7/` では未登録scenarioの `character=None` を
  公式と誤判定して500になった。共通helperの修正後、最終ブラウザーではNoneのまま完了した。
- `.artifacts/remote-v1/e2e-21cb7dda/` はCloud用 `apiFetch` 分岐を誤った中間失敗。
  最終fixtureはplaintext API fetchを拒否し、Cloud account拒否の根拠は既存bridge unitに限定する。

初期失敗は履歴であり、現在も未修正・全体受入未完了という意味ではない。
受入範囲はMock、Androidエミュレーション、loopback開発origin。
実LLM、モデルDL、外部provider、本番、物理端末/TLS、別PC接続のstorage隔離は未検証。
2principal unitを2つの実ブラウザーの同時接続実証とは扱わない。
