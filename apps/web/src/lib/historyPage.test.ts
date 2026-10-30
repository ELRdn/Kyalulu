import { beforeEach, expect, it, vi } from 'vitest';
const fixture=vi.hoisted(()=>({target:'device',owner:'owner-a',fetch:vi.fn()}));
vi.mock('./transport',()=>({apiFetch:fixture.fetch}));
vi.mock('./appContext',async original=>({...await original<typeof import('./appContext')>(),executionTarget:()=>fixture.target,deviceOwner:()=>fixture.owner}));
import { fetchHistoryPage } from './api';
const page=()=>({session_id:'chat',revision:4,body_token:'fixture-token',total:100,start:50,end:100,
  history:Array.from({length:50},(_,i)=>({id:100-i,role:i%2?'assistant':'user',content:'Saved '+i,future:{keep:true}})),
  previous:{owner:'owner-a',id:'chat',revision:4,bodyToken:'fixture-token',start:0,end:50}});
beforeEach(()=>{fixture.fetch.mockReset();fixture.target='device';fixture.owner='owner-a';});

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
