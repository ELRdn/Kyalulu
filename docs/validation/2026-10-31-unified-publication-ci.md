# Publication E2E: 遷移元のカードによる基準値の先取り

2026-10-31。対象は `381d1a9` の push Ubuntu job `124495905581`。
結論は **fixture の待機条件の競合**。好み変更による製品の再取得は今回の検証では発生していない。
変更したソースは `tests/e2e_publications.py` と本書だけ。製品・HTML fixture・CI設定は変更していない。

## 元の失敗と製品側の確認

保存済みの公開ログ `.artifacts/ci-381d1a9-push-ubuntu-job.log` は、
`2026-10-31T09:07:42Z` に旧198行目の
`assert len(catalog_reads) == reads, 'Preference changes must not refetch public works'`
で失敗している。同一ソースのPR Ubuntu成功は依頼時の情報であり、この作業ではCIへ照会していない。

必要な呼び出し元を読んだ結果:

- `Publications.browser-fixture.tsx` は実コンポーネントを StrictMode / MemoryRouter でmountし、`go` は `useNavigate()` の関数。呼び出しの終了はDOMのcommit完了を保証しない。
- `pages/Published.tsx` の取得effectは検索語・タグ・区分・作者・再読込・言語に依存する。
- `components/CommunityWorks.tsx` の取得effectはcapabilities・検索語・タグ・再読込・言語に依存する。`useCapabilities()` は接続scopeと再読込に依存する。
- 両画面とも初回のworks GETを250msのタイマーから開始する。mood / favorite / dismissedは取得effectの依存ではなく、`recommend()` が取得済み配列を並べ替え・除外する。
- `savePreferences()` はlocalStorageと通知を更新する。`publicationScope()` は接続・cloud epoch・ownerから作られ、今回の好み変更では変化しない。`fetchPublishedWorks()` / transportの実GETも確認した。

旧テストは `/published` → `/recommendations` の後、両画面に存在する
`School suggestion` だけを待っていた。遷移元のカードでこの条件を満たすと、遷移先の
**初回GETより前**の読み取り数を基準値にできる。そのGETが好み変更中に到着すると、再取得と誤判定する。

## 実ブラウザで固定した因果順序

既存ドライバをメモリ内でinstrumentし、ファイルには保存せず実行した。
brokerの `api.request()` 後、`route.fulfill()` 前に `asyncio.Event` の到着通知と解放待ちを入れた。
保持対象は実ASGIが返したcatalog応答で、body・status・GETカウンターは変更せず、最終的に同じ応答を配信した。
同期計測にsleep・再試行・追加の取得・タイムアウト延長を加えていない（既存の起動待ちとmoderation応答待ちは変更なし）。Event到着待ちは5秒でfailする。

最初の計測では、実際の `window.__go('/recommendations')` と同一のJS呼び出し内で直後のDOMを読んだ:

```text
AFTER_NATIVE_NAVIGATE_RETURN
  school=true, oldHeading=true, newHeading=false, reads=6
NEW_RESPONSE_HELD
  before=6, now=7, school_count=0
NEW_RESPONSE_RENDERED_OLD_BASELINE_WOULD_FAIL
  old_baseline=6, reads=7
```

旧画面の見出しは `Approved works`、新画面は `Public works`。
旧カードが遷移呼び出し直後にも存在し、新画面の本物の初回GETだけで6→7になることを確認した。
これは旧基準値が誤判定できる順序の固定であり、元のUbuntu失敗を同じ実行履歴で再生したという意味ではない。

## 最小修正と最終ソースの検証

遷移先固有の見出しを待ち、その後に既存のカード表示を待つ。
この2条件で、遷移先のcommitとcatalog応答の描画を確認してから基準値を取る。
さらに基準値が遷移前の読み取り数より増えていることをassertする。
最後の **再取得禁止assertはそのまま**。カウンターをリセット・除外したり、製品のGETを抑制したりしない。

通常の最終ソースを次のコマンドで実行し、終了コード0:

```powershell
.venv/Scripts/python.exe -u -B tests/e2e_publications.py
```

Windows / Python 3.13.5 / Playwright 1.62.0 / httpx 0.28.1。
既存Chromiumと所有するloopback Vite、架空ユーザー・一時DB・in-process ASGIを使用した。
通常sandboxではPlaywright起動が停止したため、実ドライバは承認レビュー経由の実行環境で起動した。
起動診断と停止していた自分のPythonのみ識別して終了し、他のエージェントのプロセスには触れていない。

最終ソースにも同じEvent応答barrierをメモリ内で追加し、両遷移で基準値取得前の状態を確認した:

| 画面 | 遷移前GET数 | 応答保持中のGET数 | 保持中に基準値取得済みか | 描画後の基準値 | 好み変更後 |
| --- | ---: | ---: | --- | ---: | ---: |
| `/published` | 5 | 6 | false | 6 | 6 |
| `/recommendations` | 6 | 7 | false | 7 | 7 |

応答保持中には遷移先の見出しが表示され、カード数は0だった。
解放・描画後にmood、favorite、dismiss、dismiss解除をそれぞれ実行し、実GET数が増えなかった。
通常実行・barrier計測とも全フローが `passed=1, catalog_reads=10, writes=8` で終了した。
pageerror・遮断された外部要求はともに0。成人区分の分離、通報・非表示・異議申立て、owner分離、guest操作とreloadの既存チェックも通過した。

確認した `Published.tsx`、`CommunityWorks.tsx`、`Publications.browser-fixture.tsx`、
`publications.ts`、`capabilities.ts`、`tests/fixtures/publications.html` の6ファイルは、前後のSHA-256が一致した。
Git操作・CIの取消/再起動・provider・外部本番への操作は行っていない。実行生成物は既存ドライバの `.artifacts/publication-browser/` に出力された。

## 限界

- 元のCIログにはroute/requestの時系列traceがなく、元のUbuntu実行でどの時点に基準値を取ったかまでは復元できない。未修正ソースの通常ローカル実行も1回成功しており、常時失敗する問題ではない。
- 今回はWindows上の実Chromiumで検証した。修正後のUbuntu CIは未実行で、CI全体の成功・本番検証・リリース受入を意味しない。
- 好み変更後の観測範囲は既存E2Eの4操作とUI反映まで。任意の長時間後の通信まで無期限に否定する検証ではない。
- generation persistenceや他エージェントの変更を含む広域テスト・source fingerprint driverは実行していない。publicationの限定修正であり、その作業の受入結果とは独立している。
