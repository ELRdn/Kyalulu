import { describe, expect, it, vi } from 'vitest';
import { conservativeTokens, fitContext } from './context';
import { CONTEXT_TOKENS, OUTPUT_TOKENS, type ChatTurn } from './types';

// Test fixture only: the removal loop from pinned 7d3c80a.
async function oldFitContext(turns:ChatTurn[],count:(t:ChatTurn[])=>number|Promise<number>=conservativeTokens,outputTokens=OUTPUT_TOKENS) {
  if(!Number.isInteger(outputTokens)||outputTokens<1||outputTokens>=CONTEXT_TOKENS)throw Error('Invalid output token reserve');
  const selected=turns.map(t=>({...t}));let omitted=0;
  while(await count(selected)>CONTEXT_TOKENS-outputTokens) {
    const newest=selected.map(m=>m.role).lastIndexOf('user'),index=selected.findIndex((m,i)=>m.role!=='system'&&i<newest);
    if(index<0)throw Error('キャラ設定またはメッセージが長すぎます。短くして再送してください。');
    selected.splice(index,1);omitted++;
    while(selected[index]?.role==='assistant'){selected.splice(index,1);omitted++;}
  }
  return {messages:selected,omitted};
}

const turn=(role:ChatTurn['role'],content:string):ChatTurn=>({role,content});
const outcome=<T>(promise:Promise<T>)=>promise.then(value=>({value}), (error:Error)=>({error:{name:error.name,message:error.message}}));
const freeze=(turns:ChatTurn[])=>{turns.forEach(Object.freeze);Object.freeze(turns);return turns;};

describe('fitContext history selection',()=>{
  it('matches the old loop across removal units and system boundaries without sharing or mutating input',async()=>{
    const fixtures:ChatTurn[][]=[
      [turn('assistant','lead-a'),turn('assistant','lead-b'),turn('system','設定😀'),
        turn('user','old'),turn('assistant','reply-a'),turn('assistant','reply-b'),
        turn('system','middle'),turn('assistant','orphan-a'),turn('assistant','orphan-b'),
        turn('user','latest e\u0301\ud800'),turn('system','tail-system'),turn('assistant','tail-reply')],
      [turn('user','old-a'),turn('user','old-b'),turn('assistant','reply'),turn('system','divider'),turn('user','latest')],
      [turn('system','head'),turn('assistant','old-a'),turn('system','divider'),turn('assistant','old-b'),turn('user','latest')],
      [turn('assistant','no-user-a'),turn('system','setting'),turn('assistant','no-user-b')],
      [],
    ];
    for(const turns of fixtures) {
      const before=turns.map(t=>({...t}));freeze(turns);
      for(const reserve of [256,1024,1536,2047]) {
        const actual=await outcome(fitContext(turns,undefined,reserve));
        expect(actual).toEqual(await outcome(oldFitContext(turns,undefined,reserve)));
        expect(turns).toEqual(before);
        if('value' in actual) {
          expect(actual.value.messages).not.toBe(turns);
          const newest=turns.map(t=>t.role).lastIndexOf('user');
          for(const message of actual.value.messages)expect(turns).not.toContain(message);
          for(const [i,message] of turns.entries()) {
            if(message.role==='system'||(newest>=0&&i>=newest))expect(actual.value.messages).toContainEqual(message);
          }
        }
      }
    }
  });

  it('accepts exact budgets and rejects one-token mandatory overflow while retaining the latest suffix',async()=>{
    const turns=freeze([turn('system','設定'),turn('user','old'),turn('assistant','reply'),
      turn('user','最新😀'),turn('assistant','after-user'),turn('system','post-system')]);
    const mandatory=[turns[0],...turns.slice(3)];
    const reserve=CONTEXT_TOKENS-conservativeTokens(mandatory);
    const exact=await fitContext(turns,conservativeTokens,reserve);
    expect(exact).toEqual(await oldFitContext(turns,undefined,reserve));
    expect(exact).toEqual({messages:mandatory,omitted:2});
    const fullReserve=CONTEXT_TOKENS-conservativeTokens(turns);
    expect(await fitContext(turns,undefined,fullReserve)).toEqual({messages:turns,omitted:0});
    const overflow=await outcome(fitContext(turns,undefined,reserve+1));
    expect(overflow).toEqual(await outcome(oldFitContext(turns,undefined,reserve+1)));
    expect(overflow).toEqual({error:{name:'Error',message:'キャラ設定またはメッセージが長すぎます。短くして再送してください。'}});
  });

  it('preserves async nonadditive callback results and call/resolve traces',async()=>{
    const turns=freeze([turn('system','head'),turn('user','old-a'),turn('assistant','a1'),turn('assistant','a2'),
      turn('system','middle'),turn('user','old-b'),turn('assistant','b1'),turn('user','latest'),turn('assistant','tail')]);
    const counter=()=>{
      const trace:string[]=[];
      const count=vi.fn(async(messages:ChatTurn[])=>{
        trace.push(`call:${messages.map(t=>t.content).join('|')}`);
        await Promise.resolve();
        const value=messages.length%3===0?2200:100;
        trace.push(`resolve:${value}`);
        return value;
      });
      return {count,trace};
    };
    const expected=counter(),actual=counter();
    const result=await fitContext(turns,actual.count);
    expect(result).toEqual(await oldFitContext(turns,expected.count));
    expect(result).toEqual({messages:[turns[0],turns[4],turns[7],turns[8]],omitted:5});
    expect(actual.trace).toEqual(expected.trace);
    expect(actual.count).toHaveBeenCalledTimes(3);
    expect(actual.trace.filter(t=>t.startsWith('resolve:'))).toEqual(['resolve:2200','resolve:2200','resolve:100']);
    expect(actual.count.mock.calls.every(([selected])=>selected===actual.count.mock.calls[0][0])).toBe(true);
  });

  it('encodes only mandatory content when 50k obsolete turns cannot fit',async()=>{
    const head=turn('system','head'),middle=turn('system','middle'),tail=turn('system','tail');
    const budget=CONTEXT_TOKENS-OUTPUT_TOKENS;
    const latest=turn('user','x'.repeat(budget-32-4*128-head.content.length-middle.content.length-tail.content.length));
    const old=Array.from({length:50000},(_,i)=>turn(i%2?'assistant':'user','obsolete'));
    const turns=[head,...old.slice(0,25000),middle,...old.slice(25000),latest,tail];
    // Never run the quadratic reference on the large fixture.
    const encode=vi.spyOn(TextEncoder.prototype,'encode');
    try {
      expect(await fitContext(turns)).toEqual({messages:[head,middle,latest,tail],omitted:50000});
      expect(encode).toHaveBeenCalledTimes(4);
      expect(encode.mock.calls.map(([content])=>content)).toEqual([head.content,middle.content,latest.content,tail.content]);
    } finally {encode.mockRestore();}
  });
});
