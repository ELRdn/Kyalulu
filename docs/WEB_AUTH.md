# Webログインと個人テスト

状態更新: 2026-10-05。[次スレッドへの引き継ぎ](HANDOFF.md) に現在のリリースと次の検証をまとめる。

初回ログインでSupabaseの確認済みユーザーIDをKyaluluアカウントに結び付ける。
Google OAuthとメールリンクはサーバー側PKCEで交換し、ブラウザには
HttpOnly/Secure/SameSite Cookieだけを置く。APIキーやSupabaseトークンを
localStorageへ入れない。期限切れ・失効・キャンセル時はログイン画面へ戻す。

2026-10-04、招待1アカウント限定のクラウド本体を既存VPSへ配置し、
`https://cloud.kyalulu.com` のHTTPSとログイン画面を確認した。
SupabaseのGoogle providerは有効。Google側の `redirect_uri_mismatch` 修正後、
本人の確認済みIDと招待メールをSupabaseで再検証し、500 K-Creditsを単回付与した。
本人限定のOpenRouter／InferenceNet／DeepSeek V4.1 Flash経路を有効化した。
サブスク・追加購入・画像保存は停止のまま。公開版のモデル品質や運用の受け入れは
別途必要で、今回の作業では追加の有料推論を行っていない。

2026-10-05、表示名・保存したキャラクター・チャットのピン留めをアカウント保存へ
対応した。表示名はプロフィールの保存ボタンで確定する。別端末のログイン、画面へ
戻ったとき、または「最新の内容を読み込む」で読み込む。競合時は409を返し、
最新内容を表示して再編集を求める。テーマ・キー・接続先などの端末設定は含めない。
ローカル版とクラウドの会話データの転送は別の任意同期設定で、初期状態はオフ。

同日、クラウドのキャラ一覧をSFW取得へ修正し、4体の同梱プロットと利用者別の保存を確認。
作成UIは6タブ・イントロプレビュー・固定保存操作へ更新。一時下書きは所有者別の
sessionStorageへ保存し、保存ボタンでサーバーDBへ確定する。本人の実セッションでの
作成/保存・別端末間の反映確認は残る。独自SMTPによるメールリンク配信も未受け入れ。
[プロフィール同期の検証](validation/2026-10-05-cloud-profile-sync.md) /
[キャラ表示](validation/2026-10-05-cloud-catalog.md) /
[作成UI](validation/2026-10-05-plot-creator-ui.md)。

## SupabaseとGoogleの準備

1. Supabaseでプロジェクトを作成する。Project URLと公開anonキーを取得する。
   service-roleキーをKyaluluの通常APIへ設定しない。
2. Google CloudでWeb用OAuthクライアントを作成する。OAuth同意画面はテスト中とし、
   ひろなおのGoogleアカウントをテストユーザーに登録する。
3. Googleの承認済みリダイレクトURIには**Supabase**が表示する
   `https://<project-ref>.supabase.co/auth/v1/callback`を登録する。
   Kyaluluのcallbackとは別のURL。
   `redirect_uri_mismatch` の場合は、Supabaseが使用するWebクライアントの
   「承認済みのリダイレクトURI」欄へこのURLを登録する。
   「承認済みのJavaScript生成元」欄ではない。保存後はKyaluluからログインを
   やり直す。Googleの設定反映に時間がかかる場合は少し待って再度開始する。
4. Supabase Authentication → Providers → GoogleにClient ID/Secretを設定する。
   Client SecretはSupabaseの管理画面だけに置く。
5. SupabaseのURL ConfigurationでSite URLをKyaluluのHTTPS originに設定し、
   Redirect URLsへ`https://<kyalulu-host>/auth/callback`を完全一致で追加する。
   ワイルドカードは使わない。メールリンクも同じブラウザで開く。
6. メールリンクを使う場合は独自SMTP・送信元のSPF/DKIM/DMARC・配信を検証する。
   SMTPが未準備でもGoogle経路は先に確認できる。

## Kyaluluの設定

`deploy/cloud/.env.private-test.example`を秘密の`.env.cloud.local`へコピーする。
以下だけ設定する。秘密自体をチャットへ貼らない。

- `KYALULU_SUPABASE_URL`：Project URL。
- `KYALULU_SUPABASE_ANON_KEY`：Supabaseの公開anonキー。
- `KYALULU_CLOUD_ALLOWED_EMAILS`：本人のGoogleメールアドレス（1つ）。
- `KYALULU_CLOUD_ORIGIN`：Web/APIが同じoriginで動くHTTPSアドレス。
- `KYALULU_CLOUD_DATA_DIR`／`KYALULU_CLOUD_BACKUP_DIR`：専用保存先。
- `KYALULU_CLOUD_SECRET`：32文字以上のランダムな秘密。保存/バックアップの復号に必要。
- OpenRouterキーは既存`.env.cloud-test.local`から管理者が設定先へ移す。
  認証の確認中は推論の承認フラグを0にしておく。

Dockerは`deploy/cloud/compose.yml`と`Caddyfile.example`を使用する。
秘密envは`deploy/cloud/.env`へ置き、既存Relayと別ポート/別サービスを維持する。
既存VPSでは `compose.vps.yml` を重ね、コンテナ内Caddyから専用Dockerネットワーク
経由で接続する。[VPSの手順](../deploy/cloud/VPS.md)を参照。

開発で同じバックエンドを動かす場合：

```powershell
.venv/Scripts/python.exe scripts/check_cloud_auth.py --env-file .env.cloud.local
```

チェックは設定の有無と整合性だけを確認し、秘密や有料APIへ送信しない。
HTTPS reverse proxyの後ろで`python.cloud.app:create_app --factory`を起動する。
生のHTTP originや、未認証のローカルAPIをインターネットへ公開しない。

## ログインと500 K-Creditsの付与

Webで年齢・保存/送信先を確認し「Googleで始める」を押す。
Supabase経由でGoogleへ移動し、戻った後にプロフィールの「ログイン中」と
「アカウントID」を確認する。本人以外のメールはKyalulu側でも拒否する。
テストでは無料1,000枠を自動付与しない。

同じ保存先/秘密envを読むサーバー管理端末で：

```powershell
python scripts/cloud_admin.py grant --owner <プロフィールのUUID> --credits 500 --source owner-initial-500 --days 30
```

環境変数を読み込んでから実行する。Dockerの場合は同じcloudコンテナ/設定内で実行する。
付与APIは公開しない。アカウントが存在しない場合や予算を確保できない場合は拒否する。
同じ`--source`の再実行は重複付与せず、対象/額を変えた再実行は409相当で拒否する。

500 K-Creditsは$0.05相当、30日有効。API原価の6倍で消費するため、
API原価$0.05の付与ではなく約$0.00833相当。生成前の最大予約、終了後の整数精算、
失敗時のクレジット返却を維持する。同期/通常の編集/削除/エクスポートは0消費。
プロフィールには使用可能残高、累計消費、予約中の額、最近20回の生成の消費履歴を表示する。
生成結果の再取得でも確定済みの消費額を返し、再課金はしない。

API原価の別上限は累計$0.10。前回の$0.0495487202は保守的に
49,548,721ナノドルとして引き継ぎ、最大50,451,279ナノドルを残す。
再起動/月替わりでも使用額・予約・未確定費用をリセットしない。
前回検証は完了状態を維持し、この個人テスト台帳との並列送信は行わない。
画像保存、公開クラウドの法務/運用/実機受け入れは今回のログイン確認とは別。
