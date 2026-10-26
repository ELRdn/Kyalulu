import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from "vitest";
import { canUsePwa } from "./pwa";

const template = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const scope = "https://example.test/portal/";
const files = ["index.html", "assets/app-123.js", "assets/app-123.css"];

function worker(options: { failInstall?: boolean; windows?: number; built?: boolean; compressed?: boolean; corruptGzip?: boolean; documents?:boolean } = {}) {
  const handlers: Record<string, (event: any) => void> = {};
  const contents = new Map<string, string>();
  const cache = {
    addAll: vi.fn(async (requests: Request[]) => {
      if (options.failInstall) throw new Error("missing chunk");
      requests.forEach((request) => contents.set(request.url, "shell:" + request.url));
    }),
    match: vi.fn(async (key: string) => contents.get(key)),
    put: vi.fn(async (key: URL, response: Response) => { contents.set(key.href,await response.text()); }),
  };
  const caches = { open: vi.fn(async () => cache), delete: vi.fn(async () => true), keys: vi.fn(async () => ["another-app", `kyalulu-shell:${scope}:old`]) };
  const self = {
    registration: { scope }, location: { origin: "https://example.test" },
    addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => Array.from({ length: options.windows ?? 1 }, (_, i) => ({ id: String(i), url: scope + "#/chats" }))) },
  };
  const fetch = vi.fn(async (_request?: Request) => options.compressed ? new Response(options.corruptGzip ? 'corrupt' : gzipSync('wasm-fixture')) : "network");
  const source = options.built === false ? template : template
    .replace("/* BUILD_FILES */ []", JSON.stringify([...files,...(options.compressed?['runtime.wasm']:[]),...(options.documents?['device/index.html','migration/index.html']:[])]))
    .replace("/* BUILD_COMPRESSED */ {}", JSON.stringify(options.compressed ? {'runtime.wasm':{path:'runtime.wasm.gz',integrity:'sha256-fixture'}} : {}))
    .replace("BUILD_VERSION", "test-version");
  runInNewContext(source, { self, caches, fetch, URL, Request, Response, DecompressionStream, Set });
  const lifecycle = (name: string, extra = {}) => {
    let pending: Promise<unknown> | undefined;
    handlers[name]({ ...extra, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    return pending;
  };
  const request = (url: string, overrides = {}) => {
    const respondWith = vi.fn();
    handlers.fetch({ request: { url: new URL(url, scope).href, method: "GET", headers: new Headers(), mode: "cors", ...overrides }, respondWith });
    return respondWith;
  };
  return { self, caches, cache, fetch, lifecycle, request };
}

describe("PWA environment", () => {
  it("excludes Electron, file mode and insecure Android LAN HTTP", () => {
    expect(canUsePwa("https:", true, false)).toBe(true);
    expect(canUsePwa("http:", true, false)).toBe(true);
    expect(canUsePwa("http:", false, false)).toBe(false);
    expect(canUsePwa("file:", true, false)).toBe(false);
    expect(canUsePwa("https:", true, true)).toBe(false);
  });
});

it('blocks updates during generation and localizes explicit confirmation without automatic sending', async () => {
  vi.resetModules();
  vi.useFakeTimers();
  const storage = new Map<string, string>();
  const postMessage = vi.fn(), confirm = vi.fn(() => false), reload = vi.fn();
  const handlers = new Map<string, (event: any) => void>();
  const registration = { active: {}, waiting: { postMessage }, addEventListener: vi.fn() };
  vi.stubEnv('PROD', true);
  vi.stubEnv('BASE_URL', '/');
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('location', { protocol: 'https:', reload });
  vi.stubGlobal('document', { baseURI: 'https://example.test/device/', addEventListener: vi.fn() });
  vi.stubGlobal('navigator', { language: 'en-US', userAgent: '', onLine: true, serviceWorker: {
    register: vi.fn(async () => registration), addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn),
  } });
  vi.stubGlobal('window', { isSecureContext: true, location, confirm, matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
    addEventListener: vi.fn(), dispatchEvent: vi.fn() });
  try {
    const context = await import('./appContext');
    const pwa = await import('./pwa');
    await pwa.startPwa();
    context.setGenerationBusy(true);
    pwa.applyPwaUpdate();
    expect(confirm).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    context.setGenerationBusy(false);
    pwa.applyPwaUpdate();
    expect(confirm).toHaveBeenLastCalledWith(pwa.pwaMessages.en.confirm);
    expect(postMessage).not.toHaveBeenCalled();
    context.savePreferences({ ...context.preferences(), language: 'ja' });
    pwa.applyPwaUpdate();
    expect(confirm).toHaveBeenLastCalledWith(pwa.pwaMessages.ja.confirm);
    expect(postMessage).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    pwa.applyPwaUpdate();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'APPLY_UPDATE' });
    expect(reload).not.toHaveBeenCalled();
    handlers.get('message')!({ data: { type: 'UPDATE_BLOCKED' } });
    handlers.get('controllerchange')!({});
    expect(reload).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
  }
});

