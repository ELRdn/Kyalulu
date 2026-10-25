import { RuntimeImage } from './RuntimeMedia';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Button from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { uploadAsset, assetUrl, type PortableDocument, type LibraryItem } from '../lib/library';
import { isCloud } from '../lib/cloudMode';
import { useRuntimeAccess } from './RuntimeGate';
import ScenePreview from './ScenePreview';
import './portableEditor.css';
import PortableMedia from './PortableMedia';
import { playableAsset } from '../lib/media';
import { useCapabilities } from '../lib/capabilities';
import { connectionScope } from '../lib/remoteStore';
import { useLanguage } from '../lib/appContext';
import { friendlyMessage } from '../lib/errors';

const tabs = [
  { key: 'plot', label: ['プロット', 'Plot'] },
  { key: 'lore', label: ['設定集', 'Lorebook'] },
  { key: 'style', label: ['スタイル', 'Style'] },
  { key: 'intro', label: ['イントロ', 'Intro'] },
  { key: 'about', label: ['紹介', 'About'] },
  { key: 'details', label: ['詳細', 'Details'] },
] as const;
type Tab = typeof tabs[number]['key'];
const kinds = [
  { value: 'character', label: ['プロット', 'Plot'], hint: ['キャラクターと物語', 'Characters and stories'], mark: '✦' },
  { value: 'lorebook', label: ['設定集', 'Lorebook'], hint: ['世界観とキーワード', 'World knowledge and keywords'], mark: '▤' },
  { value: 'profile', label: ['生成プリセット', 'Generation preset'], hint: ['応答の設定と指示', 'Response settings and instructions'], mark: '≡' },
] as const;
const count = (value: string, en: boolean) => `${Array.from(value).length.toLocaleString(en ? 'en-US' : 'ja-JP')}${en ? ' chars' : '字'}`;
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

function Panel({ title, hint, children, count: total }: { title: string; hint?: string; children: ReactNode; count?: string }) {
  return <section className="k-plot-editor__group"><header className="k-plot-editor__group-head"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>{total && <span className="k-plot-editor__count">{total}</span>}</header><div className="k-plot-editor__group-body">{children}</div></section>;
}

function TextField({ label, ariaLabel = label, value, onChange, rows = 4, hint, placeholder }: { label: string; ariaLabel?: string; value: string; onChange: (value: string) => void; rows?: number; hint?: string; placeholder?: string }) {
  const id = useId();
  const en = useLanguage() === 'en';
  return <label className="k-create-field"><span className="k-plot-editor__field-head"><span>{label}</span><span className="k-plot-editor__count">{count(value, en)}</span></span><Textarea aria-label={ariaLabel} aria-describedby={hint ? id : undefined} rows={rows} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />{hint && <small id={id}>{hint}</small>}</label>;
}

function JsonField({ label, value, onChange, onValidity }: { label: string; value: unknown; onChange: (v: any) => void; onValidity: (ok: boolean) => void }) {
  const en = useLanguage() === 'en';
  const [error, setError] = useState(false);
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2));
  const lastValue = useRef(JSON.stringify(value));
  useEffect(() => { const current = JSON.stringify(value); if (current !== lastValue.current) { lastValue.current = current; setRaw(JSON.stringify(value, null, 2)); setError(false); onValidity(true); } }, [value, onValidity]);
  const errorId = useId();
  return <label className="k-create-field">{label}<Textarea className="k-plot-editor__json" aria-label={label} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} rows={6} value={raw} spellCheck={false} onChange={e => {
    setRaw(e.target.value);
    try { const v = JSON.parse(e.target.value); if (!v || typeof v !== 'object' || Array.isArray(v) !== Array.isArray(value) || (Array.isArray(value) && !v.every(isRecord))) throw new Error('Invalid JSON shape'); lastValue.current = JSON.stringify(v); onChange(v); setError(false); onValidity(true); }
    catch { setError(true); onValidity(false); }
  }} />{error && <span id={errorId} className="k-plot-editor__error" role="alert">{en ? 'Check the JSON format. Saving is blocked until it is fixed.' : 'JSONの形式を確認してください。修正するまで保存できません。'}</span>}</label>;
}

