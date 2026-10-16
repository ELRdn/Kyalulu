# Cloud送信確認UIの改善 — 2026-10-12

## 実装

既存Dialogを再利用し、送信確認を会話本文から独立したモーダルに変更。
モデル・提供元、利用上限、精算説明、安全検査先、送信する情報を常時表示する。
提供元の保存・学習条件とBaiduの明示同意も常時表示し、技術的なモデルID・推論設定・料金内訳は初期閉の詳細へまとめた。
送信ごとの未チェック、期限切れの送信禁止、取消と下書き保持は既存契約を維持。
本文だけスクロールし、操作ボタンは固定。スマートフォンは下側、PCは中央に表示する。
送信中の重複する復旧案内は非表示とし、保存エラーは表示を維持。待ち時間内訳は診断表示時に限定した。
320pxでComposerの非表示ヒントが幅を占有する問題も修正した。

変更対象：CloudQuoteConfirmation.tsx、cloudQuoteConfirmation.css、ActiveChat.tsx、ui/ui.css、
cloudModelUI.test.tsx、scripts/verify_cloud_ui.py。Backend・課金・生成APIは今回変更なし。

## 検証

- Web 24ファイル・227試験成功、全workspace型検査とWeb build成功。
- Mock Chromium 28画面条件成功。見積確認は320／390／1440px、390×600、light／dark、詳細閉／開で確認。
- 未同意の送信禁止、毎回の同意reset、Escape／取消、下書き保持、ボタンのviewport内位置とhit判定、native modalの背面focus遮断を確認。
- 有限アニメーションを完了させたスクリーンショットを視認。外部／有料推論0、生成APIへの送信0。
- 長い画面試験中の生成結果GETは、送信前の実APIと同じ404としてmock。未mock／外部要求0、pageerror0。
- 一時HTTPサーバー停止・Chromium切断を確認。例外時も所有ブラウザーを閉じる。
- 独立レビューで指摘された送信範囲の常時表示を修正し、再レビューで追加P1／P2なし。
- git diff --check成功。Git commit／push／本番変更なし。

証跡：`.artifacts/cloud-quote-ui-20261012/ui/{acceptance.json,REPORT.md,*.png}`。
単体・型・buildログ：`.artifacts/cloud-models-20261011/quote-ui-{tests,typecheck,build}.log`。

## 配布候補

`.artifacts/cloud-quote-ui-20261012/cloud-release/kyalulu-cloud.tar.gz`

SHA256：`c60dd4429fd813c0f9235e3cbc6a56ad785201abf4d65af53ae57264716029ae`

ソース指紋：`41941399344145033ba3c20602ffd5a424aba6ca31e2114bcaa704a6b622c9ab`

manifest180件、Runtime100件、Web57件、対応source372件を照合。
同梱ソースとworkspace、Webと検証済みdistの内容一致、manifestの網羅・SHA、秘密・DB・モデル重量の除外を確認。
監査結果：`.artifacts/cloud-quote-ui-20261012/package-acceptance.json`。
モデル／onboarding／parityのCloud候補とWindows／npm候補は今回UI修正前。

## 未確認

本番未反映。Android実機、日本語IME実機、実OAuth、実Provider生成は今回未実施。
累計API実費上限$0.10を維持し、現在残額は未照合。今回有料送信0。
本番更新は別途承認と現台帳・backup・rollback照合後の受け入れが必要。
