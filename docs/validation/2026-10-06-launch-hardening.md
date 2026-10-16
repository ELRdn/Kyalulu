# 2026-10-06 ローンチ前の実装・独立レビュー

対象は無料Core/npmベータと任意SFWクラウドの初回公開。既存の未コミット変更を保持し、
クラウド・配布・Webの実装担当と、編集をしない独立レビュー担当を分離して確認した。
この記録のローカル試験・モック操作は、実機や一般公開の受け入れを代替しない。

## 修正と回帰確認

| 問題 | 修正・検証 |
|---|---|
| キャラ/プロンプト変更後も旧ソースの公開受け入れを再利用できる | `release_readiness.py` の指紋対象をキャラ、Persona、World、プロンプト、共有schema/UI、ビルド設定、同梱モデル例、配布スクリプトへ拡張。12種類の入力変更で旧証跡を拒否する試験を追加 |
| 対応ソースへ私的SQLite等を収集できる | 合成 `private.sqlite3` の混入を修正前に再現。DB/WAL、鍵、vault、env、重み、ログを除外し、symlink/作業領域外参照と同梱モデル例のAPIキーを拒否。回帰試験通過 |
| OpenRouterの品質試験に旧DeepInfra経路が残存 | InferenceNetのメタデータ/固定経路/予約単価へ更新。mock内のassertが生成失敗に変換されて偽陽性になる問題も、経路assertをmock外で実行し例外種別を確認することで修正。対象23試験通過 |
| 認証確認/更新中のログアウトでセッションが復活する | 更新を既存の有効セッションへの条件付きUPDATEに限定し、更新中の失効を拒否。同時refreshの一回実行とセッション寿命維持も確認 |
| 同期対象/トークン/接続先を変えて旧版番号を再利用する | トークン/選択範囲変更で基準版を失効。接続先変更や旧設定は同期オフ・トークン無効として再接続を要求。競合時にデータを送信しないことを確認 |
| 認証サービス障害時にlogoutが503となりsession/deviceが残る（独立レビューP2） | logoutを本人確認サービスに依存しないローカル失効へ変更。Origin検査は維持。障害中のlogout成功、復旧後の旧cookie/device401をHTTP試験で確認 |
| 所有者切替後の古い応答/401が新しいアカウントへ反映される | cloud epochを送信時とJSON読了後に照合。RuntimeGateのstatus順序制御は維持。GETは30秒で打ち切り、保存結果を曖昧にするmutationの強制打切りは追加しない |
| 新規保存の応答消失→再送で別IDが2件できる | 既存library_commitsとtransactionを再利用。POST/PUTへUUIDを渡し、同内容再送は保存済み結果、異なる内容は409。Webは下書きに保存UUIDを保持し、再読込/再試行でも維持、内容変更時に更新。Cloudでは所有者ロック内で再送判定し、安全検査/backup/同期版更新を再実行しない |
| 拒否応答/経路違反/切断時、応答にある既知請求実費が失われる | 正規化したusageと既知実費を失敗/中止経路まで保持。原価は運営費用に記録し、利用者の失敗消費は0。usage欠落は予約原価を維持し、不明/単発上限超過は要照合を記録して次送信を停止。財務境界47試験通過、実送信0 |
| CLIの再導入/更新/rollbackで不要な再取得や稼働喪失が起きる | 共通manifest検査、同SHA再利用、更新先検査完了まで現Runtime維持、rollback検査とatomic pointer、起動失敗時のowned child cleanup。17回帰チェック（7親/10子）とnative配布物の隔離検証を追加 |
| 第3レビュー：空UUIDで安全検査/backup後に422となるP2 | 保存routeはヘッダーの存在を確認し、空/不正UUIDと不正schemaをSFW前に検証。副作用なしで422を返す。追加のCloud回帰試験通過 |
| 第3レビュー：既存編集PUTの応答消失後に同内容を再送すると409になるP2 | Webにも編集の保存UUIDを持たせ、expected_revisionと本文を含む同要求の再送をbackendの既存冪等化へ接続する。実競合の409は維持 |
| 第3レビュー：owner切替中のプロフィール再読込後に古い競合エラーが新ownerへ残るP3 | 再読込await後にもepochを確認する。プロフィール本文の混入はなく、error/変更eventの混入を修正 |
| 第4レビュー：初回profile読込後にAの変更をBへ送信するP1 | initial readのawait後、PUT直前にもepochを照合。readの変更eventでownerが切り替わる回帰試験を追加し、GET1回/PUT0回とB側の空状態を確認 |
| 第4レビュー：完全なSFW応答を受信した後、client終了の中止/通信例外で既知実費が落ちるP1 | 終了処理より前にusageを解析し、中止/例外にも原価を引き継ぐ。第5独立レビューで20,000,000 nanoの保持・中止状態・利用者0・次送信停止を確認 |
| 第4レビュー：usage不明後の追加要求、単発上限超過後の次操作が止まらないP2 | 不確定後はmeter.beginで次callを拒否。operations.review_requiredを永続化し、再起動後も新規予約を止める。第5レビューで入力SFW＋生成1回のみ、実費1,003,001/debt0/要照合1・次送信停止を確認。既知原価と利用者失敗0を保ち、架空の負債額を作らない |
| 配布第6レビュー：renderer LICENSE収集だけsymlink拒否が抜けるP1 | metadata読取とLICENSE/NOTICE等copy前にもcheck_sourceを適用。platform-independentのLICENSE/package.jsonリンクfixtureで私的sentinel収集0を確認。実候補への混入は検出されていない |
| 配布第6レビュー：current pointerのrename失敗で旧Runtimeが停止したままになるP2 | 更新/rollbackとも選択書換え成功まで現Runtimeを停止しない。書込/renameのEACCES故障注入で現PID・データ・current/previous元バイト列の保持を確認。独立12条件が通過し、対象追加所見なし |
| 本人限定テストの予算設定が累計上限を超えられる | private test の累計予算を100,000,000ナノドル以下、既存原価を予算以下の整数へ制限。既存台帳・残高をリセットしない |
| 隠したElectron画面の初回証跡が描画前フレームになる | capturePage前に2フレームの描画待ちを追加。製品画面は後続の1440px証跡で正常表示を確認 |

