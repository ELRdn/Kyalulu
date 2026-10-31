import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublicWork from './PublicWork';
import PublicAuthor from './PublicAuthor';
import RelatedWorks from '../components/RelatedWorks';
import { Textarea } from '../components/ui/Input';
import Button from '../components/ui/Button';
import * as community from '../lib/community';
import { saveLibraryItem } from '../lib/library';
import { loginPath } from '../lib/cloudGuest';
import { PublicWorkSchema } from '../../../../packages/schemas/src/community';

const fixture = vi.hoisted(() => ({ language: 'en', scope: 'local:owner-a', guest: false,
  capabilities: { features: { community: true } } as { features: { community: boolean } } | null,
  capabilityError: '', params: { workId: 'work/a', authorId: 'author/a' },
  states: [] as unknown[], next: 0, refs: [] as { current: any }[], refNext: 0,
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[], effectNext: 0, pending: [] as (() => void)[],
  confirm: vi.fn(), navigate: vi.fn(), reload: vi.fn(),
}));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = fixture.next++;
    if (!(index in fixture.states)) fixture.states[index] = typeof initial === 'function' ? initial() : initial;
    return [fixture.states[index], (value: unknown) => { fixture.states[index] = typeof value === 'function' ? value(fixture.states[index]) : value; }];
  },
  useRef: (initial: unknown) => fixture.refs[fixture.refNext++] ??= { current: initial },
  useMemo: (fn: () => unknown) => fn(),
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
    const index = fixture.effectNext++, previous = fixture.effects[index];
    if (!previous || previous.deps.length !== deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) fixture.pending.push(() => {
      previous?.cleanup?.(); const cleanup = effect();
      fixture.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    });
  },
}));
vi.mock('react-router-dom', () => ({ useParams: () => fixture.params, useNavigate: () => fixture.navigate,
  Link: ({ to, children, ...props }: any) => <a href={to} {...props}>{children}</a>,
}));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language, usePreferences: () => ({}) }));
vi.mock('../lib/capabilities', () => ({ useCapabilities: () => ({ capabilities: fixture.capabilities, error: fixture.capabilityError, reload: fixture.reload }) }));
vi.mock('../lib/remoteStore', () => ({ connectionScope: () => fixture.scope }));
vi.mock('../lib/title', () => ({ useDocumentTitle: vi.fn() }));
vi.mock('../components/RuntimeGate', () => ({ useRuntimeAccess: () => ({ cloud_mode: fixture.guest, authenticated: !fixture.guest }) }));
vi.mock('../components/ui/Dialog', () => ({ useConfirm: () => [null, fixture.confirm] }));
vi.mock('../lib/community', () => ({ fetchPublicWork: vi.fn(), workComments: vi.fn(), fetchPublicWorks: vi.fn(), fetchPublicAuthor: vi.fn(),
  reactToWork: vi.fn(), followAuthor: vi.fn(), blockAuthor: vi.fn(), reportWork: vi.fn(), withdrawWork: vi.fn(),
}));
vi.mock('../lib/library', () => ({ saveLibraryItem: vi.fn() }));
vi.mock('../lib/api', () => ({ fetchCharacters: vi.fn(), fetchSessions: vi.fn(), fetchWorlds: vi.fn() }));
vi.mock('../lib/publications', () => ({ fetchPublishedWorks: vi.fn(), publicationError: vi.fn(), usePublicationScope: () => fixture.scope }));
vi.mock('../components/PublishedCards', () => ({ default: () => null }));
vi.mock('../components/RuntimeMedia', () => ({ RuntimeImage: (props: any) => <img {...props} /> }));

const work = PublicWorkSchema.parse({ id: 'work/a', name: '作品の原名', description: '紹介文の原文', tags: ['共通タグ'],
  author_id: 'author/a', author_name: '作者の原名', revision: 3, likes: 7, saves: 2, comments: 1,
  document: { name: 'キャラの原名', data: { first_mes: '物語本文の原文' }, speaking_style: '話し方の原文' },
});
const related = { ...work, id: 'related/a', name: '関連作品の原名', author_id: 'other-author', author_name: '別作者の原名' };
const comments = [{ id: 'comment/a', author_id: 'reader/a', author_name: '読者の原名', text: 'コメントの原文', created: 1 }];
const author = { id: work.author_id, name: work.author_name, followers: 12 };
const draft = '  下書きの原文\nsecond line  ', reason = '  通報理由の原文  ';
const apis = [community.fetchPublicWork, community.workComments, community.fetchPublicWorks, community.fetchPublicAuthor,
  community.reactToWork, community.followAuthor, community.blockAuthor, community.reportWork, community.withdrawWork, saveLibraryItem];
