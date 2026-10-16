# Cloud会話開始・ゲスト閲覧・初トーク案内

取得日: 2026-10-11。今回の修正はローカル候補。本番は10月5日の配布物で、未更新。

## 安全検査の停止と修正

ユーザーのシオン執事画面に `safety_unavailable` が表示された。
本番の安全検査ソースと台帳を読み取り確認し、固定送信先は引き続き
DeepSeek V4.1 Flash / OpenRouter / InferenceNetだった。

[公開endpoint API](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash/endpoints)
で、InferenceNetの現在単価は入力$0.077、出力$0.40／100万トークン。
旧コードの入力上限$0.02は現在単価を下回る。
[OpenRouterの仕様](https://openrouter.ai/docs/guides/routing/provider-selection#max-price)
では上限を超えるendpointを除外するため、現在の固定経路が選択不能になる不整合を確認した。
値上がりの理由・セール終了日と、過去4操作の各失敗原因は未確定。

`providers/openrouter.py` の上限と `cloud/router.py` の見積原価を入力77／出力400 nanoUSD/tokenへ
同時更新し、tariff版も更新。実際の精算は従来どおりOpenRouterの報告実費を使う。
送信先・モデル・fallback禁止・データ収集拒否・SFW検査を維持する。
品質評価スクリプトの候補単価も更新した。過去の検証記録は当時の証拠として保持する。

HTTP404／429／認証・利用枠エラーを安全なコードで区別し、利用者向けの日本語説明を追加。
判定JSONのキー・型の不正は503、形式が正しい `sfw=false` は403として区別する。
見積DBにProvider料金版を追加し、既存のCredit換算版とは分離して保存・予約時に照合する。
旧DBは追加テーブルと未設定の互換既定値で読める状態を維持する。
既存 `quotes` の8列は維持し、旧Runtimeへのrollbackでも見積INSERTを壊さない。
料金版変更後の見積は新しい同意が必要。
ログには固定コードか例外型だけを記録し、Providerの生の本文・キー・ユーザー入力を記録しない。
拒否・不完全な応答・検査失敗で保存を許可しない。自動再送・別送信先へのfallbackは追加していない。

## 本番の診断と費用

秘密・会話本文を出さず、短い架空の散歩文を安全検査へ1件送信した。旧設定のままで失敗。
取得した診断情報ではHTTP番号を特定できず、確定原因の追加証拠には扱わない。
この送信の原価は未確定なので最大予約額$0.000071620を維持し、追加有料送信を停止した。

診断後の台帳は失敗5件・K-Credits消費0・pending0・fund hold0。
5件とも費用が予約上限と同額なので、合計$0.000385920を確定実費とは扱わない。
過去費用$0.049548721と合わせ、保守的計上額$0.049934641／上限$0.10。
新しい台帳や配布で予算をリセットしない。Providerの請求照合が済むまで予約額を減らさない。

証跡: `.artifacts/cloud-onboarding-20261011/{safety-probe,live-ledger-after,public-endpoints}.json`。
本番のコード・設定・サービス・データは更新していない。診断による費用台帳の1予約・精算のみ。
旧本番は未知料金時の次送信停止が未対応なので、繰り返し操作しない。
候補ソースには未知料金の停止・再起動後の保持が実装済みで、回帰試験対象。

## Provider候補の比較

以下は画像の速度情報と、当日公開APIの単価。速度はKyaluluの実測ではなく、
安全検査・queue・JSON修復・保存を含まない。計算例はキャッシュ未命中の入力5,000＋出力500。
会話全体の追加検査原価・税・購入手数料を含めず、合計費用の予測とは扱わない。

| Provider | 入力$/M | 出力$/M | 参考費用$ | 画像のLatency秒 | 画像のThroughput tps |
|---|---:|---:|---:|---:|---:|
| Baidu | 0.0348 | 0.1392 | 0.0002436 | 1.01 | 145 |
| Wafer | 0.035 | 0.99 | 0.0006700 | 0.99 | 42 |
| Relace | 0.05 | 0.60 | 0.0005500 | 1.20 | 83 |
| Morph | 0.05 | 0.60 | 0.0005500 | 1.09 | 74 |
| OpenInference | 0.055 | 0.36 | 0.0004550 | 1.97 | 24 |
| InferenceNet | 0.077 | 0.40 | 0.0005850 | 0.53 | 129 |
| Sail Research | 0.08 | 0.40 | 0.0006000 | 1.34 | 52 |
| Decart | 0.09 | 0.18 | 0.0005400 | 1.12 | 36 |
| Ionstream | 0.10 | 0.75 | 0.0008750 | 0.94 | 68 |
| DekaLLM | 0.12 | 1.20 | 0.0012000 | 1.60 | 84 |
| DeepInfra | 0.14 | 0.42 | 0.0009100 | 1.12 | 55 |
| StreamLake | 0.147 | 0.588 | 0.0010290 | 1.66 | 100 |
| DeepSeek | 0.15 | 0.60 | 0.0010500 | 0.88 | 158 |

当面の推奨は固定InferenceNetを維持して価格条件を修正すること。
Decartは上の例で約7.7%安いがFP4、InferenceNetはFP8。
入力／出力比が約16.92より小さいとDecartが安く、大きいとInferenceNetが安い。
量子化差から品質差の大きさ・有無は判定できず、JSON・SFW判定・人格・長期整合の実比較が必要。

Baiduは約58.4%安く、FP8だが、[当日ZDR一覧](https://openrouter.ai/api/v1/endpoints/zdr)に
このendpointが掲載されていない。ZDR一覧にないことだけで学習利用を断定しない。
現在の `data_collection=deny` で接続可能とは未確認で、収集拒否を緩めて採用しない。
[Provider一覧](https://openrouter.ai/api/v1/providers)にはBaiduのデータセンター情報が未記載。
保存・学習・処理地域・利用規約を確認し、送信先説明・再同意・実推論受け入れを行ってから採用する。

OpenInferenceは当日APIで直近1日のuptime約92.01%、画像では90.27%で、時間窓・取得時点が異なる。
安さを理由に会話用の優先候補にしない。Relaceは当日の `response_format` 対応掲載がなく、
現行 `require_parameters=true` を維持する場合の候補として受け入れない。
DeepInfraの低いcache read料金は、実際のhit率が得られる場合の比較対象。hitを仮定して安いと判断しない。

証跡: `.artifacts/cloud-onboarding-20261011/{provider-candidates,provider-policies,zdr-endpoints}.json`。
[データ取扱条件](https://openrouter.ai/docs/guides/privacy/provider-logging)と
[ZDRの説明](https://openrouter.ai/docs/guides/features/zdr)も参照。
Provider変更・新規アカウント・新しい送信先への送信は行っていない。

## ゲスト閲覧と初トーク案内

Cloudのホーム・発見・キャラ詳細は匿名でSFWの同梱カタログを閲覧できる。
Communityが既存条件で有効な接続先では、明示公開した固定作品・作者・コメントを閲覧できる。
Communityの提供条件と既定無効は維持し、招待テストを一般公開へ変更していない。
認証画面に「ログインせずに見てみる」を追加。初期ホームもゲストで表示する。
匿名アカウント・tenant DBは作らず、私的会話・記憶・設定・ライブラリ・原価操作は401。
ブラウザーもゲスト中には私的session一覧を取得しない。トーク・保存・交流の操作時にログインへ移動する。

選んだキャラ・作品の内部URLをOAuth前に保持し、認証後はその詳細へ戻る。
ログイン完了だけでトークを作成・送信せず、ユーザーが改めて開始する。
外部URL・危険な戻り先は拒否する。ローカル／BYOKにCloudログインを必須にしない。
ホームは実際の作品を表示し、数や会話数を捏造しない。作品数を増やすための架空追加は行っていない。

新規会話でまだユーザー発言がない場合に、4段階の案内を表示する。
入力・毎回のCloud送信先／費用同意・記憶の出典と訂正・Inspectorを説明する。
スキップ・完了状態だけを版付きlocalStorageへ保存し、上部「?」から再表示できる。
案内操作による自動入力・送信・記憶有効化・モデル呼び出しは行わない。
利用できないInspectorを無効表示し、通常の記憶パネルへ案内する。
IME中のEscapeでは閉じず、操作ボタンはsubmitせず、移動先へフォーカスする。
保存拒否の場合は次回再表示の可能性を説明する。完了記録はこのブラウザー単位で、端末間同期はしない。

## 検証・配布候補

最終Cloud・OpenRouter・Community・旧保存互換・backup関連255件、Web188件が成功。
全workspace型検査・Web build・対象Ruff F・差分空白検査が成功。
追加試験は実保存APIで設定・導入文を保存し、入力／出力SFW検査・見積・生成・費用精算まで
MockTransportで通す。新しい価格条件での本番会話成功は未確認。
独立レビュー2件は修正後に別担当が再確認し、対象範囲の追加所見なし。
Mock Chromiumでゲストホーム→シオン詳細→ログイン→選んだ詳細への復帰を確認。
初トーク案内の表示・スキップ・再表示・完了後reload、下書き保持、合成IMEのEnter非送信を確認。
390／1440px・明暗のホーム／ログイン／案内計12条件で横はみ出し・ページエラーなし。
ゲストの私的API要求0、外部・未Mock要求0、推論要求0。
証拠は [画面確認REPORT](../../.artifacts/cloud-onboarding-20261011/ui/REPORT.md) と同じフォルダーの画像。
合成IMEはAndroid実機の確認を代替せず、OAuthの戻りページとAPI応答もMock。

最新Cloud候補: `.artifacts/cloud-onboarding-20261011/cloud-release/kyalulu-cloud.tar.gz`。
SHA256 `40a2a3d2c21a5542400a8fa8c94ffcb36bf07a639600580298b63c9be590354b`。
ソース指紋 `61f2add5a58a411d68101e71c0ebb030d955b138a23af1fa36fae19f30f01031`。
179ファイルのmanifest hash、Runtime99・Web57・対応ソース368ファイルをworkspaceと照合した。
旧parityのCloud／Windows／npm候補は追加修正前の証拠として保持。今回Windows／npmの再生成はしていない。
新価格での本番会話・実請求照合・実機・本番反映は未確認。候補だけでCloud障害解消済みとは報告しない。
