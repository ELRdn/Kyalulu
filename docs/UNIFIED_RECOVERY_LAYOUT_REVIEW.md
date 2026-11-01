# 復旧計画用volume配置の読取：承認対象

2026-10-30の自動承認レビューは、本番volume・Compose設定パスなどの内部配置を
PCへ保存する操作が、許可済みのDB集計/hash・健康確認を超えるとして拒否した。
その操作は実行していない。以下は必要なvolume情報だけに範囲を狭めた別の確認で、
実行にはこの具体的な範囲の明示許可が必要。

2026-10-30に下記4項目への明示許可を受け、schema自己試験後に取得・指定先への
非公開保存を完了した。実ホストSource・Composeパス・環境変数・鍵・DBは取得していない。
これはbackupや本番切替の許可ではない。

## 対象・取得する項目

- 同じ既存Kyalulu VPSの稼働中 `kyalulu-cloud-cloud-1` のDocker mount metadata。
- 各mountの **type、volume名、コンテナ内mount先、読み書き属性（RW）** だけ。
- 実ホストのSourceパス、Compose設定ファイル/作業ディレクトリ、環境変数、鍵、
  DB本体、会話・記憶・個別行・認証情報は取得しない。
- 既存のStrictHostKeyCheckingと保存済みホスト鍵を維持し、固定のDocker inspect
  formatで上記4項目以外をSSHへ出さない。health/実行状態の確認は既存範囲を維持する。

## 保存先と利用目的

- PCのGit対象外・非公開ファイル
  `D:/VibeCoding/my zeta/.artifacts/unified-vps-preflight-20261029/production-volume-layout-897737f.json`
  へ保存する。既存ファイルがあれば上書きせず停止する。
- 値そのものはGit/PR/外部サービス/公開文書へ転記せず、暗号化backupと別root復元の
  計画で正しい既存volumeを指定するためだけに利用する。
- 実施コードは同じ非公開フォルダーの `read_recovery_layout.py`。
  保存schemaを架空入力で確認してから実施する。

この許可は**読取と上記ファイル保存だけ**。本番停止/再起動、volume mount/変更、
backup取得/転送/復元、DB更新、secret取得、DNS/Caddy/OAuth変更、マージや本番切替は
含めない。backup/切替は検証済みの具体的な手順を別途提示する。
