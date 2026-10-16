# Cloud model公開調査 — 2026-10-11

後続のユーザー方針により、Baiduは保存・学習利用の可能性を明示して送信ごとの同意で選択可能にした。
途中のoperator retention flag案は撤回。下記は公開資料の観測と当時の検討記録として保持し、
最新実装と検証は[実装記録](2026-10-11-cloud-models.md)を参照する。学習不使用特約が確認されたという意味ではない。

公開GET・公式資料のみ。キー使用／推論／課金／Git操作／デプロイ／spawnは0。変更は既存の本報告と`.artifacts/cloud-models-20261011/public*.json`のみ。前の中間報告は**親エージェントの要求**によるもので、ユーザーの停止指示ではなかった。

## 6候補の確定値

USD/100万トークン。endpoint価格であり、思考も請求対象出力へ含む。status=0はカタログ表示で、実応答の保証ではない。

| 候補 | model ID | provider_name / 固定tag | 入力 / 出力 / cache read | 最新status | 学習 / 保持 / 公開ZDR |
|---|---|---|---|---:|---|
| DeepSeek/Baidu | `deepseek/deepseek-v4.1-flash` | Baidu / `baidu/fp8` | 0.0348 / 0.1392 / 0.000696 | 0 | 表示はなし / あり・期間不明 / 不一致 |
| DeepSeek/Decart | 同上 | Decart / `decart/fp4` | 0.09 / 0.18 / 0.018 | **0（初回-2）** | なし / なし / 一致 |
| DeepSeek/InferenceNet | 同上 | InferenceNet / `inference-net/fp8` | 0.077 / 0.40 / 0.01 | 0 | なし / なし / 一致 |
| GLM/InferenceNet | `z-ai/glm-5.3-flash` | InferenceNet / `inference-net/fp4` | 0.07 / 0.05 / 0.03 | 0 | なし / なし / 一致 |
| GPT Luna Flex | `openai/gpt-6-luna` | OpenAI / `openai/flex` | 0.05 / 0.25 / 0.005 | 0 | なし / あり / 不一致 |
| Haiku Google | `anthropic/claude-haiku-5.5` | **Google** / `google-vertex/global` | 0.10 / 0.50 / 0.01 | 0 | なし / なし / 一致 |

GPT/Haikuの経路はユーザー指定。`Google Vertex`はサービス名、response照合用の公開`provider_name`は`Google`。Flexは別model IDではなくtag。全6endpointに`reasoning`・`include_reasoning`・`reasoning_effort`・`response_format`・`structured_outputs`掲載。対応パラメーター全件・canonical_slug・上限・量子化・価格原値は[候補JSON](../../.artifacts/cloud-models-20261011/public-interim.json)。Luna/Haikuに**temperature/top_pを追加しない**。

Baiduは88.4%割引の現在値。Lunaは入力>272Kで0.10/0.375、cache read 0.01・write 0.125（通常write 0.0625）。Haikuは入力>100Kで0.50/2.50、read 0.05・write 0.625・1h write 1.00（通常write 0.125・1h 0.20）。API overrideはmin_prompt_tokens=272000/100000なので、境界は高い側で見積もるか入力上限を下げる。通常単価のmax_priceで長文が通る保証はない。

## 学習拒否、保持、denyを分ける

調査開始時のAdapterは`data_collection=deny`で、`zdr=true`は指定していなかった。**新しい全候補共通のZDR要件は課さない。** Haikuだけは指定のZDR経路として`zdr=true`を構成へ明記。非ZDRだけを理由にBaidu/Flexを禁止しない。

