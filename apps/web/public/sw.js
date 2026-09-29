/* Replaced by the Vite build. The public template cannot install in development. */
const FILES = /* BUILD_FILES */ [];
const INTEGRITY = /* BUILD_INTEGRITY */ {};
const VERSION = "BUILD_VERSION";
const PREFIX = `kyalulu-shell:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;
const SHELL = new URL("index.html", self.registration.scope).href;
const ROOT = new URL("./", self.registration.scope).href;
const ALLOWED = new Set(FILES.map((file) => new URL(file, self.registration.scope).href));
ALLOWED.add(ROOT);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (!FILES.length) throw new Error("A production build is required");
    const cache = await caches.open(CACHE);
    try {
      // addAll is atomic. A missing chunk must leave the current worker intact.
      // SRI rejects mixed deployments and HTML fallbacks masquerading as chunks.
      // Pages canonicalizes index.html to the scope root. Request it directly;
      // retain SRI and reject redirects for every asset.
      await cache.addAll(FILES.map((file) => new Request(new URL(file === "index.html" ? "./" : file, self.registration.scope), {
        cache: "reload", credentials: "omit", redirect: "error", integrity: INTEGRITY[file],
      })));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    // Wait for explicit user consent; never skipWaiting on install.
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "APPLY_UPDATE") return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const inScope = windows.filter((client) => client.url.startsWith(self.registration.scope));
    // Another tab might be streaming or editing. Ask the user to close it first.
    if (!event.source || !inScope.some((client) => client.id === event.source.id)) return;
    if (inScope.length > 1) { event.source.postMessage({ type: "UPDATE_BLOCKED" }); return; }
    await self.skipWaiting();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Navigation Request.url can retain the hash route in Chromium. Fragments
  // identify a screen, not a different shell resource.
  url.hash = "";
  if (request.method !== "GET" || url.origin !== self.location.origin || url.search || request.headers.has("authorization") || request.headers.has("range")) return;
  // Only the hash-router document and exact build outputs are eligible.
  // API calls, private media, avatars, conversations, external fonts and unknown
  // URLs go directly to the network and never enter Cache Storage.
  const key = (url.href === ROOT || url.href === SHELL) ? ROOT : url.href;
  if (!ALLOWED.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(key)) || fetch(request); // No runtime cache writes.
  })());
});
