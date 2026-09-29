from __future__ import annotations
import html
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from .stats import cluster_estimate, diagnostic_macro, percentile
from .util import load_json, read_jsonl, save_json, safe_csv

CSS = """
:root{--ink:#192235;--muted:#647089;--line:#e2e6ee;--brand:#6847bc;--paper:#f5f6fa;--ok:#166e52;--warn:#9b590a;--bad:#b32940}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.7 system-ui,-apple-system,'Segoe UI','Noto Sans JP',sans-serif}
main{max-width:1240px;margin:auto;padding:40px 26px 80px}h1{font-size:36px;letter-spacing:-1px;line-height:1.2;margin:12px 0}h2{margin:34px 0 14px;font-size:23px}
.eyebrow{font-size:12px;letter-spacing:2px;color:var(--brand);font-weight:800}.sub,.muted{color:var(--muted)}.hero{padding-bottom:24px;border-bottom:1px solid var(--line)}
.pill{display:inline-block;padding:4px 10px;background:#ece6fa;color:var(--brand);border-radius:20px;font-size:12px;font-weight:700;margin-right:6px}
.notice{background:#fff7e8;border:1px solid #edcf92;border-radius:12px;padding:15px 18px;margin:20px 0}.mock{background:#fae9ee;border-color:#edb4c1;color:#8a2940;font-weight:700}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:24px 0}.card{min-width:0;overflow-wrap:anywhere;background:white;border:1px solid var(--line);border-radius:14px;padding:20px}.card b{display:block;font-size:30px;line-height:1.4}.card small{color:var(--muted);font-size:12px}.section{min-width:0;overflow-x:auto;background:white;border:1px solid var(--line);border-radius:14px;padding:20px;margin:18px 0}
table{border-collapse:collapse;width:100%;font-size:13px}th{text-align:left;background:#f4f1fa;color:#49386e;font-weight:700}td,th{padding:12px;border-bottom:1px solid var(--line);vertical-align:top}td.num{font-variant-numeric:tabular-nums;white-space:nowrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f7f8fb;padding:14px;border-radius:8px;font:13px/1.7 ui-monospace,monospace}summary{cursor:pointer;overflow-wrap:anywhere}details{margin:8px 0}.pass{color:var(--ok)}.fail{color:var(--bad)}.bar{background:#eceaf2;height:8px;border-radius:9px;overflow:hidden;min-width:100px}.bar span{height:100%;display:block;background:var(--brand)}input,select,button{font:inherit;border:1px solid var(--line);border-radius:8px;background:white;padding:9px 12px}button{cursor:pointer;color:var(--brand);font-weight:700}.controls{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}.responses{max-height:800px;overflow:auto}.footer{font-size:12px;color:var(--muted);margin-top:36px}code{overflow-wrap:anywhere}.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.cols{grid-template-columns:1fr}h1{font-size:28px}main{padding:25px 14px}.responses{overflow:auto}}@media print{body{background:white}.responses{max-height:none}.controls{display:none}}
"""


def _pct(value):
    return "未測定" if value is None else f"{value*100:.1f}%"


def _num(value, factor=1, suffix=""):
    return "未測定" if value is None else f"{value*factor:,.2f}{suffix}"


