import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, copyFile, unlink } from "node:fs/promises";
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from "node:path";

const mobilePolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

const migrationPolicy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

// Explicit build-time allowlist: never glob public/ or cache runtime responses.
function shellPrecache(mobile = false, device = false): Plugin {
  const runtime = mobile || device;
  let root: string;
  let outDir: string;
  return {
    name: "kyalulu-shell-precache",
    enforce: "post",
    configResolved(config) { root = config.root; outDir = resolve(root, config.build.outDir); },
    configureServer(server) {
      if (runtime) server.middlewares.use((req,res,next)=>{
        const path=req.url?.split('?')[0]??'';
        if(/^\/migration(?:\/|$)/.test(path)){
          res.setHeader('Cross-Origin-Opener-Policy','unsafe-none');res.setHeader('Cross-Origin-Embedder-Policy','unsafe-none');
          res.setHeader('Content-Security-Policy',migrationPolicy.replace("connect-src 'none'","connect-src 'self' ws://127.0.0.1:* ws://localhost:*"));
        }else if(mobile||path.startsWith('/device/')||path==='/src/mobile/runtime.worker.ts'){
          res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
        }
        next();
      });
      if (!runtime) return;
      const require = createRequire(realpathSync(resolve(root, 'node_modules/@huggingface/transformers/package.json')));
      const ort = dirname(require.resolve('onnxruntime-web'));
      server.middlewares.use('/runtime', async (req, res, next) => {
        const match = req.url?.split('?')[0].match(/^\/(standard|compat)\/(wllama\.(?:js|wasm))$/);
        if (!match) return next();
        try {
          const file = resolve(root, '../../.artifacts/mobile-wasm', `build-${match[1]}`, match[2]);
          res.setHeader('Content-Type', match[2].endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
          res.end(await readFile(file));
        } catch { res.statusCode = 404; res.end('WASM build required'); }
      });
      server.middlewares.use('/ort', async (req, res, next) => {
        const name = req.url?.split('?')[0].slice(1) ?? '';
        if (!/^ort-wasm[\w.-]+\.(wasm|mjs)$/.test(name)) return next();
        try { res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); res.end(await readFile(resolve(ort, name))); }
        catch { next(); }
      });
    },
    configurePreviewServer(server) {
      if (!runtime) return;
      server.middlewares.use((req,res,next)=>{
        const path=req.url?.split('?')[0]??'';
        if(/^\/migration(?:\/|$)/.test(path)){
          res.setHeader('Cross-Origin-Opener-Policy','unsafe-none');res.setHeader('Cross-Origin-Embedder-Policy','unsafe-none');
          res.setHeader('Content-Security-Policy',migrationPolicy);
        }else if(mobile||path.startsWith('/device/')||/^\/assets\/runtime\.worker-[\w-]+\.js$/.test(path)){
          res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
          res.setHeader('Content-Security-Policy',device?mobilePolicy.replace("base-uri 'none'", "base-uri 'self'"):mobilePolicy);
        }
        next();
      });
      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.split('?')[0] ?? '';
        if (!/^\/(?:ort|assets)\/[\w.-]+\.wasm\.gz$/.test(name)) return next();
        try { res.setHeader('Content-Type', 'application/gzip'); res.end(await readFile(resolve(outDir, name.slice(1)))); }
        catch { next(); }
      });
    },
    async writeBundle(_options, bundle) {
      const runtimeFiles: string[] = [];
      const compressed: Record<string, {path: string; integrity: string}> = {};
      const originalIntegrity: Record<string, string> = {};
      if (runtime) {
        for (const variant of ['standard', 'compat']) {
          const source = resolve(root, '../../.artifacts/mobile-wasm', `build-${variant}`);
          await mkdir(resolve(outDir, 'runtime', variant), { recursive: true });
          for (const name of ['wllama.js', 'wllama.wasm']) {
            await copyFile(resolve(source, name), resolve(outDir, 'runtime', variant, name));
            runtimeFiles.push(`runtime/${variant}/${name}`);
          }
        }
        const require = createRequire(realpathSync(resolve(root, 'node_modules/@huggingface/transformers/package.json')));
        const ort = dirname(require.resolve('onnxruntime-web'));
        await mkdir(resolve(outDir, 'ort'), { recursive: true });
        for (const name of (await readdir(ort)).filter(n => /^ort-wasm.*\.(wasm|mjs)$/.test(n))) {
          await copyFile(resolve(ort, name), resolve(outDir, 'ort', name));
          runtimeFiles.push(`ort/${name}`);
        }
        if (mobile) {
        const manifest = JSON.parse(await readFile(resolve(outDir, 'manifest.webmanifest'), 'utf8'));
        manifest.name = 'Kyalulu Mobile — スマホで動くキャラクターAI'; manifest.short_name = 'Kyalulu Mobile';
        manifest.start_url = './';
        await writeFile(resolve(outDir, 'manifest.webmanifest'), JSON.stringify(manifest));
        }
        for (const name of [...new Set([...Object.keys(bundle), ...runtimeFiles])].filter(n => n.endsWith('.wasm'))) {
          const bytes = await readFile(resolve(outDir, name));
          if (bytes.length > 25 * 1024 * 1024) {
            const packed = gzipSync(bytes, { level: 9 });
            await writeFile(resolve(outDir, name + '.gz'), packed);
            await unlink(resolve(outDir, name));
            compressed[name] = {path: name + '.gz', integrity: 'sha256-' + createHash('sha256').update(packed).digest('base64')};
            originalIntegrity[name] = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
          }
        }
        const isolated=`  Content-Security-Policy: ${device?mobilePolicy.replace("base-uri 'none'", "base-uri 'self'"):mobilePolicy}\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n`;
        await writeFile(resolve(outDir, '_headers'), `/*\n  Referrer-Policy: no-referrer\n  Strict-Transport-Security: max-age=31536000\n  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n  Cache-Control: no-cache, no-transform\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n${mobile?'/\n'+isolated+'/index.html\n'+isolated:'/device/*\n'+isolated}/assets/runtime.worker-*.js\n${isolated}/migration/*\n  Content-Security-Policy: ${migrationPolicy}\n  Cross-Origin-Opener-Policy: unsafe-none\n  Cross-Origin-Embedder-Policy: unsafe-none\n`);
        await writeFile(resolve(outDir, '404.html'), '<!doctype html><meta charset="utf-8"><title>Not found</title>Not found');
      }
      if(device){
        await mkdir(resolve(outDir,'device'),{recursive:true});
        const html=await readFile(resolve(outDir,'index.html'),'utf8');
        await writeFile(resolve(outDir,'device/index.html'),html.replace('<head>','<head><base href="../">'));
        runtimeFiles.push('device/index.html');
      }
      const files = ["index.html", "theme-init.js", "manifest.webmanifest", "apple-touch-icon.png", "favicon.ico", "favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
        ...(runtime ? ['migration/index.html'] : []),
        ...(device ? ['icons/rei-senpai.png', 'icons/shion-butler-1.png', 'icons/mocha-1.png'] : []),
        ...["sit", "guide", "nap", "face-default", "face-wink", "face-curious"].map(name => `mascot/v1.2/${name}.png`),
        ...Object.keys(bundle).filter((name) => /\.(js|css|wasm)$/.test(name)),
        ...runtimeFiles,
      ].sort();
      const hash = createHash("sha256");
      const template = await readFile(resolve(root, "public/sw.js"), "utf8");
      hash.update(template);
      // Cached worker headers affect isolation; delivery-policy changes need a fresh cache.
      if (runtime) hash.update(await readFile(resolve(outDir, '_headers')));
      const integrity: Record<string, string> = {};
      for (const file of files) {
        const content = await readFile(resolve(outDir, compressed[file]?.path ?? file));
        hash.update(file); hash.update(content);
        integrity[file] = originalIntegrity[file] ?? `sha256-${createHash("sha256").update(content).digest("base64")}`;
      }
      await writeFile(resolve(outDir, "sw.js"), template
        .replace("/* BUILD_FILES */ []", JSON.stringify(files))
        .replace("/* BUILD_INTEGRITY */ {}", JSON.stringify(integrity))
        .replace("/* BUILD_COMPRESSED */ {}", JSON.stringify(compressed))
        .replace("BUILD_VERSION", hash.digest("hex").slice(0, 20)));
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), ...(mode === 'mobile' ? [{ name: 'kyalulu-mobile-entry', transformIndexHtml: { order: 'pre' as const, handler: (html: string) => html.replace('/src/main.tsx', '/src/mobile/main.tsx').replace('<title>Kyalulu — キャラクターと物語をつむぐ場所</title>', '<title>Kyalulu Mobile — スマホで動くキャラクターAI</title>') } }] : []), shellPrecache(mode === 'mobile', mode === 'unified')],
  worker: { format: 'es' },
  build: { rollupOptions: { input: mode==='mobile'||mode==='unified'?{main:resolve('index.html'),migration:resolve('migration/index.html')}:resolve('index.html') } },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.KYALULU_API_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
}));
