# Core復元のプロセス強制終了境界

判定: **再現したプロセス強制終了時の媒体欠落を修正し、実kill 3境界を含む66件が成功。**
共有作業ツリーの `1de2cac` / `codex/unified-app-integration` に対する未commit差分で検証した。
[条件付き承認範囲](../UNIFIED_CORE_RESTORE_REVIEW.md)に従い、架空SQLite・媒体・outbox・受領tombstone・owner対応のみを使用。
親担当による再現結果の確認後、既存の条件付き承認に基づいて製品側も修正した。
編集対象は次の4ファイルのみ。Git操作、依存・ロックファイルの変更、本番操作は行っていない。

- `runtime/python/local_backup.py`
- `tests/test_core_restore_sync.py`
- `tests/test_core_restore_interruption.py`
- `docs/validation/2026-10-31-unified-core-interruption.md`

## 修正と中断時の不変条件

旧実装の媒体ディレクトリ交換をなくした。`preserve_core_assets` は、復元DBと現在DBの
`library_assets.id` および入力媒体を、配置前にまとめて検証する。
ID形式、媒体の欠落、通常ファイル以外、symlink/ディレクトリの別パス参照、SHA-256不一致を拒否する。
既存ファイルと入力ファイルが同名の場合も、両方を検証し、現在媒体を上書きしない。

すべての検証後、現在位置に存在しない媒体だけを、完全に展開済みのファイルから同一filesystem上でrenameする。
現在媒体は移動・削除しない。その後で実SQLite backupを行い、DBをatomicに反映する。
従って媒体追加中・DBコピー途中は現在DBが必要とする媒体を保持し、DB commit後は復元DBに必要な媒体も配置済みになる。
復旧ZIPを実行しなくても、この参照整合性は保たれる。

後続エラーで追加済み媒体を削除しない。DBの成否が不確かな場合も、どちらの世代が参照していても安全な集合を保持する。
失敗したDB反映より前に追加済みの未参照媒体が残ることはあるが、元のDBと元の媒体は置換しない。
参照されないファイルは `library.read_asset` のDB確認を迂回して公開されるものではない。
journalの解釈、世代の推測、起動時の削除・再配置が不要な構成なので、`RuntimeLock` や起動処理は変更していない。
不正・矛盾した媒体の入力は、DB反映と媒体配置より前にfail closedし、元データと入力・復元前アーカイブを保持する。

承認された7条件の扱い:

1. ローカルのRuntimeLock、Cloudの既存tenant lock、独立した復元前アーカイブ生成は維持。
2. `preserve_sync` を変更せず、現在outbox本文/request ID・受領revision/deleted・ownerを保持。
3. owner衝突の拒否は媒体追加より前。現在DB・媒体を変更しない既存試験も成功。
4. 復元DBの同期停止・withdrawn・確認markerと、本文再送なしの受領照合・別コピー化を維持。
5. Cloudリンクの復元確認と新旧の削除記録の統合を維持。
6. 通常の配置/SQLite失敗時は現在DB・元媒体を保持。kill後も両DB世代の媒体を保持。
   入力ZIPと独立復元前ZIPを保持し、不確実な追加媒体も自動削除しない。
7. 台帳・認証・control DBの製品コード、無関係なデータは変更しない。Cloud試験は架空tmp_path fixtureのみ。

## 既存試験との違い

従来の `test_failed_core_promotion_keeps_db_assets_input_and_independent_recovery` は
SQLite backupのprogress callback等から例外を投げ、旧 `promote_core` の媒体rollbackを通る試験だった。
今回は実際の復元子プロセスを停止し、Pythonの例外処理・finally・TemporaryDirectory cleanupを走らせない。
実killはローカル `restore` 経路。共通promotionを使う暗号化Cloud restoreは、既存の架空Cloud試験でも別途確認した。
既存の故障注入は、新方式の媒体検証・個別rename失敗へ更新し、DB全dump・元媒体・入力・独立ZIPの保持assertionを維持した。
旧fixtureの固定 `a...a` 名を異なる本文で上書きする設定も、内容のSHA-256に一致する別々の媒体IDへ修正した。

## ハーネスと保護

- リポジトリの `.venv`（Python 3.13.5 / SQLite 3.47.1 / Windows 11 build 26200）を使用。
  入力ZIP、現在DB、媒体、復元前ZIP、復元作業ディレクトリはすべて新規pytest `tmp_path` 内。
