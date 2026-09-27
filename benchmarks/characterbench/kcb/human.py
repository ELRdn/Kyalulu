from __future__ import annotations
import html
import random
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean
from .comparison import matched_targets
from .report import CSS
from .stats import cluster_estimate
from .util import KCBError, digest, dumps, json_for_html, load_json, now, read_jsonl, safe_csv, save_json, write_jsonl


def export_human(a_dir,b_dir,out,*,limit=None,allow_partial=False,seed=71):
    items,metadata=matched_targets(a_dir,b_dir,allow_partial=allow_partial,limit=limit)
    if not items:
        raise KCBError("No complete matched natural targets to export")
    out=Path(out)
    if out.exists() and any(out.iterdir()):
        raise KCBError("Human-study output must be a NEW empty directory")
    out.mkdir(parents=True,exist_ok=True)
    rng=random.Random(seed)
    blind,key_rows=[],[]
    study_id=digest({"snapshots":metadata["run_snapshots"],"targets":[i["target_id"] for i in items],"seed":seed})[:20]
    for item in items:
        swapped=rng.choice([False,True])
        sample_id=digest({"study":study_id,"target":item["target_id"]})[:16]
        blind.append({"sample_id":sample_id,"mode":item["mode"],"character":item["character"],
                      "A":item["conversation_B"] if swapped else item["conversation_A"],
                      "B":item["conversation_A"] if swapped else item["conversation_B"]})
        key_rows.append({"sample_id":sample_id,"target_id":item["target_id"],"character_id":item["character_id"],
                         "display_A_is":"B" if swapped else "A","display_B_is":"A" if swapped else "B"})
    key={"study_id":study_id,"created_at":now(),"metadata":metadata,"items":key_rows}
    save_json(out/"PRIVATE_KEY_DO_NOT_SHARE_WITH_RATERS.json",key)
    save_json(out/"blind_tasks.json",{"study_id":study_id,"mock":metadata["mock"],"items":blind})
    public={"study_id":study_id,"mock":metadata["mock"],"items":blind}
    page='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KCB | Blind human review</title><style>'''+CSS+'''
.chat{padding:12px;margin:9px 0;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere;background:#f1edf8}.chat.user{background:#f2f4f7;color:#526075}.speaker{font-size:11px;font-weight:800;display:block;margin-bottom:5px}.vote.selected{background:#6847bc;color:white}.sticky{position:sticky;bottom:0;background:#f5f6faee;padding:12px 0}#card{font-size:13px}.candidate{max-height:65vh;overflow:auto}</style><main>
<div class="eyebrow">KYALULU / BLIND HUMAN REVIEW</div><h1>モデル名を伏せて、会話を比べる。</h1>
<div class="notice" id="notice">カードとの整合・自然さ・相手の選択の尊重を踏まえ、どちらを好むか選んでください。長い方を自動的に選ぶ必要はありません。12ターンの場合は会話全体を読んでください。</div>
<p class="muted">参加は任意です。つらい・不快な例はスキップしてください。入力するのは匿名IDのみ。本名・メールは不要です。採点はこのブラウザに保存され、外部への送信はありません。終了時にJSONを保存してください。</p>
<div class="controls"><label>匿名ID <input id="rater" maxlength="60" placeholder="例: reviewer01"></label><button id="save">採点JSONを保存</button><button id="clear">このブラウザの採点を消去</button></div>
<p id="progress"></p><details class="section"><summary>キャラクターカード（評価前に読む）</summary><pre id="card"></pre></details>
<div class="cols"><section class="section"><h2>候補 A</h2><div id="A" class="candidate"></div></section><section class="section"><h2>候補 B</h2><div id="B" class="candidate"></div></section></div>
<div class="sticky"><div class="controls" id="votes"><button class="vote" data-vote="A">Aを好む</button><button class="vote" data-vote="B">Bを好む</button><button class="vote" data-vote="tie">差がない</button><button class="vote" data-vote="both_bad">どちらも不十分</button><button class="vote" data-vote="skip">スキップ</button></div><div class="controls"><button id="prev">前へ</button><button id="next">次へ</button></div></div>
<p class="footer">採点者にはこのHTMLだけを渡してください。モデル対応表のPRIVATE_KEYファイルは渡さないでください。モデルの自己紹介が応答に含まれる場合は完全なブラインドにならないため、調査者へ報告してください。</p>
</main><script type="application/json" id="study-data">'''+json_for_html(public)+'''</script><script>
'use strict';
const study=JSON.parse(document.getElementById('study-data').textContent), storageKey='kcb-human-'+study.study_id;
let index=0, votes={},rater='';
try{const old=JSON.parse(localStorage.getItem(storageKey)||'null');if(old){votes=old.votes||{};rater=old.rater||'';}}catch(e){}
const raterInput=document.getElementById('rater');raterInput.value=rater;
if(study.mock){document.getElementById('notice').classList.add('mock');document.getElementById('notice').prepend('MOCK練習用。実モデルの調査ではありません。 ');}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify({votes: votes,rater:raterInput.value}));}catch(e){}}
raterInput.addEventListener('input',persist);
function conversation(id,messages){const node=document.getElementById(id);node.replaceChildren();messages.forEach(m=>{const div=document.createElement('div');div.className='chat '+(m.role==='user'?'user':'assistant');const label=document.createElement('span');label.className='speaker';label.textContent=m.role==='user'?'USER':'CHARACTER';const text=document.createElement('span');text.textContent=m.content;div.append(label,text);node.append(div);});node.scrollTop=0;}
function render(){const item=study.items[index];document.getElementById('progress').textContent=(index+1)+' / '+study.items.length+' · 採点済み '+Object.keys(votes).length+'件 · '+item.mode;document.getElementById('card').textContent=JSON.stringify(item.character,null,2);conversation('A',item.A);conversation('B',item.B);document.querySelectorAll('.vote').forEach(b=>b.classList.toggle('selected',votes[item.sample_id]===b.dataset.vote));document.getElementById('prev').disabled=index===0;document.getElementById('next').disabled=index===study.items.length-1;}
document.querySelectorAll('.vote').forEach(b=>b.addEventListener('click',()=>{votes[study.items[index].sample_id]=b.dataset.vote;persist();render();}));
document.getElementById('prev').onclick=()=>{if(index>0){index--;render();}};document.getElementById('next').onclick=()=>{if(index<study.items.length-1){index++;render();}};
document.getElementById('save').onclick=()=>{const id=raterInput.value.trim();if(!id){alert('匿名IDを入力してください。本名は不要です。');return;}const result={schema:'kcb-human-v0.1',study_id:study.study_id,rater_id:id,created_at:new Date().toISOString(),annotations:Object.entries(votes).map(([sample_id,vote])=>({sample_id,vote}))};const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='kcb-votes-'+study.study_id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.getElementById('clear').onclick=()=>{if(confirm('このブラウザに保存した採点だけを削除しますか？')){votes={};raterInput.value='';try{localStorage.removeItem(storageKey);}catch(e){}render();}};render();
</script></html>'''
    (out/"blind-arena.html").write_text(page,encoding="utf-8")
    return {"study_id":study_id,"tasks":len(blind),"arena":str(out/"blind-arena.html"),
            "private_key":str(out/"PRIVATE_KEY_DO_NOT_SHARE_WITH_RATERS.json"),"mock":metadata["mock"]}


