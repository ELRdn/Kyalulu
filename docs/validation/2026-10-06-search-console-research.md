# Kyalulu — Google Search Console調査・運用メモ

調査日：2026-10-06（JST）。Google公式資料を認証なしのshell HTTP GETで取得。公開サイトと公開GitHubもGETで確認した。変更は本ファイルのみ。認証済みGSC操作・実装・公開は親担当に委ね、Git操作、DNS変更、認証情報へのアクセスは行っていない。

## 現状と次の対応

**既存のドメインプロパティを使い、送信済みサイトマップの処理状態を追跡する。登録やDNS検証のやり直しは不要。** MCPサービスを現行機能として紹介する公開根拠はなく、`/docs/mcp/`新設は推奨しない。FAQリッチリザルトはGoogleで表示終了している。

| 証拠の種類 | 2026-10-06時点で確認できた事実 | 含意・未確定事項 |
| --- | --- | --- |
| 親担当の認証済みGSC実測 | `sc-domain:kyalulu.com`は登録済み、DNS TXTあり、アカウントにサインイン可能 | 新規登録・DNS設定を前提に作業を始めない。既存の権限で操作を継続できている |
| 親担当のGSC操作結果 | サイトマップは以前未送信。今回`https://kyalulu.com/sitemap.xml`を送信し、Googleが受け付けた。初回詳細は「サイトマップを読み込めませんでした」 | **送信受理と取得・処理成功は別。原因は未確定** |
| 本調査の公開HTTP実測 | 調査用User-Agentで同サイトマップは200、`application/xml`、XML解析で36 URL。`robots.txt`は200、サイトマップ宣言あり、`User-agent: *`に`Allow: /` | 外部GET成功はGoogle側取得成功の証明ではない |
| 本調査の追加HTTP比較 | サイトマップはPython標準User-Agentで403。調査用、`Mozilla/5.0`、`Googlebot/2.1 (+http://www.google.com/bot.html)`の各文字列では200・36 URL | リクエスト条件による応答差を観測。GSCエラーとの因果は未確定。Googlebotを名乗るGETはGoogleの実クローラによる取得の証明ではない |
| 親担当のGSC実測 | ルートURLは不明／未登録。LIVEテストは成功し「URL は Google に登録できます」 | 現時点の取得・インデックス可能性を確認。登録完了・表示・順位の確認ではない |
| 親担当のGSC実測 | Performanceは処理中／データなし | クエリ別の現状、表示回数、CTR、順位、改善効果はまだ数値化できない |
| 親担当の進行中作業 | Docs・FAQなど重要URLを検査し、改善公開後に登録リクエスト予定 | この調査では検査完了、改善公開、リクエスト完了を主張しない |

サイトマップは後で状態・最終読み込み日時・詳細エラーを再確認する。同エラーが継続する場合に、その時点のGoogle側エラーと公開応答を照合して、リダイレクト、取得制限、配信応答、XMLなど該当項目を調べる。追加比較で観測した403も、リクエスト条件と配信側の記録が確認できる場合に調査対象とする。現証拠だけでDNS、CDN、robots、伝播遅延、Google側の一時障害などへ原因を帰属させない。未解決のまま成功扱いせず、修正根拠が得られた場合に親担当が修正・必要な再送信を判断する。[G3][G4]

## プロパティとDNS検証

| 種類 | 対象範囲 | 所有権確認と今回の判断 |
| --- | --- | --- |
| ドメイン：`kyalulu.com` | http/httpsなどのプロトコル、wwwを含むサブドメイン、全パス | DNSレコード検証のみ。GSC指定のTXT、または構成に応じたCNAME等の公式手順に従う。今回は既に登録済み |
| URLプレフィックス：`https://kyalulu.com/` | 指定のプロトコル・ホスト・パス以下。httpやwwwの別ホストは含まない | HTMLファイル、HTMLタグ、DNS等の利用可能な方式。別管理が必要な場合だけ追加する |
| URLプレフィックス：`https://kyalulu.com/docs/` | このパス以下のみ。英語版`/docs/en/`も含む | Docs専用の権限・管理が必要なら候補。現在は既存ドメイン側のページフィルタで十分 |

