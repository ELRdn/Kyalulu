import { describe, expect, it, vi } from 'vitest';
import { materializeGGUFRuns, planGGUFContext, planGGUFSourceContext, selectGGUFHistory } from './context';
import type { GGUFRun, GGUFSourceInput, GGUFSourceRun } from './context';
import { CONTEXT_TOKENS, type ChatTurn } from './types';

// Frozen reference behavior from 7b1f209: merge and whole-unit removal, independent of production helpers.
function oldSelection(turns:ChatTurn[],reserve:number,native?:number) {
  const merged:GGUFRun[]=[];
  for(const turn of turns) {
    const previous=merged.at(-1);
    if(previous?.role===turn.role)previous.content+='\n\n'+turn.content;
    else merged.push({run:merged.length,role:turn.role,content:turn.content});
  }
  const bytes=(run:GGUFRun)=>new TextEncoder().encode(run.content).length+128;
  let newest=-1;for(const run of merged)if(run.role==='user')newest=run.run;
  const mandatory=merged.filter(run=>run.role==='system'||newest<0||run.run>=newest);
  const budget=CONTEXT_TOKENS-reserve,proxy=32+mandatory.reduce((n,run)=>n+bytes(run),0);
  const base=proxy>budget?native:proxy;
  if(base===undefined||base>budget)throw Error('overflow');
  const messages=[...merged];
  while(base+messages.filter(run=>!mandatory.includes(run)).reduce((n,run)=>n+bytes(run),0)>budget) {
    const index=messages.findIndex(run=>run.role!=='system'&&run.run<newest);
    if(index<0)throw Error('overflow');
    messages.splice(index,1);
    while(messages[index]?.role==='assistant'){messages.splice(index,1);}
  }
  return {merged,mandatory,history:messages.filter(run=>!mandatory.includes(run)),omitted:merged.length-messages.length};
}
function input(runs:GGUFRun[],outputTokens=256) {
  const materialize=vi.fn(async(selected:readonly GGUFSourceRun[])=>selected.map(run=>({...runs[run.run]})));
  const source:GGUFSourceInput={format:'gguf-source@1',outputTokens,
    runs:runs.map(({run,role,content})=>({run,role,bytes:new TextEncoder().encode(content).length})),materialize};
  return {source,materialize};
}
const outcome=<T>(action:()=>T)=>{try{return {value:action()};}catch{return {error:'overflow'};}};

