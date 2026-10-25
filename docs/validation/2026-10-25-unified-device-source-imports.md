# BrowserのSillyTavern・Character.AI・BYAF取込み

Binary/media基盤に続き、既存Nativeの他の主要入力形式をBrowserに接続した。
外部取得やスクリプト実行は行わない。契約サービス、本番会話・残高は変更していない。

- SillyTavernの順序付きprompt presetと単独profile、WorldInfoのdict/arrayを変換。
  character_id 100の順序、無参照promptの無効化、未知値の保存、sampler aliasと
  API URL/key等をlive settingsへ入れない境界をNativeと照合する。
- Character.AIのJSONキャラ、JSON配列/包み付きLore、ラベル付きテキストを変換。
  Definition以降のラベルは解析せず、改行と空白をそのまま保つ。
- BYAF v1のcharacter/scenario/image/historyを読み、複数scenarioを別作品としてpreview。
  output選択はactiveTimestampの最大値・同値時の後勝ち。timezone差とmicrosecond差の
  fixtureも照合する。日時はcalendar ISO dateとminute offsetに限定して検査し、
  未対応のweek-date等を推測で解釈しない。原本と元message・選択時刻を保持する。
- BYAFの画像は既存実decoderへ渡す。未知role、欠損scenario、schema不一致、
  character ID不一致、権限外greeting、壊れた日時/outputs/image pathを拒否する。
- Windows CIのbase64比較試験が1MiB配列の深い比較で5秒を超えたため、同じ全bytesを
  NodeのBuffer.compareで照合する。試験対象の入力サイズや判定を減らしていない。

## 検証

- frontend全体 **577 passed / 44 files**。Native由来の共通import fixtureは**47入力**。
  fixtureは `scripts/build_device_import_fixture.py` で再生成する。
- Native import/media/Portable/promptの対象集合 **114 passed**。
  `.artifacts/device-import-native-sources.xml`。
- Chromiumのsetup/reloadとも、47入力の文書/媒体bytes・11媒体の実validationが一致。
  BYAFの2scenarioを実IndexedDBへ別々に確定し、選択済み返答・数値message IDの分離・
  同じrequestの再送を確認。既存WAV実decode/owner切替の試験も成功。
  遅延した旧ownerのresponse bodyからBlobを作らないこと、幅240pxでのplayer、
  日英の再生操作表示も確認する。
  `.artifacts/device-import-browser/results.json`。
- App buildと型検査成功。既存WASM/chunk-size等の警告あり。

## 未確認・復旧

実データ全件・全画面のimport/editor/媒体操作、実MP4 codec、実機、全容量での復元は
未確認。NativeとBrowserではraw Portable JSONの互換受付や対応ZIP codecが異なるため、
共通fixtureの成功を全ての外部データの完全互換とは扱わない。
対応外入力は原本を保ってエラーにし、自動でCloud/別Runtimeへ転送しない。
確定の失敗時は元データ・preview・原本を残し、既存のowner/revision/receipt手順で復旧する。
