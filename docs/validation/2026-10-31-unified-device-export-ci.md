# Device export Windows CI timeout: independent investigation

2026-10-31 JST。対象は `D:/VibeCoding/my zeta`、開始時HEADは
`f9c8d2c3950ccace1ce8aa5c132d465a59ab9a18`。親の変更を含むworking treeの検証であり、
cleanなf9c8d2cや失敗時の21ba2faを検証した主張ではない。

## 結論と元ログの限界

- run `41201824553` / 旧 `21ba2fa` push / Windowsの提供ログは、
  `tests/e2e_device_export.py:37` の `__EXPORT_RESULT__` 待機が60000msで失敗したことだけを示す。
  setup/reload、scenario、console、pageerror、未完了要求の記録はない。
- 実fixtureは `tests/fixtures/device-export.html`。変更前のローカル実Chromiumで
  setup/reloadとも成功し、変更後の最終検証も両方成功した。CI原因の再現には至っていない。
- 通常のfixture内check例外は末尾catchで失敗resultを公開する。一方、module初期化失敗や
  未解決awaitはresultを公開しないことがある。後述のmodule 404注入では同じ60秒待機失敗を
  再現できたが、**元CIがmodule 404だったという証拠ではない**。
- `appTransaction` の完了は `tx.oncomplete`、失敗は `tx.onabort` でsettleし、
  quota注入の復元もdeviceFetch完了後に行う現状を読んだ。同期境界を変更すべきfixture raceを
  決定的に示す証拠は得ていない。製品や同期境界の修正は行っていない。
- 親からの最新CI報告は以下。workerによるGitHub再照会ではなく、ローカル結果とも区別する。
  - 同じ旧21ba2faのPR `41201829897` は両OS成功。
  - 旧21ba2faのpush `41201824553` のWindows export timeoutは独立した失敗として残る。
  - f9c8d2cのPRはUbuntu成功、Windowsはbenchmarksへ進みexport通過。
  これらの成功や今回のローカルPASSから、旧push失敗の原因・恒久的な製品不良を推定しない。
  job取消・再実行は行っていない。

提供ログ: `.artifacts/ci-21ba2fa-push-windows-failed.log`
SHA-256: `ebd78ba47e569ab9dd20c397da3cc4e615ea63fbb48d6bdd545f3d669cba18c2`。

## 変更範囲

- `tests/e2e_device_export.py`: setup/reload、console/pageerror、HTTP失敗・requestfailed、
  navigation前のinit marker、停止時snapshotとtracebackを記録する。snapshotだけは5秒で諦め、
  元の例外を隠さない。export待機は元の60000msのまま。
- `tests/fixtures/device-export.html`: moduleより先の `html-loaded` marker、scenario名、
  pending deviceFetchのpath/methodと最後のstatusを追加。bodyや認証情報は収集しない。
- 本文書。製品、共有helper、workflow、依存関係、lockfileはこのworkerでは変更していない。

元の形式・入力・Promise.allの同時実行・assert/check・quota注入と復元・negative controlは維持。
失敗を通すretryやtimeout増加はない。呼出元workflowは同じコマンドで動く。
出力は上書き防止のため `.artifacts/device-export-browser/run-*/` へ保存し、冒頭と末尾に
実際のpathをprintする。従来のroot直下results.jsonは新しい検証結果として参照しないこと。

## 実ブラウザー証拠

親のsource freeze確認後、2026-10-31 23:15 JSTに通常exportを1回実行した。
最終通常run: `.artifacts/device-export-browser/run-bnt41uay/`
freeze検証bundle: `.artifacts/device-export-browser/frozen-proof-xwd8oif9/`

| 証拠 | 内容 |
| --- | --- |
| `results.json` | setup + reload、各6形式。原本64 bytes、foreign read拒否3件/phase |
| `setup-assets.charx`, `reload-assets.charx` | 各2385 bytes。Python readerで全ファイル内容を照合し、Native importerで画像・音声バイトも照合 |
| `diagnostics.json` | init、完了scenario、pending空、ブラウザー情報、読込入力58件の前後SHA-256、context/browser close |
| `events.jsonl`, `vite.log` | 全console/scenarioイベントと所有Viteの完全ログ。pageerror/HTTP失敗/requestfailed/外部通信試行なし |
| freeze bundleの `proof.json` | 全条件のassert検証。64入力の前後一致、読込入力の事前manifestへの全件包含、所有port 51152のOS TCP表にLISTENなし、全raw/result/diagnostic/CHARXのSHA-256 |
| freeze bundleの `before-inputs.json`, `after-inputs.json` | 実行開始前と終了後に採った64件の入力SHA-256。新しい読込入力の漏れも0件 |

