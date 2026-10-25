import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import MobileAppStatus from './MobileAppStatus';
import { pwaMessages } from '../lib/pwa';

const fixture = vi.hoisted(() => ({ language: 'en', state: {
  enabled: true, online: true, installed: false, installable: true,
  offlineReady: true, updateAvailable: true, busy: false, error: null as string | null,
} }));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/pwa', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/pwa')>(),
  usePwa: () => fixture.state, startPwa: vi.fn(),
}));

beforeEach(() => {
  fixture.language = 'en';
  Object.assign(fixture.state, { enabled: true, online: true, installed: false, installable: true,
    offlineReady: true, updateAvailable: true, busy: false, error: null });
});

it.each(['ja', 'en'] as const)('renders live status, update warnings and all errors in %s', language => {
  fixture.language = language;
  for (const error of Object.keys(pwaMessages.ja).filter(key => key !== 'confirm')) {
    fixture.state.error = error;
    const html = renderToStaticMarkup(<MobileAppStatus />);
    expect(html).toContain(language === 'en' ? 'Stop generation and save your input' : '会話の生成を止め');
    expect(html).toContain(pwaMessages[language][error as keyof typeof pwaMessages.ja]);
    expect(html).toContain(language === 'en' ? 'selected execution target and storage policy' : '選択した実行先と保存方針');
    if (language === 'en') expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  }
});

it('translates a retained error when language changes and preserves offline/device guidance', () => {
  fixture.state.error = 'otherTabs';
  fixture.language = 'ja';
  expect(renderToStaticMarkup(<MobileAppStatus />)).toContain(pwaMessages.ja.otherTabs);
  fixture.language = 'en';
  Object.assign(fixture.state, { online: false, busy: true });
  const html = renderToStaticMarkup(<MobileAppStatus local />);
  expect(html).toContain(pwaMessages.en.otherTabs);
  expect(html).toContain('AI runs on this device');
  expect(html).toContain('Use prepared models on this device');
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  fixture.state.enabled = false;
  expect(renderToStaticMarkup(<MobileAppStatus />)).toBe('');
});
