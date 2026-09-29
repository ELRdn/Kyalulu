# ConoHa VPS + Cloudflare 導入メモ

2026-09-29にConoHa VPSへ配置。Ubuntu 24.04 LTS、2 vCPU、RAM 960MiB、
約99GBファイルシステム、既存swap 2GiBを実測。実請求額は未確認。
運用状態・検証結果は [VPS検証記録](../../docs/validation/2026-09-29-vps.md) を参照。

## 配置

- Cloudflare Pages：PWAの静的配信。自宅の公開ポートは不要。
- ConoHa：Caddy（HTTPS）＋Relay、登録DBを永続ボリュームに保存。
- 自宅PC：Host＋Runtime＋LE。モデル・会話・記憶・Host秘密鍵をVPSへ送らない。

既存の `compose.pages.yaml` を使う。Relay 384MiB、Caddy 256MiBの
コンテナメモリ上限があり、残りをOS／Dockerが使う。1GB上で十分かは実測で判断する。
Docker buildのメモリはこの実行時上限の対象外。PWAはローカルでビルドする。
メモリ不足時はビルド場所の変更やswapを検討するが、自動で設定変更しない。
SSD 100GBはモデル置場には使わず、バックアップとDocker使用量を管理する。

## 接続前に必要な情報

- 公開IP、SSHユーザー／ポート、既存SSH接続名または鍵ファイルの場所。
  秘密鍵やパスワードそのものをチャットへ貼らない。
- Ubuntuのバージョンと、同じVPSで既に動いているサービスの有無。
- Cloudflareで管理するドメイン。APPは恒久的なPages URLでもよい。
  Relayには `relay.<所有ドメイン>` を割り当てる。

## 準備した転送物

リポジトリルートで次を実行すると、明示したソースだけのtar.gzとSHA-256を生成する。

```powershell
.venv/Scripts/python.exe scripts/prepare_relay_bundle.py
```

出力：`.artifacts/conoha/kyalulu-relay.tar.gz` と隣接する `.sha256`。
15ソースファイル＋内部の `SHA256SUMS`。`.env`、会話DB、vault、モデル、
Git履歴、node_modulesは含めない。実設定値はまだ例示値。
更新後は毎回再生成する。転送・展開先はVPSの新しい専用リリースディレクトリを使い、
既存ファイルを上書きしない。VPS上で `sha256sum -c SHA256SUMS` を実行する。

## 実サーバーでの実施順序

1. SSHホスト鍵指紋をConoHaコンソール側と照合して接続。検証を無効にしない。
2. OS、メモリ、ディスク、swap、既存サービス、待受ポート、Docker、
   OS／ConoHa両方のファイアウォールを読み取り確認。
3. 既存状態に合わせてDocker Engine／Composeを用意し、転送物の整合性を検証。
4. ConoHa側とOS側の受信ルール：TCP80／443、SSHは管理元に限定。
   HTTP/3を使う場合だけUDP443も許可。8787は非公開。
   Docker公開ポートはUFWだけでは制限できない場合があるため実際の外部到達性を確認。
   SSH制限は別セッションで接続確認してから適用し、コンソール復旧経路を確保する。
5. RelayのAレコードをVPS IPv4に向け、初回はDNS only。
   IPv6を構成していない段階ではAAAAレコードを作らない。
6. `.env.pages.example` から新規 `.env` を作り、APP／Relayのホスト名を設定。
   固定Composeプロジェクト名 `kyalulu-remote` で設定検証・ビルド。
7. 公開実施時に起動し、Caddy証明書、HTTPS healthz、CORS／WSSを確認。
   決定したRelay URLでPWAを再ビルドしCloudflare Pagesへ配信。
8. 隔離データでQR承認、Android実機、切断復旧、画像、失効を検証。
   メモリ／OOM／再起動回数を観測し、バックアップと復旧を確認。

```sh
# VPSの展開先ルートから。例示値のまま公開しない。
docker compose -p kyalulu-remote --env-file deploy/remote/.env -f deploy/remote/compose.pages.yaml config --quiet
```

DNS／公開設定の詳細は [Cloudflare手順](CLOUDFLARE.md)、招待・バックアップは
[Relay手順](README.md) を参照。請求期間終了・自動更新設定はConoHa画面で確認する。
外部へのバックアップ費用・ドメイン費用はVPS契約と別途確認する。

VPSの公開と製品のv1.0.0判定は別。既存のリリース前実機／実モデル／暗号レビュー条件は引き続き必要。

## 日常の運用

VPSの `/opt/kyalulu/current` が配置済みリリースを指す。更新時もComposeの
プロジェクト名 `kyalulu-remote` を固定し、既存DBボリュームを引き継ぐ。

```sh
cd /opt/kyalulu/current
docker compose -p kyalulu-remote --env-file deploy/remote/.env -f deploy/remote/compose.pages.yaml ps
curl --fail https://relay.kyalulu.com/healthz
systemctl list-timers kyalulu-backup.timer
systemctl status kyalulu-backup.service
```

DockerがOS起動時に開始し、コンテナの `unless-stopped` が自動復帰する。
運用者が明示的に停止したコンテナは再起動だけでは復帰しないため、上記Composeで
`up -d --wait` を実行する。ヘルスチェックは状態を表示するもので、unhealthyだけで
自動再起動する監視サービスではない。外部監視・障害通知は未構成。

### 暗号化バックアップ

`backup-encrypted.sh` をroot所有の `/usr/local/sbin/kyalulu-backup` に配置し、
同梱service/timerを `/etc/systemd/system/` に置く。
公開鍵だけを `/etc/kyalulu/backup-recipient.txt` に保存する。
復号秘密鍵はVPSへ送らない。SSH鍵を更新・削除する前に旧バックアップの復号手段を確保する。

- 毎日03:30 JSTから最大15分の遅延で実行。停止中の未実行分は起動後に補う。
- SQLiteオンラインバックアップをRAMに作り、ageで暗号化してからディスクへ保存。
- `/var/backups/kyalulu/relay-*.sqlite3.age`、rootのみ読み取り、約30日保持。
- 二重実行をロックし、失敗時は完了ファイルに昇格しない。
- VPS全損に備え、暗号化済みファイルを別端末へコピーする。現在は手動コピー。
  同じVPS内の日次コピーだけではディスク障害・契約終了に対応できない。

別端末で復号し、新しいパスへ復元する例（age CLIを使用）:

```sh
age -d -i /path/to/backup-identity -o restored.sqlite3 relay-TIMESTAMP.sqlite3.age
python scripts/relay.py --db isolated.sqlite3 restore restored.sqlite3 --offline
```

本番復元では、先にRelayを停止して現在の暗号化バックアップを確保する。
復元DBの整合性を確認し、所有者UID/GID 10001でボリュームへ配置する。
WAL/SHMを含む既存DBファイル一式は停止中に別の退避場所へ移し、
新旧DBのWALを混ぜない。既存DBに復元CLIを直接上書きさせない。

ロールバックは旧リリースのComposeを同じプロジェクト名で起動する。
DBスキーマ互換性を確認してから切り替え、互換性がない場合は対応するバックアップを
停止中に復元する。初回配置のため、本VPS上の旧バージョン切り戻し試験は未実施。
