import { Children, isValidElement, type ImgHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VisualNovelScene from './VisualNovelScene';
import MessageContent from './MessageContent';
import ReasoningSummary from './ReasoningSummary';
import { apiFetch } from '../lib/transport';

const fixture = vi.hoisted(() => ({ language: 'en', index: null as number | null, deps: undefined as readonly unknown[] | undefined }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: number) => {
    fixture.index ??= initial;
    return [fixture.index, (value: number | ((previous: number) => number)) => {
      fixture.index = typeof value === 'function' ? value(fixture.index!) : value;
    }];
  },
  useEffect: (effect: () => void, deps: readonly unknown[]) => {
    if (!fixture.deps || fixture.deps.length !== deps.length || deps.some((value, i) => !Object.is(value, fixture.deps![i]))) {
      fixture.deps = deps; effect();
    }
  },
}));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/transport', () => ({ apiFetch: vi.fn() }));
vi.mock('./RuntimeMedia', () => ({ RuntimeImage: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} /> }));

function nodes(tree: ReactNode, match: (node: ReactElement<any>) => boolean): ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node => !isValidElement<{ children?: ReactNode }>(node) ? []
    : [...(match(node) ? [node] : []), ...nodes(node.props.children, match)]);
}
function navigation(tree: ReactNode, previous: boolean) {
  const label = fixture.language === 'en' ? previous ? 'Previous scene' : 'Next scene' : previous ? '前のシーン' : '次のシーン';
  const control = nodes(tree, node => node.props.children === label && typeof node.props.onClick === 'function')[0];
  expect(control).toBeDefined(); return control;
}
const content = (tree: ReactNode) => nodes(tree, node => node.type === MessageContent)[0];
const props: Parameters<typeof VisualNovelScene>[0] = {
  name: 'キャラの原名', streaming: true, cloud: true,
  messages: [
    { role: 'assistant', content: '最初の原文。First scene.', reasoning_summary: '最初の原要約' },
    { role: 'user', content: '利用者の原文。' },
    { role: 'assistant', content: '中景の原文。Middle scene.', reasoning_summary: '中景の原要約' },
    { role: 'assistant', content: '   ' },
    { role: 'assistant', content: '最後の原文。Latest scene.', reasoning_summary: '最後の原要約' },
  ],
  assets: [
    { name: '背景の原名', type: 'background', uri: '', media_type: 'image/png', asset_id: 'background_fixture' },
    { name: '表情の原名', type: 'emotion', uri: '', media_type: 'image/png', asset_id: 'portrait_fixture' },
  ],
};

beforeEach(() => {
  fixture.language = 'en'; fixture.index = null; fixture.deps = undefined;
  vi.mocked(apiFetch).mockClear(); vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it('localizes the empty region, story title and navigation through live JA/EN changes', () => {
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language;
    const tree = VisualNovelScene({ ...props, messages: [] }), html = renderToStaticMarkup(tree);
    expect(tree.props['aria-label']).toBe(language === 'en' ? 'Visual novel' : 'ビジュアルノベル表示');
    expect(html).toContain(language === 'en' ? 'Story with キャラの原名' : 'キャラの原名との物語');
    expect(html).toContain(language === 'en' ? 'Scenes appear here after the first reply.' : '最初の返事が届くと、ここにシーンを表示します。');
    expect(html).toContain('0 / 0');
    expect(navigation(tree, true).props.disabled).toBe(true); expect(navigation(tree, false).props.disabled).toBe(true);
    expect(content(tree)).toBeUndefined();
  }
  expect(apiFetch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

it('retains the navigated scene, authored data and streaming state on language changes without generation', () => {
  const original = JSON.stringify(props);
  let tree = VisualNovelScene(props);
  expect(content(tree).props).toMatchObject({ content: props.messages[4].content, isStreaming: true });
  expect(renderToStaticMarkup(tree)).toContain('▍');
  expect(navigation(tree, false).props.disabled).toBe(true);
  expect(nodes(tree, node => node.type === ReasoningSummary)).toHaveLength(0);
  navigation(tree, true).props.onClick();
  for (const language of ['en', 'ja', 'en', 'ja']) {
    fixture.language = language; tree = VisualNovelScene(props);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('2 / 3'); expect(html).toContain('中景の原文。Middle scene.');
    expect(html).toContain('中景の原要約'); expect(html).not.toContain('▍');
    expect(content(tree).props).toMatchObject({ content: props.messages[2].content, isStreaming: false });
    expect(nodes(tree, node => node.type === ReasoningSummary)[0].props.message).toBe(props.messages[2]);
    expect(nodes(tree, node => node.props.className === 'k-vn-scene__portrait')[0].props).toMatchObject({ alt: '表情の原名', src: '/api/library/assets/portrait_fixture' });
    expect(nodes(tree, node => node.props.className === 'k-vn-scene__background')[0].props).toMatchObject({ alt: '', src: '/api/library/assets/background_fixture' });
    expect(navigation(tree, true).props.disabled).toBe(false); expect(navigation(tree, false).props.disabled).toBe(false);
  }
  navigation(tree, true).props.onClick(); tree = VisualNovelScene(props);
  expect(content(tree).props.content).toBe(props.messages[0].content);
  expect(navigation(tree, true).props.disabled).toBe(true);
  fixture.language = 'en'; tree = VisualNovelScene(props);
  expect(renderToStaticMarkup(tree)).toContain('1 / 3');
  navigation(tree, false).props.onClick(); tree = VisualNovelScene(props);
  expect(content(tree).props.content).toBe(props.messages[2].content);
  navigation(tree, false).props.onClick();
  for (const language of ['en', 'ja', 'en']) {
    fixture.language = language; tree = VisualNovelScene(props);
    expect(content(tree).props).toMatchObject({ content: props.messages[4].content, isStreaming: true });
    expect(renderToStaticMarkup(tree)).toContain('3 / 3');
    expect(nodes(tree, node => node.type === ReasoningSummary)).toHaveLength(0);
  }
  tree = VisualNovelScene({ ...props, streaming: false });
  expect(content(tree).props.isStreaming).toBe(false);
  expect(renderToStaticMarkup(tree)).toContain('最後の原要約');
  expect(JSON.stringify(props)).toBe(original);
  expect(apiFetch).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
