# モデル開示・見積同意・公式推論要約の日英表示

対象は `ModelSelector`、`CloudQuoteConfirmation`、`CloudRouteControls`、
`ReasoningSummary`。既存の表示言語hookと部品を使い、モデル・経路選択、見積の期限、
同意の判定、推論要約の採用条件は変更しない。

- モデル一覧の読込/未取得/空/未提供、保存・学習利用、参考料金、Flex、推論対応を翻訳。
  保存/学習利用の警告は閉じた技術情報の外に残す。選択中のモデルを自動で変更しない。
- Baiduの送信ごとの同意と撤回、料金上限、完了後の実費精算、失敗0消費、期限を翻訳。
  未同意または期限切れでは送信不可。提供元の `privacy_note` は原文のまま表示する。
- 経路の案内とContributorの1回単位の学習利用条件を翻訳。未提供の経路は開かない。
- 公式推論要約の対応なし/提供なしと本文の区別を維持。要約本文は翻訳や捏造をせず、
  提供された公式要約のみを表示する。通常の会話要約とは別である。

## 検証

- フロント全体 **644 passed / 47 files**。threads/1 workerとforks/2 workersで成功。
  後者の初回はsandbox TEMPの変換cache共有に失敗したため、workspace内TEMPを指定して
  再実行した。アプリ/依存関係を変更して回避したものではない。
- `cloudModelUI.test.tsx` **30 passed**。従来の日本語に加え、英語の保存/学習警告、
  未同意/同意済み/期限切れ、操作の自動実行なし、公式要約なしの表示を確認。
- `accountProfile.test.ts` は英語fixtureを固定し、競合を翻訳文ではなく構造化された
  `profile_conflict` codeで照合する。`e98ccb6`のWindows/Linux CI失敗の原因は、
  OS既定言語へ依存して日本語の文言を期待していたこと。対象集合102件が修正後に成功。
- 既存の `e2e_memory_language.py` を拡張して **3条件成功**：393px/lightの日本語と英語、
  1280px/darkの英語。実QuoteConsentで未同意→同意→撤回→取消を操作し、横overflowなし。
  `.artifacts/memory-language-browser/quote-*.png` と `results.json` に保存。
- Web型検査・統合App/Desktopビルド成功。WASM外部化/chunk-size等は既存の警告。

このブラウザ試験はloopback・架空モデル・端末IndexedDBのみを使い、外部/API要求は0。
実生成・課金・提供元への同意登録を行う試験ではない。OS IME・実機・全画面の英語化と
本番受け入れは残る。保存形式の変更はない。

後続CI `503627d` のLinuxでは、型検査・フロント・全Python・公開/記憶UIの後、
`e2e_remote.py` が日本語の「会話モデル」を探して失敗した。試験のbrowser localeを
`ja-JP`へ固定し、実Relay経由の9項目を再実行して成功。英語表示を製品側で戻して
回避したものではない。最新の全CI成功は別に確認する。
