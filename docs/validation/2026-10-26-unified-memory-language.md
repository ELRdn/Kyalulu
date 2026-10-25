# 記憶・出典・要約の日英表示

対象は共通UIの `MemoryPanel`、`MemorySource`、`MemoryInspector`、
`ConversationContext`。既存の言語設定と部品を使い、保存・生成・同期のAPIは変更しない。

- 記憶の種類、範囲、有効/無効、追加/訂正/削除、共有範囲のプレビューと確認文を日英で表示。
  元の記憶の保持、他の会話への影響、消去を戻せないこと、本文の削除とは別であることを保つ。
- AIの物語上の出来事は本人の実際の過去や好みを証明しない、と両言語で表示する。
  語句一致や返答への反映は推定で、事実性・因果・出典の正しさの証明ではない。
- 要約の出典・版・抜粋による省略・訂正後の用途を翻訳し、Nativeの `user_edited` と
  Deviceの `manual` の双方を「手動訂正」と表示。保存時のrevision照合を維持する。
- 600px以下では種別と操作を上段、本文を下段へ配置し、長い英語ラベルで本文が狭くなるのを防ぐ。
- 本文・引用・利用者の入力は翻訳しない。共通/API由来の日本語エラーと他画面の英語化は残る。

## 検証

- `MemoryLanguage.test.tsx` 6件成功。日英の共有・消去の確認文、キャンセル後のAPI未呼出し、
  出典/事実性の区別、要約の表示revisionを送ることを確認。
- フロント全体 **596 passed / 47 files**。
- 統合AppとDesktopのビルド成功（既存のWASM外部化・chunk-size等の警告あり）。
- `tests/e2e_memory_language.py` **3条件成功**：393px/lightの日本語と英語、1280px/darkの英語。
  実際の共通部品・Device adapter・IndexedDBで消去キャンセル後の記憶保持、記憶の追加、
  要約訂正とrevision更新を確認。外部/APIネットワーク要求とpageerrorは0、横overflowなし。
  `.artifacts/memory-language-browser/results.json` と各画面PNGに証拠を保存。
- 日本語文字列はPlaywrightの入力で保存した。OSのIME変換/確定操作、実モデル、Android/iPhone、
  本番ドメインでの検証ではない。共有の実処理は既存のPython試験、今回の追加試験は確認文と取消を対象にする。
- 新しいブラウザ試験をWindows/Linux CIへ追加する。今回のCIはpush後に別途確認する。

保存スキーマ変更や追加依存はない。表示のrollbackにデータ変換は不要。
全体計画の残件と本番反映は `docs/UNIFIED_DELIVERY.md` で継続して追う。
