## 2026-10-12 通常送信をワンクリックへ変更、本番反映・実生成成功

画像の「送信内容を確認」は毎回の見積確認Dialogで、外部安全検査の廃止とは別の残存UIだった。
共有のstreamChatは通常quoteを検証したら直接送信し、onQuoteで送信先・消費上限をチャット内へ表示する。
Baiduだけ送信ごとの保存・学習同意をインラインで確認。新しいquoteは未チェックから始まり、取消は下書きを保持する。
quote期限・所有者epoch・abort・生成ID・料金上限・運営累計$0.10を維持。クレジットholdと外部SFW検査は追加しない。
同意説明を実際の導線に合わせた。保存・送信先・課金条件を拡張しないため、既存v5同意は有効なまま。

関連7ファイル90テスト、型検査を含むWeb build、Mock Chromium48画面条件が通過。
通常モデルはクリック1回→POST1回→保存結果取得、確認Dialogは一瞬も出ないことをMutationObserverで確認。
Baidu未同意・毎回reset・取消・期限切れ・owner失効、下書き、320/390/1440pxと390x600、ライト/ダーク、Tab操作を確認。
Mockの完了後statusを404としていた試験不備を修正し、履歴保存を照合する実際の復帰経路まで通した。
親側の試験待機式の構文エラーも修正し、最終実行はpageerrors/blocked requestsとも0。実有料推論はMockで0。
証拠：`.artifacts/cloud-production-20261012/one-click-mock-ui/acceptance.json`。

配布物SHA256 `1355f0bd0011ef1bb0e9135e83fb85f5dd6935cfdf796f44127919604d7931be`。
source fingerprint `3663095d87976157c510adaf6264c5562e0f497cc35eb54514052bf1305319ce`。manifest180 / runtime100 / Web57 / corresponding source378を監査。
更新前暗号化backup SHA256 `513e2d5d1c06515f93accdb2ccb05c07a82b241d48639f9a743191133eaaee91`。PC複製、隔離復元、DB integrity、437クレジット・25operation・audit3保持を確認。
本番release：`/opt/kyalulu-cloud/releases/20261012-one-click-chat/bundle`。
本番配信assets16件・対応source公開物が配布物と一致。health/Relay、匿名private401・guest200を確認。
本番HTTPS6画面条件通過、pageerrors/blocked0。認証済みワンクリック操作はMockで確認、本番ブラウザーはゲスト画面と同意説明を検証。
新規の専用架空sessionでGLM/InferenceNetを1回実生成。compiled promptは4,204 bytes以上、quote原価上限$0.006以内を確認して実行。
52文字の返信、API実費$0.000196870・12 K-Credits。保存・同一IDの再取得、生成原価と残高の増減の一致、追加課金なしを確認。
実生成後425 K-Credits、保守累計$0.066416409、残余$0.033583591。pending/holds/debt/review0。過去原価の減額・予算resetなし。
既存の本人チャット本文・設定・モデルは変更していない。本人の新版Pixel/Chrome、Baidu429解消、他モデルの実生成は未確認。
PWAの既存画面は通常reloadだけでは古いshellが残る場合がある。「アプリ情報」→「更新を確認」→「更新して再読み込み」で新版を適用する。
証拠：deployment-acceptance.json / live-browser-acceptance.json / recovery-real-generation-acceptance.json / ledger-after-one-click.json。
以下は各旧時点の記録。

## 2026-10-12 予約廃止・外部安全検査廃止を本番反映

