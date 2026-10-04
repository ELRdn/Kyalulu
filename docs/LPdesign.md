# Kyalulu LP Design

聞き取りで確定した方針（2026-10-03）。「確定」は本人確認済み、「提案」は未確認の叩き台、「未確定」は要決定。

## 1. 意図

| 項目 | 内容 |
|---|---|
| Outcome | GitHub Star／ローカル版（Desktop・PWA）の試用／クラウド版ウェイトリスト登録。最終的な収益導線は、ローカルでLLMを動かせない人向けクラウドモデルのサブスク |
| User | RPに興味がある幅広いレベルの人。主役は (a) SillyTavern等からの移行層 → (b) Character.AI等のクラウド利用者 → (c) 初心者。開発者・研究者は脇役（CharacterBenchへのリンクのみ） |
| Why now | Memory Lab、Soft Mystic Portal、マスコットv1.2、PWA／Remote が揃い、外へ見せる段階に入った |
| Success | Star数、ローカル版導入開始数、ウェイトリスト登録数（数値目標は未設定） |
| Constraint | 静的サイト／日英2言語／配布状況に追従するCTA切替 |
| Out of scope | 決済・料金表・サブスク実装／配布体験の修正／成人向け・「制限なし」のLP本文訴求／実在の非OSS企業の名指し比較／動画デモ（後追加） |

## 2. メッセージ設計（確定）

売りは3本。ヘッドコピーは (a)+(b) を軸に、(c) を2番手に置く。

1. **記憶が続く** — Memory Lab。長いターンでもキャラが崩れにくい
2. **手元に残る** — ローカル版は端末内で完結する
3. **PCでもスマホでも続きから** — PWA＋暗号化リモート

補助訴求: 既存キャラをそのまま持ち込める（CCv2/v3・SillyTavern・Character.AI貼り付け移行）。かわいさ（Soft Mystic Portal／マスコット）は売りではなく全体の空気として流す。

### データの約束（確定）

2モードに分けて正直に書く。

- ローカル版: 端末内で完結する
- クラウド／モバイル単独版: 任意の同期。同期データはサーバーに保存され、最低限の安全チェックがかかる。同期はいつでも切れる

LP本文では成人向け・「制限なし」に触れない。詳細は FAQ／規約ページへ置き、LPからは「データと安全基準について」でリンクする。
注意: Remoteは「クラウドは中継のみ」の設計。サーバー同期でRPの中身を読む仕様にするなら、Remoteの暗号化の説明と矛盾しないよう、LPでは経路ごとに書き分ける。

### 比較（確定）

- カテゴリ比較を基本にする: 「クラウド型RPサービス」「ローカル型ツール」「Kyalulu」
- 名指しできるのは、OSS・オープン形式（SillyTavern、CCv2/v3、TavernCard）と、移行導線のみ
- 非OSSの企業サービスは、頭文字などイニシャル表記にする
- 国内RPサービスとの差別化は、日本語LPでのみ行う

## 3. ビジュアル（確定）

- アプリUIの世界観（Soft Mystic Portal）とマスコットv1.2を引き継ぎ、LPではさらにエモーショナルに振る（大きなイラスト、アニメーション、物語的なスクロール演出）
- ヒーロー: マスコット＋実アプリ画面＋会話例の吹き出し
- 「記憶が続く」は画像では伝わらないため、短いRP抜粋（例: 20ターン前の約束を覚えている）で見せる
- 開発者向け要素（ローカル・暗号化・ベンチマーク）は後半に、落ち着いたトーンで置く
- 素材: `apps/web/public/mascot/v1.2/`（sit / guide / nap / face-*）。実画面は `scripts/verify_desktop_ui.cjs` を流用して撮り直す

## 4. ページ構成（提案）

1. ヘッダー: ロゴ、言語切替(JA/EN)、GitHub Star、「試す」
2. ヒーロー: ヘッドコピー、マスコット、実画面、CTA×2（試す／ウェイトリスト）
3. 記憶が続く: 会話例の吹き出し、Memory Lab
4. 手元に残る: ローカル版とクラウド版の違い（データの約束）
5. PC・スマホで続きから: PWA／Remote
6. 持ち込める: SillyTavern／CCv2・v3／Character.AI移行
7. カテゴリ比較表
8. 3ステップで始める: 状態別（現状／ローンチ後）
9. クラウド版ウェイトリスト
10. FAQ（データ・安全基準・ローカル版の扱い）
11. フッター: GitHub、CharacterBench、ライセンス、規約・プライバシー

## 5. CTA 文言（2セット、確定方針）

現状版で先に出し、ローンチ時に差し替える。

| CTA | 現状（アルファ） | ローンチ後 |
|---|---|---|
| ローカル版 | GitHubで導入する（アルファ） | npmで導入する（ベータ） |
| PWA／モバイル | PWAを開く（自分のPC連携が必要） | クラウドで始める（SFW） |
| ローカルLLM | 既存LE／LM Studio／Ollamaへ接続 | 同左（LE自動導入は別途検証） |
| クラウド版 | ウェイトリストに登録 | 今すぐ始める（料金表を追加） |
| Star | GitHubでStarする | 同左 |