def summarize(manifest: dict, rows: list[dict], directory: Path) -> dict:
    ok = [r for r in rows if r["status"] == "ok"]
    diagnostic = [r for r in rows if r["mode"] == "diagnostic"]
    natural = [r for r in rows if r["mode"] != "diagnostic"]
    retry_archive = directory / "retry_attempts.jsonl"
    prior_attempts = read_jsonl(retry_archive) if retry_archive.exists() else []
    regrade_archive = directory / "regrade_history.jsonl"
    regrade_history = read_jsonl(regrade_archive) if regrade_archive.exists() else []
    family = {}
    for f in sorted({r["family"] for r in diagnostic}):
        group = [r for r in diagnostic if r["family"] == f]
        family[f] = cluster_estimate([(r["character_id"], float(r["status"] == "ok" and r["evaluation"]["all_pass"])) for r in group])
    latencies = [r["latency_seconds"] for r in ok if r.get("latency_seconds") is not None and not r.get("system_replayed_response")]
    ttfts = [r["ttft_seconds"] for r in ok if r.get("ttft_seconds") is not None]
    usage_rows = [r for r in ok if r.get("usage") and all(k in r["usage"] for k in ("prompt_tokens", "completion_tokens"))]
    config = manifest["spec"]["config"]
    prices = [config.get(k) for k in ("input_usd_per_million", "output_usd_per_million")]
    known_cost = None
    if all(v is not None for v in prices):
        known_cost = sum((r["usage"]["prompt_tokens"] * prices[0] + r["usage"]["completion_tokens"] * prices[1]) / 1e6 for r in usage_rows)
    judge_rows = []
    for path in sorted((directory / "judgements").glob("*.jsonl")) if (directory / "judgements").exists() else []:
        judge_rows += read_jsonl(path)
    # Do not silently use judgments from a different response snapshot.
    from .judging import response_snapshot_hash, natural_targets
    from .dataset import load_dataset
    from .grading import exact_equal
    from .util import strict_object
    data = load_dataset(directory / "dataset")
    # Keep the all-or-nothing oracle as the headline metric. Field breakdowns
    # explain errors without granting credit to malformed/extra-key JSON.
    oracles = {u["id"]: next(c["expected"] for c in u["turns"][0]["eval"]["checks"]
                              if c["type"] == "json_exact")
               for u in data["units"] if u["mode"] == "diagnostic"}
    field_pairs = defaultdict(list)
    for row in diagnostic:
        expected = oracles[row["unit_id"]]
        actual = None
        if row["status"] == "ok":
            try:
                actual = strict_object(row["text"])
            except (ValueError, TypeError):
                pass
        valid_schema = actual is not None and actual.keys() == expected.keys()
        for field, value in expected.items():
            field_pairs[(row["family"], field)].append(
                (row["character_id"], float(valid_schema and exact_equal(actual[field], value))))
    diagnostic_fields = defaultdict(dict)
    for (family_name, field), pairs in sorted(field_pairs.items()):
        diagnostic_fields[family_name][field] = cluster_estimate(pairs)
    eligible_targets = natural_targets(rows, data)
    selected_ids = set(manifest["spec"]["unit_ids"])
    planned_targets = sum(u["mode"] != "diagnostic" and u["id"] in selected_ids for u in data["units"]) * manifest["spec"]["repeats"]
    eligible_per_dimension = Counter(d for t in eligible_targets for d in t["dimensions"])
    current_snapshot = response_snapshot_hash(rows)
    usable_judges = [r for r in judge_rows if r.get("status") == "ok" and r.get("run_snapshot_hash") == current_snapshot]
    judges = sorted({r["judge_id"] for r in usable_judges})
    judge_manifests = [load_json(path) for path in sorted((directory / "judgements").glob("*.manifest.json"))] if (directory / "judgements").exists() else []
    self_judge_ids = sorted({m["judge_id"] for m in judge_manifests if m.get("snapshot") == current_snapshot and m.get("self_judge") and m.get("judge_id") in judges})
    by_cell = defaultdict(list)
    character_for = {}
    for row in usable_judges:
        for dimension, grade in row["scores"].items():
            if grade["score"] is not None:
                by_cell[(row["target_id"], dimension)].append(grade["score"])
                character_for[row["target_id"]] = row["character_id"]
    by_dimension = defaultdict(list)
    for (target_id, dimension), scores in by_cell.items():
        by_dimension[dimension].append((character_for[target_id], mean(scores)))
    semantic = {dim: cluster_estimate(values) for dim, values in by_dimension.items()}
    semantic_coverage = {
        "planned_natural_targets": planned_targets,
        "complete_eligible_targets": len(eligible_targets),
        "targets_with_valid_judge_record": len({r["target_id"] for r in usable_judges}),
        "targets_with_nonnull_score": len({t for t, _ in by_cell}),
        "nonnull_target_cells_by_dimension": {
            dim: {"scored_targets": len(by_dimension.get(dim, [])), "eligible_targets": count}
            for dim, count in sorted(eligible_per_dimension.items())
        },
        "current_judge_error_records": sum(r.get("status") != "ok" and r.get("run_snapshot_hash") == current_snapshot for r in judge_rows),
        "ignored_stale_records": sum(r.get("run_snapshot_hash") != current_snapshot for r in judge_rows),
        "null_score_cells": sum(g["score"] is None for r in usable_judges for g in r["scores"].values()),
        "mock_judge_records": sum(bool(r.get("mock")) for r in usable_judges),
        "note": "One trajectory is one target. Eligible excludes failed/incomplete units. Missing semantic scores are NOT zero."
    }
    result = {
        "run_id": manifest["run_id"], "label": config["label"], "model": config["model"],
        "generation_version": manifest["spec"]["version"],
        "grading_version": manifest.get("grading_version", manifest["spec"]["version"]),
        "regrade_events": len(manifest.get("regrade_events", [])),
        "regrade_pass_fail_changes": sum(
            (item["old_evaluation"] or {}).get("all_pass") != (item["new_evaluation"] or {}).get("all_pass")
            for item in regrade_history),
        "track": config["track"], "mock": manifest["mock"], "status": manifest["status"],
        "expected_generations": manifest["expected_generations"], "recorded_generations": len(rows),
        "successful_generations": len(ok), "status_counts": dict(Counter(r["status"] for r in rows)),
        "retry_events": len(manifest.get("retry_events", [])),
        "archived_retry_status_counts": dict(Counter(a["record"]["status"] for a in prior_attempts)),
        "coverage": len(rows)/manifest["expected_generations"] if manifest["expected_generations"] else None,
        "success_fraction_of_scheduled": len(ok)/manifest["expected_generations"] if manifest["expected_generations"] else None,
        "diagnostic_accuracy": diagnostic_macro(rows), "diagnostic_families": family,
        "diagnostic_fields": dict(diagnostic_fields),
        "diagnostic_valid_response_accuracy": diagnostic_macro([r for r in diagnostic if r["status"] == "ok"]),
        "diagnostic_loose_json_accuracy": mean(float(r["status"] == "ok" and r["evaluation"]["diagnostic_loose_json"]) for r in diagnostic) if diagnostic else None,
        "natural_surface_contract": cluster_estimate([(r["character_id"], float(r["status"] == "ok" and r["evaluation"]["all_pass"])) for r in natural]),
        "natural_surface_by_mode": {
            mode: cluster_estimate([(r["character_id"], float(r["status"] == "ok" and r["evaluation"]["all_pass"])) for r in natural if r["mode"] == mode])
            for mode in sorted({r["mode"] for r in natural})
        },
        "semantic_state": "not_evaluated" if not judges else "self_judged_uncalibrated" if len(self_judge_ids)==len(judges) else "mixed_self_and_external_uncalibrated" if self_judge_ids else "uncalibrated_single_judge" if len(judges)==1 else "uncalibrated_multiple_judges",
        "semantic_dimensions_1_to_5": semantic, "judge_ids": judges, "semantic_coverage": semantic_coverage,
        "self_judge_ids": self_judge_ids,
        "judge_records_valid": len(usable_judges), "judge_records_total": len(judge_rows),
        "ttft_seconds": {"p50": percentile(ttfts,.5), "p95": percentile(ttfts,.95), "observations": len(ttfts)},
        "latency_seconds": {"p50": percentile(latencies,.5), "p95": percentile(latencies,.95), "observations": len(latencies)},
        "reported_usage": {"known_full_usage_responses": len(usage_rows), "successful_responses": len(ok),
                           "prompt_tokens": sum(r["usage"]["prompt_tokens"] for r in usage_rows),
                           "completion_tokens": sum(r["usage"]["completion_tokens"] for r in usage_rows)},
        "cost_estimate_usd": known_cost if len(usage_rows)==len(ok) and ok else None,
        "known_usage_cost_subtotal_usd": known_cost,
        "cost_per_100_successful_responses_usd": known_cost/len(ok)*100 if known_cost is not None and ok and len(usage_rows)==len(ok) else None,
        "cost_note": "User-specified list-rate proxy only. Warmup, failed/partial calls, explicit retries, cache discounts, tax, GPU/server costs not included.",
        "system_replayed_responses": sum(bool(r.get("system_replayed_response")) for r in rows),
        "truncated_responses": sum(r.get("finish_reason") in ("length", "max_tokens") for r in rows),
        "possible_thinking_tag_responses": sum(bool((r.get("evaluation") or {}).get("surface_flags", {}).get("possible_thinking_tag")) for r in rows),
        "responses_with_separate_reasoning": sum((r.get("reasoning_chars") or 0) > 0 for r in rows),
        "responses_with_reported_reasoning_tokens": sum((r.get("usage") or {}).get("reasoning_tokens", 0) > 0 for r in rows),
        "server_model_ids": sorted({r["server_model"] for r in ok if isinstance(r.get("server_model"), str)}),
        "warnings": ["Synthetic public pilot; not a validated character-AI ranking.",
                     "A 12-turn script measures short-session continuity, not real long-term memory.",
                     "JSON/state accuracy and surface checks are NOT semantic character quality.",
                     "No length-controlled estimator or IRT calibration is claimed.",
                     "No score is imputed for missing semantic judgments. Failure/coverage must be read alongside quality."]
    }
    if self_judge_ids:
        result["warnings"].append("Candidate and rubric judge share a model ID for some results. Self-judgment is not independent quality evidence.")
    if any(e.get("retry_workers", manifest["spec"]["workers"]) != manifest["spec"]["workers"] for e in manifest.get("retry_events", [])):
        result["warnings"].append("Retry concurrency differs from original workers. Latency statistics mix concurrency conditions and are not a clean throughput comparison.")
    return result


