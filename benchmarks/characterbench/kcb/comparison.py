from __future__ import annotations
import copy
import html
import random
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from .config import check_network
from .judging import PAIR_SYSTEM, PAIR_VERSION, natural_targets, response_snapshot_hash, validate_pair
from .providers import Provider, ProviderError
from .report import CSS
from .runner import load_run
from .stats import cluster_estimate
from .util import KCBError, digest, dumps, load_json, now, read_jsonl, save_json, write_jsonl


def paired_runs(a_dir, b_dir, allow_partial=False):
    a, ar, data = load_run(a_dir)
    b, br, bdata = load_run(b_dir)
    for key in ("dataset_hash", "protocol_hash"):
        if a["spec"][key] != b["spec"][key]:
            raise KCBError(f"Comparison refused: different {key}")
    if a["spec"]["config"]["track"] != b["spec"]["config"]["track"]:
        raise KCBError("Core and System scores cannot share one comparison. Compare within a track.")
    if a["mock"] != b["mock"]:
        raise KCBError("Cannot compare MOCK fixtures against real models")
    if not allow_partial:
        if set(a["spec"]["unit_ids"]) != set(b["spec"]["unit_ids"]) or a["spec"]["repeats"] != b["spec"]["repeats"]:
            raise KCBError("Different selected units/repeats. Use --allow-partial for a clearly labeled matched-subset analysis.")
        if len(ar) != a["expected_generations"] or len(br) != b["expected_generations"]:
            raise KCBError("Incomplete runs. Resume them or use --allow-partial.")
    warnings = []
    ac, bc = a["spec"]["config"], b["spec"]["config"]
    for field in ("temperature", "top_p", "max_tokens", "send_seed", "extra_body", "system_prompt_extra", "runtime_id"):
        if ac[field] != bc[field]:
            warnings.append(f"Different {field}: this compares configured systems, not an isolated model change.")
    for field in ("seed", "workers", "warmup"):
        if a["spec"][field] != b["spec"][field]:
            warnings.append(f"Different run setting {field}")
    return a, ar, b, br, data, warnings


def matched_targets(a_dir, b_dir, *, allow_partial=False, limit=None):
    a, ar, b, br, data, warnings = paired_runs(a_dir, b_dir, allow_partial)
    at = {t["target_id"]: t for t in natural_targets(ar, data)}
    bt = {t["target_id"]: t for t in natural_targets(br, data)}
    items = []
    for key in sorted(at.keys() & bt.keys()):
        x, y = at[key], bt[key]
        if x["user_script"] != y["user_script"]:
            raise KCBError("Different user scripts cannot form a paired natural target")
        items.append({"target_id": key, "character_id": x["character_id"], "family": x["family"],
                      "mode": x["mode"], "character": x["character"], "user_script": x["user_script"],
                      "A": x["candidate_text"], "B": y["candidate_text"],
                      "conversation_A": x["conversation"], "conversation_B": y["conversation"]})
    random.Random(17).shuffle(items)
    matched_before_limit = len(items)
    if limit is not None:
        if limit < 1:
            raise KCBError("limit must be positive")
        items = items[:limit]
    metadata = {"A": {"run_id": a["run_id"], "label": a["spec"]["config"]["label"], "model": a["spec"]["config"]["model"]},
                "B": {"run_id": b["run_id"], "label": b["spec"]["config"]["label"], "model": b["spec"]["config"]["model"]},
                "run_snapshots": {"A": response_snapshot_hash(ar), "B": response_snapshot_hash(br)},
                "dataset_hash": data["hash"], "track": a["spec"]["config"]["track"],
                "mock": a["mock"], "warnings": warnings,
                "available_targets_A": len(at), "available_targets_B": len(bt),
                "matched_before_limit": matched_before_limit, "selected_targets": len(items),
                "allow_partial": allow_partial,
                "note": "Only successful COMPLETE natural units are paired. Read generation-failure coverage separately. No per-turn comparison of different generated histories."}
    return items, metadata


