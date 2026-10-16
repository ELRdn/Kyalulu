## 2026-10-12 追記：無料β準備・Pixel設定ボタン修正、一般受付は保留

詳細は [無料β受け入れ・検索観測](validation/2026-10-12-cloud-beta-followup.md)。
Cloud本番は`20261012-beta-settings`。常時固定の規約・プライバシー設定をプロフィールへ移動。
解析は規約同意後の認証開始成功で有効、標準ON・任意OFF。拒否を保持し、OFF操作は即時撤回。
独立18歳checkboxは廃止、JP/US居住国と同意版を認証フローへ結び付けた。未成年条件は未確定。
InferenceNet DeepSeek/GLMの2経路をサーバーでも制限。月次補助0、単回資金CLI・原子的な登録/試用を追加。
実資金登録・新規試用付与・一般受付・新規有料推論・Jev導入は未実施。
1 account／425 Credits／26 operations／保守費用$0.066416409を保持。本人限定・受付1・販売/広告/画像OFF。
240ターンの出力確保額だけで$0.3489792となり、検証枠$0.30を超えるため実生成は未実行。
運営者情報・未成年/米国州条件・実2アカウント・新版Pixel・24h運用・正式ライセンス受け入れが残る。
公開LPはPages`79d1952d`。新Cloud日英URLは各1回索引申請済み、Google索引完了は未確認。
固定非ブランド10検索のうち英語Q1で公式URLを確認。検索付きChatGPT回答は未取得、72h受付観測は未開始。
PC別ホスト復元は合格、一時復元データ削除は自動承認ポリシーに拒否され残留。記録内の保存先を参照。
以下は旧時点の記録。

## 2026-10-12 追記：SEO・AEOと同意付きGA4を公開、Cloud本人限定の設定を保持

Kyalulu日英LP・17ガイド（36 Docsページ／38 sitemap URL）をCloudflare Pagesへ公開。
用途・導入・SillyTavern移行・記憶・スマホ・Kyalulu CharacterBenchを整え、Cloudガイドを追加。
未公開npm文言・未稼働メール受付を除去。架空データ／Mockによる実操作3画像は実保存まで確認した。
GA4専用property558473109、ID G-14CZ0KMM2M。同意前／拒否はGoogleタグなし、撤回可能。
個人の会話・記憶・ID・認証URLは送らず、Cloudはoriginと固定分類だけ。広告利用／Signals／拡張計測OFF。
CloudflareのKyalulu自動RUM挿入を停止。WAFなどの保護設定は変更しない。
Cloudと個人用PWAのnoindexを本番確認。appホスト限定のX-Robots-Tagを反映し、公式LP・日英Docsは検索対象を維持。
Cloud本番は `20261012-seo-aeo`。対応ソース・配布assets16件・backup隔離復元を確認。
本人限定・受付1・販売／広告／画像OFFを保持。1 account、425 Credits、operations26、
保守累計$0.066416409、残余$0.033583591、pending／debt／review0は更新前後で一致。
新規有料推論0。一般10人βは予算・運営者情報・実機／実モデル／運用の証跡待ち。
GSC sitemapは成功（最終読込10/08・検出36）。新しい38 URLの再処理は未確認。
詳細と最新の検証結果は [SEO・AEO／β記録](validation/2026-10-12-seo-aeo-beta.md) を参照。
以下は各旧時点の記録で、現本番releaseと残高はこの追記を優先する。

## 2026-10-12 追記：通常送信の毎回確認を撤去、本番反映・実生成確認

画像に残った「送信内容を確認」は外部安全検査ではなく、共有APIが全quoteで待つ確認画面だった。
`streamChat`は通常quoteを検証・表示して直接送信する。任意callback未指定でも送信できる。
Baiduの保存・学習同意だけチャット内のcheckboxで送信別に確認し、未同意・取消・期限切れは送信しない。
見積上限・期限・owner変更・abort・保存と無料再取得・運営累計$0.10は維持。自動再送・fallbackは追加しない。
送信先と上限はチャット内へ表示し、ログイン説明も実際の導線へ合わせた。
本番は`20261012-one-click-chat`。関連90試験・build・Mock48条件、本番HTTPS6条件、backup隔離復元を確認。
GLM架空会話の実生成・保存・無料再取得成功。実費$0.000196870／12 K-Credits、保守累計$0.066416409、残余$0.033583591。
新版実機は未確認。既存PWAはアプリ情報から明示更新する。
本番反映・検証結果は[本番検証記録](validation/2026-10-12-cloud-production.md)の最新節を参照。
以下は各旧時点の記録。通常モデルも送信前に確認するという過去仕様は廃止。

