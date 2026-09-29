import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat, fetchGeneration, cancelGeneration, fetchSessions, fetchModels, fetchSettings, clearHistory, fetchHistory } from "./api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("chat stream lifecycle", () => {
  it("submits the exact durable ID once and ignores frames after a terminal event", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('event: done\ndata: {"full":"saved"}\n\nevent: token\ndata: {"token":"late"}\n\nevent: done\ndata: {"full":"duplicate"}\n\n'));
    vi.stubGlobal("fetch", fetch);
    const tokens = vi.fn(); const done = vi.fn();
    await new Promise<void>(resolve => streamChat("mock", [], { generation_id: "persisted-g1" }, {
      onToken: tokens, onDone: (...args) => { done(...args); resolve(); },
    }));
    expect(JSON.parse(fetch.mock.calls[0][1].body).generation_id).toBe("persisted-g1");
    expect(fetch).toHaveBeenCalledTimes(1); expect(done).toHaveBeenCalledTimes(1); expect(tokens).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 422, 409, 500])("distinguishes explicit rejection from uncertain HTTP %s", async status => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":"failed"}', { status }));
    vi.stubGlobal("fetch", fetch);
    const details = await new Promise<unknown>(resolve => streamChat("mock", [], {}, {
      onToken: vi.fn(), onError: (_error, details) => resolve(details),
    }));
    expect(details).toEqual({ rejected: [400, 401, 403, 422].includes(status) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("records definitive rejection even if the auth gate unmounts the stream caller", async () => {
    let respond!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const rejected = vi.fn(); const error = vi.fn();
    const stop = streamChat("mock", [], {}, { onToken: vi.fn(), onRejected: rejected, onError: error });
    stop(); respond(new Response('{}', { status: 401 }));
    await vi.waitFor(() => expect(rejected).toHaveBeenCalledTimes(1));
    expect(error).not.toHaveBeenCalled();
  });
  it("waits beyond eight seconds without issuing a second request", async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    const fetch = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal("fetch", fetch);
    const done = vi.fn();
    streamChat("mock-echo", [], {}, { onToken: vi.fn(), onDone: done });
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    controller.enqueue(new TextEncoder().encode('event: done\ndata: {"full":"hello"}\n\n'));
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledWith("hello", { full: "hello" });
  });

  it("processes reset then final replacement, without leaking JSON", async () => {
    const body = 'event: token\ndata: {"token":"old"}\n\nevent: reset\ndata: {"full":""}\n\nevent: done\ndata: {"full":"new"}\n\n';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const received: string[] = [];
    await new Promise<void>((resolve, reject) => streamChat("mock", [], {}, {
      onToken: t => received.push(t), onReset: t => received.push(t),
      onDone: t => { received.push(t); resolve(); }, onError: reject,
    }));
    expect(received).toEqual(["old", "", "new"]);
  });

  it("reports a truncated stream once", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('event: token\ndata: {"token":"partial"}\n\n')));
    const done = vi.fn();
    const error = await new Promise<string>(resolve => streamChat("mock", [], {}, { onToken: vi.fn(), onDone: done, onError: resolve }));
    expect(error).toContain("接続が終了");
    expect(done).not.toHaveBeenCalled();
  });

  it("aborts without dispatching an error after route unmount", async () => {
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }));
    const error = vi.fn();
    const stop = streamChat("mock", [], {}, { onToken: vi.fn(), onError: error });
    stop();
    await Promise.resolve(); await Promise.resolve();
    expect(signal.aborted).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("failed Runtime requests", () => {
  it.each([401, 500])("rejects HTTP %s instead of reporting empty data or successful deletion", async status => {
    const fetch = vi.fn(() => Promise.resolve(new Response('{"error":"server diagnostic"}', { status })));
    vi.stubGlobal("fetch", fetch);
    for (const load of [fetchSessions, fetchModels, () => fetchSettings("s"), () => clearHistory("s"), () => fetchHistory("s")]) {
      await expect(load()).rejects.toThrow("server diagnostic");
    }
  });
  it("preserves an HTTP error when the server returns HTML", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('<html>proxy error</html>', { status: 502 })));
    await expect(fetchSessions()).rejects.toThrow("HTTP 502");
  });
  it("checks generation identity with a GET and never retries a 404 as a POST", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchGeneration("g /1", "session?a")).rejects.toThrow("404");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/chat/generations/g%20%2F1?session_id=session%3Fa");
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
    expect(fetch.mock.calls[0][1].cache).toBe("no-store");
  });
  it("uses explicit cancellation without issuing another generation", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    await cancelGeneration("g1", "s");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/chat/generations/g1/cancel?session_id=s");
    expect(fetch.mock.calls[0][1].method).toBe("POST");
  });
});
