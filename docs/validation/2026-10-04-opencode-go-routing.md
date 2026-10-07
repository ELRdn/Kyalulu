# OpenCode Go：初期クラウドの接続候補

> 方針変更前の調査・実装履歴。初回提供ではGoを使わない。
> 初期OpenRouterの設定と条件は [最新記録](2026-10-04-openrouter-initial.md) を参照。

2026-10-04。ひろなおの既存Go月$10契約を使う提案を受け、接続とルーティングを
実装した。**共有クラウド向けの利用許可・原価配分・実API受け入れは未完了。**
公開/契約変更/決済/推論/画像送信/キー取得は実行していない。

## 確認した提供条件

- [公式Go資料](https://opencode.ai/docs/go/)：月$10、coding agent向けのトラフィック。
  固有User-Agentと安定した`x-opencode-session`を送る。
- [利用規約](https://opencode.ai/legal/terms-of-service)のWhat are the basics：
  “You will only use the Services for your own internal use, and not on behalf of
  or for the benefit of any third party”。個人の契約を他利用者向けのCharacter AI
  バックエンドに使えるという根拠はなく、書面の許可確認まで共有利用を停止する。
- Muse Contributor：入力/出力を将来のMetaモデルの学習に使う条件と地域制限。
  普通のクラウド同意に含めず、明示した生成単位の同意と地域確認が必要。
- 5時間/週/月の利用枠があり、ConsoleのUse balanceを有効にするとZen残高へ
  切り替わる。Kyaluluは切り替えや利用枠回避を行わない。既存の個人利用と同じ
  契約枠を消費するので、月$10を無制限や無料API原価とは扱わない。
- 公開サイトは取得時403。公式公開リポジトリの同内容をcommit
  `907b3bc518fa48e90e8ec24dd327d13eee71c36c`に固定して読んだ。
  [Go原稿](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/web/src/content/docs/go.mdx)
  / [規約原稿](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/console/app/src/routes/legal/terms-of-service/index.tsx)。
  保存証拠は`.artifacts/research/opencode-go/`。

## 準備した設定

| 用途 | Model ID | API | 入力/出力/キャッシュ読取（$ / 1M tokens） |
|---|---|---|---|
| 通常会話 | `mimo-v2.6-flash` | Chat Completions | 0.14 / 0.28 / 0.0028 |
| 構造化・大きな文脈・SFW検査 | `deepseek-v4.1-flash` | Chat Completions | ピーク0.30 / 1.20 / 0.006 |
| 学習同意付きの創作 | `muse-spark-1.3-contributor` | Responses | 0.10 / 0.20 / 0.002 |

これらはGo利用枠の参照単価で、現金の実API原価ではない。DSのオフピーク単価は
半額。最大予約はピークで計算するが、実請求・時間帯と固定契約費の配分は未確定。
公開前に既存のAPI原価×6条件との整合を確定する必要がある。

3モデルとも[Models.devのGoカタログ](https://models.dev/api.json)に画像入力がある。
これは実リクエスト成功・SFW精度の保証ではない。実装は検証済みの静止画だけで、
音声/動画/PDFの受け入れは追加していない。

- `KYALULU_OPERATOR_BACKEND=opencode-go`が環境設定の初期候補。直接DeepSeekと
  ローカル/BYOKは維持。Pythonで明示構築する旧設定の既定値は互換のためDeepSeek。
- 自動選択は会話開始前の用途/文脈による決定。検査は常にDeepSeek。文脈16KB以上
  または`route_profile=structured`でDeepSeekを選ぶ。品質実測前の暫定閾値。
- `route_profile=contributor`は`contributor_training_consent=true`と地域承認が必要。
  Museへ入力・キャラ設定・記憶等も送られ得る。通常のautoには絶対に含めない。
  Museの一般ユーザー向け選択UIは未提供で、この候補はAPI設定のみ。
  後続のローンチ準備で、Go用の選択UIと生成ごとの学習同意解除を追加した。
  接続/地域の実受け入れまでMuseは無効。[後続記録](2026-10-04-launch-readiness.md)を参照。
- セッションヘッダーには利用者+会話IDのハッシュを使い、補助検査も安定したID。
  User-AgentはKyaluluを明記。エラー本文・キー・プロンプトを例外へ出さない。
- JSON/State検証、拒否/空/不完全な出力の拒否、予約・精算を維持。
  MiMoの小数キャッシュ料金は整数ナノドルへ合計後切り上げ。異なるモデルの使用量は
  呼び出し別の参照料金で集計し、最後にクレジット整数へ丸める。
- 送信前見積もりは実モデルと料金版を含む。設定変更で見積もりを使い回さない。
  Go権限/原価配分/推論受け入れが未確認なら、生成・保存検査・新規販売は停止。
  読み取り・エクスポート・解約用Portalは保持する。
- 提供元変更の同意版を更新。既存アカウントは再ログインで新しい説明へ同意。
  ログイン前の同意を認証フローの提供元/版に紐づけ、途中で提供元が変われば拒否。

## 残る受け入れ

Goの共有Character AI利用許可、Meta地域条件、固定契約費の原価配分、既存個人利用を
含む残枠の照合、ピーク/オフピーク、実JSON/非思考/使用量/SFW品質、モデルごとの
会話品質と速度。秘密のAPIキーは読み出しておらず、実推論は0回。
`KYALULU_GO_ACCOUNTING_APPROVED=0`を維持する。参照単価のモック精算を
実原価精算の完成と扱わない。自動fallbackによる無料モデル/Zen残高への転送もしない。

この変更はソースとWebの候補。前日のWindows npm配布物は再構築しておらず、
このGo Adapterを同梱した配布候補とは扱わない。npm公開manifestは空のまま。

## 検証

- Go専用テスト：最終ソースで **29 passed**。3モデルのプロトコル、静止画の保持、
  学習同意/地域/共有権限の拒否、提供元変更時の再同意、認証フロー中の変更拒否、
  429/500/リダイレクト、拒否/思考/不完全/空出力、モデル別料金の整数集計、
  モック生成のSFW検査/確定/再送を確認。
- 既存クラウド29件＋画像16件とGo21件の段階で **66 passed**。
  その後、Goの拒否/厳密な同意/旧ログイン画面の拒否など8件を追加し、Go29件を再確認した。
- Webの送信前予約・拒否・利用者別キャッシュの対象 **3 passed**。
- 最終のWebと日英法務原稿で `npm run build`（型検査含む）通過。
  既知のtheme-init/Noise外部化/チャンクサイズ警告は残る。
- Ruff F検査と変更した追跡ファイルの `git diff --check` 通過。
- 全テストの外部APIはMockTransport。実推論/実決済/デプロイ/キー取得は0回。
