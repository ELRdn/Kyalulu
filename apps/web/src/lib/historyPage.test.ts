import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({target:'device',owner:'owner-a',fetch:vi.fn()}));
vi.mock('./transport',()=>({apiFetch:fixture.fetch}));
vi.mock('./appContext',async original=>({...await original<typeof import('./appContext')>(),executionTarget:()=>fixture.target,deviceOwner:()=>fixture.owner}));
import { fetchHistoryPage,fetchRecoveryHistory } from './api';
const page=()=>({session_id:'chat',revision:4,body_token:'fixture-token',total:100,start:50,end:100,
  history:Array.from({length:50},(_,i)=>({id:100-i,role:i%2?'assistant':'user',content:'Saved '+i,future:{keep:true}})),
  previous:{owner:'owner-a',id:'chat',revision:4,bodyToken:'fixture-token',start:0,end:50}});
beforeEach(()=>{fixture.fetch.mockReset();fixture.target='device';fixture.owner='owner-a';});
const status=()=>({generation_id:'g1',session_id:'chat',status:'completed',assistant_id:71,user_id:80});
const proof=()=>({status:status(),revision:5,body_token:'body-token',history:[{id:80,role:'user',content:'Saved input'},{id:71,role:'assistant',content:'Saved reply'}]});

it('uses the bounded Device proof for recovery and retains full history on other runtimes',async()=>{
  fixture.fetch.mockResolvedValueOnce(Response.json(proof()));expect(await fetchRecoveryHistory('chat',status())).toEqual(proof().history);
  expect(fixture.fetch.mock.calls[0][0]).toContain('/api/chat/history/proof?session_id=chat&generation_id=g1');
  for(const target of ['cloud','pc','local']){
    fixture.target=target;const history=Array.from({length:60},(_,id)=>({id,role:'assistant',content:'Full '+id}));
    fixture.fetch.mockResolvedValueOnce(Response.json({history}));expect(await fetchRecoveryHistory('chat',status())).toEqual(history);
    const url=new URL(fixture.fetch.mock.calls.at(-1)![0],'https://runtime.test');
    expect(url.pathname).toBe('/api/chat/history');expect(url.searchParams.get('session_id')).toBe('chat');
  }
});
it.each([
  (p:any)=>{p.status.generation_id='other';},(p:any)=>{p.status.user_id=99;},(p:any)=>{p.status.status='failed';},
  (p:any)=>{p.history.pop();},(p:any)=>{p.history[1].role='user';},(p:any)=>{p.history[1].id=72;},
  (p:any)=>{p.history.push(p.history[1]);},(p:any)=>{p.revision=-1;},(p:any)=>{p.body_token=1;},
])('rejects an inconsistent generation history proof',async change=>{
  const value=proof();change(value);fixture.fetch.mockResolvedValueOnce(Response.json(value));await expect(fetchRecoveryHistory('chat',status())).rejects.toThrow();
});
it('rejects owner or target changes and aborts during proof loading',async()=>{
  for(const field of ['owner','target']){
    fixture.owner='owner-a';fixture.target='device';fixture.fetch.mockImplementationOnce(async()=>{if(field==='owner')fixture.owner='other';else fixture.target='pc';return Response.json(proof());});
    await expect(fetchRecoveryHistory('chat',status())).rejects.toThrow('Connection changed');
  }
  fixture.target='device';const controller=new AbortController();fixture.fetch.mockImplementationOnce(async()=>{controller.abort();return Response.json(proof());});
  await expect(fetchRecoveryHistory('chat',status(),controller.signal)).rejects.toThrow();
});

it('returns verified saved fields and scopes the encoded cursor request',async()=>{
  const value=page();fixture.fetch.mockResolvedValueOnce(Response.json(value));
  expect(await fetchHistoryPage('chat')).toEqual(value);
  const cursor=value.previous,older={...value,start:0,end:50,previous:undefined,next:{...cursor,start:50,end:100}};
  fixture.fetch.mockResolvedValueOnce(Response.json(older));expect(await fetchHistoryPage('chat',cursor)).toEqual(JSON.parse(JSON.stringify(older)));
  const url=new URL(fixture.fetch.mock.calls[1][0],'https://device.test');
  expect(url.pathname).toBe('/api/chat/history/page');expect(url.searchParams.get('session_id')).toBe('chat');expect(JSON.parse(url.searchParams.get('cursor')!)).toEqual(cursor);
});
it.each(['cloud','pc','local'])('does not forward a device cursor to %s',async target=>{
  fixture.target=target;await expect(fetchHistoryPage('chat',page().previous)).rejects.toThrow('on-device');expect(fixture.fetch).not.toHaveBeenCalled();
});
it.each(['owner','target'])('rejects an in-flight %s change',async field=>{
  fixture.fetch.mockImplementationOnce(async()=>{if(field==='owner')fixture.owner='other';else fixture.target='pc';return Response.json(page());});
  await expect(fetchHistoryPage('chat')).rejects.toThrow('Connection changed');
});
it.each([
  (p:any)=>{p.session_id='other';},(p:any)=>{p.history.pop();},(p:any)=>{p.total=99;},(p:any)=>{p.history[0].id='100';},
  (p:any)=>{p.history[0].content=null;},(p:any)=>{p.history[0].role='tool';},(p:any)=>{p.previous.owner='other';},
  (p:any)=>{p.previous.revision=3;},(p:any)=>{p.previous.start=1;},(p:any)=>{p.previous.bodyToken='other';},
  (p:any)=>{delete p.previous;},(p:any)=>{p.next={...p.previous};},
])('rejects malformed or unrelated page responses',async mutate=>{
  const value=page();mutate(value);fixture.fetch.mockResolvedValueOnce(Response.json(value));await expect(fetchHistoryPage('chat')).rejects.toThrow();
});
it('rejects invalid cursors before loading and a response from another revision/range',async()=>{
  for(const cursor of [{...page().previous,owner:'other'},{...page().previous,id:'other'},{...page().previous,start:-1},{...page().previous,end:51}])await expect(fetchHistoryPage('chat',cursor)).rejects.toThrow('Invalid history cursor');
  expect(fixture.fetch).not.toHaveBeenCalled();fixture.fetch.mockResolvedValueOnce(Response.json(page()));
  await expect(fetchHistoryPage('chat',page().previous)).rejects.toThrow('History page changed');
});
it('propagates an HTTP rejection and an aborted response without inventing empty history',async()=>{
  fixture.fetch.mockResolvedValueOnce(Response.json({error:'stale'},{status:409}));await expect(fetchHistoryPage('chat')).rejects.toMatchObject({status:409});
  const controller=new AbortController();fixture.fetch.mockImplementationOnce(async()=>{controller.abort();return Response.json(page());});
  await expect(fetchHistoryPage('chat',undefined,controller.signal)).rejects.toThrow();
});
