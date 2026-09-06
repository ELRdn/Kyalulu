# プリセット互換・キャラクター移行

更新: 2026-09-06。Phase 3のCreator／互換機能を優先して先行実装した。正式なフェーズ番号は変更しない。
実装範囲と検証範囲は異なる。実測結果は [互換受け入れ記録](COMPATIBILITY_ACCEPTANCE.md)、後続作業は [ロードマップ](ROADMAP.md) を参照。

## 対応表

| 系統 | 取り込み・使用 | 保存のみ／非対応 |
|---|---|---|
| Character Card | V1/V2/V3 JSON、PNG/APNG内のカード、CHARX。人物設定、複数の挨拶、会話例、system／履歴後指示、Lore、画像、作者情報 | 未知のフィールド・拡張は保存。作者コメントを生成には使わない。PNGの画像表示はカード用画像として扱い、アニメーション再生の保証はしない |
| SillyTavern | 生成プリセット、単独System Prompt、ContextのStory String、Prompt Managerの順序付きロール要素、World Info | Text Completionの区切り・Instruct・モデル専用推論整形。動的な深さへの挿入、複雑なHandlebars式、未対応マクロは保持と理由表示 |
| Backyard AI | BYAF v1のキャラ、シナリオ別の設定、画像、会話例、初回メッセージ、サンプラー、選択した履歴 | grammar／promptTemplateのモデル専用整形は実行しない。返答候補は最新のactiveTimestampを採用し、他候補は原本に保持 |
| RisuAI | 共通カードのRisu拡張、共通Lore、画像・表情・背景参照、静的な文字列変数 | スクリプト、動的な変数操作、独自HTMLは実行しない。アプリ全体のバックアップは対象外 |
| Character.AI | 名前・説明・Greeting・Definitionの手動貼り付け／JSON、Loreの所定テキスト／JSON | アカウント自動取得・非公開情報抽出・アカウント全履歴の専用Importerは対象外。DefinitionをAIで要約・書き換えない |

BYAF v1の公開仕様は「キャラ1件＋シナリオ1件以上」。シナリオごとに移行候補を作り、必要な候補と会話履歴を選択する。
STのWorld InfoとCharacter.AIが受け付ける共通Lore JSONは内容だけでは出所を区別できないため、World Infoとして正規化する。
モデル名は登録済みモデルとの対応候補として表示する。インポートによって接続先、認証、モデルのロード状態を変更しない。

## 使い方

1. Createにファイルをドロップするか、Character.AIの設定・Loreを貼り付ける。
2. プレビューでキャラ・履歴を選び、設定・画像・変換結果を確認する。同名でも初期選択は新規作成。更新する場合だけ保存先を指定する。
3. 内容を保存し、「キャラを開く」で挨拶を選んで会話を始める。
4. Createの編集画面で、名前、説明、文体、シナリオ、挨拶、会話例、Lore、画像、生成設定を変更できる。保存したプリセットは「生成プリセットと詳細な設定」から、版を指定したコピーとしてキャラに適用できる。
5. チャットの「✦ キャラ・プリセット」で会話用の生成プリセット、Lorebook、表情を選ぶ。表情は手動切替。既存会話のキャラ・プリセット・Loreの版は、明示的に最新版へ切り替えるまで固定する。
6. Createの「書き出し」で形式を選び、変換・欠落の説明を確認してからダウンロードする。

通常チャットでは取り込み由来の技術情報を表示しない。Researcher Debug（Ctrl+Shift+D）で、送信メッセージ、Lore採用理由、要求・適用・未対応設定、状態、計測、各試行を確認できる。
取り込んだキャラは公式キャラにはならない。成人向け表示設定と生成時の許可を別々に扱い、成人向けのキャラ・関連プリセット・Loreは許可なしで生成しない。

### Character.AI貼り付け

キャラ設定には次のラベルを使用する。Nameは必須、残りは省略できる。Definitionは最後に置く。以降の本文は改行・空白を含めて保持する（ラベル直後の区切り空白／改行を除く）。

```text
Name: シアン
Description: 図書館の案内人
Greeting: こんにちは。
Definition: 日本語で簡潔に話す。
{{user}}: こんにちは
{{char}}: 図書館へようこそ。
```

Loreは `Lorebook Name:`、`Entry Title:`、`Keywords:`、`Content:` の形式、または `entries` 内の `comment`・`key`・`content` を使うJSONを受け付ける。
元ファイルは別保存するので、正規化で表示用のラベルや形式が変わっても原本を書き出せる。

## プロンプトとLore

- 外部キャラには、既存の獣人世界観やZeta文体を自動追加しない。
- Runtimeの `reply`／`state_update` 契約は常に付ける。カードのsystem設定による上書き、`{{original}}`、user／assistantの会話例、履歴後の指示を処理する。
- Chat、SSE、Experiment Runnerは同じコンパイラーを使う。順序付きメッセージと各ターンの採用Loreを生成記録へ保存する。
- 標準の文字列マクロ、`{{char}}`、`{{user}}`、`{{getvar::name}}` の静的変数を処理する。未対応マクロは勝手に展開せず、Debugへ記録する。
- Loreはキーワード・大小文字・常時有効・補助キーワード・順序・前後位置・走査深度・推定予算・再帰検索に対応。未指定は直近2メッセージ、各Lorebookあたり推定1,024トークン。再帰では各項目を一度だけ採用する。
- 正規表現、確率、時間条件、未対応の論理条件・位置などは無効化し、理由を表示する。有効チェックだけを戻しても、未対応条件を弱めて実行しない。
- トークン予算は文字数からの推定。Providerが返す実トークン数とは別に表示する。サンプラーは実際のProviderが対応するものだけ送信する。

