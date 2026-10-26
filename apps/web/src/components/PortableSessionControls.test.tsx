import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import PortableSessionControls from './PortableSessionControls';
import { fetchLibrary, LibraryBindingSchema, LibraryItemSchema } from '../lib/library';
import { fetchModels } from '../lib/api';

const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, effects: [] as (() => (() => void))[], media: true, language:'ja' }));
// Exercise handlers and async fetches without adding a DOM/test renderer dependency.
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const slot = hooks.cursor++;
    if (!(slot in hooks.states)) hooks.states[slot] = initial;
    return [hooks.states[slot], (value: unknown) => { hooks.states[slot] = value; }];
  },
  useEffect: (effect: () => (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock('../lib/library', async original => ({ ...await original<typeof import('../lib/library')>(), fetchLibrary: vi.fn() }));
vi.mock('../lib/api', () => ({ fetchModels: vi.fn() }));
vi.mock('../lib/capabilities', () => ({ useCapabilities: () => ({ capabilities: { features: { media_playback: hooks.media } } }) }));
vi.mock('../lib/appContext',()=>({useLanguage:()=>hooks.language}));

const character = LibraryItemSchema.parse({ id: 'char', revision: 1, document: { name: 'キャラ', profile: { settings: { temperature: 0.7 }, model_hint: 'Gemma' }, assets: [{ name: '笑顔', type: 'emotion', asset_id: 'smile' }] } });
const profile = LibraryItemSchema.parse({ id: 'preset', revision: 3, document: { kind: 'profile', name: 'プリセット', profile: { settings: { temperature: 0.2 }, model_hint: 'Gemma' } } });
const lore = LibraryItemSchema.parse({ id: 'lore', revision: 4, document: { kind: 'lorebook', name: '知識' } });
const binding = LibraryBindingSchema.parse({ character: { id: 'char', revision: 1 }, profile: { id: 'preset', revision: 1 }, lorebooks: [{ id: 'lore', revision: 2 }], expression_asset_id: 'smile' });
const props = () => ({ value: binding, characterId: 'char', character, allowNsfw: false, onChange: vi.fn(), onTemperature: vi.fn() });
const render = (p = props()) => { hooks.cursor = 0; hooks.effects = []; return PortableSessionControls(p); };
function find(tree: ReactNode, predicate: (node: ReactElement<any>) => boolean): ReactElement<any> {
  for (const child of Children.toArray(tree)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (predicate(child)) return child;
    try { return find(child.props.children, predicate); } catch { /* Continue through sibling controls. */ }
  }
  throw Error('Control not found');
}
const select = (tree: ReactNode, label: string) => find(tree, node => node.props['aria-label'] === label);
const button = (tree: ReactNode, label: string) => find(tree, node => Children.toArray(node.props.children).filter(child => typeof child === 'string' || typeof child === 'number').join('') === label);
async function load(p = props()) {
  render(p); hooks.effects.forEach(effect => effect());
  await vi.waitFor(() => expect(hooks.states[5]).toBe(false));
  return render(p);
}

beforeEach(() => {
  hooks.states = []; hooks.cursor = 0; hooks.effects = []; hooks.media = true; hooks.language='ja';
  vi.mocked(fetchLibrary).mockReset().mockResolvedValue([character, profile, lore]);
  vi.mocked(fetchModels).mockReset().mockResolvedValue([]);
});

it('uses k-input, exposes loading, and retains saved revisions without firing changes', () => {
  const p = props(); const tree = render(p); const html = renderToStaticMarkup(tree);
  expect(html).toContain('プリセットと知識を読込中…');
  expect(html).not.toContain('追加できる');
  expect(html).toContain('選択済み（読込中・版1）');
  expect(html).toContain('選択済みの知識（版2・読込中）');
  expect(select(tree, '会話の生成プリセット').props).toMatchObject({ className: 'k-input', disabled: true, value: 'preset' });
  expect(select(tree, '表情').props).toMatchObject({ className: 'k-input', disabled: false, value: 'smile' });
  expect(html).not.toMatch(/<details[^>]*\bopen=/);
  expect(p.onChange).not.toHaveBeenCalled();
});

it('shows empty lists without dropping hidden bindings or allowing a missing preset upgrade', async () => {
  vi.mocked(fetchLibrary).mockResolvedValue([]);
  const p = props(); const tree = await load(p); const html = renderToStaticMarkup(tree);
  expect(html).toContain('追加できる生成プリセットがありません');
  expect(html).toContain('追加できる知識がありません');
  expect(html).toContain('表示対象外・版1');
  expect(html).toContain('版2・表示対象外');
  expect(button(tree, 'プリセットを最新版に切り替える').props.disabled).toBe(true);
  expect(p.onChange).not.toHaveBeenCalled();
});

it('shows a fetch failure, disables unavailable choices, and clears it on a new successful fetch', async () => {
  vi.mocked(fetchLibrary).mockRejectedValueOnce(Error('Failed to fetch'));
  const p = props(); let tree = await load(p); let html = renderToStaticMarkup(tree);
  expect(html).toContain('role="alert"');
  expect(html).toContain('プリセットと知識を取得できません');
  expect(html).not.toContain('追加できる');
  expect(select(tree, '会話の生成プリセット').props.disabled).toBe(true);
  hooks.effects[1]();
  await vi.waitFor(() => expect(hooks.states[5]).toBe(false));
  tree = render(p); html = renderToStaticMarkup(tree);
  expect(html).not.toContain('role="alert"');
  expect(select(tree, '会話の生成プリセット').props.disabled).toBe(false);
  expect(p.onChange).not.toHaveBeenCalled();
});

it('only upgrades pinned revisions on explicit actions and preserves other bindings', async () => {
  const p = props(); const tree = await load(p);
  expect(p.onChange).not.toHaveBeenCalled();
  button(tree, 'プリセットを最新版に切り替える').props.onClick();
  expect(p.onChange).toHaveBeenLastCalledWith({ ...binding, profile: { id: 'preset', revision: 3 } });
  expect(p.onTemperature).toHaveBeenLastCalledWith(0.2);
  button(tree, 'このLoreを最新版に切り替える').props.onClick();
  expect(p.onChange).toHaveBeenLastCalledWith({ ...binding, lorebooks: [{ id: 'lore', revision: 4 }] });
  select(tree, '会話の生成プリセット').props.onChange({ target: { value: '' } });
  expect(p.onChange).toHaveBeenLastCalledWith({ ...binding, profile: null });
  expect(p.onTemperature).toHaveBeenLastCalledWith(0.7);
});

it('preserves expression capability gating and resets expression only on a character upgrade', async () => {
  vi.mocked(fetchLibrary).mockResolvedValue([{ ...character, revision: 2 }, profile, lore]);
  const p = props(); let tree = await load(p);
  select(tree, '表情').props.onChange({ target: { value: '' } });
  expect(p.onChange).toHaveBeenLastCalledWith({ ...binding, expression_asset_id: null });
  button(tree, 'キャラを最新版に切り替える（版2）').props.onClick();
  expect(p.onChange).toHaveBeenLastCalledWith({ ...binding, character: { id: 'char', revision: 2 }, expression_asset_id: null });
  hooks.media = false; tree = render(p);
  expect(select(tree, '表情').props.disabled).toBe(true);
  expect(select(tree, '表情').props.value).toBe('smile');
});

it('distinguishes failed model hints from an unmatched model', async () => {
  vi.mocked(fetchModels).mockRejectedValue(Error('Failed to fetch'));
  const tree = await load(); const html = renderToStaticMarkup(tree);
  expect(html).toContain('登録モデルの候補：取得できません');
  expect(html).toContain('role="alert"');
  expect(html).not.toContain('一致なし');
});

it('keeps pinned revisions, original names and explicit upgrades in English',async()=>{
  hooks.language='en';hooks.media=false;
  vi.mocked(fetchLibrary).mockResolvedValue([{...character,revision:2},profile,lore]);
  const p=props(),tree=await load(p),html=renderToStaticMarkup(tree);
  expect(select(tree,'Conversation generation preset').props.value).toBe('preset');
  expect(select(tree,'Expression').props).toMatchObject({disabled:true,value:'smile'});
  expect(html).toContain('Selected revision: 1');
  expect(html).toContain('Character revision: 1');
  expect(html).toContain('プリセット'); // Saved titles are content, not interface copy.
  expect(html).toContain('This connection does not support imported media');
  expect(p.onChange).not.toHaveBeenCalled();
  button(tree,'Use latest preset').props.onClick();
  expect(p.onChange).toHaveBeenLastCalledWith({...binding,profile:{id:'preset',revision:3}});
  expect(p.onTemperature).toHaveBeenLastCalledWith(.2);
  button(tree,'Use latest Lorebook').props.onClick();
  expect(p.onChange).toHaveBeenLastCalledWith({...binding,lorebooks:[{id:'lore',revision:4}]});
});

it('rerenders stored errors and hidden revisions in the new language without another fetch',async()=>{
  vi.mocked(fetchLibrary).mockRejectedValue(Error('Failed to fetch'));
  vi.mocked(fetchModels).mockRejectedValue(Error('Failed to fetch'));
  const p=props();
  expect(renderToStaticMarkup(await load(p))).toContain('プリセットと知識を取得できません');
  hooks.language='en';const tree=render(p),html=renderToStaticMarkup(tree);
  expect(html).toContain('Could not load presets and knowledge:');
  expect(html).toContain('Could not connect to the server.');
  expect(html).toContain('Selected (List unavailable; revision 1)');
  expect(html).toContain('Selected knowledge (revision 2; List unavailable)');
  expect(select(tree,'Conversation generation preset').props).toMatchObject({disabled:true,value:'preset'});
  expect(fetchLibrary).toHaveBeenCalledOnce();expect(fetchModels).toHaveBeenCalledOnce();expect(p.onChange).not.toHaveBeenCalled();
});
