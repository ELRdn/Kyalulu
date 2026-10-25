import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Discover from '../pages/Discover';
import AppShell from '../layout/AppShell';
import CommandPalette from './CommandPalette';
import HubBrowser from './HubBrowser';
import HubLinks from './HubLinks';
import { sessionTitle } from '../lib/api';
import { friendlyMessage } from '../lib/errors';

const fixture = vi.hoisted(() => ({ language: 'en', administrative: false, guest: false,
  params: new URLSearchParams(), states: [] as unknown[], next: 0,
  navigate: vi.fn(), close: vi.fn(), browse: vi.fn(), fetch: vi.fn(), preview: vi.fn(), hub: vi.fn(), toggle: vi.fn(),
}));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(), useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [fixture.states[fixture.next++] ?? (typeof initial === 'function' ? initial() : initial), vi.fn()],
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => fixture.navigate, useSearchParams: () => [fixture.params, vi.fn()],
  useLocation: () => ({ pathname: '/', search: '' }), Outlet: () => <div />,
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
  NavLink: ({ to, children, className, ...props }: any) => <a href={to} className={typeof className === 'function' ? className({ isActive: false }) : className} {...props}>{typeof children === 'function' ? children({ isActive: false }) : children}</a>,
}));
vi.mock('../lib/appContext', async importOriginal => ({ ...await importOriginal<typeof import('../lib/appContext')>(),
  useLanguage: () => fixture.language, useExecutionTarget: () => 'device',
}));
vi.mock('../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../lib/api')>(),
  fetchCharacters: fixture.fetch, fetchSessions: fixture.fetch, fetchWorlds: fixture.fetch,
}));
vi.mock('../lib/adult', () => ({ useAdultContent: () => [false] }));
vi.mock('../lib/title', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../lib/cloudGuest', () => ({ isCloudGuest: () => fixture.guest, fetchBrowseCatalog: fixture.browse, loginPath: (to: string) => '/login?next=' + encodeURIComponent(to) }));
vi.mock('./RuntimeGate', () => ({ useAdministrative: () => fixture.administrative, useRuntimeAccess: () => ({}) }));
vi.mock('./CommunityWorks', () => ({ default: () => null }));
vi.mock('./RuntimeMedia', () => ({ RuntimeImage: ({ src, alt, ...props }: any) => <img src={src} alt={alt} {...props} /> }));
vi.mock('./ui/Dialog', () => ({ default: ({ children, label }: any) => <div role="dialog" aria-label={label}>{children}</div> }));
vi.mock('../lib/theme', () => ({ useTheme: () => ({ theme: 'dark', toggle: fixture.toggle }) }));
vi.mock('../lib/profile', () => ({ useDisplayName: () => 'Original name' }));
vi.mock('../lib/accountProfile', () => ({ useAccountProfile: () => ({ error: null }) }));
vi.mock('./CreditOptions', () => ({ default: () => null, AdBanner: () => null }));
vi.mock('./SessionPolicy', () => ({ UnifiedSync: () => null }));
vi.mock('../lib/hubs', () => ({ hubItems: fixture.hub, hubDetail: fixture.hub, previewUrl: fixture.preview }));

const characters = [{ id: 'hero', display_name: 'Hero', description: 'Original description', tags: ['butler', 'formal'] },
  { id: 'school', display_name: 'Student', description: 'Second original', tags: ['school'] }];
function view(component: () => ReactNode, states: unknown[]) {
  fixture.next = 0; fixture.states = states;
  return component();
}
function nodes(tree: ReactNode, match: (node: ReactElement<any>) => boolean): ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node => !isValidElement<{ children?: ReactNode }>(node) ? [] :
    [...(match(node) ? [node] : []), ...nodes(node.props.children, match)]);
}
function discover(query: string, error: unknown = null) {
  return view(Discover, [characters, [], new Map(), false, error, 0, query, null, []]);
}
function palette(query: string) {
  return view(() => CommandPalette({ open: true, onClose: fixture.close }), [query, 0, characters, [], []]);
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.language = 'en'; fixture.administrative = false; fixture.guest = false;
  fixture.params = new URLSearchParams('mood=butler');
  vi.stubGlobal('localStorage', { getItem: () => null });
});
afterEach(() => vi.unstubAllGlobals());

