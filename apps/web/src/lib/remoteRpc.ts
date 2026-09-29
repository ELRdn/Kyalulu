/** HTTP-shaped API over an authenticated encrypted channel; no mutation retries. */
export type RemoteFrame = { type: string; id: string; seq?: number; [key: string]: unknown };
export const encodeBytes = (bytes: Uint8Array) => {
  let value = ''; for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
};
export const decodeBytes = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
type Pending = {
  resolve: (response: Response) => void; reject: (reason: unknown) => void;
  controller?: ReadableStreamDefaultController<Uint8Array>; seq: number;
  cleanup: () => void;
};
export class RemoteRpc {
  private pending = new Map<string, Pending>();
  private preparing = 0;
  private epoch = 0;
  private bodyCancels = new Set<(reason: Error) => void>();
  constructor(private send: (frame: RemoteFrame) => Promise<void>) {}
  async resume() {
    for (const [id, pending] of this.pending) {
      await this.send({ type: 'resume', id, after_seq: pending.seq });
    }
  }
  close(reason = new Error('自宅PCとの接続が切れました。送信結果を確認してください。')) {
    this.epoch++;
    for (const cancel of this.bodyCancels) cancel(reason);
    for (const id of this.pending.keys()) this.fail(id, reason);
  }
  private fail(id: string, error: unknown) {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); pending.cleanup();
    pending.reject(error); pending.controller?.error(error);
  }
  receive(frame: RemoteFrame) {
    const p = this.pending.get(frame.id); if (!p) return;
    try {
      if (frame.type === 'error') throw new Error(`接続先で処理できませんでした (${String(frame.code)})。`);
      if (frame.type === 'response' && frame.replay === true && p.controller) return;
      if (typeof frame.seq !== 'number' || frame.seq !== p.seq + 1) throw new Error('通信の欠落を検出しました。生成結果を確認してください。');
      p.seq = frame.seq;
      if (frame.type === 'response') {
        if (p.controller || typeof frame.status !== 'number') throw new Error('invalid_response');
        const stream = new ReadableStream<Uint8Array>({
          start: controller => { p.controller = controller; },
          cancel: () => { this.pending.delete(frame.id); p.cleanup(); },
        }, { highWaterMark: 2 * 1024 * 1024, size: chunk => chunk.byteLength });
        const headers = new Headers(frame.headers as Record<string, string>);
        headers.set('Cache-Control', 'no-store');
        p.resolve(new Response([204, 205, 304].includes(frame.status) ? null : stream, { status: frame.status, headers }));
      } else if (frame.type === 'chunk') {
        if (!p.controller || typeof frame.data !== 'string') throw new Error('invalid_chunk');
        if ((p.controller.desiredSize ?? 0) <= 0) throw new Error('受信が追いつきません。もう一度開いてください。');
        p.controller.enqueue(decodeBytes(frame.data));
      } else if (frame.type === 'end') {
        if (!p.controller) throw new Error('missing_response');
        this.pending.delete(frame.id); p.cleanup(); p.controller.close();
      } else throw new Error('unsupported_frame');
    } catch (error) { this.fail(frame.id, error); }
  }
  async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    init.signal?.throwIfAborted();
    const epoch = this.epoch;
    const admissionDeadline = Date.now() + 15000;
    while (this.pending.size + this.preparing >= 12) {
      init.signal?.throwIfAborted();
      if (epoch !== this.epoch) throw new Error('接続が終了しました。');
      if (Date.now() > admissionDeadline) throw new Error('通信が混雑しています。もう一度開いてください。');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.preparing++;
    try {
    const request = new Request(`https://runtime.invalid${path}`, init);
    // Bound reads BEFORE materializing multipart/stream bodies in memory.
    const parts: Uint8Array[] = []; let size = 0;
    const reader = request.body?.getReader();
    let cancelled: Error | undefined;
    const cancel = (reason: Error) => { cancelled = reason; void reader?.cancel().catch(() => {}); };
    const abortBody = () => cancel(new DOMException('送信を中断しました。', 'AbortError'));
    this.bodyCancels.add(cancel);
    init.signal?.addEventListener('abort', abortBody, { once: true });
    const bodyTimeout = setTimeout(() => cancel(new Error('添付の読み込みがタイムアウトしました。')), 15000);
    try {
      if (init.signal?.aborted) abortBody();
      if (reader) {
        while (true) {
          init.signal?.throwIfAborted();
          if (cancelled) throw cancelled;
          const chunk = await reader.read();
          if (cancelled) throw cancelled;
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('添付は16MiB以内にしてください。'); }
          parts.push(chunk.value);
        }
      }
      if (cancelled) throw cancelled;
    } finally {
      clearTimeout(bodyTimeout); init.signal?.removeEventListener('abort', abortBody);
      this.bodyCancels.delete(cancel); reader?.releaseLock();
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const part of parts) { body.set(part, offset); offset += part.length; }
    const headers: Record<string, string> = {};
    for (const name of ['content-type', 'accept']) {
      const value = request.headers.get(name); if (value) headers[name] = value;
    }
    const id = crypto.randomUUID();
    return new Promise<Response>((resolve, reject) => {
      const abort = () => this.fail(id, new DOMException('通信を終了しました。', 'AbortError'));
      const timeout = setTimeout(() => this.fail(id, new Error('通信がタイムアウトしました。生成結果を確認してください。')), 15 * 60 * 1000);
      this.pending.set(id, { resolve, reject, seq: -1, cleanup: () => { clearTimeout(timeout); init.signal?.removeEventListener('abort', abort); } });
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) { abort(); return; }
      void (async () => {
        if (body.length <= 24 * 1024) {
          await this.send({ type: 'request', id, method: request.method, path, headers, body: encodeBytes(body) });
          return;
        }
        await this.send({ type: 'request_start', id, method: request.method, path, headers, size: body.length });
        for (let offset = 0; offset < body.length; offset += 24 * 1024) {
          if (!this.pending.has(id)) return;
          await this.send({ type: 'request_chunk', id, data: encodeBytes(body.subarray(offset, offset + 24 * 1024)) });
        }
        if (this.pending.has(id)) await this.send({ type: 'request_end', id });
      })().catch(error => this.fail(id, error));
    });
    } finally { this.preparing--; }
  }
}
