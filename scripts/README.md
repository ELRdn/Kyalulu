# scripts

現在の配布状態・費用上限・再開手順は [引き継ぎ](../docs/HANDOFF.md)。
`verify_plot_creator.py` はビルド済みWebをChromiumのPC/スマホ・明暗4条件で確認する。
APIは厳密なモックで、タブ・プレビュー・JSONエラー保持・下書き復元・保存再試行・
版競合・所有者分離を検証する。実推論/外部APIは0件で、実端末/Googleログインの代わりにはしない。
`verify_cloud_profile.py` と `verify_cloud_catalog.py` も隔離したモックUI確認。
結果と境界は [プロフィール](../docs/validation/2026-10-05-cloud-profile-sync.md)、
[キャラ表示](../docs/validation/2026-10-05-cloud-catalog.md)、
[作成UI](../docs/validation/2026-10-05-plot-creator-ui.md) を参照。

`check_cloud_auth.py --env-file .env.cloud.local` はSupabase/Googleログインの設定を
秘密を表示せず、ネットワーク送信なしでチェックする。設定手順は
[Webログイン](../docs/WEB_AUTH.md)。`cloud_admin.py grant --owner <UUID> --credits 500
--source owner-initial-500` は確認済みの既存アカウントへの単回管理者付与。
同じenv/保存先を使い、再実行でも残高を増やさない。サブスクは不要。

`verify_openrouter_live.py` は `.env.cloud-test.local` のOpenRouterキーを使う少量検証。
`--execute --budget-usd 0.02` を明示し、架空の会話/合成画像だけを送る。
Museは架空文の学習利用に同意した場合だけ `--allow-training-fixture` を加える。
再実行は同じ出力先の予算台帳を維持。クラウドの承認フラグは変更しない。
キーと思考本文は保存しない。`evidence.json` の実費合計とキー集計の反映も照合する。

`verify_openrouter_quality.py --execute --allow-training-fixture --budget-usd 0.05`
は架空の日英会話、実Memory Labの保存/検索と履歴リセット、SFW説明文、合成画像、
約4千入力トークンのカタログを段階検証する。上限には前回のsmokeと未確定予約も含む。
各ツールは同じ台帳へ**一つずつ**実行する。成功済み/中断済みのラベルを自動再送しない。
短い契約と完全なPydanticスキーマの対照は `verify_openrouter_quality_controls.py`、
完了したJSONの検証失敗だけを合計最大3試行まで修復する続きは
`verify_openrouter_quality_repairs.py`。直前のプロセス終了と台帳の保留状態を確認してから、
完了マーカーを設定する。提供先障害のリトライ/別提供先へのfallbackには使わない。
`render_openrouter_review.py <evidence.json>` は返答原文、失敗した最終JSON、記憶トレースを
ローカルの `human-review.html` にする。モデル名の表示切替、絞り込み、人間評価のJSON保存が可能。
自動照合や画面操作試験は人間レビューの完了に数えない。
DeepSeekのタメ口/軽口/親しいRPは `verify_deepseek_friendly_roleplay.py --execute`。
同じ累計台帳の中で実行し、`--guarded --style 2 --turns 2` は未発言の過去や表情を
断定しない指示を追加した短い対照。実費と試験範囲は
[段階検証記録](../docs/validation/2026-10-04-openrouter-quality.md)を参照。

`pnpm build:desktop` → `node scripts/verify_desktop_ui.cjs` で実Electronの画像・検索・日本語入力・設定・下書き・ダイアログ操作を確認する。マスコット6種類の透過表示と、明暗テーマ・幅900/1440での欠けも検証する。既存の`.venv`のPlaywrightを使用し、専用データとプロファイルで起動する。推論要求は遮断し、LLMは呼ばない。結果と画面は`.artifacts/desktop-ui-*/`に保存する。

`verify_lmstudio_vulkan.py` は指定Gemma 4をRX7600 / Vulkanで読み込み、既存キャラの構造化応答を検証する。

`verify_portable_vulkan.py` は同じ指定GGUFで、取り込んだSFWカードのLoreと構造化応答を最大300秒の生成枠で確認する。実行前にVulkanの選択とRX7600以外のGPU無効化を検証し、終了後は専用モデルインスタンスをアンロードする。
CPU専用・他GPUへの自動切替は行わない。結果は `.artifacts/portable-vulkan.json`。

再実行条件と直近の実測は [互換受け入れ記録](../docs/COMPATIBILITY_ACCEPTANCE.md) を参照。
ローンチ候補の配布物は `build_local_bundle.py`、対応ソースとライセンス一覧は
`collect_release_sources.py`。`verify_npm_beta.mjs` は展開した実配布物を使い、
開発ツールをPATHから除いて無料Coreと外部プロセスの保持を確認する。
`verify_cloud_ui.py` はAPIをモックしたChromium確認で、実モデル・Android実機の受け入れではない。

`check_launch_readiness.py --template --output .artifacts/launch-evidence.json` で
未受け入れの証拠一覧を作る。`--evidence .artifacts/launch-evidence.json --phase cloud_first_ten`
は証拠ファイルのハッシュ、実環境区分と現在のソース指紋を照合し、未完了ならexit 2。
既定は初期バックエンドのOpenRouter。10人/72時間の観測は100人への拡張前に要求する。
Go固有の許可/原価条件は明示的に `--backend opencode-go` を選んだ場合だけ要求する。
承認フラグ/契約/公開を変更しない。
`verify_npm_beta.mjs <manifest.json>` は現在のネイティブOSの配布候補を確認する。
GitHub Actionsの両OSジョブにも接続したが、実行/公開は別工程。開発機でPATHを外す確認は
クリーンVMやMac/Android実機の代わりにはしない。
`benchmark_cloud_sync.py` は合成の250MB/1GB枠で暗号化ページ保存・容量確認・
反映/再送の速度とRSSを測る。最低8GBの作業空き容量が必要。SFW/API/ネットワークは
含まず、VPSや実運用の受け入れに数えない。結果は `.artifacts/cloud-sync-volume/`。
