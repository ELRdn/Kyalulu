import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function preparedSdkEntry(wasmWork: string, required: boolean) {
  const entry = resolve(wasmWork, 'sdk/index.js');
  if (required) {
    try {
      if (lstatSync(wasmWork).isSymbolicLink() || lstatSync(resolve(wasmWork, 'sdk-build.json')).isSymbolicLink()) throw Error('Linked SDK manifest');
      const record = JSON.parse(readFileSync(resolve(wasmWork, 'sdk-build.json'), 'utf8'));
      const checked = (name: string, digest: unknown) => {
        if (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(name) || name.split('/').some(part => part === '.' || part === '..')) throw Error('Invalid SDK path');
        if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid SDK digest');
        let path = wasmWork;
        for (const part of name.split('/')) {
          path = resolve(path, part);
          if (lstatSync(path).isSymbolicLink()) throw Error('Linked SDK input');
        }
        const bytes = readFileSync(path);
        if (createHash('sha256').update(bytes).digest('hex') !== digest) throw Error(`SDK hash mismatch: ${name}`);
        return bytes;
      };
      if (record.llama_revision !== '46ca246de9bb1c35269722a6240d37d9dfd79cad') throw Error('SDK source revision mismatch');
      for (const name of ['index.js', 'wllama.js', 'wllama.d.ts', 'package.json', 'LICENCE']) {
        if (!Object.hasOwn(record.sdk_files, name)) throw Error(`Missing SDK file: ${name}`);
      }
      const emitted = (directory = 'sdk'): string[] => readdirSync(resolve(wasmWork, directory), { withFileTypes: true }).flatMap(entry => {
        if (entry.isSymbolicLink()) throw Error('Linked SDK output');
        const name = `${directory}/${entry.name}`;
        return entry.isDirectory() ? emitted(name) : [name.slice(4)];
      });
      if (emitted().sort().join() !== Object.keys(record.sdk_files).sort().join()) throw Error('SDK output manifest is incomplete');
      for (const [name, digest] of Object.entries(record.sdk_files)) checked(`sdk/${name}`, digest);
      const assets = ['standard/wllama.js', 'standard/wllama.wasm', 'compat/wllama.js', 'compat/wllama.wasm'];
      if (Object.keys(record.runtime_assets).sort().join() !== assets.sort().join()) throw Error('Both runtime variants are required');
      for (const name of assets) {
        const bytes = checked(`build-${name}`, record.runtime_assets[name]);
        // shortcut: wire markers reject stale binaries; they do not prove real model token counts.
        if (name.endsWith('.wasm') && (!bytes.subarray(0, 4).equals(Buffer.from('\0asm')) || !bytes.includes('ctok_req') || !bytes.includes('ctok_res'))) throw Error('Native chat-count capability missing');
        if (name.endsWith('.wasm') && bytes.includes('countProbe')) throw Error('Diagnostic count probes cannot be bundled');
      }
    } catch (error) {
      throw new Error('Matched native chat-count SDK/WASM required. From the repository root run: python scripts/mobile_wasm/prepare.py && bash scripts/mobile_wasm/build.sh && python scripts/mobile_wasm/build_sdk.py', { cause: error });
    }
  }
  return existsSync(entry) ? entry : null;
}
