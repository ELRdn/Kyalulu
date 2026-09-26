import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';
import Dialog from '../components/ui/Dialog';
import Icon from '../components/ui/Icon';
import Avatar from '../components/ui/Avatar';
import EmptyState from '../components/ui/EmptyState';
import HubLinks from '../components/HubLinks';
import { useAdultContent } from '../lib/adult';
import { friendlyMessage } from '../lib/errors';
import { useDocumentTitle } from '../lib/title';
import PortableEditor from '../components/PortableEditor';
import UrlImportBox from '../components/UrlImportBox';
import ImportSource from '../components/ImportSource';
import { fetchPreview } from '../lib/hubs';
import { fetchLibrary, assetUrl, previewFile, previewText, commitImport, saveLibraryItem, libraryRequest, PortableDocumentSchema, type LibraryItem, type ImportPreview, type PortableDocument, type ImportCommit } from '../lib/library';
import './pages.css';
import './create.css';

type Draft = { document: PortableDocument; selected: boolean; histories: number[]; target?: LibraryItem; rating?: 'sfw' | 'nsfw'; copy?: boolean };
const formats = ['ccv3-json', 'ccv3-png', 'charx', 'ccv2-json', 'ccv2-png', 'backup', 'original'];
const statusLabel = { applied: '反映できる', converted: '変換する', preserved: '保存のみ', error: 'エラー' };
const formatLabel: Record<string, string> = { 'ccv3-json': 'Character Card V3（JSON）', 'ccv3-png': 'Character Card V3（PNG画像）', charx: 'CHARX', 'ccv2-json': 'Character Card V2（JSON）', 'ccv2-png': 'Character Card V2（PNG画像）', backup: 'Kyaluluバックアップ', original: '取り込んだ原本' };
const kindLabel = { character: 'キャラクター', profile: '生成プリセット', lorebook: 'Lorebook' } as const;

