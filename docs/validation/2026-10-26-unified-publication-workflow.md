# 固定公開版・人手審査・通報・異議申立て

対象は統合版の公開作品APIと共通画面。旧Communityとは別に、既存の
`app_publications`を正本として使う。既存の会話・原本・残高・台帳は書き換えない。
本番フラグ、契約、実際の年齢確認結果を設定した証拠ではない。

## 実装と境界

- 投稿時に公開用項目だけを型検査して固定する。名前、公開キャラ設定、挨拶、会話例、
  タグ、作者コメント、話し方と公開名を対象にし、私的なpreset・会話・記憶・原本・媒体を
  送らない。クライアントとサーバーの両方で絞り込み、SHA-256を保持する。
- 保存元のitem/revisionは本人向けの出典情報。公開版の内容・hashは固定し、審査revisionを
  別に進める。保存元IDは外部Runtimeからの申告であり、そのRuntimeの所有権や作者権利を
  サーバーが証明する署名ではない。
- 新規投稿はpending。自動分類は未接続なので全件unknownとし、人手審査を必要とする。
  moderator allowlist、全公開項目/作者名の確認、禁止内容なし、区分確認の明示的なチェックと
  理由を承認条件にする。snapshot hash、判断、担当者、revisionを同じtransactionで記録する。
  判定APIの本番精度・運用審査能力を証明したものではない。
- 旧キューのapproved値だけでは公開しない。現revisionに対応する承認記録とhashが必要。
  古い形式が現在の公開型と異なる場合は再送を案内し、元rowを保持する。
- 公開APIは承認状態・区分・双方の作者ブロックを絞ってから検索/タグ条件へ進む。
  共通UIの推薦は公開タグ・好み・お気に入り・興味なしを使い、会話本文は分析しない。
- 匿名の一般閲覧にはサーバー発行の地域/年齢ticketが必要。成人区分はlogin、現在の地域に
  合う有効な確認結果、成人age band、別途の有効化を毎回確認する。一般一覧には含めず、
  専用区分と共有URLにも同じ制限をかける。public APIはno-store。
- 公開媒体は未接続。画像URL/asset IDを公開snapshotへ出さず、挨拶内のHTMLや外部画像も
  画面で解釈・取得しない。成人区分は広告付きの一般探索とは別の`/published`画面にする。
- 通報と異議申立ては対象revisionを照合し、同じ内容の再送は同じ記録を返す。
  不一致は409。非表示と再承認は人の判断を必要とし、異議申立てだけで公開を復活させない。
  取り下げはsoft stateで記録し、moderatorによる復活を拒否する。
- 同じ保存元・固定版・hashの同時送信/再読込後の再送は既存の投稿を返す。
  rejected/hiddenを新しいrequest IDで迂回しない。明示的に取り下げた版の再送は新規pending。
- 公開先アカウントを審査画面・送信前確認に表示する。変更操作はそのownerをheaderで指定し、
  cookieが別アカウントへ変わった場合はサーバーが拒否する。遅延したJSONもidentity/targetを
  照合する。Cloudへの401でPCのpairingを失効させない。
- `publication_review`と`publications`は別capability。公開には統合/法的/Community承認が
  必要で、未承認環境は閉じる。旧Communityのread/write閉鎖も継続する。

## 検証

- フロント全体: **590 passed / 46 files**。typed snapshot、公開前の私的項目除去、地域proof、
  account/target/epoch変更、API error codeの保持、PC/device/local認証とCloud認証の分離を含む。
- Python対象集合: **64 passed**。
  `tests/test_publication_workflow.py tests/test_unified_app.py tests/test_cloud_guest.py tests/test_community_parity.py`。
  `.artifacts/publication-workflow-verified.xml`。同時再送・hash固定、非公開、権限・チェック欠落、
  競合、通報/非表示/異議/再承認、成人別有効化・期限切れ、地域proof、旧row/残高保持を確認。
- 実Chromium+ASGI fixture: **1 workflow passed**。
  投稿→保留→承認→通報→非表示→異議申立て→再承認→作者ブロックを実際の画面とDBで照合。
  adult sectionの未確認拒否、有効化後の閲覧、確認期限切れ後の共有URL拒否も確認する。
  投稿requestに私的情報がないこと、HTML画像を取得しないこと、日英、393px/lightと
  1280px/darkの横overflowなしを確認。`.artifacts/publication-browser/results.json`と画像を保存。
- UI fixtureはloopbackのViteとin-process ASGI間をbrokerで接続し、架空のセッションを使う。
  brokerはHost/Originとfixture cookieをテスト用に写像する。実OAuth、TLS、`__Host-` cookie、
  本番ドメインの証拠ではない。外部提供元呼出しと外部画像通信は禁止した。
- workspace型検査とApp/Desktop build成功。既存のWASM/chunk-size警告あり。
  CIには新workflowを追加した。先行head `1d270ee`のWindows/Linuxは成功確認済みだが、
  その結果を今回の変更後のCI成功とは扱わない。

## 復旧・残件

- 追加したsource/request/event/report/appeal/block/consentテーブルと索引は追加的な変更。
  rollbackのために削除・再seedしない。control.db、旧community.db、tenant DBと対応する
  backupを一緒に保持する。旧Communityを開く版へ戻す場合もCommunity承認フラグを閉じ、
  未審査の旧作品が出ないことを確認する。
- 旧形式のrowは保持し、必要な場合は作者がLibraryから新しい固定版を明示送信する。
  元publicationsと旧Community間の本番全件移行・復旧は未検証。
- moderation queueは先にpending/現revisionへのappealを返す100件、公開一覧は先行filter後
  の500件まで。投稿20件/時、通報5件/分。運用規模、queue pagination、ブロック解除のUI、
  通報者への処理通知、完全なIME/アクセシビリティ、端末実機は未受け入れ。
- 自動分類/公開画像の契約済みadapterと品質検証、年齢/保護者確認の本番adapter、地域条件、
  審査担当者の運用承認が残る。成人生成/同期の閉鎖を解除していない。
- 今回は本番公開・DNS・残高変更を行っていない。全体の完成条件は`UNIFIED_DELIVERY.md`で追う。