const counts = () => apis.map(fn => vi.mocked(fn).mock.calls.length);

function view(component: () => ReactNode = PublicWork, commit = true) {
  fixture.next = 0; fixture.refNext = 0; fixture.effectNext = 0;
  const tree = component(), html = renderToStaticMarkup(tree);
  if (commit) fixture.pending.splice(0).forEach(effect => effect());
  return { tree, html };
}
function nodes(tree: ReactNode, match: (node: ReactElement<any>) => boolean): ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node => !isValidElement<{ children?: ReactNode }>(node) ? []
    : [...(match(node) ? [node] : []), ...nodes(node.props.children, match)]);
}
function button(tree: ReactNode, text: string) {
  const control = nodes(tree, node => node.type === Button && renderToStaticMarkup(<>{node.props.children}</>) === text)[0];
  expect(control, text).toBeDefined(); return control;
}
const field = (tree: ReactNode, length: number) => nodes(tree, node => node.type === Textarea && node.props.maxLength === length)[0];
const form = (tree: ReactNode) => nodes(tree, node => node.type === 'form')[0];
const submit = (tree: ReactNode) => form(tree).props.onSubmit({ preventDefault() {} });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
async function settled(component = PublicWork) {
  await vi.waitFor(() => expect(fixture.states[component === PublicAuthor ? 4 : 7]).toBe(false));
  return view(component);
}
async function mount(component = PublicWork) {
  view(component); await vi.waitFor(() => expect(fixture.states[0]).not.toBeNull());
  view(component);
  if (component === PublicWork) await vi.waitFor(() => expect(fixture.states[10]).toBe(false));
  return view(component);
}
beforeEach(() => {
  fixture.language = 'en'; fixture.scope = 'local:owner-a'; fixture.guest = false;
  fixture.capabilities = { features: { community: true } }; fixture.capabilityError = '';
  fixture.states = []; fixture.refs = []; fixture.effects = []; fixture.pending = [];
  fixture.params = { workId: work.id, authorId: work.author_id };
  vi.clearAllMocks(); fixture.confirm.mockReset().mockResolvedValue(false);
  vi.mocked(community.fetchPublicWork).mockReset().mockResolvedValue(work);
  vi.mocked(community.fetchPublicWorks).mockReset().mockResolvedValue([work, related]);
  vi.mocked(community.fetchPublicAuthor).mockReset().mockResolvedValue(author);
  vi.mocked(community.workComments).mockReset().mockResolvedValue(comments);
  vi.mocked(community.reactToWork).mockReset().mockResolvedValue(work);
  for (const fn of [community.followAuthor, community.blockAuthor, community.reportWork, community.withdrawWork]) vi.mocked(fn).mockReset().mockResolvedValue(undefined);
  vi.mocked(saveLibraryItem).mockReset().mockResolvedValue({ id: 'copy/a' } as any);
});
afterEach(() => fixture.effects.forEach(effect => effect.cleanup?.()));

it.each([PublicWork, PublicAuthor])('keeps capability checks and the closed legacy gate read-only in both languages: %s', component => {
  fixture.capabilities = null;
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    expect(view(component).html).toContain(language === 'en' ? 'Checking feature availability…' : '対応状況を確認中…');
  }
  fixture.capabilityError = 'Error: 機能情報の取得に失敗しました (HTTP 400)';
  fixture.language = 'en'; expect(view(component).html).toContain('Could not retrieve feature information (HTTP 400)');
  button(view(component).tree, 'Reload').props.onClick(); expect(fixture.reload).toHaveBeenCalledOnce();
  fixture.capabilityError = ''; fixture.capabilities = { features: { community: false } }; fixture.guest = true;
  for (const language of ['ja', 'en', 'ja']) {
    fixture.language = language;
    const { tree, html } = view(component);
    expect(html).toContain(language === 'en' ? 'not available at this connection.' : '提供していません。');
    expect(nodes(tree, node => node.type === Button)).toHaveLength(0);
    if (language === 'en') expect(html).not.toMatch(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u);
  }
  expect(counts()).toEqual(apis.map(() => 0)); expect(fixture.confirm).not.toHaveBeenCalled();
});

