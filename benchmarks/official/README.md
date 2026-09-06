# Official SFW Benchmark

2026-09-06: 実装済み。以下3シナリオをMockで各20ターン×3回実行し、計180ターンの構造化検証・保存に合格。

| 難度 | 公式キャラ | シナリオ |
|---|---|---|
| easy | mocha_sfw（モカちゃん・日常） | mocha_daily_001 v0.2.0 |
| medium | senior_cool（レイ先輩） | senior_daily_001 |
| hard | butler（シオン執事） | butler_daily_001 |

正本は `characters/*.yaml` / `scenarios/*.yaml`。キャラの `official: true` とRunnerの正本照合で識別する。
mochaの既存成人向け設定は保持し、公式キャラとは分ける。旧SFW文体の成人向け例文は
`prompts/Zeta-style-skill_legacy_NSFW.md` に保持し、公式プロンプトから除外する。

```powershell
uv run --directory runtime python -m python.cli.run --scenario mocha_daily_001 --model mock-echo --runs 3 --seed 42
```

CLIの `--nsfw`、APIの `allow_nsfw: true`、Research UIのNSFWチェックで成人向け実験の実行許可をそろえる。
SFWと表示したカスタムシナリオでも、キャラがNSFWならNSFWとして扱う。

実験ファイルとSQLiteのHuman評価を保存。exportは評価を含むJSON、replayは保存済みプロンプト・シナリオ・モデル設定を使用する。
接続URLや認証情報はエクスポートせず、replay時に現在のローカル接続設定を使う。
旧実験は閲覧可能。設定スナップショットのない旧実験のreplayは409で説明する。

invalid/failed/cancelledは失敗集計に残し、品質順位から除外する。
Mockは公式ランキングから除外。Human評価と自動指標は別項目で表示する。
自動指標は失敗率・反復率による参考式であり、Human品質評価の代替ではない。

Gemma 4 / RX7600 Vulkanの構造化1ターンは合格。20ターン実モデル評価・仕様94章の3モデル比較は未完了。
[受け入れ結果](../../docs/PHASE0_ACCEPTANCE.md)を参照。
