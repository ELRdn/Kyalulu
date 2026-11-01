import { describe, expect, it, vi } from 'vitest';
import { admitGGUFTurns, conservativeTokens, materializeGGUFRuns, mergeTurns, planGGUFContext, selectGGUFHistory, validateTurns } from './context';
import { CONTEXT_TOKENS, OUTPUT_TOKENS, type ChatTurn } from './types';

const turn=(role:ChatTurn['role'],content:string):ChatTurn=>({role,content});
const freeze=<T extends ChatTurn>(turns:T[])=>{turns.forEach(Object.freeze);Object.freeze(turns);return turns;};
const outcome=async(action:()=>unknown)=>{
  try {return {value:await action()};}
  catch(error) {const e=error as Error;return {error:{name:e.name,message:e.message}};}
};
// Independent removal loop from pinned 7d3c80a; do not share the new selector.
async function oracle(turns:ChatTurn[],reserve=OUTPUT_TOKENS) {
  if(!Number.isInteger(reserve)||reserve<1||reserve>=CONTEXT_TOKENS)throw Error('Invalid output token reserve');
  const messages=mergeTurns(turns);let omitted=0;
  while(conservativeTokens(messages)>CONTEXT_TOKENS-reserve) {
    const newest=messages.map(message=>message.role).lastIndexOf('user');
    const index=messages.findIndex((message,i)=>message.role!=='system'&&i<newest);
    if(index<0)throw Error('キャラ設定またはメッセージが長すぎます。短くして再送してください。');
    messages.splice(index,1);omitted++;
    while(messages[index]?.role==='assistant'){messages.splice(index,1);omitted++;}
  }
  return {messages,omitted};
}