export default function PortableEditor({ document: doc, onChange, onValidity, library = [] }: { document: PortableDocument; onChange: (d: PortableDocument) => void; onValidity: (valid: boolean) => void; library?: LibraryItem[] }) {
  const language = useLanguage(), en = language === 'en';
  const items = (n: number) => en ? `${n} item${n === 1 ? '' : 's'}` : `${n}件`;
  const { cloud_mode } = useRuntimeAccess();
  const cloud = !!cloud_mode || isCloud();
  const { capabilities } = useCapabilities();
  const mediaEnabled = !cloud && capabilities?.mode === 'local' && capabilities.features.media_playback;
  const [mediaRights, setMediaRights] = useState(false);
  const [music, setMusic] = useState(false);
  const uploadBusy = useRef(false);
  const id = useId();
  const [activeTab, setActiveTab] = useState<Tab>('plot');
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [assetError, setAssetError] = useState<Error | string>('');
  const [uploading, setUploading] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [previewIndex, setPreviewIndex] = useState(-1);
  const latest = useRef({ doc, onChange, cloud }); latest.current = { doc, onChange, cloud };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const validityRef = useRef(onValidity); validityRef.current = onValidity;
  const jsonInvalid = doc.kind !== 'lorebook' && Object.values(errors).some(Boolean);
  const valid = Boolean(doc.name.trim()) && !jsonInvalid && !uploading;
  useEffect(() => validityRef.current(valid), [valid]);
  const set = (patch: Partial<PortableDocument>) => onChange({ ...doc, ...patch });
  const data = (key: string, value: unknown) => set({ data: { ...doc.data, [key]: value } });
  const text = (key: string) => typeof doc.data[key] === 'string' ? doc.data[key] as string : '';
  const field = (key: string, label: string, rows = 4, hint?: string, placeholder?: string, ariaLabel = label) => <TextField key={key} label={label} ariaLabel={ariaLabel} rows={rows} value={text(key)} onChange={value => data(key, value)} hint={hint} placeholder={placeholder} />;
  const book = isRecord(doc.data.character_book) ? doc.data.character_book : {};
  const rawEntries = book.entries;
  // Keep dictionary keys, unknown properties and unrecognized entries in their original shape.
  const entries = (Array.isArray(rawEntries) ? rawEntries.map((entry, index) => [String(index), entry] as const) : isRecord(rawEntries) ? Object.entries(rawEntries) : []).filter((pair): pair is [string, Record<string, any>] => isRecord(pair[1]));
  const setBook = (patch: Record<string, unknown>) => data('character_book', { ...book, ...patch });
  const setEntry = (key: string, patch: Record<string, unknown>) => setBook({ entries: Array.isArray(rawEntries) ? rawEntries.map((entry, i) => String(i) === key ? { ...entry, ...patch } : entry) : { ...rawEntries, [key]: { ...rawEntries[key], ...patch } } });
  const removeEntry = (key: string) => setBook({ entries: Array.isArray(rawEntries) ? rawEntries.filter((_, i) => String(i) !== key) : Object.fromEntries(Object.entries(rawEntries).filter(([k]) => k !== key)) });
  const addEntry = () => {
    const entry = { keys: [], content: '', enabled: true, insertion_order: entries.length, extensions: {} };
    if (isRecord(rawEntries)) {
      let key = entries.length;
      while (String(key) in rawEntries) key++;
      setBook({ entries: { ...rawEntries, [String(key)]: entry } });
    } else setBook({ entries: [...(Array.isArray(rawEntries) ? rawEntries : []), entry] });
  };
  const bookEditable = (doc.data.character_book == null || isRecord(doc.data.character_book)) && (rawEntries == null || Array.isArray(rawEntries) || isRecord(rawEntries));
  const greetings: unknown[] = Array.isArray(doc.data.alternate_greetings) ? doc.data.alternate_greetings : [];
  const tags: unknown[] = Array.isArray(doc.data.tags) ? doc.data.tags : [];
  const invalid = (key: string) => (ok: boolean) => setErrors(x => x[key] === !ok ? x : ({ ...x, [key]: !ok }));
  const addTag = () => { const tag = tagDraft.trim(); if (!tag) return; if (!tags.includes(tag)) data('tags', [...tags, tag]); setTagDraft(''); };
  const portrait = assetUrl(doc.assets.find(a => a.type === 'icon' && !/^(audio|video)\//.test(a.media_type))?.asset_id ?? doc.assets.find(a => a.media_type.startsWith('image/'))?.asset_id);
  const previewGreeting = previewIndex >= 0 && typeof greetings[previewIndex] === 'string' ? greetings[previewIndex] as string : text('first_mes');
  const panelHidden = (tab: Tab) => doc.kind === 'character' ? activeTab !== tab : tab === 'plot' ? false : tab === 'lore' ? doc.kind !== 'lorebook' : tab === 'details' ? false : true;
  const tabCounts: Partial<Record<Tab, string>> = { lore: `${entries.length}`, intro: `${1 + greetings.length}`, about: `${doc.assets.length}` };
  const chooseTab = (tab: Tab, focus = false) => {
    setActiveTab(tab);
    if (focus) { tabRefs.current[tab]?.focus({ preventScroll: true }); tabRefs.current[tab]?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  };
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); chooseTab(tabs[next].key, true);
  };
  const panelProps = (tab: Tab) => ({ id: `${id}-panel-${tab}`, role: doc.kind === 'character' ? 'tabpanel' : undefined, 'aria-labelledby': doc.kind === 'character' ? `${id}-tab-${tab}` : undefined, hidden: panelHidden(tab), tabIndex: 0, className: 'k-plot-editor__panel' });
  return <div className="k-portable-editor k-plot-editor">
    <fieldset className="k-plot-editor__chooser" disabled={uploading}>
      <legend>{en ? "Content to edit" : "編集する内容"}</legend>
      <div className="k-plot-editor__kinds">{kinds.map(kind => <label key={kind.value} className={`k-plot-editor__kind ${doc.kind === kind.value ? 'is-selected' : ''}`}><input type="radio" name={`${id}-kind`} value={kind.value} checked={doc.kind === kind.value} onChange={() => set({ kind: kind.value })} /><span aria-hidden="true" className="k-plot-editor__kind-mark">{kind.mark}</span><span><strong>{kind.label[en ? 1 : 0]}</strong><small>{kind.hint[en ? 1 : 0]}</small></span></label>)}</div>
    </fieldset>
    <div className="k-plot-editor__navigation">
      <div className="k-plot-editor__heading"><span className="k-plot-editor__document-name">{doc.name || (en ? "Untitled" : "名前未設定")}</span><span className="k-plot-editor__count">{uploading ? (en ? "Adding image…" : "画像を追加中…") : !doc.name.trim() ? (en ? "Enter a name" : "名前を入力してください") : jsonInvalid ? (en ? "Check the detail JSON" : "詳細のJSONを確認") : (en ? "Editing draft" : "入力内容を編集中")}</span></div>
      <div className="k-plot-editor__tabs" role="tablist" aria-label={en ? "Plot editor sections" : "プロットの編集項目"} aria-orientation="horizontal" hidden={doc.kind !== 'character'}>{tabs.map((tab, index) => <button type="button" key={tab.key} id={`${id}-tab-${tab.key}`} role="tab" aria-selected={activeTab === tab.key} aria-controls={`${id}-panel-${tab.key}`} tabIndex={activeTab === tab.key ? 0 : -1} ref={element => { tabRefs.current[tab.key] = element; }} onClick={() => chooseTab(tab.key)} onKeyDown={event => tabKeyDown(event, index)}>{tab.label[en ? 1 : 0]}{tabCounts[tab.key] && <span className="k-plot-editor__tab-count">{tabCounts[tab.key]}</span>}{tab.key === 'details' && jsonInvalid && <span className="k-plot-editor__tab-error" aria-label={en ? "JSON input error" : "JSONの入力エラー"}>!</span>}</button>)}</div>
    </div>
    {jsonInvalid && <div className="k-plot-editor__validation" role="alert"><span>{en ? "The detail JSON contains an error. Saving is blocked until it is fixed." : "詳細のJSONに入力エラーがあります。修正するまで保存できません。"}</span>{doc.kind === 'character' && <Button type="button" variant="ghost" size="sm" onClick={() => chooseTab('details', true)}>{en ? "Review details" : "詳細を確認"}</Button>}</div>}
    <section {...panelProps('plot')}>
      <Panel title={doc.kind === 'character' ? (en ? "Character basics" : "キャラクターの基本") : doc.kind === 'lorebook' ? (en ? "Lorebook basics" : "設定集の基本") : (en ? "Preset basics" : "プリセットの基本")} hint={doc.kind === 'character' ? (en ? "Who will you meet, and what story will begin?" : "誰と、どんな物語をはじめる？") : (en ? "Choose a name you can find again later." : "あとから見つけやすい名前をつけましょう。")}>
        <label className="k-create-field"><span className="k-plot-editor__field-head"><span>{en ? "Name" : "名前"} <span className="k-plot-editor__required">{en ? "Required" : "必須"}</span></span><span className="k-plot-editor__count">{count(doc.name, en)}</span></span><Input aria-label={en ? "Name" : "名前"} value={doc.name} placeholder={doc.kind === 'character' ? (en ? "Character or story name" : "キャラクターや物語の名前") : (en ? "Enter a name" : "名前を入力")} onChange={e => set({ name: e.target.value })} required /></label>
        {doc.kind === 'character' && field('nickname', (en ? "Name used in conversation" : "会話中の呼び名"), 1, (en ? "Uses the work name if left blank." : "未入力なら名前を使います。"), (en ? "Example: Cyan" : "例：シアン"))}
        {!cloud && <label className="k-plot-editor__check"><input type="checkbox" checked={doc.nsfw} onChange={e => set({ nsfw: e.target.checked })} /> {en ? "Contains adult content" : "成人向けの内容を含む"}</label>}
        {cloud && <p className="k-plot-editor__status">{en ? "Cloud creation currently supports general-audience content." : "クラウドでは全年齢向けの内容を作成できます。"}</p>}
      </Panel>
      {doc.kind === 'character' && <>
        <Panel title={en ? "Profile" : "プロフィール"} hint={en ? "Describe the character's appearance, background and relationships." : "外見、背景、関係性など、キャラクターの輪郭を描きます。"}>{field('description', (en ? "Profile and description" : "プロフィール・説明"), 7, undefined, (en ? "Who are they? What do they like? How do they know you?" : "どんな人物？ 何が好き？ あなたとはどんな関係？"), (en ? "Description" : "説明"))}{field('personality', (en ? "Personality" : "性格"), 4, undefined, (en ? "Values and reactions when happy or troubled" : "価値観や、うれしいとき・困ったときの反応"))}</Panel>
        <Panel title={en ? "Story setting" : "物語の舞台"} hint={en ? "Set the opening situation and the rules of the world." : "はじめの状況や、世界のルールを設定します。"}>{field('scenario', (en ? "Scenario and world" : "シナリオ・世界観"), 6, undefined, (en ? "Where do you meet, and what starts the story?" : "どこで出会い、どんな物語が動きだす？"))}</Panel>
      </>}
    </section>
    <section {...panelProps('lore')}>
      <Panel title={en ? "World knowledge and lorebook" : "世界の知識・設定集"} hint={en ? "Relevant knowledge is used when keywords appear in the conversation." : "会話にキーワードが登場したとき、関連する知識を参照します。"} count={items(entries.length)}>
        {!bookEditable && <p className="k-plot-editor__status">{en ? "This lorebook format cannot be edited directly. The original is retained and can be inspected in Details." : "この設定集の形式は直接編集できません。元の内容は保持されています。詳細で原文を確認できます。"}</p>}
        <fieldset disabled={!bookEditable}>
          <div className="k-create-grid"><label className="k-create-field">{en ? "Messages to scan" : "参照するメッセージ数"}<Input aria-label={en ? "Messages to scan" : "参照するメッセージ数"} type="number" min={0} max={1000} value={book.scan_depth ?? 2} onChange={e => setBook({ scan_depth: Number(e.target.value) })} /></label><label className="k-create-field">{en ? "Budget (estimated tokens)" : "予算（推定トークン）"}<Input aria-label={en ? "Budget (estimated tokens)" : "予算（推定トークン）"} type="number" min={0} value={book.token_budget ?? 1024} onChange={e => setBook({ token_budget: Number(e.target.value) })} /></label></div>
          <label className="k-plot-editor__check"><input type="checkbox" checked={Boolean(book.recursive_scanning)} onChange={e => setBook({ recursive_scanning: e.target.checked })} /> {en ? "Find related knowledge in selected entries" : "採用した知識から関連する知識も探す"}</label>
          {entries.length === 0 && <div className="k-plot-editor__empty"><span aria-hidden="true">▤</span><strong>{en ? "Build your world one entry at a time" : "世界の設定をひとつずつ"}</strong><p>{en ? "Use Add knowledge for places, people and terms." : "場所、人物、用語などを「知識を追加」から登録できます。"}</p></div>}
          <div className="k-plot-editor__entries">{entries.map(([key, entry], index) => <article key={key} className="k-lore-entry">
            <div className="k-plot-editor__entry-head"><strong>{en ? `Entry ${index + 1}` : `設定 ${index + 1}`}</strong><Button type="button" variant="ghost" size="sm" aria-label={(en ? `Remove entry ${index + 1}` : `設定 ${index + 1}を削除`)} onClick={() => removeEntry(key)}>{en ? "Remove entry" : "項目を削除"}</Button></div>
            <div className="k-create-actions"><label className="k-plot-editor__check"><input type="checkbox" checked={entry.enabled !== false} onChange={e => setEntry(key, { enabled: e.target.checked })} /> {en ? "Enabled" : "有効"}</label><label className="k-plot-editor__check"><input type="checkbox" checked={Boolean(entry.constant)} onChange={e => setEntry(key, { constant: e.target.checked })} /> {en ? "Always use" : "常に使用"}</label></div>
            <label className="k-create-field">{en ? "Entry name" : "項目名"}<Input aria-label={(en ? `Entry ${index + 1} name` : `設定 ${index + 1}の項目名`)} value={entry.name ?? entry.comment ?? ''} onChange={e => setEntry(key, { name: e.target.value, comment: e.target.value })} placeholder={en ? "Example: Starlight City" : "例：星灯りの街"} /></label>
            <label className="k-create-field">{en ? "Keywords (comma-separated)" : "キーワード（カンマ区切り）"}<Input aria-label={(en ? `Entry ${index + 1} keywords` : `設定 ${index + 1}のキーワード`)} value={Array.isArray(entry.keys) ? entry.keys.join(', ') : ''} onChange={e => setEntry(key, { keys: e.target.value.split(',').map(s => s.trim()) })} placeholder={en ? "Example: starlight, city" : "例：星灯り, 街"} /></label>
            <TextField label={en ? "Knowledge text" : "知識の本文"} ariaLabel={(en ? `Entry ${index + 1} knowledge text` : `設定 ${index + 1}の知識の本文`)} rows={4} value={typeof entry.content === 'string' ? entry.content : ''} onChange={value => setEntry(key, { content: value })} />
            <details><summary>{en ? "Conditions and order" : "採用条件と順序"}</summary><div className="k-plot-editor__advanced"><label className="k-plot-editor__check"><input type="checkbox" checked={Boolean(entry.case_sensitive)} onChange={e => setEntry(key, { case_sensitive: e.target.checked })} /> {en ? "Case-sensitive" : "大文字・小文字を区別"}</label><label className="k-create-field"><span className="k-plot-editor__check"><input type="checkbox" checked={Boolean(entry.selective)} onChange={e => setEntry(key, { selective: e.target.checked })} /> {en ? "Also require secondary keywords" : "補助キーワードも必要"}</span><Input aria-label={(en ? `Entry ${index + 1} secondary keywords` : `設定 ${index + 1}の補助キーワード`)} value={Array.isArray(entry.secondary_keys) ? entry.secondary_keys.join(', ') : ''} onChange={e => setEntry(key, { secondary_keys: e.target.value.split(',').map(s => s.trim()) })} /></label><div className="k-create-grid"><label className="k-create-field">{en ? "Order" : "順序"}<Input aria-label={(en ? `Entry ${index + 1} order` : `設定 ${index + 1}の順序`)} type="number" value={entry.insertion_order ?? index} onChange={e => setEntry(key, { insertion_order: Number(e.target.value) })} /></label><label className="k-create-field">{en ? "Position" : "位置"}<select aria-label={(en ? `Entry ${index + 1} position` : `設定 ${index + 1}の位置`)} value={entry.position ?? 'after_char'} onChange={e => setEntry(key, { position: e.target.value })}><option value="before_char">{en ? "Before character settings" : "キャラ設定の前"}</option><option value="after_char">{en ? "After character settings" : "キャラ設定の後"}</option>{entry.position && !['before_char', 'after_char'].includes(entry.position) && <option value={entry.position}>{entry.position}</option>}</select></label></div></div></details>
          </article>)}</div>
          <Button type="button" className="k-plot-editor__add" variant="secondary" onClick={addEntry}>{en ? "＋ Add knowledge" : "＋ 知識を追加"}</Button>
        </fieldset>
      </Panel>
    </section>
    <section {...panelProps('style')}>
      <Panel title={en ? "Writing and speaking style" : "文体・話し方"} hint={en ? "Describe tone, forms of address and the balance of dialogue and narration." : "口調、呼び方、セリフと描写のバランスを自由に書けます。"}><TextField label={en ? "Writing and speaking style" : "文体・話し方"} rows={7} value={doc.speaking_style} onChange={value => set({ speaking_style: value })} placeholder={en ? "Example: A calm voice. Use first person, brief scene descriptions and a focus on dialogue." : "例：落ち着いた口調。一人称は「私」。情景は短く描き、会話を中心に進める。"} /></Panel>
      <Panel title={en ? "Example dialogue" : "会話例"} hint={en ? "Show how the character responds through sample exchanges." : "実際のやりとりで、キャラクターらしい返し方を伝えます。"}>{field('mes_example', (en ? "Example dialogue" : "会話例"), 8, undefined, (en ? "{{user}}: Hello.\n{{char}}: I've been waiting. Where shall we go today?" : "{{user}}: こんにちは。\n{{char}}: 待っていたよ。今日はどこへ行こうか？"))}</Panel>
    </section>
    <section {...panelProps('intro')}>
      <Panel title={en ? "Opening scene" : "物語のはじまり"} hint={en ? "The first scene shown when a conversation opens." : "会話を開いたときに表示する、最初のシーンです。"}>
        {field('first_mes', (en ? "First greeting" : "最初の挨拶"), 8, (en ? "Write narration like *looks up at the stars* to display it separately from dialogue." : "地の文は *星空を見上げる* のように書くと、セリフと分けて表示されます。"), (en ? "*A familiar voice came from beyond the door.*\n\n“You came.”" : "*扉の向こうから、聞き覚えのある声がした。*\n\n「来てくれたんだね。」"))}
      </Panel>
      <Panel title={en ? "Intro preview" : "イントロのプレビュー"} hint={en ? "Preview your text as it will appear in chat." : "入力した文章を、チャットと同じ見た目で確認できます。"}>
        {greetings.length > 0 && <label className="k-create-field">{en ? "Greeting to display" : "表示する挨拶"}<select aria-label={en ? "Greeting to preview" : "プレビューする挨拶"} value={previewIndex >= 0 && typeof greetings[previewIndex] === 'string' ? previewIndex : -1} onChange={e => setPreviewIndex(Number(e.target.value))}><option value={-1}>{en ? "First greeting" : "最初の挨拶"}</option>{greetings.map((greeting, index) => typeof greeting === 'string' && <option key={index} value={index}>{en ? `Alternative greeting ${index + 1}` : `挨拶候補 ${index + 1}`}</option>)}</select></label>}
        <div className="k-plot-editor__preview">{previewGreeting.trim() ? <ScenePreview name={doc.name || (en ? "Untitled" : "名前未設定")} seed={id} portrait={portrait} content={previewGreeting} /> : <div className="k-plot-editor__empty"><span aria-hidden="true">✦</span><p>{en ? "Write a greeting to preview the opening scene here." : "挨拶を書くと、ここに最初のシーンが表示されます。"}</p></div>}</div>
      </Panel>
      <Panel title={en ? "Alternative greetings" : "ほかの挨拶候補"} hint={en ? "Provide alternative openings to choose when starting a conversation." : "会話をはじめるときに選べる、別の導入を用意します。"} count={items(greetings.length)}>
        {greetings.map((greeting, index) => <div key={index} className="k-plot-editor__greeting">{typeof greeting === 'string' ? <TextField label={(en ? `Alternative greeting ${index + 1}` : `挨拶候補 ${index + 1}`)} rows={4} value={greeting} onChange={value => data('alternate_greetings', greetings.map((v, i) => i === index ? value : v))} /> : <p>{en ? `Alternative greeting ${index + 1} retains its original format.` : `挨拶候補 ${index + 1}は原文の形式を保持しています。`}</p>}<Button type="button" variant="ghost" size="sm" aria-label={(en ? `Remove alternative greeting ${index + 1}` : `挨拶候補 ${index + 1}を削除`)} onClick={() => { data('alternate_greetings', greetings.filter((_, i) => i !== index)); setPreviewIndex(current => current === index ? -1 : current > index ? current - 1 : current); }}>{en ? "Remove this greeting" : "この候補を削除"}</Button></div>)}
        <Button type="button" className="k-plot-editor__add" variant="secondary" onClick={() => data('alternate_greetings', [...greetings, ''])}>{en ? "＋ Add greeting" : "＋ 挨拶候補を追加"}</Button>
      </Panel>
    </section>
    <section {...panelProps('about')}>
      <Panel title={en ? "Creator and introduction" : "作者と紹介"} hint={en ? "Creator notes are not used to generate conversations." : "作者コメントは会話の生成には使われません。"}><div className="k-create-grid">{field('creator', (en ? "Creator" : "作者"), 1)}{field('character_version', (en ? "Character version (creator-defined)" : "キャラのバージョン（作者指定）"), 1)}</div>{field('creator_notes', (en ? "Creator notes (not used for generation)" : "作者コメント（会話の生成には使いません）"), 5)}</Panel>
      <Panel title={en ? "Tags" : "タグ"} hint={en ? "Add your own words for moods, genres and more." : "雰囲気やジャンルなどを、自由な言葉でまとめましょう。"} count={items(tags.filter(tag => typeof tag === 'string').length)}>
        <div className="k-plot-editor__tags">{tags.map((tag, index) => typeof tag === 'string' && <span className="k-plot-editor__tag" key={index}>{tag}<button type="button" aria-label={(en ? `Remove tag “${tag}”` : `タグ「${tag}」を外す`)} onClick={() => data('tags', tags.filter((_, i) => i !== index))}>×</button></span>)}</div>
        <div className="k-plot-editor__tag-input"><Input aria-label={en ? "Tag to add" : "追加するタグ"} value={tagDraft} placeholder={en ? "Example: fantasy" : "例：ファンタジー"} onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); addTag(); } }} /><Button type="button" variant="secondary" disabled={!tagDraft.trim()} onClick={addTag}>{en ? "Add" : "追加"}</Button></div>
      </Panel>
      <Panel title={en ? "Images, expressions, backgrounds, audio and video" : "画像・表情・背景・音声・動画"} hint={en ? "Name imported media and choose how it is used in conversations." : "持ち込み媒体の名前と、会話での用途を設定します。"} count={items(doc.assets.length)}>
        <div className="k-create-assets">{doc.assets.map((asset, index) => {
          const kind = playableAsset(asset)?.kind;
          const image = kind === 'image' || !/^(audio|video)\//.test(asset.media_type) && ['icon', 'emotion', 'background'].includes(asset.type);
          const types = image ? ['icon', 'emotion', 'background'] : kind === 'audio' ? ['audio', 'music'] : [];
          return <figure key={index}>{asset.asset_id ? image ? <RuntimeImage src={assetUrl(asset.asset_id)} alt={asset.name} loading="lazy" /> : capabilities?.features.media_playback ? <PortableMedia assets={[asset]} /> : <p>{en ? "Media playback is unavailable at this connection." : "この接続先では媒体を再生できません。"}</p> : <p className="k-plot-editor__external">{en ? "External reference (not fetched automatically)" : "外部参照（自動取得しません）"}<br />{asset.uri}</p>}
            <figcaption><Input aria-label={`${image ? (en ? "Image name" : "画像名") : (en ? "Media name" : "媒体名")} ${index + 1}`} value={asset.name} onChange={e => set({ assets: doc.assets.map((v, i) => i === index ? { ...v, name: e.target.value } : v) })} />
              <div className="k-plot-editor__asset-types" role="group" aria-label={(en ? `Media ${index + 1} role` : `媒体の用途 ${index + 1}`)}>{types.map(type => <button type="button" key={type} aria-pressed={asset.type === type} onClick={() => set({ assets: doc.assets.map((v, i) => i === index ? { ...v, type } : v) })}>{({ icon: (en ? "Icon" : "アイコン"), emotion: (en ? "Expression" : "表情"), background: (en ? "Background" : "背景"), audio: (en ? "Audio" : "音声"), music: (en ? "Music" : "音楽") } as Record<string, string>)[type]}</button>)}{!types.includes(asset.type) && <span className="k-plot-editor__tag">{asset.type}</span>}</div>
              {!image && asset.asset_id && <label><input type="checkbox" disabled={!mediaEnabled} checked={asset.rights_confirmed === true} onChange={event => set({assets:doc.assets.map((value,i)=>i===index?{...value,rights_confirmed:event.target.checked}:value)})} />{en ? "I have the rights to use and store this media in the work" : "この媒体を作品内で使用・保存する権利を持っています"}</label>}
              <Button type="button" variant="ghost" size="sm" aria-label={en ? `Remove ${image ? 'image' : 'media'} ${index + 1}` : `${image ? '画像' : '媒体'} ${index + 1}を外す`} onClick={() => set({ assets: doc.assets.filter((_, i) => i !== index) })}>{en ? (image ? 'Remove image' : 'Remove media') : (image ? '画像を外す' : '媒体を外す')}</Button>
            </figcaption></figure>;
        })}</div>
        <label className={`k-create-field k-plot-editor__upload ${cloud ? 'is-disabled' : ''}`}><span>{en ? "Add image" : "画像を追加"}</span><input aria-label={en ? "Add image" : "画像を追加"} aria-describedby={`${id}-upload-status`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={cloud || uploading} onChange={async e => {
          const input = e.target;
          const file = input.files?.[0];
          if (!file || latest.current.cloud || isCloud() || uploading || uploadBusy.current) return;
          const scope = connectionScope(); uploadBusy.current = true; setUploading(true); setAssetError('');
          try {
            const asset = await uploadAsset(file);
            if (mounted.current && scope === connectionScope() && !latest.current.cloud && !isCloud()) {
              const current = latest.current;
              current.onChange({ ...current.doc, assets: [...current.doc.assets, asset] });
            }
          } catch (error) { if (mounted.current && scope === connectionScope()) setAssetError(error instanceof Error ? error : String(error)); }
          finally { uploadBusy.current = false; if (mounted.current) setUploading(false); input.value = ''; }
        }} /><small id={`${id}-upload-status`} role="status">{cloud ? (en ? "Image upload is currently unavailable in Cloud." : "クラウドの画像追加は現在利用できません。") : uploading ? (en ? "Adding image…" : "画像を追加しています…") : (en ? "Add PNG, JPEG, WebP or GIF images." : "PNG・JPEG・WebP・GIFの画像を追加できます。")}</small></label>{assetError && <p className="k-plot-editor__error" role="alert">{friendlyMessage(assetError, language)}</p>}
        <fieldset disabled={!mediaEnabled || uploading} style={{ border: 0, padding: 0 }}>
          <legend>{en ? "Imported audio and video (local)" : "持ち込み音声・動画（ローカル）"}</legend>
          <label><input type="checkbox" checked={mediaRights} onChange={event => setMediaRights(event.target.checked)} />{en ? "I have the rights to use and store this file in the work" : "このファイルを作品内で使用・保存する権利を持っています"}</label>
          <label style={{ display: 'block' }}><input type="checkbox" checked={music} onChange={event => setMusic(event.target.checked)} />{en ? "Add WAV as music" : "WAVを音楽として追加"}</label>
          <label className="k-create-field">{en ? "Add WAV audio or MP4 video" : "WAV音声・MP4動画を追加"}<input type="file" aria-label={en ? "Add WAV audio or MP4 video" : "WAV音声・MP4動画を追加"} accept=".wav,audio/wav,.mp4,video/mp4" disabled={!mediaRights} onChange={async event => {
            const input = event.target; const file = input.files?.[0];
            if (!file || !mediaEnabled || !mediaRights || uploadBusy.current || uploading || latest.current.cloud || isCloud()) { input.value = ''; return; }
            const scope = connectionScope(); uploadBusy.current = true; setUploading(true); setAssetError('');
            try {
              if (!file.size || file.size > 32 * 1024 * 1024) throw Error('32MiB以下の媒体を選んでください。');
              const mime = file.type === 'video/mp4' || /\.mp4$/i.test(file.name) ? 'video/mp4' : ['audio/wav', 'audio/x-wav'].includes(file.type) || /\.wav$/i.test(file.name) ? 'audio/wav' : '';
              if (!mime) throw Error('WAV音声・MP4動画を選んでください。');
              const normalized = file.type === mime ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified });
              const asset = await uploadAsset(normalized, { rights_confirmed: true });
              if (mounted.current && scope === connectionScope() && !latest.current.cloud && !isCloud()) {
                const current = latest.current;
                current.onChange({ ...current.doc, assets: [...current.doc.assets, { ...asset, type: mime === 'video/mp4' ? 'video' : music ? 'music' : 'audio' }] });
                setMediaRights(false);
              }
            } catch (error) { if (mounted.current && scope === connectionScope()) setAssetError(error instanceof Error ? error : String(error)); }
            finally { uploadBusy.current = false; if (mounted.current) setUploading(false); input.value = ''; }
          }} /></label>
        </fieldset>
        <p className="k-context-note">{cloud ? (en ? "Cloud does not support audio or video upload." : "クラウドでは音声・動画の追加に対応していません。") : !mediaEnabled ? (en ? "Check whether this connection supports imported media." : "接続先の持ち込み媒体対応を確認してください。") : uploading ? (en ? "Adding media…" : "媒体を追加しています…") : (en ? "WAV audio and MP4 video can be up to 32 MiB each. The runtime validates the format. Media never autoplays. Some video codecs may not play in this browser." : "WAV音声・MP4動画は各32MiBまで。サーバーで形式を検査します。自動再生はしません。動画のcodecによっては、このブラウザーで再生できません。")}</p>
      </Panel>
    </section>
    <section {...panelProps('details')}>
      {doc.kind === 'character' && <Panel title={en ? "Character instructions" : "キャラクターの指示"} hint={en ? "Adjust the instructions sent with conversations when needed." : "必要に応じて、会話に渡す指示を調整できます。"}>{('definition' in doc.data) && field('definition', (en ? "Definition (original)" : "Definition（原文）"), 8)}{field('system_prompt', (en ? "Character system instructions" : "キャラのシステム指示"))}{field('post_history_instructions', (en ? "Instructions after history" : "履歴の後に置く指示"))}</Panel>}
      {/* Keep these mounted even when another tab or document kind is selected: invalid JSON is a draft too. */}
      <div hidden={doc.kind === 'lorebook'}>
        <Panel title={en ? "Generation preset and advanced settings" : "生成プリセットと詳細な設定"} hint={en ? "Only supported settings are sent to the model. Check the applied settings in chat Debug." : "対応する設定だけをモデルに渡します。実際の適用結果はチャットのDebugで確認できます。"}>
          {doc.kind === 'character' && <label className="k-create-field">{en ? "Apply a saved preset" : "保存したプリセットを適用"}<select aria-label={en ? "Apply a saved preset" : "保存したプリセットを適用"} value="" onChange={e => {
            const item = library.find(i => i.id === e.target.value); if (!item || (cloud && item.document.nsfw)) return;
            set({ profile: structuredClone(item.document.profile), nsfw: doc.nsfw || item.document.nsfw,
              data: { ...doc.data, attached_profile: { id: item.id, revision: item.revision, name: item.document.name }, attached_profile_lore: item.document.data.character_book ?? null },
              notices: [...doc.notices, ...item.document.notices] });
          }}><option value="">{en ? "Copy this version's settings to the character…" : "この版の設定をキャラへコピー…"}</option>{library.filter(i => i.document.kind === 'profile' && (!cloud || !i.document.nsfw)).map(i => <option key={i.id} value={i.id}>{i.document.name}{en ? ` (version ${i.revision})` : `（版${i.revision}）`}</option>)}</select><small>{en ? "You can edit the copied settings. Updating the original preset does not change them automatically." : "コピー後も編集できます。元のプリセットを更新しても自動変更されません。"}</small></label>}
          {doc.profile.model_hint && <p>{en ? `Original model: ${doc.profile.model_hint} (choose a matching model in the model selector)` : `元のモデル名：${doc.profile.model_hint}（モデル選択で対応するものを選んでください）`}</p>}
          <TextField label={en ? "Preset system instructions" : "プリセットのシステム指示"} rows={4} value={doc.profile.system_prompt} onChange={value => set({ profile: { ...doc.profile, system_prompt: value } })} />
          <TextField label={en ? "Preset instructions after history" : "プリセットの履歴後指示"} rows={3} value={doc.profile.post_history_instructions} onChange={value => set({ profile: { ...doc.profile, post_history_instructions: value } })} />
          <TextField label={en ? "Context body template" : "Contextの本文テンプレート"} rows={4} value={doc.profile.context_template} onChange={value => set({ profile: { ...doc.profile, context_template: value } })} />
          <JsonField label={en ? "Generation parameters (JSON)" : "生成パラメータ（JSON）"} value={doc.profile.settings} onChange={v => set({ profile: { ...doc.profile, settings: v } })} onValidity={invalid('settings')} />
          <JsonField label={en ? "Prompt order (JSON)" : "プロンプトの順序（JSON）"} value={doc.profile.prompts} onChange={v => set({ profile: { ...doc.profile, prompts: v } })} onValidity={invalid('prompts')} />
        </Panel>
      </div>
      <Panel title={en ? "Imported data" : "取り込んだデータ"} hint={en ? "Unsupported fields are retained when saving. Inspect the original data here." : "未対応の項目も保持して保存します。原文をここで確認できます。"}><details><summary>{en ? "Inspect original data and settings" : "原文・元の設定を確認"}</summary><pre>{JSON.stringify({ schema_version: doc.schema_version, source_format: doc.source_format, data: doc.data, source: doc.source }, null, 2)}</pre></details></Panel>
    </section>
  </div>;
}