def compare_runs(a_dir, b_dir, out, *, allow_partial=False):
    a, ar, b, br, data, warnings = paired_runs(a_dir, b_dir, allow_partial)
    am, bm = {r["key"]:r for r in ar}, {r["key"]:r for r in br}
    cells = defaultdict(list)
    n = 0
    for key in sorted(am.keys() & bm.keys()):
        x, y = am[key], bm[key]
        if x["mode"] != "diagnostic":
            continue
        xs = float(x["status"]=="ok" and x["evaluation"]["all_pass"])
        ys = float(y["status"]=="ok" and y["evaluation"]["all_pass"])
        cells[(x["character_id"],x["family"])].append(xs-ys)
        n += 1
    by_char = defaultdict(list)
    by_family = defaultdict(list)
    for (character, family), values in cells.items():
        by_char[character].append(mean(values))
        by_family[family].append(mean(values))
    estimate = cluster_estimate([(c,mean(v)) for c,v in by_char.items()])
    family_sensitivity = cluster_estimate([(f,mean(v)) for f,v in by_family.items()])
    family_sensitivity["method"] = "Exploratory scenario-family resampling sensitivity; not a two-way bootstrap"
    result = {"A":a["spec"]["config"], "B":b["spec"]["config"], "mock":a["mock"],
              "track":a["spec"]["config"]["track"], "dataset_hash":data["hash"],
              "paired_diagnostic_A_minus_B": estimate, "family_sensitivity":family_sensitivity,
              "matched_diagnostic_generations":n, "warnings":warnings,
              "coverage_A":len(ar)/a["expected_generations"], "coverage_B":len(br)/b["expected_generations"],
              "success_A":sum(r["status"]=="ok" for r in ar)/a["expected_generations"],
              "success_B":sum(r["status"]=="ok" for r in br)/b["expected_generations"],
              "allow_partial":allow_partial,
              "interpretation":"Paired state-diagnostic difference only. Does not rank character quality. A confidence interval crossing 0 is inconclusive, not proof of equivalence."}
    out = Path(out)
    out.mkdir(parents=True,exist_ok=True)
    save_json(out/"comparison.json",result)
    e=html.escape
    delta = "未測定" if estimate["mean"] is None else f"{100*estimate['mean']:+.1f} percentage points"
    ci=estimate["ci95"]
    ci_text="未測定" if ci is None else f"{100*ci[0]:+.1f} ～ {100*ci[1]:+.1f} points"
    body=f'''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KCB comparison</title><style>{CSS}</style><main><div class="eyebrow">KCB / PAIRED DIAGNOSTICS</div><h1>同じ課題を、同じ単位で比較する。</h1><p>A: {e(result['A']['label'])} ／ B: {e(result['B']['label'])}</p><div class="notice {'mock' if result['mock'] else ''}">{'MOCK：固定応答のテスト結果。実モデルの順位ではありません。' if result['mock'] else '状態診断の差であり、会話の魅力の順位ではありません。'}</div><div class="grid"><div class="card"><small>対応する状態診断・A − B</small><b>{e(delta)}</b></div><div class="card"><small>探索的95%区間</small><b>{e(ci_text)}</b></div><div class="card"><small>対応する診断応答数</small><b>{n}</b></div><div class="card"><small>独立単位として再標本化したキャラ数</small><b>{estimate['clusters']}</b></div></div><div class="section"><p>区間が0をまたぐときは差を断定しません。差が見えないことは同等性の証明でもありません。小標本・共有テンプレート・量子化・ハードウェア・設定の違いに注意してください。</p><p>自然会話は <code>pairwise</code> または <code>human-export</code> で別評価します。</p><pre>{e(dumps(result,pretty=True))}</pre></div></main></html>'''
    (out/"comparison.html").write_text(body,encoding="utf-8")
    return result


