# 選択中のRuntimeからの書き出し

2026-10-25 JST。本番データ・実Relay・外部APIは使用していない。

## 修正

- Researchの単体実験と比較実験の結果JSONを、既存`RuntimeDownload`へ統一する。
  `/api/.../export`へ直接遷移するリンクを廃止し、選択中のRuntimeと同じ`apiFetch`を使用する。
  既存Library/Creatorの呼出しも同じ部品を使用する。
- 共通部品はRemote登録の有無だけで判断せず、すべてのRuntime APIの書き出しを取得する。
  Cloud・端末内・PC・ローカルへの振分けと権限確認は既存transportが担当する。
  書き出し失敗時にCloudへ自動で送り直したり、未選択のPCへ転送したりしない。
- response本文の読込み後にもconnection scope、Cloud認証epoch、実行先を照合する。
  途中で切り替わった結果をダウンロードしない。HTTPエラーもファイルに変換しない。
- 同じイベント内の連打をrefで抑止する。失敗後の明示再試行は可能。
  `Content-Disposition`のUTF-8/quoted filenameと明示download名を扱い、パス/制御文字を除く。
  Blob URLは解放する。API操作はbutton roleとEnter/Spaceに対応し、取得中/失敗は日英表示。

## 検証と境界

- フロント全体 **471 passed / 42 files**、workspace型検査成功。
- 新規`RuntimeMedia.test.tsx`は **12件**。模擬responseとDOMで4種類のscope、本文取得中の
  owner/epoch/target切替、403、連打/再試行、Enter/Space、日本語名、不正UTF-8 header、
  明示ファイル名、Blob URL解放を検査する。既存transport試験も全体実行に含む。
- 統合App・Desktopビルド成功。既存の非module script・WASM externalization・chunk-size警告あり。
- 新規試験の`apiFetch`/scope/DOMはmockであり、実ブラウザの保存ダイアログ、実Relayの権限、
  Android/iPhoneのファイル保存の証拠ではない。直前のoutbox実Chromium5ケースとも区別する。
- Browser Researchの実験runnerと、Browser Libraryの全export形式/版/preview契約の互換性は
  依然未完。今回の部品変更でそれらを実装済みとは扱わない。

```powershell
pnpm --filter web test -- --pool threads --maxWorkers 1
pnpm typecheck
pnpm --filter web build:app
pnpm --filter desktop build
```