ST ContextはStory Stringをロール別プロンプトに変換する範囲の対応。Text Completionの整形を完全再現したという意味ではない。
独自スクリプトや高度なテンプレートに依存するキャラは、静的な設定への編集が必要になる。

## 保存・書き出し

| 出力 | 内容・制限 |
|---|---|
| CCv2 JSON / PNG | 基本カード、Lore、未知拡張。PNGにアイコン1枚。V3固有要素・追加画像などの制限をプレビューに表示 |
| CCv3 JSON / PNG | 基本カードと画像資産。JSONはdata URI、PNGはカードmetadataと埋め込み資産。宛先による対応差は残る |
| CCv3 CHARX | `card.json` と埋め込み画像をZIPでまとめる |
| Kyaluluバックアップ | 正規化した編集結果、設定、選択済み履歴、画像。Kyalulu内の復元に使用 |
| 原本 | アップロードしたバイト列をそのまま保存・取得。未選択履歴や未対応の非画像アーカイブ要素はこちらに残る |

ST／BYAFの編集後データを元の専用形式へ戻す機能は含まない。
CCだけでは会話履歴やKyaluluの全設定を表現できない。プリセット順序などは拡張に残すが、移行先アプリでの適用は保証しない。
PNG以外のアイコンしかない場合、PNG出力には仮画像を使い、事前に表示する。画像の保持にはCHARX／バックアップ／原本を利用する。

SQLiteにはライブラリの不変な版、原本SHA-256、プレビュー、取り込み要求ID、変換結果、履歴の由来を保存する。
既存公式YAMLは保持し、ユーザーライブラリは同じデータディレクトリ内のSQLiteと `library_assets/` で管理する。
プレビューの確定はトランザクション。再送は同じ要求IDなら同じ結果を返し、内容が異なる再利用と古い版への更新は409で拒否する。
画像保存だけが先に完了して取り込みをキャンセルした場合、参照されない資産が残ることがある。ライブラリの半端な登録は行わない。自動の資産整理は後続。

外部画像URLはダウンロードせず参照として保持。アーカイブの相対パス・重複・symlink・展開量を検証する。
上限はアップロード32 MiB、展開後128 MiB・512ファイル・個別32 MiB、画像16 MiB・3,200万画素。PNG/JPEG/WebP/GIFを実デコード検証し、HTML/SVG等を画像として配信しない。
履歴は選択したものを新しいセッションへ移す。本文・順序・日時・由来を保存し、過去のState・記憶・成功した生成記録は作らない。
実験再実行は保存済みの設定・キャラ・Loreスナップショットを使用し、現在の編集内容を参照し直さない。

## API

| 操作 | エンドポイント |
|---|---|
| ファイル／テキストのプレビュー | `POST /api/imports/preview`（multipart） / `POST /api/imports/text/preview` |
| プレビューの確定 | `POST /api/imports/{preview_id}/commit` |
| 一覧／作成 | `GET /api/library` / `POST /api/library` |
| 指定版の取得／編集 | `GET /api/library/{id}?revision=N` / `PUT /api/library/{id}`（expected_revision必須） |
| 画像の保存／取得 | `POST /api/library/assets` / `GET /api/library/assets/{sha256}` |
| 出力確認／取得 | `GET /api/library/{id}/export?format=charx&revision=N`（取得時のみdownload=true） |

既存Character／Session／Chat APIは維持。Sessionの `library_binding`、CompiledPromptの `ordered_messages` を追加した。
`system_prompt` と従来のSSE `token`／`done.full` も維持する。Pydantic・Zod・Web型は共通のライブラリ契約を使用する。

## 参照仕様

2026-09-06に一次資料を確認。固定コミットと自作SFW fixtureで差分を検証した。実アプリでの確認状況は受け入れ記録に分けて掲載する。

- [CCv3仕様（f3a86af）](https://github.com/kwaroran/character-card-spec-v3/blob/f3a86af019fbd99f788f7a1155f399655b34ab35/SPEC_V3.md)
- [CCv2仕様（8083fb3）](https://github.com/malfoyslastname/character-card-spec-v2/blob/8083fb388615ccbce768e97cbbd49d2b3214632c/spec_v2.md)
- [BYAF v1（7ebf2fd）](https://github.com/backyardai/byaf/tree/7ebf2fdbb06a36b4f900a8de45480c4a2965df03/specs/v1)
- [SillyTavern（8172dcd）](https://github.com/SillyTavern/SillyTavern/tree/8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8)、[Context Template](https://docs.sillytavern.app/usage/prompts/context-template/)
- [RisuAI（c454df8）](https://github.com/kwaroran/RisuAI/tree/c454df882aaf32e02a22da26d3718c8cadc97814)
- [Character.AI Lorebook形式（2026-08-13更新）](https://support.character.ai/hc/en-us/articles/54347105439515-Importing-Lorebooks)
