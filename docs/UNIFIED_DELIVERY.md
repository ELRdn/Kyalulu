# 統合アプリ全体の完了・本番反映の追跡

目標は承認済みの全体計画を完了し、app.kyalulu.com へ本番反映すること。
技術的に接続できない契約機能は閉じた実装と検証を用意し、接続待ちとして報告する。
ローカルで通った部分だけに完成条件を縮めない。

| 必須範囲 | 現時点 | 完了を証明するもの |
|---|---|---|
| app.kyalulu.com への統合と旧URL移行導線 | 本番未反映。統合Caddy・Cloud/Native共通配信・同一originのAPIと3文書・Workerを実HTTPS proxyで検証。Cloud/旧Mobileの監査済み候補と移行手順を保持 | 実配信・TLS・API・OAuth callback・旧URL導線・既存Remote鍵の照合 |
| 共通UI、Cloud初期選択、地域・年齢確認、3画面の任意設定 | 実装あり・接続待ちを含む | 日英の初回・戻る・スキップ・後変更・未ログイン端末利用の画面証拠 |
| 好み・お気に入り・興味なしのタグ推薦、先行する年齢/公開/ブロック制限 | 部分実装 | 既存/公開タグfixtureと検索APIを含む制限・順位の試験 |
| PC単体・オフライン維持と3方式の機能対応表 | 部分実装。Device研究の実行/結果/採点/再実行・実験別記憶と、BenchmarkLabのペア行列・進捗・別タブ中止・期限・中断回復を追加。共通生成、実IndexedDB/Web Locks/BroadcastChannel、架空推論の100ターンで隔離検証 | 会話・制作・記憶・要約・World・分岐・入出力・研究の全行確認。実モデル/実機と運用規模の証拠は残る。Deviceジョブは実行元の文書を開いている必要がある |
| 実行先/モデル/保存/同期の表示、生成中切替の停止・保存確認 | 実装・限定検証 | 3方式での停止/保存/再開・自動転送なしのE2E |
| Portable再利用、ブラウザ記憶/物語とPython共通fixture | World/cast/Lore、6形式export、JSON/PNG/CHARX/backup・ST/CAI/BYAF import、原本保持・選択履歴のatomic commit、媒体upload/再生取得を実装。48入力とLore条件、実decoder・実IDBの共通検証 | 各形式の追加実データ・全画面媒体操作、実容量・実モデル・実機を含むパリティ試験は残る |
| 認証・課金経路とRuntime通信の分離、Cloud鍵をRemoteへ送らない | 実装・限定検証 | 認証切替・Remote通信捕捉・所有者分離試験 |
| 安定ID/revisionと数値ID互換、永続outbox、自動同期 | Cloud/device/Native-PCを隔離検証。2MB超の分割転送・再開・競合・撤回と断片確認の索引化、実Chromium v1→v2移行を追加 | 分割保存/ストリーム化、250MB/1GB実容量・旧DB復元の全面照合、全方式の統合証拠 |
| 競合の共通履歴分岐、記憶を自動混合せず出典保持 | state/記憶/作品設定snapshot往復、記録済みrevisionの共通message列、同期済み/登録前のNative分岐のUUID継承と初回受領前のowner継承を隔離検証。証跡なしの旧分岐は推測で結合しない | 証跡のない旧分岐の扱い、祖先本文の復元、旧設定欠落、3方式の実UI確認 |
| 同期削除・復元、未送信変更の保護 | 条件付き承認でNative-PC/Browserのowner/revision・撤回fence・永続受領を検証。Native論理復元とCore全体復元は現在outbox/受領/ownerを保護し、自動同期停止・旧受領照合・復元単位の別コピー確認を適用。Core/既存同期の関連132件で検証 | 強制終了時のDB/媒体の一括耐久性、配布版をまたぐ全面復旧、実容量・実機・本番復旧の確認が必要 |
| 端末限定の外部送信禁止・共有記憶分離 | 部分検証 | 生成/記憶/同期/広告/外部AIの通信否定試験 |
| 最近10件＋固定会話のオフライン保存、容量不足とアカウント分離 | 再取得・保持を実装、fixture検証 | 未送信保持と文書再読込を確認。PWA/ブラウザ/実機の再起動と実容量試験は残る |
| Remote端末別の管理権限、失効、対象PCでの管理・診断・実験 | 実装・限定検証 | 既存Remote接続を使った権限/失効/全機能確認 |
| 旧Mobileの分割移行、SHA-256/revision/size、モデルCloud送信禁止 | 旧公開Workerを有効にした実originのloopback/Chromiumで中立popup・同意・分割会話転送・破損拒否・再送・明示更新・原本IDB/OPFS保持を確認。再取込み時の空下書き/送信待ち保護を修正 | 公開配信と実モデル容量・中断回復、Android/iPhoneでの直接コピー証拠。OPFS保持は架空markerでありモデル転送ではない |
| PWA明示更新、/device/ の分離ヘッダー、広告との共存 | Native実配信と実Chromiumで日英の明示更新・別タブ拒否・下書き保持・オフラインのブラウザ全終了/復帰と分離状態を確認。生成中拒否はclient試験、オフライン表示はrenderer emulationで確認 | 広告と実提供元の共存、本番配信、実モデル・実機・OSネットワーク切替での受入れは残る |
| 料金版、月額優位の数量、60/180日、原価×6、成功時精算 | 実装・fixture検証 | 決済再送/旧版条件/失敗0消費と既存残高保持 |
| 初回/日次付与、月3000円＋入金済み広告収入の原資 | 実装・fixture検証 | 二重付与/予算超過/既存台帳保持の照合 |
| 50pxバナー、加入者非表示、補充選択、下書き、勝手な再送なし | 実装・限定検証 | デスクトップ/スマホ、テーマ、広告中IME/入力の確認 |
| 報酬動画、確定尺×10、上限30秒、同時1本、検証済み完了のみ付与 | 検証用まで | 偽造/重複/遅延/再読込/原資予約、契約済み提供元の証拠 |
| 広告の別オリジン隔離、私的データを渡さない | 実装・限定検証 | ネットワーク/iframe権限を含む否定試験 |
| 13歳以上の地域別判断、保護者同意、成人確認、API/画像/共有/推薦制限 | 未承認機能は閉鎖 | 承認された地域設定と確認事業者、制限のAPI試験 |
| 固定公開snapshot、区分/審査、不明保留、人手/通報/非表示/異議申立て | 固定hash・審査revision、人手確認、公開API、地域/成人/ブロックの先行制限、日英画面と通報→非表示→異議→再承認をASGI/Chromiumで検証。旧Communityは封鎖し元DB保持 | 自動分類・公開媒体adapter、運用規模/旧データ移行、実OAuth/実機/本番の証拠 |
| 日本の個人事業/未成年/成人AI/投稿/地域への提供元適合 | 外部条件未確定 | 本人の契約・適合確認。代理申込みや購入は行わない |
| 日英の全画面、アクセシビリティ、日本語IME | Cloud設定/旧同期、記憶・出典・検査・要約訂正、共通エラー、モデル開示/見積同意/公式推論要約、プリセット/Lorebook/表情、研究の実行・比較・採点・検査・ランキング、長ターン比較実験の条件・状態・結果表、会話開始・初回案内・入力/待機・モデル準備・既知mood/日時・共通ナビ・探索/検索・Hub表示を日英対応。393/1280pxの実端末DB操作と同意の撤回、架空Runtimeでの研究下書き・比較条件の保持をChromiumで確認。他にJA中心の画面・提供元の生文が残る | 対象画面一覧を埋めた日英・幅・テーマ・IME確認 |
| 配布物、対応ソース、移行/復旧手順、接続待ち一覧 | クリーンな対応ソースから統合/旧Mobileをビルド。Worker修正込みCloud候補222件・旧Mobile候補78件をhash照合し、対応ソース・ライセンス本文・移行/復旧手順を保持。先行Windows候補の同梱Pythonも隔離確認済み | Windows候補の最新化・Docker image作成・WASM再ビルド・署名・ライセンス審査・Mac/Nodeのみの実インストール・本番復旧を含む全面受入れは残る |
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
修正版 `e25ec63` のCloud/旧Mobile候補は
[Mobile migration](validation/2026-10-26-unified-mobile-migration.md) に記録する。
先行 `a6cbd98` のApp候補は再取込み時の下書き復活があるため最新として使用しない。
