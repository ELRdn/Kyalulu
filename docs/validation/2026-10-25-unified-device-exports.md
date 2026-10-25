# 端末内Libraryの形式別書き出し・原本・取込みtransaction

2026-10-25 JST。架空の文書・アカウントと隔離保存領域のみ。
本番データ、実Relay、外部提供元、モデル生成、決済・広告は使用していない。

## 実装

- Browser Libraryの`export`が`format`・`revision`・`download`を扱う。CCv2/CCv3のJSON/PNG、
  CHARX、Kyaluluバックアップを、既存Python `portable_export.py`の内容・欠落通知に合わせる。
  プレビューはfilename/media_type/bytes/notices、downloadは実バイナリを返す。
  保存済みの旧版を選んだ場合に現在版へ差し替えない。
- Portable schema、SHA-256実装、共通Runtime通信と書き出し部品を再利用する。外部依存は追加しない。
  PNGはCRC/長さ/chunk数を確認し、既存カード情報だけを入れ替える。ZIPは標準STORE方式で
  出力し、NativeのZIP readerで検証する。圧縮・整形・コンテナのバイト一致は保証しない。
  ファイル数・サイズの制限を持ち、欠落した媒体を黙って捨てない。
- 媒体は選択文書が参照するowner領域から読み、SHA-256を確認する。URIは書き換えるが
  外部の画像・音声・動画を取得しない。音声などを含むCHARX/バックアップのファイル内容も照合する。
- 現在のJSON取込みで元ファイルのバイト列・filename・hashを保持する。編集後も`original`
  書き出しは元バイト列を返す。破損時は拒否し、別ownerの領域へ探しに行かない。
  ファイル名はRFC5987で返す。旧取込みに失われた原本を推測で作らない。
- JSON取込みの作品、原本、選択会話履歴、数値ID sequence、受領は同一IndexedDB transaction。
  source/format/noticesと履歴はプレビューから引き継ぎ、クライアントによる出典の上書きを防ぐ。
  既存作品の更新はrevision照合、同じ要求の再送はcanonical fingerprint照合。
  同時実行・途中の容量不足でも部分的な作品や受領を残さず、既存の未送信データを保持する。
  取込み履歴はUUIDと独立した数値ID、原本/履歴index/元messageを保持する。
  入力messageが原本ID・履歴index・`format:unified`を名乗っても、保存する出典を上書きしない。
  元の入力は原本から復元できる。export/revisionsのGET以外やcommitのPOST以外で作品を変更しない。
  元データにない過去の記憶・生成snapshotは作らない。
- 受領は従来の`items`/`sessions`を維持し、`request_fingerprint`を追加する。
  元のreceiptをwrapperに置換しない。IDB schemaは2のままで、既存DBを消去・移し替えない。
- Native側も既存WAV/MP4検証を使い、宣言用途と一致するカード内媒体を取込む。
  CCv3 JSON/PNG/CHARXからの音声・動画は権利確認をfalseにして返し、Library保存時に
  実際の保存媒体のMIMEと本人の確認を検証する。編集画面から確認できる。
  既存バックアップで保持された確認状態と原本は維持する。
- 端末内Runtimeの画像も共通API経路を使い、文書中の外部URL/srcSetを自動取得しない。
  owner/実行先変更後の古いBlobを表示せず、同梱マスコットは表示する。

## 証拠

- フロント全体 **512 passed / 43 files**、workspace型検査成功。
- Python関連 **112 passed**。Portable API/formats/fidelity/runtime、媒体、共通fixture、
  統合Runtime bridge/history snapshotsを確認。ZIP重複名を拒否する試験の警告が1件ある。
- `tests/fixtures/device-exports.json`は5文書×6形式。
  未知項目、定義・話し方・Profile・Lore、履歴の欠落通知、PNGとWAV、外部参照、
  日本語と補助平面Unicodeを含む。Native exportがこのfixtureから逸脱しない試験と、
  Browser実装がこの内容を作る試験の両方を持つ。
