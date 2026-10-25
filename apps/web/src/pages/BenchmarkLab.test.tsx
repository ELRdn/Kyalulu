import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import BenchmarkLab from './BenchmarkLab';
import { labRequest, type BenchmarkJob } from '../lib/lab';

const hooks=vi.hoisted(()=>({language:'en',states:[] as unknown[],refs:[] as {current:any}[],cursor:0,refCursor:0,active:false,effects:[] as unknown[][]}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
  useState:(initial:unknown)=>{
    if(!hooks.active)return [initial,()=>{}];
    const slot=hooks.cursor++;
    if(!(slot in hooks.states))hooks.states[slot]=initial;
    return [hooks.states[slot],(value:unknown)=>{hooks.states[slot]=typeof value==='function'?value(hooks.states[slot]):value;}];
  },
  useRef:(initial:unknown)=>hooks.refs[hooks.refCursor++]??(hooks.refs[hooks.refCursor-1]={current:initial}),
  useEffect:(_effect:unknown,deps:unknown[])=>{if(hooks.active)hooks.effects.push(deps);},
}));
vi.mock('../lib/appContext',()=>({useLanguage:()=>hooks.language}));
vi.mock('../lib/title',()=>({useDocumentTitle:vi.fn()}));
vi.mock('../lib/api',()=>({fetchModels:vi.fn(),fetchScenarios:vi.fn()}));
vi.mock('../lib/lab',()=>({labRequest:vi.fn()}));
vi.mock('react-router-dom',()=>({Link:({to,children}:{to:string;children:ReactNode})=><a href={to}>{children}</a>}));
vi.mock('../components/RuntimeMedia',()=>({RuntimeDownload:({href,children}:{href:string;children:ReactNode})=><a href={href}>{children}</a>}));

const job:BenchmarkJob={id:'job_original',status:'completed',created_at:'2026-10-26T00:00:00Z',planned_runs:1,planned_turns:20,current:null,
  results:[{experiment_id:'exp_original',model_id:'model_original',scenario_id:'scenario_original',memory_enabled:true,seed:123,status:'completed',metrics:{avg_elapsed_ms:1250,turn_count:20,failure_rate:0,memory:{recall_rate:1,recalled:2,probes:2,hallucinated:0,outcomes:{}}}}]};
function render(){
  hooks.active=true;hooks.cursor=0;hooks.refCursor=0;hooks.effects=[];
  try{return BenchmarkLab();}finally{hooks.active=false;}
}
function find(tree:ReactNode,predicate:(node:ReactElement<any>)=>boolean):ReactElement<any>{
  for(const child of Children.toArray(tree)){
    if(!isValidElement<{children?:ReactNode}>(child))continue;
    if(predicate(child))return child;
    try{return find(child.props.children,predicate);}catch{/* Search siblings. */}
  }
  throw Error('Control not found');
}
const button=(tree:ReactNode,text:string)=>find(tree,node=>node.props.children===text);
const submit=(tree:ReactNode)=>find(tree,n=>n.type==='form').props.onSubmit({preventDefault:()=>{}});
beforeEach(()=>{
  hooks.language='en';hooks.refs=[];
  hooks.states=[[{id:'model_original',display_name:'元のモデル名'}],[{id:'scenario_original',turns:20}],['model_original'],'scenario_original','compare',2,123,7,600,false,4,[job],false,null];
  vi.mocked(labRequest).mockReset().mockResolvedValue(job);
});

it.each(['en','ja'])('shows %s limits and statuses while retaining original result evidence',language=>{
  hooks.language=language;const html=renderToStaticMarkup(render()),en=language==='en';
  expect(html).toContain(en?'Each experiment is limited to 60 minutes.':'1実験の上限は60分です。');
  expect(html).toContain(en?'do not count as model quality evidence':'モデルの品質評価には数えません');
  expect(html).toContain(en?'Forbidden-word matches':'禁止語一致');
  expect(html).toContain(en?'Completed':'完了');
  expect(html).toContain(en?'1.25s':'1.25秒');
  expect(html).toContain('元のモデル名');expect(html).toContain('model_original');expect(html).toContain('2/2');
  expect(html).toContain('/api/benchmarks/job_original/export');
  expect(labRequest).not.toHaveBeenCalled();
});

it('keeps the retry request ID, seed and memory conditions across a language change',async()=>{
  vi.mocked(labRequest).mockRejectedValueOnce(Object.assign(Error('denied'),{status:403})).mockResolvedValueOnce(job);
  submit(render());
  await vi.waitFor(()=>expect(hooks.states[12]).toBe(false));
  const first=JSON.parse(vi.mocked(labRequest).mock.calls[0][1]!.body as string);
  expect(first).toMatchObject({model_ids:['model_original'],scenarios:['scenario_original'],runs:2,seed:123,memory:'compare',history_turn_limit:4,memory_options:{top_k:7,budget_tokens:600,fill_recent:false}});
  expect(renderToStaticMarkup(render())).toContain('You do not have permission');
  const deps=hooks.effects;hooks.language='ja';const tree=render();
  expect(hooks.effects).toEqual(deps);expect(renderToStaticMarkup(tree)).toContain('この内容を表示・操作する権限がありません。');
  expect(labRequest).toHaveBeenCalledTimes(1);
  submit(tree);await vi.waitFor(()=>expect(labRequest).toHaveBeenCalledTimes(2));
  const second=JSON.parse(vi.mocked(labRequest).mock.calls[1][1]!.body as string);
  expect(second).toEqual(first);expect(first.request_id).toMatch(/^[0-9a-f-]{36}$/);
});

it('retains active-job admission and cancels only the chosen job after explicit action',async()=>{
  hooks.states[11]=[{...job,status:'running',current:{model_id:'model_original',scenario_id:'scenario_original',run:1,memory:true,turns_completed:3,turns_planned:20}}];
  let tree=render();expect(find(tree,n=>n.props.type==='submit').props.disabled).toBe(true);
  hooks.language='ja';tree=render();expect(labRequest).not.toHaveBeenCalled();
  await button(tree,'実験を中止').props.onClick();
  expect(labRequest).toHaveBeenCalledExactlyOnceWith('benchmarks/job_original/cancel',{method:'POST'});
});
