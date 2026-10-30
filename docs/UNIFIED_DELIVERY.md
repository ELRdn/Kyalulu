# 統合アプリ全体の完了・本番反映の追跡

目標は承認済みの全体計画を完了し、app.kyalulu.com へ本番反映すること。
技術的に接続できない契約機能は閉じた実装と検証を用意し、接続待ちとして報告する。
ローカルで通った部分だけに完成条件を縮めない。

| 必須範囲 | 現時点 | 完了を証明するもの |
|---|---|---|
| app.kyalulu.com への統合と旧URL移行導線 | 本番未反映。統合Caddy・Cloud/Native共通配信・同一originのAPIと3文書・Workerを実HTTPS proxyで検証。Cloud/旧Mobileの監査済み候補と移行手順を保持 | 実配信・TLS・API・OAuth callback・旧URL導線・既存Remote鍵の照合 |
| 共通UI、Cloud初期選択、地域・年齢確認、3画面の任意設定 | 実Appの日英・393明/1280暗で、サーバー拒否・規約同意・確認票・3画面の戻る/スキップ/保存し直し・Cloud会話時ログイン・ログインなし端末会話の実DB作成を確認。言語/お気に入りの上書き、owner持越し、確認中の遅延応答を保護 | 元の要件に対応するローカル証拠は初回設定記録を参照。実地域条件・実OAuth・本番/実機の受入れは別途必要 |
| 好み・お気に入り・興味なしのタグ推薦、先行する年齢/公開/ブロック制限 | 共通タグ別名・先行絞り込みと順位、公開一覧の別タブ即時反映、ブロック/owner切替をASGI/Chromiumで確認。実ホームのゲストお気に入り・再読込・興味なしの除外/復帰も検証し、アカウント書込み/作成を増やさない | 元の要件に対応するローカル証拠は推薦記録を参照。本番・実機・実OAuthの全体受入れは別途必要 |
| PC単体・オフライン維持と3方式の機能対応表 | 部分実装。Device研究の実行/結果/採点/再実行・実験別記憶と、BenchmarkLabのペア行列・進捗・別タブ中止・期限・中断回復を追加。共通生成、実IndexedDB/Web Locks/BroadcastChannel、架空推論の100ターンで隔離検証 | 会話・制作・記憶・要約・World・分岐・入出力・研究の全行確認。実モデル/実機と運用規模の証拠は残る。Deviceジョブは実行元の文書を開いている必要がある |
| 実行先/モデル/保存/同期の表示、生成中切替の停止・保存確認 | Cloud実API/DB/台帳、暗号化PC実通信、Device実保存で、架空推論による生成中・保存結果確認待ちの3方向切替拒否、入力復帰、往復の下書き/履歴保持と自動転送なしを確認。Cloud/PCは画面離脱/再読込も実確認。Cloudの遅延成功は取消0消費、明示再送は成功精算 | 実モデル/提供元、実機、本番配信を含む3方式の全面受入れは残る |
| Portable再利用、ブラウザ記憶/物語とPython共通fixture | World/cast/Lore、6形式export、JSON/PNG/CHARX/backup・ST/CAI/BYAF import、原本保持・選択履歴のatomic commit、媒体upload/再生取得を実装。48入力とLore条件、実decoder・実IDBの共通検証 | 各形式の追加実データ・全画面媒体操作、実容量・実モデル・実機を含むパリティ試験は残る |
| 認証・課金経路とRuntime通信の分離、Cloud鍵をRemoteへ送らない | 実Chromium/Noise/Relay/HostでCloud cookie/bearer/owner/CSRFの正の対照とRemote復号前後の2要求を検証し、認証canary混入0を確認 | 本番HTTPS/OAuth、全API/ブラウザー・認証切替の全面受入れは残る |
| 安定ID/revisionと数値ID互換、永続outbox、自動同期 | Cloud/device/Native-PCを隔離検証。Browserの本文/固定outboxを1MiB断片へ分割し、v1/v2→v3混在読込・破損/容量不足時のatomic rollbackを実Chromiumで確認 | decoded tree/UI全体化、250MB/1GB/RSS・旧DB復元の全面照合、全方式の統合証拠 |
| 競合の共通履歴分岐、記憶を自動混合せず出典保持 | state/記憶/作品設定snapshot往復、記録済みrevisionの共通message列、同期済み/登録前のNative分岐のUUID継承と初回受領前のowner継承を隔離検証。証跡なしの旧分岐は推測で結合しない | 証跡のない旧分岐の扱い、祖先本文の復元、旧設定欠落、3方式の実UI確認 |
| 同期削除・復元、未送信変更の保護 | 条件付き承認でNative-PC/Browserのowner/revision・撤回fence・永続受領を検証。Native論理復元とCore全体復元は現在outbox/受領/ownerを保護し、自動同期停止・旧受領照合・復元単位の別コピー確認を適用。Core/既存同期の関連132件で検証 | 強制終了時のDB/媒体の一括耐久性、配布版をまたぐ全面復旧、実容量・実機・本番復旧の確認が必要 |
| 端末限定の外部送信禁止・共有記憶分離 | 実Device保存/架空推論で生成・手動記憶、外部モデル拒否、同期未同意時の自動Cloud/同期/広告通信0を実Chromiumで確認 | 実Worker/モデルの通信、共有記憶の全面隔離、全機能/実機の否定試験は残る |
| 最近10件＋固定会話のオフライン保存、容量不足とアカウント分離 | 選択/置換の1件ずつ処理・競合と実Chromium quota拒否時の原本/未送信/receipts保持、再開を確認。v3断片保存統合後もcache6・quota4ケース成功 | 実ディスク枯渇、既存DBへの後付quota、PWA/ブラウザ/実機の再起動と実容量試験は残る |
| Remote端末別の管理権限、失効、対象PCでの管理・診断・実験 | 実装・限定検証 | 既存Remote接続を使った権限/失効/全機能確認 |
| 旧Mobileの分割移行、SHA-256/revision/size、モデルCloud送信禁止 | 旧公開Workerを有効にした実originのloopback/Chromiumで中立popup・同意・分割会話転送・破損拒否・再送・明示更新・原本IDB/OPFS保持を確認。再取込み時の空下書き/送信待ち保護を修正 | 公開配信と実モデル容量・中断回復、Android/iPhoneでの直接コピー証拠。OPFS保持は架空markerでありモデル転送ではない |
| PWA明示更新、/device/ の分離ヘッダー、広告との共存 | Native実配信と実Chromiumで日英の明示更新・別タブ拒否・下書き保持・オフラインのブラウザ全終了/復帰と分離状態を確認。生成中拒否はclient試験、オフライン表示はrenderer emulationで確認 | 広告と実提供元の共存、本番配信、実モデル・実機・OSネットワーク切替での受入れは残る |
| 料金版、月額優位の数量、60/180日、原価×6、成功時精算 | 実装・fixture検証 | 決済再送/旧版条件/失敗0消費と既存残高保持 |
| 初回/日次付与、月3000円＋入金済み広告収入の原資 | 実装・fixture検証 | 二重付与/予算超過/既存台帳保持の照合 |
| 50pxバナー、加入者非表示、補充選択、下書き、勝手な再送なし | 実Appの実Chromium24ケースで日英/393明/1280暗、ホーム/探索/Cloud会話の50px枠、加入者/端末/PCの非表示、15秒150表示、402補充・下書き・owner切替/遅延応答・自動再送なしを確認 | 本番CSP/PWA・実広告・実機・OSの日本語IMEでの確認は残る。PCローカルはElectron識別子の模擬 |
| 報酬動画、確定尺×10、上限30秒、同時1本、検証済み完了のみ付与 | 検証用まで | 偽造/重複/遅延/再読込/原資予約、契約済み提供元の証拠 |
| 広告の別オリジン隔離、私的データを渡さない | 実装・限定検証 | ネットワーク/iframe権限を含む否定試験 |
| 13歳以上の地域別判断、保護者同意、成人確認、API/画像/共有/推薦制限 | 未承認機能は閉鎖 | 承認された地域設定と確認事業者、制限のAPI試験 |
| 固定公開snapshot、区分/審査、不明保留、人手/通報/非表示/異議申立て | 固定hash・審査revision、人手確認、公開API、地域/成人/ブロックの先行制限、日英画面と通報→非表示→異議→再承認をASGI/Chromiumで検証。旧Communityは封鎖し元DB保持 | 自動分類・公開媒体adapter、運用規模/旧データ移行、実OAuth/実機/本番の証拠 |
| 日本の個人事業/未成年/成人AI/投稿/地域への提供元適合 | 外部条件未確定 | 本人の契約・適合確認。代理申込みや購入は行わない |
| 日英の全画面、アクセシビリティ、日本語IME | Cloud設定/旧同期、記憶・出典・検査・要約訂正、共通エラー、モデル開示/見積同意/公式推論要約、プリセット/Lorebook/表情、研究の実行・比較・採点・検査・ランキング、長ターン比較実験の条件・状態・結果表、会話開始・初回案内・入力/待機・モデル準備・既知mood/日時・共通ナビ・探索/検索・Hub表示を日英対応。393/1280pxの実端末DB操作と同意の撤回、架空Runtimeでの研究下書き・比較条件の保持をChromiumで確認。他にJA中心の画面・提供元の生文が残る | 対象画面一覧を埋めた日英・幅・テーマ・IME確認 |
| 配布物、対応ソース、移行/復旧手順、接続待ち一覧 | 固定4bca277のWindows Nativeを同梱Python3.13.7で生成し、実CLIの架空復元/rollback、梱包後Chromiumの日英/物語/下書き再起動と実PID終了を確認。8,748 member・製品226件・対応ソース818件・ライセンス8原文を照合。同版Cloud tarの233 manifest・precache61・対応ソース/WASM/ライセンスを確認 | 同版CI 41010931510はWASM/Cloud/Windows/macOS全4ジョブ成功。Linux image219項目・隔離12項目と既定CMDが成功。署名・最終ライセンス審査（renderer原文空欄11件を含む）・クリーンOS/初回公開取得・本番復旧・実機を含む全面受入れは残る |
| Android/iPhone実機20ターン、ロック復帰、回線切替 | 未実施 | 実機に基づく個別証拠。PCブラウザで代用しない |
| 本番反映、残高/台帳/予算維持、旧環境への復旧 | 未実施 | バックアップの隔離復元、反映前後照合、実配信hashと正常性 |

