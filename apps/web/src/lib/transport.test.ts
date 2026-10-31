import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, serverAddress } from './transport';
import { setCloud, setCloudOwner } from './cloudMode';
import * as remoteStore from './remoteStore';
afterEach(() => { setCloud(false); vi.unstubAllGlobals();vi.restoreAllMocks(); });
it.each([['/api/mobile/status','GET'],['/api/chat/history','GET'],['/api/chat','POST']])('never dispatches %s to Cloud when the selected PC is missing',async(path,method)=>{
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='kyalulu-execution-target'?'pc':null});
  vi.spyOn(remoteStore,'activeRemote').mockReturnValue(null);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(apiFetch(path,{method,...(method==='POST'?{body:'private PC draft'}:{})})).rejects.toThrow('接続先を選んでください');
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps Cloud account APIs reachable while the selected PC is missing',async()=>{
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='kyalulu-execution-target'?'pc':null});
  vi.spyOn(remoteStore,'activeRemote').mockReturnValue(null);
  const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
  for(const path of ['/api/cloud/profile','/api/community/characters'])await apiFetch(path);
  expect(fetch.mock.calls.map(call=>call[0])).toEqual(['/api/cloud/profile','/api/community/characters']);
});
it.each(['pc','device','local'])('does not revoke %s pairing on a Cloud publication login error',async target=>{
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='kyalulu-execution-target'?target:null});
  const dispatchEvent=vi.fn();vi.stubGlobal('window',{dispatchEvent});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
  expect((await apiFetch('/api/cloud/app/publications')).status).toBe(401);
  expect(dispatchEvent).not.toHaveBeenCalled();
});
it.each(['cloud','pc','device'])('blocks PC-only sync credentials before dispatch to %s',async target=>{
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='kyalulu-execution-target'?target:null});
  vi.spyOn(remoteStore,'activeRemote').mockReturnValue({id:'selected'} as any);
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  for(const path of ['/api/local/app-sync','/api/local/app-sync?x=1','/api/local/app-sync/run','/api/local/cloud','/api/local/cloud/sync']) {
    await expect(apiFetch(path,{method:'PUT',body:'fixture-secret'})).rejects.toThrow('対象のPC上');
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('keeps explicit local enrollment off Relay even when a Remote key remains selected',async()=>{
  vi.stubGlobal('localStorage',{getItem:(key:string)=>key==='kyalulu-execution-target'?'local':null});
  vi.spyOn(remoteStore,'activeRemote').mockReturnValue({id:'selected'} as any);
  const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
  const body=JSON.stringify({token:'fixture-local-only-token'});
  await apiFetch('/api/local/app-sync',{method:'PUT',body});
  expect(fetch).toHaveBeenCalledWith('/api/local/app-sync',expect.objectContaining({body,credentials:'same-origin'}));
});
it('pins authenticated runtime mutations to the expected Cloud account',async()=>{
  setCloud(true);setCloudOwner('expected-owner');
  const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
  await apiFetch('/api/chat/sessions/sync-fixture/data',{method:'DELETE'});
  expect(new Headers(fetch.mock.calls[0][1].headers).get('X-Kyalulu-Owner')).toBe('expected-owner');
});
it.each([200,401])('rejects old-owner HTTP %s without logging the new owner out',async status=>{
  setCloud(true);setCloudOwner('a');
  const dispatchEvent=vi.fn();vi.stubGlobal('window',{dispatchEvent});
  let respond!:(value:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{respond=resolve;})));
  const request=apiFetch('/api/chat/settings');
  setCloudOwner('b');respond(new Response('{}',{status}));
  await expect(request).rejects.toThrow('アカウントが切り替わりました');
  expect(dispatchEvent).not.toHaveBeenCalled();
});
it('rejects a response from before logout even after the same owner returns',async()=>{
  setCloud(true);setCloudOwner('a');
  const dispatchEvent=vi.fn();vi.stubGlobal('window',{dispatchEvent});
  let respond!:(value:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{respond=resolve;})));
  const request=apiFetch('/api/cloud/profile');
  setCloudOwner('');setCloudOwner('a');respond(new Response('{}',{status:401}));
  await expect(request).rejects.toThrow('アカウントが切り替わりました');
  expect(dispatchEvent).not.toHaveBeenCalled();
});
it('lets RuntimeGate inspect status across a scope change using its own request ordering',async()=>{
  setCloud(true);setCloudOwner('a');
  let respond!:(value:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{respond=resolve;})));
  const request=apiFetch('/api/mobile/status');
  setCloudOwner('');respond(new Response('{"owner_scope":"b"}'));
  expect(await (await request).json()).toEqual({owner_scope:'b'});
});
it.each([200,409])('guards cloud HTTP %s JSON after body reading without wrapping the stream body',async status=>{
  setCloud(true);setCloudOwner('a');
  const response=new Response('{"history":[]}', {status});
  const body=response.body;
  vi.spyOn(response,'json').mockImplementation(async()=>{setCloudOwner('b');return {history:[{content:'private'}]};});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
  const result=await apiFetch('/api/chat/history');
  expect(result.body).toBe(body);
  await expect(result.json()).rejects.toThrow('アカウントが切り替わりました');
});
describe('server boundary', () => {
  it('normalizes HTTPS and permits loopback development', () => {
    expect(serverAddress(' https://PC.example/ ')).toBe('https://pc.example');
    expect(serverAddress('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000');
  });
  it.each(['http://192.168.1.2:8000', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://pc.example/?token=secret', 'https://pc.example/#secret', 'https://pc.example/path'])('rejects insecure or ambiguous address %s', value => {
    expect(() => serverAddress(value)).toThrow();
  });
  it('never sends credentials to an arbitrary URL or follows redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await expect(apiFetch('https://other.example/api/health')).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await apiFetch('/api/health', { credentials: 'include', cache: 'force-cache', redirect: 'follow' });
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }));
  });
  it('notifies the application when a device registration is revoked', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    expect((await apiFetch('/api/chat/history')).status).toBe(401);
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
});
