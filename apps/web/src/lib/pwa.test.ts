import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { canUsePwa } from "./pwa";

const template = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const scope = "https://example.test/portal/";
const files = ["index.html", "assets/app-123.js", "assets/app-123.css"];

function worker(options: { failInstall?: boolean; windows?: number; built?: boolean } = {}) {
  const handlers: Record<string, (event: any) => void> = {};
  const contents = new Map<string, string>();
  const cache = {
    addAll: vi.fn(async (requests: Request[]) => {
      if (options.failInstall) throw new Error("missing chunk");
      requests.forEach((request) => contents.set(request.url, "shell:" + request.url));
    }),
    match: vi.fn(async (key: string) => contents.get(key)),
  };
  const caches = { open: vi.fn(async () => cache), delete: vi.fn(async () => true), keys: vi.fn(async () => ["another-app", `kyalulu-shell:${scope}:old`]) };
  const self = {
    registration: { scope }, location: { origin: "https://example.test" },
    addEventListener: (name: string, handler: (event: any) => void) => { handlers[name] = handler; },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => Array.from({ length: options.windows ?? 1 }, (_, i) => ({ id: String(i), url: scope + "#/chats" }))) },
  };
  const fetch = vi.fn(async () => "network");
  const source = options.built === false ? template : template.replace("/* BUILD_FILES */ []", JSON.stringify(files)).replace("BUILD_VERSION", "test-version");
  runInNewContext(source, { self, caches, fetch, URL, Request, Set });
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

describe("shell worker privacy and lifecycle", () => {
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