詳細な現状は [UNIFIED_APP.md](UNIFIED_APP.md)、最新の削除・復元証拠は
[検証記録](validation/2026-10-24-unified-erasure.md) を参照。
オフライン保存・直接移行の追加証拠は
[cache/migration](validation/2026-10-24-unified-cache-migration.md) に分けて記録する。
作品設定・Lore・生成設定の追加証拠は
[Portable](validation/2026-10-24-unified-portable.md) に記録する。
PC専用の登録・自動同期・撤回と画面の追加証拠は
[Native sync](validation/2026-10-24-unified-native-sync.md) に記録する。
ブラウザの同意撤回・受領記録と文書再読込の証拠は
[Browser withdrawal](validation/2026-10-24-unified-browser-withdrawal.md) に記録する。
履歴の状態・記憶・出典の方式間変換は
[History snapshots](validation/2026-10-24-unified-history-snapshots.md) に記録する。
履歴の作品設定・生成request値・過去Library/World版の追加証拠は
[Historical settings](validation/2026-10-25-unified-history-settings.md) に記録する。
revision/messageの共通列証明と同期済みNative分岐のID継承は
[Lineage](validation/2026-10-25-unified-lineage.md) に記録する。
Cloud設定と旧バックアップ同期の日英表示は
[Settings language](validation/2026-10-25-unified-cloud-settings-language.md) に記録する。
2MB超の統合会話・永続outboxの分割転送と再開は
[Entity transfers](validation/2026-10-25-unified-entity-transfers.md) に記録する。
この表は公開合格や全計画完了の宣言ではない。
暗号化PC接続の明示停止・保存結果確認待ちと、端末内への切替/PC復帰の証拠は
[Target switching](validation/2026-10-31-unified-target-switch.md) に記録する。
Device生成元の日英停止・保存確認・PC往復は [Device target switching](validation/2026-10-31-unified-device-target-switch.md)、
認証canaryの暗号化Remote捕捉と端末限定会話の通信否定は [Runtime privacy](validation/2026-10-31-unified-runtime-privacy.md) に記録する。
Cloud生成元の実API/台帳・日英停止/再開/切替は [Cloud target switching](validation/2026-10-31-unified-cloud-target-switch.md)、
取消後の遅延成功・再精算・見積/owner/session境界は [Cloud stop accounting](validation/2026-10-31-unified-cloud-stop-accounting.md) に記録する。
分割送信中の本文再読込除去と旧outbox/DBの互換性・復旧条件は
[Outbox guards](validation/2026-10-25-unified-outbox-guards.md) に記録する。
転送一時データの起動時/定期清掃、期限切れ後のNative outbox再開、
確定/撤回の永続受領保持は
[Transfer cleanup](validation/2026-10-25-unified-transfer-cleanup.md) に記録する。
Research/Library/Creatorの共通Runtime書き出し経路と切替中の結果拒否は
[Runtime downloads](validation/2026-10-25-unified-runtime-downloads.md) に記録する。
Libraryの形式/版/原本、取込みの再送・競合・容量不足、媒体のNative再取込みは
[Device exports](validation/2026-10-25-unified-device-exports.md) に記録する。
Binary取込み・画像実decode・権利確認・owner別媒体と明示再生は
[Device imports](validation/2026-10-25-unified-device-imports.md) に記録する。
SillyTavern・Character.AI・BYAFの追加形式と分離した履歴取込みは
[Source imports](validation/2026-10-25-unified-device-source-imports.md) に記録する。
統合審査を旧Community APIから迂回しない境界と既存rowの保持は
[Community gate](validation/2026-10-25-unified-community-gate.md) に記録する。
固定公開版・人手審査・通報・異議申立てと公開先アカウントの照合は
[Publication workflow](validation/2026-10-26-unified-publication-workflow.md) に記録する。
記憶・出典・要約の表示言語と端末DB操作は
[Memory language](validation/2026-10-26-unified-memory-language.md) に記録する。
共通エラーの表示言語と操作・課金案内の保持は
[Error language](validation/2026-10-26-unified-error-language.md) に記録する。
モデル・見積同意・公式推論要約の表示とCIのlocale固定は
[Model language](validation/2026-10-26-unified-model-language.md) に記録する。
Native登録前の分岐IDと初回受領前のowner継承、論理復元時の中立対応表の無効化は
[Native local identity](validation/2026-10-26-unified-native-local-identity.md) に記録する。
Nativeの旧論理snapshot復元後の送信停止・受領照合・別コピー確認は
[Native restore](validation/2026-10-26-unified-native-restore.md) に記録する。
研究の表示言語・採点下書き・実験切替は
[Research language](validation/2026-10-26-unified-research-language.md) に記録する。
端末内の研究API・実験別記憶・保存/停止/再実行と共通評価fixtureは
[Device research](validation/2026-10-26-unified-device-research.md) に記録する。
端末内BenchmarkLabのペア行列・進捗・別タブ中止・期限と中断回復は
[Device benchmarks](validation/2026-10-26-unified-device-benchmarks.md) に記録する。
対応ソースのfixture閉包、共通収集、Nativeシナリオと分離ヘッダー、署名前の配布候補は
[Release sources](validation/2026-10-26-unified-release-sources.md) に記録する。
PWAの日英表示・明示更新・別タブ拒否・実ブラウザ全終了後の端末会話/下書き復帰は
[Unified PWA](validation/2026-10-26-unified-pwa.md) に記録する。
会話開始・初回案内・入力/待機・モデル準備の表示言語と、原文/下書き/revisionを保つ切替は
[Chat entry language](validation/2026-10-26-unified-chat-entry-language.md) に記録する。
共通ナビ・探索・検索パレット・Hub表示と、日英どちらの検索語でも絞り込みを保持する検証は
[Search language](validation/2026-10-26-unified-search-language.md) に記録する。
会話一覧・管理操作・物語設定・未確認送信の日英表示、キャンセル時の全記録保持と
言語切替時の送信ID/下書き保持は
[Chat management language](validation/2026-10-26-unified-chat-management-language.md) に記録する。
プロフィール・接続先設定の日英表示、端末内の保存先説明、名前/接続先の下書きと
テーマ切替・ピン留め会話への復帰は
[Profile language](validation/2026-10-26-unified-profile-language.md) に記録する。
PC登録・接続状態・直接接続登録の日英表示、生成中の鍵保持、PC一覧の重複解消と
統合シェルからの実暗号化・架空Runtime検証は
[Remote language](validation/2026-10-26-unified-remote-language.md) に記録する。
人物像・世界観と登場人物/RPG編集の日英表示、元の版の書き出し、入力幅、
言語切替の下書き保持とowner切替の編集分離は
[Creator language](validation/2026-10-26-unified-creator-language.md) に記録する。
Create操作・取込み/保存/競合/書き出しの日英表示、同一IDの下書き再開、
Deviceの出典重複を保存時にも照合する処理と再送/同時実行は
[Create workspace language](validation/2026-10-26-unified-create-workspace-language.md) に記録する。
Core全体復元時のoutbox/受領/owner保護、旧送信の本文なし照合、Cloud確認と失敗時の復元前アーカイブは
[Core restore](validation/2026-10-26-unified-core-restore.md) に記録する。
PortableEditorの3種別・全タブ・設定集/挨拶/媒体/プリセット詳細の日英表示と、
言語切替時の未完成JSON・タグ下書き保持は
[Portable editor language](validation/2026-10-26-unified-portable-editor-language.md) に記録する。
canonical配信のCloud/Native共通化、統合Caddy設定と実HTTPS proxy越しの画面・Worker確認は
[Unified proxy](validation/2026-10-26-unified-proxy.md)、本番移行・復旧条件は
[Deployment](UNIFIED_DEPLOYMENT.md) に記録する。本番のApp API・Device・移行URLはまだ404。
旧公開Workerからの実origin popup・分割会話移行・明示更新と下書き保護、
日英の転送中切替・393px明/1280px暗の受入れと最終 `0d9b2f5` のCloud/旧Mobile候補は
[Mobile migration](validation/2026-10-26-unified-mobile-migration.md) に記録する。
先行 `a6cbd98` のApp候補は再取込み時の下書き復活があるため最新として使用しない。
好み変更の即時推薦・区分フィルターとゲストのお気に入り保存/分離は
[Recommendations](validation/2026-10-26-unified-recommendations.md) に記録する。
この推薦修正は `0d9b2f5` 配布候補の後続であり、本番候補は全変更を含む再生成・監査が必要。
初回の地域/年齢/同意から好み・おすすめ・ログイン時点・端末会話へ進む実App受入れと、
好み編集の部分保存・owner分離は [Initial entry](validation/2026-10-26-unified-entry.md) に記録する。
Cloudログイン・同意・送信先説明・成功/失敗の日英表示と、待機中の解析撤回・画面離脱後の応答保護は
[Login language](validation/2026-10-26-unified-login-language.md) に記録する。
ログイン居住国のサーバー確認済み一覧・日英名称・提供停止時の選択/同意解除と、
欠落/不正な一覧の拒否は [Login regions](validation/2026-10-26-unified-login-regions.md) に記録する。
地域の本番承認を追加したものではない。先行 `ae51ead` のRuntime/Web CIはUbuntu/Windowsとも成功。
Browser/Native送信・Cloud配信用のUTF-8一括コピー除去、旧wireのバイト互換、
ハッシュ中の撤回/owner変更保護と84MB架空JSONの追加割当て試験は
[Sync byte streams](validation/2026-10-26-unified-sync-byte-streams.md) に記録する。
保存/commit/受信は全体実体化が残るため、250MB/1GB単一会話の合格とは扱わない。
先行 `96e3f59` のRuntime/Web CIはUbuntu/Windowsとも成功。
Browser/Native受信とCloud commitの断片JSON解析、共通構文/UTF-8 fixture、
最終SHA/構文/撤回失敗時の原本・cursor保持、84MB架空JSONの解析追加割当ては
[Sync receive streams](validation/2026-10-26-unified-sync-receive-streams.md) に記録する。
全体のencoded bufferは除去したが、decoded tree・スカラー・永続保存の全体実体化は残る。
オフライン保持の選択・置換で全会話本文を同時に読む処理の除去と、競合/失敗時の保持は
[Offline cache](validation/2026-10-29-unified-offline-cache.md) に記録する。
端末内APIのhealth/単一会話/単一Library操作で不要な全会話読込を除去し、
owner・下書き・固定版を維持した証拠は
[Device reads](validation/2026-10-29-unified-device-reads.md) に記録する。
広告と残高不足導線の日英・幅・テーマ、owner切替と遅延応答の保持は
[Commercial UI](validation/2026-10-29-unified-commercial-ui.md) に記録する。
実Chromium quota拒否時の原本・未送信・receipts保持と解除後の同一保存再開は
[Device quota](validation/2026-10-29-unified-device-quota.md) に記録する。
監査済みCloud候補のLinuxイメージ作成・networkなしの配信/既定CMD確認と、本番の参照情報保持は
[Isolated image](validation/2026-10-29-unified-container.md) に記録する。本番切替ではない。
Browser同期受信/ack確定時の全owner本文の一括保持を除き、参照作品・数値ID上限・
衝突/owner切替とatomic rollbackを維持した証拠は
[Selective sync](validation/2026-10-29-unified-sync-selection.md) に記録する。
後続の送信準備/最終件数もcursor化し、50件上限・削除優先・同一snapshotの参照読込と
走査中のowner/生成/同意の変更を63単体・実IDB10シナリオで確認。最終件数中の同意撤回後にsavedへ戻る競合も修正した。
固定6c8cdf4はclean sourceの831試験と統合build、Cloud候補223項目とprecache61項目の照合まで確認済み。
bf83d03イメージはこのclient修正を含まない。以降の変更は候補を再生成し、同じ版のimage検証と区別する。
PC未選択時にRuntime通信が同一originへ流れない境界と、通常の暗号化接続/失効の維持は
[Runtime routing](validation/2026-10-29-unified-runtime-routing.md) に記録する。
Windows同梱CLIの隔離復元/rollbackと旧Mobile梱包、切替修正により旧候補を配布対象外とした記録は
[Native/Mobile packages](validation/2026-10-30-unified-native-mobile.md) に記録する。

