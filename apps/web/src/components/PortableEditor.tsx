import { RuntimeImage } from './RuntimeMedia';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Button from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { uploadAsset, assetUrl, type PortableDocument, type LibraryItem } from '../lib/library';
import { isCloud } from '../lib/cloudMode';
import { useRuntimeAccess } from './RuntimeGate';
import ScenePreview from './ScenePreview';
import './portableEditor.css';

const tabs = [
  { key: 'plot', label: 'プロット' },
  { key: 'lore', label: '設定集' },
  { key: 'style', label: 'スタイル' },
  { key: 'intro', label: 'イントロ' },
  { key: 'about', label: '紹介' },
  { key: 'details', label: '詳細' },
] as const;
type Tab = typeof tabs[number]['key'];
const kinds = [
  { value: 'character', label: 'プロット', hint: 'キャラクターと物語', mark: '✦' },
  { value: 'lorebook', label: '設定集', hint: '世界観とキーワード', mark: '▤' },
  { value: 'profile', label: '生成プリセット', hint: '応答の設定と指示', mark: '≡' },
] as const;
const count = (value: string) => Array.from(value).length.toLocaleString('ja-JP');
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

function Panel({ title, hint, children, count: total }: { title: string; hint?: string; children: ReactNode; count?: string }) {
  return <section className="k-plot-editor__group"><header className="k-plot-editor__group-head"><div><h3>{title}</h3>{hint && <p>{hint}</p>}</div>{total && <span className="k-plot-editor__count">{total}</span>}</header><div className="k-plot-editor__group-body">{children}</div></section>;
}

function TextField({ label, ariaLabel = label, value, onChange, rows = 4, hint, placeholder }: { label: string; ariaLabel?: string; value: string; onChange: (value: string) => void; rows?: number; hint?: string; placeholder?: string }) {
  const id = useId();
  return <label className="k-create-field"><span className="k-plot-editor__field-head"><span>{label}</span><span className="k-plot-editor__count">{count(value)}字</span></span><Textarea aria-label={ariaLabel} aria-describedby={hint ? id : undefined} rows={rows} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />{hint && <small id={id}>{hint}</small>}</label>;
}

function JsonField({ label, value, onChange, onValidity }: { label: string; value: unknown; onChange: (v: any) => void; onValidity: (ok: boolean) => void }) {
  const [error, setError] = useState('');
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2));
  const lastValue = useRef(JSON.stringify(value));
  useEffect(() => { const current = JSON.stringify(value); if (current !== lastValue.current) { lastValue.current = current; setRaw(JSON.stringify(value, null, 2)); setError(''); onValidity(true); } }, [value, onValidity]);
  const errorId = useId();
  return <label className="k-create-field">{label}<Textarea className="k-plot-editor__json" aria-label={label} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} rows={6} value={raw} spellCheck={false} onChange={e => {
    setRaw(e.target.value);
    try { const v = JSON.parse(e.target.value); if (!v || typeof v !== 'object' || Array.isArray(v) !== Array.isArray(value) || (Array.isArray(value) && !v.every(isRecord))) throw new Error('形式を確認してください'); lastValue.current = JSON.stringify(v); onChange(v); setError(''); onValidity(true); }
    catch { setError('JSONの形式を確認してください。修正するまで保存できません。'); onValidity(false); }
  }} />{error && <span id={errorId} className="k-plot-editor__error" role="alert">{error}</span>}</label>;
}