describe('descriptor GGUF context',()=>{
  it('matches an independent old-helper oracle across role boundaries, exact budgets and native rescue',async()=>{
    const roles:ChatTurn['role'][]=['system','user','assistant'];
    for(let length=0;length<=5;length++)for(let code=0;code<3**length;code++) {
      let remaining=code;
      const turns=Array.from({length},(_,i)=>{
        const role=roles[remaining%3];remaining=Math.floor(remaining/3);
        return Object.freeze({role,content:['','x'.repeat(240),'😀e\u0301\ud800','\udc00'][(code+i)%4]});
      });
      Object.freeze(turns);
      // Even fixtures that overflow have a stable independent merged representation.
      const merged:GGUFRun[]=[];
      for(const turn of turns) {
        const last=merged.at(-1);
        if(last?.role===turn.role)last.content+='\n\n'+turn.content;
        else merged.push({run:merged.length,...turn});
      }
      for(const reserve of [256,1024,1536,2047]) {
        const {source}=input(merged,reserve),plan=planGGUFSourceContext(source);
        for(const native of [0,100,CONTEXT_TOKENS-reserve,CONTEXT_TOKENS-reserve+1]) {
          const expected=outcome(()=>oldSelection(turns,reserve,native).history);
          const selected=outcome(()=>selectGGUFHistory(plan,native));
          expect('error' in selected?selected:{value:await plan.materialize(selected.value!)}).toEqual(expected);
          const oldPlan=planGGUFContext(turns,reserve);
          expect(outcome(()=>materializeGGUFRuns(oldPlan,selectGGUFHistory(oldPlan,native)))).toEqual(expected);
        }
        expect(plan.mandatory.map(run=>run.run)).toEqual(merged.filter(run=>run.role==='system'||plan.newestUserRun<0||run.run>=plan.newestUserRun).map(run=>run.run));
      }
    }
  });

  it('snapshots and freezes descriptors and pins the replay function',async()=>{
    const bodies:GGUFRun[]=[{run:0,role:'user',content:'old'},{run:1,role:'assistant',content:'reply'},{run:2,role:'user',content:'latest'}];
    const {source,materialize}=input(bodies),plan=planGGUFSourceContext(source);
    source.runs[0].bytes=99999;source.runs[2].role='system';source.runs.splice(0);
    source.outputTokens=2047;source.materialize=()=>{throw Error('replaced');};
    expect(plan.budget).toBe(1792);expect(plan.newestUserRun).toBe(2);
    expect(Object.isFrozen(plan.runs)).toBe(true);expect(plan.runs.every(Object.isFrozen)).toBe(true);
    expect(await plan.materialize(selectGGUFHistory(plan))).toEqual(bodies.slice(0,2));
    const requested=materialize.mock.calls[0][0];
    expect(Object.isFrozen(requested)).toBe(true);expect(requested.every(Object.isFrozen)).toBe(true);
    const result=await plan.materialize(plan.mandatory);bodies[2].content='mutated';
    expect(result).toEqual([{run:2,role:'user',content:'latest'}]);
  });

  it('validates dense ordered descriptors before replay, including omitted history',()=>{
    const {source,materialize}=input([{run:0,role:'assistant',content:'old'},{run:1,role:'user',content:'latest'}]);
    const invalid:unknown[]=[null,{}, {...source,format:'other'}, {...source,materialize:null}, {...source,runs:{}},
      {...source,runs:Array(1)}, {...source,runs:[undefined]}, {...source,runs:[null]},
      ...[-1,1,0.5,NaN].map(run=>({...source,runs:[{run,role:'user',bytes:0}]})),
      ...[-1,0.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1].map(bytes=>({...source,runs:[{run:0,role:'user',bytes}]})),
      {...source,runs:[{run:0,role:'tool',bytes:0}]},
      {...source,runs:[{run:0,role:'user',bytes:0},{run:1,role:'user',bytes:0}]},
      {...source,runs:[{run:0,role:'assistant',bytes:0},,{run:2,role:'user',bytes:0}]},
      ...[0,-1,0.5,2048,NaN].map(outputTokens=>({...source,outputTokens})),
    ];
    const inherited=Array<GGUFSourceRun>(1);
    Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:{run:0,role:'user',bytes:0}}));
    invalid.push({...source,runs:inherited});
    for(const value of invalid)expect(()=>planGGUFSourceContext(value as GGUFSourceInput)).toThrow();
    expect(materialize).not.toHaveBeenCalled();
  });

  it('requires exact materialized count, order, identity, roles and UTF-8 bytes',async()=>{
    const runs:GGUFRun[]=[{run:0,role:'system',content:'😀'},{run:1,role:'user',content:'\ud800'}];
    const {source}=input(runs);
    const invalid:unknown[]=[null,{},[],[runs[0]],Array(2),[runs[1],runs[0]],
      [{...runs[0],run:1},runs[1]],[{...runs[0],role:'assistant'},runs[1]],
      [{...runs[0],content:'abc'},runs[1]],[runs[0],{...runs[1],content:''}],
      [runs[0],{...runs[1],content:new String('\ud800')}],
    ];
    for(const result of invalid) {
      source.materialize=async()=>result as GGUFRun[];
      const plan=planGGUFSourceContext(source);
      await expect(plan.materialize(plan.mandatory)).rejects.toThrow('Invalid GGUF materialization');
    }
    source.materialize=async()=>runs;
    const plan=planGGUFSourceContext(source);
    expect(await plan.materialize(plan.mandatory)).toEqual(runs);
  });

  it('accepts merged mandatory strings above the per-original-message cap',async()=>{
    const runs:GGUFRun[]=[{run:0,role:'system',content:'x'.repeat(256002)},{run:1,role:'user',content:'latest'}];
    const {source,materialize}=input(runs),plan=planGGUFSourceContext(source);
    expect(await plan.materialize(plan.mandatory)).toEqual(runs);
    expect(selectGGUFHistory(plan,100)).toEqual([]);
    expect(materialize).toHaveBeenCalledTimes(1);
  });
});