新規WASMの固定ソース再ビルドと通常/互換/CPUの実モデル短文生成は
[Fresh WASM](validation/2026-10-30-unified-wasm.md) に記録する。旧b133ce0候補は新WASMを含まない。
Browser保存をIDB v3の1MiB断片へ分離し、原本/receipt/outboxのatomic性と深さ境界を確認した記録は
[Segmented storage](validation/2026-10-30-unified-segmented-storage.md) に記録する。
v3へ更新後はv2 clientへ戻せないため、復旧にもv3対応bundleが必要。
別の任意実行Windows試験では250MBの架空payload保存/ブラウザ再起動/復元は成功。
1GBは保存/断片照合まで成功し、本文復元は4GiBの試験安全予算下で未合格。
この予算を製品上限と扱わない。decoded tree/UI clone、全chat/sync/RSSと実機の受入れは残る。
同条件の復元先行比較でも1GBは未完了だった。効果を確認できなかったcursor読取案は採用せず、
上限超過時に所有ブラウザを閉じてからCDPの終了を待つ検証driver修正だけを採用。
上限超過3種と正常系の回帰試験4件が成功。容量の合格条件・安全予算は変更していない。

2026-10-30の追加許可で固定897737fのVPS別imageを作成し、実image210ファイル/新WASM4点・
12項目・既定Uvicorn実HTTPと、3サービス/DB表hash/残高集計/設定フラグの前後一致を確認した。
[Current image](validation/2026-10-30-unified-container.md) に記録する。本番切替ではない。
Android/iPhone実機は本人の指定で後日とした。volume/Compose配置メタデータの広い取得は
自動承認レビューで範囲外とされ未実行。その後、本人が限定したmount4項目を許可し、指定先へ非公開保存済み。
暗号化backupと別root復元の[架空データprobe](validation/2026-10-30-unified-disaster-recovery.md)は23項目成功。
アカウント0件でも原資のある復元先を拒否するguardと、Community/途中転送DBの保存漏れを修正し、
Cloud関連125試験と最終復元10ケースで確認。コピーを使うprivate staging prototypeは後続のcommitted-WAL試験を含め50項目成功。
これら後続のadmin変更は固定897737f imageには含まれない。
実データのbackup/転送/復元は未実施であり、この4項目の読取許可には含まれない。

