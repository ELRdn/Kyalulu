# ロードマップ追加実装・検証記録

確認日: 2026-09-26 / Windows / Kyalulu開発checkout

## 到達点

Kyalulu内で進められるM8、Phase 1、Phase 2、Phase 3の機能を追加し、既存の未コミット実装も含めて検証・修正した。Phase全体の品質受け入れ、LE本体の拡張、配布版完成を意味しない。既存の変更を保持し、commit/pushは行っていない。

| 範囲 | 実装・修正 | 主なファイル |
|---|---|---|
| Desktop | Python APIの起動・終了・所有判定・起動中の終了、LE監督の競合修正、Web共通Router/Theme、CJS preload、appプロトコルでAPI/SSEを中継 | `apps/desktop/src/main/{api,le,protocol,index}.ts`、`electron.vite.config.ts` |
| 診断 | DB/Provider/LE/配信モデルの診断、モデル未準備時の案内、ローカルモデル一覧に基づく選択、信頼するOriginの共通化 | `runtime/python/api/{diagnostics,origins,providers}.py`、`apps/web/src/lib/models.ts` |
| Memory Lab | 3種の記憶、操作履歴・由来・版、追加/訂正/削除/検索/注入、会話間の復元、Inspector、根拠未確認の記憶の注入防止 | `runtime/python/{core/memory,storage/memories,api/memory}.py`、`MemoryPanel.tsx`、`MemoryInspector.tsx` |
| 比較実験 | 4キャラ×30/50/100ターン、最大3モデル×3反復、同一シードのMemory比較、検索条件/履歴制限の保存・再実行、中止/期限/途中保存/export | `runtime/python/{core/benchmark,api/benchmarks}.py`、`BenchmarkLab.tsx`、`scripts/run_benchmark.py` |
| Creator | Persona/Worldの作成/編集/JSON入出力、不変の版、編集競合、既存会話の版固定 | `runtime/python/{storage/creator,api/creator}.py`、`CreatorSettings.tsx` |
| 物語操作 | 人物像・舞台・場面・目標・ペースの会話設定、既存の追加指示と文体を維持、人物像の再開時継承 | `ActiveChat.tsx`、`StoryControls.tsx`、`lib/story.ts` |
| プロンプト | 任意のWorldにも固定で獣人設定が混入する問題、キャラ未指定時の空の名前を修正。`prompt:character-runtime@0.1.4` | `prompts/kyalulu_base.md`、`core/prompt_compiler.py` |
| 計測・再現性 | 返答開始median/p95、初回検証成功率、再試行、tok/s、推定prompt peak、検索の同点順位固定・上限付きbigramキャッシュ | `core/{metrics,experiment,memory}.py`、`scripts/compare_le_direct.py` |

## 自動試験

| コマンド / 検証 | 結果 |
|---|---|
| `.venv/Scripts/python.exe -m pytest -q` | **150 passed**。19.88秒。重複ZIPエントリを作る攻撃入力試験の警告1件のみ |
| `pnpm --filter web test` | **25 passed / 7 files** |
| `pnpm typecheck` | Web / Desktop / schemas / ui 全て成功 |
| `pnpm build` | schemas / Web / Desktop 成功 |
| `node --test scripts/test_desktop_supervision.cjs` | **4 passed**。LEの同時起動・起動中終了・外部プロセス保護・spawn失敗。模擬プロセスを使用 |
| `node scripts/verify_desktop.cjs` | 最終ビルドの実Electronで成功。専用API8018番、専用profile/DBを使用し、最後に所有APIを停止 |
| `git -c core.safecrlf=false diff --check` | 成功。Windowsの既存改行設定を維持 |

Webの最大chunkは593.47KB（gzip 181.36KB）。500KB超のVite警告は残る。新画面は遅延読み込みしているが、共通チャット部分の分割・実ロード時間の最適化は後続。

Electron実行ファイルが依存ディレクトリに欠けていたため、既存33.4.11の公式配布キャッシュを同梱チェックサムとZIP CRCで検証して展開した。依存定義・lockfileは変更していない。隔離環境でのGPU子プロセス起動失敗は通常のWindows権限での検証に切り替えたところ解消した。アプリのsandbox設定は維持している。

## 実Electronで確認した内容

- APIのヘルス確認前に終了しても後からプロセスを起動しない。
- 同時・繰り返し起動でAPIの所有権を失わない。
- Memoryの保存 → 所有API停止 → 再起動 → 同じ記憶の復元。
- ビルド済みrendererの`app://kyalulu/index.html#/status`、CJS preload、IPC。
- 相対`/api/health`と`/api/chat/stream`を中継し、Mockの`event: done`まで受信。
- 所有APIを停止でき、別途起動済みの外部APIは終了させない。

証跡: `.artifacts/roadmap-20260926-cyan/desktop/result.json`、`desktop/status.png`。
この試験はAPIプロセスの再起動であり、Windows自体の再起動や配布インストーラーの試験ではない。LE本体の実プロセスは今回起動していない。

## Webでの操作確認

専用API8017番、専用Vite5193番、専用DB/実験フォルダでIn-app Browserを使用した。