def build_report(directory: str | Path) -> dict:
    from .runner import load_run
    directory = Path(directory)
    manifest, rows, data = load_run(directory)
    summary = summarize(manifest, rows, directory)
    save_json(directory / "summary.json", summary)
    csv_rows = [{k: r.get(k) for k in ("key", "character_id", "family", "mode", "status", "latency_seconds", "ttft_seconds", "finish_reason", "text", "error")} |
                {"contract_pass": (r.get("evaluation") or {}).get("all_pass"), "usage": r.get("usage")} for r in rows]
    safe_csv(directory / "scores.csv", csv_rows, ["key", "character_id", "family", "mode", "status", "contract_pass", "latency_seconds", "ttft_seconds", "finish_reason", "usage", "text", "error"])
    e = html.escape
    mock = '<div class="notice mock">MOCK / 工学テスト用の固定応答です。実モデルの性能・速度・順位ではありません。</div>' if summary["mock"] else ""
    table = []
    for family, val in summary["diagnostic_families"].items():
        ci = val["ci95"]
        ci_text = "—" if ci is None else f"{ci[0]*100:.1f}–{ci[1]*100:.1f}%"
        table.append(f'<tr><td>{e(family)}</td><td class="num">{_pct(val["mean"])}</td><td><div class="bar"><span style="width:{(val["mean"] or 0)*100:.1f}%"></span></div></td><td>{ci_text}</td><td>{val["observations"]}</td></tr>')
    field_details = ''.join(
        f'<tr><td>{e(family_name)} / {e(field)}</td><td class="num">{_pct(value["mean"])}</td><td>{value["observations"]}件</td></tr>'
        for family_name, fields in sorted(summary["diagnostic_fields"].items())
        for field, value in sorted(fields.items()))
    semantic = []
    for dim, val in sorted(summary["semantic_dimensions_1_to_5"].items()):
        eligible = summary["semantic_coverage"]["nonnull_target_cells_by_dimension"][dim]["eligible_targets"]
        semantic.append(f'<tr><td>{e(dim)}</td><td>{val["mean"]:.2f} / 5</td><td>{val["observations"]} / {eligible} eligible target units</td></tr>')
    semantic_block = '<p class="muted">未評価です。別LLMでの rubric judge、またはブラインド人間評価を実行してください。機械チェックから「キャラ品質点」を捏造しません。</p>' if not semantic else '<p class="muted">未校正のLLM採点です。採点者数: '+str(len(summary["judge_ids"]))+'</p><table>'+"".join(semantic)+'</table>'
    if summary["self_judge_ids"]:
        semantic_block += '<div class="notice">候補モデル自身による採点を含みます。独立した品質評価として扱わないでください。</div>'
    coverage = summary["semantic_coverage"]
    semantic_block += f'<p class="muted">意味評価対象: 予定 {coverage["planned_natural_targets"]} 単位 → 完了・評価可能 {coverage["complete_eligible_targets"]} 単位 → 有効採点あり {coverage["targets_with_valid_judge_record"]} 単位。採点エラー {coverage["current_judge_error_records"]} 件、判断不能 null {coverage["null_score_cells"]} 項目。対話は12ターン全体で1単位です。</p>'
    if coverage["mock_judge_records"]:
        semantic_block += '<div class="notice mock">MOCK判定を含みます。自動採点の接続確認であり、意味品質の根拠には使えません。</div>'
    detail_rows = []
    for r in rows:
        checks = (r.get("evaluation") or {}).get("checks", [])
        check_text = "\n".join(("PASS " if c["passed"] else "FAIL ")+c["type"]+": "+c["note"] for c in checks)
        title = e(r["key"])
        status = r["status"]
        user = r["request_messages"][-1]["content"]
        detail_rows.append(f'<tr class="response-row" data-status="{e(status)}"><td><code>{title}</code><br><span class="muted">{e(r["mode"])}</span></td><td class="{("pass" if status=="ok" else "fail")}">{e(status)}</td><td><details><summary>{e(r["text"][:110] or r["error"] or "No content")}</summary><h4>User input</h4><pre>{e(user)}</pre><h4>Candidate response</h4><pre>{e(r["text"])}</pre><h4>Mechanical checks</h4><pre>{e(check_text or str(r["error"]))}</pre></details></td></tr>')
    cfg = manifest["spec"]["config"]
    body = f'''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KCB | {e(summary['label'])}</title><style>{CSS}</style><main>
<header class="hero"><div class="eyebrow">KYALULU / CHARACTERBENCH 0.1</div><h1>キャラクターを、観察できる単位へ。</h1><p class="sub">{e(summary['label'])} · {e(summary['model'])}</p><span class="pill">{e(summary['track']).upper()}</span><span class="pill">{e(manifest['spec']['suite'])}</span><span class="pill">{e(summary['status'])}</span></header>{mock}
<div class="notice">このレポートは公開・合成パイロットです。<b>状態診断の正答率 ≠ 会話の魅力。</b> 全体品質の単一スコアや、未実施の人間評価は表示しません。生成版 {e(summary['generation_version'])} / 採点版 {e(summary['grading_version'])}。明示的な再採点 {summary['regrade_events']} 回、適合判定の変更 {summary['regrade_pass_fail_changes']} 件。</div>
<div class="grid"><div class="card"><small>保存 / 予定応答</small><b>{len(rows)} / {summary['expected_generations']}</b><small>網羅率 {_pct(summary['coverage'])}</small></div><div class="card"><small>状態診断・厳密正答率</small><b>{_pct(summary['diagnostic_accuracy']['mean'])}</b><small>失敗した診断は0。キャラ単位集計。</small></div><div class="card"><small>通常会話・表面仕様適合</small><b>{_pct(summary['natural_surface_contract']['mean'])}</b><small>意味・感情・人格は未判定。</small></div><div class="card"><small>予定に対する生成成功</small><b>{_pct(summary['success_fraction_of_scheduled'])}</b><small>エラーと未実施を隠さない。</small></div></div>
<h2>01 / 機械判定できること</h2><div class="section"><table><thead><tr><th>診断系統</th><th>正答率</th><th></th><th>探索的95%区間</th><th>反復込み件数</th></tr></thead><tbody>{''.join(table)}</tbody></table><p class="muted">区間はキャラクター単位の再標本化。共有テンプレートへの依存と12キャラという小標本は解消されません。全件未完了の結果は暫定です。</p><details><summary>診断フィールド別の誤答内訳</summary><table><thead><tr><th>系統 / フィールド</th><th>正答率</th><th>件数</th></tr></thead><tbody>{field_details}</tbody></table><p class="muted">厳密なJSON形式・キー集合を満たした応答のみフィールド別に採点。主指標の全キー完全正答とは別です。</p></details></div>
<p class="muted">表面仕様の内訳: {', '.join(e(mode)+' '+_pct(value['mean'])+' ('+str(value['observations'])+'件)' for mode,value in summary['natural_surface_by_mode'].items()) or '未測定'}。対話の各ターンと単発課題を分けて確認してください。</p>
<h2>02 / 意味とキャラクター性</h2><div class="section">{semantic_block}</div>
<h2>03 / 運用の計測</h2><div class="grid"><div class="card"><small>最初の本文まで・p50</small><b>{_num(summary['ttft_seconds']['p50'],1000,' ms')}</b><small>本文ストリーミング {summary['ttft_seconds']['observations']} 件</small></div><div class="card"><small>応答完了まで・p95</small><b>{_num(summary['latency_seconds']['p95'],1,' s')}</b><small>通信・待ち行列・prefillを含む。</small></div><div class="card"><small>usage取得済み / 成功応答</small><b>{len([r for r in rows if r.get('usage') and 'prompt_tokens' in r['usage'] and 'completion_tokens' in r['usage']])} / {summary['successful_generations']}</b><small>文字数やSSE個数からtokenを推定しない。</small></div><div class="card"><small>API料金の設定値ベース概算</small><b>{_num(summary['cost_estimate_usd'],1,' USD')}</b><small>実GPU原価・再試行・ウォームアップは別。</small></div></div>
<p class="muted">max_tokens到達: {summary['truncated_responses']} 件。別フィールドの思考あり: {summary['responses_with_separate_reasoning']} 件。思考タグの疑い: {summary['possible_thinking_tag_responses']} 件。再試行: {summary['retry_events']} 回、退避した初回失敗・依存スキップ: {e(str(summary['archived_retry_status_counts']))}。usage非対応や非ストリームの測定値は「未測定」です。</p>
<h2>04 / 応答を監査する</h2><div class="controls"><input id="search" placeholder="キャラID・応答内容を検索" aria-label="応答検索"><select id="status" aria-label="状態"><option value="">全状態</option><option>ok</option><option>truncated</option><option>error</option><option>skipped_dependency</option></select></div><div class="section responses"><table><thead><tr><th>Case / turn</th><th>Status</th><th>応答・検査内容</th></tr></thead><tbody>{''.join(detail_rows)}</tbody></table></div>
<h2>05 / 再現条件</h2><div class="section"><details><summary>モデル設定・データハッシュ・実行環境</summary><pre>{e(__import__('json').dumps(manifest,ensure_ascii=False,indent=2))}</pre></details></div>
<footer class="footer">Kyalulu CharacterBench v0.1 · Local-only report · No external scripts, fonts, telemetry, or network requests.<br>同じ乱数seedでも、サーバー・量子化・推論バックエンドによる完全な決定性は保証されません。</footer></main>
<script>const q=document.getElementById('search'),s=document.getElementById('status');function filter(){{document.querySelectorAll('.response-row').forEach(r=>{{r.hidden=!(r.textContent.toLowerCase().includes(q.value.toLowerCase())&&(!s.value||r.dataset.status===s.value));}})}}q.addEventListener('input',filter);s.addEventListener('change',filter);</script></html>'''
    (directory / "report.html").write_text(body, encoding="utf-8")
    return summary