describe('admitGGUFTurns',()=>{
  it('preserves the legacy candidate despite mandatory native overflow and snapshots source values',()=>{
    const turns=[turn('user','old'),turn('assistant','reply'),turn('user','latest')],plan=planGGUFContext(turns);
    turns[0].content='mutated';
    expect(materializeGGUFRuns(plan,selectGGUFHistory(plan,1900)).map(({content})=>content)).toEqual(['old','reply']);
  });
  it('rescues mandatory proxy overflow with a bounded whole-unit history heuristic',()=>{
    const turns=freeze([turn('system','あ'.repeat(2000)),turn('user','obsolete'.repeat(1000)),turn('assistant','old reply'),turn('user','latest')]);
    const plan=planGGUFContext(turns);
    expect(plan.legacy).toBeNull();expect(selectGGUFHistory(plan,1700)).toEqual([]);
    expect(materializeGGUFRuns(plan,plan.mandatory)).toEqual([{run:0,...turns[0]},{run:3,...turns[3]}]);
    expect(()=>selectGGUFHistory(plan,1793)).toThrow('長すぎ');
  });
  it('does not reapply original message cap to a materialized mandatory run',()=>{
    const plan=planGGUFContext([turn('system','x'.repeat(128000)),turn('system','y'.repeat(128000)),turn('user','latest')]);
    expect(materializeGGUFRuns(plan,plan.mandatory)[0].content.length).toBe(256002);
    expect(selectGGUFHistory(plan,100)).toEqual([]);
  });
  it('matches merge then fit across empty fragments, Unicode, system barriers and trailing assistants',async()=>{
    const fixtures:ChatTurn[][]=[
      [],
      [turn('user','')],
      [turn('system',''),turn('system',''),turn('user',''),turn('user',''),turn('assistant','')],
      [turn('assistant','leading'),turn('assistant','\ud800'),turn('system','設定😀'),turn('system',''),
        turn('user','old'),turn('user','e\u0301'),turn('assistant','reply'),
        turn('system','middle'),turn('assistant','orphan'),turn('assistant',''),
        turn('user','最新\ud800'),turn('user','\udc00'),turn('assistant','tail'),turn('system','end')],
      [turn('user','\ud800'),turn('user','\udc00'),turn('assistant','😀\ud800x\udc00\ufffd\u0000')],
      [turn('assistant','a'),turn('assistant','b'),turn('system','setting'),turn('assistant','c')],
      [turn('system','s'.repeat(1800)),turn('system','')],
      [turn('assistant','a'.repeat(1800)),turn('assistant','')],
    ];
    for(const turns of fixtures) {
      const before=turns.map(t=>({...t}));freeze(turns);
      for(const reserve of [1,256,512,1024,1536,2047]) {
        expect(await outcome(()=>admitGGUFTurns(turns,reserve))).toEqual(await outcome(()=>oracle(turns,reserve)));
      }
      expect(turns).toEqual(before);
    }
  });

  it('matches the oracle for every role sequence through five turns at several budgets',async()=>{
    const roles:ChatTurn['role'][]=['system','user','assistant'];
    const contents=['','x'.repeat(240),'😀e\u0301\ud800','\udc00'];
    for(let length=0;length<=5;length++) {
      for(let code=0;code<3**length;code++) {
        let remaining=code;
        const turns=freeze(Array.from({length},(_,i)=>{
          const role=roles[remaining%3];remaining=Math.floor(remaining/3);
          return turn(role,contents[(code+i)%contents.length]);
        }));
        for(const reserve of [256,1024,1536,2047]) {
          expect(await outcome(()=>admitGGUFTurns(turns,reserve))).toEqual(await outcome(()=>oracle(turns,reserve)));
        }
      }
    }
  });

  it('is synchronous, preserves first-turn metadata and returns copies without mutating originals',async()=>{
    const turns=freeze([
      {...turn('system','one'),id:'first-system'}, {...turn('system','two'),id:'second-system'},
      {...turn('user','hello'),id:'first-user',extra:7}, {...turn('user','world'),id:'second-user'},
    ]);
    const result=admitGGUFTurns(turns);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual(await oracle(turns));
    expect(result).toEqual({messages:[
      {role:'system',content:'one\n\ntwo',id:'first-system'},
      {role:'user',content:'hello\n\nworld',id:'first-user',extra:7},
    ],omitted:0});
    expect(result.messages).not.toBe(turns);
    for(const message of result.messages)expect(turns).not.toContain(message);
    result.messages[0].content='changed';
    expect(turns[0].content).toBe('one');
  });

  it('uses exact UTF-8 plus two LF bytes per fragment boundary at budget edges',async()=>{
    const turns=freeze([turn('system','設定'),turn('system',''),turn('user','old'),turn('user','history'),
      turn('assistant','reply'),turn('user','最新\ud800'),turn('user','\udc00'),
      turn('assistant','😀'),turn('assistant',''),turn('system','tail')]);
    const merged=mergeTurns(turns),mandatory=[merged[0],...merged.slice(3)];
    expect(merged[3].content).toBe('最新\ud800\n\n\udc00');
    const exactReserve=CONTEXT_TOKENS-conservativeTokens(mandatory);
    expect(admitGGUFTurns(turns,exactReserve)).toEqual({messages:mandatory,omitted:2});
    expect(admitGGUFTurns(turns,CONTEXT_TOKENS-conservativeTokens(merged))).toEqual({messages:merged,omitted:0});
    for(const reserve of [exactReserve-1,exactReserve,exactReserve+1]) {
      expect(await outcome(()=>admitGGUFTurns(turns,reserve))).toEqual(await outcome(()=>oracle(turns,reserve)));
    }
    expect(()=>admitGGUFTurns(turns,exactReserve+1)).toThrow('キャラ設定またはメッセージが長すぎます。短くして再送してください。');
  });

  it('keeps systems separate after omission and commits assistant groups only at system barriers',async()=>{
    const turns=freeze([turn('system','head'),turn('user','old'.repeat(1000)),turn('user',''),
      turn('system','middle'),turn('assistant','orphan-a'),turn('assistant','orphan-b'),
      turn('user','latest'),turn('assistant','tail'),turn('assistant','reply')]);
    const expected=[turns[0],turns[3],turn('assistant','orphan-a\n\norphan-b'),turns[6],turn('assistant','tail\n\nreply')];
    const reserve=CONTEXT_TOKENS-conservativeTokens(expected);
    expect(admitGGUFTurns(turns,reserve)).toEqual({messages:expected,omitted:1});
    expect(admitGGUFTurns(turns,reserve)).toEqual(await oracle(turns,reserve));
    expect(admitGGUFTurns(turns,reserve+1)).toEqual({messages:[...expected.slice(0,2),...expected.slice(3)],omitted:2});
  });

  it('preserves reserve validation and defaults',async()=>{
    const turns=freeze([turn('user','hi')]);
    expect(admitGGUFTurns(turns)).toEqual(admitGGUFTurns(turns,OUTPUT_TOKENS));
    for(const reserve of [0,-1,0.5,NaN,Infinity,-Infinity,CONTEXT_TOKENS,CONTEXT_TOKENS+1]) {
      expect(()=>admitGGUFTurns(turns,reserve)).toThrow('Invalid output token reserve');
      expect(await outcome(()=>admitGGUFTurns(turns,reserve))).toEqual(await outcome(()=>oracle(turns,reserve)));
    }
  });

  it('validates every original turn including holes before encoding or omitting anything',()=>{
    const latest=turn('user','latest');
    const invalid:unknown[]=[null,undefined,{},'turns',{0:latest,length:1},
      [undefined,latest],[null,latest],[false,latest],[123,latest],
      [{role:'tool',content:'old'},latest],[{role:'User',content:'old'},latest],
      [{content:'old'},latest],[{role:'user'},latest],
      [{role:'user',content:123},latest],[{role:'user',content:new String('old')},latest],
      [turn('assistant','x'.repeat(128001)),latest],
      [turn('user','😀'.repeat(64001)),latest],
      Array(1),[turn('user','old'),,latest],[latest,,],
      [turn('system','x'.repeat(128000)),latest,{role:'tool',content:'invalid after mandatory overflow'}],
    ];
    // A prototype value does not make an array hole a valid original turn.
    const inherited=Array<ChatTurn>(1);
    Object.setPrototypeOf(inherited,Object.assign(Object.create(Array.prototype),{0:latest}));
    invalid.push(inherited);
    const encode=vi.spyOn(TextEncoder.prototype,'encode');
    try {
      for(const value of invalid) {
        expect(()=>validateTurns(value as ChatTurn[])).toThrow('会話データが不正です。');
        expect(()=>admitGGUFTurns(value as ChatTurn[])).toThrow('会話データが不正です。');
      }
      expect(encode).not.toHaveBeenCalled();
    } finally {encode.mockRestore();}
  });

  it('accepts 128000 UTF-16 units per original even when an omitted merged run exceeds that limit',async()=>{
    const turns=freeze([turn('user','😀'.repeat(64000)),turn('user','\ud800'.repeat(128000)),
      turn('assistant','old reply'),turn('user','latest')]);
    expect(()=>validateTurns(turns)).not.toThrow();
    expect(mergeTurns(turns)[0].content.length).toBe(256002);
    expect(admitGGUFTurns(turns)).toEqual({messages:[turns[3]],omitted:2});
    expect(admitGGUFTurns(turns)).toEqual(await oracle(turns));
  });

  it('omits a many-fragment oversized run with bounded fragment encoding and no large join',async()=>{
    const fragmentCount=4096;
    const turns=freeze([turn('system','setting'),
      ...Array.from({length:fragmentCount},()=>turn('assistant','😀'.repeat(32))),turn('user','latest')]);
    const expected=await oracle(turns);
    expect(expected).toEqual({messages:[turns[0],turns.at(-1)],omitted:1});
    // Test-only observation: numeric counters retain no strings/call history; restore before assertions.
    const originalEncode=TextEncoder.prototype.encode,originalJoin=Array.prototype.join;
    let encodeCalls=0,maxEncodedUnits=0,maxJoinedFragments=0;
    let actual:ReturnType<typeof admitGGUFTurns>;
    try {
      TextEncoder.prototype.encode=function(this:TextEncoder,input='') {
        encodeCalls++;maxEncodedUnits=Math.max(maxEncodedUnits,input.length);
        if(input.length>128000)throw Error('encoded a merged oversized run');
        return originalEncode.call(this,input);
      };
      Array.prototype.join=function(this:unknown[],separator?:string) {
        maxJoinedFragments=Math.max(maxJoinedFragments,this.length);
        if(this.length>=fragmentCount)throw Error('materialized the omitted run');
        return originalJoin.call(this,separator);
      };
      actual=admitGGUFTurns(turns);
    } finally {
      TextEncoder.prototype.encode=originalEncode;
      Array.prototype.join=originalJoin;
    }
    expect(actual).toEqual(expected);
    expect(encodeCalls).toBe(fragmentCount+2);
    expect(maxEncodedUnits).toBe(64);
    expect(maxJoinedFragments).toBe(1);
  });
});