## 2026-10-12 追記：予約廃止・外部安全検査廃止の本番候補

最新依頼に合わせてユーザーcredit holdを廃止。生成量を現在残高へ収め、成功時だけAPI実費で精算する。
一所有者につきpending1件、見積上限とBaiduの送信別同意、運営累計$0.10、idempotencyを維持。
入力・出力・作品保存の外部SFW API呼出を廃止。構造検証・所有者分離・SFW宣言は維持。
外部検査なしのv5説明へ更新し、旧同意は再ログインが必要。
欠落費用は全operation上限を保守計上し、独立監査へ保持。invalid usage/cost・overrunは停止を維持。
本番は`20261012-direct-generation`。停止復帰・HTTPS6条件まで確認し、実生成は本人のv5再ログイン待ち。
復帰後463クレジット、保守累計$0.065799139、残余$0.034200861。最新証拠はvalidationを参照。
旧未知費用は減額せず、Baiduの上流429自体とCloud全体停止を区別する。

# Kyalulu 引き継ぎ — 2026-10-12

## 2026-10-12 追記：Cloud返信を復旧、GLMで実生成・保存・再取得を確認

[本番検証記録](validation/2026-10-12-cloud-production.md)。最新releaseは`20261012-cost-recovery-v2`。
返信停止はBaidu429後の料金未取得に加え、固定SFW検査のInferenceNet価格改定が原因だった。
公開endpointのDeepSeek出力価格$0.40→$0.66/Mにcap・予約単価・UI価格・tariff versionを合わせた。
送信先・SFW検査・送信同意・fallback禁止は維持。旧見積はfingerprint/version差で拒否する。

オフライン管理CLIに`retain-failed-reservation --operation UUID --evidence JSON`を追加。
停止・RuntimeLock・専用キーの最新総額確認・対象fingerprint/旧原価/予約上限・失敗記録を照合し、
failed原価を全予約上限へ増額してreviewを解除する。個別receipt未取得は監査basisへ保持し、実費0とは扱わない。
pending/holds/debt、不正usage、不正cost、overrun、不一致証跡は拒否。監査と更新は同一transaction。
同じ証跡での再実行はGET/増額なし。監査はcontrol.dbに保持してbackup・復元にも含める。
Baidu失敗を1,178,569→5,430,562 nano、SFW404失敗を269,726→3,595,466 nanoへ保守計上した。
新しい失敗ではmissing/invalid cost・単発overrun・429を区別して保存し、UIも固定429理由を表示する。

GLM 5.3 Flash／InferenceNet固定の架空会話で、SFW入力検査→生成→SFW出力検査→保存が成功。
32文字の返答、API実費173,499 nano（$0.000173499）、11 K-Credits。同じ生成の再取得は追加課金なし。
既存チャットのモデル・本文は変更せず、検証専用sessionに2メッセージを追加した。
最新台帳：463 K-Credits、operations18、保守累計$0.060027066、残余$0.039972934、pending/holds/debt/review0。
OpenRouterキー累計$0.045902880、成功試験の増分$0.000173499は台帳の実費と一致。

関連Python109＋復帰56試験、Web19試験・build、Mock50条件、本番HTTPS6条件通過。
独立レビュー2名、暗号化backup・隔離復元・監査保持、配信assets/source一致、Relay/Caddy保持を確認。
配布物SHA256 `20381502e0b61520676cbbfc772412ea97515919f317fa3261da83e7ced395e4`。
ソース指紋 `bf81cf175c8d67d0df9ea4d6f7ac964f426b04375ead5c8808fcd6a68c57d26f`。
本人Pixel/Chromeには再読込後GLMを選択して返信確認を依頼中。Baidu429の解消・他モデルの実生成は未確認。
予算上限$0.10は維持し、新しい未知費用の自動解除・自動再送はしない。以下は旧時点の記録。

## 2026-10-12 追記：公式推論要約の位置を本番反映、返信停止は請求照合待ち