- **30 Browser出力**をPythonの標準JSON/ZIP/PNG readerで再検証し、Native importerで読む。
  カード内容、PNG内textと画像chunk、ZIP内の文書・媒体バイト列を比較する。
  生成済みファイルがない場合は検証scriptが失敗する。存在しない証拠をskipで合格にしない。
- **実Chromium 2段階（setup/reload）成功**。本物のIndexedDB・File/FormData・Responseで
  6形式、保存版、原本64bytes、日本語/引用符入りfilename、履歴、未送信データを確認。
  同じrequestの同時送信が1回にまとまり、同版への更新は200/409に分かれる。
  実IDBのputへQuotaExceededErrorを注入し、作品・原本・受領のrollbackと再試行を確認。
  owner変更後の3取得は404。外部/実APIへの通信試行は両段階0。
  本物のIDBから出力した画像・音声入りCHARXもPythonで取込み、媒体バイト列を照合する。
- 共有したloopback Vite起動helperへの変更に対し、既存outbox実Chromium **5ケース**も再実行成功。
  helperは生成したprocessのみ停止し、利用者の既存ブラウザやサーバーに触らない。
- 統合App・Desktopビルド成功。既存の非module script/WASM externalization/chunk-size警告あり。
  前head `ee85ed5`のWindows/Linux CI成功を確認したが、この追加のCI結果とは区別する。

```powershell
pnpm --filter web test -- --pool threads --maxWorkers 1
.venv/Scripts/python.exe scripts/verify_device_exports.py
.venv/Scripts/python.exe -m pytest tests/test_device_export_fixture.py tests/test_media_parity.py tests/test_portable_api.py tests/test_portable_formats.py tests/test_portable_fidelity.py tests/test_portable_runtime.py tests/test_unified_runtime_bridge.py tests/test_unified_history_snapshots.py -q --tb=short --basetemp=.artifacts/device-export-native-provenance -o cache_dir=.artifacts/unified-pytest-cache --junitxml=.artifacts/device-export-native-provenance/results.xml
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\hiron\AppData\Local\ms-playwright'
.venv/Scripts/python.exe tests/e2e_device_export.py
.venv/Scripts/python.exe tests/e2e_outbox_guard.py
pnpm typecheck
pnpm --filter web build:app
pnpm --filter desktop build
```

Browser出力は`.artifacts/device-exports/`、実IDB証拠とCHARXは
`.artifacts/device-export-browser/`、Python結果は上記basetempの`results.xml`。
fixture再生成は`scripts/build_device_export_fixture.py`で行い、変更を差分確認する。
CIはfrontend試験後のNative出力検証と、Playwright導入後の実IDB検証を行う。

## 復旧と未完了範囲

- 書込み失敗後も元Library、未送信会話、preview、元端末の原本を残し、同じownerで再試行する。
  同じrequest IDに別の内容を割り当てない。旧clientが作ったfingerprintなしの受領は保存したまま
  409にする。Libraryで既存の保存結果を確認してから新しい操作を始め、DBやreceiptを消して
  強制再送しない。旧schema-1 clientへの復帰制限は既存の復旧手順を維持する。
- BrowserのPNG/CHARX/ZIP等の**取込みparser全体**、媒体upload・再生UI、全ての既存
  import/context/summary形式はまだNativeと同等ではない。今回のBrowser媒体fixtureは
  owner領域へ架空媒体を保存してexportを確認したもので、完成したupload画面の証拠ではない。
- 実機のファイル保存、OS保存ダイアログ、全体UI/IME、実モデル、実容量の上限・旧復元を
  確認した証拠ではない。原本の追加保持に伴う容量・清掃方針も全体容量試験で確認する。
  全統合計画・本番反映の完了条件は引き続き`UNIFIED_DELIVERY.md`で追跡する。