最新ユーザー要求が以前の予約／検査維持方針を更新したため、ユーザークレジットのholdと入力・出力・作品保存の外部SFW APIを廃止。
残高から最大生成量・総費用上限を求め、成功時だけ実費精算する。生成量を下げても入力自体が残高を超える場合は不足として扱う。
一ownerにつきpending1件、見積の期限・送信先・Baiduの送信別学習同意、同一IDの無料再取得を維持。
運営原価のfund holdは累計$0.10を守るため内部で維持し、利用者のクレジットはholdしない。
生成中の期限切れ・払い戻しによる精算不足はcredit_debtsとして保持し、後続残高へ反映。架空の残高増加は行わない。
外部検査なしをv5説明で明示。認証・Origin・所有者分離・構造検証・SFW宣言は維持。画像アップロードは未検証で閉鎖。
外部の内容分類を外したため、以前のSFW検査による受け入れ結果は新版の公開安全運用を証明しない。

欠落請求は全operationの原価上限を保守計上し、bounded_cost_retentionsに観測額・保持額・理由を保存。
不正counter・不正cost・減少請求・per-call overrun・台帳不明crashは引き続き停止。不正usageをmissing_costへ分類しない回帰試験を追加。

最新停止はBaidu429でfailed。native結果hash・operation fingerprint・費用・全期間key billing snapshotを照合し、
原価1,174,649 nanoを上限5,476,997 nanoへ増額保持した。減額／0課金断定はしていない。
監査provider_cost_reviewsは3件。再実行で二重計上なし。Baidu上流の利用制限自体は解除していない。
復帰後は463 K-Credits、累計保守計上$0.065799139、残余$0.034200861、pending／holds／debt／review0。

本番release `/opt/kyalulu-cloud/releases/20261012-direct-generation/bundle`、image `kyalulu-cloud:20261012-direct-generation`。
配布物SHA256 `8563512de9842b5e1f8383ed07bd35b81412c1b140597a535fdf8abd3abafeb9`。
配布時のsource fingerprint `d9e1768e4e3642a83b667c629b3937c211cb30241ed8d9b1f495d044004d163b`。
manifest180／Runtime100／Web57／corresponding source378件を監査。
暗号化backup SHA256 `d9877a2cfcfb22791eddbc9efad69aeb525b3cb19a665671ec305666aaf9c443`。
PCへ複製し、隔離復元・DB integrity・accounts／credits／operation原価／旧review／audit2件の保持とadditive migrationを確認。
Relay／Caddy維持、本番assets16件・source公開物・health一致。匿名private API401とguest200を確認。
関連Python282件、最終修正と追加監査・復帰140件（重複あり）、Web95件・build、Mock50画面条件を通過。
本番HTTPS6条件も通過。復帰操作中のCloud停止とブラウザー試験が一度重なり、待機タイムアウトになったが、復帰完了後の再確認は成功。

実生成・本人実機はv5再ログインを依頼して待機中。既存チャットの本文・設定・モデルは変更していない。
実設定のcompiled promptは本文を読み出さずサイズだけ4,204 bytesと確認。実生成はこれ以上の架空設定量で専用sessionを使う。
現在は追加有料生成0。過去のGLM成功を新版の実生成成功とは扱わない。

# Cloud本番反映と実機・実生成確認 — 2026-10-12

ユーザーが本番反映と既定の累計API実費$0.10内での検証を承認。
本人限定private test、signup1、販売・広告・媒体保存の無効設定を維持した。
最初の更新で500 K-Creditsを保持し、本人の実生成後は474 K-Creditsを保持して追加UI更新を行った。
後続の復旧検証で11 K-Creditsを精算し、最新残高は463。以下の以前の実機記録は各版の結果として扱う。

## 本番反映済み

- release：`/opt/kyalulu-cloud/releases/20261012-cost-recovery-v2/bundle`
- image：`kyalulu-cloud:20261012-cost-recovery-v2`
- 配布物：`.artifacts/cloud-production-20261012/cloud-release/kyalulu-cloud.tar.gz`
- SHA256：`20381502e0b61520676cbbfc772412ea97515919f317fa3261da83e7ced395e4`
- ソース指紋：`bf81cf175c8d67d0df9ea4d6f7ac964f426b04375ead5c8808fcd6a68c57d26f`
- 更新前暗号化backup：`.artifacts/cloud-production-20261012/pre-cost-recovery-v2.kybackup`
- backup SHA256：`535d61b227dc942a3b5e2d7bd48d5781b67f2fbfc7e04e60b39a8af650d6791d`