def import_human(key_path,vote_paths,out):
    key=load_json(key_path)
    mapping={r["sample_id"]:r for r in key["items"]}
    records={}
    for path in vote_paths:
        batch=load_json(path)
        if batch.get("schema")!="kcb-human-v0.1" or batch.get("study_id")!=key["study_id"]:
            raise KCBError("Vote schema/study ID does not match the private key")
        rater=batch.get("rater_id")
        if not isinstance(rater,str) or not rater.strip() or len(rater)>80:
            raise KCBError("Anonymous rater_id must be a nonempty string <= 80 characters")
        annotations=batch.get("annotations")
        if not isinstance(annotations,list):
            raise KCBError("annotations must be an array")
        local_seen=set()
        for ann in annotations:
            sample=ann.get("sample_id")
            vote=ann.get("vote")
            if sample not in mapping or sample in local_seen or vote not in ("A","B","tie","both_bad","skip"):
                raise KCBError("Unknown/duplicate sample ID or invalid human vote")
            local_seen.add(sample)
            item=mapping[sample]
            original=item["display_A_is"] if vote=="A" else item["display_B_is"] if vote=="B" else vote
            record={"study_id":key["study_id"],"rater_id":rater,"target_id":item["target_id"],
                    "character_id":item["character_id"],"vote":original,"display_vote":vote,"sample_id":sample}
            identifier=(rater,item["target_id"])
            if identifier in records and records[identifier]!=record:
                raise KCBError("Conflicting votes from the same rater for the same target; resolve explicitly")
            records[identifier]=record
    rows=list(records.values())
    by_target=defaultdict(list)
    for row in rows:
        if row["vote"]!="skip":
            by_target[(row["target_id"],row["character_id"])].append(1.0 if row["vote"]=="A" else 0.0 if row["vote"]=="B" else .5)
    points=[(char,mean(values)) for (_,char),values in by_target.items()]
    summary={"study_id":key["study_id"],"metadata":key["metadata"],"votes":len(rows),
             "rater_count":len({r["rater_id"] for r in rows}),"target_count":len(by_target),
             "planned_targets":len(mapping),"vote_counts":dict(Counter(r["vote"] for r in rows)),
             "A_preference_score":cluster_estimate(points),
             "note":"Anonymous human observations, not proof of population preference. Raters are not modeled as independent bootstrap clusters. both_bad is separately reported and counts as 0.5 in symmetric preference."}
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    write_jsonl(out/"human_votes.jsonl",rows)
    save_json(out/"summary.json",summary)
    safe_csv(out/"human_votes.csv",rows,["study_id","rater_id","target_id","character_id","vote","display_vote"])
    return summary


def calibrate(pairwise_dir,human_dir,out):
    pairwise_dir,human_dir=Path(pairwise_dir),Path(human_dir)
    pm=load_json(pairwise_dir/"manifest.json")
    hs=load_json(human_dir/"summary.json")
    if pm["spec"]["metadata"]["run_snapshots"]!=hs["metadata"]["run_snapshots"]:
        raise KCBError("Human and LLM evaluations are from different response snapshots")
    pairs={r["target_id"]:r for r in read_jsonl(pairwise_dir/"pairwise.jsonl")}
    votes=read_jsonl(human_dir/"human_votes.jsonl")
    cells=defaultdict(list)
    categorical_matches=0;count=0
    for row in votes:
        item=pairs.get(row["target_id"])
        if row["vote"]=="skip" or not item or item["status"]!="stable":
            continue
        match=float(row["vote"]==item["winner"])
        cells[(row["target_id"],row["character_id"])].append(match)
        categorical_matches+=int(match);count+=1
    result={"matched_votes":count,"matched_targets":len(cells),
            "exact_categorical_agreement":categorical_matches/count if count else None,
            "target_macro_cluster_interval":cluster_estimate([(char,mean(v)) for (_,char),v in cells.items()]),
            "human_raters":hs["rater_count"],"unresolved_order_sensitive_excluded":True,
            "note":"Pilot agreement on overlapping stable targets only. Does not certify judge validity, remove selection bias, or validate an overall leaderboard."}
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    save_json(out/"calibration.json",result)
    return result