[本番反映・検証記録](validation/2026-10-12-cloud-production.md)。当時のreleaseは`20261012-summary-order`。
通常チャット・VNの公式推論要約を返信本文の上へ移動。初期折り畳みと生成中・編集中の非表示を維持。
費用停止の説明も、予算・予約額だけでなく提供元の請求情報確認が必要な場合を含む文言へ変更。
対象Web43試験・build・Mock Chromium50条件、本番HTTPS6条件、assets／対応source一致を確認。
配布物SHA256 `38949b9472b7e5e3223ae3de82d2f2c4c846b7fc0edefcae090306c1204d6bbd`。
ソース指紋 `b8cfbbc06cb3d98d2f84a7dfc254f93fab37327cabfee259e6bd567fd15cdb15`。
暗号化backupのPC複製・隔離復元後に反映。会話・台帳・Relay／Caddyを保持、有料生成0。

停止直前のBaidu呼び出しは、本人のOpenRouter upstream詳細画像で429／試行1／192msと確認。
生成`2cd79fa2-d163-43af-90e5-2a4c78832ead`は`provider_usage_unavailable`でfailed、K-Credits消費0・本文未保存。
請求情報未取得のため`review_required=1`が永続化し、後続送信を`operator_budget_exhausted`で停止している。
画像に請求額はなく、転記したOpenRouter生成IDの明細APIは404、当日のactivity集計も未取得。
429を無課金と断定せず、停止解除・費用減額・無断fallbackは行っていない。
当時の台帳：474 K-Credits、operations16、保守的累計$0.052006108、残余$0.047993892、pending／holds／debt0、review1。
次はOpenRouter明細と対象呼び出しを照合し、監査可能な復帰操作を検証する。再起動・モデル変更では解除できない。
この版のAndroid実機表示と公式要約対応モデルの実生成は未確認。以下は各旧時点の記録。

## 2026-10-12 追記：プリセットUI・専用待機アニメーション・ホームを本番反映

[本番反映・検証記録](validation/2026-10-12-cloud-production.md)。当時のreleaseは`20261012-chat-ui`。
モデル名・送信先・保存／学習告知を常時表示し、技術情報と価格は折り畳みへ整理。
プリセットと知識の読込中・空・取得失敗を区別し、固定版と明示更新を維持。
通常の送信待ちは既存マスコットによる専用アニメーションへ変更。SFW検査・同意・課金条件は維持。
reduced-motion、診断stage、キーボードでの折り畳み・Sheet focus循環、スマホのホーム導線を確認。
Web248件・build、Mock Chromium50画面条件通過。配布物・対応sourceと本番assetsの一致、backup隔離復元を確認。
SHA256 `b529965e6d437672f261fa959509a8b088a3a3157e391866b2a42f3df2b84e27`。
ソース指紋 `a8eea2cf3392036e718a5ad07b3c2827c1b736c46d136ebe1074b34d51e6a7a9`。
Pixel／Chromeの本人操作で実返信・日本語変換・reload保存・画面ロック復帰を確認済み（quote-ui版）。
Baidu実生成1件は$0.000430696／26 K-Credits。v4同意と精算・保存をサーバーで確認、本文は取得していない。
当時の台帳は474 K-Credits、累計$0.050780025、残余$0.049219975、pending／holds／debt／新未知費用0。
今回の追加UI反映による有料生成0、Relay／Caddy維持。新しいホームとプリセットの折り畳みは本人Pixel／Chromeで確認済み。
待機アニメーションの実機表示、他モデルの実routing／公式summary・品質比較、回線切替、長時間運用は未確認。以下は各旧時点の記録。

## 2026-10-12 追記：最新Cloudを本番反映、実機・実生成は本人操作を案内中

[本番反映・検証記録](validation/2026-10-12-cloud-production.md)。ユーザー承認で`20261012-quote-ui`を本番反映。
古い会話backup復元直後のmigrationと失敗後の再初期化も修正し、関連24試験・独立再レビューを通過。
更新前暗号化backupをPCへコピーし、隔離復元・DB integrity・台帳保持を確認。Relay／Caddyは維持。
本番assets・対応source・health・匿名401／ゲスト200、実HTTPSブラウザー4画面条件を確認。

