import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChat } from "./api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("chat stream lifecycle", () => {
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