summary-order版とcost-recovery-v1版の配布記録・暗号化backupも別名で保持。

直前chat-ui版の配布記録はpackage-chat-ui-acceptance.json／deployment-chat-ui-acceptance.jsonへ保持。
直前backupもpre-chat-ui.kybackupへ保持。以下の以前の生成・実機確認は各版の記録として扱う。

前のquote-ui版の配布記録はpackage-quote-ui-acceptance.json／deployment-quote-ui-acceptance.jsonへ保持。
前のbackupもpre-quote-ui.kybackupへ保持し、追加更新時の上書きから保護した。

Cloudだけを停止し、暗号化backupを作成・PCへ複製・ハッシュ照合した。
隔離した一時領域への復元、DB integrity、追加migration、会計値保持を確認後に反映。
Relay／Caddyのcontainer IDは維持。旧hash付きWeb assetsは更新待ちのクライアント用に保持。
旧releaseとデータ・backup volumeを保持する。旧版の費用停止・削除保護は不足するため、
失敗時はCloud停止とし、旧版を通常運転へ自動復帰させない。復元は新しい空の保存先で行う。

旧会話backupの復元直後に追加DB項目が欠ける問題も修正。
restoreでownerの初期化済み印を解除し、復元・migration成功後に再登録する。
一時migration失敗は503を返し、次アクセスで再試行できる。関連24試験・独立再レビュー成功。

## 本番の読み取り確認

配信Web assets16件・index・Service Worker・対応source archiveが配布物と一致。
Cloud／Relay health、匿名の私的API401、ゲストcatalog200、Cloud capabilities、v4同意説明を確認。
HTTPSの実ブラウザーでも320／390／1440px・light／darkの6条件でゲスト詳細・ログイン同意gateを確認。
モバイルの5タブ、ホームの44px以上の操作領域・詳細からの遷移・選択中表示も確認。
API応答はmockせず、外部navigation／mutationは遮断。pageerror0、遮断された想定外要求0。

当時の要約位置更新後の台帳・保存済み生成は更新直前と一致：accounts1、credits474、operations16、
実費または保守計上額2,457,387 nano、過去計上49,548,721 nano、pending／holds／debt0、review1。
Relay／Caddyのcontainer IDも同一。未知の過去費用を減額・resetしていない。
当時の保守的累計 **$0.052006108**、上限まで **$0.047993892**。最新値は後述の復旧検証を参照。
旧6件の実請求は未照合。新規未知費用・超過はreview_requiredで追加送信を止める。
本番反映・ゲスト検証での有料生成0。

## キャラ・プリセットと待機UIの追加改善

ModelSelectorはモデル名と送信先、保存・学習の重要告知を常時表示。
モデルID・推論・価格・保存条件全文は初期closedのdetailsへ整理し、モデル変更時には閉じる。
PortableSessionControlsは既存k-inputへ統一し、読込中・取得失敗・空を区別。
表示できない既存の選択も保持し、固定revisionの更新は明示操作に限定する。
Sheetはヘッダ固定・本文スクロール、summaryのキーボード操作・focus循環・Escape復帰を確認。

通常待機は「返事を待っています…」と既存Kyaluluマスコットのアニメーションへ変更。
動きを減らす設定では停止し、読み上げ文はstageや秒数で変えない。researcherの診断stageは維持。
SFW検査・見積・送信ごとの学習同意・費用保護・取消・復旧は維持し、未検査本文を表示しない。

Web248試験・型検査を含むbuild成功。Mock Chromium50画面条件でプリセット、見積、待機を確認。
待機はoutput_safety progressと未検査tokenを含むMock SSEを保持して検証し、token非表示、
reduced-motion、doneで本文表示・待機消滅を確認。実Provider推論0、外部要求0、pageerror0。
候補bundleはmanifest180・Runtime100・Web57・対応source378件を照合し、本番配信との一致も確認。