最新配布物：`.artifacts/cloud-production-20261012/cloud-release/kyalulu-cloud.tar.gz`。
SHA256 `bd7860ec88d36bd57e91b4d870e1a8cf17bce9bcaf38baf6a8b5bdb9a4fe88b8`。
ソース指紋 `a087eb6e6f691debed203ed48a9aa93e16a7a757d67a0e1286bb08a1e7ddb121`。
本番release `/opt/kyalulu-cloud/releases/20261012-quote-ui/bundle`、image `kyalulu-cloud:20261012-quote-ui`。
private test／signup1／販売・広告等無効を維持。旧版は通常運転へ自動rollbackせず、失敗時Cloud停止とする。
反映後accounts1／credits500／failed6、累計保守計上$0.050014281、残余$0.049985719、pending／holds／debt0。
過去6件の未知費用は減額しない。本人HTTPS再ログインのv4同意→短い架空発言1件→保存・精算照合を案内中。
実機・実生成はこの時点で未確認。以下の「本番未反映」は各旧記録時点の状態。

## 2026-10-12 追記：Cloud送信確認UIの改善（本番未反映）

[UI実装・検証記録](validation/2026-10-12-cloud-quote-ui.md)。既存Dialogでモデル・上限料金・送信範囲・
保存／学習条件を整理し、技術詳細は折り畳み、操作ボタンを固定。送信ごとのBaidu同意と見積期限は維持。
送信中の重複復旧案内、通常画面の待ち時間内訳、320pxのComposer幅超過を修正した。
Web227件、型検査・Web build、Mock Chromium28画面条件成功。取消・下書き保持・同意reset・focusを確認。
独立再レビューに追加P1／P2なし。有料推論0、本番・Git変更0。

**最新Cloud候補**は`.artifacts/cloud-quote-ui-20261012/cloud-release/kyalulu-cloud.tar.gz`。
SHA256 `c60dd4429fd813c0f9235e3cbc6a56ad785201abf4d65af53ae57264716029ae`。
ソース指紋 `41941399344145033ba3c20602ffd5a424aba6ca31e2114bcaa704a6b622c9ab`。
manifest180件・Runtime100件・Web57件・対応source372件照合。以下のCloud／Windows／npm候補は今回UI修正前。
本番未反映、実機・実Provider生成は未確認。累計API上限$0.10を維持、現在残額は未照合。
次の本番更新では本人承認・現台帳・backup・rollback照合と私的受け入れが必要。

## 2026-10-12 追記：Cloud6経路・公式要約・Baidu学習同意（本番未反映）

[モデル実装・検証記録](validation/2026-10-11-cloud-models.md)。DeepSeekのBaidu／Decart／InferenceNet、GLM／InferenceNet、
GPT Luna／OpenAI Flex、Haiku／Google Vertexを追加。Flexは`openai/flex`確認済み。6候補low、旧Standardは思考無効。
ユーザー方針によりBaiduは保存・学習可能な選択肢とし、毎回未チェックから始まる学習同意を必須化。
Kyaluluの履歴保存と提供元の保持・学習を区別し、説明versionをv4-retention-trainingへ更新。
公式summaryだけSFW検査後に保存・折り畳み表示。HaikuだけZDR指定。
取消・再起動の同意消失と、精算前crashの費用復旧／追送停止を修正。独立再レビューに追加所見なし。
Python259件・Web226件、型検査・build、Mock Chromium16画面条件通過。有料推論0、本番・Git変更0。

この時点のCloud候補は`.artifacts/cloud-models-20261011/cloud-release/kyalulu-cloud.tar.gz`（今回UI修正前）。
SHA256 `366a095eab03862ea38c3162553471c2c25cfe5eb7bcf6484e995df1831fc0ab`。
ソース指紋 `17ebaf1d566201495811bf6fe37b9d771628a4a20bdd19266e9dd67a65b2e0bd`。
manifest180件・Runtime100件・Web57件・対応source371件照合。以下のonboarding／parity候補とWindows/npm候補は旧版。
本番は今回未読／未更新、現在残額は未確認。累計API上限$0.10と未知費用を維持。
次は現台帳・backup・rollbackを照合し、本人の本番更新承認後に最新候補を受け入れる。実routing／summary／品質は未判定。

## 2026-10-11 追記：ゲスト閲覧・初トーク案内・安全検査の価格条件（本番未反映）

[今回の実装・検証記録](validation/2026-10-11-cloud-onboarding.md)を参照。
ゲストでSFW同梱作品を閲覧し、Cloudトーク・保存はログイン必須。OAuth後は選んだ詳細へ復帰。
初トーク4段階案内・スキップ・再表示を追加。公開Communityは既存の提供gateを維持。
InferenceNetの現在入力単価$0.077が旧cap$0.02を超え、固定経路を除外する不整合を確認。
capと見積原価を入力$0.077／出力$0.40へ同時更新し、モデル・送信先・fallback禁止・SFWは維持。
安全判定の形式不正は503、正しいfalseは403。Provider料金版を別表で保存・予約照合し、旧quotes8列とrollback互換を維持。

