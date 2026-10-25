# Device BenchmarkLabのジョブ制御と回復

## 変更

- Deviceから共通の長ターン比較画面を開ける。管理権限を持たないRemote/Cloudの経路は維持する。
  初期選択は準備済みモデルから選び、未準備モデルを選択して送信しない。
  アカウント変更は画面を破棄し、古い結果・入力・poll応答を別アカウントへ渡さない。
- `BenchmarkRequestSchema` で既存Nativeと同じモデル/シナリオ数、反復、記憶検索、履歴条件、
  期限、UUID要求IDを検証する。Deviceのseedは適用可能なunsigned 32-bit範囲に限る。
  モデルによってseed未対応になる場合は既存samplingのunsupported記録を維持する。
- 最大3モデル・12シナリオ・3回の行列を、既存研究の `runOne` と生成処理で逐次実行する。
  記憶オフ/オンは奇数回でoff→on、偶数回でon→off。対応する腕に同じseedを使い、反復ごとに1増やす。
  記憶・状態・出典は実験ごとに分離。履歴ターン数を制限してもmessage番号は再利用しない。
- 新規要求は保存後に202で返す。同じID・同じ条件は保存済みジョブを返し、再生成しない。
  条件が異なる再送、並行開始、未知のモデル/シナリオ、未準備モデルは拒否する。
- 所有者と実行の排他は通常研究と同じWeb Lock・生成中状態を使う。
  ジョブは通常会話entitiesと別のowner別metaに保存し、会話同期へ流さない。
  実験にはjob IDを記録し、各ターンの確定結果とジョブ進捗を保持する。
- 中止要求はtransactionで保存し、同じoriginの別タブからはBroadcastChannelで実行元へ通知する。
  進捗保存も要求を引き継ぎ、停止要求を上書きしない。応答待ちは「停止要求中」と表示する。
  別タブのlive lockがあるジョブを、読込時に中断へ書き換えない。
- 実行元のタブ内で別画面に移動しても続く。文書の再読込・終了では実行を継続できないため、
  次回読込で残ったジョブ/実験をinterruptedとして照合する。勝手に再開/再送しない。
  アカウント変更は実行を停止し、元ownerの未確定記録を保持する。
- 読込中と生成中の期限を検証。モデル読込が中断/失敗した場合はWorkerをresetし、
  読込済みモデルの表示キャッシュも無効化する。
  タイマーがバックグラウンドで遅れても、壁時計の期限を確定前に再確認し、遅れた出力を保存しない。
- 成功・中止・失敗・期限超過は区別し、途中の実験もジョブの書き出しに含める。
  ジョブcheckpointだけが一時的に保存失敗しても、確定済みの発話を失わず、部分実験の状態を照合する。
  容量不足で保存を続けられない場合は最後の確定checkpointを残す。回復書込みは容量回復後に行う。
- JSON書き出しは共通RuntimeDownloadを使い、内部revisionを渡さず `benchmark.json` として保存する。
  キーワード診断と人手評価、Mockとモデル品質の区別は維持する。

## 検証

- `deviceResearch.test.ts`: 23 passed（従来の通常研究10件と今回のジョブ13件）。
  ペア順序/seed/予定件数/履歴・記憶条件、架空3モデルの独立領域、受領再送、UUIDの大小文字、
  並行拒否、所有者別の中止/読込/書き出し、失敗した行列の停止、読込/生成中の期限、
  遅れたタイマー、アカウント変更、容量不足、一時的checkpoint失敗、100ターンと出典番号を確認。
  storage fixtureはtransactionを直列化し、読み取った値と書き込む値をcloneして実IDBの分離に合わせる。
- `BenchmarkLab.test.tsx`: 6 passed。
  日英の条件・状態・原文、同じrequest IDでの再試行、進行中の開始拒否、明示中止に加え、
  Deviceの文書寿命説明、準備状態、停止要求を完了と混同しない表示を確認。
- 最終フロント全体: 690 passed / 52 files。workspaceのWeb/Desktop/schemas/UI/launcher型検査成功。
- Python共通fixture: 2 passed。
  Native `BenchmarkRequest`/`prepare_job` が作る条件・予定件数・ペア順序をDeviceと照合。
  既存の評価値/probe/端数処理、16シナリオのNative一致も同じfixtureで継続確認する。
- 実Chromiumの日本語393px/light・英語1280px/dark: 2条件成功。
  実App、RuntimeGate、共通API、IndexedDB、Web Locks、BroadcastChannelを使用。
  OPFS準備情報とWorkerの推論応答だけを架空にし、モデルの取得/実推論は行わない。
  各条件で32ターン（2回×off/on）の比較、GUI条件、JSONダウンロード、Native metadata検証、
  画面移動中の継続、別タブからの中止、再読込後の中断/結果保持、アカウント分離を確認。
  英語条件では応答しないモデル読込の10秒期限とWorker reset、さらに100ターンの保存/出典を確認。
  研究entitiesは0件、外部/APIネットワーク要求とpageerrorは0、横方向のはみ出しなし。
- 通常研究の実ブラウザ2条件も再実行して成功。Native読込はdriver自身が `runtime/` をsys.pathへ加える。
  `python -E` で環境変数に依存しない起動も確認した。
- 証拠: `.artifacts/device-benchmarks-browser/results.json`、2枚のPNG、日英のbenchmark JSON。
  Native契約検証は書き出しの形式検証であり、Nativeで同じモデルを実行した証拠ではない。
- 最初の100ターン単体試験はVitestの既定5秒枠を超えた。
  storage mockの不要な全DB cloneを除き、値の分離を維持したうえで、このstress caseだけ20秒枠を指定した。
  製品の期限や100ターン要件を減らしていない。実ブラウザの同じ100ターンは完走している。

## CIと残件

`fefbaa0` のWindows/Linux CIは通常研究のdriver段階で失敗した。Ubuntuのlog (`40222319789`, job `121256362278`) は
`tests/e2e_device_research.py` の `ModuleNotFoundError: python` で試験開始前に停止した。
今回、通常研究/BenchmarkLabの両driverに読込パスを明示した。最新commitのCIとは区別して追跡する。

実モデルの品質・速度、Android/iPhoneの20ターン/ロック復帰/回線切替、OS IME、
多数/大容量ジョブの性能、配布build、本番反映はこのfixtureでは受け入れない。
未契約の決済・広告・年齢確認とCore全体復元の承認待ちは別件として維持する。
