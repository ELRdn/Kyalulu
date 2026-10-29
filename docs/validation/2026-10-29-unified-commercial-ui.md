# 統合App 広告・残高不足UXの独立受入れ検証（2026-10-29）

以下の492項目は`bf83d03`時点の記録。`232c2ee`のCIで実行先切替の不具合と
未登録PCを動作中と扱うfixtureの前提を再現し、2026-10-30に修正した。
最新の24/24ケース・472項目と範囲の違いは
[Runtime routing](2026-10-29-unified-runtime-routing.md#same-document-target-changes--2026-10-30) を参照する。

最終結果: **24/24ケース PASS、492項目、終了コード0**。実Chromiumで実Appを操作し、ホーム・探索・会話の広告と、402からの補充導線を検証した。今回の範囲で製品バグは再現していない。これはローカル架空APIによるUI受入れであり、商用サービスや配布物のリリース判定ではない。

## 変更範囲

- 新規 `tests/e2e_commercial_ui.py`
- 新規 `docs/validation/2026-10-29-unified-commercial-ui.md`（本書）

製品コード、既存 `tests/e2e_unified_entry.py` / `tests/browser_fixture_server.py`、親担当の `appStore.ts`、`deviceApi.ts`、offline-cache関連ファイルは編集していない。Git操作・依存追加・ビルド・デプロイは実施していない。

## 実行方法と環境

リポジトリルートで、既存 `.venv`、`apps/web/node_modules`、インストール済みChromiumを再利用した。再実行例:

```powershell
.venv/Scripts/python.exe -B tests/e2e_commercial_ui.py --output .artifacts/commercial-ui
```

- Python 3.13.5、Playwright 1.62.0、httpx 0.28.1、Node v26.5.1。
- Chromium 151.0.7922.34、headless、画面高852px。
- 分離されたsandbox内にはbrowserがなかったため、ホストの既存Chromiumを使用した。新規インストールは行っていない。
- `--output` 省略時もOS一時領域へ証跡を保存する。リポジトリへ検証成果物を生成しない。
- 既存 `local_vite` で所有するloopbackサーバーだけを起動・終了する。`VITE_UNIFIED_APP=1` と空の `VITE_RELAY_ORIGIN` は子プロセス用の一時環境設定。
- ケース失敗はJSONとスクリーンショットに残し、全体を非ゼロ終了にする。

## 検証マトリクス

各行について、無料Cloud・未ログインCloud・加入者Cloud・端末限定・自分のPC・PCローカルの6ケースを実行した。

| 言語 | 幅 | テーマ | 結果 |
| --- | ---: | --- | --- |
| 日本語 | 393px | 明 | 6/6 PASS |
| 日本語 | 1280px | 暗 | 6/6 PASS |
| English | 393px | 明 | 6/6 PASS |
| English | 1280px | 暗 | 6/6 PASS |

ホーム `/#/`、探索 `/#/discover`、会話 `/#/chats/commercial-fixture` を実Appで開く。端末限定では `/device/` を使用する。未ログインCloudは公開ホーム・探索を対象とし、ログイン必須の会話へは進まない。PCローカルはChromiumのUser-AgentにElectron識別子を加え、実Appのdesktop分岐を通す方式で、Electron本体の起動試験ではない。

## 受入れ内容

- 無料Cloudのホーム・探索・会話で広告枠が実測50px。日本語の「広告」／英語の「Advertisement」を確認。広告URLなしのラベル枠と、架空広告iframeの両方を扱う。
- 加入者・端末限定・自分のPC・PCローカルでは、上記3画面の広告枠が0件。各画面で横方向のはみ出しも検査する。
- 広告iframeは `sandbox="allow-scripts"`、`referrerpolicy="no-referrer"`、言語に対応するtitleを持つ。
- 残高不足はイベントの直接注入ではなく、実際に入力して送信ボタンを押し、架空 `/api/cloud/quotes` がHTTP 402 `insufficient_credits` を返す経路で作る。
- 明示的な送信1回につき設定PUTと見積POSTが各1回。本文を含む見積を確認し、失敗後は元の下書きを復元し、pending generationを解除する。生成APIへの送信は0件。
- 補充ダイアログの購入・報酬動画・端末・PC・閉じるの各ボタン、画面内への収まりを確認。閉じる／Escape／再読み込みで下書きと送信数を検査し、閉じる後のフォーカスは元の送信ボタンへ戻る。
- **15秒の報酬を150 Creditsに固定し、`15s · 150 Credits · 確認中/Checking` の完全一致assertを実装**。作成時の `duration_seconds` と復元時の `seconds` の両形式で確認する。
- 動画は別途Play操作が必要。再生・閉じる・再読み込み後にpending offerを復元しても、自動再生・自動購入・会話の自動送信は発生しない。pending報酬によるダイアログ再表示は復元として扱う。
- 補充ダイアログから端末・PCへ切り替え、実Appの実行先pickerからCloudへ戻る。元の下書きは元scopeに保持され、別scopeの入力欄は空、Cloudへ戻ると元の入力が復元される。往復中の追加書込みは0件。

## 同一ページでのowner切替・遅延応答

製品モジュールのidentityを直接書き換えず、架空 `/api/mobile/status` のownerを変えて実際の `online` イベントによるRuntimeGate再確認を通した。同一ページの実App、`AccessContext.Provider key={connectionScope()}`、`cloudJson` のepoch fenceを含む境界を検査する。

1. 無料owner Aでpending報酬を再生し、加入者owner Bへ切り替える。Bの商用status応答を保留している間も、Aのバナー・補充ダイアログ・再生iframeが消え、Bの入力欄は空になる。
2. Bのstatus応答後にもバナーは非表示。Aの下書きは元scopeのlocalStorageに残る。
3. Aへ戻した際の無料status・pending報酬GETを保留し、Bへ再切替後に旧Aの応答を解放する。Aのバナーや報酬ダイアログは復活せず、BのownerヘッダーでAのofferを問い合わせることもない。切替での追加送信・購入・報酬作成は0件。

上記8項目は日英・両画面条件の4ケースすべてでPASS。通常のApp境界ではstale-state候補を再現できなかったため、製品修正は提案していない。単体componentを境界外で再利用した場合まで安全と断定するものではない。

## 通信隔離と最終証跡

すべての `/api` リクエストをPlaywright内で架空応答に置換する。未定義APIは501で拒否・失敗記録し、Viteの実backend proxyへは転送しない。loopback以外のHTTPは拒否し、広告の予約済み `.invalid` URLだけはネットワークへ出さずに固定HTMLを返す。WebSocketは接続前に閉じ、初期状態が空のbrowser contextでService Worker登録も遮断する。モデル／WASMダウンロードは拒否する。

| 最終実行の記録 | 件数 |
| --- | ---: |
| ケース / 明示チェック | 24 / 492 |
| 架空APIリクエスト | 3103 |
| 設定PUT / 意図した402見積POST / 報酬作成POST | 20 / 20 / 4 |
| 生成・購入・OAuth APIへのリクエスト | 0 |
| 未定義API・モデル取得 | 0 |
| 外部サービスへのリクエスト試行 / uncaught pageerror | 0 / 0 |
| メモリ内で応答した架空広告document | 40 |
| スクリーンショット | 56 |

最終証跡は専用のローカル一時ディレクトリの `results.json`、`vite.log`、画面PNG。代表の `ja-393-light-free-discover.png`、`en-1280-dark-subscriber-discover.png`、日英の `*-free-credits.png` / `*-free-reward.png` などを目視でも確認した。過去の試作出力ではなく、24ケース成功した最終実行を採用する。チェック数は `check()` で記録した項目数で、Playwrightの追加assertを含む総assert数ではない。

実行後のSHA-256:

| ファイル | SHA-256 |
| --- | --- |
| `tests/e2e_commercial_ui.py` | `c2daac9b125bf002fb21c5be852e47febf378a4e6c167053566b7504c2fd6b0d` |
| `apps/web/src/components/CreditOptions.tsx` | `b61033462b6d9ee3a930965bf31f2f72f4e1bf25fd20545fbb054c30281e69bc` |
| `apps/web/src/components/RuntimeGate.tsx` | `e2fc8de0bfca6179de3504c1197c9d07f356619e005b0162b213d4876c5069ea` |
| `apps/web/src/lib/cloudMode.ts` | `6cb31044c2e02ee04e2c48b4badc781ba0c9def0a3c9922fb699353a8612f824` |

## 残件・意図的な未実施

実決済・実広告・OAuth・広告完了webhook・実残高付与には接続していない。Native配布物、物理端末、実モデル推論、production CSP/PWA配信、商用backendの承認条件、別の画面寸法は未検証。親が行う最終source/build/CIの代替にはしない。指定範囲のUI受入れに未完了項目はなく、親への製品バグ引継ぎもない。
