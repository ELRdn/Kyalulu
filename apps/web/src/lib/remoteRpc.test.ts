import { describe, it, expect } from 'vitest';
import { RemoteRpc, encodeBytes, type RemoteFrame } from './remoteRpc';

async function pending(rpc: RemoteRpc, frames: RemoteFrame[], init?: RequestInit) {
  const response = rpc.fetch('/api/library', init);
  await new Promise(resolve => setTimeout(resolve, 0));
  return { response, id: frames[0].id };
}
describe('encrypted API framing', () => {
  it.each(['abort', 'close'])('cancels a stalled body on %s and releases admission slots', async action => {
    const frames: RemoteFrame[] = []; const rpc = new RemoteRpc(async f => { frames.push(f); });
    const abort = new AbortController(); let cancelled = false;
    const stream = new ReadableStream({ cancel: () => { cancelled = true; } });
    const request = rpc.fetch('/api/library', { method: 'POST', body: stream, signal: abort.signal, duplex: 'half' } as RequestInit);
    const rejected = expect(request).rejects.toThrow();
    await new Promise(resolve => setTimeout(resolve, 0));
    if (action === 'abort') abort.abort(); else rpc.close();
    await rejected; expect(cancelled).toBe(true); expect(frames).toHaveLength(0);
    const { response, id } = await pending(rpc, frames);
    rpc.receive({ type: 'response', id, seq: 0, status: 204, headers: {} });
    rpc.receive({ type: 'end', id, seq: 1 });
    expect((await response).status).toBe(204);
  });
  it('streams binary responses and strips credential headers', async () => {
    const frames: RemoteFrame[] = [];
    const rpc = new RemoteRpc(async frame => { frames.push(frame); });
    const { response, id } = await pending(rpc, frames, { headers: { Cookie: 'must-not-forward', Authorization: 'also-private', Accept: 'image/png' } });
    expect(frames[0].headers).toEqual({ accept: 'image/png' });
    rpc.receive({ type: 'response', id, seq: 0, status: 200, headers: { 'content-type': 'image/png' } });
    rpc.receive({ type: 'chunk', id, seq: 1, data: encodeBytes(new Uint8Array([0, 255, 128])) });
    rpc.receive({ type: 'end', id, seq: 2 });
    expect([...new Uint8Array(await (await response).arrayBuffer())]).toEqual([0, 255, 128]);
  });
  it('fails on missing or reordered response frames', async () => {
    const frames: RemoteFrame[] = []; const rpc = new RemoteRpc(async f => { frames.push(f); });
    const { response, id } = await pending(rpc, frames);
    const rejection = expect(response).rejects.toThrow('欠落');
    rpc.receive({ type: 'response', id, seq: 1, status: 200, headers: {} });
    await rejection;
  });
  it('disconnect fails the stream without resending a mutation', async () => {
    const frames: RemoteFrame[] = []; const rpc = new RemoteRpc(async f => { frames.push(f); });
    const { response, id } = await pending(rpc, frames, { method: 'POST', body: 'hello' });
    rpc.receive({ type: 'response', id, seq: 0, status: 200, headers: {} });
    const body = (await response).text();
    const rejection = expect(body).rejects.toThrow('接続が切れ');
    rpc.close(); await rejection;
    expect(frames.filter(f => f.type === 'request')).toHaveLength(1);
    expect(frames.some(f => f.type === 'cancel')).toBe(false);
  });
  it('serializes multipart boundaries and chunks large uploads', async () => {
    const frames: RemoteFrame[] = []; const rpc = new RemoteRpc(async f => { frames.push(f); });
    const form = new FormData(); form.set('file', new Blob([new Uint8Array(40000)]), 'test.bin');
    const { response, id } = await pending(rpc, frames, { method: 'POST', body: form });
    expect((frames[0].headers as Record<string, string>)['content-type']).toContain('multipart/form-data; boundary=');
    expect(frames.filter(f => f.type === 'request_chunk')).toHaveLength(2);
    rpc.receive({ type: 'response', id, seq: 0, status: 204, headers: {} });
    rpc.receive({ type: 'end', id, seq: 1 });
    expect((await response).status).toBe(204);
  });
});