- 実装の `restore` / `backup` / `RuntimeLock` / `Links.prepare` / `prepare_meta` を再利用。
  DBには64KiBの架空paddingを入れ、実SQLite backupを1ページずつ進める。
  テスト用Connection subclassとrename hookは停止境界だけで待機する。
  実kill fixtureにも実際の `library_assets` 参照表を置き、現在だけの媒体とアーカイブだけの媒体を別々に用意する。
- Windowsのvenv redirectorは別PIDを作るため、基底interpreterを
  `__PYVENV_LAUNCHER__` で同じvenvとして直接起動する。venv importと直接の親子PID関係を確認した。
  kill前にready markerのPID・親PID・正確なtmp_path・境界をPopen情報と照合し、保持しているプロセスhandleだけをkill/reapする。
  異常時も同じPopen情報と正確な起動パスを確認して、そのhandleのみ停止する。
  他プロセスの列挙・一括停止、process tree kill、手動の再帰削除は行わない。
- kill後は新規SQLite connectionで `integrity_check` を実行し、RuntimeLockを再取得する。
  DBが参照するcontent hashの媒体が、同じ世代の内容で存在することを整合性条件とする。

## 修正後の最終実行

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& .\.venv\Scripts\python.exe -B -m pytest -p no:cacheprovider `
  --basetemp .artifacts/core-interruption-fix-20261031-061002-db0e60a8 `
  tests/test_core_restore_interruption.py tests/test_core_restore_sync.py `
  tests/test_backup_parity.py tests/test_native_restore_fence.py `
  tests/test_cloud_parity.py `
  tests/test_cloud.py::test_tenant_isolation_sync_cas_and_backup `
  tests/test_cloud.py::test_encrypted_disaster_restore_new_environment_keeps_retained_versions `
  -q --tb=short
```

**66 passed in 33.12s、exit code 0。skip/xfailは使用していない。**
basetempは実行直前に不存在を確認。再実行時は別の未使用パスを使用すること。

| 実kill境界 | 子PID / 親PID | kill後のDB | kill後の媒体・同期状態 |
| --- | --- | --- | --- |
| `during_media`: アーカイブだけにある媒体のrename直後 | 28932 / 74376 | 現在世代、integrity ok | 両世代の媒体が存在、現在outbox・状態を保持 |
| `during_backup`: `0 < remaining < total` の成功したページstep | 24244 / 74376 | 現在世代、integrity ok | 両世代の媒体が存在、現在outbox・状態を保持 |
| `after_db_commit`: 実backup完了後、close/restore return前 | 94688 / 74376 | 古いZIPの世代、integrity ok | 両世代の媒体が存在、outbox本文/ID保持・withdrawn・同期停止・復元確認必須 |

3ケースとも、kill直後の新規DB接続で参照媒体が存在し、RuntimeLockを再取得できた。
入力ZIPと復元前ZIPの保持、元DB状態と媒体の独立ZIPへの保存、追加の明示的復旧も確認。
追加の復旧では、同じtmp_path内を指す `pc/../pc` も使用し、lexicalな別表記を誤って媒体aliasとして拒否しないことも確認した。
証拠は上記basetempの `test_killed_core_restore_keeps0`～`2` の各 `evidence.json`。
保持したPopen handleをkill/waitし、対象3 PIDの指定照会でも残存なしを確認した。

追加の7件では、入力/現在媒体のchecksum矛盾、双方の欠落、不正ID、通常ファイルでない媒体を
配置前に拒否し、DB・媒体・入力の全bytesを維持すること、および2番目の媒体配置失敗時にも
現在DB/媒体・先に追加済みの媒体・入力/復元前ZIPを保持することを確認した。
Core・Native確認/受領/別コピー化・Cloudの旧形式migration・削除の復活防止・暗号化復元・control表保持も成功。

途中の試験では追加fixtureの2件が失敗した。媒体ディレクトリ自体を通常ファイルにしたケースは
復元前backupが先に拒否するため、媒体IDが通常ファイル以外を指すケースへ修正。
独立SQLite backupのheader bytesは元ファイルと同一とは限らないため、その検証は全SQL dump比較へ修正した。
現在DBの全bytesと元媒体・入力の不変assertionは維持した。最終66件はその修正後に実行している。

## 修正前の再現記録