## 再検証

- Python最終統合：`python -m pytest tests -q -p no:cacheprovider`、618 passed、78.99秒。
  初回は538件中2件が旧提供元fixtureで失敗。修正後に全体を再実行した。
  warningsはStarlette/httpx・WebSocketの非推奨と、意図した重複ZIP試験。
  `.artifacts/launch-20261006-final/python-tests-final.txt`。財務境界と第6レビューの収集修正後に再実行。
- 財務境界47試験、Cloud/backend保存再送＋catalog5試験、CLI17試験通過（7親/10子）。
  保存再送試験は並列4再送、異内容409、UUID422、PUT一回更新、owner分離、
  Cloudの安全検査/backup/同期版更新なし、再起動後の再送を含む。
- Node公式のportable 22.23.3を公式SHA256と照合し、CLI17試験を開発Windowsでも実行、全件通過。
  インストール/依存変更なし。`.artifacts/launch-20261006-final/launcher-node22-tests.txt`。
  クリーンWindowsの実機受け入れとは別の互換性確認。
- CharacterBench：専用ディレクトリで `python -m unittest discover -s tests -q`、136件通過。
  root直下のpytest収集とは別構成。
- Web最終統合：119試験、全workspace型チェック/ビルド通過。
- Chromium最終統合：認証の失効/復旧/下書き保持、プロフィールの2ブラウザ同期/409/owner切替、
  キャラ/プロット表示と不要な再保存防止、作成画面1440/390px×明暗4条件通過。
  作成チェックは応答消失・同UUID再送・再読込保持・内容変更時UUID更新を含む。
  `.artifacts/launch-20261006-reviewed-ui/`。実API/実推論0。
  第3レビュー後の作成チェックは編集PUTの応答消失→直接再送→再読込再送、
  本文/expected_revision変更後のUUID更新も含む。320mock要求/56mock保存、4条件合格。
- Electron最終統合：実画面9チェック、API/LE監督の単体4試験通過。推論要求0。
  `.artifacts/desktop-ui-47rDga/result.json`。2フレーム待機後の`home-light.png`は正常な
  ホーム/マスコット/操作欄を実画像で確認した。
