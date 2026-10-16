# 初期クラウドをOpenRouterへ変更

> 選定途中の履歴。現在はDeepSeek V4.1 Flash / InferenceNet固定で本人限定VPSが稼働中。
> 以下のMiMo/DeepInfra候補・未設定状態は当時の記録。[現在地・引き継ぎ](../HANDOFF.md)を参照。

2026-10-04。ひろなおの「最初からOpenRouter経由」に合わせた設定・公開準備の更新。
**実装候補を変更した。公開クラウドの稼働・実APIの受け入れは未完了。**
実推論・画像の外部送信・実決済・契約・デプロイ・npm公開・告知は行っていない。
APIキーの取得、コミット/プッシュも行っていない。

## 現在の経路

| 用途 | 経路 |
|---|---|
| 通常会話 | OpenRouter → DeepInfra/fp8 → MiMo-V2.6-Flash |
| 構造化処理/大きな文脈 | OpenRouter → DeepInfra/fp8 → DeepSeek-V4.1-Flash |
| 生成前後・保存・同期のSFW検査 | OpenRouter → DeepInfra/fp8 → DeepSeek-V4.1-Flash |
| クラウドBYOK | 利用者のキーで直接DeepSeek、SFW検査は運営経路 |

Muse Contributorは初回のOpenRouter経路に含めず、モデル選択にも出さない。
通常会話の自動振り分けは既存の文脈サイズ基準を維持し、障害時のモデル変更ではない。
固定した提供先以外へのfallbackやリダイレクトは行わない。
思考無効化・JSON・使用量・実モデル/提供元メタデータを確認し、不一致なら失敗する。
価格上限と学習目的のデータ収集を拒否する要求を送るが、実際の対応・保持条件は別途確認が必要。

## 変更した設定と公開条件

- `CloudConfig`の直接構築と環境変数の既定値、配備例、公開前チェックはOpenRouter。
- 設定は `KYALULU_OPERATOR_BACKEND=openrouter`。キーは未設定。
  `KYALULU_OPENROUTER_APPROVED=0` と推論・画像・課金・法務の承認フラグは維持。
- OpenRouterの準備中エラーを `openrouter_not_accepted` に変更。
- Goの書面許可・月額契約費配分は初回公開の条件から外した。
  任意のGo Adapterは残るが、明示選択時は従来の許可/原価チェックを維持する。
- 10人/72時間の観測は最初の10人の受付後、100人への拡張前に要求する。
  最初の10人を受け入れるために観測済みである必要はない。
- 新規販売には実決済テストと保持容量の確保も必要。条件不足なら停止を維持。
- 送信先の同意・日英プライバシー/クレジット原稿・README/ロードマップを更新。
  既存のGo/直接DeepSeekの同意をOpenRouterへ転用しない。

精算はOpenRouterの `usage.cost` の十進値を保持し、安全検査・再試行と合算する。
掲載単価の上限はキャッシュ未命中を含む予約に使用する。実請求が欠けた生成は
利用者0消費で失敗、不確定原価は運営予算へ含める。既存の予約超過負債・受付停止も維持。

## 今回の検証

- PythonのOpenRouter/Go/クラウド/公開前チェック：**88 passed**。
  既定経路、未承認停止、過去同意の拒否、料金・容量の既存検証を含む。
  全Pythonテストの再実行ではない。
- Web：**94 passed**。型検査とビルド通過。既知のtheme-init、Noise外部化、
  チャンクサイズのビルド警告は残る。
- Ruff Fと変更した追跡ファイルの差分空白検査通過。
- Chromium390px：ログインのOpenRouter説明、同意前の操作停止、同期初期オフ、
  販売停止中のPortal、MiMo自動/DeepSeekの選択、Muse非表示、画面例外0を確認。
  APIはすべてモック。証拠は `.artifacts/cloud-ui-openrouter-2026-10-04/`。
- 初回の最大予約は **363 K-Credits**、試用付与1,000内。推論0回の見積チェックであり、
  利用回数や実費の約束ではない。
- 公開前チェックの既定実行は **exit 2**。証拠は
  `.artifacts/launch-readiness/initial-openrouter.json`。
  Go条件を含まず、72時間観測は100人への拡張条件にだけ含む。証拠テンプレートも確認。

## 配布物

最新WebとRuntimeを使ってWindows候補を別ディレクトリへ再構築した。
`.artifacts/npm-beta-openrouter-2026-10-04/kyalulu-0.1.0-beta.1-win32-x64.tar.gz`

SHA-256：`d9b2cfee38913f802b8988ba62b34276857e72e59b07b5babba753db48109779`

`.artifacts/npm-verify-gHQ0Za/acceptance.json` に同じハッシュを記録。
展開した候補でPATHから開発ツールを外し、起動・Mock会話・記憶の再起動後保持・
バックアップ/復元・更新失敗時のデータ保護・外部プロセス保持を確認した。
開発PCで事前配置した候補の検証であり、実モデルの推論は0回。

公開manifestは空のまま。実機/ライセンスの承認はfalse。公開npmからの初回導入や
クリーンWindows/Macでの受け入れを完了したとは扱わない。

## 残る公開前作業

OpenRouterキーと実API/画像/請求の受け入れ、Supabase/SMTP/Stripe/VPSの設定、
処理地域・保持条件・販売条件の確定、クリーンWindows/MacとAndroid実機、
VPS/Relay負荷、24時間運転、外部退避から別ホストへの復元が残る。
報酬広告・一部のクラウド画像取込・Remote外部レビューも未完了。
過去のGo接続記録は履歴として保持し、この記録を現在の方針とする。
