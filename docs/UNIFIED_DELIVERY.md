# 統合アプリ全体の完了・本番反映の追跡

目標は承認済みの全体計画を完了し、app.kyalulu.com へ本番反映すること。
技術的に接続できない契約機能は閉じた実装と検証を用意し、接続待ちとして報告する。
ローカルで通った部分だけに完成条件を縮めない。

| 必須範囲 | 現時点 | 完了を証明するもの |
|---|---|---|
| app.kyalulu.com への統合と旧URL移行導線 | 未反映 | 実配信・TLS・API・OAuth callback・既存Remote鍵の照合 |
| 共通UI、Cloud初期選択、地域・年齢確認、3画面の任意設定 | 実装あり・接続待ちを含む | 日英の初回・戻る・スキップ・後変更・未ログイン端末利用の画面証拠 |
| 好み・お気に入り・興味なしのタグ推薦、先行する年齢/公開/ブロック制限 | 部分実装 | 既存/公開タグfixtureと検索APIを含む制限・順位の試験 |
| PC単体・オフライン維持と3方式の機能対応表 | 部分実装 | 会話・制作・記憶・要約・World・分岐・入出力・研究の全行確認 |
| 実行先/モデル/保存/同期の表示、生成中切替の停止・保存確認 | 実装・限定検証 | 3方式での停止/保存/再開・自動転送なしのE2E |
| Portable再利用、ブラウザ記憶/物語とPython共通fixture | World/cast/Lore・プリセット・固定版を実装、共通fixtureと同期往復を検証 | 履歴snapshot interchange、実モデル・実機を含むパリティ試験は残る |
| 認証・課金経路とRuntime通信の分離、Cloud鍵をRemoteへ送らない | 実装・限定検証 | 認証切替・Remote通信捕捉・所有者分離試験 |
| 安定ID/revisionと数値ID互換、永続outbox、自動同期 | Cloud/device/Native-PCを隔離検証。2MB超の分割転送・再開・競合・撤回を追加 | 分割保存/ストリーム化、250MB/1GB実容量・旧DB復元の全面照合、全方式の統合証拠 |
| 競合の共通履歴分岐、記憶を自動混合せず出典保持 | state/記憶/作品設定snapshot往復、記録済みrevisionの共通message列、同期済みNative分岐のUUID継承を隔離検証 | 同期前/旧ID移行、祖先本文の復元、旧設定欠落、3方式の実UI確認 |
| 同期削除・復元、未送信変更の保護 | 条件付き承認でNative-PCとBrowserのowner/revision・撤回fence・永続受領を隔離検証 | 旧復元/実端末スケール確認 |
| 端末限定の外部送信禁止・共有記憶分離 | 部分検証 | 生成/記憶/同期/広告/外部AIの通信否定試験 |
| 最近10件＋固定会話のオフライン保存、容量不足とアカウント分離 | 再取得・保持を実装、fixture検証 | 未送信保持と文書再読込を確認。PWA/ブラウザ/実機の再起動と実容量試験は残る |
| Remote端末別の管理権限、失効、対象PCでの管理・診断・実験 | 実装・限定検証 | 既存Remote接続を使った権限/失効/全機能確認 |
| 旧Mobileの分割移行、SHA-256/revision/size、モデルCloud送信禁止 | 専用画面・直接転送を実装、別オリジンOPFS fixture検証 | 本番ドメインのpopup/CSP、実モデル容量とAndroid/iPhoneでの直接コピー証拠 |
| PWA明示更新、/device/ の分離ヘッダー、広告との共存 | 実装・確認残り | 更新適用・生成中拒否・オフライン再起動・配信ヘッダー |
| 料金版、月額優位の数量、60/180日、原価×6、成功時精算 | 実装・fixture検証 | 決済再送/旧版条件/失敗0消費と既存残高保持 |
| 初回/日次付与、月3000円＋入金済み広告収入の原資 | 実装・fixture検証 | 二重付与/予算超過/既存台帳保持の照合 |
| 50pxバナー、加入者非表示、補充選択、下書き、勝手な再送なし | 実装・限定検証 | デスクトップ/スマホ、テーマ、広告中IME/入力の確認 |
| 報酬動画、確定尺×10、上限30秒、同時1本、検証済み完了のみ付与 | 検証用まで | 偽造/重複/遅延/再読込/原資予約、契約済み提供元の証拠 |
| 広告の別オリジン隔離、私的データを渡さない | 実装・限定検証 | ネットワーク/iframe権限を含む否定試験 |
| 13歳以上の地域別判断、保護者同意、成人確認、API/画像/共有/推薦制限 | 未承認機能は閉鎖 | 承認された地域設定と確認事業者、制限のAPI試験 |
| 固定公開snapshot、区分/審査、不明保留、人手/通報/非表示/異議申立て | 私的キューまで | 公開API・分類・審査・通報/異議申立てのE2E |
| 日本の個人事業/未成年/成人AI/投稿/地域への提供元適合 | 外部条件未確定 | 本人の契約・適合確認。代理申込みや購入は行わない |
| 日英の全画面、アクセシビリティ、日本語IME | Cloud設定/旧同期の案内・確認文を追加対応、他にJA中心の画面あり | 対象画面一覧を埋めた日英・幅・テーマ・IME確認 |
| 配布物、対応ソース、移行/復旧手順、接続待ち一覧 | 作成中 | 再現可能なbundleとhash、隔離復元、配布inventory |
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
