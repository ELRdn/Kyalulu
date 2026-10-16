# Cloudモデル選択・公式要約・保存／学習同意

調査開始2026-10-11、最終確認2026-10-12 JST。ローカル実装・配布候補。本番未反映。
公式GETの根拠は[公開調査](2026-10-11-cloud-model-research.md)。カタログ掲載を実応答の証拠にしない。

## 6経路

OpenRouterのmodel ID／provider tagを固定し、fallbackを禁止。全候補low、総出力上限4096（内部推論を含む）。
旧Cloud Standardは思考無効、ローカル・BYOKも維持。単価はUSD／100万tokens、10月11日観測値。

| 選択肢 | model ID | provider tag | 入力／出力 | 保存・学習条件 |
|---|---|---|---|---|
| DeepSeek／Baidu | `deepseek/deepseek-v4.1-flash` | `baidu/fp8` | .0348／.1392 | 保存・学習可能。送信ごとの別の同意必須 |
| DeepSeek／Decart | 同上 | `decart/fp4` | .09／.18 | data_collection=deny |
| DeepSeek／InferenceNet | 同上 | `inference-net/fp8` | .077／.40 | data_collection=deny |
| GLM／InferenceNet | `z-ai/glm-5.3-flash` | `inference-net/fp4` | .07／.05 | data_collection=deny |
| GPT Luna Flex | `openai/gpt-6-luna` | `openai/flex` | .05／.25 | 保持あり。通常最大30日の監視ログ／例外を開示 |
| Haiku／Google Vertex | `anthropic/claude-haiku-5.5` | `google-vertex/global` | .10／.50 | data_collection=deny、provider.zdr=true |

Flexは別model IDやbatchではなくprovider tag。画像と公式endpoint APIが一致し、選択可にした。
Haikuの応答provider名は`Google`。GPT／Haikuへtemperatureを送らない。
Decartの初回status=-2／再取得0は調査に保持。選択可は実稼働保証ではない。

## 同意・保存・公式要約

ユーザーの「Baiduは学習ありで選べるようにし、保存を前提にしてよい」を適用。
途中のoperator retention flag案とBaidu無効化を撤回。全6経路を選択可能にする。
Kyaluluのアカウント別履歴・作品・記憶保存と、提供元の保持／学習を別に説明する。
Baiduの一般条件は保存・AI改善・地域外移転を許す。catalogはtraining=falseだが特約／保存期間未確認のため、学習不使用を保証しない。
Flexのallowは保持経路を許す指定であり、APIパラメーターだけで学習不使用を保証しない。
OpenAIのopt-inなし学習不使用は公開契約に基づく。現在のOpenRouterアカウントopt-inは未読。他経路の学習許可は追加しない。

ログイン説明版は`2026-10-03-provider-routing-v2-openrouter-model-choices-v4-retention-training`。
既存利用者の閲覧・exportは維持し、新規外部送信には更新説明への同意を要求。
Baidu checkboxは毎回未チェック。未同意はWebで送信不可、サーバーでも外部通信前に403。
quote IDに結び、取消・次の見積・期限切れ・所有者変更で引き継がない。callerのtrueで回避できない。
同意値のみquote hashから除外し、経路・価格・保存／学習条件は照合対象。送信前にroute ID／quote ID／version／時刻を既存result_jsonへ保存。
取消・再起動でも記録を保持するが、会話データの完全消去後も残る独立した永久監査台帳ではない。

GPTはreasoning.summary=auto。Haikuは公式summarized既定に沿ってlowを要求。
reasoning_details内のtype=reasoning.summaryかつ文字列summaryだけを採用し、本文とともにSFW検査後に保存・公開。
raw reasoning／reasoning_content／reasoning.text／暗号化／未知型を表示・保存・再送しない。
未提供と非対応を区別し、追加推論で要約を作らない。折り畳み・履歴再読込・VN表示に対応。

安全検査は従来のDeepSeek／InferenceNet・思考無効に固定。見積は最大3試行・内部推論・入力／出力検査を含み、報告実費で精算。
cache write上限を考慮し、予約入力原価はHaiku .20/M、Flex .0625/M。通常表示単価と区別する。
独立レビュー3所見（取消時の同意消失、不明原価復旧後の追送、精算前crashの超過原価消失）を修正。
成功・失敗・取消の判明済み費用／review_requiredを復旧へ渡す。会計不明のcrashは予約全額を保持し、新規送信を停止。
取消後の遅いfinishは会話を保存せず、発生費用だけを反映する。

## 検証と配布候補

- Python関連259件成功。全6経路の見積・精算・durable replay、未同意0通信、StrictBool、要約SFW、取消3経路、精算前crashを含む。
- Web226件、全workspace型検査、最終build成功。最終画面修正は最新buildのブラウザーで再確認。
- Mock Chromium390／1440px × light／dark、16画面条件に横overflowなし。長い見積をスクロールし、同意ボタンが覆われず操作できることも座標で確認。
- Baidu取消0生成／同意reset、要約折り畳み・開閉・再読込を確認。未mock／外部要求0、ページエラー0、有料推論0。一時server／Chromium終了。
- Ruff F通過、diff --check通過。全Ruffルールは178件のimport順等の所見を報告し、一括整形は未実施。既存build警告は残る。
- 独立再レビューで3件の解消・追加所見なし。実Provider受け入れとは別の静的レビュー。

証拠：`.artifacts/cloud-models-20261011/`の各`*-final.log`、`ui/acceptance.json`、`ui/REPORT.md`、`package-acceptance.json`。
最新候補：同ディレクトリの`cloud-release/kyalulu-cloud.tar.gz`。
SHA256：`366a095eab03862ea38c3162553471c2c25cfe5eb7bcf6484e995df1831fc0ab`。
ソース指紋：`17ebaf1d566201495811bf6fe37b9d771628a4a20bdd19266e9dd67a65b2e0bd`。
manifest180件・Runtime100件・Web57件・対応source371件を作業ソース／distと照合。秘密・DB・重量モデルなし。
Web index SHA256：`7a8d0ee6e98c4cc84ec52cc2a7dd7d63abb0328f62c6b541a14178cba6d0dfb4`。

累計API実費上限$0.10を維持。今回有料推論・購入・本番更新・Git変更0。過去の未知費用を解除しない。
現在の本番台帳・残額は今回未取得。実routing／summary返却／会話品質／待ち時間／実請求、実OAuth・物理Androidは未確認。
本番反映は本人承認、現台帳照合、暗号化backup、rollback先と実稼働確認が必要。
前のonboarding／parity候補とWindows/npm候補は今回のモデル変更前であり、最新候補として配布しない。
