// Production Vite bundling with an isolated dependency alias; no manifest edits.
import { realpathSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const viteRoot = dirname(realpathSync('apps/web/node_modules/vite/package.json'));
const { build } = await import(pathToFileURL(resolve(viteRoot, 'dist/node/index.js')).href);
const root = resolve('.artifacts/remote-v1');
const outDir = resolve(root, 'wrapper-dist');
const installedManifest = resolve('apps/web/node_modules/noise-c.wasm/package.json');
const vendorRoot = existsSync(installedManifest)
  ? dirname(realpathSync(installedManifest)) : resolve(root, 'node_modules/noise-c.wasm');
if (JSON.parse(readFileSync(resolve(vendorRoot, 'package.json'), 'utf8')).version !== '0.4.0') {
  throw new Error('This acceptance build qualifies noise-c.wasm@0.4.0 only');
}
mkdirSync(outDir, { recursive: true });
await build({
  configFile: false, root, logLevel: 'warn',
  resolve: { alias: [{ find: /^noise-c\.wasm(?=\/|$)/, replacement: vendorRoot }] },
  build: {
    outDir, emptyOutDir: false, minify: true,
    rollupOptions: {
      input: resolve('scripts/remote_crypto_wrapper_browser.ts'),
      output: { entryFileNames: 'wrapper.js' },
    },
  },
});
writeFileSync(resolve(outDir, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="./wrapper.js"></script>');
