import type { ChatTurn, Conversation } from './types';
import { CONTEXT_TOKENS, OUTPUT_TOKENS } from './types';

// History-window heuristic only; GGUF generation requires a final native whole-chat count.
export const conservativeTokens=(turns:ChatTurn[])=>turns.reduce((n,m)=>n+new TextEncoder().encode(m.content).length+128,32);
export function mergeTurns(turns:ChatTurn[]) {
  const result:ChatTurn[]=[];
  for(const message of turns){const previous=result.at(-1);if(previous?.role===message.role)previous.content+='\n\n'+message.content;else result.push({...message});}
  return result;
}
function contextBudget(outputTokens:number) {
  if(!Number.isInteger(outputTokens)||outputTokens<1||outputTokens>=CONTEXT_TOKENS)throw Error('Invalid output token reserve');
  return CONTEXT_TOKENS-outputTokens;
}
function selectConservative<T extends Pick<ChatTurn,'role'>>(turns:T[],bytes:(turn:T)=>number,budget:number,mandatoryTokens?:number) {
    let newest=-1;
    for(let i=0;i<turns.length;i++)if(turns[i].role==='user')newest=i;
    let tokens=mandatoryTokens??32,keepFrom=newest<0?0:newest;
    if(mandatoryTokens===undefined)for(let i=0;i<turns.length;i++)if(turns[i].role==='system'||i>=keepFrom)tokens+=bytes(turns[i])+128;
    if(tokens>budget)return null;
    // Commit only whole removal units; a system separates consecutive assistant groups.
    for(let i=keepFrom-1;i>=0;i--) {
      const message=turns[i];
      if(message.role==='system')continue;
      tokens+=128;
      if(tokens>budget)break;
      tokens+=bytes(message);
      if(tokens>budget)break;
      if(message.role!=='assistant'||i===0||turns[i-1].role==='system')keepFrom=i;
    }
    const messages:T[]=[];let omitted=0;
    for(let i=0;i<turns.length;i++) {
      if(turns[i].role==='system'||i>=keepFrom)messages.push(turns[i]);
      else omitted++;
    }
    return {messages,omitted};
}
export function validateTurns(turns:ChatTurn[]) {
  if(!Array.isArray(turns))throw Error('会話データが不正です。');
  for(let i=0;i<turns.length;i++) {
    const turn=turns[i];
    if(!Object.hasOwn(turns,i)||!turn||!['system','user','assistant'].includes(turn.role)||typeof turn.content!=='string'||turn.content.length>128000)throw Error('会話データが不正です。');
  }
}
export type GGUFRun=ChatTurn&{run:number};
const tooLong=()=>Error('キャラ設定またはメッセージが長すぎます。短くして再送してください。');
export function planGGUFContext(turns:ChatTurn[],outputTokens=OUTPUT_TOKENS) {
  validateTurns(turns);
  const budget=contextBudget(outputTokens);
  turns=turns.map(turn=>({...turn}));
  const runs:{run:number;role:ChatTurn['role'];start:number;end:number}[]=[];
  for(let i=0;i<turns.length;i++) {
    const previous=runs.at(-1),turn=turns[i];
    if(previous?.role===turn.role)previous.end=i+1;
    else runs.push({run:runs.length,role:turn.role,start:i,end:i+1});
  }
  const encoder=new TextEncoder(),sizes=new Map<number,number>();
  const bytes=(run:typeof runs[number])=>{
    const cached=sizes.get(run.run);if(cached!==undefined)return cached;
    let bytes=2*(run.end-run.start-1);
    for(let i=run.start;i<run.end;i++)bytes+=encoder.encode(turns[i].content).length;
    sizes.set(run.run,bytes);return bytes;
  };
  let newestUserRun=-1;for(const run of runs)if(run.role==='user')newestUserRun=run.run;
  const mandatory=runs.filter(run=>run.role==='system'||newestUserRun<0||run.run>=newestUserRun);
  return {turns,runs,bytes,budget,newestUserRun,mandatory,legacy:selectConservative(runs,bytes,budget)};
}
export function selectGGUFHistory(plan:ReturnType<typeof planGGUFContext>,mandatoryInputTokens?:number) {
  // shortcut: bounded history may under-retain; revisit transport if maximum native history becomes required.
  let selected=plan.legacy;
  if(!selected){
    if(typeof mandatoryInputTokens!=='number'||!Number.isSafeInteger(mandatoryInputTokens)||mandatoryInputTokens<0)throw Error('Invalid native token count');
    selected=selectConservative(plan.runs,plan.bytes,plan.budget,mandatoryInputTokens);
  }
  if(!selected)throw tooLong();
  return selected.messages.filter(run=>run.role!=='system'&&run.run<plan.newestUserRun);
}
export function materializeGGUFRuns(plan:ReturnType<typeof planGGUFContext>,runs:typeof plan.runs):GGUFRun[] {
  return runs.map(run=>({run:run.run,role:run.role,content:plan.turns.slice(run.start,run.end).map(turn=>turn.content).join('\n\n')}));
}
export function admitGGUFTurns(turns:ChatTurn[],outputTokens=OUTPUT_TOKENS) {
  const plan=planGGUFContext(turns,outputTokens),selected=plan.legacy;
  if(!selected)throw tooLong();
  return {messages:materializeGGUFRuns(plan,selected.messages).map(({run,content})=>({...plan.turns[plan.runs[run].start],content})),omitted:selected.omitted};
}
export async function fitContext(turns:ChatTurn[],count:(t:ChatTurn[])=>number|Promise<number>=conservativeTokens,outputTokens=OUTPUT_TOKENS) {
  const budget=contextBudget(outputTokens);
  if(count===conservativeTokens) {
    const encoder=new TextEncoder();
    const selected=selectConservative(turns,turn=>encoder.encode(turn.content).length,budget);
    if(!selected)throw tooLong();
    return {messages:selected.messages.map(turn=>({...turn})),omitted:selected.omitted};
  }
  const selected=turns.map(t=>({...t}));let omitted=0;
  while(await count(selected)>budget) {
    const newest=selected.map(m=>m.role).lastIndexOf('user'),index=selected.findIndex((m,i)=>m.role!=='system'&&i<newest);
    if(index<0)throw Error('キャラ設定またはメッセージが長すぎます。短くして再送してください。');
    selected.splice(index,1);omitted++;
    while(selected[index]?.role==='assistant'){selected.splice(index,1);omitted++;}
  }
  return {messages:selected,omitted};
}
export function conversationTurns(s:Conversation):ChatTurn[] {
  const turns:ChatTurn[]=[{role:'system',content:s.character.prompt}];
  for(const m of s.messages) {
    if(m.state==='interrupted'||m.state==='stopped')continue;
    turns.push({role:m.role,content:m.content});
  }
  return turns;
}
