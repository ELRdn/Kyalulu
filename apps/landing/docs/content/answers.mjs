// Visible, source-supported answers. These supplement prose, never hide SEO text.
export default {
  overview: {
    ja: ['Kyaluluは、キャラクター・会話・記憶を手元に保存するローカルファーストのオープンソースCharacter AIランタイムです。', '返事の生成にはLE、LM Studio、OllamaなどのローカルLLM実行先や外部モデルAPIを接続します。', '公開アルファです。スマホ接続には稼働中のPC・個人サーバーが必要です。'],
    en: ['Kyalulu is a local-first, open-source Character AI runtime with locally stored characters, conversations and memories.', 'Connect local LLM providers such as LE, LM Studio or Ollama, or an external model API, to generate replies.', 'It is a public alpha. Mobile access requires a running PC or personal server.'],
  },
  quickstart: {
    ja: ['公開ソースから導入します。Python 3.11以上、uv、Node.js 20以上、pnpm 10以上を用意します。', '依存を導入し、Kyalulu APIとWebを別々のターミナルで起動します。', '最初はモデル不要のMock Echoで接続と保存を確認し、その後に実モデルへ接続します。'],
    en: ['Install from public source with Python 3.11+, uv, Node.js 20+ and pnpm 10+.', 'Install dependencies, then run the Kyalulu API and Web in separate terminals.', 'Check connectivity and storage with Mock Echo before connecting a real model.'],
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
    ja: ['キャラクターはファイル・対応する公開URL・手動貼り付けから取り込めます。', 'プレビューで内容と変換の制約を確認してから保存します。URLを入力するだけでは保存しません。', 'Character.AIは設定の手動移行です。アカウントや全会話履歴の自動取得ではありません。'],
    en: ['Import characters from files, supported public URLs or manually pasted settings.', 'Review content and conversion limits in the preview before saving; entering a URL alone does not save it.', 'Character.AI uses manual settings migration, not automatic account or full-history retrieval.'],
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
    ja: ['CharacterBenchは日本語Character AIを評価する独立したMITライセンスのパイロットです。', '12キャラ、120単発問題、12本の12ターン対話で、モデル・反復ごとに264応答を生成します。', '構造化状態や表面条件の点数を、キャラクター品質の総合点や検証済みランキングとして扱いません。'],
    en: ['CharacterBench is an independent MIT-licensed pilot for evaluating Japanese Character AI.', 'Twelve characters, 120 single-turn probes and twelve 12-turn dialogues produce 264 responses per model per repeat.', 'Structured-state and surface-constraint scores are not overall character-quality scores or a validated leaderboard.'],
  },
  compatibility: {
    ja: ['Character Card、SillyTavern、BYAF、Risuの共通拡張、Character.AIの手動設定に形式別の対応があります。', '取り込める項目、生成に使える項目、保持のみの項目を分けて確認します。', 'スクリプトや元アプリ固有の全機能は実行しません。書き出し前にも変換・欠落の説明を確認します。'],
    en: ['Support is format-specific for Character Cards, SillyTavern, BYAF, shared Risu extensions and manual Character.AI settings.', 'Distinguish imported fields, fields used in generation and fields preserved only.', 'Scripts and all application-specific features are not executed. Review conversion and loss notices before exporting.'],
  },
  privacy: {
    ja: ['ローカルのRuntimeが会話・キャラ・記憶の正本を保存します。', 'ローカルモデルへの接続と外部APIへの接続では送信先が異なります。Hub利用も通信を伴います。', 'Remoteの暗号化は端末自体の安全を保証しません。ブラウザーの下書きは暗号化された保管庫ではありません。'],
    en: ['The local runtime stores authoritative conversations, characters and memories.', 'Local models and external APIs have different data destinations. Hub access also involves network requests.', 'Remote encryption does not secure a compromised endpoint. Browser drafts are not an encrypted vault.'],
  },
  troubleshooting: {
    ja: ['画面、Kyalulu API、Providerの順に切り分け、Statusの接続診断を確認します。', 'モデル一覧への表示はロード完了を意味しません。Mock Echoと実モデルを分けて確認します。', 'スマホでは直接HTTPSとRemoteの登録手順を混ぜず、PCの稼働・証明書・登録状態を確認します。'],
    en: ['Check the interface, Kyalulu API and provider separately, starting with connection diagnostics in Status.', 'A listed model is not necessarily loaded. Separate Mock Echo checks from real-model checks.', 'On phones, keep direct HTTPS and Remote enrollment procedures separate; check PC readiness, certificates and enrollment.'],
  },
  faq: {
    ja: ['ローカル版のコードはAGPL-3.0-onlyのOSSです。外部APIなどの費用は別に発生する場合があります。', 'スマホPWA・Remoteは稼働中のPCへ接続します。端末内のLLM実行やオフライン生成ではありません。', '移行と記憶は対応範囲があります。元アプリの全機能や完全な想起を保証するものではありません。'],
    en: ['The local code is open source under AGPL-3.0-only. External APIs and other costs may still apply.', 'The mobile PWA and Remote require a running PC. They do not run an LLM on the phone or generate offline.', 'Imports and memory have defined limits; they do not guarantee every original feature or perfect recall.'],
  },
  'release-status': {
    ja: ['このdocsは2026年10月5日に確認した公開GitHubのコミットを基準にしています。', '機能の実装、特定環境での検証、正式公開の受け入れを分けて記載します。', '各記事末尾の出典はコミット固定です。資料確認日は全機能の実機再試験日ではありません。'],
    en: ['These docs are based on a public GitHub commit reviewed on October 5, 2026.', 'Implementation, checks in particular environments and release acceptance are documented separately.', 'Article sources are commit-pinned. A source review date does not assert fresh device testing of every feature.'],
  },
};