it('preserves work, comments, drafts, report reasons and import ID through JA/EN switches with no API calls', async () => {
  let { tree } = await mount();
  field(tree, 2000).props.onChange({ target: { value: draft } }); field(tree, 1000).props.onChange({ target: { value: reason } });
  const before = counts(), requestID = fixture.refs[1].current, original = JSON.stringify({ work, related, comments });
  for (const language of ['ja', 'en', 'ja', 'en']) {
    fixture.language = language; const result = view(); tree = result.tree;
    for (const text of [work.name, work.author_name, work.description, work.document.data.first_mes, comments[0].text, related.name, related.author_name]) expect(result.html).toContain(text);
    for (const label of language === 'en'
      ? ['Fixed version 3', 'Story opening', 'Public settings', 'Public comment', 'Review and post', 'Report reason', 'Related works', 'Selected by matching tags', 'Version', 'Likes', 'Saves', 'Comments']
      : ['固定版3', '物語のはじまり', '公開されている設定', '公開コメント', '内容を確認して投稿', '通報理由', '関連作品', '取得できた公開作品', 'いいね', '保存', 'コメント']) expect(result.html).toContain(label);
    expect(field(tree, 2000).props.value).toBe(draft); expect(field(tree, 1000).props.value).toBe(reason);
    expect(fixture.refs[1].current).toBe(requestID); expect(counts()).toEqual(before);
  }
  expect(JSON.stringify({ work, related, comments })).toBe(original); expect(fixture.confirm).not.toHaveBeenCalled();
});

it('retains guest login restrictions for chat, reactions, follow and comments without publishing or importing', async () => {
  fixture.guest = true; let { tree } = await mount(); const before = counts();
  for (const language of ['en', 'ja']) {
    fixture.language = language; tree = view().tree;
    expect(form(tree)).toBeUndefined(); expect(field(tree, 1000)).toBeUndefined();
    for (const label of language === 'en' ? ['Sign in to chat', 'Like 7', 'Save 2', 'Follow author', 'Sign in to comment'] : ['ログインして会話へ', 'いいね 7', '保存 2', '作者をフォロー', 'ログインしてコメントする']) button(tree, label).props.onClick();
  }
  expect(counts()).toEqual(before); expect(fixture.confirm).not.toHaveBeenCalled();
  expect(fixture.navigate).toHaveBeenCalledTimes(10);
  expect(fixture.navigate).toHaveBeenLastCalledWith(loginPath('/works/work%2Fa'));
});

it('retains import confirmation, original document and request ID across a failed save and language switch', async () => {
  let { tree } = await mount();
  button(tree, 'Save and chat').props.onClick(); await settled(); expect(saveLibraryItem).not.toHaveBeenCalled();
  expect(fixture.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Save this public version to My Library?', confirmLabel: 'Save copy', cancelLabel: 'Cancel' }));
  fixture.confirm.mockResolvedValue(true); vi.mocked(saveLibraryItem).mockRejectedValueOnce(Error('Failed to fetch'));
  button(view().tree, 'Save and chat').props.onClick(); await settled();
  const id = vi.mocked(saveLibraryItem).mock.calls[0][2], before = counts();
  fixture.language = 'ja'; tree = view().tree; expect(counts()).toEqual(before);
  button(tree, '保存して会話へ').props.onClick(); await settled();
  expect(saveLibraryItem).toHaveBeenNthCalledWith(1, work.document, undefined, id);
  expect(saveLibraryItem).toHaveBeenNthCalledWith(2, work.document, undefined, id);
  expect(fixture.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'この公開版をマイライブラリに保存しますか？', cancelLabel: 'キャンセル' }));
  expect(fixture.navigate).toHaveBeenLastCalledWith('/characters/copy%2Fa');
});

it('retains comment text and the send ID on failure, relocalizes the cause, and sends only after explicit confirmation', async () => {
  let { tree } = await mount(); field(tree, 2000).props.onChange({ target: { value: draft } });
  submit(view().tree); await settled(); expect(community.workComments).toHaveBeenCalledTimes(1);
  fixture.confirm.mockResolvedValue(true); vi.mocked(community.workComments).mockRejectedValueOnce(Error('Failed to fetch'));
  submit(view().tree); await settled();
  const id = vi.mocked(community.workComments).mock.calls[1][2], before = counts();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language; const result = view(); tree = result.tree;
    expect(result.html).toContain(language === 'en' ? 'Could not connect to the server.' : 'サーバーに接続できませんでした。');
    expect(field(tree, 2000).props.value).toBe(draft); expect(counts()).toEqual(before);
  }
  submit(tree); await settled();
  expect(community.workComments).toHaveBeenNthCalledWith(2, work.id, draft.trim(), id);
  expect(community.workComments).toHaveBeenNthCalledWith(3, work.id, draft.trim(), id);
  expect(fixture.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Publish this comment?', confirmLabel: 'Screen and post', cancelLabel: 'Cancel' }));
  expect(field(view().tree, 2000).props.value).toBe('');
});