完全stdout/stderr: freeze bundleの `stdout-stderr.raw.log`。run自体の完全diagnostics.json、
events.jsonl、results.json、vite.log、setup/reload CHARXもすべて別途保持した。
freeze前の `run-11p77bl0/`、`final-export.log`、`final-evidence-check.log` とその証拠は
上書きしていない。今回の最終freeze後の結果には上記の新しいpathを使用する。
既存Python 3.13.5、既存Playwright Chromium `151.0.7922.34` を使用。
OS TCP表の事後確認にはインストール済みpsutil 7.2.2を使用したが、runnerの新規依存にはしていない。
元のsource duplicate明示選択、出典改ざん拒否、rating 400/403、owner隔離、同時replay、
revision競合、quota rollback、履歴ID、未送信データ、旧版exportの条件も通過した。

## 診断自体のnegative control

所有contextのHTML応答だけをroute.fulfillで差し替え、disk上のfixture・製品は変更していない。
以下の3ブラウザー実行は意図した失敗をそのままraiseし、resultsは空、diagnostics.okはfalse。

| 注入 | 記録と証拠directory |
| --- | --- |
| `stage('source-rating-controls')` 直後に例外 | scenario、失敗result、stack。`selfcheck-scenario-failure/run-pbamydut/` |
| deviceApiのimportを存在しないmoduleへ変更 | init.ready=true、html-loaded、HTTP 404、console error、requestfailed、元の60000ms TimeoutError。`selfcheck-module-init/run-hr83bmcd/` |
| module前のclassic scriptで例外 + scenario例外 | early pageerrorとscenario失敗の両方。`selfcheck-pageerror/run-v0gcmg0f/` |

上表は `.artifacts/device-export-browser/` 配下。各directoryにresults.json、diagnostics.json、
events.jsonl、vite.logを保持。全3件のcontext/browser終了、所有portのLISTENなしも確認した。
構造化検証結果は `diagnostic-selfcheck-results.json`、最終assert成功ログは
`diagnostic-selfcheck-final.log`。

最初の検証用assertには「module 404でpageerrorも出る」「undefinedのresultキーは消える」
という誤った期待があり、console/requestfailedおよびPlaywrightのnull表現に合わせて訂正した。
またWindowsのconnect_ex結果10035は停止証拠とせず、OSのLISTEN表で確認した。
失敗した検証用assertのログも `diagnostic-selfcheck.log`、
`diagnostic-pageerror-selfcheck.log`、`diagnostic-selfcheck-verified.log` として保持している。
module 404のブラウザー試行は再実行せず、取得済みの完全証拠を正しいassertで検証した。

## source freezeと再実行

runnerは読込HTTP sourceと明示入力のハッシュを採り、最後に変化があれば成功扱いせず非zero終了。
freeze後の検証では、既に観測した実exportの読込graph58件を実行開始前にハッシュ化し、
実際にimportしたrepo内Python 6件も加えた64件の前後manifestを別途保存した。
今回の読込58件が事前manifestに全件含まれ、そのhashとも一致し、64件すべてが終了後も一致した。
Python 6件は `runtime/python/core/__init__.py`、`portable_binary.py`、`portable_export.py`、
`portable_formats.py`、`portable_schema.py` と `scripts/build_device_export_fixture.py`。
読込graphに加える明示入力はrunner、browser_fixture_server、Vite config、pnpm-lock、export JSON。
whole repo、他workerのfixture、新規の独立source collectorはfingerprint対象にしていない。
実exportが新しい依存を読み込んだ場合は、事前manifestへの包含checkが失敗する。
新しい `appSyncBranch.ts` もimport graphに入り、ハッシュ対象に含まれる。pinや除外はしていない。
exportはbranch ACKを実行しないため、このPASSを新ACK動作の証明には使わない。
未importのPython module全体・全installed moduleを固定したmanifestではない。

製品sourceのfreezeを確認後、上記の最終検証を行った。153 unit + typecheck成功は
別の検証記録であり、このexport証明とは別。export実装を含め製品は変更していない。
これはfreezeを確認したworking treeのexport証拠であり、旧21ba2faの再現や全体統合受理ではない。
親がdefect対応などで対象を変更した場合はこのrunを新sourceの証拠として流用せず、
新たなfreeze後に次を1回実行する。

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\hiron\AppData\Local\ms-playwright'
.venv/Scripts/python.exe -B -u tests/e2e_device_export.py
```

制限実行ではPythonのasyncio生成がsocketpairのacceptで停止したため、所有loopbackと
既存Chromiumの実行を制限外で行った。これはmain進入前のローカル環境現象で、
元CIのpage.wait_for_function失敗とは区別する。停止した自分の試行だけを終了した。
実機・全CI・全容量・本番・provider・Guilduoの検証はしていない。Gitの書込操作やcommitもない。