export default function Create() {
  const [query, setQuery] = useSearchParams();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [adult] = useAdultContent();
  const [includeNsfw, setIncludeNsfw] = useState(adult);
  const [dragging, setDragging] = useState(false);
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<LibraryItem | undefined>();
  const [document, setDocument] = useState<PortableDocument | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState('');
  const [sessions, setSessions] = useState<{ session_id: string; name: string }[]>([]);
  const [exportItem, setExportItem] = useState<LibraryItem | null>(null);
  const [format, setFormat] = useState('ccv3-json');
  const [exportInfo, setExportInfo] = useState<{ notices: { path: string; reason: string }[]; filename: string } | null>(null);
  const pending = useRef<ImportCommit | null>(null);
  const openedEditor = useRef<string | null>(null);
  const previewId = query.get('preview');
  useDocumentTitle('クリエイト');
  useEffect(() => { if (!adult) setIncludeNsfw(false); }, [adult]);
  // 編集・確認モードへ切り替わったら画面の先頭から見せる（下に追加されて気づけない問題の対策）
  useEffect(() => { window.document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }, [!!previewId, query.get('edit')]);
  const refresh = async () => setItems(await fetchLibrary(includeNsfw));
  useEffect(() => { let active = true; fetchLibrary(includeNsfw).then(x => { if (active) setItems(x); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [includeNsfw]);
  useEffect(() => {
    const key = query.get('edit');
    if (!key) { openedEditor.current = null; return; }
    if (openedEditor.current === key) return;
    const found = items.find(i => i.id === key);
    if (!found && key !== 'new') return;
    let stored: { document: PortableDocument; revision?: number } | null = null;
    try { stored = JSON.parse(sessionStorage.getItem('kyalulu-editor-' + key) ?? 'null'); if (stored) PortableDocumentSchema.parse(stored.document); } catch { stored = null; }
    setEditing(found ? { ...found, revision: stored?.revision ?? found.revision } : undefined);
    setDocument(stored?.document ?? (found ? structuredClone(found.document) : PortableDocumentSchema.parse({ name: '', data: {} })));
    openedEditor.current = key;
  }, [items, query]);
  useEffect(() => {
    const key = query.get('edit');
    if (!document || !key || (key !== 'new' && editing?.id !== key) || (key === 'new' && editing)) return;
    try { sessionStorage.setItem('kyalulu-editor-' + key, JSON.stringify({ document, revision: editing?.revision })); }
    catch { setError('編集内容の復元用保存に失敗しました。入力はこの画面に残っています。'); }
  }, [document, editing, query]);
  useEffect(() => { setExportInfo(null); }, [format, exportItem]);
  useEffect(() => {
    if (!previewId) { setPreview(null); setDrafts([]); pending.current = null; return; }
    if (preview?.preview_id === previewId) return;
    const controller = new AbortController();
    fetchPreview(previewId, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      let saved: { drafts: Draft[]; pending: ImportCommit | null } | null = null;
      try { saved = JSON.parse(sessionStorage.getItem('kyalulu-preview-' + previewId) ?? 'null'); if (saved) saved.drafts.forEach(d => PortableDocumentSchema.parse(d.document)); } catch { saved = null; }
      setPreview(value); setDrafts(saved?.drafts ?? value.documents.map(d => ({ document: d, selected: true, histories: [] }))); pending.current = saved?.pending ?? null;
      setDocument(null); setEditing(undefined);
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => controller.abort();
  }, [previewId]);
  useEffect(() => {
    if (!preview || !drafts.length) return;
    try { sessionStorage.setItem('kyalulu-preview-' + preview.preview_id, JSON.stringify({ drafts, pending: pending.current })); }
    catch { setError('下書きの再読み込み用保存に失敗しました。入力はこの画面に残っています。'); }
  }, [preview, drafts]);
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError(friendlyMessage(e)); } finally { setBusy(false); } };
  const receive = (value: ImportPreview) => { setPreview(value); setDrafts(value.documents.map(d => ({ document: d, selected: true, histories: [] }))); setDocument(null); setEditing(undefined); setInvalid({}); pending.current = null; setQuery({ preview: value.preview_id }, { replace: true }); };
  const clearPreview = () => { if (preview) sessionStorage.removeItem('kyalulu-preview-' + preview.preview_id); setPreview(null); setDrafts([]); setInvalid({}); pending.current = null; setQuery({}, { replace: true }); };
  const importFile = (file?: File) => { if (file) void run(async () => receive(await previewFile(file))); };
  const updateDraft = (index: number, update: Partial<Draft>) => { setDrafts(all => all.map((d, i) => i === index ? { ...d, ...update } : d)); pending.current = null; };
  const commit = () => run(async () => {
    if (!preview) return;
    const body: ImportCommit = pending.current ?? { request_id: crypto.randomUUID(), selections: drafts.flatMap((d, index) => d.selected ? [{ index, document: d.document, history_indices: d.histories, target_id: d.target?.id ?? null, expected_revision: d.target?.revision ?? null, content_rating: d.rating ?? null, duplicate_action: d.copy ? 'copy' as const : null }] : []) };
    pending.current = body;
    try { sessionStorage.setItem('kyalulu-preview-' + preview.preview_id, JSON.stringify({ drafts, pending: body })); } catch { /* In-memory retry ID remains stable. */ }
    const result = await commitImport(preview.preview_id, body);
    setSessions(result.sessions); clearPreview();
    await refresh(); setMessage(`${result.items.length}件を保存しました。キャラを開いて挨拶を選べます。`);
  });
  const save = () => run(async () => {
    if (!document) return;
    const result = await saveLibraryItem(document, editing);
    const previousKey = query.get('edit');
    if (previousKey) sessionStorage.removeItem('kyalulu-editor-' + previousKey);
    openedEditor.current = result.id;
    setEditing(result); setDocument(result.document); setQuery({ edit: result.id }, { replace: true });
    await refresh(); setMessage('保存しました。これまでの会話は、はじめた時点の設定のまま続きます。');
  });
  const closeEditor = () => { const key = query.get('edit'); if (key) sessionStorage.removeItem('kyalulu-editor-' + key); setDocument(null); setEditing(undefined); setInvalid({}); setQuery({}, { replace: true }); };
  const openEditor = (id: string) => { setQuery({ edit: id }, { replace: true }); setInvalid({}); setMessage(''); };
  const portraitOf = (item: LibraryItem) => assetUrl(item.document.assets.find(a => a.type === 'icon')?.asset_id ?? item.document.assets[0]?.asset_id);
  const hasInvalid = preview ? drafts.some((d, i) => d.selected && (invalid[i] || ((d.document.source.remote as { content_rating?: string } | undefined)?.content_rating === 'unknown' && !d.rating) || ((preview.duplicates[String(i)]?.length ?? 0) > 0 && !d.target && !d.copy))) : !!invalid.editor;
  const banners = <>
    {error && <div className="k-create-banner k-create-banner--error" role="alert"><Icon name="info" size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="閉じる"><Icon name="close" size={14} /></button></div>}
    {message && <div className="k-create-banner" role="status"><Icon name="check" size={16} /><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="閉じる"><Icon name="close" size={14} /></button></div>}
    {sessions.length > 0 && <div className="k-create-migrated">{sessions.map(s => <Link key={s.session_id} to={`/chats/${s.session_id}`} className="k-chip"><Icon name="chat" size={13} /> 移行した会話を開く：{s.name}</Link>)}</div>}
  </>;

  if (document) return <div className="k-page k-create k-create--focus">
    <button type="button" className="k-back-link" onClick={closeEditor}><Icon name="back" size={15} /> マイライブラリ</button>
    <header className="k-create-focus-head"><div><p className="k-studio-kicker">{editing ? `${kindLabel[document.kind]} · 版${editing.revision}` : '新規作成'}</p><h1 className="k-page-title">{editing ? document.name || '名前未設定' : '新しいキャラ'}</h1></div>
      {editing?.document.kind === 'character' && <Link to={`/characters/${editing.id}`} className="k-btn k-btn--secondary k-btn--md"><Icon name="chat" size={15} /> キャラを開く</Link>}</header>
    {banners}
    <Card><fieldset disabled={busy}><PortableEditor library={items} key={`${editing?.id ?? "new"}-${editing?.revision ?? 0}`} document={document} onChange={setDocument} onValidity={valid => setInvalid(x => x.editor === !valid ? x : ({ ...x, editor: !valid }))} /></fieldset></Card>
    <div className="k-create-savebar"><span className="k-create-savebar__hint">{!document.name.trim() ? '名前を入力すると保存できます' : hasInvalid ? '入力内容を確認してください' : '変更はこの画面に一時保存されています'}</span><Button variant="ghost" onClick={closeEditor}>閉じる</Button><Button disabled={busy || hasInvalid || !document.name.trim()} onClick={() => void save()}>{busy ? '保存中…' : '設定を保存'}</Button></div>
  </div>;

  if (preview) return <div className="k-page k-create k-create--focus">
    <button type="button" className="k-back-link" onClick={clearPreview} disabled={busy}><Icon name="back" size={15} /> 取り込みをやめる</button>
    <header className="k-create-focus-head"><div><p className="k-studio-kicker">{preview.filename} · {drafts.length}件</p><h1 className="k-page-title">取り込み内容を確認</h1><p className="k-page-sub">保存する前に、名前や挨拶などを整えられます。</p></div></header>
    {banners}
    <section aria-label="取り込みプレビュー" className="k-create-stack">
      {drafts.map((draft, index) => <Card key={index}>
        <label className="k-create-check"><input type="checkbox" checked={draft.selected} onChange={e => updateDraft(index, { selected: e.target.checked })} /> <strong>{draft.document.name || '名前未設定'}</strong>を取り込む<span className="k-badge">{kindLabel[draft.document.kind]}</span></label>
        <fieldset disabled={busy || !draft.selected}>
          {!!draft.document.source.remote && <div><ImportSource value={draft.document.source.remote} />
            {(draft.document.source.remote as { content_rating?: string }).content_rating === 'unknown' && <label className="k-create-field">内容区分（未判定）<select aria-label={`内容区分 ${index + 1}`} value={draft.rating ?? ''} onChange={e => updateDraft(index, { rating: e.target.value as Draft['rating'] })}><option value="">内容を確認して選択</option><option value="sfw">全年齢</option><option value="nsfw">成人向け</option></select></label>}
          </div>}
          {(preview.duplicates[String(index)]?.length ?? 0) > 0 && <div className="k-create-note"><p>同じ原本を取り込み済みです。</p>{preview.duplicates[String(index)].map(item => <p key={item.id}><Link to={`/create?edit=${item.id}`}>{item.name}（版{item.revision}）を開く</Link></p>)}<label className="k-create-check"><input type="checkbox" checked={draft.copy ?? false} onChange={e => updateDraft(index, { copy: e.target.checked })} /> 新しい項目として複製する</label><p>または、保存先で既存の項目を選んで更新できます。</p></div>}
          <label className="k-create-field">保存先<select aria-label={`保存先 ${index + 1}`} value={draft.target?.id ?? ''} onChange={e => updateDraft(index, { target: items.find(i => i.id === e.target.value) })}><option value="">新しい項目として作成</option>{items.filter(i => i.document.kind === draft.document.kind).map(i => <option key={i.id} value={i.id}>{i.document.name}を更新（版{i.revision}）</option>)}</select></label>
          <PortableEditor library={items} key={`${preview.preview_id}-${index}`} document={draft.document} onChange={d => updateDraft(index, { document: d })} onValidity={valid => setInvalid(x => x[index] === !valid ? x : ({ ...x, [index]: !valid }))} />
          {draft.document.histories.length > 0 && <section><h3>移行する会話</h3><p>選択した会話を別セッションに保存します。</p>{draft.document.histories.map((h, j) => <label className="k-create-check" key={j}><input type="checkbox" checked={draft.histories.includes(j)} onChange={e => updateDraft(index, { histories: e.target.checked ? [...draft.histories, j] : draft.histories.filter(n => n !== j) })} /> {h.name}（{h.messages.length}メッセージ）</label>)}</section>}
          {draft.document.notices.length > 0 && <details><summary>変換結果と未対応項目（{draft.document.notices.length}件）</summary><ul className="k-create-notices">{draft.document.notices.map((n, j) => <li key={j}><strong>{statusLabel[n.status]}</strong> · {n.path}：{n.reason}</li>)}</ul></details>}
          <details><summary>原文・元の設定を確認</summary><pre>{JSON.stringify(draft.document.source, null, 2)}</pre></details>
        </fieldset>
      </Card>)}
    </section>
    <div className="k-create-savebar"><span className="k-create-savebar__hint">{hasInvalid ? '未入力・未選択の項目があります' : `${drafts.filter(d => d.selected).length}件を保存します`}</span><Button variant="ghost" disabled={busy} onClick={clearPreview}>キャンセル</Button><Button disabled={busy || hasInvalid || !drafts.some(d => d.selected)} onClick={() => void commit()}>{busy ? '保存中…' : '選択した内容を保存'}</Button></div>
  </div>;

  return <div className="k-page k-create">
    <div className="k-page-head"><div><h1 className="k-page-title">クリエイト</h1><p className="k-page-sub">お気に入りのキャラと、その世界を連れてこよう。</p></div>
      <Button onClick={() => openEditor('new')}><Icon name="plus" size={16} /> 新しく作る</Button></div>
    {banners}
    <section className="k-section" aria-label="取り込む">
      <h2 className="k-section__title"><span className="k-section__mark">✦</span> キャラ・プリセットを取り込む</h2>
      <div className="k-create-import">
        <div className={`k-create-drop ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); importFile(e.dataTransfer.files[0]); }}>
          <span className="k-create-drop__icon" aria-hidden="true"><Icon name="upload" size={26} /></span>
          <h3>ファイルから取り込む</h3>
          <p>Character Card / SillyTavern / Backyard AI / RisuAI</p>
          <label className={`k-btn k-btn--primary k-btn--md k-create-file ${busy ? 'is-disabled' : ''}`}>{busy ? '読み込み中…' : 'ファイルを選ぶ'}<input aria-label="取り込むファイル" type="file" accept=".json,.png,.apng,.charx,.byaf,.zip,.txt" disabled={busy} onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <small>ドラッグ＆ドロップにも対応 · JSON・PNG・CHARX・BYAF・テキスト（最大32 MiB）</small>
        </div>
        <Card className="k-create-url">
          <UrlImportBox onPreview={receive} disabled={busy} onBusyChange={setBusy} />
        </Card>
      </div>
      <div className="k-create-more">
        <details open={query.get('import') === 'characterai' || undefined}><summary>Character.AIの設定やLoreを貼り付ける</summary>
          <div className="k-create-more__body"><p>名前・説明・挨拶・Definitionの原文を貼り付けて確認できます。</p>
            <Textarea aria-label="移行する設定テキスト" rows={8} value={text} placeholder={'Name: キャラの名前\nDescription: 説明\nGreeting: 最初の挨拶\nDefinition: 定義の原文'} onChange={e => setText(e.target.value)} />
            <Button disabled={busy || !text.trim()} onClick={() => void run(async () => receive(await previewText(text)))}>貼り付け内容を確認</Button></div>
        </details>
        <details><summary>外部Hubサイトを開く</summary><div className="k-create-more__body"><HubLinks /></div></details>
      </div>
    </section>

    <section className="k-section" aria-label="マイライブラリ">
      <div className="k-section__head"><h2 className="k-section__title"><span className="k-section__mark">✦</span> マイライブラリ <span className="k-count">{items.length}件</span></h2>
        {adult && <label className="k-create-check k-create-check--sm"><input type="checkbox" checked={includeNsfw} onChange={e => setIncludeNsfw(e.target.checked)} /> 成人向けも表示</label>}</div>
      {items.length === 0 ? <EmptyState mascot="wink" title="まだなにもありません" description="キャラクターカードを取り込むか、「新しく作る」からはじめよう。" action={<Button variant="secondary" onClick={() => openEditor('new')}><Icon name="plus" size={15} /> 新しく作る</Button>} />
        : <div className="k-create-library">{items.map(item => <article key={item.id} className="k-lib-card">
          <button type="button" className="k-lib-card__main" onClick={() => openEditor(item.id)} aria-label={`${item.document.name}を編集`}>
            <Avatar name={item.document.name} seed={item.id} size="lg" src={portraitOf(item)} />
            <span className="k-lib-card__who"><span className="k-lib-card__name">{item.document.name}</span><span className="k-lib-card__meta">{kindLabel[item.document.kind]} · 版{item.revision}{item.document.nsfw ? ' · 成人向け' : ''}</span></span>
          </button>
          <div className="k-lib-card__actions">
            {item.document.kind === 'character' && <Button size="sm" onClick={() => navigate(`/characters/${item.id}`)}><Icon name="chat" size={13} /> 話す</Button>}
            <Button variant="secondary" size="sm" onClick={() => openEditor(item.id)}><Icon name="edit" size={13} /> 編集</Button>
            <Button variant="ghost" size="sm" onClick={() => setExportItem(item)}><Icon name="download" size={13} /> 書き出し</Button>
          </div>
        </article>)}</div>}
    </section>

    <Dialog open={!!exportItem} onClose={() => setExportItem(null)} labelledBy="k-export-title" wide>
      {exportItem && <div className="k-confirm">
        <h2 id="k-export-title" className="k-confirm__title">{exportItem.document.name}を書き出す</h2>
        <p className="k-confirm__desc">ほかのアプリで使える形式でファイルに保存します。形式によっては一部の設定が引き継がれません。</p>
        <label className="k-create-field">形式<select aria-label="書き出し形式" value={format} onChange={e => setFormat(e.target.value)}>{formats.filter(f => f !== 'original' || exportItem.original_id).map(f => <option key={f} value={f}>{formatLabel[f] ?? f}</option>)}</select></label>
        {exportInfo ? <>{exportInfo.notices.length > 0 && <ul className="k-create-notices">{exportInfo.notices.map((n, i) => <li key={i}>{n.path}：{n.reason}</li>)}</ul>}
          <div className="k-confirm__actions"><Button variant="ghost" onClick={() => setExportItem(null)}>閉じる</Button><a className="k-btn k-btn--primary k-btn--md" href={`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}&download=true`} download><Icon name="download" size={15} /> {exportInfo.filename}</a></div></>
          : <div className="k-confirm__actions"><Button variant="ghost" onClick={() => setExportItem(null)}>閉じる</Button><Button disabled={busy} onClick={() => void run(async () => setExportInfo(await libraryRequest(`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}`)))}>{busy ? '確認中…' : '書き出し内容を確認'}</Button></div>}
        {error && <p className="k-inline-error" role="alert">{error}</p>}
      </div>}
    </Dialog>
  </div>;
}