最新Cloud候補は`.artifacts/cloud-onboarding-20261011/cloud-release/kyalulu-cloud.tar.gz`。
SHA256 `40a2a3d2c21a5542400a8fa8c94ffcb36bf07a639600580298b63c9be590354b`。
ソース指紋 `61f2add5a58a411d68101e71c0ebb030d955b138a23af1fa36fae19f30f01031`。
Cloud関連255件・Web188件、型検査・build、Mock Chromiumで12画面条件を確認。独立レビュー2件修正・再確認。
前節のparity配布物はこの追加修正前。Windows/npm候補は更新しておらず、今回ソースと一致すると扱わない。

本番は読み取り確認で`20261005-official-portraits`のまま。短い架空安全検査1件が旧設定で失敗し、追加送信停止。
失敗5操作はすべて予約上限と同額のため実費未確定。5件$0.000385920＋過去$0.049548721＝保守的計上$0.049934641。
pending／fund holds0、K-Credits消費0。上限$0.10・未知費用の予約額を維持。請求照合前に減額・resetしない。
本番旧版には未知料金時の追送停止がないので繰り返し操作せず、反映前に台帳とバックアップを照合する。
新価格での本番会話・実OAuth・実機は未確認。本番更新・再起動・Git変更・Provider変更は行っていない。
13 Providerの価格・画像速度・公開ZDR／量子化を比較し、当面InferenceNet維持を推奨。Baidu等への無断転送はしない。

## 2026-10-11 追記：競合比較に向けた実装（本番未配布）

最新の実装・比較条件・証拠と未確認は [競合比較の検証記録](validation/2026-10-11-competitor-parity.md) を参照。
記憶の出典4分類とworld固定scope、旧scopeの明示移行、抽出式chapter／arc、Cloud再生成・inline quote・
段階計測・保存文脈、分岐／完全消去、cast／完全一致triggerのRPG、CommunityのAPI／UI（既定無効）、
ローカルWAV／MP4権利確認付き持込、Portable／Inspector、本体KCB adapter・比較bootstrapの基盤を追加した。
native同一versionの内容変更は固定保証なし。機能・性能・運用の全面同等達成とは扱わない。

競合の公開観測と実装を20領域で分離。REAは公開配信コードの静的partial証拠で、ブラウザー実会話の観測ではない。
競合実会話・有料操作、本番、実機、クリーンOS導入、外部アプリ往復は未確認。
API累計上限$0.10を維持し、今回有料API0。最終Python＋同梱KCB845件、Web147件、CLI17件、
型検査・build・配布物の対応ソース／Web監査を通過。最終候補は`.artifacts/parity-20261011/{cloud,windows,npm}-release`。
実npm CLIをNodeだけのPATH・隔離データで確認し、Mock30／50／100ターンの保存・要約・再取得を確認した。
新しいRuntimeでMock送信・記憶出典・reload、390／1440pxのlight／darkを確認。PWA更新は未確認。
削除済み引用の同期／復元・準備中Cloud生成の消去競合、旧記憶・重複削除記録の採用、計測時間による見積失効を修正。
ソース指紋`b35bea30dcc9cd9cce8dd2533a1ff678d71cf0185ecc8dde18b04f9aac9c7e0a`。**今回ソースは本番未配布**。
以下の旧履歴・配布状態・残高・final4 hashは保持するが、今回ソースの受け入れ証拠へ転用しない。

次スレッドの開始点。まずこのファイルを読み、必要な箇所だけ参照する。
以下は10月8日までの旧引き継ぎ。本番配布状態・残高・費用は10月5日の検証スナップショット。
10月6日は公開health/status/匿名401を再確認した。変更や有料送信の前に
実サービス/台帳で確認し、過去の成功を新しいソースの受け入れに転用しない。

## 10月6日の実装と現在の境界

クラウド・Web・npm配布の3担当と、編集しない独立レビュー担当で修正/再検証を実施。
認証refreshとlogoutの競合、認証サービス障害時のlogout失敗、同期基準版の流用、
所有者切替後の旧応答、新規保存の再送による重複、CLIの更新/復元の失敗処理を修正した。
保存UUIDを一時下書きに保持し、Cloudでも再送の安全検査/backup/同期版更新を省いて
保存済み結果を返す。対応ソースの私的DB/鍵/リンク混入を拒否し、公開受け入れの
ソース指紋をキャラ/プロンプト/共有UI/ビルド入力まで拡張した。

