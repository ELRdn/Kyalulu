import { net, protocol } from "electron";
import { resolve, sep } from "path";
import { pathToFileURL } from "url";
import { API_BASE } from "./api";

// A stable origin keeps relative fetch, images and downloads working in packaged builds.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

export function installProtocol(rendererRoot: string): void {
  const root = resolve(rendererRoot);
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "kyalulu") return new Response("Not found", { status: 404 });
    if (url.pathname.startsWith("/api/")) {
      const headers = new Headers(request.headers);
      headers.delete("origin");
      headers.delete("referer");
      headers.delete("host");
      headers.delete("sec-fetch-site");
      try {
        return await net.fetch(`${API_BASE}${url.pathname}${url.search}`, {
          method: request.method, headers, signal: request.signal,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
          redirect: "error"
        });
      } catch {
        return Response.json({ error: "Kyalulu API unavailable" }, { status: 503 });
      }
    }
    try {
      const path = resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
      if (!path.startsWith(root + sep)) return new Response("Forbidden", { status: 403 });
      return await net.fetch(pathToFileURL(path).href);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}
