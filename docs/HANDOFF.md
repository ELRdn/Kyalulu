# Kyalulu 引き継ぎ — 2026-10-08

次スレッドの開始点。まずこのファイルを読み、必要な箇所だけ参照する。
実装検証は10月6日（10月7〜8日の追加実施なし）。本番配布状態・残高・費用は10月5日の検証スナップショット。
10月6日は公開health/status/匿名401を再確認した。変更や有料送信の前に
実サービス/台帳で確認し、過去の成功を新しいソースの受け入れに転用しない。

## 10月6日の実装と現在の境界

クラウド・Web・npm配布の3担当と、編集しない独立レビュー担当で修正/再検証を実施。
認証refreshとlogoutの競合、認証サービス障害時のlogout失敗、同期基準版の流用、
所有者切替後の旧応答、新規保存の再送による重複、CLIの更新/復元の失敗処理を修正した。
保存UUIDを一時下書きに保持し、Cloudでも再送の安全検査/backup/同期版更新を省いて
保存済み結果を返す。対応ソースの私的DB/鍵/リンク混入を拒否し、公開受け入れの
ソース指紋をキャラ/プロンプト/共有UI/ビルド入力まで拡張した。

統合後のWeb119試験、型チェック/全体ビルド、Chromiumの認証/プロフィール/キャラ表示、
作成4条件、Electron9項目は通過。実推論・有料安全検査0。
Python全体618試験と費用47試験も通過。拒否/経路違反/切断等で既知実費が
落ちる欠陥を修正し、失敗時の利用者0消費、運営原価保持、超過時の要照合/次送信停止を確認した。
第3独立レビューの空UUID/既存編集再送/旧ownerの競合エラーも修正。
新規/既存編集ともUUIDを下書きへ保持し、内容と期待版の変更後は更新する。
第4レビューの初回profile読込後のowner切替もPUT前のepoch照合で修正済み。
SFW応答受信後の中止、原価不明後の追送、単発上限超過後の次操作の停止も修正。
第5独立レビューで対象4件を再現し、解消・追加欠陥なしを確認した。
配布の第6レビューでrenderer LICENSE収集のリンク拒否漏れと、更新/rollbackの
選択書換え失敗時に現Runtimeが停止する問題を追加。共通path検査と停止順序を
修正し、独立12条件で現PID/データ/両pointer保持と成功時のcommit後停止を確認。
対象追加所見なし。final4のnative/npm/Cloud候補を再生成・監査済み。
公式portable Node22.23.3でもCLI17試験と実npm tarballの隔離確認が通過した。
実機/公開download/実モデル/24時間運用は未受け入れ。
`operations.review_required=1` は再起動後も新規の有料送信を止める。請求/原価照合まで
解除しない。既知実費を保ち、停止のために架空の負債を作らない。
古い `final`/`final2`/`final3`候補はprovisionalとして保持。最新Windows/npm候補は
`.artifacts/launch-20261006-final4-packaging/REPORT.md` を参照する。
詳細と最終候補は [ローンチ前検証](validation/2026-10-06-launch-hardening.md)。
帰宅後にAndroid実機とクリーンWindowsを利用可能、Macは未提供。
[実機受け入れ手順](validation/2026-10-06-device-acceptance.md) と
`.artifacts/launch-20261006-final/evidence-template.json` を用意した。

今回のコードは本番へ未配布。下記の10月5日の稼働リリース/残高を、今回の修正の
本番受け入れとして扱わない。一般公開・npm公開・販売/広告・pushは行っていない。
10月8日に未コミット変更をテーマ別5コミットへ整理済み（未push）。

## 現在の目的・確定方針

- 無料OSS Core＋任意SFWクラウド。キャラクターの人格・記憶・世界・関係性が中心。
- 現在はひろなお本人1アカウントの個人テスト。Googleログイン成功済み。
  サブスク・追加購入・広告は無効。個人テスト中に販売を有効化しない。
- 運営モデルは **DeepSeek V4.1 Flash**。初月からOpenRouter → InferenceNet
  (`inference-net`) 固定、fallbackなし。OpenCode GoやMuseへ戻さない。
  送信先変更はデータ説明と再同意を伴う。
- ローカル推論/BYOKにクラウドアカウントやK-Creditsを必須にしない。
- 初回ローカル配布はnpmベータ（Node 22+、Windows 11 x64 / macOS Apple Silicon）。
  npm未公開、公開manifestは未準備。署名済みDesktop・GPU・Expoは後続。
- CloudはSFW限定。画像対応コードはあるが、実画像の安全精度/原価受け入れまで
  保存/同期を無効にする。Remote正式提供は外部セキュリティレビュー後。

## 完了したことと証拠