後続の操作workerは架空13項目、停止・再開controllerはDockerなしの模擬26項目が成功。
import巻き戻しによる暗号化失敗と入力/復元先の重複を修正し、schema全体・型・rowid・
未収録保存物の照合を補強した。コード専用packageも固定した。
[本番backupの具体的な範囲](UNIFIED_PRODUCTION_BACKUP_REVIEW.md)を用意したが、
本番停止・master secret利用・暗号文取得・隔離復元は未承認/未実施。
flock・systemd・実mount/信号・実schema互換の証拠とは区別する。

旧Cloud originの退役設定を追加し、旧API/callbackの410・日英再ログイン案内・
コード/Cookie/本文を転送しない境界と、明示更新でキャッシュを消さないWorkerを実装。
配布/対応ソース/指紋の39試験と、Caddy 2.10.2＋ChromiumのHTTPS試験16項目が成功。
旧キャッシュ画面は架空fixtureであり、実旧Cloud UIの更新操作や本番配信とは区別する。
[Legacy Cloud](validation/2026-10-30-unified-legacy-cloud.md) に公開URLの現在の観測と
原本保持/別タブ拒否/CSPの証拠を記録。本番バックアップの承認待ちは継続している。

clean 5ace6a7候補の実梱包を照合したところ、旧897737f候補のJSには管理Relay URLが
含まれていなかった。旧候補のimage/hash合格はRemote登録の合格を証明しないため、
3方式の完成配布物として選択しない。新しい明示設定buildでは未登録PC画面を実表示し、
HTTPS17項目が成功。統合本番buildにはRelay originの必須検証を追加し、11ケースと
型検査・Web全866件/67ファイルが成功。最終配布物/imageの同一版検証は別途必要。

