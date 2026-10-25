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
import ChatsLanding from '../pages/ChatsLanding';
import StoryControls from './StoryControls';
import { applyStory, readStory } from '../lib/story';
import Profile from '../pages/Profile';
import ConnectionSettings from './ConnectionSettings';

const fixture = vi.hoisted(() => ({ language: 'en', administrative: false, guest: false,
  params: new URLSearchParams(), states: [] as unknown[], next: 0,
  pinned: [] as string[], saved: [] as string[],
  target: 'device', cloud: false, pending: 0, profileReady: true, profileError: '',
  saveName: vi.fn(), setTheme: vi.fn(),
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
  useLanguage: () => fixture.language, useExecutionTarget: () => fixture.target,
  executionTarget: () => fixture.target, isUnifiedEntry: () => true,
}));
vi.mock('../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../lib/api')>(),
  fetchCharacters: fixture.fetch, fetchSessions: fixture.fetch, fetchWorlds: fixture.fetch,
}));
vi.mock('../lib/adult', () => ({ useAdultContent: () => [false] }));
vi.mock('../lib/pins', () => ({ usePinnedSessions: () => fixture.pinned, togglePin: vi.fn() }));
vi.mock('../lib/saved', () => ({ useSavedCharacters: () => fixture.saved }));
vi.mock('../lib/title', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../lib/cloudGuest', () => ({ isCloudGuest: () => fixture.guest, fetchBrowseCatalog: fixture.browse, loginPath: (to: string) => '/login?next=' + encodeURIComponent(to) }));
vi.mock('./RuntimeGate', () => ({ useAdministrative: () => fixture.administrative,
  useRuntimeAccess: () => ({ cloud_mode: fixture.cloud, remote_mode: false }), DeviceRegistration: () => null }));
vi.mock('./CommunityWorks', () => ({ default: () => null }));
vi.mock('./RuntimeMedia', () => ({ RuntimeImage: ({ src, alt, ...props }: any) => <img src={src} alt={alt} {...props} /> }));
vi.mock('./ui/Dialog', () => ({ default: ({ children, label }: any) => <div role="dialog" aria-label={label}>{children}</div>, useConfirm: () => [null, vi.fn()] }));
vi.mock('../lib/theme', () => ({ useTheme: () => ({ theme: 'dark', toggle: fixture.toggle, setTheme: fixture.setTheme }) }));
vi.mock('../lib/profile', () => ({ useDisplayName: () => 'Original name', setDisplayName: fixture.saveName }));
vi.mock('../lib/accountProfile', () => ({ useAccountProfile: () => ({ error: fixture.profileError,
  pending: fixture.pending, profile: fixture.profileReady ? {} : null }), refreshAccountProfile: vi.fn() }));
vi.mock('../lib/mode', () => ({ useResearcherMode: () => [false, vi.fn()] }));
vi.mock('./DeviceSettings', () => ({ default: () => null }));
vi.mock('./CloudSettings', () => ({ default: () => null }));
vi.mock('./LocalCloudSync', () => ({ default: () => null }));
vi.mock('./NativeSyncSettings', () => ({ default: () => null }));
vi.mock('./RemoteHostSettings', () => ({ default: () => null }));
vi.mock('./RemoteSetup', () => ({ RemoteConnections: () => null }));
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
  fixture.pinned = []; fixture.saved = [];
  fixture.target = 'device'; fixture.cloud = false; fixture.pending = 0; fixture.profileReady = true; fixture.profileError = '';
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
      if (language === 'en') expect(html).toContain('>1 character</span>');
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

it('preserves chat-list search, pinning and sort across display languages', () => {
  const sessions = [
    { session_id: 'old', count: 2, character_name: null, last_preview: 'Earlier text', last_at: '2026-10-01 10:00:00' },
    { session_id: 'new', count: 3, character_name: null, last_preview: 'Later text', last_at: '2026-10-02 10:00:00' },
  ];
  for (const query of ['Free chat', 'フリートーク']) {
    for (const language of ['ja', 'en']) {
      fixture.language = language;
      const render = (oldest: boolean) => renderToStaticMarkup(view(ChatsLanding,
        [sessions, [], false, null, null, 0, query, oldest, characters]));
      const newest = render(false), oldest = render(true);
      expect(newest.indexOf('href="/chats/new"')).toBeLessThan(newest.indexOf('href="/chats/old"'));
      expect(oldest.indexOf('href="/chats/old"')).toBeLessThan(oldest.indexOf('href="/chats/new"'));
      fixture.pinned = ['old'];
      const pinned = render(false);
      expect(pinned).toContain(language === 'en' ? 'Pinned' : 'ピン留め');
      expect(pinned.indexOf('href="/chats/old"')).toBeLessThan(pinned.indexOf('href="/chats/new"'));
      fixture.pinned = [];
    }
  }
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it('retains recovery ID/uncertainty warnings and partial-erasure context in English', () => {
  for (const message of ['下書きの保存データを読み込めません。送信を停止しています。', '下書きを端末に保存できませんでした。',
    '前の送信結果を確認しています。', '送信IDが変わったため確認を中断しました。', '送信結果のIDが一致しません。',
    '送信結果をまだ確認できません。', '履歴への保存結果を確認できません。', '保存された返信を履歴で確認できません。']) {
    expect(friendlyMessage(Error(message), 'en')).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
    expect(friendlyMessage(Error(message), 'ja')).toBe(message);
  }
  const partial = 'サーバーの会話データは消去しましたが、この端末の下書き・返信履歴の消去を確認できません。Error: Failed to fetch';
  expect(friendlyMessage(partial, 'en')).toContain('Server conversation data was erased');
  expect(friendlyMessage(partial, 'en')).toContain('could not be verified');
  expect(friendlyMessage(partial, 'ja')).toBe(partial);
  const check = '送信結果の確認に失敗しました (HTTP 404)';
  expect(friendlyMessage(Error(check), 'en')).toBe('Could not check the send result (HTTP 404).');
  expect(friendlyMessage(Error(check), 'ja')).toBe(check);
});

it('keeps story drafts and original prompt instructions when language changes', () => {
  const draft = { scene: '原文の場面', goal: '原文の目標', pace: 'slow' as const };
  const original = applyStory('Original base instructions', draft), change = vi.fn();
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    const tree = view(() => StoryControls({ value: original, onChange: change, disabled: false }), [draft]);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('原文の場面'); expect(html).toContain('原文の目標');
    expect(html).toContain(language === 'en' ? 'Story direction' : '物語の進め方');
    expect(change).not.toHaveBeenCalled();
  }
  const tree = view(() => StoryControls({ value: original, onChange: change, disabled: false }), [draft]);
  nodes(tree, node => node.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  expect(change).toHaveBeenCalledOnce();
  expect(change.mock.calls[0][0]).toContain('Original base instructions');
  expect(readStory(change.mock.calls[0][0])).toEqual(draft);
});

function profile(error: unknown = null) {
  return view(Profile, ['入力中の名前 · draft', [{ session_id: 'chat-one', count: 3, character_id: 'hero', character_name: 'Original character' }],
    characters, error, false, 0]);
}

it('keeps profile drafts, saved characters and pinned links without exposing unified adult shortcuts', () => {
  fixture.saved = ['hero']; fixture.pinned = ['chat-one'];
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    // Nested controls use their defaults after the page's six state entries.
    const html = renderToStaticMarkup(profile());
    expect(html).toContain('入力中の名前 · draft');
    expect(html).toContain('href="/chats/chat-one"'); expect(html).toContain('Original character');
    expect(html).toContain(language === 'en' ? 'Saved characters' : '保存したキャラクター');
    expect(html).toContain(language === 'en' ? 'Your display name is saved on this device.' : '表示名はこのデバイスに保存されます。');
    expect(html).not.toContain(language === 'en' ? 'Show adult content' : '成人向けコンテンツを表示');
    expect(html).not.toContain('href="/studio"');
    expect(fixture.saveName).not.toHaveBeenCalled();
  }
});

it('retains the explicit account save and composing-Enter guard in both profile languages', () => {
  fixture.cloud = true;
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    const tree = profile(), blur = vi.fn();
    const input = nodes(tree, node => node.props.id === 'k-profile-name')[0];
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, keyCode: 13, currentTarget: { blur } });
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, keyCode: 229, currentTarget: { blur } });
    expect(blur).not.toHaveBeenCalled();
    input.props.onBlur(); expect(fixture.saveName).not.toHaveBeenCalled();
    input.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, keyCode: 13, currentTarget: { blur } });
    expect(blur).toHaveBeenCalledOnce();
    const save = nodes(tree, node => typeof node.type !== 'string' && node.props.children === (language === 'en' ? 'Save display name' : '表示名を保存'))[0];
    expect(save.props.disabled).toBe(false); save.props.onClick();
    expect(fixture.saveName).toHaveBeenLastCalledWith('入力中の名前 · draft'); fixture.saveName.mockClear();
    fixture.profileReady = false;
    const locked = profile();
    expect(nodes(locked, node => node.props.id === 'k-profile-name')[0].props.disabled).toBe(true);
    fixture.profileReady = true;
  }
});

