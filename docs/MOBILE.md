# Kyalulu Mobile

専用サイト: https://mobile.kyalulu.com 。スマホのブラウザ内でモデルを実行するPWAです。
既存のDesktop、Remote、Cloudのサーバー接続経路は変更しません。

## モデルと保存

- Google Gemma 4 E2B Mobile QAT: 同じMobile QAT系の公開ONNX q2f16派生版。指定CTファイルを直接実行するものではありません。
- Google公式Gemma 4 E2B QAT: Q4_0 GGUF。
- Heretic Gemma 4 E2B: IQ3_M GGUF。
- Kyalulu E2B JP Rolepaly beta: IQ3_M GGUF（初期選択、ダウンロードは手動）。

`apps/web/src/mobile/catalog.generated.json`が配布ファイルのrevision・サイズ・SHA-256と生成設定の正本です。
新しい独自モデルも同じ登録形式で追加します。配布にはHTTPSの固定revision URLを使います。
GGUFは公開Hugging Faceリポジトリ`Naotaka0127/Kyalulu-Mobile-GGUF`へ分割配布します。
各テンソルの名前・形状・量子化型・バイト列SHA-256を分割前後で照合し、provenance.jsonを公開します。
分割はRAM削減ではありません。512MiBは分割の目安で、単一テンソルは分割されないため、配布前に各ファイルが2GiB未満であることを検査します。

モデルはOPFSの専用ディレクトリ、キャラ・会話・保存完了情報は専用IndexedDBへ保存します。
ダウンロード時はストリームでハッシュを計算し、ファイル全体をArrayBufferにしません。
完成したファイルを検証して再利用し、中断したファイルは再取得します。永続保存の許可はブラウザが決めます。
会話はバックアップを書き出せます。ブラウザデータ削除・OSによる退避で失われる場合があるため、定期的な書き出しを推奨します。

## PLEとメモリ

PLEを削除・再量子化せず、保存ファイルから必要なトークン行だけを読み、元の量子化形式から展開して入力へ渡します。
これはブラウザのファイル読み込みであり、ネイティブOSのmmapではありません。
通常版のJSPI/Memory64とSafari用Asyncify/Memory32を同じ固定ソースからビルドします。
拡張範囲はGemma4のPLE読み込みと診断です。他の重み・モデル計算・生成設定を置き換えません。

ダウンロード容量、重み用バッファ、WASMヒープ、GPU、KVキャッシュ、物理常駐量を区別します。
取れない測定値はnullです。WASMヒープや重み用バッファは物理常駐量と同じではありません。
1GB未満は重み常駐量の目標で、全候補・全端末の保証ではありません。ONNXは別の実行経路として測定します。
GGUFの履歴予算は公開APIにトークナイザーがないため保守的なUTF-8上限を使います。履歴原本は削除せず、省略件数を表示します。
ONNXではモデルのトークナイザーを使います。コンテキスト2,048、最大出力256、同時生成1、Thinking OFFが初期設定です。

## 開発と再現

```powershell
pnpm --filter web dev:mobile
pnpm --filter web test:mobile
pnpm --filter web typecheck
pnpm --filter web build:mobile
```

WASMビルド入力はwllama 3.8.1、llama.cpp `46ca246de9bb1c35269722a6240d37d9dfd79cad`、Emscripten 4.0.20、Dawn `v20260317.182325`です。
`scripts/mobile_wasm/bootstrap.py`で作業領域へ取得し、WSLでEmscriptenをinstall/activateしてから、
`scripts/mobile_wasm/prepare.py`と`build.sh`を実行します。`ple.patch`が固定ソースとの差分です。
モデル準備は`python scripts/mobile_models.py --publish`。依存ツールはプロジェクト内`.artifacts/mobile-python`へ隔離します。
元モデルは変更せず、生成した作業ファイルだけを公開先のハッシュ照合後に削除します。

Web成果物は`.artifacts/mobile-pages`です。モデル本体を含めません。
Pagesの25MiB制限を超えるORT WASMは明示的な`.gz`資産で配布します。Service Workerが圧縮済みバイト列のSRIを検証し、DecompressionStreamで展開して元のWASM URLへ保存します。
HTTPのContent-Encodingによる事前圧縮には依存しません。配布前には展開後のハッシュも照合します。
Service Workerは明示したアプリ・推論資産だけを保存し、会話とモデル本体の保存領域を更新時に消しません。

## 受け入れ

`scripts/verify_mobile.py`は専用ブラウザコンテキストで、キャラ保存、会話・下書き再開、バックアップ、破損モデル拒否、オフライン再起動、不要な通信を検査します。
`--real-model MODEL_ID`は専用プロファイルに実モデルを取得して生成を確認します。所有者の普段のブラウザデータは使いません。
PC上のChrome、スマホ幅の画面、模擬試験は、物理Android/iPhoneの証拠として扱いません。

Pixel 9/ChromeとiOS 26以降のiPhone/Safariで、各候補の初回起動、20ターン会話、停止、再起動、オフライン、ロック復帰を別途実測します。
実機で確認できない組合せを対応完了・省RAM認定と表示しません。最新の検証記録を参照してください。

最新記録: [2026-10-23の実装・検証記録](validation/2026-10-23-mobile.md)。
実際の通常版・互換版・CPUの直接実行は、mobile開発サーバーと専用テストモデルを用意してから
`.venv/Scripts/python scripts/mobile_wasm/verify_runtime.py`で検査します。これはChrome上の検査であり、iPhone実機結果ではありません。
