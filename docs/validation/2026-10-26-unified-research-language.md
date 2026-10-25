# 研究画面の日英表示と採点下書き

## 変更範囲

- 共通 `Research.tsx` の実行・比較・再実行・書き出し・採点・検査・ランキングを表示言語へ追従させた。
- 実験ID、モデルID、シナリオID、会話本文、プロンプト、JSON、計測値、判定コードは原文を保持する。
- API引数、NSFWの明示指定、ランキングのscope、Runtime通信と管理権限は維持する。
  Deviceで未実装の研究機能やCloudの制限を、この変更で利用可能とは扱わない。
- エラーは元の値を保持して表示時に `friendlyMessage` へ渡す。
  言語変更はAPI再取得や実験再実行を起こさず、採点の入力中コメントと評価者を保持する。
- 星評価、モデル/シナリオ選択、再読込、比較表示操作へ日英のアクセシブル名を付けた。
  トークン推定は実測usageと区別する。
- 別の実験に比較列を切り替える際は採点入力を再初期化する。
  前の実験の未保存コメントを別実験へ送る問題を修正した。
  以前の採点保存の応答が遅れても、新しく選んだ実験の採点表示に混ぜない。
  管理権限を持たない画面の案内も日英へ対応し、権限判定は維持する。

## 検証

- `pnpm --filter web exec vitest run src/pages/Research.test.tsx`: 9 passed。
  日英の表示、実行・scope引数、再実行ID、書き出し先、元の本文、エラーstatus、
  入力下書き、検査タブと推定値の説明を確認。
- `pnpm --filter web test`: 659 passed / 49 files。
  最初の全体試行はsandbox TEMPの変換ファイルが見えず36 suitesで失敗。
  workspace内の既存 `.artifacts/device-import-tmp` をTEMP/TMPに指定し再実行して全成功。
- Web型検査成功。
- `.venv/Scripts/python.exe tests/e2e_research_language.py`: 実Chromiumの3条件成功。
  初期日本語393px/light、初期英語393px/dark、初期英語1280px/light。
  各条件で反対の言語へ切り替え、コメント・評価を保持し、API取得/書込みが増えないことを確認。
  明示保存のHTTP body、原文プロンプト、トークン推定の説明、横方向のはみ出しなしを確認。
  比較対象を変えると採点下書きが消え、元の実験への保存1件以外が送られないことも確認。
- ブラウザは架空のRuntime HTTP応答を使用。実際の共通API clientと画面を通るが、
  私的DB・外部モデル・Cloud・課金には接続しない。想定外のAPI/外部要求とpageerrorは0。
  証拠: `.artifacts/research-language-browser/results.json` と3枚のPNG。
  PNGの表示言語は切替後、ファイル名は初期言語を表す。
- 同じブラウザ試験をWindows/Linux CIへ追加した。

## 残る受け入れ

新しい配布build、Remote実験実行、実モデル品質、OS日本語IME、Android/iPhone実機は今回の証拠に含めない。
BenchmarkLabを含む他のJA中心の画面、Device研究の実装、全体計画と本番反映は継続課題。
