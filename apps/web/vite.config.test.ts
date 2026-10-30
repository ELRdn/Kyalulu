import { afterEach, describe, expect, it, vi } from 'vitest';
import config from './vite.config';

function configure(mode = 'unified', command: 'build' | 'serve' = 'build') {
  if (typeof config !== 'function') throw new Error('Expected the Vite config factory');
  return config({ mode, command, isSsrBuild: false, isPreview: false });
}

afterEach(() => vi.unstubAllEnvs());

describe('unified release Relay configuration', () => {
  it.each([undefined, '', 'invalid', 'http://relay.kyalulu.com', 'wss://relay.kyalulu.com',
    'https://relay.kyalulu.com/', 'https://user:secret@relay.kyalulu.com',
    'https://relay.kyalulu.com?token=secret', 'https://relay.kyalulu.com/path'])('rejects an absent or non-origin setting: %s', origin => {
    vi.stubEnv('VITE_RELAY_ORIGIN', origin);
    expect(() => configure()).toThrow('Set VITE_RELAY_ORIGIN');
  });

  it('accepts the pinned production Relay without contacting it', () => {
    vi.stubEnv('VITE_RELAY_ORIGIN', 'https://relay.kyalulu.com');
    expect(() => configure()).not.toThrow();
  });

  it('keeps development and legacy/mobile builds available without a managed Relay', () => {
    vi.stubEnv('VITE_RELAY_ORIGIN', undefined);
    expect(() => configure('unified', 'serve')).not.toThrow();
    expect(() => configure('production')).not.toThrow();
    expect(() => configure('mobile')).not.toThrow();
  });
});