it('keeps reactions and reports explicit and relocalizes report notices without repeating mutations', async () => {
  let { tree } = await mount();
  button(tree, 'Like 7').props.onClick(); await settled(); expect(community.reactToWork).toHaveBeenCalledWith(work.id, 'like', true);
  button(view().tree, 'Save 2').props.onClick(); await settled(); expect(community.reactToWork).toHaveBeenLastCalledWith(work.id, 'save', true);
  button(view().tree, 'Follow author').props.onClick(); await settled(); expect(community.followAuthor).toHaveBeenCalledWith(work.author_id, true);
  field(view().tree, 1000).props.onChange({ target: { value: reason } });
  button(view().tree, 'Report').props.onClick(); await settled(); expect(community.reportWork).toHaveBeenCalledWith(work.id, reason.trim());
  const before = counts();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language; const result = view(); tree = result.tree;
    expect(result.html).toContain(language === 'en' ? 'Your report was received.' : '通報を受け付けました。');
    expect(field(tree, 1000).props.value).toBe(''); expect(counts()).toEqual(before);
  }
});

it.each([false, true])('preserves block/withdraw ownership and confirmation behavior (owned=%s)', async owned => {
  vi.mocked(community.fetchPublicWork).mockResolvedValue({ ...work, owned });
  let { tree } = await mount();
  const label = owned ? 'Withdraw publication' : 'Block author';
  expect(nodes(tree, node => node.type === Button && node.props.children === (owned ? 'Block author' : 'Withdraw publication'))).toHaveLength(0);
  button(tree, label).props.onClick(); await settled(); expect(community.blockAuthor).not.toHaveBeenCalled(); expect(community.withdrawWork).not.toHaveBeenCalled();
  fixture.confirm.mockResolvedValue(true); fixture.language = 'ja'; tree = view().tree;
  button(tree, owned ? '公開を取り下げる' : '作者をブロック').props.onClick(); await settled();
  expect(fixture.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ danger: true, cancelLabel: 'キャンセル' }));
  if (owned) expect(community.withdrawWork).toHaveBeenCalledWith(work.id); else expect(community.blockAuthor).toHaveBeenCalledWith(work.author_id, true);
});

it('discards a pending import confirmation after scope change and a comment result after scope change', async () => {
  let { tree } = await mount(); const confirmation = deferred<boolean>(); fixture.confirm.mockReturnValueOnce(confirmation.promise);
  button(tree, 'Save and chat').props.onClick(); fixture.language = 'ja'; view(); fixture.scope = 'local:owner-b'; confirmation.resolve(true); await settled();
  expect(saveLibraryItem).not.toHaveBeenCalled();
  fixture.scope = 'local:owner-a'; fixture.confirm.mockResolvedValue(true);
  field(view().tree, 2000).props.onChange({ target: { value: draft } });
  const sent = deferred<typeof comments>(); vi.mocked(community.workComments).mockReturnValueOnce(sent.promise);
  submit(view().tree); await vi.waitFor(() => expect(community.workComments).toHaveBeenCalledTimes(2));
  fixture.scope = 'local:owner-b'; sent.resolve([]); await settled(); tree = view().tree;
  expect(field(tree, 2000).props.value).toBe(draft); expect(fixture.states[1]).toBe(comments);
  expect(community.fetchPublicWork).toHaveBeenCalledTimes(1);
});

it('localizes author details and WorkCards without changing original content or catalog filtering', async () => {
  await mount(PublicAuthor); const before = counts();
  for (const language of ['ja', 'en', 'ja']) {
    fixture.language = language; const { html } = view(PublicAuthor);
    for (const text of [author.name, work.name, work.description]) expect(html).toContain(text);
    expect(html).not.toContain(related.name);
    for (const label of language === 'en' ? ['Followers 12', 'Public works', 'Showing works within the retrieved catalog.', 'Version', 'Likes', 'Saves', 'Comments'] : ['フォロワー 12', '公開作品', 'catalogの取得範囲にある作品を表示しています。', '版', 'いいね', '保存', 'コメント']) expect(html).toContain(label);
    expect(counts()).toEqual(before);
  }
});