## 実機・実生成の結果

既存ADBは利用できたが接続端末は0。ユーザーは手元のスマホで操作可能と回答。
本人のPixel／Chrome操作でサイト・チャットが開き、実返信が来たと確認。
日本語の変換確定で勝手に送信されない、reload後も返信が残る、画面ロック復帰でも会話が見える、
の3項目は本人回答「全部OK」。これらはquote-ui版への実機確認であり、追加UIの確認とは区別する。
追加更新後のホームボタンとプリセットの折り畳みも、本人Pixel／Chromeで「ホームとプリセット、両方OK」と確認。
この確認に追加の送信・生成は求めていない。待機アニメーションの実機表示は別途未確認。

サーバー側では本人のv4同意更新・Baidu経路のcompleted生成・保存・精算を確認。
会話本文は取得せず、返信69文字・生成status・同意receipt・会計値だけを証拠にした。
実生成1件のAPI実費は430,696 nano（**$0.000430696**）、26 K-Credits精算、残高474。
この成功時点では新しいreview_required・pending／holds／debtなし。公式summaryはこのBaidu経路ではunsupported。
旧6件の未知費用465,560 nanoは全額維持。追加の安全検査失敗にも費用は記録済みだが、失敗理由は未判定。

待機アニメーションの実機表示、他モデルの実routing／公式summary・品質比較、回線切替・長時間運用は未確認。
スクリーン幅を指定したPCブラウザーの結果をAndroid実機の結果へ繰り上げない。

証跡は`.artifacts/cloud-production-20261012/`のbefore.json、backup.json、restore-check.json、
package-acceptance.json、deployment-acceptance.json、ledger-post-deploy.json、live-browser-acceptance.json、
restore-tests.logとスクリーンショット、real-generation-acceptance.json、physical-android-acceptance.json、
chat-ui/acceptance.json、chat-ui-state-acceptance.json、ledger-before-chat-ui.json／ledger-after-chat-ui.json。
Git commit／pushなし。旧failed判定をSFW拒否や料金不明の証明として断定しない。

## 公式推論要約の表示順と返信停止の調査

通常チャットとVNの要約を本文の上へ移動。初期closed、編集中・生成中の非表示を維持。
対象Web43試験・build、Mock Chromium50条件で要約の実DOM順、再読込、未検査本文非表示を確認。
本番assets16件・対応source一致、HTTPS6条件を再確認。会話・台帳・Relay／Caddyは更新前後で一致。
実Provider生成0。この版のAndroid表示と公式要約対応モデルの実生成は未確認。

本人提供のOpenRouter upstream詳細画像は、10月12日01:10 JSTのBaidu Qianfan呼び出しを429、試行1、192msと表示。
Kyalulu生成`2cd79fa2-d163-43af-90e5-2a4c78832ead`は`provider_usage_unavailable`でfailed。
保守計上1,178,569 nanoを維持、K-Credits消費0、ユーザー・assistant本文未保存。
review1が永続化して後続送信を停止しているため、残高不足とは区別する。
画像には請求額なし。転記IDへのGET generation明細は404、当日activityはUTC日集計未完了で400。
APIキー・会話本文は取得結果へ出力していない。追加推論・費用減額・停止解除・自動fallbackは行っていない。
429だけで費用0を断定せず、OpenRouter明細との照合と監査可能な復帰操作を残課題とする。

新証跡：summary-order-tests.log、summary-order-ui/acceptance.json、pre-summary-order.kybackup、
summary-order-state-acceptance.json、ledger-reply-stopped.json／ledger-after-summary-order.json、
reply-stop-errors.json、provider-upstream-evidence.json、provider-generation.json／provider-activity.json。

## Cloud返信の復旧と実生成 — cost-recovery-v2

