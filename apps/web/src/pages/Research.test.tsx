import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import ResearchPage from './Research';
import { fetchExperiments, fetchModels, fetchScenarios, fetchLeaderboard, putRating, replayExperiment, runExperiments, type ExperimentDetail } from '../lib/api';

const hooks = vi.hoisted(() => ({ language:'en', states:[] as unknown[], cursor:0, active:false, effects:[] as { effect:()=>void; deps:unknown[] }[] }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{
    if(!hooks.active)return [initial,()=>{}];
    const slot=hooks.cursor++;
    if(!(slot in hooks.states))hooks.states[slot]=initial;
    return [hooks.states[slot],(value:unknown)=>{hooks.states[slot]=typeof value==='function'?value(hooks.states[slot]):value;}];
  },
  useEffect:(effect:()=>void,deps:unknown[])=>{if(hooks.active)hooks.effects.push({effect,deps});},
  useRef:(initial:unknown)=>({current:initial}),
}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>hooks.language}));
vi.mock('../lib/title',()=>({useDocumentTitle:vi.fn()}));
vi.mock('../lib/api',()=>({fetchExperiments:vi.fn(),fetchExperimentDetail:vi.fn(),putRating:vi.fn(),runExperiments:vi.fn(),fetchModels:vi.fn(),fetchScenarios:vi.fn(),fetchLeaderboard:vi.fn(),replayExperiment:vi.fn()}));
vi.mock('react-router-dom',()=>({Link:({to,children}:{to:string;children:ReactNode})=><a href={to}>{children}</a>}));
vi.mock('../components/RuntimeMedia',()=>({RuntimeDownload:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));
vi.mock('../components/MarkdownView',()=>({default:({content}:{content:string})=><div>{content}</div>}));

function render(component:()=>ReactNode=ResearchPage){
  hooks.active=true;hooks.cursor=0;hooks.effects=[];
  try{return component();}finally{hooks.active=false;}
}
function find(tree:ReactNode,predicate:(node:ReactElement<any>)=>boolean):ReactElement<any>{
  for(const child of Children.toArray(tree)){
    if(!isValidElement<{children?:ReactNode}>(child))continue;
    if(predicate(child))return child;
    try{return find(child.props.children,predicate);}catch{/* Search siblings. */}
  }
  throw Error('Control not found');
}
const button=(tree:ReactNode,text:string)=>find(tree,node=>node.type==='button'&&Children.toArray(node.props.children).join('')===text);
const named=(tree:ReactNode,name:string)=>find(tree,node=>typeof node.type==='function'&&node.type.name===name);
const call=(node:ReactElement<any>)=>render(()=> (node.type as (props:any)=>ReactNode)(node.props));
const meta={experiment_id:'exp_original',scenario_id:'scenario_original',model_id:'model_original',run_number:2,timestamp:'2026-10-26T00:00:00Z',status:'completed',memory_enabled:true};
const detail:ExperimentDetail={meta,raw_prompt:'原文プロンプト',ratings:{'1':{score:4,comment:'元のコメント',rater:'original_rater'}},turns:[{turn:1,type:'chat',user:'元の質問',assistant:'元の応答',elapsed_ms:12,state:{location:'元の場所'},raw_prompt:'原文プロンプト',token_budget:{estimated:42},generation_config:{requested:{temperature:.7},applied:{temperature:.7},unsupported:['seed']}}]};
const board={scope:'official',generated_at:'2026-10-26T00:00:00Z',total_experiments:1,ranking:[{model_id:meta.model_id,runs:2,avg_human:4,auto_score:70,avg_chars:15,avg_failure_rate:0,avg_repetition:0}],excluded:{non_official:1}};
function populated(){
  hooks.states=[[meta],[meta.experiment_id],[{id:meta.model_id}],[{id:meta.scenario_id,official:true}],meta.scenario_id,meta.model_id,2,true,false,null,false,false,board,'official',null,0,null];
  return render();
}
function column(){return named(populated(),'ExperimentColumn');}

beforeEach(()=>{
  hooks.language='en';hooks.states=[];hooks.effects=[];hooks.cursor=0;
  vi.mocked(fetchExperiments).mockReset().mockResolvedValue([]);
  vi.mocked(fetchModels).mockReset().mockResolvedValue([]);
  vi.mocked(fetchScenarios).mockReset().mockResolvedValue([]);
  vi.mocked(fetchLeaderboard).mockReset().mockResolvedValue(board);
  vi.mocked(runExperiments).mockReset().mockResolvedValue([]);
  vi.mocked(replayExperiment).mockReset().mockResolvedValue([]);
  vi.mocked(putRating).mockReset().mockResolvedValue();
});

it.each(['en','ja'])('localizes %s controls and ranking without changing experiment identifiers',language=>{
  hooks.language=language;
  const tree=populated(),html=renderToStaticMarkup(tree),en=language==='en';
  expect(html).toContain(en?'Long-turn and memory benchmarks':'長ターン・記憶の比較実験');
  expect(html).toContain(en?'Human rating':'人手評価');
  expect(html).toContain(en?'All (reference)':'全件 (参考)');
  expect(html).toContain(en?'No experiment selected':'未選択');
  expect(html).toContain('exp_original');expect(html).toContain('scenario_original');expect(html).toContain('model_original');
  expect(find(tree,n=>n.props['aria-label']===(en?'Scenario':'シナリオ')).props.value).toBe(meta.scenario_id);
  expect(find(tree,n=>n.props['aria-label']===(en?'Model':'モデル')).props.value).toBe(meta.model_id);
});

it('switches language without rerunning experiments or changing filters, and sends only on Run',async()=>{
  populated();const deps=hooks.effects.map(e=>e.deps);
  hooks.language='ja';let tree=render();
  expect(hooks.effects.map(e=>e.deps)).toEqual(deps);
  expect(fetchExperiments).not.toHaveBeenCalled();expect(runExperiments).not.toHaveBeenCalled();
  expect(find(tree,n=>n.type==='input'&&n.props.type==='number').props.value).toBe(2);
  await button(tree,'▶ 実行').props.onClick();
  expect(runExperiments).toHaveBeenCalledExactlyOnceWith(meta.scenario_id,meta.model_id,2,undefined,false,true);
  expect(fetchExperiments).toHaveBeenCalledWith(50,false);
  tree=render();await button(tree,'全件 (参考)').props.onClick();
  expect(fetchLeaderboard).toHaveBeenLastCalledWith('all');
});

it('retains run failures for display in either language without retrying',async()=>{
  vi.mocked(runExperiments).mockRejectedValue(Error('Failed to fetch'));
  await button(populated(),'▶ Run').props.onClick();
  expect(renderToStaticMarkup(render())).toContain('Could not connect to the server.');
  hooks.language='ja';const html=renderToStaticMarkup(render());
  expect(html).toContain('サーバーに接続できませんでした。');expect(html).toContain('role="alert"');
  expect(runExperiments).toHaveBeenCalledTimes(1);
});

it('keeps raw prompts, measurements, replay identifiers and export routes intact',async()=>{
  const node=column();hooks.states=[detail,false,false,null];
  const tree=call(node),html=renderToStaticMarkup(tree);
  expect(html).toContain('元の質問');expect(html).toContain('元の応答');expect(html).toContain('原文プロンプト');
  expect(html).toContain('/api/experiments/exp_original/export');
  const deps=hooks.effects.map(e=>e.deps);
  await button(tree,'↻ Replay').props.onClick();
  expect(replayExperiment).toHaveBeenCalledExactlyOnceWith('exp_original',false);
  hooks.language='ja';expect(renderToStaticMarkup(call(node))).toContain('↻ 再実行');
  expect(hooks.effects.map(e=>e.deps)).toEqual(deps);
});

it('keeps rating drafts on language changes and submits original rater and text only on Save',async()=>{
  const node=column();hooks.states=[detail,false,false,null];
  const rating=named(call(node),'RatingEditor');hooks.states=[];
  let tree=call(rating);
  find(tree,n=>n.props['aria-label']==='Comment (optional)').props.onChange({target:{value:'編集中の日本語'}});
  const stars=named(tree,'Stars');hooks.language='ja';tree=call(rating);
  expect(find(tree,n=>n.props['aria-label']==='コメント（任意）').props.value).toBe('編集中の日本語');
  expect(putRating).not.toHaveBeenCalled();
  await button(tree,'保存').props.onClick();
  expect(putRating).toHaveBeenCalledExactlyOnceWith('exp_original',1,4,'編集中の日本語','original_rater');
  hooks.states=[];expect(renderToStaticMarkup(call(stars))).toContain('5段階中4で評価');
});

it('translates rating errors without dropping the HTTP status or resending',async()=>{
  const node=column();hooks.states=[detail,false,false,null];
  const rating=named(call(node),'RatingEditor');hooks.states=[];
  vi.mocked(putRating).mockRejectedValue(Object.assign(Error('denied'),{status:403}));
  await button(call(rating),'Save').props.onClick();
  expect(renderToStaticMarkup(call(rating))).toContain('You do not have permission');
  hooks.language='ja';expect(renderToStaticMarkup(call(rating))).toContain('この内容を表示・操作する権限がありません。');
  expect(putRating).toHaveBeenCalledTimes(1);
});

it('discards a late rating response after the column switches to another experiment',()=>{
  const node=column();hooks.states=[detail,false,false,null];
  const rating=named(call(node),'RatingEditor');
  const next={...detail,meta:{...meta,experiment_id:'exp_next'},ratings:{}};
  hooks.states[0]=next;
  rating.props.onSaved(1,{score:5,comment:'Old experiment only',rater:'local'});
  expect(hooks.states[0]).toBe(next);
});

it('preserves inspector selection and labels estimated tokens accurately in both languages',()=>{
  const node=column();hooks.states=[detail,false,false,null];
  const inspector=named(call(node),'TurnInspector');hooks.states=[];
  let tree=call(inspector);button(tree,'Tokens').props.onClick();
  expect(renderToStaticMarkup(call(inspector))).toContain('Estimated tokens (not measured usage)');
  hooks.language='ja';tree=call(inspector);
  expect(renderToStaticMarkup(tree)).toContain('推定トークン（実測値ではありません）');
  expect(button(tree,'トークン').props['aria-pressed']).toBe(true);
  button(tree,'生成設定').props.onClick();
  expect(renderToStaticMarkup(call(inspector))).toContain('unsupported: 未対応');
});