| 範囲 | 結果 | 記録 |
|---|---|---|
| VPS/認証 | 独立Cloud Runtime、HTTPS、Supabase/Google、本人ログイン、500 K-Credits単回付与 | [Web認証](WEB_AUTH.md)、[VPS初期設定](validation/2026-10-04-cloud-vps-auth.md) |
| アカウント設定 | 表示名・保存キャラ・ピン留めを暗号化保存。版競合409、所有者切替/別クライアント、バックアップ復元を検証 | [プロフィール同期](validation/2026-10-05-cloud-profile-sync.md) |
| プロット表示 | YAMLはサーバーに既存。CloudでのNSFW取得403を「存在しない」と表示していた問題を修正。エラー再試行も追加 | [キャラ表示](validation/2026-10-05-cloud-catalog.md) |
| 不要な保存 | チャットを開くのみでは設定を再保存せず、不要な安全検査を防ぐ。変更した設定は保存 | 同上 |
| 作成UI | zeta参考の6タブ、イントロプレビュー、文字数、固定保存操作、種類選択、一時下書き、JSONエラー保持 | [作成UI](validation/2026-10-05-plot-creator-ui.md) |
| モデル評価 | DeepSeek日英20ターン×3＝120/120の初回スキーマ成功、親しいRP24ターン＋対照2ターン。人手評価と長期品質は残る | [モデル品質](validation/2026-10-04-openrouter-quality.md) |

アカウント設定の同期とローカルCore→Cloudの任意転送は別機能。
後者は初期値オフで、自動アップロードしない。サーバー確定保存は利用者別DBへ、
作成画面の一時下書きは所有者/接続先別sessionStorageへ保存する。タブ内の下書きは
別端末へ同期しない。個人のローカルプロットを今回自動転送したわけではない。

10月5日のチェック：Web本番ビルド、関連フロントエンド11試験、catalog backend2試験。
作成UIは1440px/390px×ライト/ダーク4条件合格。130モックAPI要求・24モック保存、
実推論/有料安全検査0。HTTPS配信JS・Createの遅延JS/CSSはビルドと一致。
Cloud/Relay正常、匿名catalog401。コンテナ内の読み取りAPI確認は認証ownerを置換した
別ASGIプロセスであり、新しいGoogleログイン試験や実端末での受け入れではない。

## 次の作業（優先順）

1. **10月6日修正版のCloud配布**：本番は10月5日リリースのまま。新releaseと
   更新前の暗号化バックアップ、rollback先を用意し、既存Cloudだけ更新する
   （下記「現在の配布と復旧」）。health・匿名401・本人ログインを確認する。
2. **本人の実クラウド操作**：配布後の本番でGoogleログイン→プロット作成→保存→
   再読込→編集→会話開始。表示名・保存キャラ・ピン留めを別の本人端末で確認する。
   実際のCloud保存はSFW検査のAPI費用が発生し得る。下記の予算で管理する。
3. **台帳と人手品質**：送信前上限、予約、成功精算、失敗0消費、再取得の二重課金なし、
   実請求の照合。返答原文を人間が確認し、RPの未発言の過去の付加や記憶の誤りを評価。
   既に完走した120ターンを理由なく再送しない。
4. **実機・運用**：Android IME/ロック/回線切替/再接続、24時間運転、実VPSの
   同期/SFW/容量超過/復元とRelay負荷、独立保管先と別ホストでの復旧。
   PC退避と隔離復元の成功を災害復旧全体の完了と扱わない。
5. **npm・一般公開準備**：final4候補を使い、クリーンWindows/Mac
   のNodeだけで導入・再起動・更新失敗・復元。名称/ライセンス/対応ソース提供を確認。
   SMTP実配信、日英法務/保持・処理先条件と公開前チェックの証拠登録を完了する。
6. **公開拡張**：別工程として10人受付→72時間観測→100人。サブスクは本人の再指示と
   決済/販売/復元容量の受け入れ後。広告、Remote、後続機能は独立工程。

## 費用とデータの制約

- 累計API実費上限 **$0.10**。前回実費＋不確定予約を49,548,721ナノドルとして
  引き継ぎ、残り最大50,451,279ナノドル（約$0.05045）。新しい台帳を作って上限を
  リセットしない。実際の未処理予約/消費を確認し、検証と個人テストを並列送信しない。
- 本人の500 K-Creditsは$0.05の販売基準相当で、API実費$0.05ではない。
  6倍原価の料金係数、整数切り上げ、成功最低1/失敗0を維持。通常編集/同期は
  利用者0クレジットでも運営側の安全検査原価が発生し得る。
- 最終配布後の台帳スナップショット：アカウント1、残高500、生成operations0。
  付与済み。再付与不要。実費・予約・バックアップは再配布/月替わりで消去しない。
- 秘密env、本人メール/UUID、トークン、鍵、会話・記憶本文を出力/運用ログへ残さない。