統合後のWeb119試験、型チェック/全体ビルド、Chromiumの認証/プロフィール/キャラ表示、
作成4条件、Electron9項目は通過。実推論・有料安全検査0。
Python全体618試験と費用47試験も通過。拒否/経路違反/切断等で既知実費が
落ちる欠陥を修正し、失敗時の利用者0消費、運営原価保持、超過時の要照合/次送信停止を確認した。
第3独立レビューの空UUID/既存編集再送/旧ownerの競合エラーも修正。
新規/既存編集ともUUIDを下書きへ保持し、内容と期待版の変更後は更新する。
第4レビューの初回profile読込後のowner切替もPUT前のepoch照合で修正済み。
SFW応答受信後の中止、原価不明後の追送、単発上限超過後の次操作の停止も修正。
第5独立レビューで対象4件を再現し、解消・追加欠陥なしを確認した。
配布の第6レビューでrenderer LICENSE収集のリンク拒否漏れと、更新/rollbackの
選択書換え失敗時に現Runtimeが停止する問題を追加。共通path検査と停止順序を
修正し、独立12条件で現PID/データ/両pointer保持と成功時のcommit後停止を確認。
対象追加所見なし。final4のnative/npm/Cloud候補を再生成・監査済み。
公式portable Node22.23.3でもCLI17試験と実npm tarballの隔離確認が通過した。
実機/公開download/実モデル/24時間運用は未受け入れ。
`operations.review_required=1` は再起動後も新規の有料送信を止める。請求/原価照合まで
解除しない。既知実費を保ち、停止のために架空の負債を作らない。
古い `final`/`final2`/`final3`候補はprovisionalとして保持。最新Windows/npm候補は
`.artifacts/launch-20261006-final4-packaging/REPORT.md` を参照する。
詳細と最終候補は [ローンチ前検証](validation/2026-10-06-launch-hardening.md)。
帰宅後にAndroid実機とクリーンWindowsを利用可能、Macは未提供。
[実機受け入れ手順](validation/2026-10-06-device-acceptance.md) と
`.artifacts/launch-20261006-final/evidence-template.json` を用意した。

今回のコードは本番へ未配布。下記の10月5日の稼働リリース/残高を、今回の修正の
本番受け入れとして扱わない。一般公開・npm公開・販売/広告・pushは行っていない。
10月8日に未コミット変更をテーマ別5コミットへ整理済み（未push）。

## 現在の目的・確定方針

- 無料OSS Core＋任意SFWクラウド。キャラクターの人格・記憶・世界・関係性が中心。
- 現在はひろなお本人1アカウントの個人テスト。Googleログイン成功済み。
  サブスク・追加購入・広告は無効。個人テスト中に販売を有効化しない。
- 運営モデルは **DeepSeek V4.1 Flash**。初月からOpenRouter → InferenceNet
  (`inference-net`) 固定、fallbackなし。OpenCode GoやMuseへ戻さない。
  送信先変更はデータ説明と再同意を伴う。
- ローカル推論/BYOKにクラウドアカウントやK-Creditsを必須にしない。
- 初回ローカル配布はnpmベータ（Node 22+、Windows 11 x64 / macOS Apple Silicon）。
  npm未公開、公開manifestは未準備。署名済みDesktop・GPU・Expoは後続。
- CloudはSFW限定。画像対応コードはあるが、実画像の安全精度/原価受け入れまで
  保存/同期を無効にする。Remote正式提供は外部セキュリティレビュー後。

## 完了したことと証拠

| 範囲 | 結果 | 記録 |
|---|---|---|
| VPS/認証 | 独立Cloud Runtime、HTTPS、Supabase/Google、本人ログイン、500 K-Credits単回付与 | [Web認証](WEB_AUTH.md)、[VPS初期設定](validation/2026-10-04-cloud-vps-auth.md) |
| アカウント設定 | 表示名・保存キャラ・ピン留めを暗号化保存。版競合409、所有者切替/別クライアント、バックアップ復元を検証 | [プロフィール同期](validation/2026-10-05-cloud-profile-sync.md) |
| プロット表示 | YAMLはサーバーに既存。CloudでのNSFW取得403を「存在しない」と表示していた問題を修正。エラー再試行も追加 | [キャラ表示](validation/2026-10-05-cloud-catalog.md) |
| 不要な保存 | チャットを開くのみでは設定を再保存せず、不要な安全検査を防ぐ。変更した設定は保存 | 同上 |
| 作成UI | zeta参考の6タブ、イントロプレビュー、文字数、固定保存操作、種類選択、一時下書き、JSONエラー保持 | [作成UI](validation/2026-10-05-plot-creator-ui.md) |
| モデル評価 | DeepSeek日英20ターン×3＝120/120の初回スキーマ成功、親しいRP24ターン＋対照2ターン。人手評価と長期品質は残る | [モデル品質](validation/2026-10-04-openrouter-quality.md) |