Native a22984aの梱包/CLIとMobileの静的監査は成功したが、実Nativeブラウザ初回起動で
Cloud確認APIの404・Local既定なし・このPC選択なしを再現したため、Native配布の合格ではない。
Native専用build/marker・Local初期値・ローカル地域確認・明示Cloud別画面の修正を追加。
設定なし地域の閉鎖は維持し、架空ポリシー以外を承認していない。Backend88件とWeb910件が成功。
[Native entry](validation/2026-10-30-unified-native-entry.md) の梱包後ブラウザ試験は別の必須gate。
対応ソース581件はGit export一致であり、raw blobは31件一致・550件は改行だけの差と訂正。
ローカルDockerはInference socket起動エラーで新Linux imageを検証できていない。

ac2ffc2の梱包後NativeブラウザはLocal初回確認・Mockの実送信・4行の履歴/下書き再起動・
Cloudの別画面引渡しが成功。一方、先行する失敗試験の残留Pythonから、Windows Proactorの
切断例外とHTTP終了だけで成功にするlauncherの欠陥を発見した。NativeのWindows loopを
Selectorへ変更し、保存PIDが実終了するまで所有情報を保持する。Windowsでは512 socket・
async subprocess非対応の制約があり、現Runtimeには該当するsubprocess呼出しはない。
同梱Pythonの切断例外注入で修正前の待機と修正後の正常終了を比較し、関連23件が成功。
新しい梱包/CLI/ブラウザの同一版検証は別途必要。旧失敗試験の強制片付けは正常終了の証拠に含めない。