個別明細404・当日activity集計未完了のため、OpenRouter GET /api/v1/keyの最新総額を別経路で照合した。
復帰時のキー総額45,729,381 nanoは保守累計以内。旧OpenRouter試験の実費44,646,750.2 nano＋未知予約を
prior49,548,721 nanoとして引き継いだ根拠も再確認した。キーの月$50 limitを累計$0.10の強制上限とは扱わない。

管理CLI `retain-failed-reservation`は停止中のprivate OpenRouter環境だけで実行する。
RuntimeLock、最新キー総額、対象UUID/fingerprint/旧原価/予約上限、tenant失敗記録を照合。
429は本人画像hash・upstream生成IDと作成時刻、404は永続化したSFW失敗のcanonical hashを証拠にする。
不正cost/usage、単発overrun、pending/holds/debt、不一致証跡は解除しない。
原価を全operation予約上限へ増額し、同じtransactionで一意の監査記録を保存してreviewを解除する。
個別実費は未確定のまま`receipt_unavailable`を監査basisに残し、0と捏造しない。再実行はGETなし・増額なし。
監査のkey fingerprintは鍵本体を含まず、APIキー・会話本文は運用出力へ残していない。

最初の復帰でBaidu失敗を1,178,569→5,430,562 nanoへ増額。GLMでの確認を開始したが、
入力検査がHTTP404になり、269,726 nanoを保守計上して再停止した。生成本文の送信・保存は未実施、K-Credits消費0。
公開endpointを再確認すると、SFW固定経路DeepSeek/InferenceNetの出力価格が$0.40→$0.66/Mへ改定され、
旧max_priceでは該当経路が除外される状態だった。cap、予約単価660 nano/token、UI価格、tariff versionを更新した。
送信先は維持し、旧見積のfingerprint差で再見積りを必須にした。
404失敗も269,726→3,595,466 nanoへ増額して監査付きで復帰。未知費用の保守増額合計は7,577,733 nano。
新規失敗はmissing/invalid cost・invalid usage・単発overrun・429を区別して保存する。

新しい固定IDの架空会話をGLM 5.3 Flash/InferenceNetに送信し、completed・32文字の返答を確認。
入力SFW→生成→出力SFW→保存が通り、保存status確認と同一ID再取得の追加課金0をassertした。
運用確認専用sessionだけを作り、個人の既存チャット設定・本文・記憶は変更していない。
既存履歴3件を保持し、検証専用のuser/assistant2件だけを追加。実費173,499 nano（$0.000173499）、11 K-Credits。
OpenRouterキー総額45,729,381→45,902,880 nanoの増分も173,499 nanoで一致する。
最新台帳：accounts1、463 K-Credits、operations18、prior49,548,721 nano、保守累計60,027,066 nano、
残余39,972,934 nano、pending/holds/debt/review0。二つの監査記録を保持。

関連Python109試験＋復帰56試験、Web19試験・型検査/build、Mock Chromium50条件成功。
二名の独立レビューで追加指摘を修正。監査更新の一括rollback、再起動・復元・GETなし再実行を確認。
新版の暗号化backupをPCへ複製し、隔離復元でDB integrity、accounts/credits/費用/review/既存監査1件保持を確認。
本番assets16件・対応source・health・匿名401/ゲスト200、HTTPS6条件を再確認し、Relay/Caddy IDも維持。
本人Pixel/Chromeの今回の返信確認は依頼中。Baidu429の解消、他モデル、公式要約の実生成は未確認。
自動fallback・未知費用の自動解除・予算resetはしない。Git commit/pushなし。

復旧証跡：provider-baidu-review-acceptance.json、provider-cost-review-acceptance.json、provider-cost-reviews-final.json、
provider-404-review-evidence.json、provider-price-recheck.json、cost-recovery-tariff-tests.log、
cost-recovery-ui/acceptance.json、recovery-real-generation-acceptance.json、cost-recovery-state-acceptance.json、
ledger-before-recovery.json／ledger-before-tariff-recovery.json／ledger-after-cost-recovery-v2.json。
