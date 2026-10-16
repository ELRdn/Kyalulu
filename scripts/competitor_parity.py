"""Prepare original comparison fixtures and report acceptance without making API calls."""
import argparse
import json
import math
import random
import statistics
from collections import defaultdict
from copy import deepcopy
from pathlib import Path

AXES = ("persona", "style", "emotion", "agency", "continuity", "japanese")
DOMAINS = ("onboarding", "discovery", "work_detail", "character_quality", "story_quality",
    "long_context", "memory", "chat_controls", "world_rules", "creation", "models",
    "media", "community", "creator_economics", "pricing", "mobile", "data_ownership",
    "reliability", "safety_accessibility", "distribution")
PRODUCTS = ("kyalulu", "zeta", "isekai-zero")


def fixtures():
    roles = ["図書室の司書", "近所の喫茶店主", "年上の同僚", "静かな園芸家", "旅好きの友人", "星を見る案内人",
             "古書店の魔法使い", "探検隊の隊長", "質屋の店主", "宇宙船の航海士", "迷宮の治療師", "港町の調査員"]
    short = []
    for i, role in enumerate(roles):
        story = i >= 6
        short.append({"id":f"parity-{i+1:02d}","split":"development",
            "family":"story" if story else "daily", "name":f"比較用キャラ{i+1}","role":role,
            "card":{"personality":"穏やかだが自分の考えを持つ。未知のことを断定しない。",
                    "speaking_style":"自然な日本語。ユーザーの行動と気持ちを勝手に決めない。"},
            "world":{"name":"青灯街" if story else "現代の小さな町","rules":"合意した設定を守る。所持品を無断で増減しない。"},
            "turns":["こんにちは。私は灯。甘い飲み物は苦手なの。",
                "今日は少し落ち込んでいる。すぐ解決するより話を聞いて。",
                "土曜日は青い時計台で待ち合わせしよう。",
                "次は古書店を訪ねたい。私はまだ扉を開けていないよ。" if story else "今はほうじ茶を飲みたい。以前の好みとは区別してね。",
                "私が宇宙飛行士だって前に言ったよね？会話に照らして答えて。"]})
    held_out = deepcopy(short)
    for i, card in enumerate(held_out):
        card.update(id=f"parity-eval-{i+1:02d}", split="acceptance")
        card["turns"] = ["はじめまして。私は澪。大きな音は苦手なんだ。",
            "今日はうれしいことがあった。理由を決めつけずに聞いて。",
            "日曜日、赤い風車の前で待ち合わせよう。",
            "港の市場へ行きたい。まだ船には乗っていないよ。" if card["family"] == "story" else "今は静かな場所で話したい。ずっと誰とも会いたくないわけじゃない。",
            "前に私が医師だと言ったはずだよね？実際に話した内容で確認して。"]
    long, held_out_long = [], []
    for source, output in ((short, long), (held_out, held_out_long)):
      for index in (0,2,6,8):
        card = source[index]
        for length in (30,50,100):
            turns = [f"{n}回目。前の出来事を尊重して、小さく話を進めよう。" for n in range(1,length+1)]
            turns[0] = "好きな花はデルフィニウム。飲み物は無糖の紅茶。"
            turns[1] = "土曜日、青い時計台で待ち合わせる約束を覚えて。"
            turns[length//2-1] = "飲み物の好みが変わった。今はほうじ茶を選んでほしい。"
            turns[-4:] = ["最初に好きだと伝えた花は？","今の好みの飲み物を選んで。","土曜日の待ち合わせはどこ？","私の職業を宇宙飛行士と決めた根拠はある？"]
            if card["split"] == "acceptance":
                turns[0] = "好きな花は桔梗。好きな季節は秋。"
                turns[1] = "日曜日、赤い風車の前で待ち合わせる約束を覚えて。"
                turns[length//2-1] = "好きな季節を訂正するね。今は春を選んでほしい。"
                turns[-4:] = ["最初に好きだと伝えた花は？","今好きな季節を教えて。","日曜日の待ち合わせはどこ？","私が医師だと決めた根拠はある？"]
            output.append({"id":f"{card['id']}-{length}","split":card["split"],"family":card["family"],"character_id":card["id"],"length":length,"repeats":3,"turns":turns})
    return {"schema_version":1,"language":"ja","short":short,"long":long,"held_out_short":held_out,"held_out_long":held_out_long,
        "rules":{"private_original_content":True,"new_session_per_repeat":True,
            "no_automatic_competitor_requests":True,"no_retry_selection":True,
            "api_budget_nano_usd":100_000_000,"quality_margin":0.2,"latency_ratio":1.2}}


def ledger():
    references = {
        "zeta":["https://zeta-ai.io/ja", "https://zeta-ai.io/en/policy/privacy", "https://zeta-ai.io/en/policy/partner"],
        "isekai-zero":["https://www.isekaizero.ai/ja", "https://docs.isekaizero.ai/books/transparency/page/transparent-pricing", "https://docs.isekaizero.ai/books/your-guide-to-isekai-zero/page/summarization-and-arc"]}
    return {"schema_version":1,"baseline_date":"2026-10-11","rea_browser_observed":False,
        "entries":[{"domain":domain,"product":product,"plan":"unverified", "status":"unverified",
            "evidence_type":"public-source-baseline" if product != "kyalulu" else "source-inspection",
            "sources":references.get(product,["docs/HANDOFF.md"]),"steps":[],"result":None,
            "limitations":"Login/generation/payment/device acceptance not observed; do not infer parity."}
            for domain in DOMAINS for product in PRODUCTS]}


def percentile(values, q):
    return sorted(values)[max(0, math.ceil(len(values)*q)-1)] if values else None


def quality(records, competitor):
    diffs = defaultdict(lambda: defaultdict(list))
    raters = defaultdict(lambda: defaultdict(set))
    for row in records:
        if (row.get("competitor") != competitor or row.get("status") != "completed" or row.get("mock")
                or row.get("split") != "acceptance" or row.get("replayed_response") or row.get("rater_kind", "human") != "human"):
            continue
        for axis in AXES:
            a,b = row.get("kyalulu",{}).get(axis),row.get("reference",{}).get(axis)
            if type(a) is int and type(b) is int and 1<=a<=5 and 1<=b<=5:
                diffs[axis][row["character_id"]].append(a-b)
                if row.get("rater"):
                    raters[axis][row["character_id"]].add(row["rater"])
    result = {}
    rng = random.Random(42)
    for axis in AXES:
        clusters = [statistics.mean(v) for v in diffs[axis].values()]
        lower = None
        if len(clusters)>=2:
            boot = [statistics.mean(rng.choices(clusters,k=len(clusters))) for _ in range(2000)]
            lower = percentile(boot,.025)
        coverage = sum(len(raters[axis][key]) >= 3 for key in diffs[axis])
        sufficient = len(clusters)>=12 and coverage == len(clusters)
        result[axis] = {"characters":len(clusters),"raters":len(set().union(*raters[axis].values())) if raters[axis] else 0,
            "characters_with_three_raters":coverage,"difference":statistics.mean(clusters) if clusters else None,
            "lower_95":lower,"status":"pending" if not sufficient or lower is None else "passed" if lower>=-.2 else "failed"}
    return result


def failure_gate(failures, n):
    if not n:
        return {"status":"pending", "interval_95":None}
    p, z = failures/n, 1.96
    center = (p+z*z/(2*n))/(1+z*z/n)
    radius = z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/(1+z*z/n)
    low, high = max(0,center-radius), min(1,center+radius)
    return {"status":"pending" if n<100 else "passed" if high<=.01 else "failed" if low>.01 else "pending",
            "interval_95":[low,high],"target":.01}


def report(observations, ratings):
    results = {}
    for competitor in PRODUCTS[1:]:
        comparisons = {}
        # Cost/plan/settings must match; an unmatched track never borrows other evidence.
        strata = {(r.get("plan"),r.get("setting")) for r in observations if r.get("product")==competitor}
        for plan,setting in sorted(strata,key=str):
            arms = {}
            for product in ("kyalulu",competitor):
                all_rows = [r for r in observations if r.get("product")==product and r.get("plan")==plan and r.get("setting")==setting]
                rows = [r for r in all_rows if r.get("split") == "acceptance" and not r.get("mock") and not r.get("replayed_response")]
                good = [r for r in rows if r.get("status")=="completed"]
                arms[product] = {"attempts":len(rows),"completed":len(good),
                    "failure_rate":(len(rows)-len(good))/len(rows) if rows else None,
                    "operator_known_nano":sum(r["operator_cost_nano"] for r in rows if type(r.get("operator_cost_nano")) is int and r["operator_cost_nano"]>=0),
                    "operator_cost_complete":bool(rows) and all(type(r.get("operator_cost_nano")) is int and r["operator_cost_nano"]>=0 for r in rows),
                    "excluded_mock_or_replay":sum(bool(r.get("mock") or r.get("replayed_response")) for r in all_rows),
                    "excluded_development_or_unknown_split":sum(r.get("split") != "acceptance" for r in all_rows),
                    "failure_gate":failure_gate(len(rows)-len(good),len(rows)),
                    "failure_reasons":dict((reason,sum(r.get("error", "unspecified")==reason for r in rows if r.get("status")!="completed"))
                        for reason in {r.get("error", "unspecified") for r in rows if r.get("status")!="completed"}),
                    "user_cost_by_currency":{currency:sum(r["user_cost_minor"] for r in rows if r.get("currency")==currency and type(r.get("user_cost_minor")) is int)
                        for currency in {r.get("currency") for r in rows if isinstance(r.get("currency"),str)}},
                    "user_cost_complete":bool(rows) and all(isinstance(r.get("currency"),str) and type(r.get("user_cost_minor")) is int and r["user_cost_minor"]>=0 for r in rows)}
                for field in ("first_body_ms","completion_ms"):
                    values = [r[field] for r in good if type(r.get(field)) in (int,float) and math.isfinite(r[field]) and r[field]>=0]
                    arms[product][field] = {"n":len(values),"p50":statistics.median(values) if values else None,"p95":percentile(values,.95)}
            gates = {}
            for field in ("first_body_ms","completion_ms"):
                a,b = arms["kyalulu"][field],arms[competitor][field]
                gates[field] = "pending" if min(a["n"],b["n"])<100 else "passed" if a["p50"]<=1.2*b["p50"] and a["p95"]<=1.2*b["p95"] else "failed"
            scoped = [r for r in ratings if r.get("plan")==plan and r.get("setting")==setting]
            comparisons[f"{plan}/{setting}"] = {"arms":arms,"latency_gates":gates,"quality":quality(scoped,competitor)}
        results[competitor] = comparisons or {"status":"pending","reason":"no real matched observations"}
    return {"schema_version":1,"comparisons":results,"overall_parity":"unverified",
        "acceptance":{"functional":"unverified","performance":"unverified","operational":"unverified",
            "critical_integrity":"unverified","critical_events_allowed":0},
        "limitations":["Formal ratings need 12 character clusters and 3 humans.","p95 needs 100 completed observations per arm.","No execution, spending or competitor API access is performed by this tool."]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action",choices=("prepare","report"))
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--observations",type=Path)
    parser.add_argument("--ratings",type=Path)
    args = parser.parse_args()
    if args.action=="prepare":
        args.output.mkdir(parents=True,exist_ok=True)
        for name,value in (("fixtures.json",fixtures()),("ledger.json",ledger()),("acceptance.json",report([],[]))):
            path = args.output/name
            if path.exists():
                raise ValueError("do not replace recorded evaluation files")
            path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    else:
        load = lambda p: [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()] if p else []
        args.output.write_text(json.dumps(report(load(args.observations),load(args.ratings)),ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


if __name__=="__main__":
    main()
