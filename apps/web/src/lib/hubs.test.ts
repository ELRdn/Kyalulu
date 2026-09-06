import { afterEach, expect, it, vi } from 'vitest';
import { previewUrl } from './hubs';
const id = 'a7a7b290-b0fd-4fe6-92e1-b093c05a0078';
const body = { url: `https://realm.risuai.net/character/${id}`, format: 'json-v3' as const, non_commercial: false };
const remote = { source: 'risurealm', source_url: body.url, source_id: id, download_url: `https://realm.risuai.net/api/v1/download/json-v3/${id}?cors=true`, filename: 'card.json', transport: 'browser', revision: null, author: null, license: null, content_rating: 'unknown', expected_hash: null, format: 'json-v3' };
const preview = { preview_id: 'p', filename: 'card.json', source_hash: 'hash', documents: [], duplicates: {} };
afterEach(() => vi.unstubAllGlobals());
it('uses guest CORS download and passes claimed origin with bytes to existing upload', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(remote)).mockResolvedValueOnce(Response.json({ name: 'SFW' })).mockResolvedValueOnce(Response.json(preview));
  vi.stubGlobal('fetch', fetch);
  expect(await previewUrl(body, new AbortController().signal)).toEqual(preview);
  expect(fetch.mock.calls[1][1]).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
  const upload = fetch.mock.calls[2][1].body as FormData;
  expect(JSON.parse(String(upload.get('remote')))).toEqual(body);
  expect(upload.get('file')).toBeInstanceOf(File);
});
it.each([403, 404, 429])('does not retry failed browser downloads (%i)', async status => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(remote)).mockResolvedValueOnce(new Response('', { status }));
  vi.stubGlobal('fetch', fetch);
  await expect(previewUrl(body, new AbortController().signal)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('rejects a forged browser target before calling it', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ...remote, download_url: 'https://evil.example/a.json' }));
  vi.stubGlobal('fetch', fetch);
  await expect(previewUrl(body, new AbortController().signal)).rejects.toThrow('未対応');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('limits actual streamed bytes even when content length is missing', async () => {
  let sent = 0;
  const stream = new ReadableStream({ pull(controller) { if (sent++ < 33) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close(); } });
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(remote)).mockResolvedValueOnce(new Response(stream));
  vi.stubGlobal('fetch', fetch);
  await expect(previewUrl(body, new AbortController().signal)).rejects.toThrow('32 MiB');
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('forwards cancellation to the download and stops before upload', async () => {
  const controller = new AbortController();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(remote)).mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    controller.abort();
  }));
  vi.stubGlobal('fetch', fetch);
  await expect(previewUrl(body, controller.signal)).rejects.toThrow('Aborted');
  expect(fetch).toHaveBeenCalledTimes(2);
});
