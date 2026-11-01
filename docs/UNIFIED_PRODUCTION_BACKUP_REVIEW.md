# 本番の暗号化バックアップと別root復元：承認対象

2026-10-30。承認範囲を提示した時点の計画であり、現時点の承認・実行状態は示さない。
承認・実行証拠は非公開の運用記録で管理する。マージ・本番切替とは別の工程。

## 対象と保存先

- 既存Kyalulu VPSのCloudコンテナ `kyalulu-cloud-cloud-1` だけ。
  Relay/Caddyは停止・再設定しない。元のimage・設定・2つのnamed volumeを維持する。
- VPSの新しい専用root：
  `/opt/kyalulu-cloud/recovery/unified-precutover-0a53d57-20261030/`。
  既存rootがあれば再利用せず、記録済み状態を照合してから判断する。
- PCの非公開保存先：
  `D:/VibeCoding/my zeta/.artifacts/unified-production-recovery-20261030/production-0a53d57.kybackup`。
  Git/PRへ入れず、既存ファイルを上書きしない。
- アーカイブはcontrol/tenant/Community/途中転送DB、会話・記憶・媒体、台帳・残高、
  認証用テーブルと保持済み復元点を含む。PCへ転送するのは暗号化アーカイブのみ。
  DB平文・会話本文・master secretの平文はPCへ転送しない。
- 本番volumeの実ホストSource、Composeパス、他の環境変数・鍵は取得しない。
  許可済み4項目と既存image情報は、対象照合用の非公開metadataとして同じVPSへ渡す。

## 操作順

1. コード専用packageと照合用metadataを専用rootへ転送し、manifestを照合する。
   外側rootは0700。`tools/`の公開コードだけを読取可能にし、`work/`だけを
   検証UID10002が書ける0700領域として新設する。本番の所有権・権限は変えない。
2. deploy lockを取り、元のコンテナID・image・mount4項目・healthと他writerの不在を確認。
   元DBは読取専用SQLでpending操作とfund/credit holdの件数だけ確認し、0以外は停止しない。
3. コピー用コンテナを**作成後・開始前にinspect**し、本番2volumeが読取専用、
   rootfs読取専用、networkなし、UID10002、capabilityなし、no-new-privileges、
   256MiB/CPU25%/pids64であることを照合する。
4. stop intentと作成したコンテナIDを保存し、Cloudだけを無期限graceで停止する。
   元CloudへのSIGKILLは行わない。終了が確認できるまでコピーも再開も始めない。
   新規要求が直前に入る可能性はあるため、コピー側でもpending/holdを再確認する。
5. 停止中の2volumeから全ファイルを専用`work/copy`へコピーし、物理hashを照合する。
   元DBへCloudStoreを構築せず、コピーからだけSQLiteを開く。
   不明な永続root、symlink、2GiBの操作予算超過、必要ディスク余力不足は拒否する。
6. 成否にかかわらずコピー用コンテナを除去し、同じ元Cloudを起動してhealthを確認する。
   その後、元volumeをmountしないコンテナでコピーから暗号化する。
   元Cloudの単一環境変数 `KYALULU_CLOUD_SECRET` だけをVPS内で読み、
   検証workerの**標準入力**へ渡す。引数・ログ・一時コンテナの環境設定へ書かない。
7. 暗号文を指定PC先へ取得しSHA-256を照合。同じ暗号文をVPSの新しい
   `work/input/offsite-roundtrip.kybackup`へ戻し、再度hashを照合する。
8. 元volumeなしの独立コンテナで、新しい`work/restored`へ復元する。
   全DBのテーブル・schema（索引/トリガー/ビューを含む）・型とrowidを含む行hash、
   媒体・保持済み暗号文のhashをコピーと照合する。不一致・途中失敗したrootは採用しない。
   一致しても本番へ選択せず、元Cloudが引き続き稼働する。
9. 専用一時コンテナを除去し、元CloudとRelay/Caddyのhealth・identity、台帳集計を確認する。
   新しいコピー・暗号文・隔離復元root・検証記録はprivateな専用rootに保持する。
   本番volume、元会話、既存バックアップ、モデル、Remote鍵は削除しない。

## 障害時と資源上限

各phaseはSSHから切り離した専用systemd一時unitで実行する。
copyは240秒、archive/restoreは720秒のunit上限、停止処理に90秒の猶予を設ける。
workerにはcopy120秒、archive/restore600秒の親側上限を設ける。
`ExecStopPost`は同じ専用コードのcleanupを実行し、stop intentの元IDとwriter不在を
再照合して元Cloudを再開し、専用labelを持つ一時コンテナだけを除去する。
再試行前にunit・コンテナID・phase記録を確認し、完了したphaseを盲目的に繰り返さない。

これは無停止操作ではない。Cloud/APIは停止・コピー・再起動中に利用不能となる。
Docker/host障害やgraceful終了が完了しない場合、自動再開を保証できない。
その場合はintentを残し、強制killや別writerの起動で解決せず、状態を報告して復旧する。
同一VPSのCPU/RAM/ディスクを使う。workerはnetworkなし・メモリ256MiB・CPU25%。
データ量2GiBを操作上限とし、コピー前に総量の12倍＋1GiBの空き容量を要求する。
これは製品の保存上限ではない。予算に収まらなければ実行を止める。

master secretの別保管・紛失時回収はこの許可に含めない。
PC上の暗号文だけでは鍵を失ったVPS全損から復元できないため、その運用証拠は別途必要。
実DBでの旧schema互換、OSのreadonly mount、systemd/信号・Dockerの実挙動は未確認。
架空試験と本番試験を区別し、実行後にそれぞれの証拠を記録する。

## 配布物と準備試験

操作コード・架空試験・package manifestは非公開の
`.artifacts/unified-production-recovery-20261030/`に置く。
公開するのはコード専用packageのhash、試験の範囲・結果と制約までで、
volume名・個別行・DB指紋・台帳値・鍵・暗号文は公開しない。

ローカルで固定したコード専用package：**20,218 bytes**、SHA-256
`cafba66b016f2e76c5875469e757c72fc0815bcdec6d8ee0d7f796ad921324ba`。全4コードファイルをmanifestと照合し、
DB・metadata・鍵・作業データが入っていないことを収録一覧とhashで確認した。
配布先では固定897737fの検証済みimageの依存関係を使い、後続の修正済みadminを
このpackageから読取専用で載せる。image自体が後続adminを検証済みという意味ではない。

- 停止済み架空snapshotのstaging：50/50項目。5 DBのcommitted WAL、Community、
  両転送DB、原本の書込/SQLite接続拒否、別root復元、論理指紋を確認。
- 操作worker：13/13項目。型/rowid/索引/ビューの変化、未収録ファイル拒否、
  既存先拒否、暗号化と往復復元、別CLIプロセスでの標準入力による架空鍵授受を確認。
- 停止・再開controller：26/26項目。Dockerを呼ばない模擬状態で、RW mount拒否、
  pending/hold拒否、失敗時の元Cloud再開、未終了時のintent保持、作成記録失敗時の
  cleanup、専用labelだけの除去、鍵が引数/環境/出力に入らないことを確認。

controllerのflock・信号handler・systemd ExecStopPost・Docker restart policy・
実active generationのdrainはこの模擬試験では検証していない。
この文書の作成、コードの存在、これまでのvolume読取許可は本工程の実行許可ではない。