def pairwise_judge(a_dir,b_dir,config,out,*,limit=None,resume=False,allow_remote=False,allow_partial=False,quiet=False):
    items,metadata=matched_targets(a_dir,b_dir,allow_partial=allow_partial,limit=limit)
    if not items:
        raise KCBError("No complete, matched natural targets available")
    config=copy.deepcopy(config)
    if config["provider"]=="system_http":
        raise KCBError("Pairwise judges require an OpenAI-compatible endpoint")
    check_network(config,allow_remote)
    provider=Provider(config)
    provider.resolve_model()
    spec={"metadata":metadata,"config":config,"version":PAIR_VERSION,"prompt":PAIR_SYSTEM,
          "target_ids":[x["target_id"] for x in items]}
    out=Path(out)
    if (out/"manifest.json").exists():
        old_manifest=load_json(out/"manifest.json")
        if not resume or old_manifest["fingerprint"]!=digest(spec):
            raise KCBError("Pairwise output already exists or changed. Use --resume with the same arguments, or a new output directory.")
    else:
        if out.exists() and any(out.iterdir()):
            raise KCBError("Pairwise output must be empty")
        out.mkdir(parents=True,exist_ok=True)
        save_json(out/"manifest.json",{"fingerprint":digest(spec),"spec":spec,"created_at":now()})
    path=out/"pairwise.jsonl"
    results=read_jsonl(path) if path.exists() else []
    seen={r["target_id"] for r in results}
    for i,item in enumerate(items,1):
        if item["target_id"] in seen:
            continue
        rounds=[]
        for swapped in (False,True):
            payload={"character":item["character"],"user_script":item["user_script"],
                     "A":item["B"] if swapped else item["A"],
                     "B":item["A"] if swapped else item["B"]}
            try:
                response=provider.generate([{"role":"system","content":PAIR_SYSTEM},{"role":"user","content":dumps(payload)}],seed=17)
                verdict=validate_pair(response.text)
                original=verdict["winner"]
                if swapped and original in ("A","B"):
                    original="B" if original=="A" else "A"
                rounds.append({"swapped":swapped,"status":"ok","display_winner":verdict["winner"],
                               "original_winner":original,"reason":verdict["reason"],"response":response.record()})
            except (ProviderError,ValueError,TypeError) as exc:
                rounds.append({"swapped":swapped,"status":"error","error":str(exc)})
        if any(r["status"]!="ok" for r in rounds):
            status,winner="error",None
        elif rounds[0]["original_winner"]!=rounds[1]["original_winner"]:
            status,winner="order_sensitive",None
        else:
            status,winner="stable",rounds[0]["original_winner"]
        record={"target_id":item["target_id"],"character_id":item["character_id"],"family":item["family"],
                "status":status,"winner":winner,"rounds":rounds,"mock":metadata["mock"] or config["provider"]=="mock",
                "length_A_chars":len(item["A"]),"length_B_chars":len(item["B"])}
        results.append(record)
        write_jsonl(path,results)
        if not quiet:
            print(f"Pair [{i}/{len(items)}] {item['target_id']}: {status} {winner or ''}",flush=True)
    summary=pairwise_summary(results,metadata)
    save_json(out/"summary.json",summary)
    e=html.escape
    detail="".join(f"<tr><td>{e(r['target_id'])}</td><td>{e(r['status'])}</td><td>{e(str(r['winner']))}</td><td><details><summary>両順序の根拠</summary><pre>{e(dumps(r['rounds'],pretty=True))}</pre></details></td></tr>" for r in results)
    (out/"report.html").write_text(f'''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KCB Pairwise</title><style>{CSS}</style><main><div class="eyebrow">KCB / ORDER-SWAPPED A–B</div><h1>自然会話の比較。</h1><div class="notice">{'MOCK固定応答の動作確認です。' if any(r['mock'] for r in results) else '未校正のLLM採点です。'} 順序で結論が変わった例を「引き分け」に偽装しません。順序反転は長さバイアスを除去しません。</div><div class="section"><pre>{e(dumps(summary,pretty=True))}</pre></div><div class="section"><table><tr><th>Target</th><th>Status</th><th>Winner</th><th>Evidence</th></tr>{detail}</table></div></main></html>''',encoding="utf-8")
    return summary


def pairwise_summary(results,metadata):
    stable=[r for r in results if r["status"]=="stable"]
    counts=Counter(r["winner"] for r in stable)
    estimate=cluster_estimate([(r["character_id"],1.0 if r["winner"]=="A" else 0.0 if r["winner"]=="B" else .5) for r in stable])
    positions=[rr["display_winner"] for r in results for rr in r["rounds"] if rr["status"]=="ok" and rr["display_winner"] in ("A","B")]
    sensitivity=sum(r["status"]=="order_sensitive" for r in results)
    both_valid=sum(all(rr["status"]=="ok" for rr in r["rounds"]) for r in results)
    return {"metadata":metadata,"mock":metadata["mock"] or any(r.get("mock",False) for r in results),"records":len(results),"status_counts":dict(Counter(r["status"] for r in results)),
            "stable_counts":dict(counts),"stable_A_preference_score":estimate,
            "both_bad_count":counts.get("both_bad",0),"stable_coverage":len(stable)/len(results) if results else None,
            "order_sensitivity_rate_among_valid_pairs":sensitivity/both_valid if both_valid else None,
            "display_left_selection_rate_among_decisive_judgments":positions.count("A")/len(positions) if positions else None,
            "interpretation":"Stable-subset preference only. tie and both_bad count as 0.5 in the symmetric score but both_bad is reported separately. Order-sensitive cases are UNRESOLVED, not ties. Length-controlled regression is NOT implemented."}
