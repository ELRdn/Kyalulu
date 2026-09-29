// Build only the isolated browser probe; no app manifests/lockfiles are changed.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
const requireFromVite = createRequire(realpathSync(resolve('apps/web/node_modules/vite/package.json')));
const { build } = requireFromVite('esbuild');
await build({
  entryPoints: ['scripts/remote_crypto_library_probe.mjs'],
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022',
  nodePaths: [resolve('.artifacts/remote-v1/node_modules')],
  outfile: '.artifacts/remote-v1/library-probe.js',
});
