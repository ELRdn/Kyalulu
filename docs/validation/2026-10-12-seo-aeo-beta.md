# SEO・AEO・無料βの準備記録 — 2026-10-12

状態：**日英SEO・AEOと同意付きGA4を実装。SEOサイトを先行公開。一般βはBLOCKED。**
この記録は法務承認、10人の募集・登録開始、実GA受信、72時間観測の完了を意味しない。公開・更新の検証結果は末尾に区別して記録する。
一般受付に必要な予算・運営者情報・実機／実モデル・運用証拠は未確定。

## 法務・β準備の担当範囲と根拠

- 法務・β準備担当の変更は `apps/web/public/legal/{terms,privacy,credits}.html` と `legal/en/` の同名3ページ、本記録、`scripts/seo_weekly_report.py`、`tests/test_seo_weekly_report.py` の9ファイルのみ。
- 以下は法務・β準備担当の作業記録。SEO／GA4実装・配備の全体記録は末尾を参照する。既存の他担当の作業差分を保持する。Git操作、追加の有料推論、月次補助開始、私的予算resetは行わない。
- `docs/HANDOFF.md` の最上部「通常送信の毎回確認を撤去、本番反映・実生成確認」と、その直後の「予約廃止・外部安全検査廃止」を読んだ。以下の旧SFW検査・確認画面・予約説明は現仕様として扱わない。
- 実装を読み取り照合：`runtime/python/cloud/{auth,app,config,contracts,generation,model_choices,store}.py`、`runtime/python/providers/openrouter.py`、`apps/web/src/lib/cloudDisclosure.ts`、`runtime/python/cloud/release_readiness.py`。
- SEOの以前の作業は `docs/validation/2026-10-06-seo-search-console.md` を参照した。過去の索引申請やサイトマップ状況は今回Google上で再確認していない。

### 公開statusの今回の読取