- [Provider Selection](https://openrouter.ai/docs/guides/routing/provider-selection)と[公式SDK DataCollection](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/docs/models/datacollection.mdx)は、allowを非一時的保存・学習の可能性を許可、denyをデータ収集しない提供先だけと説明する。適格な提供先がなければエラー。**denyを学習拒否だけのスイッチと断定できない。**
- [Provider Logging](https://openrouter.ai/docs/guides/privacy/provider-logging)はアカウントの学習opt-outと保持を分けている。同ページの「保持でroutingを変えない」という文は新しい[ZDR資料](https://openrouter.ai/docs/guides/features/zdr)と整合しない。保持あり・training=falseのBaidu/Flexがdenyで実際に通るかは、公式資料にendpoint別判定表がなく、公開GETだけでは確定できない。確実に通る／確実に落ちるという中間断定は撤回。
- Decart、両InferenceNet、Googleの選択endpointはtraining=false・retainsPrompts=falseで、公開policy上deny/ZDRの条件に整合する。アカウント制約・実routingは未確認。
- `zdr=true`ならBaidu/Flexの公開endpointは不適合。false/省略でもアカウントやguardrailのZDRを解除できない。これはdenyのendpoint別判定とは別。

**Flex開示:** [OpenAI Services Agreement 4.2](https://openai.com/policies/services-agreement/)は明示合意なしのCustomer Contentによるサービス開発・改善を禁止。[API data guide](https://developers.openai.com/api/docs/guides/your-data)はopt-inなしの学習不使用と、入力/応答を含みうる監視ログの通常最大30日保持を説明する。法令・安全上の延長あり。当該OpenRouter endpointも学習なし・保持あり。OpenRouterの個別上流契約や現在のアカウントopt-in状態は取得していない。

**Baidu開示:** OpenRouterは学習なし・保持あり・期間未掲載と表示。しかし[一般規約3A.3.1–3](https://intl.cloud.baidu.com/en/doc/Agreements/s/bmesahnjh-intl-en)はAI Contentの保存、AIサービス/機械学習技術の改善、利用地域外のデータセンターへの移転・保存を許す。OpenRouter経由の特約は未取得。**法的な学習不使用確認は未解決**で、Flexと同じ確認済みラベルにはしない。[一般privacy](https://intl.cloud.baidu.com/en/doc/Agreements/s/Plr0fi68q-intl-en)からも当該promptの具体的保持日数は確認できない。

保持を許すoperator opt-inは既定falseの候補。明示有効化時の`data_collection=allow`構成もJSONへ別欄で保存した。allow自体は学習拒否を保証しないので、完全tag固定・学習不使用の根拠・保持の開示を独立して扱う。アカウントの学習opt-outは別の文書化された設定だが、今回は未読。ログイン同意更新と各送信quoteにFlexの通常最大30日/例外、Baiduの期間不明/特約未確認を表示する。親側から「opt-in既定false、同意version更新flag、quote note、他経路denyを実装済み」と報告されたが、本調査で実装や試験を確認したとは扱わない。

## 公式summaryの要求と表示

[Chat request schema](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request)の`reasoning.summary` enumは**auto / concise / detailed / null**。`auto`は正式な値。これはrequestのverbosity設定で、responseの`type="reasoning.summary"`とは別。共通schema掲載だけでモデル/endpointが全値を実装するとは言えない。

| モデル | 資料で確定した範囲 | 未確定 |
|---|---|---|
| GPT Luna Flex | [Luna公式モデル資料](https://developers.openai.com/api/docs/models/gpt-6-luna)とcatalogでlow対応。公式Responses summariesは`reasoning={effort:low,summary:auto}`でopt-in | Lunaのsummary verbosity別対応、Flex→OpenRouter Chatの実際の返却type |
| Haiku Google | [Haiku移行資料](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)でnative `thinking={type:adaptive,display:summarized}`＋`output_config.effort=low`。OpenRouterは対応Claudeをsummarized既定と説明 | Google endpointのChat mapping、summary指定のモデル別変換、返却type |
| DeepSeek 3経路 | 非mandatory、公開reasoning対応。モデルpageはreasoning-content方式 | providerによる公式summary生成契約は確認できない |
| GLM InferenceNet | mandatory=true、low対応。内部思考を許して非表示にする候補 | 公式summary生成契約は確認できない |

[OpenAI公式reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)はraw推論を公開せず、Responsesの`output`内`type=reasoning`の`summary`配列（`type=summary_text`/`text`）に公式要約を返すと説明。Chatの`reasoning_details`とは別schema。

OpenRouter Chatでは**`reasoning_details`内のtype=reasoning.summaryかつ文字列summaryだけ**表示許可。SSEも`delta.reasoning_details`で同じ判定。配列はtext/encrypted/server-tool等を含むunionなので、トップレベルreasoning/reasoning_content、reasoning.text、暗号化データ、未知typeは表示しない。Haiku nativeが要約を返す仕様でも、未確認のreasoning.textを要約として扱わない。公式要約がなければ未提供とし、rawから要約を作らない。

GPT Chat部分構成（未送信）:

```json
{"model":"openai/gpt-6-luna","provider":{"only":["openai/flex"],"allow_fallbacks":false,"require_parameters":true,"data_collection":"deny"},"reasoning":{"effort":"low","summary":"auto"}}
```

保持opt-in有効時のallow版はJSONの別欄。**summaryを表示したいrequestへexclude=trueを併記しない。** excludeは思考返却を抑えるだけで計算/課金は残り、summaryだけを残すフィルターではない。include_reasoning=trueもsummary専用ではない。

Haiku Chat要約候補は`model=anthropic/claude-haiku-5.5`、`provider.only=[google-vertex/global]`、deny・ZDR・fallback禁止、`reasoning={effort:low}`。OpenRouterの既定summarizedという資料に基づく候補で、公式typeが得られなければ表示しない。[Haiku thinking資料](https://platform.claude.com/docs/en/build-with-claude/thinking)ではhigh以下ならnative disabledも可能、xhigh/maxとのdisabled併用は400。manual budget_tokensはHaiku 5.5で400なので旧モデルの予算式を転用しない。

## 出力予算とstatusの限界

`max_tokens`（Chat）/`max_output_tokens`（Responses）は**思考＋可視回答の合計**。lowは努力水準であり、思考20%というhard ceilingや回答分の確保を保証しない。Luna/Haikuの選択endpoint上限は128000。DeepSeekはBaidu/InferenceNet 393216、Decart 262144、GLM 262144。小さい上限では思考だけで打ち切られ得る。length/max_tokens、Responses incomplete/max_output_tokensを成功扱いしない。

OpenAIの初期実験向け「少なくとも25000 tokens」は一般的な開始時の推奨であり、本体の必須最小値・校正済み既定値ではない。quote/reserveは可視summary長ではなく、設定した総出力上限、入力、cache write等の有効費用で見積もる。今回予算や自動有料retryを変更していない。

Decartの**初回-2→再取得0**は両方保存。[公式EndpointStatus schema](https://openrouter.ai/docs/api/api-reference/endpoints/list-endpoints)と[公式TypeScript SDK](https://github.com/OpenRouterTeam/typescript-sdk/blob/main/src/models/endpointstatus.ts)は`0,-1,-2,-3,-5,-10`を列挙し、-2の名前は単に`Minus2`。Python SDKも数値のみ。**厳密な意味は公式資料で未確定**。disabled/degraded/capacity不足とは命名しない。最新0は復旧原因の証明ではない。

## requiresUserIDsと証拠

Google/OpenAI endpointはrequiresUserIDs=trueだが、公式Chat schemaの`user`はoptional。省略時はOpenRouterのアカウント単位の識別子を使用。指定時も上流のhashed identityに組み込み、raw値は転送しないと記載される。**アプリのuser/raw ID/emailを追加する必要はない。** 今回構成はuser省略。省略時はproviderのpolicy blockがアカウント全体へ影響しうる。ハッシュの具体的合成方法・安定期間は未確認。

[public-api.json](../../.artifacts/cloud-models-20261011/public-api.json)は初回公開API、[public-sources.json](../../.artifacts/cloud-models-20261011/public-sources.json)は追加API・policy・公式資料、[public-interim.json](../../.artifacts/cloud-models-20261011/public-interim.json)は最終6構成・schema enum・status履歴・開示文・既定falseのopt-in案。取得UTC、URL、元HTTP本文SHA256と抽出範囲を保持。ChatGPT参照のassistant本文は依頼記載の未解決content-referenceのみで、モデル情報の根拠にはしない。

未確認: 実routing/返却type/品質/請求、Baidu特約、denyの保持ありendpoint別判定、status -2の意味、アカウント/guardrail設定。JSON整合性は自己検査、実装・package試験は本調査の範囲外。
