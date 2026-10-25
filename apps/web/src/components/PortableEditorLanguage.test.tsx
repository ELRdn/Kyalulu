import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import PortableEditor from './PortableEditor';
import { PortableDocumentSchema } from '../lib/library';

const fixture = vi.hoisted(() => ({ language: 'en', cloud: false, scope: 'fixture-owner',
  states: [] as unknown[], next: 0, updates: [] as { index: number; value: unknown }[], upload: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: vi.fn(), useId: () => 'fixture-editor',
  useRef: (value: unknown) => ({ current: value }), useState: (initial: unknown) => {
    const index = fixture.next++;
    return [fixture.states[index] ?? (typeof initial === 'function' ? initial() : initial),
      (value: unknown) => fixture.updates.push({ index, value })];
  } }));
vi.mock('../lib/appContext', () => ({ useLanguage: () => fixture.language }));
vi.mock('../lib/cloudMode', () => ({ isCloud: () => fixture.cloud }));
vi.mock('../lib/remoteStore', () => ({ connectionScope: () => fixture.scope }));
vi.mock('../lib/capabilities', () => ({ useCapabilities: () => ({ capabilities: { mode: 'local', features: { media_playback: true } } }) }));
vi.mock('./RuntimeGate', () => ({ useRuntimeAccess: () => ({ cloud_mode: fixture.cloud }) }));
vi.mock('../lib/library', async original => ({ ...await original<typeof import('../lib/library')>(),
  uploadAsset: fixture.upload, assetUrl: (id?: string) => id ? `/api/assets/${id}` : undefined }));
vi.mock('./RuntimeMedia', () => ({ RuntimeImage: ({ src, alt }: any) => <img src={src} alt={alt} /> }));
vi.mock('./PortableMedia', () => ({ default: () => <p>Fixture playback controls</p> }));
vi.mock('./ScenePreview', () => ({ default: ({ content }: any) => <p>{content}</p> }));

const document = PortableDocumentSchema.parse({ name: 'Original name', data: { description: 'Original description',
  first_mes: 'Original opening', alternate_greetings: ['Another opening', { retained: true }], tags: ['original'],
  character_book: { entries: { fixed: { keys: ['city'], content: 'Original knowledge', unknown: 'retained' } } } },
  assets: [{ type: 'icon', name: 'Portrait', uri: 'local', asset_id: 'a'.repeat(64), media_type: 'image/png' }],
  profile: { model_hint: 'Original model' } });
const preset = { id: 'fixture-preset', revision: 7, document: PortableDocumentSchema.parse({ kind: 'profile', name: 'Original preset' }) } as any;
function view(render: () => ReactNode, states: unknown[] = []) { fixture.next = 0; fixture.states = states; return render(); }
function nodes(tree: ReactNode, match: (node: ReactElement<any>) => boolean): ReactElement<any>[] {
  return Children.toArray(tree).flatMap(node => !isValidElement<{ children?: ReactNode }>(node) ? [] :
    [...(match(node) ? [node] : []), ...nodes(node.props.children, match)]);
}
function editor(change = vi.fn(), states: unknown[] = [], doc = document) {
  return view(() => PortableEditor({ document: doc, onChange: change, onValidity: vi.fn(), library: [preset] }), states);
}
beforeEach(() => { vi.clearAllMocks(); fixture.language = 'en'; fixture.cloud = false; fixture.scope = 'fixture-owner'; fixture.updates = []; });

it('translates all three kinds, lore/media roles and dynamic labels without editing the document', () => {
  const change = vi.fn(), original = structuredClone(document);
  for (const language of ['ja', 'en']) for (const kind of ['character', 'lorebook', 'profile'] as const) {
    fixture.language = language;
    const html = renderToStaticMarkup(editor(change, [], { ...document, kind }));
    expect(html).toContain('Original description'); expect(html).toContain('Original knowledge');
    if (language === 'en') {
      expect(html).not.toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/);
      expect(html).toContain('Entry 1 knowledge text'); expect(html).toContain('Remove image 1');
      if (kind === 'character') expect(html).toContain('Original preset (version 7)');
      expect(html).toContain('never autoplays');
    } else expect(html).toContain('世界の知識・設定集');
    expect(change).not.toHaveBeenCalled(); expect(fixture.upload).not.toHaveBeenCalled();
    expect(document).toEqual(original);
  }
});

