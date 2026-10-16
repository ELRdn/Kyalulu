"""Render saved final outputs for human review; no API calls or translation."""

import argparse
import hashlib
import json
from pathlib import Path


HTML = r'''<!doctype html><html lang="ja"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kyalulu 原文レビュー</title>
<style>
body{font:16px/1.7 system-ui,sans-serif;background:#f3f6f9;color:#142332;margin:0}
main{max-width:980px;margin:auto;padding:24px}header{position:sticky;top:0;background:#f3f6f9;padding:12px 0;z-index:1}
h1{font-size:24px;margin:0}button,select,input,textarea{font:inherit;border:1px solid #a9b8c8;border-radius:7px;padding:7px;background:white}
button{cursor:pointer}article{background:white;border:1px solid #d4e0eb;border-radius:12px;padding:20px;margin:18px 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;background:#eef4fa;padding:14px;border-radius:7px}
small{color:#405364}textarea{width:100%;box-sizing:border-box;min-height:85px}label{display:inline-block;margin:6px 12px 6px 0}
.error{color:#8b1e1e}.controls{display:flex;flex-wrap:wrap;gap:9px}.scores select{min-width:65px}
summary{cursor:pointer}#count{margin-top:8px}
</style><main><header><h1>Kyalulu 原文レビュー</h1>
<p>架空の会話。返答は翻訳・要約せず掲載。機械的な一致と人間評価を区別しています。<br>
モデル名は初期状態で伏せています。評価はこのブラウザだけに保存し、JSONで書き出せます。</p>
<div class="controls"><select id="phase" aria-label="検証種類"><option value="friendly">馴れ馴れしいRP</option><option value="conversation">会話</option><option value="all">全種類</option><option value="safety">SFW判定</option><option value="vision">画像</option><option value="long">長文</option></select>
<select id="lang" aria-label="言語"><option value="all">全言語</option><option value="ja">日本語</option><option value="en">英語</option></select>
<select id="model" aria-label="候補"><option value="all">全候補</option></select>
<label><input type="checkbox" id="reveal">モデル名・原価を表示</label><button id="export">評価JSONを保存</button></div>
<div id="count"></div></header><section id="cards"></section></main>
<script id="evidence" type="application/json">__DATA__</script>
<script>
const data=JSON.parse(document.getElementById('evidence').textContent),rows=data.rows;
const storageKey='kyalulu-human-review:'+data.run_id;
let grades={};try{grades=JSON.parse(localStorage.getItem(storageKey)||'{}')}catch{}
const aliases={};for(const r of rows)if(!(r.candidate in aliases))aliases[r.candidate]='候補 '+String.fromCharCode(65+Object.keys(aliases).length);
const $=id=>document.getElementById(id);
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n}
function save(){try{localStorage.setItem(storageKey,JSON.stringify(grades))}catch{$('count').textContent='ブラウザ保存が使えません。JSONを書き出してください。'}}
function models(){const value=$('model').value;$('model').replaceChildren(node('option','全候補'));$('model').firstChild.value='all';
for(const [candidate,alias]of Object.entries(aliases)){const opt=node('option',$('reveal').checked?candidate:alias);opt.value=candidate;$('model').append(opt)}$('model').value=value||'all'}
function render(){const selected=rows.filter(r=>($('phase').value==='all'||r.phase===$('phase').value||($('phase').value==='friendly'&&r.friendly_style))&&($('lang').value==='all'||r.language===$('lang').value)&&($('model').value==='all'||r.candidate===$('model').value));
$('cards').replaceChildren();$('count').textContent=selected.length+'件 / 記録済み '+Object.keys(grades).length+'件';
for(const r of selected){const card=node('article');card.append(node('h2',($('reveal').checked?r.candidate:aliases[r.candidate])+' · '+(r.friendly_style||r.language||r.fixture||r.phase)+' · '+(r.turn?'反復'+r.repetition+' / '+r.turn+'ターン目':r.phase)));
card.append(node('small',r.human_focus||'期待判定と原文を比較'));
if(r.status!=='passed'){const p=node('p','応答の検証不成立: '+(r.error||r.status));p.className='error';card.append(p)}
card.append(node('h3','入力（架空）'),node('pre',r.user||r.question||''),node('h3',r.reply?'返答原文':'最終出力原文'),node('pre',r.reply||r.output||'出力なし'));
const details=node('details');details.append(node('summary','機械判定・構造・保存記憶の詳細'));const detail={status:r.status,contract:r.contract,friendly_style:r.friendly_style,keyword_probe_passed:r.keyword_probe_passed,fixture_passed:r.fixture_passed,expected:r.expected,expected_sfw:r.expected_sfw,memory_block:r.memory_block,memory_trace:r.memory_trace,raw_final_content:r.output};
if($('reveal').checked){detail.candidate=r.candidate;detail.cost_usd=r.actual_cost_usd;detail.elapsed_ms=r.elapsed_ms;detail.label=r.label}details.append(node('pre',JSON.stringify(detail,null,2)));card.append(details);
const scores=node('div');scores.className='scores';const saved=grades[r.label]||{};
for(const [key,title]of [['naturalness','自然さ'],['persona','人格'],['memory','記憶'],['safety','安全性']]){const label=node('label',title+' '),select=node('select');select.setAttribute('aria-label',title);for(const value of ['',1,2,3,4,5,'n/a']){const opt=node('option',value===''?'未評価':String(value));opt.value=value;select.append(opt)}select.value=saved[key]??'';select.onchange=()=>{grades[r.label]={...grades[r.label],[key]:select.value,updated_at:new Date().toISOString()};save()};label.append(select);scores.append(label)}card.append(scores);
const notes=node('textarea');notes.placeholder='問題の箇所・良かった点・理由（自分の評価）';notes.setAttribute('aria-label','評価理由');notes.value=saved.notes||'';notes.oninput=()=>{grades[r.label]={...grades[r.label],notes:notes.value,updated_at:new Date().toISOString()};save()};card.append(notes);$('cards').append(card)} }
for(const id of ['phase','lang','model'])$(id).onchange=render;$('reveal').onchange=()=>{models();render()};
$('export').onclick=()=>{const review={kind:'human_review',run_id:data.run_id,exported_at:new Date().toISOString(),evidence_sha256:data.evidence_sha256,ratings:Object.entries(grades).map(([label,grade])=>{const source=rows.find(r=>r.label===label);return {label,...grade,prompt_sha256:source?.prompt_sha256,response_sha256:source?.response_sha256}})};
const url=URL.createObjectURL(new Blob([JSON.stringify(review,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='kyalulu-human-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};models();render();
if(!rows.some(r=>r.friendly_style)){$('phase').value='conversation';render()}
</script></html>'''


def render(evidence):
    raw = evidence.read_bytes()
    data = json.loads(raw)
    rows = []
    for record in data["requests"]:
        row = dict(record)
        row["prompt_sha256"] = hashlib.sha256((row.get("user") or row.get("question") or "").encode()).hexdigest()
        row["response_sha256"] = hashlib.sha256(row.get("output", "").encode()).hexdigest()
        rows.append(row)
    payload = {"run_id": data["storage_owner"], "evidence_sha256": hashlib.sha256(raw).hexdigest(), "rows": rows}
    encoded = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    output = evidence.parent / "human-review.html"
    output.write_text(HTML.replace("__DATA__", encoded), encoding="utf-8")
    print(json.dumps({"review": str(output.resolve()), "rows": len(rows)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("evidence", type=Path)
    render(parser.parse_args().evidence)
