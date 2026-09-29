# Android PWA implementation and release assessment

検証日: 2026-09-29 / Windows / Chromium 151 / このcheckoutの未コミット変更。

## 判定

Android優先の個人向けPWAについて、実装・ローカル自動検証・ブラウザー検証を完了。**v1.0.0の正式リリース判定は保留**。Android実機と実際のHTTPS接続経路、Gemma 4 26B no-thinkの会話品質・速度を未確認のため、パッケージのバージョンを正式版に繰り上げていない。公開・デプロイ・コミット・pushは実施していない。

単一ユーザーのRuntimeを登録済みの複数端末から使う構成。自分のクラウド上に設置できるが、マネージドクラウド・マルチテナント・サーバー間の会話／記憶同期は未実装。

## 実装

| 項目 | 内容 |
|---|---|
| PWA | Manifest、192/512px・maskableアイコン、ビルドファイルのSRIつき事前保存、インストール案内、明示的更新、複数タブ中の更新保留 |
| モバイル画面 | トーク／キャラクター／つくる／設定、安全領域、動的viewport、タッチ操作領域、IME・Enter制御、設定パネルのフォーカス制御 |
| 通信 | 同一OriginのAPIクライアント、画像・書き出しを含む接続先の統一、401で再登録、HTTPS接続先リスト |
| 認証 | 120秒・一度限りの8桁コード、試行制限、HttpOnly/Secure/SameSite Cookie、端末解除、Origin/Host検証、管理APIの拒否 |
| ホームサーバー | Desktopと独立する単一workerのHTTPS起動・登録コード発行・端末一覧／解除CLI。公開DNS証明書を検証しながらloopback管理するTLS SNI対応 |
| 会話復旧 | Origin・会話別の下書き、送信前の生成ID保存、復帰時のGET照合、自動再送なし、未確定中の変更抑止、停止時の遅延POST防止 |
| モデル | 保存済み履歴のモデルを引き継ぎ、利用不能なら送信を止める。別モデル・クラウドへの暗黙の切り替えなし |
| 永続化 | 記憶・履歴・生成結果・状態の同一トランザクション、SSE開始前を含む中断処理、生成状態取得／キャンセルAPI |
| 継続検証 | Windows/Ubuntu向けRuntime/Webワークフロー追加。リモートCIは未実行 |

## 検証中に発見して修正した問題

1. SSEヘッダー送信中の切断で予約が残り、その会話の次の生成が409になる。レスポンス全体の後始末で予約を解放。
2. 記憶保存と履歴保存の間のキャンセルで、存在しないターン由来の記憶だけが残る。同一トランザクションに統合し、切断・明示的停止との競合を試験。
3. スマホの新しいブラウザーで、PCの会話モデルから別モデルへ自動変更される。履歴のmodel_id継承と明示選択へ変更。
4. ChromiumのナビゲーションRequestにhashが残り、オフラインの `/#/profile` がキャッシュに一致しない。hashを除いてシェルを照合するよう修正。
5. APIエラーが空の会話一覧や成功扱いになる。HTTPステータスを検証し、エラーと再試行を表示。
6. 登録解除の204をJSONとして読んで失敗表示する。本文なし成功を処理。
7. リモートからsession指定なしで全履歴を削除できる／予約されたグローバル設定を書き換えられる。セッションの検証を追加。
8. 共通PWAコードをDesktopから型検査した際にVite型が不足する。共通エントリーからも解決するよう修正。
9. 会話の編集・削除などのタッチ領域が小さい。タッチ端末では44px以上、主要ボタンは48px以上に拡大。

## 実行結果

| 確認 | 結果 |
|---|---|
| `pnpm typecheck` | Web / Desktop / schemas / ui 全成功 |
| `pnpm --filter web test` | 81 passed / 11 files |
| `.venv/Scripts/python.exe -m pytest tests -q` | 208 passed、意図的に重複ZIPエントリを作る既存テストの警告1件 |
| 生成中断・永続化の回帰 | 15 passed。meta前、ヘッダー失敗、記憶保存前後、commit後、キャンセル競合、遅延POST、再起動 |
| モバイル認証・配信の最終対象テスト | 43 passed |
| 新規Pythonファイルの対象ruff | 成功 |
| Web / Desktop本番ビルド | 成功 |
| `tests/e2e_mobile.py` | 17項目成功。393px light / 360px dark / 320px light / 1280px light |
| Chromium installability | `installabilityErrors: []`。実機へのインストール成功とは別 |
| 実Service Workerの更新 | 新版検出、複数タブによる更新保留、明示的更新後の再読み込みを確認 |
| 差分確認 | `git diff --check` 成功。依存追加・lockfile変更なし |

ブラウザー検証では、端末登録／Cookie属性／管理API拒否、画面再読込後の下書き、タッチ端末のEnter改行、1組だけの履歴保存、失われたPOSTの再読込と停止による復旧、低いviewport内の送信ボタン、キャラ作成、オフラインシェル・再接続、登録失効を確認。APIがCache Storageに存在しないことも確認。

証拠はローカルの `.artifacts/mobile-v1/acceptance.json`、`installability.json`、`update-acceptance.json`、`pairing.png`、`conversation.png`、`settings.png`。試験は専用DB・Mockモデルと試験用証明書で実施し、実ユーザーの会話やモデルを使用していない。ChromiumのネットワークエミュレーションはSW経由の再読込後にnavigator.onLineが戻るため、再接続テストは表示された再試行ボタンも使用。

WebのメインJSは約623kB／gzip 191kBで、Viteの500kB警告は残る。スマホでの実測性能は未評価。Desktopはビルド・型チェックまでで、配布版実行の再検証は未実施。

## 正式版に向けて残る確認

- Android実機のホーム画面インストール、更新、Gboard、戻る操作、画面ロック、OSによるプロセス終了、文字拡大。
- 実運用の証明書・Tailscale等のネットワーク経路・Wi-Fi/モバイル回線切り替え。
- 現在利用しているGemma環境のno-think適用と設定一致、口調・記憶・速度の比較。
- 新設ワークフローのリモートCI。リリース番号・配布物・公開手順は、上記の確認後に確定。

この環境ではAndroid SDKのadbは存在するが、端末列挙が `Cannot mkdir '\\.android': Permission denied` で失敗した。実機の接続を確認できたとは扱わない。

導入方法は [Android PWAガイド](../ANDROID_PWA.md) と [ホームサーバー手順](../../scripts/HOME_SERVER.md) を参照。