- Remote：実ブラウザ→loopback Relay→Host→隔離Runtimeの9チェック通過。
  WASM/Python Noiseの鍵固定、改竄、再送、順序、切断、64MiBの相互運用も通過。
  Mockモデル・開発loopbackであり、実Android/TLS/外部セキュリティレビューではない。
- Docs：34ページ/16記事、36 sitemap URL、参照元/リンク/metadata/CSP/公開範囲確認通過。
- 変更したPythonのRuff F検査とCRLFを認識するGit whitespace検査通過。

配布第6レビュー後の最終指紋は
`ee48bf144f0681b8f0b4ab44dfde9bfea1f9b4a25fb9346b30d379c1f849c971`。
Python全体はcollector修正後に618件通過し、launcher修正は対象故障注入で検証した。
Web・Cloud実装は前段の統合検証後に変更なし。第6独立レビューでP1/P2の解消と
対象追加所見なしを確認。旧final/final2/final3はprovisionalとして保持する。

## 最終候補と公開前チェック

- Windows Runtime/npmの最終生成・native隔離検証：
  `.artifacts/launch-20261006-final4-packaging/REPORT.md` に候補、SHA、対応ソースの再build、
  隔離検証結果を集約した。device/license gateはfalseを維持する。
  起動/再起動/記憶と会話保持/backup/restore/rollback/更新失敗/引数失敗/外部process保護、
  起動失敗時のowned child cleanupが通過。snapshotの再build Webとnative同梱Web全SHA一致。
  依存/lockfile変更0、秘密ファイル名・高信頼credentialパターン0、owned Runtime停止済み。
  開発Windows/Node26.5.1でPATH/ユーザーデータを隔離した確認。cleanWindows/
  Mac/公開初回download/実モデルは未受け入れ。
  同じ候補を親がNode22.23.3でも隔離確認し、全項目と書込/rename故障7条件を通過。
  `.artifacts/launch-20261006-final/node22-packaged-summary.json` にSHAと終了確認を保存。
  親の読取監査でも配布材料21個のSHAと現在のソース入力331件が一致。
  `carry-kit.zip` はNode22/Windows11/SHA検査runnerと候補を含む未公開Mock確認用一式。
- Cloud候補：`.artifacts/launch-20261006-final/cloud-final4/kyalulu-cloud.tar.gz`。
  SHA256と照合結果は同じディレクトリの`audit.json`。
  173members、172SHA照合、対応ソース835files、秘密ファイル/リンク0。
  収集直後のworkspaceとの差0を確認。実装を本番へ配布したことを意味しない。
- 公開判定：`.artifacts/launch-20261006-final/preflight.json`。
  local_betaはWindows/Mac/license/npm権限、cloud_first_tenは本人認証/同期/モデル/Android/
  24時間運用と復旧/法務/license/OpenRouter条件が未承認。
  `evidence-template.json` は全項目accepted=falseで保存。
- Android/クリーンWindowsは帰宅後に利用可能。Macは未提供。
  [実施手順](2026-10-06-device-acceptance.md)を用意した。

## 本番の読み取り確認

2026-10-06、TLS検証を維持した直接HTTPSでCloud health/statusが200、
`private_test=true`、`login_available=true`、匿名catalogが401。Relay healthも200。
本人の再ログイン、保存、会話、使用量精算を今回新しく受け入れたという意味ではない。
継承プロキシ付きhttpxは接続失敗だったため、`trust_env=False`とPowerShell HTTPSでも照合した。

## 公開前に残る受け入れ

本人の実Google操作、端末間保存、独自SMTP実配信、実請求と台帳の照合、人手品質、
Android実機、クリーンWindows/macOS、24時間の対象VPS運用、別ホストでの災害復旧、
公開用法務/保持・処理先条件。画像保存/同期は判定精度と費用の受け入れまで無効。
10人受付と100人への拡張を分離し、72時間観測は100人の前に要求する。

販売・広告の有効化、実推論/有料安全検査、npm公開、deploy、告知、commit/pushは行っていない。
公開前チェックは不足証拠を残したまま判定し、当日の開発試験をreal acceptanceへ格上げしない。
