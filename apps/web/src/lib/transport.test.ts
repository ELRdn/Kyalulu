import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, serverAddress } from './transport';
import { setCloud, setCloudOwner } from './cloudMode';
afterEach(() => { setCloud(false); vi.unstubAllGlobals(); });
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