固定87f560dを同梱Python3.13.7で再生成し、Windows tar `885c8314…906fad` と
packed CLI `3fa9cd62…5b48b4` を検証。実CLI復元/rollback、Mockブラウザ送信と再起動・
実終了、8,734 member・218製品ファイル・587 Git exportの照合が成功し、残留PIDは0。
既定Python3.14で生成した先行候補はcasefold差分で監査不合格とし、配布対象外にした。
手動成果物CIの初回40993302006はemsdk ZIP実行権限の欠落で失敗。bootstrapを修正し、
関連9件とLinux権限fixtureを確認。Windows/macOS runnerでの梱包受入れは再実行の別gate。

日英表示を診断・PC公開設定・物語表示・Studio/Status・旧公開作品/作者画面まで補完。
原文・下書き・request IDと権限境界を保ち、診断は既知の完全テンプレートだけ翻訳する。
Web全986件/75ファイルと、共有エラー修正後91件・型検査が成功。
[Auxiliary language](validation/2026-10-30-unified-auxiliary-language.md) に記録する。
梱包後Nativeの新しい日英/物語表示試験は、同一版の再梱包後に別途実行する。


端末記憶の出典・手動訂正・共通APIとInspectorの欠落を修正し、Pythonの実commitと
共通fixtureで照合。実IDBの本文/履歴同時rollback、再読込、owner分離、対象scopeの記憶・履歴消去と
未送信記憶/出典を残す端末限定復旧を確認した。
[Device memory](validation/2026-10-30-unified-device-memory.md) に記録。
全Web1107件/76ファイルと型検査が成功。世界/共有scopeの明示移行はまだ409を返すため、
Memoryの全機能パリティとは扱わない。この後続修正は固定4bca277の配布物には含まれない。

Pythonのsession限定手動記憶を世界/共有scopeへコピーした際の欠落来歴と、完全消去後に
残るvalidation.errorsを修正。修正前3ケースの失敗を再現し、会話27件・復元/同期22件と
Web型検査が成功した。共通デバッグドロワーの日英ラベルも補完した。
[Memory erasure](validation/2026-10-30-unified-memory-erasure.md) に範囲と限界を記録。
93eae08のPR CIはWindows/Ubuntuとも成功したが、この後続修正のCI/配布受入れではない。

端末内通常会話とResearchのowner別WebLockを共用し、応答stream返却後も推論・保存完了まで
保持する。別タブのpendingを誤ってfailedへ変えず、旧版の未標識記録は明示確認・revision照合後
だけ復旧する。実Chromium2文書と日英の復旧画面で、保存失敗rollback・確認取消・競合拒否・
送信入力と新しい下書きの保持を確認。[Generation lock](validation/2026-10-30-unified-generation-lock.md)
に記録。実推論・実機・世界/共有scopeの完成を意味しない。

同期の送信選択でも永続pendingを確認し、別タブの生成途中データを送らない。受信/分岐/復旧の
独立コピーは元Workerのpendingを解除し、メッセージと下書きを保持する。Web1120件・型検査、
実IDBの同期10ケース・記憶2ケースが成功。ed8e3c7のUbuntu CIで見つかったタブ終了と
lock解放の順序差は、試験が実lock状態を待ってから検証するよう訂正した。新CIは別確認。

