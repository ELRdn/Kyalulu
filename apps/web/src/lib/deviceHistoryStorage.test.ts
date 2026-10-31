import { beforeEach,expect,it,vi } from 'vitest';
import { harness } from './idbHarness.test-support';
vi.mock('./appContext',()=>({deviceOwner:()=> 'history-writer'}));
import { readParts,writeParts,rewriteConversationParts,type Parts } from './segmentedStorage';

const records=new Map<string,any>(),meta=new Map<string,any>(),parts=new Map<string,any>();
const location=['history-writer','entity','source'] as const;
const transaction=<T>(mode:string,action:(tx:any,done:(value:T)=>void)=>void)=>harness(records,meta,parts,JSON.stringify,mode,action) as Promise<T>;
const seed=(payload:unknown)=>transaction<Parts>('readwrite',(tx,done)=>writeParts(tx,location,payload,done));
const read=(ref:Parts)=>transaction<any>('readonly',(tx,done)=>readParts(tx,location,ref,done));
beforeEach(()=>{records.clear();meta.clear();parts.clear();});

it('does not silently delete null historical JSON during a metadata-only rewrite',async()=>{
  const payload={messages:[null,{id:2,content:'Keep original',unknown:{keep:true}}],draft:'Unsent'},original=await seed(payload);
  const result=await transaction<{ref:Parts;scan:any}>('readwrite',(tx,done)=>rewriteConversationParts(tx,location,original,{summaries:[]},(ref,_metadata,scan)=>done({ref,scan})));
  expect(await read(result.ref)).toEqual({...payload,summaries:[]});
  expect(result.scan).toMatchObject({count:2,maximumMessageId:2,messageIdsValid:false});
  expect(await read(original)).toEqual(payload);
});

it('counts written messages separately from verified input when an explicit transform removes messages',async()=>{
  const payload={messages:[{id:1,content:'Remove'},{id:7,content:'Keep',unknown:{keep:true}}],draft:'Unsent'},original=await seed(payload);
  const result=await transaction<{ref:Parts;scan:any}>('readwrite',(tx,done)=>rewriteConversationParts(tx,location,original,
    metadata=>({draft:metadata.draft,summaries:[]}),(ref,_metadata,scan)=>done({ref,scan}),message=>message.id===1?null:message));
  expect(await read(result.ref)).toEqual({...payload,messages:[payload.messages[1]],summaries:[]});
  expect(result.scan).toMatchObject({count:1,maximumMessageId:7,messageIdsValid:true,last_preview:'Keep'});
  expect(await read(original)).toEqual(payload);
});

it('rejects a computed patch that tries to replace history and rolls back tentative output',async()=>{
  const payload={messages:[{id:1,content:'Keep'}],draft:'Unsent'},original=await seed(payload),snapshot=structuredClone([...parts]);
  await expect(transaction('readwrite',(tx,done)=>rewriteConversationParts(tx,location,original,()=>({messages:[]}),done))).rejects.toThrow();
  expect([...parts]).toEqual(snapshot);expect(await read(original)).toEqual(payload);
});