it('localizes retained profile/account failures and keeps unverified counts hidden', () => {
  fixture.cloud = true; fixture.profileError = 'アカウントを同期できませんでした。接続を確認して再試行してください。';
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    const html = renderToStaticMarkup(profile({ cause: Error('Failed to fetch') }));
    expect(html).toContain(language === 'en' ? 'Your account could not be synced.' : 'アカウントを同期できませんでした。');
    expect(html).not.toContain('k-profile-stats');
  }
  fixture.pending = 1;
  const busy = renderToStaticMarkup(profile());
  expect(busy).toContain('Saving…');
  expect(fixture.saveName).not.toHaveBeenCalled();
});

it('describes device storage accurately and preserves explicit server-switch review across languages', () => {
  const server = { name: '自分のPC · original', url: 'https://example.test' };
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    const html = renderToStaticMarkup(view(ConnectionSettings, [[server], '入力中の接続名', server.url, '', server]));
    expect(html).toContain('入力中の接続名'); expect(html).toContain(server.name);
    expect(html).toContain('href="https://example.test/#/chats"'); expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain(language === 'en' ? 'On-device conversations and memories are stored in this browser.' : '端末内の会話・記憶はこのブラウザーに保存されます。');
    expect(html).toContain(language === 'en' ? 'Conversations and memories do not move automatically.' : '会話や記憶は自動で移りません。');
    expect(html).toContain(language === 'en' ? 'check its result in the current conversation' : '今の会話で結果を確認してから');
    expect(fixture.fetch).not.toHaveBeenCalled();
  }
});
