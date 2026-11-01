import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from './vite.config';
import { readFileSync } from 'node:fs';
import type { Plugin, PreviewServer } from 'vite';
import { createHash } from 'node:crypto';

const fixture = vi.hoisted(() => ({ files: new Map<string, Buffer>(), links: new Set<string>() }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const name = (path: unknown) => String(path).replaceAll('\\', '/').split('/.artifacts/mobile-wasm/')[1];
  return {
    ...actual,
    existsSync: (path: unknown) => name(path) === undefined ? actual.existsSync(path as string) : fixture.files.has(name(path)!),
    lstatSync: (path: unknown) => name(path) === undefined ? actual.lstatSync(path as string) : ({ isSymbolicLink: () => fixture.links.has(name(path)!) }),
    readdirSync: (path: unknown, options: unknown) => {
      const key = name(path);
      if (key === undefined) return actual.readdirSync(path as string, options as never);
      const names = [...new Set([...fixture.files.keys()].filter(file => file.startsWith(key + '/')).map(file => file.slice(key.length + 1).split('/')[0]))];
      return names.map(file => ({ name: file, isSymbolicLink: () => fixture.links.has(key + '/' + file), isDirectory: () => !fixture.files.has(key + '/' + file) }));
    },
    readFileSync: (path: unknown, encoding?: string) => {
      const key = name(path);
      if (key === undefined) return actual.readFileSync(path as string, encoding as BufferEncoding);
      const bytes = fixture.files.get(key);
      if (!bytes) throw Error(`Missing fictional SDK file: ${key}`);
      return encoding ? bytes.toString(encoding as BufferEncoding) : bytes;
    },
  };
});

function sdkRecord() {
  return JSON.parse(fixture.files.get('sdk-build.json')!.toString());
}

function writeRecord(record: ReturnType<typeof sdkRecord>) {
  fixture.files.set('sdk-build.json', Buffer.from(JSON.stringify(record)));
}

beforeEach(() => {
  fixture.files.clear(); fixture.links.clear();
  const sdk = ['index.js', 'wllama.js', 'wllama.d.ts', 'package.json', 'LICENCE', 'workers-code/generated.js'];
  const assets = ['standard/wllama.js', 'standard/wllama.wasm', 'compat/wllama.js', 'compat/wllama.wasm'];
  const hash = (name: string, content: string) => {
    const bytes = Buffer.from(content);
    fixture.files.set(name, bytes);
    return createHash('sha256').update(bytes).digest('hex');
  };
  writeRecord({
    llama_revision: '46ca246de9bb1c35269722a6240d37d9dfd79cad',
    sdk_files: Object.fromEntries(sdk.map(name => [name, hash(`sdk/${name}`, 'fictional SDK ' + name)])),
    runtime_assets: Object.fromEntries(assets.map(name => [name, hash(`build-${name}`, name.endsWith('.wasm') ? '\0asmctok_req\0ctok_res' : 'fictional runtime')])),
    native_count_verified: false, release_accepted: false,
  });
});

function configure(mode = 'unified', command: 'build' | 'serve' = 'build') {
  if (typeof config !== 'function') throw new Error('Expected the Vite config factory');
  return config({ mode, command, isSsrBuild: false, isPreview: false });
}

afterEach(() => vi.unstubAllEnvs());

describe.each(['unified', 'native'])('%s release Relay configuration', mode => {
  it.each([undefined, '', 'invalid', 'http://relay.kyalulu.com', 'wss://relay.kyalulu.com',
    'https://relay.kyalulu.com/', 'https://user:secret@relay.kyalulu.com',
    'https://relay.kyalulu.com?token=secret', 'https://relay.kyalulu.com/path'])('rejects an absent or non-origin setting: %s', origin => {
    vi.stubEnv('VITE_RELAY_ORIGIN', origin);
    expect(() => configure(mode)).toThrow('Set VITE_RELAY_ORIGIN');
  });

  it('accepts the pinned production Relay without contacting it', () => {
    vi.stubEnv('VITE_RELAY_ORIGIN', 'https://relay.kyalulu.com');
    expect(() => configure(mode)).not.toThrow();
  });

  it('keeps development and legacy/mobile builds available without a managed Relay', () => {
    vi.stubEnv('VITE_RELAY_ORIGIN', undefined);
    expect(() => configure('unified', 'serve')).not.toThrow();
    expect(() => configure('production')).not.toThrow();
    expect(() => configure('mobile')).not.toThrow();
  });
});