2026-10-12 15:02:59 JST、匿名GET [Cloud status](https://cloud.kyalulu.com/api/cloud/status) を実施。有料生成・認証操作なし。

| 公開値 | 読取結果 | 意味・限界 |
| --- | --- | --- |
| `private_test` / `registration_limit` | `true` / `1` | 現在は1所有者の私的テスト。上限1は実アカウント数の取得ではない |
| `login_available` / `inference_available` | `true` / `true` | 私的提供の可否。一般入場や全モデルの実生成受け入れではない |
| `billing_available` / `ads_available` / `images_available` | すべて `false` | 販売・広告・画像を提供中と告知しない |
| `sfw` / `safety_screening` / `credit_reservation` | `true` / `false` / `false` | SFW宣言と外部内容分類を区別。利用者Creditを予約しない |
| 説明version | `2026-10-03-provider-routing-v2-openrouter-model-choices-v5-direct-generation` | 一般の旧同意は新説明の代用にしない |
| 各追加経路の `acceptance` | `mock_verified_live_pending` | `available=true`でも6経路の品質・実routingが実証済みとはしない |

statusの標準はDeepSeek V4.1 Flash／InferenceNet。追加は次の6経路で、すべてOpenRouter経由。

| route ID | モデル／指定upstream | 保持・学習の説明 |
| --- | --- | --- |
| `cloud-deepseek-baidu` | DeepSeek V4.1 Flash／`baidu/fp8` | 保存・AI学習／改善を許可。**毎送信、未チェックからの別の明示同意**が必要。保持期間・地域・経由契約は未確認 |
| `cloud-deepseek-decart` | DeepSeek V4.1 Flash／`decart/fp4` | training-purpose collectionを拒否するリクエスト。実保持・地域・契約は保留 |
| `cloud-deepseek-inferencenet` | DeepSeek V4.1 Flash／`inference-net/fp8` | 同上 |
| `cloud-glm-inferencenet` | GLM 5.3 Flash／`inference-net/fp4` | 同上 |
| `cloud-gpt-luna-flex` | GPT-6 Luna Flex／`openai/flex` | 学習目的collection拒否。statusには通常最大30日の入力／応答監視ログと法令・安全上の延長を告知。経由契約への実適用は未確認 |
| `cloud-claude-haiku` | Claude Haiku 5.5／`google-vertex/global` | 学習目的collection拒否・ZDR要求。globalの地域・実保持・契約は保留 |

この表の確認はstatusとローカルの要求方針の照合であり、提供元の契約文書や保持実態の独立監査ではない。
Baiduは `data_collection=allow`、他経路は `deny`、HaikuのみZDR要求。全経路一律「学習しない」「保持ゼロ」は不正確。
SFW宣言・構造／owner検証は残るが、入力・出力・保存の外部SFW呼出はない。通常送信は直接開始し、チャット内へ経路と上限を表示する。
Baidu同意はログイン・履歴保存・analyticsと分離し、取消・期限切れ・owner変更で再利用しない。自動fallback・失敗送信の自動再送なし。
18+は申告と確認済みメール認証であり、公的年齢／本人確認の証拠ではない。
公開Communityは `community_enabled && legal_approved && !private_test` の実装条件で現在提供外。匿名statusにlegal承認値そのものはなく、今回承認したとは扱わない。

### Gate audit

今回、法務6ページの更新後に次を**実行**した。受け入れevidence JSONは未提供であり、既存の私的生成ログをgateへ自動転用していない。

```powershell
.venv/Scripts/python.exe -B scripts/check_launch_readiness.py --backend openrouter --phase cloud_first_ten
```

結果：`cloud_first_ten.ready=false`。必要8gateは `authentication`, `isolation_sync`, `models`, `android`, `operations`, `legal`, `licenses`, `openrouter` がすべて `pending`。
この時点のソース指紋：`595605767e47ffeef9073e7f48b1598a69051c9d13b9206cb511f64d5310fa9f`。
並行作業中の一時スナップショットであり、最終配布物／本番の指紋ではない。
ツールはBLOCKEDを非成功で報告した。成功扱いしない。これは証拠登録の監査で、実機・実API・運用の再検証ではない。

既存gateには旧方針のSFW画像等も記載されている。画像提供を今回承認せず、新方針の証拠要件との整合を親担当で確認する。
72時間pilotは100人段階のgateでもあるが、10人キャンペーンの完了条件としても記録する。
法務6ページの `noindex` と未承認表示を維持し、legal／販売／一般入場フラグを変更していない。

## 無料β10人の資金計算

### CreditとAPI原価を分ける

根拠は `contracts.py:TARIFF.credits()`、`store.py:trial()/admin_grant()/reserve()/settle()` と `config.py`。
1 USD = 1,000,000,000 nano USD、1 Creditの名目価値 = 100,000 nano USD = $0.0001。
markupは **6**。成功時は `max(1, ceil(actual_cost_nano * 6 / 100000))`、失敗は利用者0。
1,000 Creditsは名目$0.10であり、運営がAPIへ$0.10支払える残高ではない。

| 区分 | 1人 | 10人 | 用途 |
| --- | ---: | ---: | --- |
| 単回試用Credit | 1,000 | 10,000 | 30日有効。未提供、現在privateの自動試用は0 |
| 名目小売価値 | $0.10 | $1.00 | Creditの基準価値、現金支払い／返金約束ではない |
| 各人の成功原価上限（整数nano） | 16,666,666 | 166,666,660 | `floor(1000*100000/6)` を各walletへ適用して合算 |
| `trial()`の付与資金判定（既存trial/ad未消費0の仮定） | 16,666,666 | **166,666,666** | `(existing_liability + new_credits)*100000//6`。10人合計で$0.166666666 |
| `admin_grant()`の合計債務資金判定（他債務0の仮定） | 16,666,667 | **166,666,667** | ceilで判定し、全有効lotと旧credit holdも含む。trialと混同しない |

理論値は10人で$1/6 = $0.166666…、実装は整数nanoで計算する。trialの合計判定と各人上限合計の差は6 nanoで、adminのceil判定との差は1 nano。
既存のtrial/ad未消費lotがあればtrial判定に加算される。既存admin等を含む全Credit、旧hold、debtもβ資金計画へ含める。
上記は10人全員へ新たに1,000を付与する場合。既存ownerを10人に含めるか、現ownerとは別に10人かを確定し、登録総数と追加付与数を分ける。

`trial()`は単回・30日・資金不足時は付与しない。付与確認をせず1,000配布済みと告知しない。
`reserve()`という内部名でも現在利用者Credit holdは作らず、ownerにつきpending1件、運営の `fund_holds` と原価上限は維持する。
費用不明・不正・overrun・要照合を利用者0消費だから原価0とは扱わず、既存の保守計上と停止を保持する。

### 現在のprivate枠と別の運営費

最新HANDOFF記録では累計上限 **$0.10**、保守累計 **$0.066416409**、残余 **$0.033583591**。
この残余は今回の認証済み台帳取得値ではなく、最新引き継ぎ値。変更前に親担当が現台帳・hold・debt・reviewと照合する。
残余だけでは10人trialの$0.166666666を満たさない。privateでは単一allowlist・登録1・trial0が強制される。

`_subsidy()`のprivate処理は全期間の累計枠で、`prior_cost`をMAXで永続化し、`prior + completed/failed actual_cost + fund_holds`を控除する。
非privateでは月次 `subsidy:YYYY-MM` をJSTで作り、nano額は `monthly_subsidy_jpy*1000000000//usd_jpy`。
configの既定3,000円／USD200なら月$15だが、**現サービスが月$15を資金確保済みという意味ではない**。
private解除だけでこの既定月次付与が動き得るため、親担当は選択した実資金と設定を照合してから移行する。今回は解除・月次補助有効化・残高resetをしない。

β費用表は次の独立した枠を埋める。Creditの名目$1を総運営費としない。

| 枠 | 予定／現在 | 確定に必要なもの |
| --- | --- | --- |
| 10人の成功生成資金 | trial判定166,666,666 nano、保守ceil基準166,666,667 nano以上＋既存債務 | 実台帳、付与方式、人数と入金原資 |
| 失敗・未知請求・上限余裕 | **未確定** | 停止上限と金額、費用照合担当、専用キー明細。利用者失敗0でも運営原価は残る |
| VPS・Relay・保存・offsite backup・メール・監視／サポート | **未確定、上記とは別予算** | 実請求・容量・保存期間・72hおよび月の承認額 |
| 既存private累計 | 引き継ぎ値$0.066416409、上限$0.10を保持 | 現台帳と専用キー原価の照合。旧不明費用を減額・resetしない |

## 72時間キャンペーン（未開始）

一般βの必要gateと運営情報・資金が確定した後、親担当が入場を決める。ここでは募集・自動監視を始めない。

1. 開始前：最終source／bundle／本番assetsを照合。10人の定義、地域・18+申告、招待範囲、無料1,000単回、原価上限・運営費、停止／連絡担当を確定。backupを別環境で復元し、owner分離・期限切れ／取消・Baidu別同意を確認する。
2. T0：開始・終了の時刻とtimezone、release/source、台帳集計、signup上限と資金上限を記録。認証から初保存まで各人10分以内を目標に計時し、目標と実績を区別。本文・ID・メールを公開記録へ出さない。
3. T+24／48／72h：担当者が手動で集計。新規認証、初生成・保存、再訪、重複精算、失敗理由、遅延p50/p95（件数付き）、pending/hold/debt/review、実請求、予算残余、VPS／Relay、backup復元、問い合わせを確認。同意したGA4利用者の集計と全Cloud台帳集計を分離する。
4. 成功条件：対象10人の記録、onboarding目標の実績、72h完了、停止事故と対処、原価照合、復元、実機IME／画面ロック／回線変更の証拠が最終ソースに対応していること。未達／未参加を0件成功へ変換しない。観測中の変更は新指紋で再評価し、必要なら72hをやり直す。

**即停止条件**：owner間の漏洩・認証突破、解析やログへの本文／識別子／token流出、Baidu未同意送信／無断経路変更、課金重複・上限超過、未知／不正費用・review_required、資金不足、保存破損や復元不可、重大なSFW違反／安全申告。
停止対象は必要に応じ新規入場・生成・問題の計測送信。証拠と保守原価を保持し、自動fallback・費用減額・budget resetで再開しない。
継続する429、pending滞留、遅延悪化、onboarding失敗は拡大を止めて原因確認する。再開は対処と同じ条件での再検証を記録してから。

## 再現できる週次export・レポート

毎週、担当者が完了した同じ7日を取得する。自動monitor・scheduler・有料検索／推論は設定しない。
権限不明や未exportは `未取得`、フィルタ外・欠測は `不明` とし、0へ置き換えない。
以前の `sc-domain:kyalulu.com` 記録を権限が現在ある証拠とせず、今回必要なpropertyと閲覧権限を確認する。

### 1. GSC：表示回数／clicks

- GSC Search results、検索タイプWeb、完了した固定期間、国／端末／検索appearance条件を記録。日別ラベルと集計timezoneを記録し、GA4やJST台帳と無条件に同時刻だと扱わない。
- 公式サイトの集計は `https://kyalulu.com/` のhostに絞る。ドメインproperty全体を公式サイト／Cloud／PWAの混合値として出さない。必要なら別exportとし、重なる期間・hostを足し合わせない。
- CSV形式のZIPをexport。property、期間、filter、取得日時、担当、元ZIPのSHA256を私的記録へ保存。日別表を総数の基準にする。query/page/country/deviceは内訳であり合算すると重複する。匿名化queryや上位行制限により内訳の和が総数と一致しない場合がある。
- EN `Date,Clicks,Impressions` またはJA `日付,クリック数,表示回数` を含む日別表を1つ持つZIPのみ、今回のstdlib集計に対応。他言語／他schemaは手動で確認し、黙って0にしない。

以下は**例示コマンド、実アカウントexport未取得**。PowerShellで実ファイルへ置き換える。

```powershell
.venv/Scripts/python.exe -B scripts/seo_weekly_report.py '.artifacts/seo-weekly/2026-10-05/gsc-official.zip' --start 2026-10-05 --end 2026-10-11
Get-FileHash -Algorithm SHA256 '.artifacts/seo-weekly/2026-10-05/gsc-official.zip'
```

JSONは日付を両端含めて選び、clicks・impressions・重み付きCTR=`sum(clicks)/sum(impressions)`・欠測日数を返す。
複数ZIPを渡しても各exportを別々に報告し合算しない。行がない期間はnull、実データ0は0。欠けた日を0で補完しない。
ZIPを展開せず、100 entries／非圧縮合計10MiBまで。重複日、負数、不明な整数形式、複数日別表、列不足は拒否する。
filter情報・property・確定データ判定は担当者が確認する。日別表だけではAI引用数やGoogleのAI枠だけの表示／clickを分離できない。

### 2. GA4：同意したアクセスと転換

GA4 CSVの自動パーサーは今回追加しない。export形式・権限が不明なため、固定手順と下表で十分に再現する。
property ID・timezone・対象host・期間・filter・attribution scope・consent対象・threshold／sampling／遅延状態、CSVのSHA256を記録する。
標準CSVや探索の利用者・Session source/medium、固定参照元分類、許可した `utm_source/medium/campaign` 分類、固定eventの集計を手動exportする。
source/mediumやUTMの生値を自由入力で収集せず、親担当のsanitizerによる許可済み分類を使う。
GA4標準の生 `page_location`／`page_referrer`／自動pageview等が混ざらないことを同意前後・撤回後のnetworkで親担当が検証する。

| 入力／分類 | 記録方法 | 読める範囲 |
| --- | --- | --- |
| 固定AI source／referrerカテゴリ | 例：ChatGPT、Perplexity、Copilot、Gemini、Claude。検証したoriginまたは管理したUTMに基づくカテゴリごとにsessions／users／event件数 | **識別できたAI参照・campaignのみ**。全AI接触者とはしない |
| Direct／`(none)`／`(not set)` | 別行で件数を残す | AI経由へ推定・再配分しない |
| campaignカテゴリ | 許可済みUTMと配布先を記録 | campaignに付いた流入。provider自身が推薦した証拠ではない |
| 同意転換 | `sign_up`／`first_generation`／`save_success`／再訪等、親担当の実event名と重複排除定義を記入 | 同意した観測対象のみ。未実装eventは未取得。全登録数ではない |
| consent非対象・撤回・未計測 | 未取得／範囲外と記録 | 0人や未転換と扱わない |

解析scopeは公式サイトと運営Cloudのみで既定オフ、明示opt-inと撤回を要求。ローカル／Remoteに計測を入れない。
許可データは固定screen/eventカテゴリ、language、URL origin。本文・記憶・card/owner/session IDs・メール・tokenは禁止。
raw URLのpath/query/fragment、自由文字列を送らず、source/referrer/UTMは固定カテゴリへ変換する。
新規GA4やアクセス設定をこの担当は作成・承認していない。

### 3. Cloud：正式な利用者・台帳集計

運営者が認証された管理手順で `accounts`／`operations`／Credit・fund台帳の集計を取得する。匿名statusの上限、Supabase認証user数、GA4イベント数をCloud登録実数の代用にしない。
本文・個別owner ID・メールを共有レポートへ出さず、期間、総アカウント数、active利用者数、completed/failed操作件数、charged Credits、原価、pending/hold/debt/reviewをaggregateで記録する。
新規登録の週次実数は正式な時刻付き登録記録から取る。`accounts`の現schemaには登録日時がないため、総数スナップショットの差分は「純増減」であり新規登録件数ではない。
操作の期間基準（created／完了）も明示する。GA4へのowner識別子転送や個人単位joinをせず、正式Cloud全数と同意subsetを並べる。

### 週次の記入テンプレート

```text
対象期間／timezone：____ 取得日時：____ 担当：____
GSC property／host／Web・国・device・appearance filter：____
GSC ZIP SHA256／日別行数・欠測日数／確定・暫定：____
GSC impressions：____ clicks：____ CTR：____ 前週同条件：____
GA4 property／timezone／host／consent subset・attribution scope：____
GA4 CSV SHA256／sampling・threshold・遅延：____
AI source/referrerカテゴリ別 sessions・users・同意転換event：____
Direct／不明：____ UTM campaignカテゴリと配布先：____
Cloud正式総アカウント：____ 週次新規（根拠あり）／純増減：____
Cloud active owners／completed・failed／原価・Credit：____
pending／hold／debt／review／資金残余／ops費：____
AEO観測件数／リンク付き言及／誤説明／未取得：____
前週比較の限界（timezone・同意・欠測・source差）：____
次週に人が実施する対応と根拠：____
```

## 固定の非ブランドAEO質問（手動観測用）

ブランドを質問に含めず、JA／ENを別集計。同じ質問文字列を毎回使い、変更時は別系列にする。

| ID | 日本語 | English |
| --- | --- | --- |
| Q1 | キャラクターと会話できるオープンソースのローカルAIアプリは？ | Which open-source local AI apps let me chat with characters? |
| Q2 | 会話とキャラクターの記憶を端末内に保存できるAIアプリは？ | Which AI apps store conversations and character memories on my device? |
| Q3 | 自分のローカルLLMやAPIキーを使えるキャラクターチャットは？ | Which character chat apps support my own local LLM or API key? |
| Q4 | PCのローカルLLMをスマートフォンから使う方法は？ | How can I use a local LLM on my PC from a smartphone? |
| Q5 | キャラクターカードを移行して会話できるオープンソースアプリは？ | Which open-source apps can import character cards for chat? |

1観測につき `question_id / exact_prompt / language / provider / product・model / search enabled・mode / date-time・timezone / locale / fresh-session条件 / response evidence / cited links / mention / accuracy / correction` を記入。
search無効と検索付き回答を混ぜない。ChatGPT Search等の回答と通常検索エンジンの結果も別系列。利用権限のある無料の手動観測だけを対象にし、未実施・rate limitは未取得として残す。
引用は実際に表示されたリンク、順位は実際の検索結果で記録する。単なる製品名の言及をリンク付き引用に数えない。
accuracyは `正確 / 一部誤り / 誤り / 判定不能` と根拠を残し、local/Cloud/Remoteの違い、公開入場、18+、画像・広告・課金、学習／保持、記憶保証を現資料に照合する。
今回は質問への検索・AI実回答取得を行っていない。GSCやDirect流入をAEO引用成功の証拠にしない。自律monitorなし。

## 親担当への具体的な不足入力と引き継ぎ

| 不足入力 | 親担当が確認・記録する内容 |
| --- | --- |
| 運営・法務 | 正式名称／所在地／責任者／連絡先、β対象地域、準拠法・責任・停止条項、問い合わせ／開示／訂正／削除窓口、処理期限 |
| 保持・提供元 | 運営の会話／認証／台帳／ログ／backup保持と退会後削除、各upstream・OpenRouter・Supabaseの契約／処理地域、Baidu別同意、OpenAI告知の実適用、Vertex ZDR範囲 |
| Cloud管理権限 | 認証された集計取得担当と安全なadminアクセス、実アカウント／Credit／原価／hold／debt／review、現ownerを10人に含めるか |
| β予算 | 単回grant方法・実資金・最大API原価・失敗余裕、VPS等の別ops費、費用照合／停止／連絡担当。月次補助既定の扱い |
| GSCアクセス | 現property所有者・閲覧者、host/filter、実ZIP、取得日時・確定データ。以前の検索console記録だけでは不十分 |
| GA4アクセス | property／測定先・閲覧権限・timezone・保持設定、opt-in／撤回の実装、固定event／referrer／UTM分類、実CSV、同意前後network証拠 |
| 最終受け入れ | source指紋・bundle/source/assets照合、8gateのsource一致real証拠JSONとSHA256、実機、配備の承認／証拠、72h記録 |

## 今回実施した検証と未実施

- `python -B -m unittest discover -s tests -p test_seo_weekly_report.py -v`：**8 tests成功**。GSC日別だけの集計、JA/BOM、期間境界、欠測と0の区別、異常／重複export拒否、ZIP非展開／サイズ制限、CLIの非合算・AI推定なしを確認。すべて合成fixture。
- 新スクリプト `--help` 成功。対象ファイルの `git diff --check` 成功。標準ライブラリのHTMLParserによる法務6ページのnoindex・JA/EN言語・H1・相対リンク実在・更新日、privacyの6upstream名、旧安全検査／予約／本人年齢確認／保持日数の説明除去をassertで確認。実装ASTからmarkup=6を読み、10人trialのfloor／adminのceilとprivate残余の整数・Decimal計算も確認した。
- 公開status GETと上記gate監査のみ今回の外部状態／受け入れ確認。法務・provider契約の承認、実GA4/GSC取得、認証済み台帳、新たな有料推論、ブラウザー／実機、build、配備、72hは未実施。

### 親担当による追記欄（この担当は未実施）

- 最終source／bundle／assets指紋・対応ソース：未記入
- ローカル／ブラウザー／実機の検証コマンド・日時・結果：未記入
- opt-in analyticsの拒否／許可／撤回networkと許可payload：未記入
- 本番更新・status・認証済み台帳・backup復元の証拠：未記入
- 法務／資金／10人入場の受け入れ判断：未記入
- 72h開始／終了／停止／費用・所見：未記入

## 統合・公開の最終結果（2026-10-12）

### サイトと計測

- 日英LP、17ガイド、36 Docsページ／38 sitemap URLを既存Cloudflare Pages `kyalulu-landing` のmainへ公開。deployment: `e84c2e71`、公開先 https://kyalulu.com/ 。公開物は `.artifacts/landing-site` のみ。
- title/H1/description/OG、導入・モデル・SillyTavern移行・互換性・記憶・スマホ・Kyalulu CharacterBenchを更新。未公開npm手順と未稼働のメール受付を除去し、Cloud準備ガイドを追加した。
- 架空データ・隔離SQLite・Mockのみで会話の保存、CCv2取り込み・保存、記憶の登録・訂正・再読出しを実操作。960x720の3画像を公開。画像はモデル品質・想起品質の証拠ではない。
- GA4新規property `558473109`、Web stream `16110035796`、ID `G-14CZ0KMM2M`、JST／USD。公式サイトとCloudで共通利用し、ローカル／開発／Remoteでは無効。
- 同意前・拒否でGoogleタグ未読込、撤回後は送信停止とアクセス可能なGA cookie削除。アプリID・本文・認証URLは送らず、Cloud URLはoriginのみ。GA cookieによる仮名client ID・端末／IP処理は説明する。広告利用全307地域OFF、Signals／拡張計測／user-provided-data OFF。
- `chat_completed`をキーイベントとして登録。金額なし、キーイベントはセッションごと1回。生イベントの成功件数と区別する。会話API／保存形式を変更していない。
- 明示イベントはpage_view/local_install_guide_open/cloud_open/login/chat_completed/chat_reopened。公開ホームで解析同意してpage_viewのGoogle受理HTTP204を確認し、GA4リアルタイムでも `Kyalulu | landing` 1表示／1利用者を確認した。first_visit/session_startはGA4の標準集計として同時記録される。この検証訪問はSEO/AEOで獲得した訪問者ではない。検証後のブラウザーは解析拒否へ戻した。
- 公開後にCloudflareの既存RUM自動挿入を発見し、Kyaluluの自動挿入だけ停止。公開HTTPでbeacon不在を確認した。WAF等の保護設定は維持し、残る既知JSD挿入を配信本文と区別して検査する。

### 検証と独立レビュー

- docs build/check合格。全36 Docsページを1440／390px、主要経路を320px、検索・キーボード・日英・JS無効・storage拒否で確認。公開HTTPでも36ページ・38 sitemap、Bot UA8条件、canonical redirect、404・補助テキストnoindexを確認した。UA指定の取得成功をGoogleの実Botやインデックス処理成功とはしない。
- 実Googleタグを実行しtransportを遮断する22項目の検査が合格。秘密・CSP違反・browser errorなし。拒否、初回同意、JA/EN導入イベント、Cloud CTA、許可済みUTM、撤回12秒＋unload、遅延tag、通信失敗、非対象hostを確認。最終run中のsource/build変更なし。
- 関連Web73試験、公開応答／ソース指紋／配布ソース／GSC集計26試験、Cloud認証・匿名／owner分離60試験が合格。TypeScript／Web build成功。既存のバンドルサイズ等の警告は残る。
- 独立レビューP2の4件（Cloud CTA、初回同意時の導入ガイド計測、チャット間移動の再開計測、法務のURL説明）を修正し、レビュー担当が再確認した。
- 公開処理が検査中のbuild更新判定を引き継がず進んだため、同じ固定公開物で通信検査を再実行し、公開後照合まで完了した。失敗した途中runは証跡として保持し、最終合格と混同しない。

### Cloud反映とデータ保持

- 本番release `/opt/kyalulu-cloud/releases/20261012-seo-aeo/bundle`、image `kyalulu-cloud:20261012-seo-aeo`。
- Cloud bundle SHA256 `d2e2410023787efff718f1d69374d0667e434db51dcaa87d4126b861b4759f78`、source fingerprint `19125879c0197a5f0f2deb44ec63b2739394f473694c324f3601e59ad7aa111d`。manifest180件／Runtime100件／Web57件／対応source386件を照合。
- 更新前暗号化backupをPCへ複製しハッシュ照合。SHA256 `87cc80c115115b9545a66e61596135643c47788ec2c39752bf59b2218b0e1809`。隔離した保存先へ復元し、DB integrity・migration・残高・費用・履歴を確認。別ホストでの災害復旧完了とは扱わない。
- 本番assets16件とindex/SW/対応sourceを照合。Cloud／Relay health、匿名private401・guest200、noindex、HTTPS6幅/theme条件のゲスト／ログイン同意UIが合格。
- 前後で1 account、425 Credits、operations26、保守累計66,416,409 nano、残余33,583,591 nano、pending/debt/review0、会話履歴・同意・既存各種設定が一致。Relay/Caddy container ID維持。CaddyはCloudだけのGoogle接続許可を検証し、同じcontainerを短く再起動した。
- 新規有料推論0、一般受付1の本人限定、試用・販売・広告・画像の既存設定を維持。10人一般受付／100人／72h／販売は開始していない。

### 証跡

`.artifacts/seo-aeo-20261012/` の `analytics-browser/results.json`、`examples/acceptance.json`、`ga4/configuration.json` と `live-delivery.json`・`realtime.png`、`package-acceptance.json`、`backup.json`、`restore-check.json`、`deployment-acceptance.json`、`state-acceptance.json`、`live-browser-acceptance.json`、`cloud-mock-ui/acceptance.json`。公開HTTPは `.artifacts/docs-review-public/http-results.json`。

Git commit/push、依存追加、lockfile変更なし。新版Android実機・認証済み実会話／6経路品質・24h/72h運用は今回未実施。検索順位・AI推薦・1日500人の到達は検証していない。

### Search Consoleの今回の確認

既存 `sc-domain:kyalulu.com` のサイトマップ画面を読み取り確認。`https://kyalulu.com/sitemap.xml` は「成功しました」、送信2026/10/06、最終読込2026/10/08、検出36ページ。過去の「取得できませんでした」は今回の状態として扱わない。現在の公開38 URL／新Cloud2 URLのGoogle再処理・索引はまだ確認していない。再送・反復の索引申請は行わず、証拠は `search-console/status.json` と `sitemap.png` へ保持。

### 個人用PWAの検索除外

公開Cloudのindex metaは本番でnoindexを確認。Remote用 `app.kyalulu.com` は旧配信HTMLにnoindexがなかったため、旧UIを再配布せずCloudflareのhost限定レスポンスヘッダー変換を反映した。

- ルール `Kyalulu personal app noindex`、ID `41e349aa38674f9aa12b419753b596ad`、条件 `(http.host eq "app.kyalulu.com")`、静的設定 `X-Robots-Tag: noindex`。管理画面のアクティブ状態と本番HTTP200のnoindexヘッダーを確認。
- 公式ホーム・日英Cloudガイドはnoindexなし、Cloudのindex metaはnoindexのまま。証拠は `cloudflare/noindex.json` と `noindex.png`。検索エンジンによる除外処理完了とは区別する。
- 今後のPWA準備スクリプトにもnoindex headerを追加。認証・API制御・Relay・WAFは変更していない。