共有記憶のidentity・版・論理scope IDをPythonと固定fixtureで照合し、owner/保存方針別の
分割ドメイン、source revision CAS、会話投影/生成記録の同時保存、消去連携を実装した。
手入力の会話来歴も日常UIとPython/Browser APIへ接続。実IDBでコピー/重複排除、原本保護、
pending fence、消去rollback、>1MiBの分割/破損検出/再読込を確認。Web1187件・型と
Python関連128件が成功。[Scope contract](validation/2026-10-30-unified-memory-scope-contract.md)
に記録。この基盤コミット時点では通常Device生成/移行APIへの接続が未完了で、移行409を維持した。
0deaa87のWindows CIは成功、Ubuntuの新試験はlock解放待ちの判定で失敗したため、
試験を実queued lock取得のawaitへ訂正した。新CI/配布物の合格ではない。
監査行に出典を保持し、記憶行の除去後も本文を完全消去できるようにした。同文の手動記憶は
Python/Browserとも出典別に重複判定する。共有pendingの孤立復旧は共通生成APIへ接続し、
新しい下書き/記憶/返信の保持、source削除時の非復活、部分保存失敗rollbackを確認した。

続いて通常Device生成と記憶APIへ共有ドメインを接続した。新規世界範囲・旧会話の明示移行、
local/sync分離、他会話の数値IDを含めない保存投影、再生成失敗時の旧返信保持と手動記憶保持を
実装。共通記憶パネルの移行から通常生成・source消去・共有移行・再読込まで日英の実Chromium
で確認し、旧移行409のstubを除去した。[Device scoped memory](validation/2026-10-30-unified-device-scoped-memory.md)
に実装・架空推論・実機/容量/本番の未検証境界を記録する。
レビューで見つかった履歴削除後の参照切れと、他会話との同文提案で出典を失う問題も修正。
Web1244件、Python関連153件、型・製品buildと日英の実IDB/UI/架空Worker試験が成功した。
新しい配布物・実モデル・実機・本番の合格を意味しない。

実モデルで通常Device APIを通したところ、既定キャラの指示予算超過とJSON形式不成立を検出。
物語に必要な状態/要約/作品文を保持して重複説明を圧縮し、構造化要求だけに先頭からの文法拘束を
接続した。[Actual Device runtime](validation/2026-10-30-unified-device-real-runtime.md) に、架空Workerとは別の
実GGUF/Worker/IDB・共有参照/消去後再生成、失敗時保護と品質/実機の未合格境界を記録する。
固定486f8cbの配布物CI41045793166は全4ジョブ成功し、WASM4点は既検証版と一致したが、
この実モデル修正を含まないため最終候補として選択しない。

backup rootのUUID範囲外にある過去アーカイブ・管理記録の未収録を架空データで再現し、
全ファイルと空ディレクトリの保持、展開前の不正member拒否を修正した。
関連22件が成功。[Retained backup files](validation/2026-10-30-unified-retained-backup-files.md)
にコードと架空試験の範囲を記録する。運用状態と実データの証拠は非公開で管理する。

Device生成前の履歴選択では、既定の保守的カウンターだけ古い本文の反復計数を除去した。
全system・最新user以降・出力予約・省略件数を維持し、ONNX等の独自カウンターは従来経路を維持。
[Context selection](validation/2026-10-30-unified-context-selection.md) に旧結果との比較、
50,000件を省略する計数検証、全Web1,252件と全体化が残る境界を記録する。

端末内のキャラ・Persona・World・Library・プリセット一覧は、種類を保存ヘッダーで
絞ってから本文を復元する。無関係な巨大/破損会話で一覧が開けなくなる問題を修正した。
[Catalog reads](validation/2026-10-31-unified-catalog-reads.md) に7ケースの修正前再現、
全Web1,259件・実IDB23ケースと、会話全体の容量対応とは別の境界を記録する。

月額補助原資の対象月と失効日を同じ時刻から計算し、月をまたいだ広告予約の失効後に
新しい原資が誤って期限切れになる問題を修正した。既存行の残額・期限は書き換えない。
[Monthly funding](validation/2026-10-31-unified-monthly-funding.md) にCI失敗、修正前再現と
月末・うるう年・年越し・元原資のみへの返却・再返却防止の検証範囲を記録する。

会話の選択範囲または最新windowを読む保存層APIを追加。旧完全読取とは別の返却型にし、
全断片・範囲外構文・owner・revision/tokenを検証する。[Conversation pages](validation/2026-10-31-unified-conversation-pages.md)
に保存層の初期検証とDevice画面の最大50件表示・下書き保持・遅延パネルを記録する。
端末内の終端生成復旧は、同じreadonly snapshotの受領記録と対象発言だけで確認する。
[Generation proof](validation/2026-10-31-unified-generation-proof.md) に実IDB35ケース・
全Web1,314件、最新ページ外の復帰、変更・重複・破損・owner切替時の拒否を記録する。
孤立pendingの復旧書込は履歴を1件ずつ再保存し、全断片の検証後にheader・受領・domainを同じtxで確定する。
[Streamed recovery](validation/2026-10-31-unified-stream-recovery.md) に全Web1,321件・実IDB41ケース、
未送信変更/固定outboxの保持、容量不足・破損・owner/旧版revision競合時のrollbackを記録する。
毎回全走査・書換え中の追加容量・metadata/記憶domain・inline/巨大scalar等の限界は残る。
この追加だけで、会話全体の1GB復元・生成/同期/UIの大容量対応を完了とはしない。