## 6. 実装方針（確定／未確定）

- 静的サイト（HTML／CSS）を Cloudflare Pages に置く。リポジトリ内に `apps/landing/` を新設し、アプリ本体と分離する（確定）
- 日英2言語。コピーは差し替えやすい構造にし、日本語を先に出す（確定）
- ウェイトリスト受け口: 外部フォームを仮置き。Cloudflare Pages Functions + D1 は将来案（未確定）。メール取得時はプライバシーポリシーと利用目的の表示が必要
- ドメイン: `https://kyalulu.com/`（JA）／`https://kyalulu.com/en/`（EN）に確定（2026-10-04）。`app.`（PWA）・`relay.`・`cloud.` とは別のPagesプロジェクト
- 計測、文体（です・ます、マスコットのひと言セリフ）は未確定

### 実装済み（`apps/landing/`）

- 構成: `index.html`（JA）／`en/index.html`（EN）／`style.css`／`main.js`／`assets/`。ビルド不要、`package.json` なし（pnpm workspace・ロックファイルに影響させないため）
- ローカル確認: `python -m http.server 5290 --directory apps/landing`
- Cloudflare Pages: ルートディレクトリ `apps/landing`、ビルドコマンドなし
- CTA切替: `<html data-phase="alpha">` を `launch` に変えると、`.p-alpha` / `.p-launch` の表示が入れ替わる（JA・EN とも）
- ウェイトリスト: `<form id="waitlist-form" data-endpoint="">` に POST 先URL（`{email, lang}` のJSONを受ける）を入れると、入力欄と同意チェックが表示され送信できる。空の間はフォームを隠し、GitHubの Watch → Releases へ誘導する
- 画像: `assets/mascot/`（`apps/web/public/mascot/v1.2/` のWebP）、`assets/screens/`（分離した空データのアプリで、Mockモデルの会話の返事を編集して撮影した実画面。2x／3x。EN版にも日本語UIのまま使用）、`assets/og.png`（1200×630）
- 会話例は創作のイメージ（ヒーロー・Memory Labとも「会話はイメージです」と明記済み）
- デザイン（2026-10-05改訂、参考: slush.app／bevel.health の動き）: 暗い地に角丸パネルを重ねる構成。ティッカー、浮遊ピル型ナビ、見出しの1文字ずつの出現、マスコットのステッカー（ポインタ追従）、スクロールでせり上がる実画面、スクロール速度で傾くマーキー帯、特長3枚のスティッキー重ね（高さ700px以上・幅960px以上のみ）、形式カードの横流し。外部JSライブラリなし（`main.js` のみ）。`prefers-reduced-motion` で全停止
- フォント: 見出し Zen Maru Gothic、帯・数字 Bricolage Grotesque（Google Fonts）
- `og:image`／`og:url`／`canonical`／`hreflang` は `https://kyalulu.com` の絶対URL
- 公開: Cloudflare Pages プロジェクト `kyalulu-landing` に `apps/landing` をDirect Upload（`npx wrangler pages deploy apps/landing --project-name kyalulu-landing --branch main`）。カスタムドメイン `kyalulu.com`

## 7. ローンチ前提条件（LP範囲外、別途対応）

LPの約束と現状の配布体験にずれがある。公開前に解消が必要。

- 初回は無料OSS＋任意のSFWクラウド。人格・記憶・世界・関係性を中心に説明する。
- npm CLI、別クラウドRuntime、認証・SFW検査・同期・残高・課金の実装候補を追加。
  実装と公開・運用受け入れは別。詳細は [ローンチ仕様](LAUNCH.md) を正とする。
- npmで導入する（ベータ）は、Windows 11 x64／macOS Apple Siliconの配布物、
  ライセンス・公開名権限・Nodeだけの実機確認が完了してからリンクを有効化する。
- クラウドで始めるは、認証/SMTP/DeepSeek/画像SFW検査/同期/復元/運用と法務が
  揃ってから有効化。日英規約等は現時点では公開前ドラフト。
- Free $0（初回1,000）、Plus $5（月12,500）、Pro $10（月25,000）の料金原稿。
  売り始めるまで準備中を併記。ローカル/BYOKにK-Creditsは不要。
- 自前GPU版はComing soon。KCS、Tool/MCP、Proactive、音声・画像・Expo・
  署名済みDesktopは後続。継続活動・ワンクリック導入・未完了機能を約束しない。
- Android/Mac実機、24時間/72時間観測、Remoteの外部レビューは未完了。

## 8. 未決事項

- 数値目標（Star、導入、登録）
- ドメインの確定、取得状況
- ウェイトリストの受け口
- 文体、マスコットの扱い（セリフの有無）
- アクセス計測の有無
- 英語版のコピー作成のタイミング
