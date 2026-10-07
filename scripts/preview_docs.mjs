import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.artifacts/landing-site');
const port = Number(process.env.KYALULU_DOCS_PORT || 5185);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const rules = [];
let current;
for (const line of (await readFile(path.join(root, '_headers'), 'utf8')).split('\n')) {
  if (line.startsWith('/')) { current = { route: line, headers: {} }; rules.push(current); }
  else if (current && line.startsWith('  ')) {
    const split = line.indexOf(':');
    current.headers[line.slice(2, split)] = line.slice(split + 1).trim();
  }
}
const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
  let url;
  try { url = new URL(request.url, `http://127.0.0.1:${port}`); } catch { response.writeHead(400); response.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { response.writeHead(400); response.end(); return; }
  const target = path.resolve(root, `.${pathname}`);
  if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  let filename = target;
  let status = 200;
  try {
    if ((await stat(filename)).isDirectory()) {
      if (!pathname.endsWith('/')) { response.writeHead(301, { Location: `${url.pathname}/${url.search}` }); response.end(); return; }
      filename = path.join(filename, 'index.html');
    } else if (pathname.endsWith('/index.html') && pathname.startsWith('/docs/')) {
      response.writeHead(301, { Location: pathname.replace(/index\.html$/, '') + url.search }); response.end(); return;
    }
    await stat(filename);
  } catch { filename = path.join(root, '404.html'); status = 404; }
  const headers = { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' };
  for (const rule of rules) {
    if (rule.route.endsWith('*') ? pathname.startsWith(rule.route.slice(0, -1)) : pathname === rule.route) Object.assign(headers, rule.headers);
  }
  try { const buffer = await readFile(filename); response.writeHead(status, headers); response.end(request.method === 'HEAD' ? undefined : buffer); }
  catch { response.writeHead(500); response.end('Unable to read the built page.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Kyalulu docs preview: http://127.0.0.1:${port}/docs/`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
