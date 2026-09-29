# 公開PWA・自宅Hostの接続確認（2026-09-29）

## 現在の到達点

Android実機での確認を始められる状態。v1.0.0のリリース合格ではない。

- PWA: https://app.kyalulu.com （Cloudflare Pages `kyalulu`、Direct Upload）
- Relay: https://relay.kyalulu.com （ConoHa、既存Caddy＋Relay）
- PC登録画面: http://127.0.0.1:5173/#/profile
- 自宅Host: 127.0.0.1:8766。既存 `runtime/data.db` をバックアップ後に採用。
- 会話・記憶・モデル・Host秘密鍵は自宅PCに保持。クラウドへのDB移動なし。
- Host鍵はDPAPI vault。登録秘密・認証情報を公開成果物に含めていない。
- Cloudflare zone RUMを無効化。ブラウザのHTML要求でも外部解析スクリプトなし。

## 今回の修正

1. LM Studio providerが `reasoning_effort` を無視していたため、許可値を検証して送信。
2. `models/gemma4-home.yaml` を追加。既存会話のモデルは自動変更しない。
3. Pagesの `/index.html` → `/` リダイレクトでSWの保存が失敗したため、
   HTMLを直接スコープルートから取得。SRIとリダイレクト拒否は維持。

## 検証済み

- providerテスト27件、PWA lifecycle/privacyテスト7件、TypeScript検査・本番ビルド成功。
- 公開HTTPSへモバイル寸法のChromiumからアクセス。
- QR相当の登録リンクの秘密をURLから除去、Noise登録、PC確認コード承認。
- 暗号化された会話一覧取得、IndexedDB登録保持、再読込後の相互認証接続。
- SW稼働、公開資材24件の保存、APIレスポンスのCache Storage保存なし。
- 外部scriptなし、厳格CSP、pageerror 0。一時検証端末は失効済み。
- 証跡: `.artifacts/conoha/published-app-smoke.json`。
- LM Studioの短い実推論成功。キャラ設定を通したRuntime生成も完了（保存なしの試験）。

## PCモデルと起動状態

LM Studio上の `kyalulu-gemma4-home` を利用。Gemma 4 26B A4B Q4_K_M、
RX 9070 XT Vulkan、GPU offload 60%、iGPU無効、context 8192、reasoning_effort none。
LEはofflineであり、現在の動作確認はLM Studio providerによるもの。
Hostとローカル登録用Web UIは独立した非表示プロセスで起動中。
Windowsログオン時の自動起動は未設定。PC再起動後の自動復旧は保証しない。

## ひろなおの実機確認手順

1. PC登録画面の「スマホを登録する」を押す（QRは短時間で失効）。
2. Android ChromeでQRを読み、端末名を入力して登録。
3. スマホに出た確認コードをPCへ入力して承認。
4. 「会話を開く」からキャラと会話を選び、必要に応じて
   「Gemma 4 26B A4B · 自宅PC（思考なし）」を選択する。
5. Chromeの「アプリをインストール」または「ホーム画面に追加」を使用。

PC・Host・LM Studioを稼働させたまま確認する。スリープ中は接続できない。
Android実機、画面ロック／回線切替、実会話の保存と記憶更新比較、暗号／認可レビュー、
24時間試験・10所有者負荷試験などのリリースゲートは別途完了が必要。
