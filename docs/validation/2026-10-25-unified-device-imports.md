# 端末内のbinary import・媒体保存と再生の限定検証

対象はBrowser RuntimeのJSON／PNG／CHARX／Kyalulu backup取込み、所有者別の媒体API、
既存PortableMediaからの明示的な再生取得。外部AI・広告・決済・本番DBは使っていない。

## 実装

- Nativeが生成・解析した34入力を固定し、文書・出典・notices・媒体bytesをBrowserで照合。
  Kyalulu profile、未知項目、Risu静的変数、非実行scripts/HTML、Lore条件、圧縮iTXt、
  DEFLATE、CP437、directory数と実ファイル数の違いを含む。
- 32MiB入力／単一展開、128MiB総展開、512ファイル、PNG CRC、ZIP CRC・local header・
  traversal・duplicate・symlink・overlapを検査。ZIPはSTORE／DEFLATEに対応する。
  ZIP64、BZIP2、LZMAは今回のBrowser対応範囲外。
- previewと取得媒体を同じIDB transactionで保存し、確定時には参照媒体のowner・hash・
  MIMEと音声/動画の権利確認を照合。カード取込みから権利確認を引き継がない。
  Library/履歴/原本/receiptの確定は既存のatomic commitを使う。
- PNG/JPEG/GIF/WebPはdecode前にpixel上限を確認し、ブラウザdecoderで実decodeする。
  NativeもPillow verify後のloadを追加し、CRC正常でもIDATが壊れた画像を拒否する。
  WAVはPCM構造、MP4はcontainer/外部参照を検査する。MP4 codecは再生時にブラウザが判定する。
- 媒体取得は全会話一覧を読み込まずowner別に行う。音声/動画は操作後にapiFetchで取得し、
  account/target/connection/epoch変更後の結果を破棄。切替時にはplayerを作り直しBlobを解放する。
  再生UIは日英表示、自動再生なし。媒体生成は未対応のまま。
- CIで失敗したNative export検証のimport pathを、起動場所から独立したruntime pathへ修正。

## 証拠

- frontend全体: **553 passed / 44 files**。
- Native import/media/Portable/promptの対象集合: **101 passed**。
  `.artifacts/device-import-native-1.xml`。既存duplicate ZIP warningとsandbox cache warningあり。
- 30個のBrowser exportを独立したNative JSON/PNG/ZIP parserで再取込み。
- 実Chromium import fixture: **setup/reload 2段階**。各段階で34入力の文書/媒体照合と
  11媒体の実validation。PNG/JPEG/GIF/WebPの実decoder、WAVのduration/readyState、
  自動再生なし、切替時のplayer解除と旧Blob URL失効、他ownerの取得拒否を確認。
  初回はbinary preview/commit・権利未確認拒否・偽MIME upload・quota rollbackも確認。
  `.artifacts/device-import-browser/results.json`。
- 既存実Chromium export fixtureもsetup/reloadとも成功。原本、固定版、再送、編集競合、
  quota rollback、未送信保持、Native媒体再取込みの回帰確認。
  `.artifacts/device-export-browser/results.json`。
- frontend型検査とunified App build成功。既存WASM外部化/大きなchunk等の警告あり。

再現は `scripts/build_device_import_fixture.py`、
`tests/test_device_import_fixture.py`、`apps/web/src/lib/deviceParseImport.test.ts`、
`tests/e2e_device_import.py` を使う。NodeのImageBitmap mockはparser照合用であり、
画像decode成功の証拠はChromium/Pillowによる上記検証に限る。

## 残件と復旧

ST preset/WorldInfo、BYAF、Character.AI text等の他入力形式、全画面のupload操作・IME、
実MP4 codec・実機・実容量・旧DB復元は未確認。今回のfixtureは完成した配布物や全機能の
同等性を証明しない。原本とpreview/媒体の保存容量・保持期間は全体容量試験で確認する。
失敗時は元Library/未同期編集/原本を残し、同じownerで再試行する。旧DBやreceiptを削除して
回避しない。全体計画・本番反映は `UNIFIED_DELIVERY.md` で追跡を続ける。