端末内の設定保存・手動要約編集も、最大50件のページ確認と履歴1件ずつの書換えへ移行した。
context取得も完全復元を避け、保存tx内でowner・revision・本文tokenを再照合する。
[Metadata rewrite](validation/2026-10-31-unified-metadata-rewrite.md) に実IDB48ケース、
本文/状態/未知フィールド/未送信分の保持、競合・破損・容量不足・記憶生成ガードの検証と限界を記録する。

共有記憶commitの参照元照合は、全履歴を復元せず、0件windowで全断片・構文・hashと本文の保存方針を検証する。
[Memory source verification](validation/2026-10-31-unified-memory-source-verification.md) に
全Web1,325件・実IDB53ケースと、参照元/固定outbox保持、破損・owner切替・方針偽装・quota時の拒否を記録する。
生成本体の全体保持は残り、この変更だけで大容量生成を合格とはしない。
続く[Memory source projections](validation/2026-10-31-unified-memory-source-projection.md)では、
共有元contextを本文なしの専用型へ変更し、記憶だけの更新も履歴1件ずつの再保存へ接続した。
全Web1,378件・実Chromium13ケース・日英の既存共有記憶UIを確認し、全履歴/未知field/固定outboxと
domain/受領のatomic性を維持する。metadata・巨大scalar・記憶domain・生成元の完全履歴は依然保持する。
[1 GB memory projection diagnostic](validation/2026-10-31-unified-memory-projection-capacity.md)では、
固定した架空1 GB本文の記憶のみ更新・再読込・全15,240発言の独立照合が159秒で成功した。
所有Jobの4 GiB/480秒・空き容量制限は維持し、原本・固定outboxを保持。会話全体の生成/復元/同期の合格とは分ける。
記憶一覧のlegacy混在・domain未作成時も[Memory catalog](validation/2026-10-31-unified-memory-catalog.md)へ統合し、
全会話本文の一括復元を除去した。空一覧・旧形式・local/sync集計を維持し、全Web1,385件・実IDB14ケースが成功。
一覧用のsource走査は1件ずつだが、本文全走査とmetadata/domain保持の限界は残る。

Core復元の媒体交換中に実process killすると、現在DBの参照媒体が欠落する不具合を再現・修正した。
[Core interruption](validation/2026-10-31-unified-core-interruption.md)に実kill3地点を含む66件の検証を記録する。
媒体を検証して両世代分を先に保持し、SQLiteのatomic反映を後に行う。独立復旧ZIPと同期/owner/削除保護は維持。
不要媒体を自動削除しないため容量増加があり、電源断・fsync耐久性・本番復元は未検証。

生成時の章/arc要約は20発言ずつ受け取るcollectorへ接続し、巨大本文のexcerptのための全Unicode配列化を除去した。
[Incremental summaries](validation/2026-10-31-unified-incremental-summaries.md) に旧処理との比較20ケース、
全Web1,346件、日英実UIの160発言・8章確定/再生成の出典revisionと下書き保持を記録する。
要約・文字走査の変更であり、生成元の全履歴保持を解消したものとは扱わない。

配布用license collectorは、パッケージに原文がない場合のみ固定版/宣言/license SHAを照合して上流原文を補う。
[Renderer licenses](validation/2026-10-31-unified-renderer-licenses.md) にPython62件、固定234packageの
原文なし11→3、開発用混在560packageの別結果、Runtime原文10件と改行/リンク/改ざん拒否の証拠を記録する。
3件の未確認grant・追加tool依存・最終審査は残し、license_reviewedはfalseを維持する。

Cloud/端末同期の成功・停止・確認失敗通知は、表示後の言語変更にも追従する。
[Runtime sync language](validation/2026-10-31-unified-runtime-sync-language.md) にWeb1,359件・最終対象13件、
実React/IndexedDB/確認ダイアログでの通知4種・再送なし・同意撤回・固定outbox/原文保持・owner遮断を記録する。

Windowsの1b3e5b6 CIはWeb単体/Python試験を通過後、実IDBの60秒待機で失敗した。
[CI storage diagnostics](validation/2026-10-31-unified-ci-storage-diagnostics.md) にケース/ページ例外/consoleの
診断追加とローカル53ケース・診断2件の確認を記録する。期限・データ・assertは変更せず、CI原因は未確定。

1de2cacのUbuntu PR CIでは、接続エラー画面のRemote設定欄をProfile読込済みと誤認していた。
[Remote reload diagnostics](validation/2026-10-31-remote-ci-recovery.md)に認証済みProfileとGET-only再接続の
境界を記録する。通常reload・制御したaccess失敗・PC/Device/PC復帰を含む15チェック成功。
保存結果の保留・元のcomposer assertionは維持し、既存UI再接続は各境界1回まで。元の接続切断原因は未確定。
