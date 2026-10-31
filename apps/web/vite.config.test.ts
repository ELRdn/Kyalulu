import { afterEach, describe, expect, it, vi } from 'vitest';
import config from './vite.config';
import { readFileSync } from 'node:fs';
import type { Plugin, PreviewServer } from 'vite';

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
