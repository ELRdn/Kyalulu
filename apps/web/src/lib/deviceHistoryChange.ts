import type { DeviceMemory } from './deviceCore';

export type HistoryChange={messageId:number|null;content?:string;invalidGenerations:string[]};
export const historyAffected=(id:number,change:HistoryChange)=>change.messageId===null||id===change.messageId;
const deleted=(id:number,change:HistoryChange)=>historyAffected(id,change)&&change.content===undefined;
export const invalidHistoryMemory=(memory:DeviceMemory,change:HistoryChange)=>memory.origin==='model'&&(change.messageId===null
  ||change.invalidGenerations.includes(memory.source_generation_id)||(memory.source_message_ids??[]).some((id:number)=>historyAffected(id,change)));
export const detachHistoryMemories=(memories:DeviceMemory[],change:HistoryChange)=>memories.filter(memory=>!invalidHistoryMemory(memory,change))
  .map(memory=>({...memory,source_message_ids:(memory.source_message_ids??[]).filter((id:number)=>!deleted(id,change))}));
export function changedHistoryMessage(message:any,change:HistoryChange) {
  if(deleted(message.id,change))return null;
  const result={...message,...(historyAffected(message.id,change)?{content:change.content}:{})};
  for(const name of ['before','after'])if(result[name])result[name]={...result[name],memories:detachHistoryMemories(result[name].memories??[],change)};
  return result;
}
export function changedHistoryMetadata(metadata:Record<string,any>,change:HistoryChange) {
  const summaries=(metadata.summaries??[]).flatMap((summary:any)=>{
    if(change.messageId!==null&&!(summary.source_message_ids??[]).some((id:number)=>historyAffected(id,change)))return [summary];
    return summary.method==='manual'?[{...summary,source_message_ids:(summary.source_message_ids??[]).filter((id:number)=>!deleted(id,change))}]:[];
  });
  const generation=metadata.last_generation;
  return {summaries,...(change.messageId===null||generation&&[generation.user_id,generation.assistant_id].some(id=>historyAffected(id,change))?{last_generation:null}:{})};
}
export function validateHistoryChange(change:HistoryChange) {
  if(change.messageId!==null&&(!Number.isSafeInteger(change.messageId)||change.messageId<1)
    ||change.content!==undefined&&(change.messageId===null||typeof change.content!=='string'||!change.content.trim()||change.content.length>128000)
    ||!Array.isArray(change.invalidGenerations)||change.invalidGenerations.some(id=>typeof id!=='string'))throw Error('Invalid history change');
}
