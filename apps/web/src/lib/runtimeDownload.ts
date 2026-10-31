import { apiFetch } from './transport';
import { connectionScope } from './remoteStore';
import { executionTarget } from './appContext';
import { cloudEpoch } from './cloudMode';
import { SYNC_INLINE_BYTES } from './appTransfers';

type ExportWritable = {
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
};
type SavePicker = (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<ExportWritable> }>;
const safeName = (name: string) => name.split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f\u007f]/g, '') || 'kyalulu-export';

// Invoke directly from the click: identity and the picker must precede any await.
export async function runtimeDownload(href: string, filename: string | undefined, en: boolean, signal: AbortSignal) {
  const scope = connectionScope(), epoch = cloudEpoch(), target = executionTarget();
  const check = () => {
    signal.throwIfAborted();
    if (connectionScope() !== scope || cloudEpoch() !== epoch || executionTarget() !== target)
      throw Error(en ? 'Account or execution target changed. Export again.' : 'アカウントまたは実行先が変わりました。書き出し直してください。');
  };
  const unsupported = () => Error(en
    ? 'This browser does not support streaming saves. Exports larger than 1,500,000 bytes cannot be saved here. Use a browser with streaming file saving.'
    : 'このブラウザーはストリーミング保存に対応していません。1,500,000バイトを超える書き出しは保存できません。対応ブラウザーを使用してください。');
  let writable: ExportWritable | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abortWrite: Promise<unknown> | undefined, cancelRead: Promise<unknown> | undefined;
  const cleanup = (reason: unknown) => {
    if (writable && !abortWrite) abortWrite = Promise.resolve().then(() => writable!.abort(reason)).catch(() => {});
    if (reader && !cancelRead) cancelRead = Promise.resolve().then(() => reader!.cancel(reason)).catch(() => {});
    return Promise.all([abortWrite, cancelRead]);
  };
  const abort = () => { void cleanup(signal.reason); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    check();
    const picker = (globalThis as typeof globalThis & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
    if (picker) {
      const handle = await picker.call(globalThis, { suggestedName: safeName(filename ?? 'kyalulu-export.json') });
      check();
      writable = await handle.createWritable();
      check();
    }
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    const response = await apiFetch(href, { signal: requestSignal });
    reader = response.body?.getReader();
    check();
    if (!response.ok) throw Error(en ? 'Could not retrieve the export.' : '書き出しを取得できませんでした。');
    const declared = response.headers.get('Content-Length');
    if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))))
      throw Error(en ? 'Invalid export length.' : '書き出しのサイズ指定が不正です。');
    const encoding = response.headers.get('Content-Encoding')?.trim().toLowerCase();
    const length = declared !== null && (!encoding || encoding === 'identity') ? Number(declared) : undefined;
    if (!reader) throw unsupported();
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    for (;;) {
      check();
      const { done, value } = await reader.read();
      check();
      if (done) break;
      size += value.byteLength;
      if (!writable && size > SYNC_INLINE_BYTES) throw unsupported();
      if (length !== undefined && size > length) throw Error(en ? 'Export length mismatch.' : '書き出しのサイズが一致しません。');
      if (writable) {
        check();
        await writable.write(value);
        check();
      } else {
        chunks.push(new Uint8Array(value).buffer);
      }
    }
    if (length !== undefined && size !== length) throw Error(en ? 'Export length mismatch.' : '書き出しのサイズが一致しません。');
    check();
    if (writable) {
      await writable.close();
      check();
    } else {
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const type = response.headers.get('Content-Type') ?? '';
      let name = disposition.match(/filename="([^"]+)"/i)?.[1] ?? (type.includes('json') ? 'kyalulu-export.json' : 'kyalulu-export');
      if (encoded) { try { name = decodeURIComponent(encoded); } catch { /* Keep a usable fallback for a malformed header. */ } }
      const url = URL.createObjectURL(new Blob(chunks, { type }));
      const a = document.createElement('a'); a.href = url; a.download = safeName(filename ?? name);
      try { check(); document.body.appendChild(a); check(); a.click(); }
      finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    }
  } catch (error) {
    await cleanup(error);
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    reader?.releaseLock();
  }
}