## 現在の配布と復旧

- Cloud: <https://cloud.kyalulu.com> / Create: <https://cloud.kyalulu.com/#/create>。
- Relay health: <https://relay.kyalulu.com/healthz>。
- release: `/opt/kyalulu-cloud/releases/20261005-official-portraits/bundle`。
- image: `kyalulu-cloud:20261005-official-portraits`。
- rollback: `/opt/kyalulu-cloud/releases/20261005-plot-creator/bundle`。
- レイ先輩1枚・シオン執事2枚・モカちゃん（日常）2枚の公式画像を反映済み。
  詳細画面はサムネイル切り替え対応。[検証記録](validation/2026-10-05-official-portraits.md)。
- Compose project `kyalulu-cloud`、container `kyalulu-cloud-cloud-1`。
  `deploy/cloud/compose.yml`＋`compose.vps.yml`、release内の秘密`deploy/cloud/.env`。
  data/backup volumes: `kyalulu-cloud_cloud-data` / `kyalulu-cloud_cloud-backups`。
- SSH: 接続先・鍵・known_hostsのパスはリポジトリ外の非公開メモで管理する。
  `BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`,
  `KexAlgorithms=curve25519-sha256` と既存known_hostsを使用し、鍵の内容を読まない。
- bundle SHA256: `c0e604c6fe31ba5f4af052f821d357fdf670be15d791f9c78f1b7ff1d8890f67`。
- 更新前暗号化バックアップ: `.artifacts/official-portraits-vps/pre-update-verified.kybackup`。
  SHA256: `417aed69299d740b5015775b0e044e9461196ebc018e8e67071168bd87eaa27e`。
  `.artifacts` はGit管理外で、このcheckoutのローカル証跡。
- 既存Cloudだけ更新し、Relay/Caddyを再作成していない。次の変更も新releaseと
  更新前暗号化バックアップを用意する。既存ops.pyは特定release専用なので、そのまま
  deployを再実行しない。[VPS手順](../deploy/cloud/VPS.md)を参照。

## 実装の入口・必要時の検証

| 対象 | ファイル |
|---|---|
| 作成ページ/編集UI | `apps/web/src/pages/Create.tsx`, `create.css`, `components/PortableEditor.tsx`, `portableEditor.css` |
| キャラ表示/チャット | `apps/web/src/lib/api.ts`, `pages/CharacterEntry.tsx`, `pages/ActiveChat.tsx`, `lib/errors.ts` |
| アカウント/Cloud画面 | `lib/accountProfile.ts`, `components/CloudSettings.tsx`, `pages/Profile.tsx`, `runtime/python/cloud/account_profile.py` |
| 認証/課金なし個人テスト | `runtime/python/cloud/auth.py`, `config.py`, `store.py`, `meter.py`, `generation.py`, `scripts/cloud_admin.py` |
| モデル/同期 | `runtime/python/providers/openrouter.py`, `cloud/router.py`, `cloud/sync.py`, `cloud/transfers.py`, `api/cloud_sync.py` |
| 回帰/画面確認 | `tests/test_cloud_catalog.py`, `tests/test_cloud_account_profile.py`, `scripts/verify_cloud_profile.py`, `verify_cloud_catalog.py`, `verify_plot_creator.py` |

作業内容に応じた最小限の確認を選ぶ。以下は再検証コマンドで、ドキュメントを読んだだけでは再実行不要。

```powershell
pnpm --filter web build
pnpm --filter web test src/lib/cloud.test.ts src/lib/accountProfile.test.ts
.venv/Scripts/python.exe -m pytest tests/test_cloud_catalog.py tests/test_cloud_account_profile.py -q
.venv/Scripts/python.exe scripts/verify_plot_creator.py --output .artifacts/plot-creator-recheck
# 証拠未登録ならexit 2。公開や承認フラグを変更しない。
.venv/Scripts/python.exe scripts/check_launch_readiness.py --backend openrouter --phase cloud_first_ten
```

作業ツリーは10月8日時点でclean。今後もユーザー変更を保持し、commit/push/reset/switch/stash/cleanは依頼なしに行わない。
今回も実装担当と独立レビューを分離した。新しい担当を立てる場合も共有ファイルを
同時編集しない。日本語、ひろなお、シアンの会話方針を維持する。

## 新スレッドへ貼る文

> Kyaluluの続きをお願い。まず `docs/HANDOFF.md` を読んで、本人限定クラウドの実操作・
> 台帳確認からローンチ準備を続けて。モデルはDeepSeek V4.1 Flash / OpenRouter /
> InferenceNet固定、サブスクはまだ不要。累計API実費上限$0.10と既存台帳を維持し、
> dirty変更を保護して、実装済み・モック検証・実機/本番受け入れを分けて進めて。