it('retains incomplete JSON and its save-blocking error in either language', () => {
  const change = vi.fn(), validity = vi.fn();
  const field = nodes(editor(), node => node.props.label === 'Generation parameters (JSON)')[0];
  const renderField = field.type as (props: any) => ReactNode;
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    const tree = view(() => renderField({ ...field.props, onChange: change, onValidity: validity }), [true, '{"temperature":']);
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(language === 'en' ? 'Saving is blocked' : '修正するまで保存できません');
    const textarea = nodes(tree, node => node.props['aria-invalid'] === true)[0];
    expect(textarea.props.value).toBe('{"temperature":');
    textarea.props.onChange({ target: { value: '{"temperature":' } });
    expect(validity).toHaveBeenLastCalledWith(false); expect(change).not.toHaveBeenCalled();
    textarea.props.onChange({ target: { value: '{"temperature":0.7}' } });
    expect(validity).toHaveBeenLastCalledWith(true); expect(change).toHaveBeenLastCalledWith({ temperature: 0.7 });
    change.mockClear();
  }
});

it('preserves unknown lore fields, stable dictionary keys and unrelated author content on edits', () => {
  const change = vi.fn();
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    const tree = editor(change);
    const field = nodes(tree, node => node.props.ariaLabel === (language === 'en' ? 'Entry 1 knowledge text' : '設定 1の知識の本文'))[0];
    field.props.onChange('Edited knowledge');
    const edited = change.mock.lastCall![0];
    expect(edited.data.character_book.entries).toEqual({ fixed: { keys: ['city'], content: 'Edited knowledge', unknown: 'retained' } });
    expect(edited.profile).toEqual(document.profile); expect(edited.source).toEqual(document.source);
    expect(edited.assets).toEqual(document.assets); expect(edited.data.first_mes).toBe('Original opening');
  }
});

it('keeps tab navigation and composing tag input from changing authored data', () => {
  const change = vi.fn(), tree = editor(change, [false, false, 'about', {}, '', false, 'Pending tag']);
  const tag = nodes(tree, node => node.props['aria-label'] === 'Tag to add')[0];
  tag.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, keyCode: 229 });
  expect(change).not.toHaveBeenCalled();
  const tabs = nodes(tree, node => node.props.role === 'tab'), preventDefault = vi.fn();
  tabs[0].props.onKeyDown({ key: 'End', preventDefault });
  expect(preventDefault).toHaveBeenCalledOnce(); expect(fixture.updates).toContainEqual({ index: 2, value: 'details' });
  expect(change).not.toHaveBeenCalled();
});

it('translates retained upload errors and keeps Cloud upload restrictions', () => {
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    for (const error of [Error('32MiB以下の媒体を選んでください。'), Error('WAV音声・MP4動画を選んでください。')]) {
      const html = renderToStaticMarkup(editor(vi.fn(), [false, false, 'about', {}, error]));
      expect(html).toContain(language === 'en' ? 'Choose ' : '選んでください');
    }
    fixture.cloud = true;
    const tree = editor();
    const image = nodes(tree, node => node.props.type === 'file' && node.props.accept.includes('image/png'))[0];
    expect(image.props.disabled).toBe(true);
    image.props.onChange({ target: { files: [{ name: 'fixture.png' }] } });
    expect(fixture.upload).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(tree)).toContain(language === 'en' ? 'general-audience content' : '全年齢向け');
    fixture.cloud = false;
  }
});

it('retains the upload Error and its HTTP status for language changes', async () => {
  const failure = Object.assign(Error('fictional upload denial'), { status: 403 });
  fixture.upload.mockRejectedValue(failure);
  const image = nodes(editor(), node => node.props.type === 'file' && node.props.accept.includes('image/png'))[0];
  await image.props.onChange({ target: { files: [{ name: 'fixture.png' }], value: 'fixture.png' } });
  expect(fixture.updates).toContainEqual({ index: 4, value: failure });
  for (const language of ['ja', 'en']) {
    fixture.language = language;
    const html = renderToStaticMarkup(editor(vi.fn(), [false, false, 'about', {}, failure]));
    expect(html).toContain(language === 'en' ? 'permission to view or change' : '権限がありません');
  }
});

it('requires media rights and validates size before reading or uploading a file', async () => {
  const change = vi.fn();
  const field = (tree: ReactNode) => nodes(tree, node => node.props.type === 'file' && node.props.accept.includes('audio/wav'))[0];
  const input = { files: [{ name: 'fixture.wav', size: 33 * 1024 * 1024 }], value: 'fixture.wav' };
  await field(editor(change)).props.onChange({ target: input });
  expect(fixture.upload).not.toHaveBeenCalled();
  await field(editor(change, [true])).props.onChange({ target: input });
  expect(fixture.updates.some(update => update.index === 4 && update.value instanceof Error && update.value.message.includes('32MiB'))).toBe(true);
  expect(fixture.upload).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
});
