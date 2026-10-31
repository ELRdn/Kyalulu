import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runtimeDownload } from './runtimeDownload';
import { apiFetch } from './transport';
import { SYNC_INLINE_BYTES } from './appTransfers';

const identity = vi.hoisted(() => ({ scope: 'device:a', epoch: 1, target: 'device' }));
vi.mock('./transport', () => ({ apiFetch: vi.fn() }));
vi.mock('./remoteStore', () => ({ connectionScope: () => identity.scope }));
vi.mock('./cloudMode', () => ({ cloudEpoch: () => identity.epoch }));
vi.mock('./appContext', () => ({ executionTarget: () => identity.target }));
const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const writer = () => ({ write: vi.fn(async (_bytes: Uint8Array) => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) });
function picker(sink = writer()) {
  const createWritable = vi.fn(async () => sink);
  const choose = vi.fn(async () => ({ createWritable }));
  vi.stubGlobal('showSaveFilePicker', choose);
  return { sink, choose, createWritable };
}
function response(chunks: Uint8Array[], headers?: HeadersInit, lastError?: Error) {
  let index = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else if (lastError) controller.error(lastError);
    else controller.close();
  });
  const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
  const result = new Response(body, { headers });
  // Full-body methods would hide the read/EOF races these tests exercise.
  result.blob = vi.fn(() => { throw Error('unbounded blob'); });
  result.text = vi.fn(() => { throw Error('unbounded text'); });
  result.json = vi.fn(() => { throw Error('unbounded json'); });
  vi.mocked(apiFetch).mockResolvedValue(result);
  return { body, result, pull };
}
const run = (signal = new AbortController().signal, en = true) => runtimeDownload('/api/experiments/id/export', 'experiment.json', en, signal);
let anchor: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
beforeEach(() => {
  identity.scope = 'device:a'; identity.epoch = 1; identity.target = 'device';
  vi.mocked(apiFetch).mockReset();
  vi.stubGlobal('showSaveFilePicker', undefined);
  vi.useFakeTimers();
  anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('writes multi-MiB chunks incrementally and does not read ahead of a pending write', async () => {
  const { sink, choose } = picker(), gate = deferred<void>(), writing = deferred<void>();
  const chunks = [new Uint8Array(2 * 1024 * 1024), new Uint8Array(3 * 1024 * 1024)];
  const { body, pull, result } = response(chunks);
  sink.write.mockImplementationOnce(async () => { writing.resolve(); await gate.promise; });
  const saving = run();
  expect(choose).toHaveBeenCalledWith({ suggestedName: 'experiment.json' });
  expect(apiFetch).not.toHaveBeenCalled();
  await writing.promise;
  expect(pull).toHaveBeenCalledTimes(1); expect(sink.close).not.toHaveBeenCalled();
  gate.resolve(); await saving;
  expect(sink.write).toHaveBeenCalledTimes(2);
  expect(sink.write.mock.calls[0][0]).toBe(chunks[0]); expect(sink.write.mock.calls[1][0]).toBe(chunks[1]);
  expect(pull).toHaveBeenCalledTimes(3); expect(sink.close).toHaveBeenCalledOnce();
  expect(sink.abort).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
  expect(result.blob).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it.each(['EOF error', 'Storage checksum mismatch'])('aborts rather than committing a prefix after %s', async message => {
  const { sink } = picker();
  const { body } = response([new Uint8Array([1, 2])], { 'Content-Length': '2' }, Error(message));
  await expect(run()).rejects.toThrow(message);
  expect(sink.write).toHaveBeenCalledOnce(); expect(sink.close).not.toHaveBeenCalled();
  expect(sink.abort).toHaveBeenCalledOnce(); expect(ReadableStreamDefaultReader.prototype.cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false); expect(anchor.click).not.toHaveBeenCalled();
});

it.each(['AbortError', 'NotAllowedError'])('does not fetch or fall back when the pending picker rejects with %s', async name => {
  const gate = deferred<{ createWritable: ReturnType<typeof vi.fn> }>(), choose = vi.fn(() => gate.promise);
  vi.stubGlobal('showSaveFilePicker', choose);
  const saving = run(), rejected = expect(saving).rejects.toMatchObject({ name });
  expect(choose).toHaveBeenCalledOnce(); expect(apiFetch).not.toHaveBeenCalled();
  gate.reject(new DOMException('Permission cancelled', name)); await rejected;
  expect(apiFetch).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('does not fetch or fall back when createWritable denies permission', async () => {
  const { createWritable } = picker();
  createWritable.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
  await expect(run()).rejects.toMatchObject({ name: 'NotAllowedError' });
  expect(apiFetch).not.toHaveBeenCalled(); expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('does not fetch after abort while the picker is pending', async () => {
  const { choose, createWritable } = picker(), gate = deferred<Awaited<ReturnType<typeof choose>>>();
  choose.mockReturnValue(gate.promise);
  const controller = new AbortController(), saving = run(controller.signal), rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); gate.resolve({ createWritable }); await rejected;
  expect(createWritable).not.toHaveBeenCalled(); expect(apiFetch).not.toHaveBeenCalled();
});

it.each(['scope', 'epoch', 'target'] as const)('pins %s before the permission wait', async key => {
  const { sink, createWritable, choose } = picker(), gate = deferred<Awaited<ReturnType<typeof choose>>>();
  choose.mockReturnValue(gate.promise);
  const saving = run(), rejected = expect(saving).rejects.toThrow('Account or execution target changed');
  if (key === 'epoch') identity.epoch++; else identity[key] = 'changed';
  gate.resolve({ createWritable }); await rejected;
  expect(createWritable).not.toHaveBeenCalled(); expect(apiFetch).not.toHaveBeenCalled();
  expect(sink.close).not.toHaveBeenCalled();
});

it('aborts a writable acquired after an account switch during createWritable', async () => {
  const { sink, createWritable } = picker(), gate = deferred<typeof sink>(), opened = deferred<void>();
  createWritable.mockImplementation(async () => { opened.resolve(); return gate.promise; });
  const saving = run(), rejected = expect(saving).rejects.toThrow('Account or execution target changed');
  await opened.promise; identity.scope = 'device:b'; gate.resolve(sink); await rejected;
  expect(apiFetch).not.toHaveBeenCalled(); expect(sink.abort).toHaveBeenCalledOnce();
});

it.each(['read', 'write'].flatMap(phase => ['scope', 'epoch', 'target'].map(key => ({ phase, key }))))('rejects a $key switch during a pending $phase and releases the reader', async ({ phase, key }) => {
  const { sink } = picker(), gate = deferred<void>(), entered = deferred<void>();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
    if (phase === 'read') { entered.resolve(); await gate.promise; }
    if (index++ === 0) controller.enqueue(new Uint8Array([1])); else controller.close();
  } }, { highWaterMark: 0 });
  vi.mocked(apiFetch).mockResolvedValue(new Response(body));
  if (phase === 'write') sink.write.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
  const saving = run(), rejected = expect(saving).rejects.toThrow('Account or execution target changed');
  await entered.promise;
  if (key === 'epoch') identity.epoch++; else if (key === 'scope') identity.scope = 'device:b'; else identity.target = 'local';
  gate.resolve(); await rejected;
  if (phase === 'read') expect(sink.write).not.toHaveBeenCalled();
  expect(sink.close).not.toHaveBeenCalled(); expect(sink.abort).toHaveBeenCalledOnce();
  expect(ReadableStreamDefaultReader.prototype.cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});

it('checks identity again on the EOF read before closing the file', async () => {
  const { sink } = picker(); let index = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (index++ === 0) controller.enqueue(new Uint8Array([1]));
    else { identity.epoch++; controller.close(); }
  } }, { highWaterMark: 0 });
  vi.mocked(apiFetch).mockResolvedValue(new Response(body));
  await expect(run()).rejects.toThrow('Account or execution target changed');
  expect(sink.close).not.toHaveBeenCalled(); expect(sink.abort).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});

it.each(['write', 'close'] as const)('cancels the reader and aborts the writable after a %s failure', async phase => {
  const { sink } = picker(), { body } = response([new Uint8Array([1])]);
  sink[phase].mockRejectedValue(Error('disk failure'));
  sink.abort.mockRejectedValue(Error('abort also failed'));
  await expect(run()).rejects.toThrow('disk failure');
  expect(sink.abort).toHaveBeenCalledOnce(); expect(ReadableStreamDefaultReader.prototype.cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false); expect(anchor.click).not.toHaveBeenCalled();
});

it('aborts the opened file and cancels even an HTTP error body', async () => {
  const { sink } = picker(), body = new ReadableStream<Uint8Array>();
  vi.mocked(apiFetch).mockResolvedValue(new Response(body, { status: 403 }));
  await expect(run()).rejects.toThrow('Could not retrieve the export.');
  expect(sink.abort).toHaveBeenCalledOnce(); expect(sink.close).not.toHaveBeenCalled();
  expect(ReadableStreamDefaultReader.prototype.cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});

it('cancels a pending read immediately on abort and permits a fresh download', async () => {
  const { sink } = picker(), entered = deferred<void>(), cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ pull() { entered.resolve(); }, cancel }, { highWaterMark: 0 });
  vi.mocked(apiFetch).mockResolvedValue(new Response(body));
  const controller = new AbortController(), saving = run(controller.signal), rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise; controller.abort(); await rejected;
  expect(cancel).toHaveBeenCalledOnce(); expect(sink.abort).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
  response([new Uint8Array([1])]); await run(); expect(sink.close).toHaveBeenCalledOnce();
});

it('aborts during a pending write without committing when it later resolves', async () => {
  const { sink } = picker(), entered = deferred<void>(), gate = deferred<void>();
  const { body } = response([new Uint8Array([1])]);
  sink.write.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; });
  const controller = new AbortController(), saving = run(controller.signal), rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise; controller.abort(); await Promise.resolve();
  expect(sink.abort).toHaveBeenCalledOnce(); gate.resolve(); await rejected;
  expect(sink.close).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
});