it.each([['Follow', 'follow', true], ['Unfollow', 'follow', false], ['Block', 'block', true], ['Unblock', 'block', false]] as const)('keeps author %s behind confirmation and preserves the relation payload', async (label, kind, active) => {
  let { tree } = await mount(PublicAuthor); button(tree, label).props.onClick(); await settled(PublicAuthor);
  expect(community.followAuthor).not.toHaveBeenCalled(); expect(community.blockAuthor).not.toHaveBeenCalled();
  fixture.confirm.mockResolvedValue(true); button(view(PublicAuthor).tree, label).props.onClick();
  await vi.waitFor(() => expect(fixture.states[4]).toBe(false));
  expect(kind === 'follow' ? community.followAuthor : community.blockAuthor).toHaveBeenCalledWith(author.id, active);
  expect(fixture.states[5]).toBe('relation-updated');
  expect(fixture.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ confirmLabel: 'Apply change', cancelLabel: 'Cancel', danger: kind === 'block' && active }));
});

it('does not send an author relation after a scope change while confirmation is pending', async () => {
  const { tree } = await mount(PublicAuthor), confirmation = deferred<boolean>();
  fixture.confirm.mockReturnValueOnce(confirmation.promise); button(tree, 'Block').props.onClick();
  fixture.language = 'ja'; view(PublicAuthor); fixture.scope = 'local:owner-b'; confirmation.resolve(true);
  await vi.waitFor(() => expect(community.blockAuthor).not.toHaveBeenCalled());
  await Promise.resolve(); expect(community.blockAuthor).not.toHaveBeenCalled(); expect(fixture.states[5]).toBeNull();
});

it('keeps author relation controls hidden for owned works in either language', async () => {
  vi.mocked(community.fetchPublicWorks).mockResolvedValue([{ ...work, owned: true }]); await mount(PublicAuthor);
  const before = counts();
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    expect(nodes(view(PublicAuthor).tree, node => node.type === Button)).toHaveLength(0);
    expect(counts()).toEqual(before);
  }
});

it('localizes related loading and empty results without refetching, and discards an aborted old lookup', async () => {
  let current = work;
  const component = () => RelatedWorks({ work: current }), pending = deferred<typeof work[]>();
  vi.mocked(community.fetchPublicWorks).mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
  expect(view(component).html).toContain('Checking related works…');
  fixture.language = 'ja'; expect(view(component).html).toContain('関連作品を確認しています…');
  expect(community.fetchPublicWorks).toHaveBeenCalledTimes(1);
  current = { ...work, id: 'changed-work' }; view(component);
  expect(vi.mocked(community.fetchPublicWorks).mock.calls[0][2]?.aborted).toBe(true);
  await vi.waitFor(() => expect(fixture.states[1]).toBe(false));
  pending.resolve([related]); await Promise.resolve();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    expect(view(component).html).toContain(language === 'en' ? 'No matching related works.' : '一致する関連作品はありません。');
    expect(community.fetchPublicWorks).toHaveBeenCalledTimes(2);
  }
  expect(fixture.states[0]).toEqual([]);
});

it.each(['work', 'comments', 'author', 'related'])('relocalizes stored %s failures without refetching', async surface => {
  const cause = Error('Failed to fetch');
  if (surface === 'work') vi.mocked(community.fetchPublicWork).mockRejectedValueOnce(cause);
  if (surface === 'comments') vi.mocked(community.workComments).mockRejectedValueOnce(cause);
  if (surface === 'author') vi.mocked(community.fetchPublicAuthor).mockRejectedValueOnce(cause);
  if (surface === 'related') vi.mocked(community.fetchPublicWorks).mockRejectedValueOnce(cause);
  const component = surface === 'author' ? PublicAuthor : PublicWork;
  view(component);
  if (surface === 'related') { await vi.waitFor(() => expect(fixture.states[0]).toBe(work)); view(); }
  const errorIndex = surface === 'work' ? 4 : surface === 'comments' ? 5 : surface === 'author' ? 2 : 11;
  await vi.waitFor(() => expect(fixture.states[errorIndex]).toEqual({ cause }));
  view(component); const before = counts();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    expect(view(component).html).toContain(language === 'en' ? 'Could not connect to the server.' : 'サーバーに接続できませんでした。');
    expect(counts()).toEqual(before); expect(fixture.states[errorIndex]).toEqual({ cause });
  }
});