describe('matched public SDK integration', () => {
  it.each(['unified', 'native', 'mobile'])('aliases the public SDK for a matched %s build without claiming model acceptance', mode => {
    vi.stubEnv('VITE_RELAY_ORIGIN', 'https://relay.kyalulu.com');
    const aliases = configure(mode).resolve?.alias as { find: RegExp; replacement: string }[];
    expect(aliases).toHaveLength(1);
    expect(aliases[0].find.test('@wllama/wllama')).toBe(true);
    expect(aliases[0].find.test('@wllama/wllama-compat')).toBe(false);
    expect(aliases[0].replacement.replaceAll('\\', '/')).toMatch(/\.artifacts\/mobile-wasm\/sdk\/index.js$/);
  });

  it.each(['missing-sdk', 'missing-manifest', 'sdk-hash', 'unhashed-output', 'standard-js', 'compat-wasm', 'missing-variant', 'extra-variant', 'old-wasm', 'escape', 'linked', 'bad-revision'])('rejects %s before production bundling', fault => {
    vi.stubEnv('VITE_RELAY_ORIGIN', 'https://relay.kyalulu.com');
    const record = sdkRecord();
    if (fault === 'missing-sdk') fixture.files.delete('sdk/index.js');
    if (fault === 'missing-manifest') fixture.files.delete('sdk-build.json');
    if (fault === 'sdk-hash') fixture.files.set('sdk/wllama.js', Buffer.from('tampered'));
    if (fault === 'unhashed-output') delete record.sdk_files['workers-code/generated.js'];
    if (fault === 'standard-js') fixture.files.set('build-standard/wllama.js', Buffer.from('tampered'));
    if (fault === 'compat-wasm') fixture.files.set('build-compat/wllama.wasm', Buffer.from('tampered'));
    if (fault === 'missing-variant') delete record.runtime_assets['compat/wllama.js'];
    if (fault === 'extra-variant') record.runtime_assets['unknown/wllama.js'] = '0'.repeat(64);
    if (fault === 'old-wasm') {
      const old = Buffer.from('\0asmold runtime');
      fixture.files.set('build-standard/wllama.wasm', old);
      record.runtime_assets['standard/wllama.wasm'] = createHash('sha256').update(old).digest('hex');
    }
    if (fault === 'escape') record.sdk_files['../../outside'] = '0'.repeat(64);
    if (fault === 'linked') fixture.links.add('sdk');
    if (fault === 'bad-revision') record.llama_revision = 'unrelated';
    if (fault !== 'missing-manifest') writeRecord(record);
    for (const mode of ['unified', 'native', 'mobile']) expect(() => configure(mode)).toThrow('python scripts/mobile_wasm/build_sdk.py');
  });

  it('preserves legacy, development and test mock workflows when no SDK is prepared', () => {
    fixture.files.clear();
    expect(configure('production').resolve?.alias).toEqual([]);
    expect(configure('test').resolve?.alias).toEqual([]);
    for (const mode of ['unified', 'native', 'mobile']) expect(configure(mode, 'serve').resolve?.alias).toEqual([]);
  });
});

it('marks native HTML and retains the unified device/migration delivery pipeline', async () => {
  vi.stubEnv('VITE_RELAY_ORIGIN', 'https://relay.example.test');
  const native = configure('native'), unified = configure();
  expect(native.build?.rollupOptions?.input).toEqual(unified.build?.rollupOptions?.input);
  expect(native.build?.rollupOptions?.input).toHaveProperty('migration');
  const plugins = native.plugins?.flat() as Plugin[];
  const marker = plugins.find(plugin => plugin?.name === 'kyalulu-native-entry')?.transformIndexHtml;
  if (!marker || typeof marker === 'function' || !('handler' in marker)) throw Error('Missing native HTML marker');
  for (const document of ['index.html', 'migration/index.html']) {
    const html = readFileSync(new URL(document, import.meta.url), 'utf8');
    const transformed = await marker.handler(html, {} as never);
    expect(transformed).toContain('<meta name="kyalulu-ui" content="native">');
    expect(transformed).toContain(html.slice(html.indexOf('</head>')));
  }
  expect((unified.plugins?.flat() as Plugin[]).some(plugin => plugin?.name === 'kyalulu-native-entry')).toBe(false);
  const shell = plugins.find(plugin => plugin?.name === 'kyalulu-shell-precache');
  if (typeof shell?.configurePreviewServer !== 'function') throw Error('Missing native delivery hook');
  const use = vi.fn();
  shell.configurePreviewServer({ middlewares: { use } } as unknown as PreviewServer);
  for (const [url, expected] of [['/device/', 'require-corp'], ['/migration/', 'unsafe-none'], ['/', undefined]]) {
    const headers = new Map(), next = vi.fn();
    use.mock.calls[0][0]({ url }, { setHeader: (key: string, value: string) => headers.set(key, value) }, next);
    expect(headers.get('Cross-Origin-Embedder-Policy')).toBe(expected);
    expect(next).toHaveBeenCalledOnce();
  }
});

it('builds native output separately from hosted unified and legacy Mobile output', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
  expect(scripts['build:native']).toBe('tsc -b && vite build --mode native --outDir ../../.artifacts/native-app --emptyOutDir');
});
