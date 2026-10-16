# Kyalulu SEO基盤・Search Console実施記録

実施日：2026-10-06（Asia/Tokyo）。ひろなおの調査・実装依頼に基づく。

## 方針と実装

- `kyalulu.com`を公開ブランド・検索入口、`/docs/`を公式資料、`app.kyalulu.com`をPWAの操作画面として維持。アプリやRuntimeは今回変更していない。
- 日英LPのtitle・H1・description・OG/Twitter・本文、Docs入口・概要・共通JSON-LD、GitHub Aboutを「local-first, open-source Character AI」「local LLM connections」「locally stored characters, conversations and memory」に統一。ローカル保存と外部APIへの送信条件は区別する。
- LPにWebSite・SoftwareApplication・Organization（contributors）・WebPage・可視回答と一致するFAQPageを追加。LPとDocsは同じEntity IDとSoftwareApplication定義を使う。
- LPからモデル接続・記憶・FAQへのリンクを追加。記憶の想起を保証する表現を修正し、会話例はイメージと明記。
- 既存の静的HTML、canonical、日英hreflang、robots、36 URLのsitemap、BreadcrumbList・TechArticle、出典と答えの要点を再利用。新しいSEOフレームワークや依存は追加しない。
- GitHub Aboutの説明とhomepageを更新済み。ソースのcommit/pushは行っていない。公開資料のmainは引き続き`eea271beb3eef9211f8b588db331daf2761ba3e2`。
- MCPは公開サービスの根拠がなく、現状`/docs/mcp/`は404。提供中の機能としてページを新設しない。[詳しい調査](2026-10-06-search-console-research.md)に根拠を記録。

## Google側の確認

- `sc-domain:kyalulu.com`の既存ドメインプロパティを利用。DNS TXTも存在。新規登録やDNS変更は不要だった。
- `https://kyalulu.com/sitemap.xml`を送信し、Googleの「サイトマップを送信しました」を確認。
- 初回のGoogle処理結果は「サイトマップを読み込めませんでした」。送信の受理と取得・処理成功は区別する。外部HTTPでは200 / application/xmlで36 URLを解析できたが、これだけではGoogleの取得成功を意味しない。原因を推測で確定しない。
- LP、Docsトップ、FAQは登録側で「URLがGoogleに認識されていません」。ライブテストは「URLはGoogleに登録できます」。Docs・FAQは有効なパンくずリスト1件を検出。
- ライブテスト成功は現在の取得・登録可能性であり、登録完了・検索表示・順位の保証ではない。

### 最終操作結果

次の6 URLは通常のURL検査を実行し、改善公開後の「インデックス登録をリクエスト済み」「URLを優先クロールキューに追加しました」を確認した。

| URL | 登録リクエスト | 独立したライブテスト |
| --- | --- | --- |
| <https://kyalulu.com/> | 受理 | 取得成功・登録可能 |
| <https://kyalulu.com/docs/> | 受理 | 取得成功・登録可能、有効なBreadcrumb 1件 |
| <https://kyalulu.com/docs/faq/> | 受理 | 取得成功・登録可能、有効なBreadcrumb 1件 |
| <https://kyalulu.com/docs/models/> | 受理 | 取得成功・登録可能、有効なBreadcrumb 1件 |
| <https://kyalulu.com/docs/memory/> | 受理 | 別途のライブテストは行わず、申請時の取得可能性チェックを通過 |
| <https://kyalulu.com/docs/quickstart/> | 受理 | 別途のライブテストは行わず、申請時の取得可能性チェックを通過 |

申請時点の通常検査は未登録／Googleに認識されていない状態。申請受理はインデックス登録完了ではない。繰り返し申請しても順番・優先度は変わらないため、追加申請はしていない。

サイトマップは公開後に一度だけ再送した。最終確認でも「取得できませんでした」、検出ページ0。**送信操作は完了、Google側の取得・処理成功は未確認で残件。** 次回は最終読み込み日時と詳細エラーを確認し、継続する場合は同時刻の配信ログと照合する。

Performanceはデータ処理中で、実測クエリ・表示回数・順位の選定は未実施。データが出た後に下記の手順で改善対象を選ぶ。定期監視・自動通知は設定していない。

ブラウザ証拠は`.artifacts/search-console/`。アカウント名が写るため公開ビルドに含めない。

## 検証