- ペルソナ「検証用の旅人」の作成 → 版2へ編集 → ページを開き直して内容・版履歴を復元。
- 世界観「雨音の図書館」を作成し、会話の人物像・舞台として選択。
- 場面・目標・ペースの反映、手動記憶の追加・訂正・オン設定、再読み込み後の復元。
- Mock応答に保存した記憶が反映され、Memory Inspectorに版2・由来・注入・推定量・検索時間を表示。
- 画面から8ターン×Memoryオン/オフを実行し、2条件の完了結果を表示。
- 100ターン×3反復×2条件のジョブを開始して中止。オフ100ターンとオンの途中結果を保存・表示。途中結果は中止として扱い、600ターン完走に数えない。
- 390px幅のCreator・比較画面、通常幅のCreator・会話・Inspector、ライト/ダークの表示を確認。コンソールerrorなし。全既存画面の総当たり受け入れではない。

操作中の日本語入力やポインター操作が自動操作経由で不安定な箇所は、画面を再確認し、選択・貼り付け・キーボード操作で入力結果を確認した。入力内容・保存後の復元・API結果を根拠としている。

主な画面証跡:

- `.artifacts/roadmap-20260926-cyan/creator-light.png`
- `.artifacts/roadmap-20260926-cyan/chat-settings-light.png`
- `.artifacts/roadmap-20260926-cyan/memory-inspector-dark.png`
- `.artifacts/roadmap-20260926-cyan/benchmark-cancel-dark.png`

## Mock長ターン

`advanced_mocha_sfw_30`、`advanced_senior_cool_50`、`advanced_librarian_sfw_100`を各Memoryオフ/オンで実行。**6 runs / 360 turns**が完走し、全360ターンで初回構造化検証に成功した。

証跡: `.artifacts/roadmap-20260926-cyan/suite-experiments/_benchmarks/536c8e30-906d-4642-a88d-de742ad510c7.json`。
Mockは永続化・制御・比較経路の確認用であり、モデルの会話品質や長文脈性能の根拠にはしない。

## Qwen3.5 9Bの短期比較

Ollamaに既に存在する`qwen3.5:9b`を直結で使用した。モデル追加ダウンロードや外部API推論は行っていない。
シナリオ`mocha_memory_001`、seed 42、temperature 0.8、top_p 0.9、think=false、num_ctx=8192、max_tokens=1024。5ターン目に会話履歴とStateをリセットし、実験専用Memoryだけを引き継ぐ。

| 指標 | Memoryオフ | Memoryオン |
|---|---:|---:|
| 完了ターン | 8/8 | 8/8 |
| 初回構造化成功 | 8/8 | 8/8 |
| 再試行 | 0 | 0 |
| キーワード想起 | 0/3 | 2/3 |
| 返答開始中央値 | 2.608秒 | 3.445秒 |
| 返答開始p95 | 21.593秒 | 5.264秒 |
| 平均全体時間 | 26.050秒 | 23.758秒 |
| tok/s中央値 | 9.525 | 10.755 |
| 推定prompt最大 | 3564 | 4366 |

tok/sは最終試行のprefillを含む時間から算出し、純粋なdecode速度ではない。実行順はオフ→オンの1組だけでウォームアップの影響があるため、速度の優劣・一般的なMemory改善率とは解釈しない。GPU配置はOllama側の設定のままで、VRAMは未測定。RAMはPythonプロセスRSSのみ。

オン条件では3件の記憶を保存し、1件を根拠未確認として注入から除外。お菓子の好みと犬の名前は想起したが、水族館の約束は保存されず、想起できなかった。最後には会話で伝えていない映画『星空を泳ぐ』を記憶として語った。禁止語リストにない表現のため自動`hallucinated`は0のまま。**禁止語一致0は虚偽想起なしを意味しない。** この観測は人手確認として記録し、スコアを良く見せるためのシナリオ変更はしていない。

証跡:

- オフ: `real-experiments/94df0e9b-d7a8-45d5-903a-629b8a2196c0`、`qwen-memory-off.json`
- オン: `real-experiments/705f1096-3586-4cda-86da-c91e7a1f60c5`、`qwen-memory-on.json`
- 初回1ターン: `real-experiments/2eac4f21-9984-42bb-b9b0-7bf537cc5b83`（表示開始15.350秒、全体18.888秒、再試行0）

上記パスの基点は`.artifacts/roadmap-20260926-cyan/`。実測のcompiled snapshotはprompt 0.1.3。後から修正したテンプレート0.1.4は自動試験で確認しており、この旧snapshotの実測を新テンプレートの品質評価に転用しない。

## 残る作業と実行境界

1. **Phase 0正式受け入れ**：3ローカルモデルの選定・共通条件・20ターン×3回、実モデルの30/50/100ターン、人手品質、推論サーバーRAM/VRAMの実測。
2. **Memory品質**：約束の未保存、虚偽想起、好み訂正時の古い記憶、意味の評価、忘却/重要度。根拠判定は文字一致による推定。
3. **LE本体**：自動GPU配置・GPU選択・HTTP Range再開はLEリポジトリ側で実装・試験済み（別リポジトリのため本記録の対象外）。直結/LE比較は5ターンの短期比較のみで、20ターン×3回の正式比較は未実施。ComfyUI・音声・ツールは未着手。
4. **配布**：Python/LE同梱、インストーラー、Windows再起動後の履歴/ライブラリ全体の復元。開発checkoutでの成功とは分ける。
5. **後続Phase**：共通chunk分割、計測に基づく最適化・ネイティブ化、外部アプリでの互換確認、学習用データと評価条件を定めたSFT/選好最適化。学習は実行していない。

既存利用者の8000/5173番などは操作せず、検証用プロセスとデータだけを使用した。データの破壊的移行・削除、公開、Git状態の変更は行っていない。