describe("shell worker privacy and lifecycle", () => {
  it('precaches canonical document URLs without redirects and serves both aliases offline',async()=>{
    const w=worker({documents:true});await w.lifecycle('install');
    const urls=w.cache.addAll.mock.calls[0][0].map(r=>r.url);
    expect(urls).toContain(scope+'device/');expect(urls).toContain(scope+'migration/');
    expect(urls).not.toContain(scope+'migration/index.html');
    for(const document of ['device','migration'])for(const alias of ['/', '/index.html']){
      const response=w.request(document+alias,{mode:'navigate'});
      expect(await response.mock.calls[0][0]).toBe('shell:'+scope+document+'/');
    }
    expect(w.request('private/index.html')).not.toHaveBeenCalled();expect(w.fetch).not.toHaveBeenCalled();
  });
  it('decodes only integrity-pinned compressed runtime assets and rejects corrupt gzip',async()=>{
    const w=worker({compressed:true});await w.lifecycle('install');
    const request=w.fetch.mock.calls[0][0] as unknown as Request;
    expect(request.url).toBe(scope+'runtime.wasm.gz');expect(request.integrity).toBe('sha256-fixture');
    expect(request.credentials).toBe('omit');expect(request.redirect).toBe('error');
    expect(await w.cache.match(scope+'runtime.wasm')).toBe('wasm-fixture');
    const bad=worker({compressed:true,corruptGzip:true});
    await expect(bad.lifecycle('install')).rejects.toThrow();
    expect(bad.caches.delete).toHaveBeenCalled();expect(bad.self.skipWaiting).not.toHaveBeenCalled();
  });
  it("preloads only build allowlisted URLs without credentials and waits for consent", async () => {
    const w = worker();
    await w.lifecycle("install");
    const requests = w.cache.addAll.mock.calls[0][0];
    expect(requests.map((r) => r.url)).toEqual(files.map((file) => scope + (file === "index.html" ? "" : file)));
    expect(requests.every((r) => r.credentials === "omit" && r.redirect === "error")).toBe(true);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
  });
  it("rejects unbuilt workers and failed precaches", async () => {
    const unbuilt = worker({ built: false });
    await expect(unbuilt.lifecycle("install")).rejects.toThrow("production build");
    const failed = worker({ failInstall: true });
    await expect(failed.lifecycle("install")).rejects.toThrow("missing chunk");
    expect(failed.caches.delete).toHaveBeenCalledWith(`kyalulu-shell:${scope}:test-version`);
    expect(failed.self.skipWaiting).not.toHaveBeenCalled();
  });
  it("never intercepts private data, unknown assets, query variants, or API navigation", async () => {
    const w = worker();
    await w.lifecycle("install");
    for (const path of ["/api/chats", "/api/assets/avatar.png", "uploads/avatar.png", "assets/private.png", "assets/private.js", "index.html?token=private", "assets/app-123.js?token=private", "https://other.test/assets/app-123.js"]) {
      expect(w.request(path)).not.toHaveBeenCalled();
      expect(w.request(path, { mode: "navigate" })).not.toHaveBeenCalled();
    }
    expect(w.request("index.html", { method: "POST" })).not.toHaveBeenCalled();
    expect(w.request("index.html", { headers: new Headers({ Authorization: "Bearer test" }) })).not.toHaveBeenCalled();
    expect(w.request("index.html", { headers: new Headers({ Range: "bytes=0-10" }) })).not.toHaveBeenCalled();
    expect(w.cache.match).not.toHaveBeenCalled();
  });
  it("serves the hash-router shell and split bundles offline without runtime writes", async () => {
    const w = worker();
    await w.lifecycle("install");
    for (const [path, mode, key] of [["./", "navigate", "index.html"], ["./#/profile", "navigate", "index.html"], ["index.html#/chats/session", "navigate", "index.html"], ["index.html", "navigate", "index.html"], ["assets/app-123.js", "cors", "assets/app-123.js"]]) {
      const response = w.request(path, { mode });
      expect(await response.mock.calls[0][0]).toBe("shell:" + scope + (key === "index.html" ? "" : key));
    }
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.cache.addAll).toHaveBeenCalledTimes(1);
  });
  it("requires an in-scope client and blocks updates while another tab is open", async () => {
    const source = { id: "0", postMessage: vi.fn() };
    const multi = worker({ windows: 2 });
    await multi.lifecycle("message", { data: { type: "APPLY_UPDATE" }, source });
    expect(source.postMessage).toHaveBeenCalledWith({ type: "UPDATE_BLOCKED" });
    expect(multi.self.skipWaiting).not.toHaveBeenCalled();
    const single = worker();
    await single.lifecycle("message", { data: { type: "APPLY_UPDATE" }, source: { id: "unknown" } });
    expect(single.self.skipWaiting).not.toHaveBeenCalled();
    await single.lifecycle("message", { data: { type: "APPLY_UPDATE" }, source });
    expect(single.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it("cleans only this application's previous shell caches", async () => {
    const w = worker();
    await w.lifecycle("activate");
    expect(w.caches.delete.mock.calls).toEqual([[`kyalulu-shell:${scope}:old`]]);
  });
});