it.each([undefined, String(SYNC_INLINE_BYTES)])('allows exactly the fallback limit with Content-Length=%s', async length => {
  const { body } = response([new Uint8Array(SYNC_INLINE_BYTES - 1), new Uint8Array([42])], length ? { 'Content-Length': length } : undefined);
  await run();
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
  expect(blob.size).toBe(SYNC_INLINE_BYTES); expect(anchor.click).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});

it.each([
  { en: true, length: undefined }, { en: false, length: undefined },
  { en: true, length: String(SYNC_INLINE_BYTES) }, { en: true, length: String(SYNC_INLINE_BYTES + 1) },
])('refuses fallback overflow with en=$en and declared length=$length without a saved prefix', async ({ en, length }) => {
  const { body } = response([new Uint8Array(SYNC_INLINE_BYTES), new Uint8Array([1])], length ? { 'Content-Length': length } : undefined);
  await expect(run(undefined, en)).rejects.toThrow(en ? 'does not support streaming saves' : 'ストリーミング保存に対応していません');
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(anchor.click).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
});

it.each(['0', '1', '3', '-1', '1.5', 'NaN', '9007199254740992', '2, 2', ''])('rejects dishonest or invalid Content-Length %j', async length => {
  const { body } = response([new Uint8Array([1, 2])], { 'Content-Length': length });
  await expect(run()).rejects.toThrow(/length/);
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
  expect(ReadableStreamDefaultReader.prototype.cancel).toHaveBeenCalledOnce();
});

it.each(['gzip', 'br'])('counts decompressed %s bytes without comparing to encoded Content-Length', async encoding => {
  response([new Uint8Array([1, 2, 3])], { 'Content-Length': '1', 'Content-Encoding': encoding });
  await run(); expect(anchor.click).toHaveBeenCalledOnce();
  response([new Uint8Array(SYNC_INLINE_BYTES + 1)], { 'Content-Length': '1', 'Content-Encoding': encoding });
  await expect(run()).rejects.toThrow('does not support streaming saves');
  expect(anchor.click).toHaveBeenCalledOnce();
});

it('enforces identity Content-Encoding and refuses mismatched EOF before close', async () => {
  const { sink } = picker(), { body } = response([new Uint8Array([1])], { 'Content-Length': '2', 'Content-Encoding': 'identity' });
  await expect(run()).rejects.toThrow('Export length mismatch');
  expect(sink.close).not.toHaveBeenCalled(); expect(sink.abort).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
});

it('does not save an in-memory prefix when EOF fails', async () => {
  const { body } = response([new Uint8Array([1])], undefined, Error('checksum failed'));
  await expect(run()).rejects.toThrow('checksum failed');
  expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(body.locked).toBe(false);
});