export default function PortableEditor({ document: doc, onChange, onValidity, library = [] }: { document: PortableDocument; onChange: (d: PortableDocument) => void; onValidity: (valid: boolean) => void; library?: LibraryItem[] }) {
  const { cloud_mode } = useRuntimeAccess();
  const cloud = !!cloud_mode || isCloud();
  const id = useId();
  const [activeTab, setActiveTab] = useState<Tab>('plot');
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [assetError, setAssetError] = useState('');
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
  const portrait = assetUrl(doc.assets.find(a => a.type === 'icon')?.asset_id ?? doc.assets[0]?.asset_id);
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
      <legend>編集する内容</legend>
      <div className="k-plot-editor__kinds">{kinds.map(kind => <label key={kind.value} className={`k-plot-editor__kind ${doc.kind === kind.value ? 'is-selected' : ''}`}><input type="radio" name={`${id}-kind`} value={kind.value} checked={doc.kind === kind.value} onChange={() => set({ kind: kind.value })} /><span aria-hidden="true" className="k-plot-editor__kind-mark">{kind.mark}</span><span><strong>{kind.label}</strong><small>{kind.hint}</small></span></label>)}</div>
    </fieldset>
    <div className="k-plot-editor__navigation">
      <div className="k-plot-editor__heading"><span className="k-plot-editor__document-name">{doc.name || '名前未設定'}</span><span className="k-plot-editor__count">{uploading ? '画像を追加中…' : !doc.name.trim() ? '名前を入力してください' : jsonInvalid ? '詳細のJSONを確認' : '入力内容を編集中'}</span></div>
      <div className="k-plot-editor__tabs" role="tablist" aria-label="プロットの編集項目" aria-orientation="horizontal" hidden={doc.kind !== 'character'}>{tabs.map((tab, index) => <button type="button" key={tab.key} id={`${id}-tab-${tab.key}`} role="tab" aria-selected={activeTab === tab.key} aria-controls={`${id}-panel-${tab.key}`} tabIndex={activeTab === tab.key ? 0 : -1} ref={element => { tabRefs.current[tab.key] = element; }} onClick={() => chooseTab(tab.key)} onKeyDown={event => tabKeyDown(event, index)}>{tab.label}{tabCounts[tab.key] && <span className="k-plot-editor__tab-count">{tabCounts[tab.key]}</span>}{tab.key === 'details' && jsonInvalid && <span className="k-plot-editor__tab-error" aria-label="JSONの入力エラー">!</span>}</button>)}</div>
    </div>
    {jsonInvalid && <div className="k-plot-editor__validation" role="alert"><span>詳細のJSONに入力エラーがあります。修正するまで保存できません。</span>{doc.kind === 'character' && <Button type="button" variant="ghost" size="sm" onClick={() => chooseTab('details', true)}>詳細を確認</Button>}</div>}
    <section {...panelProps('plot')}>
      <Panel title={doc.kind === 'character' ? 'キャラクターの基本' : doc.kind === 'lorebook' ? '設定集の基本' : 'プリセットの基本'} hint={doc.kind === 'character' ? '誰と、どんな物語をはじめる？' : 'あとから見つけやすい名前をつけましょう。'}>
        <label className="k-create-field"><span className="k-plot-editor__field-head"><span>名前 <span className="k-plot-editor__required">必須</span></span><span className="k-plot-editor__count">{count(doc.name)}字</span></span><Input aria-label="名前" value={doc.name} placeholder={doc.kind === 'character' ? 'キャラクターや物語の名前' : '名前を入力'} onChange={e => set({ name: e.target.value })} required /></label>
        {doc.kind === 'character' && field('nickname', '会話中の呼び名', 1, '未入力なら名前を使います。', '例：シアン')}
        {!cloud && <label className="k-plot-editor__check"><input type="checkbox" checked={doc.nsfw} onChange={e => set({ nsfw: e.target.checked })} /> 成人向けの内容を含む</label>}
        {cloud && <p className="k-plot-editor__status">クラウドでは全年齢向けの内容を作成できます。</p>}
      </Panel>
      {doc.kind === 'character' && <>
        <Panel title="プロフィール" hint="外見、背景、関係性など、キャラクターの輪郭を描きます。">{field('description', 'プロフィール・説明', 7, undefined, 'どんな人物？ 何が好き？ あなたとはどんな関係？', '説明')}{field('personality', '性格', 4, undefined, '価値観や、うれしいとき・困ったときの反応')}</Panel>
        <Panel title="物語の舞台" hint="はじめの状況や、世界のルールを設定します。">{field('scenario', 'シナリオ・世界観', 6, undefined, 'どこで出会い、どんな物語が動きだす？')}</Panel>
      </>}
    </section>
    <section {...panelProps('lore')}>
      <Panel title="世界の知識・設定集" hint="会話にキーワードが登場したとき、関連する知識を参照します。" count={`${entries.length}件`}>
        {!bookEditable && <p className="k-plot-editor__status">この設定集の形式は直接編集できません。元の内容は保持されています。詳細で原文を確認できます。</p>}
        <fieldset disabled={!bookEditable}>
          <div className="k-create-grid"><label className="k-create-field">参照するメッセージ数<Input aria-label="参照するメッセージ数" type="number" min={0} max={1000} value={book.scan_depth ?? 2} onChange={e => setBook({ scan_depth: Number(e.target.value) })} /></label><label className="k-create-field">予算（推定トークン）<Input aria-label="予算（推定トークン）" type="number" min={0} value={book.token_budget ?? 1024} onChange={e => setBook({ token_budget: Number(e.target.value) })} /></label></div>
          <label className="k-plot-editor__check"><input type="checkbox" checked={Boolean(book.recursive_scanning)} onChange={e => setBook({ recursive_scanning: e.target.checked })} /> 採用した知識から関連する知識も探す</label>
          {entries.length === 0 && <div className="k-plot-editor__empty"><span aria-hidden="true">▤</span><strong>世界の設定をひとつずつ</strong><p>場所、人物、用語などを「知識を追加」から登録できます。</p></div>}
          <div className="k-plot-editor__entries">{entries.map(([key, entry], index) => <article key={key} className="k-lore-entry">
            <div className="k-plot-editor__entry-head"><strong>設定 {index + 1}</strong><Button type="button" variant="ghost" size="sm" aria-label={`設定 ${index + 1}を削除`} onClick={() => removeEntry(key)}>項目を削除</Button></div>
            <div className="k-create-actions"><label className="k-plot-editor__check"><input type="checkbox" checked={entry.enabled !== false} onChange={e => setEntry(key, { enabled: e.target.checked })} /> 有効</label><label className="k-plot-editor__check"><input type="checkbox" checked={Boolean(entry.constant)} onChange={e => setEntry(key, { constant: e.target.checked })} /> 常に使用</label></div>
            <label className="k-create-field">項目名<Input aria-label={`設定 ${index + 1}の項目名`} value={entry.name ?? entry.comment ?? ''} onChange={e => setEntry(key, { name: e.target.value, comment: e.target.value })} placeholder="例：星灯りの街" /></label>
            <label className="k-create-field">キーワード（カンマ区切り）<Input aria-label={`設定 ${index + 1}のキーワード`} value={Array.isArray(entry.keys) ? entry.keys.join(', ') : ''} onChange={e => setEntry(key, { keys: e.target.value.split(',').map(s => s.trim()) })} placeholder="例：星灯り, 街" /></label>
            <TextField label="知識の本文" ariaLabel={`設定 ${index + 1}の知識の本文`} rows={4} value={typeof entry.content === 'string' ? entry.content : ''} onChange={value => setEntry(key, { content: value })} />
            <details><summary>採用条件と順序</summary><div className="k-plot-editor__advanced"><label className="k-plot-editor__check"><input type="checkbox" checked={Boolean(entry.case_sensitive)} onChange={e => setEntry(key, { case_sensitive: e.target.checked })} /> 大文字・小文字を区別</label><label className="k-create-field"><span className="k-plot-editor__check"><input type="checkbox" checked={Boolean(entry.selective)} onChange={e => setEntry(key, { selective: e.target.checked })} /> 補助キーワードも必要</span><Input aria-label={`設定 ${index + 1}の補助キーワード`} value={Array.isArray(entry.secondary_keys) ? entry.secondary_keys.join(', ') : ''} onChange={e => setEntry(key, { secondary_keys: e.target.value.split(',').map(s => s.trim()) })} /></label><div className="k-create-grid"><label className="k-create-field">順序<Input aria-label={`設定 ${index + 1}の順序`} type="number" value={entry.insertion_order ?? index} onChange={e => setEntry(key, { insertion_order: Number(e.target.value) })} /></label><label className="k-create-field">位置<select aria-label={`設定 ${index + 1}の位置`} value={entry.position ?? 'after_char'} onChange={e => setEntry(key, { position: e.target.value })}><option value="before_char">キャラ設定の前</option><option value="after_char">キャラ設定の後</option>{entry.position && !['before_char', 'after_char'].includes(entry.position) && <option value={entry.position}>{entry.position}</option>}</select></label></div></div></details>
          </article>)}</div>
          <Button type="button" className="k-plot-editor__add" variant="secondary" onClick={addEntry}>＋ 知識を追加</Button>
        </fieldset>
      </Panel>
    </section>
    <section {...panelProps('style')}>
      <Panel title="文体・話し方" hint="口調、呼び方、セリフと描写のバランスを自由に書けます。"><TextField label="文体・話し方" rows={7} value={doc.speaking_style} onChange={value => set({ speaking_style: value })} placeholder="例：落ち着いた口調。一人称は「私」。情景は短く描き、会話を中心に進める。" /></Panel>
      <Panel title="会話例" hint="実際のやりとりで、キャラクターらしい返し方を伝えます。">{field('mes_example', '会話例', 8, undefined, '{{user}}: こんにちは。\n{{char}}: 待っていたよ。今日はどこへ行こうか？')}</Panel>
    </section>
    <section {...panelProps('intro')}>
      <Panel title="物語のはじまり" hint="会話を開いたときに表示する、最初のシーンです。">
        {field('first_mes', '最初の挨拶', 8, '地の文は *星空を見上げる* のように書くと、セリフと分けて表示されます。', '*扉の向こうから、聞き覚えのある声がした。*\n\n「来てくれたんだね。」')}
      </Panel>
      <Panel title="イントロのプレビュー" hint="入力した文章を、チャットと同じ見た目で確認できます。">
        {greetings.length > 0 && <label className="k-create-field">表示する挨拶<select aria-label="プレビューする挨拶" value={previewIndex >= 0 && typeof greetings[previewIndex] === 'string' ? previewIndex : -1} onChange={e => setPreviewIndex(Number(e.target.value))}><option value={-1}>最初の挨拶</option>{greetings.map((greeting, index) => typeof greeting === 'string' && <option key={index} value={index}>挨拶候補 {index + 1}</option>)}</select></label>}
        <div className="k-plot-editor__preview">{previewGreeting.trim() ? <ScenePreview name={doc.name || '名前未設定'} seed={id} portrait={portrait} content={previewGreeting} /> : <div className="k-plot-editor__empty"><span aria-hidden="true">✦</span><p>挨拶を書くと、ここに最初のシーンが表示されます。</p></div>}</div>
      </Panel>
      <Panel title="ほかの挨拶候補" hint="会話をはじめるときに選べる、別の導入を用意します。" count={`${greetings.length}件`}>
        {greetings.map((greeting, index) => <div key={index} className="k-plot-editor__greeting">{typeof greeting === 'string' ? <TextField label={`挨拶候補 ${index + 1}`} rows={4} value={greeting} onChange={value => data('alternate_greetings', greetings.map((v, i) => i === index ? value : v))} /> : <p>挨拶候補 {index + 1}は原文の形式を保持しています。</p>}<Button type="button" variant="ghost" size="sm" aria-label={`挨拶候補 ${index + 1}を削除`} onClick={() => { data('alternate_greetings', greetings.filter((_, i) => i !== index)); setPreviewIndex(current => current === index ? -1 : current > index ? current - 1 : current); }}>この候補を削除</Button></div>)}
        <Button type="button" className="k-plot-editor__add" variant="secondary" onClick={() => data('alternate_greetings', [...greetings, ''])}>＋ 挨拶候補を追加</Button>
      </Panel>
    </section>
    <section {...panelProps('about')}>
      <Panel title="作者と紹介" hint="作者コメントは会話の生成には使われません。"><div className="k-create-grid">{field('creator', '作者', 1)}{field('character_version', 'キャラのバージョン（作者指定）', 1)}</div>{field('creator_notes', '作者コメント（会話の生成には使いません）', 5)}</Panel>
      <Panel title="タグ" hint="雰囲気やジャンルなどを、自由な言葉でまとめましょう。" count={`${tags.filter(tag => typeof tag === 'string').length}件`}>
        <div className="k-plot-editor__tags">{tags.map((tag, index) => typeof tag === 'string' && <span className="k-plot-editor__tag" key={index}>{tag}<button type="button" aria-label={`タグ「${tag}」を外す`} onClick={() => data('tags', tags.filter((_, i) => i !== index))}>×</button></span>)}</div>
        <div className="k-plot-editor__tag-input"><Input aria-label="追加するタグ" value={tagDraft} placeholder="例：ファンタジー" onChange={e => setTagDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); addTag(); } }} /><Button type="button" variant="secondary" disabled={!tagDraft.trim()} onClick={addTag}>追加</Button></div>
      </Panel>
      <Panel title="画像・表情・背景" hint="画像の名前と、会話での用途を設定します。" count={`${doc.assets.length}件`}>
        <div className="k-create-assets">{doc.assets.map((asset, index) => <figure key={index}>{asset.asset_id ? <RuntimeImage src={assetUrl(asset.asset_id)} alt={asset.name} loading="lazy" /> : <p className="k-plot-editor__external">外部参照（自動取得しません）<br />{asset.uri}</p>}<figcaption><Input aria-label={`画像名 ${index + 1}`} value={asset.name} onChange={e => set({ assets: doc.assets.map((v, i) => i === index ? { ...v, name: e.target.value } : v) })} /><div className="k-plot-editor__asset-types" role="group" aria-label={`画像の用途 ${index + 1}`}>{(['icon', 'emotion', 'background'] as const).map(type => <button type="button" key={type} aria-pressed={asset.type === type} onClick={() => set({ assets: doc.assets.map((v, i) => i === index ? { ...v, type } : v) })}>{type === 'icon' ? 'アイコン' : type === 'emotion' ? '表情' : '背景'}</button>)}{!['icon', 'emotion', 'background'].includes(asset.type) && <span className="k-plot-editor__tag">{asset.type}</span>}</div><Button type="button" variant="ghost" size="sm" aria-label={`画像 ${index + 1}を外す`} onClick={() => set({ assets: doc.assets.filter((_, i) => i !== index) })}>画像を外す</Button></figcaption></figure>)}</div>
        <label className={`k-create-field k-plot-editor__upload ${cloud ? 'is-disabled' : ''}`}><span>画像を追加</span><input aria-label="画像を追加" aria-describedby={`${id}-upload-status`} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={cloud || uploading} onChange={async e => {
          const input = e.target;
          const file = input.files?.[0];
          if (!file || latest.current.cloud || isCloud() || uploading) return;
          setUploading(true); setAssetError('');
          try {
            const asset = await uploadAsset(file);
            if (mounted.current && !latest.current.cloud && !isCloud()) {
              const current = latest.current;
              current.onChange({ ...current.doc, assets: [...current.doc.assets, asset] });
            }
          } catch (error) { if (mounted.current) setAssetError(String(error)); }
          finally { if (mounted.current) setUploading(false); input.value = ''; }
        }} /><small id={`${id}-upload-status`} role="status">{cloud ? 'クラウドの画像追加は現在利用できません。' : uploading ? '画像を追加しています…' : 'PNG・JPEG・WebP・GIFの画像を追加できます。'}</small></label>{assetError && <p className="k-plot-editor__error" role="alert">{assetError}</p>}
      </Panel>
    </section>
    <section {...panelProps('details')}>
      {doc.kind === 'character' && <Panel title="キャラクターの指示" hint="必要に応じて、会話に渡す指示を調整できます。">{('definition' in doc.data) && field('definition', 'Definition（原文）', 8)}{field('system_prompt', 'キャラのシステム指示')}{field('post_history_instructions', '履歴の後に置く指示')}</Panel>}
      {/* Keep these mounted even when another tab or document kind is selected: invalid JSON is a draft too. */}
      <div hidden={doc.kind === 'lorebook'}>
        <Panel title="生成プリセットと詳細な設定" hint="対応する設定だけをモデルに渡します。実際の適用結果はチャットのDebugで確認できます。">
          {doc.kind === 'character' && <label className="k-create-field">保存したプリセットを適用<select aria-label="保存したプリセットを適用" value="" onChange={e => {
            const item = library.find(i => i.id === e.target.value); if (!item || (cloud && item.document.nsfw)) return;
            set({ profile: structuredClone(item.document.profile), nsfw: doc.nsfw || item.document.nsfw,
              data: { ...doc.data, attached_profile: { id: item.id, revision: item.revision, name: item.document.name }, attached_profile_lore: item.document.data.character_book ?? null },
              notices: [...doc.notices, ...item.document.notices] });
          }}><option value="">この版の設定をキャラへコピー…</option>{library.filter(i => i.document.kind === 'profile' && (!cloud || !i.document.nsfw)).map(i => <option key={i.id} value={i.id}>{i.document.name}（版{i.revision}）</option>)}</select><small>コピー後も編集できます。元のプリセットを更新しても自動変更されません。</small></label>}
          {doc.profile.model_hint && <p>元のモデル名：{doc.profile.model_hint}（モデル選択で対応するものを選んでください）</p>}
          <TextField label="プリセットのシステム指示" rows={4} value={doc.profile.system_prompt} onChange={value => set({ profile: { ...doc.profile, system_prompt: value } })} />
          <TextField label="プリセットの履歴後指示" rows={3} value={doc.profile.post_history_instructions} onChange={value => set({ profile: { ...doc.profile, post_history_instructions: value } })} />
          <TextField label="Contextの本文テンプレート" rows={4} value={doc.profile.context_template} onChange={value => set({ profile: { ...doc.profile, context_template: value } })} />
          <JsonField label="生成パラメータ（JSON）" value={doc.profile.settings} onChange={v => set({ profile: { ...doc.profile, settings: v } })} onValidity={invalid('settings')} />
          <JsonField label="プロンプトの順序（JSON）" value={doc.profile.prompts} onChange={v => set({ profile: { ...doc.profile, prompts: v } })} onValidity={invalid('prompts')} />
        </Panel>
      </div>
      <Panel title="取り込んだデータ" hint="未対応の項目も保持して保存します。原文をここで確認できます。"><details><summary>原文・元の設定を確認</summary><pre>{JSON.stringify({ schema_version: doc.schema_version, source_format: doc.source_format, data: doc.data, source: doc.source }, null, 2)}</pre></details></Panel>
    </section>
  </div>;
}
