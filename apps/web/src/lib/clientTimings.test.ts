import { afterEach, expect, it, vi } from 'vitest';
import { fetchChatDebug, streamChat } from './api';
import { setCloud, setCloudOwner } from './cloudMode';
import { readClientTimings, recordClientTimings, type ClientTimings } from './clientTimings';
import { workComments } from './community';

afterEach(() => { setCloud(false); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const timings: ClientTimings = { context_fetch_ms: 10, quote_fetch_ms: 20, quote_consent_ms: 30, post_to_first_body_ms: 40, post_to_full_ms: 40 };
function storage() {
  const entries = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) });
  vi.stubGlobal('window', { location: { origin: 'https://app.test' } });
  return entries;
}

it.each([false, true])('separates quote and body timing and measures consent only when required (%s)', async trainingRequired => {
  storage(); setCloud(true); setCloudOwner('a');
  let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
  const stages = { queue: 1, input_safety: 2, generation: 3, output_safety: 4, save: 5 };
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/context/')) { now += 10; return Response.json({ history_revision: 'r1', summaries: [] }); }
    if (url.includes('/quotes')) { now += 20; return Response.json({ quote_id: 'q', max_credits: 1, expires_in: 120, route: { display_name: 'Cloud', provider: 'p', model: 'm', training_consent_required: trainingRequired } }); }
    now += 40; return new Response(`event: token\ndata: {"token":"unvetted"}\n\nevent: done\ndata: ${JSON.stringify({ full: 'safe', generation_id: 'g', telemetry: { cloud_stages_ms: stages } })}\n\n`);
  });
  vi.stubGlobal('fetch', fetch); const tokens = vi.fn(); const measured = vi.fn();
  const confirm = vi.fn(async () => { now += 30; return true; });
  const expected = { ...timings, quote_consent_ms: trainingRequired ? 30 : null };
  const result = await new Promise<any>((resolve, reject) => streamChat('cloud', [{ role: 'user', content: 'hello' }], { generation_id: 'g', session_id: 's', context_mode: 'stored' }, {
    onToken: tokens, confirmQuote: confirm, onTiming: measured,
    onDone: (_text, result) => resolve(result), onError: error => reject(Error(error)),
  }));
  expect(confirm).toHaveBeenCalledTimes(trainingRequired ? 1 : 0);
  expect(result.telemetry).toEqual({ cloud_stages_ms: stages, client_timings_ms: expected });
  expect(tokens).not.toHaveBeenCalled(); expect(measured).toHaveBeenLastCalledWith(expected);
  expect(readClientTimings('g')).toEqual(expected);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ generation: { generation_id: 'g', telemetry: { cloud_stages_ms: stages } } })));
  expect((await fetchChatDebug('s')).generation?.telemetry).toEqual(result.telemetry);
});

it('keeps client timing scoped to the account and bounds retention', () => {
  const entries = storage(); setCloud(true); setCloudOwner('a'); recordClientTimings('g', timings);
  setCloudOwner('b'); expect(readClientTimings('g')).toBeNull();
  setCloudOwner('a'); expect(readClientTimings('g')).toEqual(timings);
  for (let id = 0; id < 105; id++) recordClientTimings(`g${id}`, timings);
  expect(Object.keys(JSON.parse([...entries.values()][0]))).toHaveLength(100);
  expect(readClientTimings('g')).toBeNull(); expect(readClientTimings('g104')).toEqual(timings);
});

it('does not invalidate a generation when browser telemetry storage fails', () => {
  storage(); vi.stubGlobal('sessionStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
  expect(() => recordClientTimings('g', timings)).not.toThrow(); expect(readClientTimings('g')).toBeNull();
});

it('sends the same explicit comment request ID on manual replay after a lost response, without automatic retries', async () => {
  const request_id = crypto.randomUUID();
  const fetch = vi.fn().mockRejectedValueOnce(Error('connection lost')).mockResolvedValueOnce(Response.json({ comments: [] }));
  vi.stubGlobal('fetch', fetch);
  await expect(workComments('w', 'hello', request_id)).rejects.toThrow('connection lost');
  expect(fetch).toHaveBeenCalledOnce();
  await expect(workComments('w', 'hello', request_id)).resolves.toEqual([]);
  expect(fetch.mock.calls.map(call => JSON.parse(call[1].body))).toEqual([{ text: 'hello', request_id }, { text: 'hello', request_id }]);
});
