# PR #7のマージ・本番反映 — 2026-10-16

ユーザーのGOに基づき、[PR #7](https://github.com/ELRdn/Kyalulu/pull/7)を全CI成功後にマージした。
マージコミットは`b51d72615ff044c74179615c956cac3ee48c5ac5`。ローカルmainもfast-forwardで同期し、監査済み候補`63e2c6e`と同じソースツリーであることを確認した。

## CIと配備前の修正

- Runtime/Web、CharacterBenchのUbuntu・Windows、およびDocsのCIが成功。
- 暗号化Remoteの実ブラウザ試験で、機能情報と会話コンテキストの取得が許可リストから漏れている不具合を検出。`63e2c6e`で、認証を維持した読み取り経路とセッションID検証を追加した。
- Remoteでは未対応の分岐・完全消去・要約編集を機能情報に表示しない。管理操作と未審査の更新経路は引き続き拒否する。関連125テストと実ブラウザ9条件が通過。
- CloudのMock Chromium UI検証も成功。これらの試験では実モデルを呼び出していない。

## Cloud

- 公開先：[cloud.kyalulu.com](https://cloud.kyalulu.com/)
- release：`/opt/kyalulu-cloud/releases/20261016-pr7-rp/bundle`
- image：`kyalulu-cloud:20261016-pr7-rp`
- 配布物SHA-256：`82e80fdfceb74cbab669d3d76a61245101071510bee908315172fee49fde10a3`
- 配備時のソース指紋：`4e607f4dcb65c7c736439ff0ebaa8b27b5d97644d00264db90c95a7f27f9b526`
- manifest180件、Runtime100件、Web57件、対応ソース387件を監査。実配信assets16件、index、Service Worker、公開対応ソースは配布物と一致。
- 更新前暗号化backupをPCにも複製し、SHA-256を照合。隔離復元と追加migration後、台帳・会話を含む記録対象テーブルの全行ハッシュが更新前と一致。
- 更新後にも同じハッシュを照合。1 account／425 Credits／26 operationsを保持し、pending・fund holds・debt・reviewは0。
- 秘密設定は配備イメージ名以外を保持。本人限定・受付1・販売／広告／画像無効、累計API上限$0.10を維持。
- RelayとCaddyのcontainer IDは不変。Cloud／Relay health、匿名private APIの401、guest catalogの200を確認。
- 公開HTTPSの320／390／1440px × light／darkの6条件で、表示・同意の有効化／撤回・横はみ出しなし・pageerrors 0を確認。

## 公開サイトとPWA

| 対象 | 本番 | Pages配備ID | 配備コミット |
|---|---|---|---|
| LP／Docs | [kyalulu.com](https://kyalulu.com/) | `0d3a2a14-ea98-43fe-ae3c-e324eb1b1420` | `b51d726` |
| PWA | [app.kyalulu.com](https://app.kyalulu.com/) | `159cc182-2108-4149-bee0-d737d4b78a6b` | `b996614` |

- LP82ファイル、PWA57ファイルのアップロード内容がローカル配布物とbyte一致。独自ドメインも照合した。
- LPのHTML38件には既存のCloudflare保護スクリプトの付加がある。付加位置と既知マーカーを検査し、それ以外の本文は完全一致。ゾーンのWAF設定は変更していない。
- PWAの実ブラウザ確認では、このHTML変換とService WorkerのSRIが衝突し、初期インストールが失敗することを検出した。
- `b996614`でPWA配布ヘッダーを`Cache-Control: no-cache, no-transform`へ変更し、再配備。[Cloudflare公式仕様](https://developers.cloudflare.com/bots/additional-configurations/javascript-detections/#if-your-origin-sends-a-no-transform-header)に従ってこの配布物の変換を防止し、Service WorkerのSRIは維持した。
- 修正後はPWAの独自ドメインもHTMLを含め完全一致。6画面条件、Service Workerの起動、画面用cache31件、API cache0件、pageerrors 0を確認。
- 既存PWAの更新は「アプリ情報」→「更新を確認」→明示的な再読み込みで適用する。

## 証拠と未確認事項

ローカル証拠は`.artifacts/pr7-production-20261016/`に保存した。配布物監査、暗号化backup、隔離復元、前後状態、環境設定保持、実配信照合、Cloud／PWAのブラウザ結果を分けている。秘密情報・DB・backup本体はGitへ含めない。

この反映で新規有料推論・新規資金付与・一般受付・販売・npm公開は行っていない。実Google OAuth、本人の実機Android／既存PCとの再接続、実モデルのRP品質と内心の知識境界、長時間運用の受け入れは未確認。PWAヘッダー修正は実配信と実ブラウザで検証済みで、追加のmain CIは別に追跡する。
