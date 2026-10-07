// Authored from public ELRdn/Kyalulu snapshots only.
// Source commit: eea271beb3eef9211f8b588db331daf2761ba3e2; retrieved 2026-10-05.
// Sources are repository-relative paths in .artifacts/docs-sources/manifest.json.
export default [
  {
    slug: 'imports',
    group: 'use',
    icon: '📥',
    title: { ja: 'キャラクターを取り込む', en: 'Import characters' },
    description: {
      ja: 'ファイル、公開URL、Character.AIの手動貼り付けから、原本を残して自分のライブラリへ移す。',
      en: 'Move files, public URLs, or manually pasted Character.AI settings into your library while retaining the source.'
    },
    keywords: {
      ja: ['取り込み', 'インポート', 'キャラクターカード', 'Character.AI', 'URL', '原本', '出典'],
      en: ['import', 'character card', 'Character.AI', 'URL', 'preview', 'provenance', 'source']
    },
    readingMinutes: 6,
    sources: ['README.md', 'docs/COMPATIBILITY.md'],
    sections: {
      ja: [
        {
          id: 'choose-a-source', title: '取り込み元を選ぶ',
          html: `<p>Createは、外部の設定を会話用のライブラリへ移す入口です。手元のカードはファイル選択やドロップで、公開ファイルはURL欄で取り込みます。DiscoverのTavernCardやSillyTavern Contentからは、詳細を開いて「取り込み内容を確認」へ進みます。URLを入力しただけでは保存されません。</p><p>公開URLはTavernCard／RisuRealmのコンテンツページと、GitHub／Hugging Faceの公開ファイルが対象です。リポジトリ全体、モデル重み、認証が必要なファイルは対象外。RisuRealmはブラウザー取得とCORSに依存し、独自Module・独自プリセット・CHARX取得には対応しません。外部Hubを選ぶと検索語やコンテンツIDなどが配布元へ送られますが、会話履歴やモデル認証情報はHubへ送りません。</p>`
        },
        {
          id: 'preview-and-save', title: 'プレビューを確かめて保存する',
          html: `<ol><li>Createでファイル、URL、貼り付けのいずれかを選びます。</li><li>プレビューでキャラ、必要な履歴、挨拶、画像、Lore、生成設定と変換上の注意を確認します。BYAFはシナリオごとに候補ができるので、使う候補を選びます。</li><li>内容区分が不明ならSFW／成人向けを指定します。元データの成人向け指定を自動でSFWへ変更することはありません。</li><li>新規保存か、既存項目の版を指定した更新かを選びます。同名だけで上書きはしません。同一原本が見つかったら既存を開く、更新する、明示的に複製する操作を選びます。</li><li>保存後に「キャラを開く」で挨拶を選びます。既存会話の版は、明示的に切り替えるまで固定されます。</li></ol><p>下書きと保存再試行IDは同じタブ内で復元できます。タブを閉じた後も戻る前提にはせず、保存結果を確認してから画面を離れてください。</p>`
        },
        {
          id: 'manual-character-ai', title: 'Character.AIは手動で移す',
          html: `<p>自分が利用できる設定を、次のラベルで貼り付けます。Nameは必須で、Definitionは最後に置きます。その後の本文は改行や空白も含めて保持され、AIによる要約や書き換えは行いません。</p><pre><code>Name: 図書館の案内人
Description: 静かな図書館で働く案内人
Greeting: 今日は何を探していますか。
Definition: 日本語で簡潔に話す。
{{user}}: おすすめの本は？
{{char}}: 好きなジャンルを教えてください。</code></pre><p>Loreは所定のラベル付きテキスト、またはentriesを持つ共通JSONで移せます。アカウント自動連携、非公開設定の抽出、アカウント全履歴の専用Importerはありません。</p>`
        },
        {
          id: 'keep-the-original', title: '原本と編集結果を残す',
          html: `<p>原本は編集結果とは別に保存されます。URL取り込みでは出典URL、作者、ライセンス原文、取得時刻、SHA-256、リビジョンなども保持します。ライセンス不明は不明のままで、サイト全体のライセンスを作品へ自動適用しません。RisuRealmの出典はブラウザー申告として区別されます。</p><p>持ち出す際は、編集結果の復元用にKyaluluバックアップ、元の情報を残すために原本を使い分けます。CC形式には会話全体や全設定が入りません。外部画像URLやスクリプトは自動実行されず、取り込みだけで接続先・認証・モデルロードも変わりません。使える項目と保持のみの項目は<a href="{{doc:compatibility}}">互換対応表</a>で確認できます。入口へ戻るには<a href="{{doc:index}}">ドキュメント一覧</a>を開いてください。</p>`
        }
      ],
      en: [
        {
          id: 'choose-a-source', title: 'Choose a source',
          html: `<p>Create moves external settings into your conversation library. Select or drop a local card, or enter a public file URL. In Discover, open a TavernCard or SillyTavern Content item and choose the import preview action. Entering a URL alone does not save anything.</p><p>Supported public URLs cover TavernCard and RisuRealm content pages and public files on GitHub or Hugging Face. Whole repositories, model weights, and files requiring authentication are excluded. RisuRealm retrieval runs in the browser and depends on CORS; its proprietary Modules, proprietary presets, and CHARX retrieval are unsupported. Selecting an external Hub sends search terms or content identifiers to that distributor, but does not send conversation history or model credentials to the Hub.</p>`
        },
        {
          id: 'preview-and-save', title: 'Review the preview and save',
          html: `<ol><li>Choose a file, URL, or pasted text in Create.</li><li>Review the character, selected history, greetings, images, Lore, generation settings, and conversion warnings. BYAF produces candidates for each scenario; select the ones you want.</li><li>Choose SFW or adult content when the classification is unknown. An adult classification in the source is never automatically downgraded to SFW.</li><li>Choose a new item or an update to a specified existing revision. A matching name alone does not overwrite an item. For an identical source, open the existing item, update it, or explicitly create a copy.</li><li>After saving, open the character and select a greeting. Existing conversations keep their bound revision until you explicitly switch it.</li></ol><p>Drafts and save retry IDs can be recovered within the same tab. Do not assume recovery after closing the tab; check the saved result before leaving.</p>`
        },
        {
          id: 'manual-character-ai', title: 'Move Character.AI settings manually',
          html: `<p>Paste settings you are entitled to use with the following labels. Name is required; put Definition last. The remaining definition text preserves line breaks and whitespace and is not summarized or rewritten by AI.</p><pre><code>Name: Library guide
Description: A guide working in a quiet library
Greeting: What are you looking for today?
Definition: Speak concisely in Japanese.
{{user}}: Can you recommend a book?
{{char}}: Tell me your favorite genre.</code></pre><p>Lore can use the documented labeled text format or common JSON with entries. There is no automatic account integration, extraction of private settings, or dedicated importer for an account's entire conversation history.</p>`
        },
        {
          id: 'keep-the-original', title: 'Keep the original and your edits',
          html: `<p>The original is stored separately from your edits. URL imports retain provenance such as the source URL, author, original license text, retrieval time, SHA-256, and revision. An unknown license stays unknown; a site's overall license is not automatically assigned to a work. RisuRealm provenance is distinguished as browser-reported.</p><p>Use a Kyalulu backup to restore edited content and the original export to retain source information. CC formats cannot represent a whole conversation or every setting. External image URLs and scripts are not automatically executed, and importing does not change endpoints, authentication, or model loading. Check the <a href="{{doc:compatibility}}">compatibility guide</a> for usable versus preserved fields, or return to the <a href="{{doc:index}}">documentation index</a>.</p>`
        }
      ]
    }
  },
  {
    slug: 'compatibility',
    group: 'reference',
    icon: '🗂️',
    title: { ja: '移行形式と互換性', en: 'Formats and compatibility' },
    description: {
      ja: 'カード、プリセット、Lore、履歴の対応範囲と、保持されても動かない項目を確認する。',
      en: 'Check support for cards, presets, Lore, and history, including fields retained without being executed.'
    },
    keywords: {
      ja: ['互換性', 'CCv2', 'CCv3', 'CHARX', 'SillyTavern', 'BYAF', 'RisuAI', 'Lorebook'],
      en: ['compatibility', 'CCv2', 'CCv3', 'CHARX', 'SillyTavern', 'BYAF', 'RisuAI', 'Lorebook']
    },
    readingMinutes: 7,
    sources: ['docs/COMPATIBILITY.md', 'docs/REMOTE.md', 'README.md'],
    sections: {
      ja: [
        {
          id: 'support-matrix', title: '取り込みと実行の対応表',
          html: `<p>「読み込める」「保持する」「生成に使う」は別の意味です。まず次の表で、移したい設定がどこまで使えるか確認してください。対応は公開スナップショットの範囲であり、外部アプリの全バージョンで同じ動作になる保証ではありません。</p><table><thead><tr><th>形式</th><th>使える内容</th><th>保持のみ／対象外</th></tr></thead><tbody><tr><td>Character Card V1／V2／V3</td><td>JSON、PNG／APNG内カード、CHARX。人物設定、挨拶、例文、system／履歴後指示、Lore、画像</td><td>未知フィールド・拡張は保持。作者コメントは生成に不使用。画像アニメーションの再生は保証しない</td></tr><tr><td>SillyTavern</td><td>生成プリセット、System Prompt、Story String、順序付きPrompt Manager、World Info</td><td>Text Completion／Instructのモデル専用整形、動的な深さ挿入、複雑なHandlebars、未対応マクロは実行しない</td></tr><tr><td>Backyard AI BYAF v1</td><td>シナリオ別のキャラ設定、画像、例文、初回メッセージ、サンプラー、選択した履歴</td><td>grammar／promptTemplateは実行しない。返答候補は最新activeTimestampを採用し、他候補は原本に保持</td></tr><tr><td>RisuAI</td><td>共通カードの拡張、共通Lore、画像・表情・背景参照、静的文字列変数</td><td>スクリプト、動的変数操作、独自HTMLは実行しない。アプリ全体のバックアップは対象外</td></tr><tr><td>Character.AI</td><td>名前、説明、Greeting、Definitionの手動テキスト／JSON、所定Lore形式</td><td>アカウント自動取得、非公開情報抽出、全履歴専用Importerは対象外</td></tr></tbody></table>`
        },
        {
          id: 'prompt-and-lore', title: '文体やLoreが変わったら',
          html: `<p>移行キャラへ既存の獣人世界観やZeta文体を自動追加しません。ただしRuntimeのreply／state_update契約は常に付くため、元アプリの推論テンプレートをそのまま再現するものではありません。標準マクロ、{{char}}、{{user}}、静的な{{getvar::name}}には対応し、未対応マクロは勝手に展開しません。</p><p>Loreはキーワード、常時有効、補助キーワード、順序、前後位置、走査深度、推定予算、再帰検索に対応します。未指定の走査範囲は直近2メッセージ、予算はLorebookごとに推定1,024トークン。正規表現・確率・時間条件などの未対応条件は理由付きで無効化します。有効チェックを戻すだけでは実行されません。</p><ol><li>プレビューの変換理由を読む。</li><li>Researcher DebugでLore採用理由と要求・適用・未対応設定を確認する。</li><li>動的機能に依存する部分を、必要に応じて静的な文章へ編集する。</li></ol><p>サンプラーも実際のProviderが対応する値だけを送ります。保持された値がすべて効くわけではありません。</p>`
        },
        {
          id: 'export-options', title: '書き出し先を選ぶ',
          html: `<ul><li><strong>CCv2 JSON／PNG：</strong>基本カードとLore、未知拡張。V3固有要素や追加画像の制約は事前表示します。</li><li><strong>CCv3 JSON／PNG：</strong>画像資産も含めますが、受け取り側の対応差は残ります。</li><li><strong>CCv3 CHARX：</strong>card.jsonと埋め込み画像をZIPへまとめます。</li><li><strong>Kyaluluバックアップ：</strong>編集結果、設定、選択済み履歴、画像の復元用です。</li><li><strong>原本：</strong>アップロードしたバイト列そのもの。未選択履歴や未対応の非画像要素もここに残ります。</li></ul><p>ST／BYAFの編集後データを元の専用形式へ戻す機能は含みません。PNG以外のアイコンしかない場合、PNG出力には仮画像を使うため、画像を保つにはCHARX・バックアップ・原本を選びます。</p>`
        },
        {
          id: 'migration-limits', title: '移行前に知っておく制限',
          html: `<aside class="callout warning"><p>設定の互換性は、会話品質や別アプリへの完全な往復互換を保証しません。外部画像URLは参照として残り、自動ダウンロードしません。</p></aside><p>選択した履歴は新しいセッションへ本文・順序・日時・由来を移します。過去のStateや記憶、成功した生成記録を後から作ることはありません。ファイル取り込みは32 MiB、アーカイブ展開後は128 MiB・512ファイルが上限です。Remote経由ではmultipart全体16 MiBというさらに小さい制限があります。</p><p>まず原本を残して小さなカードで確認し、書き出し前の欠落表示を読んでください。具体的な操作は<a href="{{doc:imports}}">取り込みガイド</a>、スマホ利用は<a href="{{doc:mobile}}">モバイルガイド</a>、暗号化中継の制限は<a href="{{doc:remote}}">Remoteガイド</a>へ進めます。</p>`
        }
      ],
      en: [
        {
          id: 'support-matrix', title: 'Import and execution support',
          html: `<p>Reading a field, retaining it, and using it during generation are different capabilities. Check what your settings actually support below. This describes the public snapshot and does not guarantee identical behavior across every version of another app.</p><table><thead><tr><th>Format</th><th>Usable content</th><th>Retained only / excluded</th></tr></thead><tbody><tr><td>Character Card V1 / V2 / V3</td><td>JSON, cards in PNG/APNG, and CHARX; personality, greetings, examples, system/post-history instructions, Lore, images</td><td>Unknown fields and extensions retained; creator comments excluded from generation; animated image playback not guaranteed</td></tr><tr><td>SillyTavern</td><td>Generation presets, System Prompt, Story String, ordered Prompt Manager elements, World Info</td><td>Model-specific Text Completion/Instruct formatting, dynamic depth insertion, complex Handlebars, and unsupported macros are not executed</td></tr><tr><td>Backyard AI BYAF v1</td><td>Scenario-specific character settings, images, examples, initial message, samplers, selected history</td><td>grammar/promptTemplate not executed; newest activeTimestamp selects the reply variant, others remain in the original</td></tr><tr><td>RisuAI</td><td>Common-card extensions, common Lore, image/expression/background references, static string variables</td><td>Scripts, dynamic variable operations, and custom HTML not executed; whole-app backups excluded</td></tr><tr><td>Character.AI</td><td>Manual text/JSON for name, description, Greeting, Definition, and the specified Lore formats</td><td>Automatic account retrieval, private information extraction, and a dedicated full-history importer excluded</td></tr></tbody></table>`
        },
        {
          id: 'prompt-and-lore', title: 'When style or Lore behaves differently',
          html: `<p>Imported characters do not automatically receive the existing beastfolk setting or Zeta style. The Runtime always adds its reply/state_update contract, however, so it does not reproduce the original app's inference template unchanged. Standard macros, {{char}}, {{user}}, and static {{getvar::name}} variables are supported. Unsupported macros are not silently expanded.</p><p>Lore supports keywords, constant activation, secondary keywords, order, before/after positions, scan depth, estimated budgets, and recursive retrieval. Defaults scan the latest two messages with an estimated 1,024-token budget per Lorebook. Unsupported conditions such as regex, probability, and time are disabled with an explanation; restoring an enabled checkbox alone does not execute them.</p><ol><li>Read conversion explanations in the preview.</li><li>Use Researcher Debug to inspect Lore selection and requested, applied, and unsupported settings.</li><li>Where necessary, rewrite dependencies on dynamic features as static text.</li></ol><p>Only sampler values supported by the actual Provider are sent. Retaining a value does not make it effective.</p>`
        },
        {
          id: 'export-options', title: 'Choose an export format',
          html: `<ul><li><strong>CCv2 JSON / PNG:</strong> basic cards, Lore, and unknown extensions; V3-specific and additional-image limitations appear before download.</li><li><strong>CCv3 JSON / PNG:</strong> includes image assets, with differences in receiving-app support.</li><li><strong>CCv3 CHARX:</strong> packages card.json and embedded images in a ZIP.</li><li><strong>Kyalulu backup:</strong> restores edited content, settings, selected history, and images.</li><li><strong>Original:</strong> the exact uploaded bytes, including unselected history and unsupported non-image elements.</li></ul><p>Exporting edited ST/BYAF content back into its original proprietary format is not included. If the only icon is not PNG, PNG export uses a placeholder. Choose CHARX, a backup, or the original to retain those images.</p>`
        },
        {
          id: 'migration-limits', title: 'Know the migration limits',
          html: `<aside class="callout warning"><p>Settings compatibility does not guarantee conversation quality or a complete round trip through another app. External image URLs remain references and are not automatically downloaded.</p></aside><p>Selected history moves text, order, timestamps, and provenance into a new session. It does not retroactively create State, memories, or successful generation records. File imports are limited to 32 MiB; expanded archives to 128 MiB and 512 files. Remote imposes a smaller 16 MiB limit on the entire multipart body.</p><p>Keep the original, check a small card first, and read loss warnings before exporting. Continue with the <a href="{{doc:imports}}">import guide</a>, the <a href="{{doc:mobile}}">mobile guide</a>, or the <a href="{{doc:remote}}">Remote guide</a> for encrypted transport limits.</p>`
        }
      ]
    }
  },
  {
    slug: 'mobile',
    group: 'connect',
    icon: '📱',
    title: { ja: '自分のPCへスマホから接続する', en: 'Connect to your PC from a phone' },
    description: {
      ja: '直接HTTPSで端末を登録し、PC上の会話をAndroid PWAから使う。',
      en: 'Pair over direct HTTPS and use conversations on your PC from the Android PWA.'
    },
    keywords: {
      ja: ['Android', 'PWA', 'スマホ', 'HTTPS', '端末登録', 'ホームサーバー', 'オフライン'],
      en: ['Android', 'PWA', 'mobile', 'HTTPS', 'pairing', 'home server', 'offline']
    },
    readingMinutes: 6,
    sources: ['docs/ANDROID_PWA.md', 'scripts/HOME_SERVER.md', 'README.md'],
    sections: {
      ja: [
        {
          id: 'how-mobile-works', title: 'PC上の会話を持ち歩く仕組み',
          html: `<p>Android PWAは、自分のPC／サーバーのKyaluluへ直接HTTPSで接続します。キャラ、履歴、記憶の正本とモデル推論は接続先にあり、スマホは操作画面です。1台のRuntimeを1人が管理し、自分の複数端末で同じデータを使います。端末登録は複数ユーザーの権限分離ではありません。</p><p>マネージドCloud、スマホ単体のLLM、接続先間の自動同期、Google Play配布を提供するものではありません。クラウドのモデルを選んでも、会話を持つPCが停止・スリープすれば使えません。ポート開放なしの中継方式を検討する場合は<a href="{{doc:remote}}">Remoteガイド</a>を読んでください。</p>`
        },
        {
          id: 'pair-over-https', title: 'HTTPSで登録する手順',
          html: `<ol><li>PCでWebをビルドし、Androidが信頼する証明書と正確なHTTPS Originを用意します。秘密鍵はWeb配信フォルダーの外へ置きます。</li><li>ホームサーバーを起動します。既存会話を使うならDesktopと同じ保存先を指定し、その保存先を同時利用するRuntimeを重複起動しないようにします。1 workerで、auto-reloadなしで運用します。</li><li>PC側のhome_server.py codeで8桁のコードを発行します。</li><li>Android ChromeでHTTPSアドレスを開き、端末名とコードを入力します。</li><li>トークを開き、アプリ情報またはChromeメニューからホーム画面へ追加します。</li></ol><pre><code>pnpm --filter web build
# 証明書とホスト名は自分の環境の値へ置き換える
.venv/Scripts/python.exe scripts/home_server.py serve --origin https://home.example:8000 --cert C:/certs/home.pem --key C:/certs/home-key.pem
.venv/Scripts/python.exe scripts/home_server.py code --tls-name home.example --ca C:/certs/ca.pem</code></pre><p>コードは120秒・1回限りで、5回の失敗でロックされます。再発行は前のコードを無効にします。LANのHTTPや証明書警告の無視を常用しないでください。TLS・ネットワーク・ファイアウォール設定は自動では行いません。</p>`
        },
        {
          id: 'connection-and-offline', title: '接続先、切断、更新',
          html: `<p>「設定 → 会話を持ち歩く」で接続先を保存できます。切り替えると別サーバーの画面を開き、認証情報を転送しません。接続先変更はデータ移行ではなく、カードの入出力だけでは記憶を含む会話全体も移りません。</p><p>切断後は生成IDと確定履歴を照合します。切断を理由に自動再送しないので、結果確認前に同じ文章を手動で送り直さないでください。Service Workerは画面などの公開ビルド資産だけを保存し、API、会話履歴、利用者画像は保存しません。オフラインで過去の会話を読む機能や返信生成はありません。更新は生成・編集を終えて結果を確認してから適用し、他タブが開いていれば保留されます。</p>`
        },
        {
          id: 'device-safety-and-limits', title: '端末管理と利用範囲',
          html: `<p>登録端末はキャラ編集、ファイル／テキスト取り込み、記憶の訂正を使えます。LE管理、モデル削除・ダウンロード、比較実験、外部Hub検索・URL取得はPC側で行います。紛失時はPCのdevicesでIDを確認し、revokeで解除してください。サーバー再起動でも登録はすべて無効になりますが、解除前に受け付けた処理は完了する場合があります。</p><p>下書きは端末内の保存領域にあり、暗号化保管庫ではありません。登録解除後も残るため、共用端末ではOSロックとサイトデータ削除を使います。公開資料は実装とブラウザー検証を説明していますが、Android実機のインストール、Gboard、回線切替、実モデルの品質と待ち時間は正式公開の確認項目です。準備済みを正式受け入れ済みとは扱いません。カード移行は<a href="{{doc:imports}}">取り込みガイド</a>へ進めます。</p>`
        }
      ],
      en: [
        {
          id: 'how-mobile-works', title: 'Take your PC conversations with you',
          html: `<p>The Android PWA connects directly over HTTPS to Kyalulu on your own PC or server. That server owns the characters, history, and memories and runs model inference; the phone provides the interface. One person manages one Runtime and accesses the same data from their own devices. Pairing does not isolate multiple users.</p><p>This does not provide managed Cloud, phone-only LLM execution, automatic synchronization between servers, or Google Play distribution. Even with an external cloud model, the PC holding your conversations must remain awake and online. For relay access without inbound port forwarding, see the <a href="{{doc:remote}}">Remote guide</a>.</p>`
        },
        {
          id: 'pair-over-https', title: 'Pair over HTTPS',
          html: `<ol><li>Build the Web app on the PC and prepare a certificate Android trusts and the exact HTTPS Origin. Keep the private key outside the served Web directory.</li><li>Start the home server. To continue existing conversations, select the Desktop data directory and avoid running another Runtime against it concurrently. Use one worker without auto-reload.</li><li>Issue an eight-digit code on the PC with home_server.py code.</li><li>Open the HTTPS address in Android Chrome and enter a device name and the code.</li><li>Open a conversation and add the app to the home screen through app information or Chrome's menu.</li></ol><pre><code>pnpm --filter web build
# Replace certificate paths and hostname with your own values
.venv/Scripts/python.exe scripts/home_server.py serve --origin https://home.example:8000 --cert C:/certs/home.pem --key C:/certs/home-key.pem
.venv/Scripts/python.exe scripts/home_server.py code --tls-name home.example --ca C:/certs/ca.pem</code></pre><p>The code lasts 120 seconds, permits one use, and locks after five failed attempts. Issuing a new code invalidates the previous one. Do not routinely use LAN HTTP or bypass certificate warnings. TLS, network, and firewall setup are not automatic.</p>`
        },
        {
          id: 'connection-and-offline', title: 'Servers, disconnections, and updates',
          html: `<p>Save servers under the conversation portability settings. Switching opens that server's interface without forwarding credentials. Switching servers does not migrate data, and card import/export alone does not move a whole conversation with its memories.</p><p>After a disconnect, generation IDs are checked against durable history. Disconnection does not trigger automatic resubmission; do not manually send the same message again before checking its result. The Service Worker caches only public build assets such as the interface, never APIs, conversation history, or user images. Offline history reading and reply generation are unavailable. Apply an update after generation or editing has finished and the result is confirmed; updates wait while another Kyalulu tab is open.</p>`
        },
        {
          id: 'device-safety-and-limits', title: 'Device management and limits',
          html: `<p>Paired devices can edit characters, import files/text, and correct memories. LE management, model deletion/download, comparison experiments, and external Hub search/URL retrieval remain PC operations. For a lost device, find its ID with devices and revoke it on the PC. A server restart also invalidates all registrations, although work accepted before revocation may finish.</p><p>Drafts use device-local storage, not an encrypted vault, and remain after revocation. Use OS locking and delete site data on shared devices. Public documentation describes implementation and browser checks; physical Android installation, Gboard input, network switching, and real-model quality and latency remain formal release checks. Preparation is not formal acceptance. Continue to the <a href="{{doc:imports}}">import guide</a> to migrate cards.</p>`
        }
      ]
    }
  },
  {
    slug: 'remote',
    group: 'connect',
    icon: '🔗',
    title: { ja: 'Remoteの接続とペアリング', en: 'Remote connections and pairing' },
    description: {
      ja: 'PCとPWAを暗号化中継でつなぐ開発候補の仕組み、登録手順、運用上の限界。',
      en: 'Understand the encrypted relay development candidate, its pairing flow, and operational limits.'
    },
    keywords: {
      ja: ['Remote', 'Relay', 'Host', 'WSS', 'Noise', 'QR', 'ペアリング', '暗号化'],
      en: ['Remote', 'Relay', 'Host', 'WSS', 'Noise', 'QR', 'pairing', 'encryption']
    },
    readingMinutes: 7,
    sources: ['docs/REMOTE.md', 'deploy/remote/README.md', 'docs/ANDROID_PWA.md'],
    sections: {
      ja: [
        {
          id: 'remote-status-and-route', title: '何を中継するのか',
          html: `<aside class="callout warning"><p>Remoteは実装された開発候補です。production受け入れ済み、正式v1.0.0公開済みのサービスとしては扱いません。</p></aside><p>PCのHostとAndroid PWAはそれぞれRelayへ外向きWSS接続を開き、Noiseで会話の通信を暗号化します。PCへインターネットから着信するポートを開ける構成ではありません。Relayが持つのは経路用メタデータとトークンハッシュで、Noise鍵、会話本文、オフライン配送キューは持ちません。</p><p>キャラ、SQLite履歴、記憶とRuntimeはPCに残り、LEは別プロセスで動きます。Remoteはクラウド推論、PC停止時の自動切替、P2P、プッシュ通知を追加しません。PCが眠れば会話は使えません。直接HTTPSを選ぶ場合は<a href="{{doc:mobile}}">モバイルガイド</a>を使います。</p>`
        },
        {
          id: 'prepare-a-host', title: '登録前に用意するもの',
          html: `<p>運用者がRelayとPWAを用意し、別々のAPP／RELAY DNS名、TLS、PWAビルドの正確なRelay Originを合わせます。ソースを取得しただけでは配備や契約は行われません。公開資料の月3,000円は目標予算であり、実証済みの料金見積もりではありません。</p><ol><li>Relay運用者から1回限りのHost招待を受け取ります。</li><li>PCのremote_host.py registerで対話的に招待を入力し、永続的なvaultとデータ保存先を選びます。招待をコマンド引数やログへ貼らないでください。</li><li>remote_host.py serveでHostを起動し、LEも独立して起動します。管理用HTTPは127.0.0.1:8766に限定されます。</li><li>既存データを使う場合は、それを使う古いRuntime／Desktopをすべて停止し、実際の保存先を確認してから--adopt-existing-dataで登録します。DBと画像資産を合わせてバックアップしてください。</li></ol><p>Windowsのvaultは同じ利用者のDPAPI、POSIXは0600権限で保護します。同じ利用者権限で動く悪意あるコードまで防ぐ仕組みではありません。vault紛失時はHostと端末の再登録が必要です。</p>`
        },
        {
          id: 'pair-and-revoke', title: 'QRを読み、PCで承認する',
          html: `<ol><li>PCの設定で「このPCから、会話を持ち歩く」を開き、「スマホを登録する」を選びます。</li><li>AndroidでQRを読み取り、PWAに端末名を入力して「このPCに登録する」を選びます。</li><li>スマホに表示された6桁コードをPCの承認画面へ入力します。</li><li>承認後に「会話を開く」を選び、必要ならPWAをインストールします。</li></ol><p>QRは5分以内・1回限りで、Host公開鍵のpinと登録用の秘密を含みます。画像を公開しないでください。Relayのticket取得だけではRuntimeへアクセスできず、Noise識別、秘密の検証、PCの承認が必要です。</p><p>1 ownerにつきHostは2台、承認済みスマホは5台まで。端末登録は特定のHostに属し、別Hostには別のQR登録が必要で、履歴も同期しません。紛失したスマホはPCで登録解除します。スマホ内の鍵を消すことと、サーバー側の登録解除は別です。</p>`
        },
        {
          id: 'recovery-and-trust', title: '切断時の扱いと信頼の限界',
          html: `<p>標準Noise_XX_25519_ChaChaPoly_SHA256を使い、登録済み鍵を固定します。鍵が変われば再登録します。切断だけでは受理済み生成を中止せず、再接続でNoiseをやり直して要求IDと連番を照合します。短期バッファにない結果は永続化された状態と履歴で確認し、自動再送しません。結果が曖昧な取り込み・編集も確認してから操作します。</p><p>E2EEでもIP、時刻、転送サイズは隠れません。改ざんされたPWA配布元や端末が平文を取る脅威も残ります。端末内の下書きは暗号化保管庫ではなく、アップロードはmultipart全体16 MiBまでです。公開TLS運用、Android実機、実Gemma、24時間継続、外部セキュリティレビューは公開前の確認項目です。短いloopback試験をインターネット品質や長期安定性の保証へ読み替えないでください。開発者向けの入口は<a href="{{doc:development}}">開発ガイド</a>です。</p>`
        }
      ],
      en: [
        {
          id: 'remote-status-and-route', title: 'What the relay carries',
          html: `<aside class="callout warning"><p>Remote is an implemented development candidate. It is not an accepted production service or an approved v1.0.0 release.</p></aside><p>The PC Host and Android PWA each open outbound WSS connections to Relay and encrypt conversation traffic with Noise. This does not require opening an inbound Internet port on the PC. Relay retains routing metadata and token hashes, never Noise keys, conversation text, or an offline delivery queue.</p><p>Characters, SQLite history, memories, and Runtime stay on the PC; LE runs separately. Remote adds no cloud inference, automatic fallback while the PC is down, P2P, or push notifications. Conversations are unavailable while the PC sleeps. For direct HTTPS, use the <a href="{{doc:mobile}}">mobile guide</a>.</p>`
        },
        {
          id: 'prepare-a-host', title: 'Prepare before pairing',
          html: `<p>An operator must provide Relay and the PWA and align separate APP/RELAY DNS names, TLS, and the exact Relay Origin in the PWA build. Obtaining the source does not deploy services or purchase hosting. The documented JPY 3,000 monthly figure is a target budget, not a verified quote.</p><ol><li>Obtain a one-use Host invitation from the Relay operator.</li><li>Enter it interactively with remote_host.py register on the PC and choose durable vault and data directories. Do not put the invitation in command arguments or logs.</li><li>Start the Host with remote_host.py serve and run LE independently. Management HTTP is limited to 127.0.0.1:8766.</li><li>To adopt existing data, stop every old Runtime/Desktop using it, verify the actual directory, and register with --adopt-existing-data. Back up the DB and image assets together.</li></ol><p>Windows protects the vault with the current user's DPAPI; POSIX uses 0600 permissions. Neither protects against malicious code running as that user. Losing the vault requires Host and device re-enrollment.</p>`
        },
        {
          id: 'pair-and-revoke', title: 'Scan the QR and approve on the PC',
          html: `<ol><li>Open the PC settings for taking this PC's conversations with you and choose phone registration.</li><li>Scan the QR on Android, enter a device name in the PWA, and choose registration with this PC.</li><li>Enter the phone's six-digit code in the PC approval screen.</li><li>After approval, open conversations and optionally install the PWA.</li></ol><p>The QR expires within five minutes and permits one enrollment. It contains a Host public-key pin and an enrollment secret; never publish the image. Redeeming a Relay ticket alone cannot access Runtime. Noise identity, secret validation, and PC approval are required.</p><p>Each owner can have two Hosts and five approved phones. A registration belongs to one Host; another Host needs its own QR enrollment and does not synchronize history. Revoke a lost phone on the PC. Deleting a phone's local key is different from revoking its server-side registration.</p>`
        },
        {
          id: 'recovery-and-trust', title: 'Recovery and trust limits',
          html: `<p>Remote uses standard Noise_XX_25519_ChaChaPoly_SHA256 and pins registered keys. A changed key requires re-enrollment. Disconnecting does not cancel an accepted generation. Reconnection repeats Noise and reconciles request IDs and sequences; results outside the short buffer use durable status/history, never automatic resubmission. Inspect ambiguous imports or edits before repeating them.</p><p>E2EE does not hide IPs, timing, or transfer sizes. A compromised PWA distributor or endpoint can still capture plaintext. Device drafts are not an encrypted vault; uploads are limited to 16 MiB for the whole multipart body. Production TLS operations, physical Android testing, real Gemma acceptance, 24-hour endurance, and external security review remain release checks. A short loopback test does not establish Internet quality or long-term reliability. Developers can continue to the <a href="{{doc:development}}">development guide</a>.</p>`
        }
      ]
    }
  },
  {
    slug: 'development',
    group: 'build',
    icon: '🛠️',
    title: { ja: '開発環境とAPIの入口', en: 'Development setup and API entry points' },
    description: {
      ja: 'Web・Python Runtime・LEの役割を理解し、公開ソースから起動と軽量な確認を始める。',
      en: 'Understand Web, Python Runtime, and LE responsibilities, then start from the public source with lightweight checks.'
    },
    keywords: {
      ja: ['開発', 'API', 'FastAPI', 'uv', 'pnpm', 'LE', 'SSE', 'モデル設定'],
      en: ['development', 'API', 'FastAPI', 'uv', 'pnpm', 'LE', 'SSE', 'model configuration']
    },
    readingMinutes: 8,
    sources: [
      'README.md', 'PRODUCT_SPEC.md', 'PROJECT_SPEC.md', 'LE_ARCHITECTURE.md',
      'pyproject.toml', 'runtime/pyproject.toml', '.env.example',
      'models/example-lmstudio.yaml', 'models/example-ollama.yaml',
      'models/example-openai.yaml', 'models/example-le.yaml', 'docs/COMPATIBILITY.md'
    ],
    sections: {
      ja: [
        {
          id: 'architecture-boundaries', title: 'どこへ変更を入れるか',
          html: `<p>WebはReact／TypeScriptの操作画面、DesktopはElectronによるプロセス監督、Python APIはFastAPIのHTTP／SSE境界です。共通Runtimeがキャラ、人物像、世界、状態、記憶、プロンプトと評価を扱い、SQLiteへ保存します。UIやAPIに依存しないRuntimeの処理は、会話と比較実験で共有するのが設計の軸です。</p><p>LEは別リポジトリ・別プロセスのローカル実行エンジンです。Kyaluluがキャラの正本を持ち、LEは推論やモデル管理を担います。ブラウザーはKyaluluの/api/le/*などを通し、LE管理トークンを受け取りません。LE設計書に載る画像・音声・ツール・Cloudなどの将来範囲を、この公開版のリリース済み機能と読み替えないでください。通常操作と技術診断を分けるUI設計も、公開PRODUCT_SPECの方針です。</p>`
        },
        {
          id: 'start-from-source', title: '公開ソースから起動する',
          html: `<p>Python 3.11以上、uv 0.12以上、Node.js 20以上、pnpm 10以上を用意し、リポジトリのルートで実行します。公開pyprojectはrootとruntimeのuv workspaceを定義します。依存を固定lockで同期し、workspace本体のwheelインストールを省いてソースから動かします。</p><pre><code># .envがまだない場合だけコピーする
if (!(Test-Path .env)) { Copy-Item .env.example .env }
uv sync --frozen --all-packages --all-extras --no-install-workspace
pnpm install --frozen-lockfile
uv run --no-sync --directory runtime uvicorn python.api.main:app --reload --host 127.0.0.1 --port 8000
# 別のターミナルで、ルートから
pnpm dev</code></pre><p>--no-syncは起動時の再同期を避けます。上の--reloadは開発用であり、個人サーバーの常用手順ではありません。.envには自分の接続先を設定し、認証情報をソースやWebへ含めないでください。これは公開ファイルから導いた手順で、このガイド作成時に新規環境へインストールして実行確認した記録ではありません。</p>`
        },
        {
          id: 'api-and-model-config', title: '読み取りAPIとモデル設定',
          html: `<p>APIが起動したら、まず次の読み取りでモデル一覧とProviderの接続状態を確認します。これらは返信生成の要求ではありません。</p><pre><code>curl.exe http://127.0.0.1:8000/api/models
curl.exe http://127.0.0.1:8000/api/providers/health
curl.exe http://127.0.0.1:8000/api/library</code></pre><p>ストリーミング生成はPOST /api/chat/streamで、取り込みはPOST /api/imports/previewとPOST /api/imports/text/previewがプレビュー、POST /api/imports/{preview_id}/commitが確定です。プレビューと保存を分け、確定APIの現在の入力契約を確認してから組み込んでください。設計書の「Suggested categories」だけを実在APIの根拠にはしません。</p><p>models/*.yamlはモデル登録の正本で、SQLiteはキャッシュです。LM Studio／Ollama例のprovider.modelを実際のサーバーIDに合わせます。OpenAI互換は.envのベースURLとキーを使い、URLに/chat/completionsを含めません。例のモデル名やcontext_lengthは設定例であり、ロード済み・対応済みの証拠ではありません。LE配信モデルはYAMLなしでもle:&lt;id&gt;で一覧へ追加されます。</p>`
        },
        {
          id: 'validate-without-quality-claims', title: '変更した範囲を確認する',
          html: `<ol><li>差分を見て、API契約・保存データ・表示のどれが変わったか整理します。</li><li>pnpm typecheckを実行し、Webの変更ならpnpm --filter web testとpnpm --filter web buildで確認します。</li><li>Python変更は.venv/Scripts/python.exe -m pytest tests/対象ファイル.py -qのように対象を絞り、テスト専用データを使います。</li><li>会話の配線確認が必要ならMockを選び、実モデル推論とは分けて記録します。Mockの成功をモデル品質や正式配布の合格にはしません。</li></ol><p>公開資料ではDesktopのAPI／LE監督を説明していますが、Python／LEのインストーラー同梱は未完了です。ソースの起動方法をnpmやCloudの公開済み配布手順として案内しません。本体コードはAGPL-3.0-onlyで、モデルや外部カードには配布元のライセンスが適用されます。人格評価は<a href="{{doc:characterbench}}">CharacterBenchガイド</a>、移行契約は<a href="{{doc:compatibility}}">互換対応表</a>へ進めます。</p>`
        }
      ],
      en: [
        {
          id: 'architecture-boundaries', title: 'Where a change belongs',
          html: `<p>Web provides the React/TypeScript interface, Desktop supervises processes through Electron, and the Python API provides the FastAPI HTTP/SSE boundary. The shared Runtime handles characters, personas, worlds, state, memory, prompts, and evaluation and stores data in SQLite. Sharing UI/API-independent Runtime behavior between conversations and experiments is a central design principle.</p><p>LE is a separate local execution engine in its own repository and process. Kyalulu owns character truth; LE handles inference and model management. The browser uses Kyalulu routes such as /api/le/* and does not receive LE management tokens. Future media, voice, tools, or Cloud scope in the LE architecture proposal is not evidence of released features in this public version. Separating everyday UI from technical diagnostics also follows the public PRODUCT_SPEC.</p>`
        },
        {
          id: 'start-from-source', title: 'Start from the public source',
          html: `<p>Use Python 3.11+, uv 0.12+, Node.js 20+, and pnpm 10+, and run from the repository root. The public pyprojects define a uv workspace containing the root and runtime projects. Synchronize locked dependencies while skipping installation of workspace wheels, then execute from source.</p><pre><code># Copy only when .env does not exist
if (!(Test-Path .env)) { Copy-Item .env.example .env }
uv sync --frozen --all-packages --all-extras --no-install-workspace
pnpm install --frozen-lockfile
uv run --no-sync --directory runtime uvicorn python.api.main:app --reload --host 127.0.0.1 --port 8000
# In another terminal, from the root
pnpm dev</code></pre><p>--no-sync avoids another synchronization during startup. --reload above is for development, not continuous home-server operation. Configure your endpoints in .env and keep credentials out of source and Web builds. These instructions are derived from public files; this guide's creation did not include a fresh installation and execution check.</p>`
        },
        {
          id: 'api-and-model-config', title: 'Read APIs and model configuration',
          html: `<p>Once the API is running, use these reads to inspect the model list and Provider connectivity. They do not request reply generation.</p><pre><code>curl.exe http://127.0.0.1:8000/api/models
curl.exe http://127.0.0.1:8000/api/providers/health
curl.exe http://127.0.0.1:8000/api/library</code></pre><p>Streaming generation uses POST /api/chat/stream. Imports preview through POST /api/imports/preview or POST /api/imports/text/preview and commit through POST /api/imports/{preview_id}/commit. Keep preview separate from persistence and check the current commit input contract before integrating it. A specification's suggested route categories alone do not prove an endpoint exists.</p><p>models/*.yaml is the registration source of truth; SQLite is a cache. Match provider.model in LM Studio/Ollama examples to the actual server ID. OpenAI-compatible configuration uses the base URL and key in .env; do not append /chat/completions to that URL. Example model names and context_length values do not prove a model is loaded or supported. LE-served models appear automatically as le:&lt;id&gt; without YAML.</p>`
        },
        {
          id: 'validate-without-quality-claims', title: 'Validate the affected behavior',
          html: `<ol><li>Inspect the diff and identify changes to API contracts, persisted data, or presentation.</li><li>Run pnpm typecheck; for Web changes, use pnpm --filter web test and pnpm --filter web build.</li><li>For Python changes, target the affected test, for example .venv/Scripts/python.exe -m pytest tests/YOUR_TEST.py -q, using dedicated test data.</li><li>If conversation wiring needs checking, select Mock and record it separately from real-model inference. Mock success does not establish model quality or release acceptance.</li></ol><p>Public documentation describes Desktop API/LE supervision, but bundling Python/LE into an installer remains incomplete. Source startup instructions are not released npm or Cloud distribution instructions. Core code uses AGPL-3.0-only; models and external cards retain their distributors' licenses. Continue to the <a href="{{doc:characterbench}}">CharacterBench guide</a> for character evaluation or the <a href="{{doc:compatibility}}">compatibility guide</a> for migration contracts.</p>`
        }
      ]
    }
  },
  {
    slug: 'characterbench',
    group: 'build',
    icon: '🧪',
    title: { ja: 'CharacterBenchで何を測れるか', en: 'What CharacterBench measures' },
    description: {
      ja: '12キャラ・264応答の固定パイロットで、機械採点とキャラ品質を分けて比較する。',
      en: 'Use a fixed 12-character, 264-response pilot while separating mechanical checks from character quality.'
    },
    keywords: {
      ja: ['CharacterBench', 'KCB', 'ベンチマーク', '評価', 'MIT', '機械採点', '人間評価'],
      en: ['CharacterBench', 'KCB', 'benchmark', 'evaluation', 'MIT', 'mechanical scoring', 'human review']
    },
    readingMinutes: 7,
    sources: [
      'benchmarks/characterbench/README.md', 'benchmarks/characterbench/README_JA.md',
      'benchmarks/characterbench/data/README.md', 'benchmarks/official/README.md', 'README.md'
    ],
    sections: {
      ja: [
        {
          id: 'two-benchmark-tracks', title: '本体ベンチとは別の評価系',
          html: `<p>CharacterBench v0.1は、日本語キャラクターAIを比較する独立したMITライセンスの工学パイロットです。12人のオリジナル成人架空キャラ、120単発プローブと12本の12ターン対話から、モデルごと・1反復あたり264応答を生成します。公開合成データの固定問題集であり、人間によって妥当性を検証したモデルランキングではありません。</p><p>benchmarks/officialはKyalulu Runtimeの状態、記憶、保存、共通プロンプトなどを使う別トラックです。CharacterBenchのCoreとSystemも混ぜません。同梱System bridgeは参考セッションアダプターで、実際のKyaluluアプリとの統合ではありません。MITはこのサブディレクトリのコードと新作コーパスに適用され、本体のAGPLを変更しません。</p>`
        },
        {
          id: 'start-without-inference', title: '推論なしで構成を確認する',
          html: `<p>Python 3.10以上で動き、実行時は標準ライブラリだけを使います。作業場所はbenchmarks/characterbenchです。最初はデータ検証と呼び出し計画だけを見れば、モデルやAPIキーは不要です。</p><pre><code>Set-Location benchmarks/characterbench
python -m kcb validate
python -m kcb plan --suite all --repeats 3
# 任意：固定MOCK応答のレポート。新しい出力先を使う
python -m kcb demo --out runs/my-demo</code></pre><p>planはネットワークを呼びません。allの1反復は264応答、3反復は792応答、smokeは22応答です。自由文の採点単位はallで84個、smokeで7個。12ターン対話は対話全体で1単位とします。demoは固定MOCKの操作確認で、実モデルの速度や品質の結果ではありません。リポジトリ版にはZIP配布版のHTMLランチャーはありません。</p>`
        },
        {
          id: 'read-scores-carefully', title: '機械採点とキャラ品質を分ける',
          html: `<p>runの主な機械指標は厳密JSONの状態診断正答率と項目別エラーです。文字数や箇条書きなどの表面条件も確認できますが、人格の魅力、日本語の自然さ、物語の良さをキーワード一致から推定しません。自由文の意味評価には別LLMのrubric採点、順序を反転したA/B比較、または人間によるブラインド評価が必要です。</p><p>LLM採点は未校正で、根拠引用の実在確認は採点の正しさの証明ではありません。評価数、未評価数、採点エラー、順序依存を合わせて読みます。少人数の好みや1台のGemmaパイロットから総合順位を断定しないでください。Core／System、データhash、プロトコル、反復数をそろえ、実行条件と採点条件を別々に残します。</p>`
        },
        {
          id: 'run-and-report-responsibly', title: '実モデルを比べる前の確認',
          html: `<ol><li>OpenAI互換チャットサーバーを自分で起動し、モデルをロードします。ツールは自動ダウンロードや起動をしません。doctorで正確なモデルIDを確認し、smokeから始めます。--probeやrunは実際の生成を伴います。</li><li>モデル重み、量子化、backend版、thinking、MTP、サンプリングを記録し、条件を変えたら新しい出力先を使います。</li><li>応答、エラー、欠測、manifestを保存し、完了表示だけで品質合格にしません。token上限で切れた本文や非正常終了は監査用に残しますが、採点や後続対話には使いません。</li><li>同条件の再開は--resume、失敗の再試行だけは--retry-errorsを明示します。成功応答を引き直して良い結果だけ選ぶ機能ではありません。</li></ol><p>usageがなければtoken数・料金は未測定で、ゼロではありません。観測可能な思考出力がなくても内部処理の不在は証明できません。保存済み応答のregradeは再推論せず、生成版と採点版を分けます。公開前は生の入力や履歴を確認し、人間評価のモデル対応キーを採点者へ配らないでください。Runtimeとの役割分担は<a href="{{doc:development}}">開発ガイド</a>、全体の入口は<a href="{{doc:index}}">ドキュメント一覧</a>にあります。</p>`
        }
      ],
      en: [
        {
          id: 'two-benchmark-tracks', title: 'Separate from the Runtime benchmark',
          html: `<p>CharacterBench v0.1 is an independent MIT-licensed engineering pilot for Japanese character AI. Twelve original adult fictional characters, 120 single-turn probes, and twelve 12-turn dialogues produce 264 responses per model per repeat. It is a fixed public synthetic corpus, not a human-validated model leaderboard.</p><p>benchmarks/official is a separate track using Kyalulu Runtime state, memory, persistence, and shared prompts. CharacterBench Core and System tracks must also remain separate. The bundled System bridge is a reference session adapter, not integration with the actual Kyalulu app. MIT applies to this subdirectory's code and newly authored corpus; it does not change the main repository's AGPL license.</p>`
        },
        {
          id: 'start-without-inference', title: 'Inspect the setup without inference',
          html: `<p>Use Python 3.10+; runtime dependencies are standard-library only. Work from benchmarks/characterbench. Data validation and call planning need neither a model nor an API key.</p><pre><code>Set-Location benchmarks/characterbench
python -m kcb validate
python -m kcb plan --suite all --repeats 3
# Optional fixed-MOCK report; use a new output directory
python -m kcb demo --out runs/my-demo</code></pre><p>plan makes no network calls. One all repeat produces 264 responses, three produce 792, and smoke produces 22. Free-text evaluation has 84 units for all and seven for smoke; a 12-turn dialogue is one evaluation unit. demo checks the workflow with fixed MOCK responses, not real-model speed or quality. The repository version does not include the ZIP distribution's HTML launchers.</p>`
        },
        {
          id: 'read-scores-carefully', title: 'Separate mechanics from character quality',
          html: `<p>The main mechanical metrics from run are strict-JSON state diagnostic accuracy and per-field errors. Literal constraints such as length or bullet formatting can also be checked, but keyword matches do not establish personality appeal, natural Japanese, or story quality. Semantic evaluation requires a separate LLM rubric judge, order-reversed A/B comparisons, or blind human review.</p><p>LLM judges are uncalibrated. Verifying that a quoted passage exists does not prove the judgment is correct. Read evaluated counts, missing judgments, judge errors, and order sensitivity together. A small group's preferences or a Gemma pilot on one machine cannot establish an overall ranking. Match Core/System tracks, data hashes, protocols, and repeat counts, and retain generation and judging conditions separately.</p>`
        },
        {
          id: 'run-and-report-responsibly', title: 'Before comparing real models',
          html: `<ol><li>Start an OpenAI-compatible chat server and load its model yourself; the tool does not download or start them. Use doctor to check the exact model ID and begin with smoke. --probe and run involve real generation.</li><li>Record weights, quantization, backend version, thinking, MTP, and sampling. Use a new output directory when conditions change.</li><li>Retain responses, errors, missing measurements, and the manifest. Completion alone does not establish quality. Token-truncated or abnormally finished responses remain available for audit but are not scored or used in subsequent dialogue.</li><li>Use --resume for the same conditions and explicitly add --retry-errors only to retry failures. Successful responses are not regenerated to cherry-pick better results.</li></ol><p>Without usage, token counts and costs are unmeasured, not zero. No observable reasoning output does not prove the absence of internal processing. regrade evaluates stored responses without new inference and records generation and grading versions separately. Review raw inputs and history before publication, and never give human raters the model identity key. See the <a href="{{doc:development}}">development guide</a> for Runtime responsibilities or the <a href="{{doc:index}}">documentation index</a> for all guides.</p>`
        }
      ]
    }
  }
];