- `pnpm build:docs` / `pnpm check:docs`合格。34 Docsページ、36 sitemap URL、リンク・canonical・hreflang・出典・CSP・ビルド境界を検証。
- 静的チェッカーにLPのEntity一致、H1、可視FAQとschemaの一致の検証を追加。
- ブラウザで日英LP・Docs入口を1440 / 390 / 320pxで確認。横はみ出し・先読み画像の欠落なし。LPのブラウザエラーなし。
- 記憶の表現を最終修正した後、再build/checkと表示内容の再確認を実施。
- 実LLM推論、Git変更、PWA/Runtimeの公開変更は行っていない。

## 検索クエリから次の改善を選ぶ

確認時点ではPerformanceは「データを処理しています」で、改善対象の実測クエリはまだ選べない。
データが出たら、検索タイプWeb・同じ期間・同じ国/端末条件でquery×pageを確認する。
ドメインプロパティはアプリ側も含むため、ブランド本体とDocsのURLでページを絞る。

1. 表示回数のある検索語と表示ページを確認し、製品の公開機能・検索意図と一致するものを選ぶ。
2. 仮の目安として平均順位10より大きい行を表示回数順に見る。10はGoogleの推奨閾値ではなく、最初の絞り込み例。
3. 既存ページがその意図に合うなら内容・見出し・内部リンクを改善。ページがなければ出典のある解説を作る。同じ意図の薄いページを増やさない。
4. タイトル/回答/更新内容と日付を記録して同じ条件の次期間と比較する。低CTRだけでタイトルを変更せず、順位・検索意図・端末も確認。

候補はローカルLLM接続、Memory Lab、キャラ移行、スマホ接続。現時点では検索需要の実測に基づく選定ではない。

Google公式資料・APIとUIの違い・クォータは[調査メモ](2026-10-06-search-console-research.md)を参照。
2026-05-07以降、GoogleのFAQリッチリザルトは表示終了。可視FAQは読者のために維持する。
Googleは特別なAI schemaやllms.txtを要求しない。AI由来のPerformanceはWebに含まれ、AI引用件数として独立計測した値ではない。

## 公開結果

Cloudflare Pages `kyalulu-landing` / `main`へ静的ビルドだけを公開。
deployment ID：`7d60a982-d454-4bda-84e8-159e0fb13e19`。
URL：<https://7d60a982.kyalulu-landing.pages.dev>。
直前の本番：`7571a83c-0450-4534-8671-abbea0637f42`。

`scripts/verify_docs_public.py`合格。日英LPと全34 Docsページがレビュー済みビルドと一致。
robots/sitemap、実404、canonicalリダイレクト、CSP、補助テキストのnoindexも確認。
Googlebot / bingbot / OAI-SearchBot / ChatGPT-Userの文字列を付けた公開HTTP試験は200。
Googleの実際の取得については、前述のSearch Consoleライブ検査を根拠にする。

追加HTTP比較ではサイトマップがPython標準User-Agentで403、GooglebotとMozilla/5.0で200。
この差と初回Google取得エラーの因果は未確定。アクセス条件により応答が異なる事実として記録する。
既存Cloudflare API資格情報で対象ゾーンがactiveであることは読めたが、security_level・browser_check・bot_management・rulesetsの読み取りは403。設定変更は行っていない。

Cloudflareの認証済みSecurity Eventsでも読み取り確認。2026-10-06 01:44:15 / 01:45:02 / 01:48:49 JSTの3件は、`kyalulu.com`の`GET /sitemap.xml`、User-Agent `Python-urllib/3.14`または`Python-urllib/3.12`をBrowser integrity checkがBlockしていた。Python取得試験の403の理由は確認できたが、Googleのサイトマップ取得失敗の理由を示すログではない。別の直前イベントは`/wp-config.php.bak`へのアクセスをManaged rulesがBlockしており、サイトマップとは別。

根拠なくBrowser integrity checkやWAFを全体で無効化しない。今回の範囲ではCloudflareのセキュリティ設定・DNSを変更していない。保存証拠はIPを含めない抽出テキストとし、アカウントが写る画像・生ログは公開ビルドに含めない。

## 完了と残件

- 完了：SEO/AEO/GEOの静的基盤とEntity統一、日英LP/Docs公開・検証、GitHub About更新、既存GSCプロパティ確認、sitemap送信、重要6 URLの検査・登録申請受理。
- 残件：Googleのサイトマップ取得・処理成功、実際のインデックス登録、検索Performanceのデータ蓄積とquery×pageに基づく次の改善。
- 公開サイトはスマホから確認可能。320/390pxのブラウザ検証は実施したが、ひろなおの実機での確認とは区別する。
