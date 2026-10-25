import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import CharacterEntry from './CharacterEntry';

const fixture = vi.hoisted(() => ({ language: 'en', guest: false, adult: false, id: 'hero',
  next: 0, states: [] as unknown[], characters: [] as any[], worlds: [] as any[], sessions: [] as any[],
  error: null as { cause: unknown } | null, loadError: null as { cause: unknown } | null,
  start: vi.fn(), navigate: vi.fn(), browse: vi.fn(), save: vi.fn(),
}));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(), useMemo: (fn: () => unknown) => fn(), useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [fixture.states[fixture.next++] ?? (typeof initial === 'function' ? initial() : initial), vi.fn()],
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => fixture.navigate, useParams: () => ({ characterId: fixture.id }),
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/adult', () => ({ useAdultContent: () => [fixture.adult] }));
vi.mock('../lib/title', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../lib/saved', () => ({ useSavedCharacters: () => [], toggleSaved: fixture.save }));
vi.mock('../lib/session', () => ({ startNewSession: fixture.start }));
vi.mock('../components/RuntimeGate', () => ({ useRuntimeAccess: () => ({}) }));
vi.mock('../lib/cloudGuest', () => ({ isCloudGuest: () => fixture.guest, fetchBrowseCatalog: fixture.browse,
  loginPath: (to: string) => '/login?next=' + encodeURIComponent(to) }));
vi.mock('../components/RuntimeMedia', () => ({ RuntimeImage: ({ src, alt, ...props }: any) => <img src={src} alt={alt} {...props} /> }));
vi.mock('../components/ScenePreview', () => ({ default: ({ content }: { content: string }) => <div>{content}</div> }));

function view() {
  fixture.next = 0;
  fixture.states = [fixture.characters, fixture.worlds, fixture.sessions, false, fixture.error,
    fixture.loadError, 0, false, 1, 0, false, false];
  return CharacterEntry();
}
function find(tree: ReactNode, match: (element: ReactElement<any>) => boolean): ReactElement<any> {
  for (const node of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(node)) continue;
    if (match(node)) return node;
    try { return find(node.props.children, match); } catch { /* Continue with siblings. */ }
  }
  throw Error('Missing action');
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fixture, { language: 'en', guest: false, adult: false, id: 'hero', error: null, loadError: null,
    characters: [{ id: 'hero', display_name: 'Hero', description: 'First line! Profile overview.', tags: ['butler', 'formal'],
      species: 'Elf', age: 'Adult', personality: '{{char}} remembers {{user}}.', speaking_style: 'Formal speech',
      intro: 'FIRST_ORIGINAL', alternate_greetings: ['SECOND_ORIGINAL'], library_revision: 2,
      recommended_generation: { temperature: .63 } }],
    worlds: [{ id: 'world', display_name: 'Original world', description: 'Original description' }],
    sessions: [{ session_id: 'past', character_id: 'hero', character_name: 'Hero', count: 2,
      last_preview: 'Original preview', last_at: '2026-10-25 10:00:00' }],
  });
  fixture.start.mockResolvedValue('created-chat');
});

it('translates controls and display helpers without changing the selected original greeting', async () => {
  const tree = view(), html = renderToStaticMarkup(tree);
  expect(html).toContain('Start a new conversation');
  expect(html).toContain('Species');
  expect(html).toContain('Hero remembers you.');
  expect(html).toContain('SECOND_ORIGINAL');
  expect(html).toContain('Butler');
  expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  expect(fixture.browse).not.toHaveBeenCalled();
  expect(fixture.start).not.toHaveBeenCalled();
  fixture.language = 'ja';
  expect(renderToStaticMarkup(view())).toContain('SECOND_ORIGINAL');
  expect(fixture.start).not.toHaveBeenCalled();
  await find(tree, node => node.props.className?.includes('k-plot-cta__main')).props.onClick();
  expect(fixture.start).toHaveBeenCalledExactlyOnceWith({ characterId: 'hero', intro: 'SECOND_ORIGINAL', temperature: .63 });
  expect(fixture.navigate).toHaveBeenCalledWith('/chats/created-chat');
});

it('rerenders stored failures in the current language without retrying or starting a chat', () => {
  fixture.loadError = { cause: Error('insufficient_credits') };
  expect(renderToStaticMarkup(view())).toContain('Could not load character');
  fixture.language = 'ja';
  expect(renderToStaticMarkup(view())).toContain('キャラクターを読み込めませんでした');
  fixture.loadError = null;
  fixture.error = { cause: Error('insufficient_credits') };
  fixture.language = 'en';
  expect(renderToStaticMarkup(view())).toContain('Could not start the conversation.');
  expect(fixture.browse).not.toHaveBeenCalled();
  expect(fixture.start).not.toHaveBeenCalled();
});

it('preserves guest login and adult-view restrictions in both languages', async () => {
  fixture.guest = true;
  let tree = view();
  expect(renderToStaticMarkup(tree)).toContain('Sign in to start a conversation');
  await find(tree, node => node.props.className?.includes('k-plot-cta__main')).props.onClick();
  expect(fixture.navigate).toHaveBeenCalledWith('/login?next=%2Fcharacters%2Fhero');
  expect(fixture.start).not.toHaveBeenCalled();
  fixture.characters[0].nsfw = true;
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    tree = view();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(language === 'en' ? 'required adult verification' : '必要な成人確認');
    expect(html).not.toContain('SECOND_ORIGINAL');
    expect(html).not.toContain('Profile overview.');
  }
  expect(fixture.start).not.toHaveBeenCalled();
});
