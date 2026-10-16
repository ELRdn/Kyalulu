import { afterEach, expect, it, vi } from 'vitest';
import { branchSession, deleteSessionData, fetchChatContext, streamChat, updateChatSummary } from './api';
import { setCloud, setCloudOwner } from './cloudMode';
import { QuoteConsent } from './quoteConsent';
import { CapabilitiesSchema, RPGOptionsSchema } from '../../../../packages/schemas/src';
import { fetchCapabilities } from './capabilities';
import { playableAsset } from './media';

afterEach(() => { setCloud(false); vi.unstubAllGlobals(); vi.useRealTimers(); });
const preview = { quote_id: 'q', max_credits: 11, expires_in: 120, route: { display_name: 'Cloud', provider: 'p', model: 'm' } };
it('uses server revision and only the latest user message in both quote and generation', async () => {
  setCloud(true);
  const context = { history_revision: 'r7', summaries: [{ id: 's', kind: 'chapter', text: 'notes', revision: '2', source_message_ids: [1, 2], method: 'extractive' }] };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(context)).mockResolvedValueOnce(Response.json(preview))
    .mockResolvedValueOnce(new Response('event: done\ndata: {"full":"safe"}\n\n'));
  vi.stubGlobal('fetch', fetch); const confirm = vi.fn(async () => true);
  await new Promise<void>((resolve, reject) => streamChat('cloud', [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'prior' }, { role: 'user', content: 'new' }], { session_id: 's/1', context_mode: 'stored', generation_id: 'g' }, {
    onToken: vi.fn(), confirmQuote: confirm, onDone: () => resolve(), onError: error => reject(Error(error)),
  }));
  expect(fetch.mock.calls[0][0]).toBe('/api/chat/context/s%2F1');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ context_mode: 'stored', history_revision: 'r7', messages: [{ role: 'user', content: 'new' }] });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toMatchObject({ history_revision: 'r7', generation_id: 'g', quote_id: 'q' });
  expect(confirm).not.toHaveBeenCalled();
});
it('fails closed for training-required quotes without a confirmation handler', async () => {
  setCloud(true); const fetch = vi.fn().mockResolvedValue(Response.json({ ...preview, route: { ...preview.route, training_consent_required: true } })); vi.stubGlobal('fetch', fetch);
  const rejected = vi.fn();
  await new Promise<void>(resolve => streamChat('cloud', [], {}, { onToken: vi.fn(), onRejected: rejected, onError: () => resolve() }));
  expect(fetch).toHaveBeenCalledOnce(); expect(rejected).toHaveBeenCalledOnce();
});
it('rejects revoked consent and an aborted pending confirmation without a generation POST', async () => {
  setCloud(true); setCloudOwner('a');
  const fetch = vi.fn().mockImplementation(async () => Response.json({ ...preview, route: { ...preview.route, training_consent_required: true } })); vi.stubGlobal('fetch', fetch);
  const shown = vi.fn(); const consent = new QuoteConsent(shown); const rejected = vi.fn();
  const stop = streamChat('cloud', [], {}, { onToken: vi.fn(), confirmQuote: consent.request, onRejected: rejected });
  await vi.waitFor(() => expect(shown).toHaveBeenCalled());
  stop(); await vi.waitFor(() => expect(rejected).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledOnce();
});
it('renders no unvetted Cloud tokens, forwards progress, and accepts the vetted final result', async () => {
  setCloud(true); const progress = vi.fn(); const tokens = vi.fn(); const reset = vi.fn();
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(preview)).mockResolvedValueOnce(new Response(
    'event: progress\ndata: {"stage":"input_safety","elapsed_ms":50}\n\nevent: token\ndata: {"token":"unvetted"}\n\nevent: reset\ndata: {"full":"unvetted"}\n\nevent: done\ndata: {"full":"vetted"}\n\n'));
  vi.stubGlobal('fetch', fetch);
  const result = await new Promise<string>((resolve, reject) => streamChat('cloud', [], {}, {
    confirmQuote: async () => true, onProgress: progress, onToken: tokens, onReset: reset, onDone: resolve, onError: error => reject(Error(error)),
  }));
  expect(result).toBe('vetted'); expect(tokens).not.toHaveBeenCalled(); expect(reset).not.toHaveBeenCalled();
  expect(progress).toHaveBeenCalledWith({ stage: 'input_safety', elapsed_ms: 50 });
});
it('does not retry expired quotes or stored-context conflicts', async () => {
  setCloud(true); const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'history_revision_conflict' }, { status: 409 })); vi.stubGlobal('fetch', fetch);
  const rejected = vi.fn();
  await new Promise<void>(resolve => streamChat('cloud', [{ role: 'user', content: 'new' }], { context_mode: 'stored' }, { confirmQuote: async () => true, onToken: vi.fn(), onRejected: rejected, onError: () => resolve() }));
  expect(fetch).toHaveBeenCalledOnce(); expect(rejected).toHaveBeenCalledOnce();
});
it('keeps summary revision, branch point and permanent deletion on their separate API paths', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ history_revision: 'v1', summaries: [] }))
    .mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ session_id: 'branch1' }))
    .mockResolvedValueOnce(new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetch);
  await fetchChatContext('s'); await updateChatSummary('s', 'sum/1', 'corrected', '3');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ text: 'corrected', expected_revision: '3' });
  expect(await branchSession('s', 9)).toEqual({ session_id: 'branch1' });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ message_id: 9 });
  await deleteSessionData('s'); expect(fetch.mock.calls[3][0]).toBe('/api/chat/sessions/s/data'); expect(fetch.mock.calls[3][1].method).toBe('DELETE');
});
it('rejects incomplete capability responses and preserves HTTP failures', async () => {
  expect(CapabilitiesSchema.safeParse({ schema_version: 1, mode: 'cloud', features: {} }).success).toBe(false);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
  await expect(fetchCapabilities()).rejects.toMatchObject({ status: 503 });
});
it('keeps imported URLs inert and accepts only supported owned media', () => {
  const base = { name: 'sound', type: 'music', uri: 'https://tracking.invalid/file', media_type: 'audio/mpeg', asset_id: null };
  expect(playableAsset(base)).toBeNull();
  expect(playableAsset({ ...base, asset_id: 'safe_id' })).toEqual({ src: '/api/library/assets/safe_id', kind: 'audio' });
  expect(playableAsset({ ...base, asset_id: '../foreign' })).toBeNull();
  expect(playableAsset({ ...base, media_type: 'image/svg+xml', asset_id: 'id' })).toBeNull();
});
it('rejects duplicate RPG actions, unknown scripts and undeclared skills', () => {
  const action = { id: 'a', label: 'search', trigger: 'search', skill: 'not-declared' };
  expect(RPGOptionsSchema.safeParse({ actions: [action] }).success).toBe(false);
  expect(RPGOptionsSchema.safeParse({ actions: [{ ...action, skill: '' }, { ...action, skill: '' }] }).success).toBe(false);
  expect(RPGOptionsSchema.safeParse({ script: 'execute()' }).success).toBe(false);
  expect(RPGOptionsSchema.safeParse({ skills: { search: 21 } }).success).toBe(false);
});
