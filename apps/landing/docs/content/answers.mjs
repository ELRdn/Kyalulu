// Visible, source-supported answers. These supplement prose, never hide SEO text.
export default {
  datasets: {
    ja: ['Naotaka0127はKyalulu制作者公式のHugging Faceアカウントです。日本語RP・創作文章を中心に、多言語の関連資料も公開しています。', 'SFW候補13,382件、NSFW候補78,928件。元AIOは33配布元・367原本ファイルのソースアーカイブです。', 'SFW／NSFW版は出典付きParquetです。自動ルールによる候補区分と配布元別の利用条件を確認し、原レコードを用途に合わせて変換します。'],
    en: ['Naotaka0127 is the official Hugging Face account of Kyalulu’s creator, publishing Japanese RP and creative-writing collections with multilingual reference materials.', 'There are 13,382 SFW candidates and 78,928 NSFW candidates. The original AIO archives 367 source files from 33 repositories.', 'SFW/NSFW derivatives distribute Parquet records with provenance. Review automated candidate classifications and source-specific conditions, then adapt original records for your purpose.'],
  },
  overview: {
    ja: ['Kyaluluは、キャラクター・会話・記憶を手元に保存するローカルファーストのオープンソースCharacter AIランタイムです。', '返事の生成にはLE、LM Studio、OllamaなどのローカルLLM実行先や外部モデルAPIを接続します。', 'ローカル版は公開アルファ。PWA・Remoteは稼働中のPCが必要で、PC不要のCloudは現在本人限定の試験です。'],
    en: ['Kyalulu is a local-first, open-source Character AI runtime with locally stored characters, conversations and memories.', 'Connect local LLM providers such as LE, LM Studio or Ollama, or an external model API, to generate replies.', 'The local version is a public alpha. PWA/Remote need a running PC; PC-free Cloud currently has a private test limited to one owner.'],
  },
  quickstart: {
    ja: ['公開ソースから導入します。Python 3.11以上、uv、Node.js 20以上、pnpm 10以上を用意します。', '依存を導入し、Kyalulu APIとWebを別々のターミナルで起動します。', '最初はモデル不要のMock Echoで接続と保存を確認し、その後に実モデルへ接続します。'],
    en: ['Install from public source with Python 3.11+, uv, Node.js 20+ and pnpm 10+.', 'Install dependencies, then run the Kyalulu API and Web in separate terminals.', 'Check connectivity and storage with Mock Echo before connecting a real model.'],
  },
  cloud: {
    ja: ['Kyalulu Cloudは個人PCの常時起動が不要な独立した経路です。現在は本人限定の試験で、一般提供ではありません。', '10名の無料ベータは法務・予算・実機と実モデルの受け入れ後の予定です。現在のログインは18歳以上の確認とデータ送信の同意が必要です。', '2026-10-12の公開statusでは外部SFW検査・画像・販売・広告が無効。学習利用があるProvider経路は個別の明示的同意が必要です。'],
    en: ['Kyalulu Cloud is a standalone route without an always-on personal PC. It currently has a private test limited to one owner, not general availability.', 'A free beta for ten participants is planned after legal, budget and real-device/model acceptance. Current login requires 18+ confirmation and data-transmission consent.', 'Public status observed on 2026-10-12 showed external SFW screening, images, sales and ads disabled. Provider routes allowing training require explicit route-specific consent.'],
  },
  models: {
    ja: ['Kyaluluが会話データを管理し、接続したProviderが返事を生成します。', 'LEが配信中のモデルはle:<id>で表示されます。直接接続するモデルはYAMLで登録できます。', '外部APIを選ぶと生成に必要な情報が提供元へ送信されます。モデルの表示と準備完了は別です。'],
    en: ['Kyalulu manages conversation data; the connected provider generates responses.', 'Models served by LE appear as le:<id>. Direct providers can be configured with YAML.', 'External APIs receive information needed for generation. A listed model is not necessarily ready.'],
  },
  characters: {
    ja: ['Createでキャラクターを取り込み・編集・保存し、挨拶を選んで会話を始めます。', '原本と編集版は別に保存され、既存会話は明示的に切り替えるまで選択した版を使います。', 'Loreや生成プリセットは対応範囲を確認して適用します。元アプリの全機能の再現ではありません。'],
    en: ['Import, edit and save a character in Create, then select a greeting to start chatting.', 'Originals and edited revisions are stored separately. Existing chats retain their selected revision.', 'Apply Lore and presets within supported scope; not every original application feature is reproduced.'],
  },
  imports: {
    ja: ['SillyTavernのカード・World Info・生成設定は原本を残して移行し、Createのプレビューで確認して保存します。', 'Instruct・Text Completion整形・動的な深さ挿入・複雑なHandlebars式・未対応マクロは保持のみで実行されません。元アプリ全体の移行ではありません。', 'モデル接続は別途設定します。Character.AIは設定の手動移行で、アカウントや全会話履歴の自動取得ではありません。'],
    en: ['Migrate SillyTavern cards, World Info and generation settings while keeping originals; review the Create preview before saving.', 'Instruct/Text Completion formatting, dynamic depth insertion, complex Handlebars expressions and unsupported macros are preserved only, not executed. This is not a whole-app migration.', 'Configure model connections separately. Character.AI uses manual settings migration, not automatic account or full-history retrieval.'],
  },
  memory: {
    ja: ['Memory Labは記憶を保存・検索・確認・訂正する機能で、初期設定はオフです。', '記憶の共有範囲はキャラと人物像の保存版に関係します。キャラ未指定なら会話内で使います。', 'すべての発言や約束を覚える保証はありません。確認待ちの提案と、重要な記憶は自分で確認します。'],
    en: ['Memory Lab stores, retrieves, inspects and corrects memories. It is off by default.', 'Sharing depends on saved character and persona revisions; without a character, memory stays within the chat.', 'Recall of every statement or promise is not guaranteed. Review pending proposals and important memories.'],
  },
  worlds: {
    ja: ['人物像はユーザー側の設定、世界観は舞台やルールの設定です。CreateまたはStudioで作ります。', '会話の設定から保存した人物像・舞台を選び、場面・目標・ペースを指定します。', '保存版を選ぶため、編集しても既存会話の設定が自動で最新版になるわけではありません。'],
    en: ['A persona describes the user; a world describes the setting and rules. Create them in Create or Studio.', 'Choose saved personas and worlds in conversation settings, then set the scene, goal and pacing.', 'Chats use saved revisions. Editing a definition does not automatically replace the revision in an existing chat.'],
  },
  mobile: {
    ja: ['AndroidのPWAから、自分のPC・個人サーバーのKyaluluへHTTPSで接続します。', '信頼できる証明書と端末登録が必要です。複数端末は同じ管理者の会話データを扱います。', 'スマホ内のLLM実行やオフライン生成ではありません。PC停止・スリープ中は利用できません。'],
    en: ['Use an Android PWA to access Kyalulu on your PC or personal server over HTTPS.', 'A trusted certificate and device enrollment are required. Devices share the same owner’s conversation data.', 'The PWA does not run an LLM on the phone or generate offline. The PC must remain awake and running.'],
  },
  remote: {
    ja: ['RemoteはPCのHostとPWAをRelay経由でつなぐ、Noise暗号化通信の開発候補です。', 'PC側のインターネット向けポート開放は不要です。QR登録後、PCで6桁コードを承認します。', 'クラウド推論やPC停止時の自動代替はありません。実機・長時間運用・外部レビューには残る受け入れ条件があります。'],
    en: ['Remote is a development candidate connecting a PC Host and PWA through a Relay with Noise encryption.', 'No Internet-facing PC port forwarding is needed. Enroll via QR, then approve the six-digit code on the PC.', 'It adds no cloud inference or automatic fallback. Device, endurance and external review requirements remain.'],
  },
  development: {
    ja: ['WebはReact・Vite、RuntimeはPython・FastAPI、保存はSQLiteです。LEは別プロセスです。', '公開uv workspaceの依存を固定lockで導入し、APIとWebを分けて起動します。', '変更したAPI・保存・表示の対象を検証します。Mockの成功と実モデル品質・正式公開は別の判定です。'],
    en: ['Web uses React and Vite; the Python FastAPI runtime stores data in SQLite. LE is a separate process.', 'Install locked dependencies for the public uv workspace and run the API and Web separately.', 'Check the affected API, storage and interface behavior. Mock success is separate from model quality and release approval.'],
  },
  characterbench: {
    ja: ['Kyalulu CharacterBench（KCB）は日本語Character AIを評価するMITライセンスのパイロットです。thu-coaiのCharacterBench（AAAI 2025）とは別プロジェクトで、関係はありません。', '12キャラ、120単発問題、12本の12ターン対話で、モデル・反復ごとに264応答の実行計画です。これは実測値ではありません。', '構造化状態や表面条件の点数を、キャラクター品質の総合点や検証済みランキングとして扱いません。'],
    en: ['Kyalulu CharacterBench (KCB) is an MIT-licensed pilot for Japanese Character AI. It is separate from and unrelated to thu-coai CharacterBench (AAAI 2025).', 'Twelve characters, 120 single-turn probes and twelve 12-turn dialogues plan 264 responses per model per repeat. These counts are not measured results.', 'Structured-state and surface-constraint scores are not overall character-quality scores or a validated leaderboard.'],
  },
  compatibility: {
    ja: ['Character Card、SillyTavern、BYAF、Risuの共通拡張、Character.AIの手動設定に形式別の対応があります。', '取り込める項目、生成に使える項目、保持のみの項目を分けて確認します。', 'スクリプトや元アプリ固有の全機能は実行しません。書き出し前にも変換・欠落の説明を確認します。'],
    en: ['Support is format-specific for Character Cards, SillyTavern, BYAF, shared Risu extensions and manual Character.AI settings.', 'Distinguish imported fields, fields used in generation and fields preserved only.', 'Scripts and all application-specific features are not executed. Review conversion and loss notices before exporting.'],
  },
  privacy: {
    ja: ['ローカルのRuntimeが会話・キャラ・記憶の正本を保存します。Cloud利用時はCloud側の保存・送信条件を確認します。', 'ローカルモデルと外部APIでは送信先が異なります。任意のGA4計測は公式サイト・運営Cloudで同意した場合だけで、ローカル版・Remoteでは行いません。', 'アプリの個人識別子や会話・記憶はGA4へ送りませんが、GA4は仮名CookieやIPを処理します。停止しても過去の計測データは自動削除されません。'],
    en: ['The local runtime stores authoritative conversations, characters and memories. Cloud use has separate storage and transmission terms.', 'Local models and external APIs have different destinations. Optional GA4 measurement requires consent on the official site/operated Cloud and does not run in local or Remote mode.', 'Application personal identifiers, conversations and memories are excluded from GA4, which still processes pseudonymous cookies and IP addresses. Opting out does not automatically erase historical measurements.'],
  },
  troubleshooting: {
    ja: ['画面、Kyalulu API、Providerの順に切り分け、Statusの接続診断を確認します。', 'モデル一覧への表示はロード完了を意味しません。Mock Echoと実モデルを分けて確認します。', 'スマホでは直接HTTPSとRemoteの登録手順を混ぜず、PCの稼働・証明書・登録状態を確認します。'],
    en: ['Check the interface, Kyalulu API and provider separately, starting with connection diagnostics in Status.', 'A listed model is not necessarily loaded. Separate Mock Echo checks from real-model checks.', 'On phones, keep direct HTTPS and Remote enrollment procedures separate; check PC readiness, certificates and enrollment.'],
  },
  faq: {
    ja: ['ローカル版のコードはAGPL-3.0-onlyのOSSです。外部APIなどの費用は別に発生する場合があります。', 'スマホPWA・Remoteは稼働中のPCへ接続します。PC不要のCloudは現在本人限定の試験です。どちらもオフライン生成ではありません。', '移行と記憶は対応範囲があります。元アプリの全機能や完全な想起を保証するものではありません。'],
    en: ['The local code is open source under AGPL-3.0-only. External APIs and other costs may still apply.', 'The mobile PWA and Remote require a running PC. PC-free Cloud currently has an invited private test limited to one owner. Neither provides offline generation.', 'Imports and memory have defined limits; they do not guarantee every original feature or perfect recall.'],
  },
  'release-status': {
    ja: ['技術資料の基準は2026年10月5日に確認した公開GitHubのコミットです。Cloud観測とサイト計測の現行実装説明は2026-10-12として別記します。', '機能の実装、特定環境での検証、正式公開の受け入れを分けて記載します。', '各記事末尾の出典はコミット固定です。資料確認日は全機能の実機再試験日ではありません。'],
    en: ['Technical sources are pinned to a public GitHub commit reviewed on October 5, 2026. Cloud observations and current website analytics implementation are separately dated 2026-10-12.', 'Implementation, checks in particular environments and release acceptance are documented separately.', 'Article sources are commit-pinned. A source review date does not assert fresh device testing of every feature.'],
  },
};
