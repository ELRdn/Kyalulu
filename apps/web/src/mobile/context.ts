import type { ChatTurn, Conversation } from './types';
import { CONTEXT_TOKENS, OUTPUT_TOKENS } from './types';

// shortcut: GGUF's public API has no tokenizer; use a conservative UTF-8 bound until a native count API is exposed.
export const conservativeTokens=(turns:ChatTurn[])=>turns.reduce((n,m)=>n+new TextEncoder().encode(m.content).length+128,32);
export function mergeTurns(turns:ChatTurn[]) {
  const result:ChatTurn[]=[];
  for(const message of turns){const previous=result.at(-1);if(previous?.role===message.role)previous.content+='\n\n'+message.content;else result.push({...message});}
  return result;
}
export async function fitContext(turns:ChatTurn[],count:(t:ChatTurn[])=>number|Promise<number>=conservativeTokens,outputTokens=OUTPUT_TOKENS) {
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
export function conversationTurns(s:Conversation):ChatTurn[] {
  const turns:ChatTurn[]=[{role:'system',content:s.character.prompt}];
  for(const m of s.messages) {
    if(m.state==='interrupted'||m.state==='stopped')continue;
    turns.push({role:m.role,content:m.content});
  }
  return mergeTurns(turns);
}
