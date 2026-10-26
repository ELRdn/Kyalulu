# Device研究の共通生成・専用保存

## 実装

- Deviceの `/research` を共通UIで提供。設定画面とサイドバーに入口を追加した。
  Deviceだけに研究を許可し、既存のCloud制限・Remote管理権限は維持する。
  `/studio`・診断・モデル管理のPC権限は付与しない。
- Browserの生成処理を研究からも呼ぶ。Worker/model準備、owner、単一生成、
  Portableコンパイル、RPG/cast、構造検証、記憶提案、保存失敗、停止の処理を共用する。
  通常会話の開始と研究準備が競合しても、準備後のguardで二重開始を拒否する。
- 既存4シナリオとNativeが生成する長ターン12シナリオを同じcatalogへ固定。
  共通Scenarioスキーマに `new_session`・想起/禁止語probeとturn番号の重複拒否を加えた。
  新セッションでは履歴/状態を初期化し、同一実験の記憶だけを保持する。
  message番号は初期化せず、記憶の出典には新セッションの識別子も記録する。
- 実行は最大3回・各100ターンまで。記憶領域は実験ごとに独立する。
  Web Locksと生成中状態を使い、同じownerの複数画面からの研究開始を拒否する。
  モデルが未準備ならダウンロードせず停止する。
- 実験・要求の受領記録・採点はownerをJSONで区切った専用metaキーに保存する。
  研究会話を通常のentitiesへ保存せず、会話同期・最近の会話・共有記憶に混ぜない。
  owner確認とrevision照合を保存transaction内でも行う。
- 確定した生成結果と研究ターンは同じtransactionで保存する。
  停止が結果保存直後に届いても確定結果を失敗ターンで置き換えたり重複させない。
  保存容量不足では未完了入力を保持し、成功を返さない。
- 同じrequest ID・同じ条件の完了再送は記録済み結果を返す。
  条件変更・中断した要求の再利用は409で拒否し、自動で新しい生成を始めない。
  Web Lockが残っている実験は回復処理で中断扱いにしない。
  画面再読込後にlockがない実行中記録は `interrupted` として保持する。
- 表示、JSON書き出し、採点、再実行、公式/参考ランキングを提供する。
  採点は生成結果と別のキーに保存し、生成中の保存によって上書きしない。
  再実行はモデルファイルの固定情報と保存済みPortable/シナリオ/生成条件を照合し、
  新しい実験を作る。元の実験は変更しない。モデル情報やpromptが欠ける場合は拒否する。
- 記憶・プロンプト・測定値を記録し、keyword probeと人手採点を分ける。
  ONNX等がseedを適用できない場合は既存samplingのunsupported表示を維持する。
  seed指定を実行の決定性保証とは扱わない。
- Deviceの実行・再実行に停止操作を追加。準備中の停止もAbortSignalで受け付ける。
  Device研究画面を離れる場合や比較対象の変更時も停止し、元の確定/途中結果を保持する。
  旧アカウントの画面はkeyで破棄し、遅れた一覧取得の応答やエラーを新画面へ適用しない。

## 検証

- `deviceResearch.test.ts`: 10 passed。
  共通生成、実験別記憶、新セッション、完了再送、採点とowner、途中失敗、
  成人/未準備/不正入力、並行開始、owner/request限定の停止、アカウント変更、
  旧pendingの回復、元データを保持する再実行、容量不足、準備中停止、保存直後停止を確認。
  この試験のstorage/Workerはfixture。実ブラウザ側で別途IndexedDBを確認する。
- `deviceMetrics.test.ts`: 2 passed。
  Nativeが出力した共通fixtureでUnicode文字数、反復、失敗率、遅延集計、
  keyword分類・記憶集計・binary floatの端数処理を照合。
  記憶検索オプションと不正スキーマも確認する。
- `tests/test_device_research_fixture.py`: 2 passed。
  Nativeの計算結果とfixtureを再照合し、16シナリオ全体をNativeの読み込み結果と比較。
  pytest cacheの書込み権限警告が1件あるが、試験は成功。
- `tests/e2e_device_research.py`: 実Chromiumの日本語393px/light・英語1280px/darkの2条件成功。
  実際のApp・RuntimeGate・共通API・MobileRuntime bridge・IndexedDB・Web Locksを使用。
  モデル準備はOPFSのサイズ情報を、推論はWorker境界を架空実装に置換する。
  モデルファイルを作成/ダウンロードしたり実推論したりする試験ではない。
  設定から研究への移動、8ターン、採点/JSON、文書再読込、別アカウントの404/一覧分離、
  PC管理拒否、明示停止と画面移動時の停止、同期entitiesが0件であることを確認。
  想定外のAPI・外部要求・pageerrorは0。
  共通RuntimeDownloadから実際に保存した `experiment.json` をNativeのExperimentMetaで検証。
  画面は `.artifacts/device-research-browser/` に保持する。
- 同じ研究UIの日英/下書き/BenchmarkLab条件の既存3条件も再実行して成功。
  遷移試験は非同期の状態取得を真偽値として扱わない同期status accessorで待つ。
  最初の遷移拡張で古い一覧取得の未処理 `Account changed` を検出し、effectの終了guardで修正した。
- Device研究のブラウザ試験をWindows/Linux CIへ追加。
- 最終フロント全体は675 passed / 52 files、workspace型検査成功。
  直前の `c025745` はWindows/Linux CI成功（PR run `40219042061`）。今回の後続変更の成功とは区別する。

## 残る受け入れ

DeviceのBenchmarkLabジョブ行列・progress/poll/timeout/中止、実モデルでの20/100ターン、
Android/iPhone、ロック復帰・回線切替・OS IME、商用接続、本番ドメイン反映は未受入れ。
研究はDevice画面で実行し、Nativeのバックグラウンドジョブと同じ継続性はまだ提供しない。
新しい配布buildと最新CIの成功は別に確認する。通常会話・同期・既存DBを移行/削除する変更ではない。

後続のBenchmarkLab実装・期限・別タブ停止・100ターンの証拠は
[Device benchmarks](2026-10-26-unified-device-benchmarks.md) を参照。
`fefbaa0` のUbuntu CIは試験起動時の `ModuleNotFoundError: python` で停止した。
後続でブラウザdriver自身が `runtime/` をsys.pathへ加え、環境変数に依存しない起動へ修正した。
