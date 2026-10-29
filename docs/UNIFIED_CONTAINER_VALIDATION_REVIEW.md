# 本番VPSの別イメージ検証：承認対象

ローカルDocker Desktopは推論マネージャーの起動エラーで使用できなかった。
本番と同じLinux/Dockerで配布物を確認するため、既存VPS上の専用領域で
別イメージを作成し、架空データだけのコンテナで検証する。

自動承認レビューは、本番VPSへのコード転送・永続ディレクトリとイメージの
新規作成について、具体的な転送先への明示許可を確認できないとして拒否した。
2026-10-29に本範囲の明示許可を受け、転送・別イメージ作成と架空データ試験を
実施した。一時コンテナは終了済み。本番切替は行っていない。
結果は [検証記録](validation/2026-10-29-unified-container.md) を参照。

## 転送する配布物と宛先

- 対象は既存Kyalulu Cloudを実行している同じVPS。既存のStrictHostKeyCheckingと
  保存済みホスト鍵を維持するSSH/SCPを使う。
- ソースは公開リポジトリ `ELRdn/Kyalulu` の固定コミット
  `bf83d033ed4e86137c7dbc33835536f03cf87928`。対応ソースから統合Appをビルドし、
  許可リストで作った `kyalulu-cloud.tar.gz` を転送する。
- archive SHA-256:
  `9be12a4cbb4fa58e87d69fe2260919dc03eb8ae2a8d2d470f2a56bd5a76c42b2`。
  223 manifest項目・213配布コード/asset・380 renderer/Runtimeソースを照合済み。
- コード・公開作品・ライセンス・固定依存・対応ソースのみ。会話、DB、鍵、
  `.env`、認証情報、model weights、別作業は含めない。WASMは既存固定出力。
- 新規保存先は `/opt/kyalulu-cloud/validation/unified-bf83d03-20261029/`。
  既存パスがあれば上書きせず停止する。

## 作成・実行するもの

- 別タグ `kyalulu-cloud:unified-bf83d03-validation`。
  384 MiB、swap込み512 MiB、CPU50%を上限にビルドする。
  公式registryとhash固定Python依存を取得する場合がある。
- そのイメージから一時的な検証コンテナを作る。networkは `none`、公開portなし、
  read-only rootfs、tmpfsだけに架空DBを置く。memory256 MiB、CPU25%、pids64を上限とする。
- 実設定や本番volumeをmountしない。master secretも架空値をコンテナ内部だけで
  生成し、外部API・本番認証・実生成・残高付与・決済・広告には接続しない。
- 統合UI・Device/Migration/Workerの配信と分離header、unknown地域やprivate APIの
  拒否、実行userと配布物の対応を確認する。一時コンテナは `--rm` で終了する。
- build log、イメージ、監査済みarchiveは上記の新規validation領域だけに保持する。

## 既存サービスと資源の保護

事前読取では約508 MiBの利用可能RAMと約88 GBの空き領域がある。
本番Cloud・Relay・Caddyのイメージ/設定/volume/DB・起動状態は変更しない。
deploy lockを取得し、開始前後に既存Cloudのhealth・OOM・再起動数を確認する。
ビルド中も健康状態と負荷を観測し、悪化した場合は自分の検証処理だけを停止する。

同じVPSのCPU・RAM・diskを使うため、一時的な資源競合の可能性は残る。
この承認には、本番切替・DNS/OAuth/Caddy変更・本番DBのbackup転送/復元・
既存image/volume削除・Docker更新・factory resetは含めない。
