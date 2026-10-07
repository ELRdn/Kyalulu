# OpenRouter：4モデルの採用候補と提供先比較

> 調査後、4候補の日本語JSON/英語SSE/合成画像と現在のAdapterを実APIで少量確認した。
> [16リクエストの実費・思考・検証範囲](2026-10-04-openrouter-live-smoke.md)を参照。
> 以下は採用前の公開カタログ調査。実API確認後も一般提供の受け入れは未完了。

2026-10-04。ひろなお指定の4モデルを次の評価候補として採用する。
**候補の調査・選定方針であり、運営モデルの有効化・実API受け入れではない。**
実推論・画像送信・課金・キー取得・公開は0回。既存RuntimeのMiMo/DeepSeek経路は
この調査で変更していない。Ling/GLM/Museを既存Adapterへ追加済みとは扱わない。

## 候補

- [Ling 3.0 Flash VL](https://openrouter.ai/inclusionai/ling-3.0-flash-vl)
- [Muse Spark 1.3 Contributor](https://openrouter.ai/meta/muse-spark-1.3-contributor)
- [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash#providers)
- [GLM 5.3 Flash](https://openrouter.ai/z-ai/glm-5.3-flash)

OpenRouterの公開APIは4モデルすべての `input_modalities` に画像を掲載。
画像認識への対応だけでSFW検査の判定精度が確認されたとは扱わない。

## 価格とJSON対応

USD/100万トークン、キャッシュ未命中の入力/総出力。価格は確認時点の公開API。
参考リクエストは入力5,000＋総出力500トークン。安全検査・再試行・購入手数料・税は含めない。
思考モデルの場合、総出力には請求対象の思考トークンも含めて比較する必要がある。

| モデル | 提供先タグ | 入力 | 出力 | 参考原価USD | response_format掲載 | 備考 |
|---|---|---:|---:|---:|---|---|
| Ling | novita/bf16 | 0.021 | 0.0616 | 0.0001358 | なし | 72%割引表示。価格のみなら最安 |
| Ling | deepinfra/fp16 | 0.060 | 0.180 | 0.0003900 | あり | 現行JSON契約を維持する評価先候補 |
| Muse Contributor | meta | 0.100 | 0.200 | 0.0006000 | あり | 学習利用、保存、思考必須の別条件 |
| DeepSeek | inference-net | 0.020 | 0.450 | 0.0003250 | あり | この入力/出力比の最安 |
| DeepSeek | decart/fp4 | 0.090 | 0.180 | 0.0005400 | あり | 出力が多い場合の最安候補 |
| GLM | relace | 0.0352 | 0.500 | 0.0004260 | なし | この入力/出力比の価格のみの最安 |
| GLM | deepinfra/fp4 | 0.075 | 0.250 | 0.0005000 | あり | JSON条件付きの最安。50%割引表示 |
| GLM | inference-net/fp4 | 0.044 | 0.600 | 0.0005200 | あり | 入力が非常に多い場合の最安候補 |

モデル全体の対応パラメーター一覧を、その最安提供先の対応と同一視しない。
Ling/NovitaとGLM/Relaceは現在の提供先APIに `response_format` の対応掲載がない。
GLM/Relaceの公開ページには除外パラメーターとしても表示される。
現行のJSON要求と `require_parameters=true` を維持する限り、これらを採用可能とは判断しない。
JSONが自然文指示だけで安定するかを試す場合は、State検証と修復の追加原価も別途比較する。

DeepSeekのInferenceNet/Decartの損益分岐は、キャッシュ未命中で入力/出力比が約3.86。
入力が多いとInferenceNet、出力が多いとDecartが安い。GLMのDeepInfra/InferenceNetは
約11.29で逆転する。これはこの2提供先同士の比較であり、全提供先の恒久的な順位ではない。
割引価格・文脈長・量子化も異なるため、採用時の上限と割引終了時の費用を再確認する。

## データ取扱と思考

MuseのOpenRouterページには **Privacy: Trains** と表示され、当該endpointの
`data_policy` は `training=true`、`retainsPrompts=true`、`retentionDays=30`、
`requiresUserIDs=true`。通常経路の `data_collection=deny` とは両立しない候補。
採用するなら独立した学習利用/保持の説明と生成ごとの同意、地域/利用条件の確認、
必要な利用者識別子を最小化する設計が必要。通常の自動経路へ含めない。

公開ページのモデル設定はMuseとGLMを `is_mandatory_reasoning=true` と掲載する。
Museはminimal以上、GLMはlow/high/maxが掲載され、非思考を保証する記載ではない。
現行Adapterの思考無効化要求・思考出力拒否へ、そのまま追加できるとは判断しない。
思考を画面に出さないことと、思考処理/請求を無効にすることを分けて確認する。
Ling/DeepSeekはmandatory=falseだが、実際の提供先で無効化できるかは実API確認が必要。

今回確認した通常endpointの公開ページでは、Ling/DeepInfra、DeepSeekのInferenceNet/Decart、
GLM/DeepInfraとInferenceNetは学習・プロンプト保存なしのメタデータが掲載される。
バッチendpointには別の保存条件があり、通常経路へ転用しない。公開表示は契約確認の代替ではない。
[公式の提供先選択説明](https://openrouter.ai/docs/guides/routing/provider-selection)でも
データポリシー表示は第三者の条件の決定的な資料ではないとされる。
`data_collection=deny` は非一時的な保存も扱い、単なる学習オプトアウトと同一視しない。

## 選び方と役割の仮案

1. JSON/State、画像、文脈長、思考、データ取扱・地域・サービス用途の条件で絞る。
2. 同じ会話と総出力上限で、入力/出力/安全検査/思考/再試行/キャッシュ未命中の総原価を比較。
3. 人格・記憶・拒否・SFW判定・速度を実測し、条件を満たす中で最安の提供先タグを固定する。
4. 料金上限、予約・実 `usage.cost` の精算、同意説明を更新し、受け入れ後に有効化する。

まずLing/DeepInfraを通常会話・画像の評価候補、DeepSeek/InferenceNetを長い文脈・
構造化/安全検査の評価候補とする。GLMは思考を扱うAdapterと実費評価が必要な比較枠、
Museは独立同意を伴う任意の比較枠。役割は実測後に確定する。

## 証拠と検証範囲

公開GETのみ。`.artifacts/research/openrouter-candidates-2026-10-04/` に4モデルの
`/api/v1/models/{author}/{slug}/endpoints`、モデル/提供先一覧、公開HTMLを保存した。
`comparison.json` は稼働status=0の掲載提供先を十進演算で比較し、価格のみ/JSON掲載付きの
結果を分ける。ページから抽出したpolicy/思考設定も別JSONへ保存。
単価・参考原価・条件付き順位を照合した。Runtimeコードの変更や実モデル品質の検証は行っていない。

今後は3モデルを加える前に、提供先ごとのプロトコル・思考・課金・同意を実装/検証する。
4候補を登録したことを、4モデルへ送信できる実装の完了とは扱わない。