アカウント設定の同期とローカルCore→Cloudの任意転送は別機能。
後者は初期値オフで、自動アップロードしない。サーバー確定保存は利用者別DBへ、
作成画面の一時下書きは所有者/接続先別sessionStorageへ保存する。タブ内の下書きは
別端末へ同期しない。個人のローカルプロットを今回自動転送したわけではない。

10月5日のチェック：Web本番ビルド、関連フロントエンド11試験、catalog backend2試験。
作成UIは1440px/390px×ライト/ダーク4条件合格。130モックAPI要求・24モック保存、
実推論/有料安全検査0。HTTPS配信JS・Createの遅延JS/CSSはビルドと一致。
Cloud/Relay正常、匿名catalog401。コンテナ内の読み取りAPI確認は認証ownerを置換した
別ASGIプロセスであり、新しいGoogleログイン試験や実端末での受け入れではない。

## 次の作業（優先順）

1. **10月6日修正版のCloud配布**：本番は10月5日リリースのまま。新releaseと
   更新前の暗号化バックアップ、rollback先を用意し、既存Cloudだけ更新する
   （下記「現在の配布と復旧」）。health・匿名401・本人ログインを確認する。
2. **本人の実クラウド操作**：配布後の本番でGoogleログイン→プロット作成→保存→
   再読込→編集→会話開始。表示名・保存キャラ・ピン留めを別の本人端末で確認する。
   実際のCloud保存はSFW検査のAPI費用が発生し得る。下記の予算で管理する。
3. **台帳と人手品質**：送信前上限、予約、成功精算、失敗0消費、再取得の二重課金なし、
   実請求の照合。返答原文を人間が確認し、RPの未発言の過去の付加や記憶の誤りを評価。
   既に完走した120ターンを理由なく再送しない。
4. **実機・運用**：Android IME/ロック/回線切替/再接続、24時間運転、実VPSの
   同期/SFW/容量超過/復元とRelay負荷、独立保管先と別ホストでの復旧。
   PC退避と隔離復元の成功を災害復旧全体の完了と扱わない。
5. **npm・一般公開準備**：final4候補を使い、クリーンWindows/Mac
   のNodeだけで導入・再起動・更新失敗・復元。名称/ライセンス/対応ソース提供を確認。
   SMTP実配信、日英法務/保持・処理先条件と公開前チェックの証拠登録を完了する。
6. **公開拡張**：別工程として10人受付→72時間観測→100人。サブスクは本人の再指示と
   決済/販売/復元容量の受け入れ後。広告、Remote、後続機能は独立工程。

## 費用とデータの制約

- 累計API実費上限 **$0.10**。前回実費＋不確定予約を49,548,721ナノドルとして
  引き継ぎ、残り最大50,451,279ナノドル（約$0.05045）。新しい台帳を作って上限を
  リセットしない。実際の未処理予約/消費を確認し、検証と個人テストを並列送信しない。
- 本人の500 K-Creditsは$0.05の販売基準相当で、API実費$0.05ではない。
  6倍原価の料金係数、整数切り上げ、成功最低1/失敗0を維持。通常編集/同期は
  利用者0クレジットでも運営側の安全検査原価が発生し得る。
- 最終配布後の台帳スナップショット：アカウント1、残高500、生成operations0。
  付与済み。再付与不要。実費・予約・バックアップは再配布/月替わりで消去しない。
- 秘密env、本人メール/UUID、トークン、鍵、会話・記憶本文を出力/運用ログへ残さない。

## 現在の配布と復旧

