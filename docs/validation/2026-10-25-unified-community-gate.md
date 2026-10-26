# 統合版の未完成審査経路を旧Communityから迂回させない

統合版のpublicationは私的審査キューまでで、公開API・通報後の非表示・異議申立ては
未完成。一方、従来のCommunityは別の承認フラグで直接公開できるため、両方のフラグが
有効な場合に統合版の年齢・審査条件を迂回しないよう、統合フラグ有効時は旧Communityの
公開/読取り/操作を閉じる。capabilitiesもcommunity=falseを返す。

既存Community DBの作品・コメント・通報・関係は削除しない。統合フラグを有効化した
環境では503になるため、旧投稿が一時的に表示されなくなる。統合審査API完成前に
community承認フラグだけで再公開しない。統合フラグ無効の従来の受付条件は維持する。
本番フラグやDBには操作していない。

## 隔離検証

- `test_cloud_guest.py`、`test_community_parity.py`、`test_unified_app.py`: **53 passed**。
  匿名/ログイン済みの両方で、legacyの一覧・検索・詳細・コメント・作者を拒否し、
  ログイン済みでも旧APIへの投稿を拒否。元の作品rowが残ることを確認。
  `.artifacts/unified-community-closure.xml`。
- 旧Cloud投稿・コメント再送の単独回帰試験: **1 passed**。
  `.artifacts/unified-community-legacy.xml`。統合フラグ無効の既存経路の回帰を確認する。
- 全て架空のSQLite・セッションとMockTransport。外部提供元や本番公開の証拠ではない。

公開moderation/report/hide/appealと画像/共有リンクへの制限は引き続き未完了であり、
この閉鎖を全体機能の完成とは扱わない。