it('keeps Japanese and English mood searches and stable filter IDs across languages', () => {
  for (const query of ['butler', '執事']) {
    for (const language of ['ja', 'en']) {
      fixture.language = language;
      const html = renderToStaticMarkup(discover(query));
      expect(html).toContain('/characters/hero');
      expect(html).not.toContain('/characters/school');
      expect(html).toContain(language === 'en' ? 'Filter by mood' : '気分で絞り込む');
      expect(fixture.params.get('mood')).toBe('butler');
    }
  }
  expect(fixture.browse).not.toHaveBeenCalled();
});

it('localizes navigation and exploration without granting management actions', () => {
  const shell = renderToStaticMarkup(view(AppShell, [false, false]));
  expect(shell).toContain('Search characters and worlds');
  expect(shell).toContain('Main navigation');
  expect(shell).not.toContain('href="/studio"');
  expect(shell).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  const explore = renderToStaticMarkup(discover(''));
  expect(explore).toContain('PC with management access');
  expect(explore).not.toContain('role="tab"');
  expect(explore).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  expect(fixture.hub).not.toHaveBeenCalled();
});

it('preserves palette query and explicit IME-safe actions across display languages', () => {
  for (const query of ['butler', '執事']) {
    for (const language of ['ja', 'en']) {
      fixture.language = language;
      const tree = palette(query), html = renderToStaticMarkup(tree);
      expect(html).toContain('Hero'); expect(html).not.toContain('Student');
      const input = nodes(tree, node => node.props.role === 'combobox')[0];
      expect(input.props.value).toBe(query);
      for (const event of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
        input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: event.isComposing }, keyCode: event.keyCode, preventDefault: vi.fn() });
      }
      expect(fixture.navigate).not.toHaveBeenCalled();
    }
  }
  const tree = palette('butler');
  nodes(tree, node => node.props.role === 'option' && renderToStaticMarkup(node).includes('Hero'))[0].props.onClick();
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith('/characters/hero');
  expect(fixture.close).toHaveBeenCalledOnce();
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it('renders retained exploration failures and source download constraints in either language', () => {
  const error = { cause: Error('Failed to fetch') };
  expect(renderToStaticMarkup(discover('', error))).toContain('Could not connect to the server');
  fixture.language = 'ja';
  expect(renderToStaticMarkup(discover('', error))).toContain('サーバーに接続できません');
  for (const message of ['未対応のブラウザー取得先です。', '配布元がこの形式・利用条件での取得を許可していません。',
    '公開コンテンツが見つかりません。', '配布元の取得制限です。時間を置いて再試行してください。',
    'ファイルが32 MiBを超えています。', '取得データがありません。', '配布元のエラー（HTTP 503）']) {
    expect(friendlyMessage(message, 'en')).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(friendlyMessage(message, 'ja')).toBe(message);
  }
});

it('retains Hub provenance and external-site warnings; review remains an explicit action', async () => {
  const item = { id: 'fiction', name: 'Original card', description: 'Original prose', source_url: 'https://www.taverncard.com/fiction',
    author: 'Original author', license: 'Original license', format: 'png-v3', imported_ids: [] };
  for (const source of ['taverncard', 'sillytavern'] as const) {
    const tree = view(() => HubBrowser({ source }), ['query', null, item, false, null]);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(source === 'taverncard' ? 'classified as SFW by the source' : 'reviewed, pinned versions');
    expect(html).toContain('Original license'); expect(html).toContain('Original prose');
    expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(fixture.preview).not.toHaveBeenCalled();
  }
  const links = renderToStaticMarkup(<HubLinks />);
  expect(links).toContain('content outside Kyalulu’s SFW listings');
  expect(links.match(/rel="noopener noreferrer"/g)).toHaveLength(7);
  fixture.preview.mockResolvedValue({ preview_id: 'review-only' });
  const tree = view(() => HubBrowser({ source: 'taverncard' }), ['query', null, item, false, null]);
  nodes(tree, node => node.props.children === 'Review import')[0].props.onClick();
  await vi.waitFor(() => expect(fixture.navigate).toHaveBeenCalledWith('/create?preview=review-only'));
  expect(fixture.preview.mock.calls[0][0]).toEqual({ url: item.source_url, format: 'png-v3', non_commercial: false });
});

it('localizes generated conversation labels while preserving authored names', () => {
  expect(sessionTitle({ session_id: 'default', character_name: null }, 'en')).toBe('Kyalulu');
  expect(sessionTitle({ session_id: 'new', character_name: null }, 'en')).toBe('Free chat');
  expect(sessionTitle({ session_id: 'new', character_name: null })).toBe('フリートーク');
  expect(sessionTitle({ session_id: 'new', character_name: '原文' }, 'en')).toBe('原文');
});
