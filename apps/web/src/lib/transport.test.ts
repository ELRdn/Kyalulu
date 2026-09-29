import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, serverAddress } from './transport';
afterEach(() => vi.unstubAllGlobals());
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
