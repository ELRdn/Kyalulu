import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';
import PortableEditor from '../components/PortableEditor';
import UrlImportBox from '../components/UrlImportBox';
import ImportSource from '../components/ImportSource';
import { fetchPreview } from '../lib/hubs';
import { fetchLibrary, previewFile, previewText, commitImport, saveLibraryItem, libraryRequest, PortableDocumentSchema, type LibraryItem, type ImportPreview, type PortableDocument, type ImportCommit } from '../lib/library';
import './pages.css';
import './create.css';

type Draft = { document: PortableDocument; selected: boolean; histories: number[]; target?: LibraryItem; rating?: 'sfw' | 'nsfw'; copy?: boolean };
const formats = ['ccv3-json', 'ccv3-png', 'charx', 'ccv2-json', 'ccv2-png', 'backup', 'original'];
const statusLabel = { applied: '反映できる', converted: '変換する', preserved: '保存のみ', error: 'エラー' };

export default function Create() {
  const [query, setQuery] = useSearchParams();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [includeNsfw, setIncludeNsfw] = useState(false);
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
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
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
    await refresh(); setMessage('保存しました。既存の会話は選択済みの版を使い続けます。');
  });
  const hasInvalid = preview ? drafts.some((d, i) => d.selected && (invalid[i] || ((d.document.source.remote as { content_rating?: string } | undefined)?.content_rating === 'unknown' && !d.rating) || ((preview.duplicates[String(i)]?.length ?? 0) > 0 && !d.target && !d.copy))) : !!invalid.editor;
  return <div className="k-page k-create">
    <header><h1 className="k-page-title">Create</h1><p className="k-page-sub">お気に入りのキャラと、その世界を連れてこよう。</p></header>
    {error && <div className="k-create-alert" role="alert">{error}</div>}
    {message && <p role="status">{message}</p>}
    {sessions.map(s => <Link key={s.session_id} to={`/chats/${s.session_id}`}>移行した会話を開く：{s.name}</Link>)}
    <Card>
      <UrlImportBox onPreview={receive} disabled={busy} onBusyChange={setBusy} />
      <div className="k-create-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); importFile(e.dataTransfer.files[0]); }}>
        <span aria-hidden="true">✦</span><h2>キャラ・プリセットを取り込む</h2>
        <p>Character Card / SillyTavern / Backyard AI / RisuAI / Character.AI</p>
        <label className="k-create-file">ファイルを選択<input aria-label="取り込むファイル" type="file" accept=".json,.png,.apng,.charx,.byaf,.zip,.txt" disabled={busy} onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <small>ここにドロップもできます。JSON・PNG・CHARX・BYAF・テキスト／最大32 MiB</small>
      </div>
      <details open={query.get('import') === 'characterai' || undefined}><summary>Character.AIの設定やLoreを貼り付ける</summary>
        <p>名前・説明・挨拶・Definitionの原文を貼り付けて確認できます。</p>
        <Textarea aria-label="移行する設定テキスト" rows={8} value={text} placeholder={'Name: キャラの名前\nDescription: 説明\nGreeting: 最初の挨拶\nDefinition: 定義の原文'} onChange={e => setText(e.target.value)} />
        <Button disabled={busy || !text.trim()} onClick={() => void run(async () => receive(await previewText(text)))}>貼り付け内容を確認</Button>
      </details>
    </Card>
    {preview && <section aria-label="取り込みプレビュー" className="k-create-stack">
      <h2>取り込み内容を確認</h2><p>{preview.filename} · {drafts.length}件</p>
      {drafts.map((draft, index) => <Card key={index}>
        <label><input type="checkbox" checked={draft.selected} onChange={e => updateDraft(index, { selected: e.target.checked })} /> {draft.document.name}を取り込む</label>
        <fieldset disabled={busy || !draft.selected}>
          {!!draft.document.source.remote && <div><ImportSource value={draft.document.source.remote} />
            {(draft.document.source.remote as { content_rating?: string }).content_rating === 'unknown' && <label className="k-create-field">内容区分（未判定）<select aria-label={`内容区分 ${index + 1}`} value={draft.rating ?? ''} onChange={e => updateDraft(index, { rating: e.target.value as Draft['rating'] })}><option value="">内容を確認して選択</option><option value="sfw">SFW</option><option value="nsfw">成人向け</option></select></label>}
          </div>}
          {(preview.duplicates[String(index)]?.length ?? 0) > 0 && <div><p>同じ原本を取り込み済みです。</p>{preview.duplicates[String(index)].map(item => <p key={item.id}><Link to={`/create?edit=${item.id}`}>{item.name}（版{item.revision}）を開く</Link></p>)}<label><input type="checkbox" checked={draft.copy ?? false} onChange={e => updateDraft(index, { copy: e.target.checked })} /> 新しい項目として複製する</label><p>または、保存先で既存の項目を選んで更新できます。</p></div>}
          <label className="k-create-field">保存先<select aria-label={`保存先 ${index + 1}`} value={draft.target?.id ?? ''} onChange={e => updateDraft(index, { target: items.find(i => i.id === e.target.value) })}><option value="">新しい項目として作成</option>{items.filter(i => i.document.kind === draft.document.kind).map(i => <option key={i.id} value={i.id}>{i.document.name}を更新（版{i.revision}）</option>)}</select></label>
          <PortableEditor library={items} key={`${preview.preview_id}-${index}`} document={draft.document} onChange={d => updateDraft(index, { document: d })} onValidity={valid => setInvalid(x => x[index] === !valid ? x : ({ ...x, [index]: !valid }))} />
          {draft.document.histories.length > 0 && <section><h3>移行する会話</h3><p>選択した会話を別セッションに保存します。</p>{draft.document.histories.map((h, j) => <label className="k-create-field" key={j}><span><input type="checkbox" checked={draft.histories.includes(j)} onChange={e => updateDraft(index, { histories: e.target.checked ? [...draft.histories, j] : draft.histories.filter(n => n !== j) })} /> {h.name}（{h.messages.length}メッセージ）</span></label>)}</section>}
          <details open><summary>変換結果と未対応項目</summary><ul className="k-create-notices">{draft.document.notices.map((n, j) => <li key={j}><strong>{statusLabel[n.status]}</strong> · {n.path}：{n.reason}</li>)}</ul></details>
          <details><summary>原文・元の設定を確認</summary><pre>{JSON.stringify(draft.document.source, null, 2)}</pre></details>
        </fieldset>
      </Card>)}
      <div className="k-create-actions"><Button disabled={busy || hasInvalid || !drafts.some(d => d.selected)} onClick={() => void commit()}>{busy ? '保存中…' : '選択した内容を保存'}</Button><Button variant="ghost" disabled={busy} onClick={clearPreview}>キャンセル</Button></div>
    </section>}
    {!preview && <>
      <div className="k-create-actions"><h2>マイライブラリ</h2><Button variant="secondary" onClick={() => { setQuery({ edit: 'new' }, { replace: true }); setInvalid({}); }}>新しく作る</Button><label><input type="checkbox" checked={includeNsfw} onChange={e => setIncludeNsfw(e.target.checked)} /> 成人向けも表示</label></div>
      <div className="k-create-library">{items.map(item => <Card key={item.id}><h3>{item.document.name}</h3><p>{({ character: 'キャラクター', profile: '生成プリセット', lorebook: 'Lorebook' })[item.document.kind]} · 版{item.revision}</p><div className="k-create-actions"><Button variant="secondary" size="sm" onClick={() => { setQuery({ edit: item.id }, { replace: true }); setInvalid({}); }}>編集</Button>{item.document.kind === 'character' && <Link to={`/characters/${item.id}`}>キャラを開く</Link>}<Button variant="ghost" size="sm" onClick={() => setExportItem(item)}>書き出し</Button></div></Card>)}</div>
      {items.length === 0 && <p>取り込んだキャラやプリセットがここに並びます。</p>}
      {document && <Card><h2>{editing ? '設定を編集' : '新しいキャラ'}</h2><fieldset disabled={busy}><PortableEditor library={items} key={`${editing?.id ?? "new"}-${editing?.revision ?? 0}`} document={document} onChange={setDocument} onValidity={valid => setInvalid(x => x.editor === !valid ? x : ({ ...x, editor: !valid }))} /></fieldset><div className="k-create-actions"><Button disabled={busy || hasInvalid || !document.name.trim()} onClick={() => void save()}>設定を保存</Button><Button variant="ghost" onClick={() => { const key = query.get('edit'); if (key) sessionStorage.removeItem('kyalulu-editor-' + key); setDocument(null); setEditing(undefined); setInvalid({}); setQuery({}, { replace: true }); }}>閉じる</Button></div></Card>}
    </>}
    {exportItem && <Card><h2>{exportItem.document.name}を書き出す</h2><label className="k-create-field">形式<select aria-label="書き出し形式" value={format} onChange={e => setFormat(e.target.value)}>{formats.filter(f => f !== 'original' || exportItem.original_id).map(f => <option key={f}>{f}</option>)}</select></label>
      <Button variant="secondary" disabled={busy} onClick={() => void run(async () => setExportInfo(await libraryRequest(`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}`)))}>書き出し内容を確認</Button>
      {exportInfo && <div><ul>{exportInfo.notices.map((n, i) => <li key={i}>{n.path}：{n.reason}</li>)}</ul><a className="k-btn k-btn--primary k-btn--md" href={`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}&download=true`} download>{exportInfo.filename}をダウンロード</a></div>}
      <Button variant="ghost" onClick={() => setExportItem(null)}>閉じる</Button>
    </Card>}
  </div>;
}
