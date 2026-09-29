# Cloudflare配信の準備と運用

2026-09-29更新：kyalulu.comのCloudflare DNSを設定し、ConoHaへRelayを配置。
PWA用Cloudflare PagesをDirect Uploadで公開済み。APPは `app.kyalulu.com`、Relayは `relay.kyalulu.com`。
[公開PWAの検証記録](../../docs/validation/2026-09-29-published-pwa.md)を参照。
[ConoHa用の導入準備](CONOHA.md)を参照。以下の契約比較は選定時点の記録。

## 推奨構成

Android → Cloudflare Pages（PWA）→ VPS上のCaddy／Relay → 自宅PCのHost／Runtime／LE。
PWAとRelayは別オリジン。会話・記憶はPCに置き、Relayは既存Noiseの暗号文を中継する。
Cloudflare Pagesへの配信対応を用意した。Appwriteへの移植は行っていない。

| 候補 | 適合性 | 費用・条件 |
| --- | --- | --- |
| Pages＋小型Linux VPS | 現在のRelayをそのまま使える推奨案 | Pages Free＋VPS・ドメイン・バックアップ。合計月3,000円以内を目標、実額未確定 |
| Pages＋自宅Relay＋Cloudflare Tunnel | 個人の外出先試験の候補 | VPS代不要。固定ホスト名用ドメイン、PC常時稼働、Tunnelの設定・規約・切断復旧検証が必要。今回未構成 |
| Pages＋Appwrite Cloudだけ | 現行Relayの配置先として不適合 | RealtimeはAppwriteイベントの購読。Functionsは最大900秒。常時WSS／ローカル永続SQLiteの置換には設計変更が必要 |
| Workers＋Durable Objects | 将来の選択肢 | Relayの移植と認証・暗号・復旧の再検証が必要。今回の配信準備には含めない |

Appwriteは将来のアカウント管理などには使えるが、初期の招待・端末鍵認証には
必須ではない。導入してもRelayサーバー費用は消えない。Appwriteへの会話アップロードや
自動クラウド推論は追加しない。

## 契約前に決める値

- APPの恒久URL：例 `https://kyalulu.pages.dev`（名前の空きは未確認）。
  登録鍵はブラウザのオリジンに属するため、後から独自ドメインに変えると再登録が必要。
- RelayのURL：所有するドメインの `relay.<domain>`。APPと必ず別オリジンにする。
- VPS：日本または近隣、Linux、Docker Compose、常時稼働、永続ディスク。
  1 vCPU／RAM 1GiB以上を試験開始の目安とする。これは性能保証ではない。
- 見積：税込月額、為替、IPv4、転送量と超過単価、スナップショット、
  ドメイン更新料、解約・自動更新。無料クレジット終了後も含める。
- 自動休止する無料ホストや再起動で消えるディスクは現行Relayには使わない。

## PWAのローカル準備

リポジトリルートのPowerShellで、決定したRelayオリジンを指定する。

```powershell
./scripts/prepare_cloudflare_pages.ps1 -RelayOrigin https://relay.example.com
```

このコマンドは型検査とビルド、Caddyと同等のCSPを含むPages用 `_headers`、
404ページを生成する。既存の `apps/web/dist` とは別に
`.artifacts/cloudflare-pages` を出力する。アカウント作成や公開はしない。
出力先は毎回再生成される。例示URLのビルドでは実サービスに接続できない。
`VITE_RELAY_ORIGIN` は公開設定であり秘密ではない。秘密鍵や招待をビルドへ入れない。

公開を承認した段階で、Cloudflare PagesのDirect Uploadへ**この出力フォルダだけ**を
アップロードする。リポジトリ全体や `.artifacts` 全体はアップロードしない。
最初は手動配信とし、意図しないGit自動公開を避ける。Pages Functionsは使わない。
Web Analytics／Zarazなどの第三者スクリプト注入を有効にしない。
ハッシュルーターなのでSPAリライトは不要。秘密のAPIをPages側へ転送しない。

