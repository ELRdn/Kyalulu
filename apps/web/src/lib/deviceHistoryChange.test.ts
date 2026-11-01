import { expect,it } from 'vitest';
import { changedHistoryMessage,changedHistoryMetadata,detachHistoryMemories,validateHistoryChange,type HistoryChange } from './deviceHistoryChange';

const manual={id:'manual',type:'semantic' as const,content:'Authored fact',origin:'user',status:'active',supported:null,
  source_message_ids:[1,3],source_quote:'Original quote',source_revision:'original',unknown:{keep:true}};
const generated={...manual,id:'generated',origin:'model',source_generation_id:'turn',source_message_ids:[3]};
const independent={...manual,id:'independent',origin:'model',source_generation_id:'other',source_message_ids:[2]};
const memories=[manual,generated,independent];
const messages=[1,2,3].map(id=>({id,uuid:'message-'+id,role:id===3?'assistant':'user',content:'Original '+id,unknown:{keep:id},
  before:{state:{turn:id-1},settings:{system_prompt:'Keep system'},memories:[manual],unknown:{keep:'before'}},
  after:{state:{turn:id},memories,unknown:{keep:'after'}}}));
const metadata={draft:'Unsent draft',state:{turn:3},unknown:{keep:true},memories,summaries:[
  {id:'manual-summary',method:'manual',text:'Authored summary',source_message_ids:[1,3],unknown:{keep:true}},
  {id:'auto',method:'extractive',text:'Prior source',source_message_ids:[1,3]},
  {id:'other',method:'extractive',text:'Independent summary',source_message_ids:[2]},
],last_generation:{generation_id:'turn',session_id:'chat',user_id:1,assistant_id:3}};

it.each(['edit','delete','clear'])('preserves authored provenance and snapshot state/settings/unknown fields on %s',operation=>{
  const baseline=structuredClone({messages,metadata}),change:HistoryChange={messageId:operation==='clear'?null:1,
    ...(operation==='edit'?{content:'Edited 茶🙂'}:{}),invalidGenerations:['turn']};
  validateHistoryChange(change);
  const updated=messages.flatMap(message=>{const value=changedHistoryMessage(message,change);return value===null?[]:[value];});
  const next={...metadata,...changedHistoryMetadata(metadata,change),memories:detachHistoryMemories(memories,change)};
  const ids=operation==='edit'?[1,2,3]:operation==='delete'?[2,3]:[];
  expect(updated.map(message=>message.id)).toEqual(ids);
  for(const message of updated){
    const before=messages.find(row=>row.id===message.id)!;
    expect(message).toEqual({...before,...(operation==='edit'&&message.id===1?{content:'Edited 茶🙂'}:{}),
      before:{...before.before,memories:[{...manual,source_message_ids:operation==='delete'?[3]:[1,3]}]},
      after:{...before.after,memories:[{...manual,source_message_ids:operation==='delete'?[3]:[1,3]},independent]}});
  }
  expect(next.memories).toEqual(operation==='clear'?[{...manual,source_message_ids:[]}]:[
    {...manual,source_message_ids:operation==='delete'?[3]:[1,3]},independent]);
  expect(next.summaries).toEqual([{...metadata.summaries[0],source_message_ids:operation==='clear'?[]:operation==='delete'?[3]:[1,3]},
    ...(operation==='clear'?[]:[metadata.summaries[2]])]);
  expect(next.last_generation).toBeNull();expect(next.draft).toBe(metadata.draft);expect(next.state).toEqual(metadata.state);expect(next.unknown).toEqual(metadata.unknown);
  expect({messages,metadata}).toEqual(baseline);
});

it('invalidates model memories by direct source IDs as well as generation receipts while retaining manual links on edits',()=>{
  const change:HistoryChange={messageId:1,content:'Correction',invalidGenerations:[]};
  expect(detachHistoryMemories([{...generated,source_message_ids:[1]},generated,manual],change)).toEqual([generated,manual]);
  expect(changedHistoryMetadata({...metadata,last_generation:{...metadata.last_generation,user_id:4,assistant_id:5}},change).last_generation).toBeUndefined();
});

it.each([
  {messageId:0,invalidGenerations:[]},{messageId:Number.MAX_SAFE_INTEGER+1,invalidGenerations:[]},
  {messageId:null,content:'not an edit',invalidGenerations:[]},{messageId:1,content:' ',invalidGenerations:[]},
  {messageId:1,content:'x'.repeat(128001),invalidGenerations:[]},
])('rejects malformed history instructions without touching input',change=>{
  expect(()=>validateHistoryChange(change)).toThrow('Invalid history change');
});

it('keeps legacy empty generation identities while rejecting non-string receipt identities',()=>{
  const change:HistoryChange={messageId:1,content:'Correction',invalidGenerations:['']};
  expect(()=>validateHistoryChange(change)).not.toThrow();
  expect(detachHistoryMemories([{...generated,source_generation_id:''}],change)).toEqual([]);
  expect(()=>validateHistoryChange({...change,invalidGenerations:[null]} as unknown as HistoryChange)).toThrow('Invalid history change');
});
