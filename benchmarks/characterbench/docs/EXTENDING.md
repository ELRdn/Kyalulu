# 拡張ガイド

## 自分の問題集を作る

`data/characters.json` と `data/cases.jsonl` を別フォルダーへコピーして編集します。比較に使った既存run内のsnapshotは書き換えません。新版として `--dataset` を使います。

```console
python -m kcb validate --dataset my-data
python -m kcb run --config configs/lmstudio.json --dataset my-data --suite all --out runs/custom-pilot
```

自然文unitの形は以下です。説明のため改行していますが、JSONLでは1unitを1行にしてください。`character_id` はcardsに存在するIDです。

```json
{
  "id": "custom-c01-persona-01",
  "character_id": "c01",
  "mode": "natural",
  "family": "persona",
  "turns": [{
    "user": "展示の準備を手伝いたいんだけど、何か任せてもらえる？",
    "eval": {
      "checks": [{"type":"nonempty"},{"type":"max_chars","value":600},{"type":"no_headings"}],
      "dimensions": ["persona","japanese"],
      "notes": "他人に負担をかけたくない傾向と、適切に一部を頼む行動の両方を許容する。特定の一文を唯一の正解にしない。"
    }
  }]
}
```

カードの必須キーは `id/name/role/speech/traits/behavior_range`。実際の公開カードには `setting/age_group/preferences/knowledge_boundary/scope` もあります。candidate promptに入るフィールドは `kcb/protocol.py` の明示allowlistだけです。`eval` は候補へ渡りません。

診断unitは `mode: diagnostic`、1turn、少なくとも `json_exact` checkerを持ちます。checkerの `expected` を厳密に指定し、任意で同じ内容を `gold` に保存します。例 `{"type":"json_exact","expected":{"location":"机","holder":null}}`。検証前に曖昧な所有権や暗黙の移動をgoldへ入れないでください。

対話unitは `mode: dialogue` と複数turns。v0.1付属データは12ターンですが、loaderはそれ以外の長さも扱います。独自長さを使った結果は付属v0.1スコアと同条件とは呼びません。

## 採点者を変える

`kcb/judging.py` の `RUBRICS` とsystem promptを変更したらjudge versionを更新してください。rubric/設定/promptのhashでjudge IDが変わります。旧judgeと新judgeを同じ妥当性の採点者と自動的に扱わないでください。

新しいdimensionはdatasetの `DIMENSIONS` とjudgeの `RUBRICS` の両方に定義し、必要なpytestではなくstdlib unittestを追加します。模範回答との単純類似度だけで自然さを決める拡張は推奨しません。

## 接続とサンプリング

provider追加時は `Generation` を返します。`text`、`latency_seconds` は必須。TTFTやusageがなければnull。hidden reasoningは保存せず文字数だけ。ネットワーク許可、認証をenvから取得、HTTPリダイレクト拒否、サイズ上限、明示timeoutを維持します。

`extra_body` はサーバー固有パラメーターを記録して送るためのもので、対応を保証しません。設定が非対応ならエラーを報告し、黙って別の条件で再送しません。core trackに外部メモリを追加せずsystemへ分けます。

## 改変後の確認

```console
python -m kcb validate
python -m kcb selftest
python -m kcb demo --suite smoke --out runs/after-change
```

付属テストには件数やオリジナルカードの不変条件があります。付属データを書き換えればそのテストが失敗するのは自然です。独自データは別フォルダーへ置くと、ツール自体の回帰テストを維持できます。