## VPSの準備と有効化

`deploy/remote/.env.pages.example` を同ディレクトリの `.env` にコピーし、
決定したホスト名に置換する。既存 `.env` がある場合は上書きしない。
以下はリポジトリルートで使用する設定確認コマンド。

```sh
docker compose --env-file deploy/remote/.env -f deploy/remote/compose.pages.yaml config --quiet
```

`compose.pages.yaml` は単独で使用する。既存 `compose.yaml` と重ねたり同時起動しない。
APPファイルのマウントは不要。既存データがある場合は同じComposeプロジェクト名と
ボリュームを保ち、バックアップ後に切り替える。違う名前で起動すると新しいDBになる。

契約・公開を承認してから、VPSへ必要なソースを転送し、ビルドして `up -d` する。
自宅のRuntimeデータ・モデル・Host vaultはVPSへ送らない。
RelayのDNSは最初はDNS onlyにし、Caddyの公開証明書を検証する。
VPS側のみ80／443を公開し、8787は外部公開しない。SSHは管理元に制限する。
自宅PCのポート開放は不要。Cloudflare proxyを後で有効にする場合は
Full (strict)、WebSocket、キャッシュ無効と再接続を再検証する。
Relay側のボットチャレンジやAccessログインを無検討で挟むとHost接続を壊し得る。

Relayは1 worker／1 replica、SQLiteを永続ボリュームに置く。
バックアップ・復旧・招待発行は [README](README.md) の既存手順に従う。
`RELAY_ORIGINS` は恒久APPオリジンに限定し、プレビューURLやワイルドカードを許可しない。

## 公開後の受け入れ確認

1. APPのCSP、WASM Content-Type、SW更新、404、外部スクリプトがないことを確認。
2. Relay `/healthz` とTLSチェーン、承認済みAPPからのCORS／WSSを確認。
3. 隔離したHostデータでQR登録→PC承認→Android実機の会話・画像・失効を確認。
4. Wi-Fi／モバイル切替・画面ロック後の生成復旧、重複保存ゼロを確認。
5. 本文を記録しない監視、課金通知、バックアップ復元を確認。
6. 実機・実モデル・暗号レビューなど [リリース条件](../../docs/validation/2026-09-29-remote.md)
   を完了してからv1.0.0を判定。配信できることだけではリリース合格にならない。

## 公式仕様の確認（2026-09-29）

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/):
  Freeは月500ビルド、20,000ファイル、1ファイル25MiB。
- [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/):
  静的配信の `_headers` を使う。Functions経由には別途実装が必要。
- [Appwrite Realtime](https://appwrite.io/docs/apis/realtime): Appwriteリソース更新の購読。
- [Appwrite Functions](https://appwrite.io/docs/products/functions/functions): 最大実行時間900秒。
- [Appwrite料金](https://appwrite.io/pricing): 今回の取得結果ではプラン金額を確定できなかった。
  無料枠の細目や常時稼働保証を推測しない。VPSの最新見積は未取得。

以下は初回のローカル準備時点の記録。現在の公開状態は冒頭の検証記録を参照。

## 初回ローカル準備で確認した範囲

- 例示RelayオリジンによるTypeScript検査・本番PWAビルド成功。
- 生成したCSPのHTTPS／WSS接続先、404ページ、Pagesファイル上限を確認。
- パスを含む不正なRelayオリジンがビルド前に拒否されることを確認。
- `docker compose ... config --quiet` 成功。Docker設定ファイルの読取権限警告あり。
  コンテナのビルド・起動、Caddy実プロセス、Pages配信ヘッダーは未検証。
- 既存の大型JSチャンク／WASM Node分岐の外部化に関するビルド警告は残る。
- 例示ドメインでの成果物は接続確認用ではない。本番URL確定後に再ビルドする。