GSC UIの表示名とAPIの識別子を区別する。APIではドメインは`sc-domain:kyalulu.com`、URLプレフィックスは`https://kyalulu.com/`など末尾`/`付き。[G1][G2][G7]

## サイトマップ運用

- 送信対象はサイト全体の[`https://kyalulu.com/sitemap.xml`](https://kyalulu.com/sitemap.xml)。既に送信済みなので、まず結果を追跡する。UIで送信するにはプロパティの所有者権限が必要。[G3]
- GSCのサイトマップレポートは、そのレポートまたはAPI経由で送信したものを表示する。robots経由で発見済みでも一覧に出るとは限らない。「以前一覧になかった」だけでGoogleが未発見とは断定できない。[G3]
- `Success`はサイトマップの取得・処理成功で、全掲載URLのクロールやインデックス登録成功ではない。送信は発見のヒントであり、ダウンロード・利用・登録を保証しない。[G3][G4]
- 1ファイルは**非圧縮50MB以下、50,000 URL以下**。UTF-8、絶対URL、検索に出したいcanonical URLを使用。今回観測した36 URLはこの上限以下だが、GSCの発見・登録数とは別の数値。[G4]

## URL Inspection：登録情報・ライブ検査・登録リクエスト

| 操作 | 分かること | 分からないこと／制限 |
| --- | --- | --- |
| 通常のURL検査（indexed） | Googleの登録側にある情報、クロール結果、Google-selected canonicalなど | 現在の配信内容を取得し直す検査ではない。「URL is on Google」でも実際の検索表示を保証しない |
| 公開URLをテスト（live） | 現在のURLを取得した時点のアクセス・インデックス可能性、レンダリングなど | 登録済みか、Googleが選ぶcanonical、重複判定、全品質・セキュリティ条件などは確定しない |
| インデックス登録をリクエスト | 取得可能性の簡易チェックを経てクロール待ちキューへ申請 | 即時登録・掲載・順位を保証しない。所有者またはフルユーザーが必要 |

重要URLは、indexed結果→必要ならlive→改善公開・再検査→登録リクエストの順で扱う。親担当がこの流れを実施中。Googleはクロールに数日〜数週間かかる場合があると説明しており、期限保証ではない。同じURLへ繰り返し申請してもクロールを早めない。多数のURLはサイトマップで発見を促す。[G5][G6]

UIの登録情報検査・live検査・登録リクエストにはそれぞれ日次制限があるが、確認した公式ヘルプは固定の具体件数を示していない。「UIで1日2,000件申請できる」などとは説明しない。[G5]

### URL Inspection APIの範囲とクォータ

`POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`は**登録側の状態を読むAPI**。POSTでも登録操作ではない。live検査、登録リクエスト、sitemap送信の代替にはならない。[G7]

- 対象URLは`siteUrl`のプロパティ範囲内であること。読み取りにはOAuthの`https://www.googleapis.com/auth/webmasters.readonly`を利用できる。認証・API呼び出しは本調査では行っていない。[G7]
- URL Inspection API：**サイトごと2,000件/日、600件/分**。**プロジェクトごと10,000,000件/日、15,000件/分**。双方の上限が適用される。これはAPIの読み取りクォータで、UIの登録申請枠ではない。[G8]
- Search Console API全体が読み取り専用なのではない。上記inspectionとSearch Analyticsの取得をread-onlyとして扱う。sitemap送信などの書き込みは別操作。[G4][G7][G9]

## Search Analytics：低順位・高表示回数の改善候補

データが用意できた後、まず検索タイプ`web`・確定データ`dataState: final`で見る。最初の集計は`query`×`page`。必要に応じて`country`・`device`を分け、同条件の期間で比較する。その他に`date`、`hour`、`searchAppearance`も指定可能。言語そのもののdimensionはないので、日英は`/docs/en/`等のページパスで切り分ける。[G9]

| 指標・切り口 | 実務上の読み方 |
| --- | --- |
| impressions | 検索で表示された回数。検索意図との関連が強く、表示機会が多いページを候補にする |
| clicks / CTR | CTRはclicks÷impressions。国・端末・クエリ意図・順位が違う行を単純に比較しない |
| position | 平均掲載順位。数値が大きいほど低順位。サイト集計では最上位結果の平均であり、毎回その順位にいるという意味ではない |
| query×page | どの検索語でどのページが出るかを対応づける。同じクエリでも国・端末・期間で違いが出る |

**優先候補は、公開機能に一致する検索意図を持ち、表示回数が多いのに順位が低いquery×page。** 必要なら「平均順位10より大きい」を初期抽出条件にし、表示回数の降順で見る。この10という境界は運用上の仮置きで、Google推奨の閾値や順位上昇予測ではない。title/H1、冒頭の回答、不足している導入・互換説明、関連ページからの内部リンクを実内容に合わせて改善する。実際に未提供のMCPサービスを検索語に合わせて宣伝しない。[G10]

### 取得・集計上の正確な制限

- `rowLimit`は**1〜25,000、既定1,000**。`startRow`でページング。基本の応答順はクリック数の降順なので、最初の少数行だけでは「高表示・低クリック」を見落とす。[G9]
- Search Analyticsは**1日・検索タイプごと最大50,000行**を公開する。内部制限のため全行取得は保証されず、ページングでも完全な母集団にはならない。必要に応じて日別取得し、CTRをclicks/impressionsから計算、positionはimpressionsによる加重平均にする。[G9][G11]
- 匿名化されたクエリはプライバシー保護のため表から除外。クエリフィルタがなければチャート合計に含まれるが、フィルタ使用時は含まれない。内部の行省略もあるため、クエリ表の合計とチャート合計は必ずしも一致しない。[G12]
- APIの日付は**太平洋時間（UTC−7/−8）**で、指定開始・終了日を含む。JSTの日付と同一視しない。`final`は確定データのみ、`all`は未確定の新しいデータも含む。[G9]
- APIのSearch Analyticsクォータ：**サイトごと1,200件/分、ユーザーごと1,200件/分、プロジェクトごと40,000件/分・30,000,000件/日**。別途、短期・長期の負荷制限あり。page/queryによる集計や長期間照会は負荷を増やすので、必要な期間・切り口だけ取得する。[G8]

現時点ではPerformanceが処理中のため、上記は今後の運用方針。Kyaluluの実クエリ数・表示回数・CTRや改善率の推定値は置かない。

## Google AI機能とFAQ：最新の公式説明

**AI Overviews / AI Modeに特別な構造化データやAI用テキストファイルは不要。** ページがインデックスされ、検索のスニペット表示対象であることが必要。クロール許可、内部リンク、テキストで読める重要内容、良い体験、可視内容と一致する構造化データを優先する。要件充足でも掲載は保証されない。AI機能由来の検索トラフィックはGSC Performanceの`Web`に含まれるため、この合計をAI専用の流入や引用件数とは解釈しない。[G13]

公式更新履歴の2026-06-15「Clarifying guidance on llms.txt files」は、Google Searchでは`llms.txt`は不要で、可視性・順位に正負の影響を与えないと説明。既存`llms.txt`は他サービス向けの補助として維持できるが、Google向けの追加対応や登録申請対象の中心にはしない。[G14]

**FAQリッチリザルトは2026-05-07からGoogle検索に表示されなくなった。** 2026-05-08の廃止告知と2026-06-15のドキュメント削除告知を確認。従来のFAQ構造化データURLは更新履歴の`#removing-faq-rich-result`へリダイレクトする。「著名な政府・医療サイトに限定」は過去の制限で、現状説明として不十分。[G14][G15]

Kyaluluの可視FAQは読者の疑問への回答として有用。`scripts/build_docs.mjs:144`では`FAQPage`を生成しているが、GoogleでのFAQリッチ表示の利点を約束しない。JSON-LD維持・整理は親担当の実装判断。既存`docs/validation/2026-10-05-docs-seo-publication.md:42`の「政府・医療サイト限定」という記録は、今回の最新証拠で補足・更新が必要。本調査では変更していない。

## KyaluluにMCPサービスはあるか

結論：**確認した公開ソースと開発チェックアウトに、提供中のKyalulu MCPサービスを示す根拠はない。MCPは設計・将来計画として扱う。**

| 証拠 | 読み取れる事実と限界 |
| --- | --- |
| `.artifacts/docs-sources/manifest.json` / `apps/landing/docs/content/sources.json` | 公開資料は`ELRdn/Kyalulu@eea271beb3eef9211f8b588db331daf2761ba3e2`、取得・レビュー日2026-10-05。本調査の認証なしGitHub API GETでも公開`main`は同じcommit |
| [commit固定の公開README](https://github.com/ELRdn/Kyalulu/blob/eea271beb3eef9211f8b588db331daf2761ba3e2/README.md) | Character AI Runtime / Benchmark。Kyaluluがキャラ・記憶・会話状態を持ち、LEとはHTTP/SSE接続。MCPサービスとは説明していない。raw再取得がローカルsnapshotと一致 |
| [公開LE設計書](https://github.com/ELRdn/Kyalulu/blob/eea271beb3eef9211f8b588db331daf2761ba3e2/LE_ARCHITECTURE.md) | 冒頭は`Architecture Proposal v1`。24行目にLEの`MCP transport`、304行目に`api/mcp/*`の`MCP transport ideas`。実装済みKyalulu MCPの根拠にはならない。LEという別リポジトリの設計境界も示す |
| 開発チェックアウトの`README.md:111` | `Later: KCS/Character Compiler → Tool/MCP/events ...`と明示。公開READMEとは異なる新しいローカル記述であり、公開済み機能とは扱わない |
| ローカル`runtime/python/api/main.py`、`runtime/python/providers/le.py`、`runtime/python/api/le.py`、依存定義 | `/api`のFastAPIルート、LEのHTTP管理APIとSSE中継を確認。対象コード検索にMCPサーバーや`tools/list`・`tools/call`等の実装根拠なし。別LEリポジトリの全機能や未参照コードを網羅監査した結果ではない |
| 公開HTTP GET | `https://kyalulu.com/docs/mcp/`は404。今回のサイトマップにも含まれない |

公開READMEのSHA-256は`8d620b0d96ab8cbd6adfc43126cf794a3f204045e6a5f2760138f76fc642c29a`。README、LE設計書、ROADMAP、root/runtimeのpyproject snapshotは`content/sources.json`のhashと一致。公開ROADMAPもraw再取得と一致。

既存の`/docs/development/`または`/docs/release-status/`で、必要ならMCPを将来計画として説明する。`/docs/mcp/`を操作ガイドとして新設するのは、公開実装・接続方式・提供ツール・権限・クライアント設定・試験根拠が揃った後。公開資料にないホスト型MCP endpointや認証方式を創作しない。

## 優先して検査する公開URL

以下は今回取得した公開サイトマップに存在するURL。選定は製品の導入・理解に基づく提案で、GSC検索需要や全ページの個別HTTP再検査結果ではない。親担当が実施中の検査と統合し、重複申請しない。

| 優先 | URL | 理由 |
| --- | --- | --- |
| 最初 | [ルート](https://kyalulu.com/)、[Docs入口](https://kyalulu.com/docs/) | 製品名検索と資料への導線。ルートのlive成功は親担当が確認済み |
| 最初 | [概要](https://kyalulu.com/docs/overview/)、[導入](https://kyalulu.com/docs/quickstart/)、[公開範囲](https://kyalulu.com/docs/release-status/) | 何ができるか、どう試すか、公開・未公開の区別 |
| 次 | [モデル接続](https://kyalulu.com/docs/models/)、[キャラ移行](https://kyalulu.com/docs/imports/)、[互換性](https://kyalulu.com/docs/compatibility/) | 公開資料に根拠のある接続・移行の検索意図 |
| 次 | [記憶](https://kyalulu.com/docs/memory/)、[スマホ](https://kyalulu.com/docs/mobile/)、[問題解決](https://kyalulu.com/docs/troubleshooting/) | 実際の利用方法・制限・困りごと |
| 次 | [FAQ](https://kyalulu.com/docs/faq/)、[プライバシー](https://kyalulu.com/docs/privacy/) | 疑問解消とデータの扱い。FAQリッチ表示狙いではない |
| 英語 | [英語Docs入口](https://kyalulu.com/docs/en/)、[英語導入](https://kyalulu.com/docs/en/quickstart/)、[英語公開範囲](https://kyalulu.com/docs/en/release-status/) | 日英それぞれのcanonical URLを検査。その他の対訳も同じ優先順 |

サイトマップXML・robots・`llms.txt`は配信・発見の確認対象で、HTML記事の代わりに検索登録を狙う対象ではない。MCP未提供のページ、管理画面、非公開cloud/private testは優先URLに追加しない。

## Google公式資料（当日HTTP取得）

公式URLを直接取得し、最終HTTP 200を確認。G15はG14のFAQ削除節へリダイレクトした。検索スニペットや第三者統計は根拠に使っていない。

| ID | 公式資料 | 用途 |
| --- | --- | --- |
| G1 | [Add a website property](https://support.google.com/webmasters/answer/34592?hl=en) | Domain / URL-prefixの範囲と検証方式 |
| G2 | [Verify your site ownership](https://support.google.com/webmasters/answer/9008080?hl=en) | DNS TXT/CNAME等の検証手順 |
| G3 | [Sitemaps report](https://support.google.com/webmasters/answer/7451001?hl=en) | 送信権限、処理状態、レポート対象 |
| G4 | [Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) | 50MB・50,000 URL、canonical、発見のヒント |
| G5 | [URL Inspection tool](https://support.google.com/webmasters/answer/9012289?hl=en) | indexed / live / requestの違い |
| G6 | [Ask Google to recrawl your URLs](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl) | 所有者/フルユーザー、日数、申請制限 |
| G7 | [URL Inspection API: inspect](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect) | 登録側情報だけ、OAuth scope、siteUrl |
| G8 | [Usage limits](https://developers.google.com/webmaster-tools/limits) | APIクォータと負荷制限 |
| G9 | [Search Analytics: query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) | dimensions、25,000行、日付、確定データ |
| G10 | [Performance report: overview](https://support.google.com/webmasters/answer/7576553?hl=en) | 指標・平均順位の意味 |
| G11 | [Getting all your data](https://developers.google.com/webmaster-tools/v1/how-tos/all-your-data) | 1日・検索タイプごとの50,000行、取得欠落 |
| G12 | [Performance: dimensions and data groupings](https://support.google.com/webmasters/answer/17011259?hl=en) | 匿名化クエリ・表の省略 |
| G13 | [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) | AI掲載要件、特別schema不要、Web集計 |
| G14 | [Search documentation updates](https://developers.google.com/search/updates#removing-faq-rich-result) | FAQ表示終了、2026-06-15のllms.txt説明 |
| G15 | [旧FAQ構造化データ資料](https://developers.google.com/search/docs/appearance/structured-data/faqpage) | 廃止後のリダイレクトを実測 |

決定的な原文：G7は“you cannot test the indexability of a live URL”。G13は“There's also no special schema.org structured data that you need to add”。G14のFAQ廃止告知は“This feature will no longer appear in Google Search starting May 7, 2026”。本報告の制限・運用判断はこれらの当日取得資料を基準とする。