- Cloud: <https://cloud.kyalulu.com> / Create: <https://cloud.kyalulu.com/#/create>。
- Relay health: <https://relay.kyalulu.com/healthz>。
- release: `/opt/kyalulu-cloud/releases/20261005-official-portraits/bundle`。
- image: `kyalulu-cloud:20261005-official-portraits`。
- rollback: `/opt/kyalulu-cloud/releases/20261005-plot-creator/bundle`。
- レイ先輩1枚・シオン執事2枚・モカちゃん（日常）2枚の公式画像を反映済み。
  詳細画面はサムネイル切り替え対応。[検証記録](validation/2026-10-05-official-portraits.md)。
- Compose project `kyalulu-cloud`、container `kyalulu-cloud-cloud-1`。
  `deploy/cloud/compose.yml`＋`compose.vps.yml`、release内の秘密`deploy/cloud/.env`。
  data/backup volumes: `kyalulu-cloud_cloud-data` / `kyalulu-cloud_cloud-backups`。
- SSH: 接続先・鍵・known_hostsのパスはリポジトリ外の非公開メモで管理する。
  `BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`,
  `KexAlgorithms=curve25519-sha256` と既存known_hostsを使用し、鍵の内容を読まない。
- bundle SHA256: `c0e604c6fe31ba5f4af052f821d357fdf670be15d791f9c78f1b7ff1d8890f67`。
- 更新前暗号化バックアップ: `.artifacts/official-portraits-vps/pre-update-verified.kybackup`。
  SHA256: `417aed69299d740b5015775b0e044e9461196ebc018e8e67071168bd87eaa27e`。
  `.artifacts` はGit管理外で、このcheckoutのローカル証跡。
- 既存Cloudだけ更新し、Relay/Caddyを再作成していない。次の変更も新releaseと
  更新前暗号化バックアップを用意する。既存ops.pyは特定release専用なので、そのまま
  deployを再実行しない。[VPS手順](../deploy/cloud/VPS.md)を参照。

## 実装の入口・必要時の検証

| 対象 | ファイル |
|---|---|
| 作成ページ/編集UI | `apps/web/src/pages/Create.tsx`, `create.css`, `components/PortableEditor.tsx`, `portableEditor.css` |
| キャラ表示/チャット | `apps/web/src/lib/api.ts`, `pages/CharacterEntry.tsx`, `pages/ActiveChat.tsx`, `lib/errors.ts` |
| アカウント/Cloud画面 | `lib/accountProfile.ts`, `components/CloudSettings.tsx`, `pages/Profile.tsx`, `runtime/python/cloud/account_profile.py` |
| 認証/課金なし個人テスト | `runtime/python/cloud/auth.py`, `config.py`, `store.py`, `meter.py`, `generation.py`, `scripts/cloud_admin.py` |
| モデル/同期 | `runtime/python/providers/openrouter.py`, `cloud/router.py`, `cloud/sync.py`, `cloud/transfers.py`, `api/cloud_sync.py` |
| 回帰/画面確認 | `tests/test_cloud_catalog.py`, `tests/test_cloud_account_profile.py`, `scripts/verify_cloud_profile.py`, `verify_cloud_catalog.py`, `verify_plot_creator.py` |

作業内容に応じた最小限の確認を選ぶ。以下は再検証コマンドで、ドキュメントを読んだだけでは再実行不要。

```powershell
pnpm --filter web build
pnpm --filter web test src/lib/cloud.test.ts src/lib/accountProfile.test.ts
.venv/Scripts/python.exe -m pytest tests/test_cloud_catalog.py tests/test_cloud_account_profile.py -q
.venv/Scripts/python.exe scripts/verify_plot_creator.py --output .artifacts/plot-creator-recheck
# 証拠未登録ならexit 2。公開や承認フラグを変更しない。
.venv/Scripts/python.exe scripts/check_launch_readiness.py --backend openrouter --phase cloud_first_ten
```

作業ツリーは10月8日時点でclean。今後もユーザー変更を保持し、commit/push/reset/switch/stash/cleanは依頼なしに行わない。
今回も実装担当と独立レビューを分離した。新しい担当を立てる場合も共有ファイルを
同時編集しない。日本語、ひろなお、シアンの会話方針を維持する。

## 新スレッドへ貼る文

> Kyaluluの続きをお願い。まず `docs/HANDOFF.md` を読んで、本人限定クラウドの実操作・
> 台帳確認からローンチ準備を続けて。モデルはDeepSeek V4.1 Flash / OpenRouter /
> InferenceNet固定、サブスクはまだ不要。累計API実費上限$0.10と既存台帳を維持し、
> dirty変更を保護して、実装済み・モック検証・実機/本番受け入れを分けて進めて。