修正前に不合格を再現したコマンド（証拠は保持）:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'
& .\.venv\Scripts\python.exe -B -m pytest -p no:cacheprovider `
  --basetemp .artifacts/core-interruption-20261031-055801-1b5b6316 `
  tests/test_core_restore_interruption.py -q -s --tb=short
```

**1 failed, 1 passed in 2.16s、exit code 1。**
当時の失敗はskip/xfailに変えず、その参照整合性assertionを維持して製品修正後に成功させた。
再実行時は別の未使用basetempを指定すること。残した今回の証拠ディレクトリを再利用しない。

| 停止点 | 検証した実子PID / 親PID | kill後のDB | kill後の媒体 | 結果 |
| --- | --- | --- | --- | --- |
| `during_backup`: 媒体入替後、実backupの成功したページstepで `0 < remaining < total` | 111892 / 104160 | 現在世代、integrity ok | 古いZIPの世代のみ。現在DBの参照するhashが存在しない | 整合性assertion失敗 |
| `after_db_commit`: 実backup完了直後、Connection close・restore returnより前 | 54424 / 104160 | 古いZIPの世代、integrity ok | 同じ古い世代 | 成功 |

各ケースの `evidence.json` は次の場所に保持した:

- `.artifacts/core-interruption-20261031-055801-1b5b6316/test_killed_core_restore_keeps0/evidence.json`
- `.artifacts/core-interruption-20261031-055801-1b5b6316/test_killed_core_restore_keeps1/evidence.json`

両ケースで以下は整合性assertionより先に成功した:

- 現在のoutbox本文・request ID、受領revision 7 / deleted 1、現在のみ存在するowner対応が保持される。
  commit前は現在のoutboxのまま、commit後は同じ本文・IDでwithdrawnになり、同期停止と復元確認markerが存在する。
- 入力ZIPの全bytesが不変。独立した復元前ZIPが1つ残り、そのDB状態と媒体が復元前と一致する。
- 残った復元前ZIPを入力として通常の `restore` を明示実行すると、現在世代のDB・媒体へ復旧できる。
  outboxは本文・IDを保持してwithdrawn、同期は停止、復元確認必須、受領tombstoneとowner対応も保持される。
  この復旧で新しい独立復元前ZIPも生成され、元の入力と最初の復元前ZIPは不変。
- killした子の終了をwaitし、RuntimeLockを取得し直せる。試験後の対象PIDの指定照会でも残存なし。

初回実行はvenv redirectorの親PIDと実interpreter PIDの不一致を安全確認で検知し、製品合否の前に2件失敗した。
親側pipeの終了により待機中interpreterも終了し、当該2 PID（33536、101668）の指定照会で残存なしを確認。
redirectorを避ける修正後に、上記の新しいbasetempで最終実行した。初回結果は製品不合格の証拠に数えない。

## 原因とレビュー範囲

旧 `promote_core` は現在媒体を `previous-assets` へrenameし、復元媒体を有効位置へrenameしてから、
SQLite backupでDBを反映する。この間にprocess killすると媒体rollbackを行うPython例外処理を通らず、
SQLiteが現在DBを維持しても媒体は古い世代になる。
今回このディレクトリ交換をなくし、両世代を支える媒体の集合を維持した。
既存の独立ZIPは引き続き復旧手段として保持するが、今回のkill整合性を手動ZIP復旧に依存させていない。
親担当の差分レビュー後、追加変更なしで新規10件を再実行し、3.50秒・exit 0で成功した。
証拠は `.artifacts/core-interruption-parent-final.log` と `.artifacts/core-interruption-parent-final/` に保持する。
対応ソースへの新旧Core試験とNative fixture helperの収録も追加し、fixture/helper closure3件が成功した。
旧版で既に起きた媒体欠落を、作業ディレクトリ名から推測して自動修復する処理は追加していない。

電源断、OS障害、filesystem flush/fsync、hot-journalの物理書込みや破損、全killタイミング、
Cloud経路への実kill、実symlink/junctionの拒否、実容量、配布実機、本番復旧は検証していない。
プロセスkillで示した結果を、電源断・filesystem耐久性や統合計画全体の合格と解釈しない。
不要になった媒体を復元時に自動削除しないため、使用容量が増えることがある。
Web全体試験・ブラウザ再試験・CI監視は親担当の別作業で、この担当では実施していない。
