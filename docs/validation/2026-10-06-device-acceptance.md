# 2026-10-06 帰宅後の実機受け入れ

Android実機とクリーンWindowsはひろなおが帰宅後に使用可能。Macは未提供。
ここは実施手順であり、成功記録ではない。候補とSHAは
[実装・検証記録](2026-10-06-launch-hardening.md) の最終候補を使う。
本番Cloudは10月5日のリリースで、今回の修正はまだ配布していない。

## Androidと本人のクラウド

1. Chromeで <https://cloud.kyalulu.com> を開き、本人のGoogleアカウントでログイン。
   販売・広告・画像保存/同期が無効で、ローカルCoreの自動転送がオフの状態を確認。
2. SFWの短いプロットを1件作成する。日本語IMEの変換確定で勝手に送信されないこと、
   キーボード表示時も保存操作へ到達できることを確認。
3. 保存して再読込し、タイトル・イントロ・本文・版が保持されることを確認。
   保存結果が不明なら内容を変えずに再試行し、ライブラリに同じ項目が増えないことを確認。
   この再送修正の確認には今回の候補の配布が必要。
4. 別の本人端末で表示名・保存キャラ・ピン留めを確認。競合が出た場合は再読込し、
   新しい保存内容が古い端末から上書きされないことを確認。
5. 画面ロック→復帰、Wi-Fi→モバイル回線、切断→再接続を確認。未送信の入力と
   下書きが残り、失効後はログインし直せることを確認。PWA追加後も同じ操作を確認。
6. 会話は台帳の実費・未確定予約を照合してから最小の1往復で確認。
   送信前表示・成功精算・失敗0消費・履歴再取得の二重課金なしを照合し、返答原文を人が読む。
   安全検査にもAPI原価がある。累計$0.10、既存49,548,721ナノドルを引き継ぐ。
   同時に別の検証送信を走らせず、不明な費用があれば追加送信を止める。
   原価不明/単発上限超過で `operations.review_required=1` が立った場合は、
   再起動後も運営の新規送信を停止する。invoiceと台帳を照合するまで解除しない。
   予約・既知原価・利用者残高を消去してテスト予算を復活させない。
7. ログアウト後に端末内で前の本人の内容を操作できず、再ログインで本人の保存内容が
   戻ることを確認。秘密cookie/token・本人UUID・会話本文は公開証跡へ載せない。

## クリーンWindows

Windows 11 x64とNode 22の環境へ、候補Runtime・manifest・npm tarballを転送する。
Git/Python/pnpm/開発checkoutへの依存なしで実行する。公開前の候補では、
公開npm/GitHubからの初回ダウンロードは未受け入れのまま。

持込み用一式は `.artifacts/launch-20261006-final4-packaging/carry-kit.zip`。
同じフォルダーの `SHA256SUMS.txt` を別経路で保存して照合し、展開した
`README.md` と `run-clean-windows.ps1` に従う。Node 22とWindows 11を確認し、
ネット切断・APIキーなしでMock検証できる。これは実モデル確認の代わりにはしない。

1. 転送した全候補のSHA256を照合する。`Get-FileHash -Algorithm SHA256 <ファイル>`。
2. 実際のnpm tarball内のCLIで、起動→停止→再起動→記憶/会話保持、
   backup→restore、更新失敗時の現Runtime維持、rollback、外部process保護を確認。
   既存 `scripts/verify_npm_beta.mjs` の隔離チェックを再利用できる。
3. ブラウザで日本語入力、プロット作成、保存、Memory Lab、再起動後の読み込みを確認。
4. 本人が選んだ実ローカルモデルを接続し、クラウドログイン・K-Creditsなしで
   1往復と記憶を確認。重みの自動ダウンロードやCloud API送信を代わりに実行しない。
5. Nodeの版、OS/CPU、候補SHA、開始/終了日時、失敗と修正後の結果を記録する。
   自動Mockチェックのみでは実モデル・クリーンOS全体の受け入れにならない。

## 証拠登録と残る公開条件

`.artifacts/launch-20261006-final/evidence-template.json` は未承認の雛形。
実施した試験の私的内容を除いた記録をworkspace内へ保存し、そのSHA256と
対象ソース指紋を登録する。各gateの全要件が満たされるまで `accepted=false` を維持する。
Android/Windowsの一部成功だけでSMTP、実請求、Mac、24時間運用、別ホスト復元、
ライセンス/法務・処理先条件を承認しない。

```powershell
.venv\Scripts\python.exe scripts/check_launch_readiness.py --backend openrouter --phase local_beta --evidence .artifacts/launch-20261006-final/evidence-template.json
.venv\Scripts\python.exe scripts/check_launch_readiness.py --backend openrouter --phase cloud_first_ten --evidence .artifacts/launch-20261006-final/evidence-template.json
```

不足条件があればexit 2。10人受付の後に72時間を観測し、100人への拡張を判定する。
今日の実機確認で24時間/72時間経過を代用しない。
