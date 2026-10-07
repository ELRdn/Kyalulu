import { RuntimeDownload } from '../components/RuntimeMedia';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';
import Dialog, { useConfirm } from '../components/ui/Dialog';
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
import { fetchLibrary, fetchLibraryItem, assetUrl, previewFile, previewText, commitImport, saveLibraryItem, libraryRequest, PortableDocumentSchema, type LibraryItem, type ImportPreview, type PortableDocument, type ImportCommit } from '../lib/library';
import './pages.css';
import './create.css';
import { useAdministrative, useRuntimeAccess } from '../components/RuntimeGate';
import { scopedKey } from '../lib/remoteStore';
import { cloudOwner } from '../lib/cloudMode';

type Draft = { document: PortableDocument; selected: boolean; histories: number[]; target?: LibraryItem; rating?: 'sfw' | 'nsfw'; copy?: boolean };
const formats = ['ccv3-json', 'ccv3-png', 'charx', 'ccv2-json', 'ccv2-png', 'backup', 'original'];
const statusLabel = { applied: '反映できる', converted: '変換する', preserved: '保存のみ', error: 'エラー' };
const formatLabel: Record<string, string> = { 'ccv3-json': 'Character Card V3（JSON）', 'ccv3-png': 'Character Card V3（PNG画像）', charx: 'CHARX', 'ccv2-json': 'Character Card V2（JSON）', 'ccv2-png': 'Character Card V2（PNG画像）', backup: 'Kyaluluバックアップ', original: '取り込んだ原本' };
const kindLabel = { character: 'プロット', profile: '生成プリセット', lorebook: '設定集' } as const;
const creationOptions = [
  { kind: 'character', icon: 'sparkle', title: 'プロットを作る', description: 'キャラクターと世界観、会話のはじまりを設定します。' },
  { kind: 'lorebook', icon: 'book', title: '設定集を作る', description: '世界の知識をキーワードと一緒にまとめます。' },
  { kind: 'profile', icon: 'settings', title: '生成プリセットを作る', description: '文体や生成パラメーターをまとめて保存します。' },
] as const;

export default function Create() {
  useRuntimeAccess();
  // An account/host change must tear down the previous owner's editor state.
  return <CreateWorkspace key={scopedKey('kyalulu-create')} />;
}

function CreateWorkspace() {
  const administrative = useAdministrative();
  const { cloud_mode: cloud = false, remote_mode: remote = false } = useRuntimeAccess();
  const draftOwnerKnown = !cloud || !!cloudOwner();
  const scope = useRef(scopedKey('kyalulu-create')).current;
  const draftPrefix = useRef(scopedKey('kyalulu-create-draft-v1')).current;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const currentScope = () => mounted.current && scope === scopedKey('kyalulu-create');
  const storageKey = (type: 'editor' | 'preview', id: string) => `${draftPrefix}:${type}:${id}`;
  const [confirmation, confirm] = useConfirm();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [loadedEditor, setLoadedEditor] = useState<string | null>(null);
  const baseline = useRef('');
  const [lastPreview, setLastPreview] = useState<string | null>(() => {
    if (!draftOwnerKnown) return null;
    try { return sessionStorage.getItem(`${draftPrefix}:last-preview`); } catch { return null; }
  });
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
  const [conflict, setConflict] = useState(false);
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
  const saveRequest = useRef<{ id: string; payload: string } | null>(null);
  const openedEditor = useRef<string | null>(null);
  const previewId = query.get('preview');
  const newKind: PortableDocument['kind'] = query.get('kind') === 'lorebook' ? 'lorebook' : query.get('kind') === 'profile' ? 'profile' : 'character';
  const editId = query.get('edit');
  const editorKey = editId === 'new' ? `new-${newKind}` : editId;
  const dirty = !!document && JSON.stringify(document) !== baseline.current;
  const storageLabel = cloud ? 'このアカウント' : remote ? '接続先のPC' : 'この端末';
  useDocumentTitle('クリエイト');
  useEffect(() => { if (!adult) setIncludeNsfw(false); }, [adult]);
  // 編集・確認モードへ切り替わったら画面の先頭から見せる（下に追加されて気づけない問題の対策）
  useEffect(() => { window.document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }, [!!previewId, query.get('edit')]);
  const refresh = async () => { const value = await fetchLibrary(includeNsfw); if (currentScope()) setItems(value); };
  useEffect(() => { let active = true; fetchLibrary(includeNsfw).then(x => { if (active && currentScope()) setItems(x); }).catch(e => { if (active && currentScope()) setError(friendlyMessage(e)); }); return () => { active = false; }; }, [includeNsfw]);
  useEffect(() => {
    const key = query.get('edit');
    if (!key || previewId) { openedEditor.current = null; saveRequest.current = null; setLoadedEditor(null); setDocument(null); setEditing(undefined); return; }
    if (openedEditor.current === editorKey) return;
    const found = items.find(i => i.id === key);
    if (!found && key !== 'new') return;
    let stored: { document: PortableDocument; revision?: number; request_id?: string } | null = null;
    try {
      stored = draftOwnerKnown ? JSON.parse(sessionStorage.getItem(storageKey('editor', editorKey!)) ?? 'null') : null;
      if (stored) {
        PortableDocumentSchema.parse(stored.document);
        if (stored.revision !== undefined && (!Number.isInteger(stored.revision) || stored.revision < 1)) stored = null;
      }
    } catch { stored = null; }
    const original = found ? structuredClone(found.document) : PortableDocumentSchema.parse({ kind: newKind, name: '', data: {} });
    baseline.current = JSON.stringify(original);
    saveRequest.current = stored && typeof stored.request_id === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stored.request_id)
      ? { id: stored.request_id, payload: JSON.stringify(found ? { document: stored.document, expected_revision: stored.revision ?? found.revision } : stored.document) } : null;
    setEditing(found ? { ...found, revision: stored?.revision ?? found.revision } : undefined);
    setDocument(stored?.document ?? original);
    setDraftSaved(!!stored);
    setLoadedEditor(editorKey);
    setInvalid({});
    setConflict(false);
    openedEditor.current = editorKey;
  }, [items, query]);
  const persistEditor = () => {
    if (!document || !editorKey || loadedEditor !== editorKey || !currentScope()) return false;
    if (!draftOwnerKnown) { setDraftSaved(false); setError('アカウントを確認できないため、一時下書きを保存できません。ログイン状態を確認してください。'); return false; }
    try {
      const payload = JSON.stringify(editing ? { document, expected_revision: editing.revision } : document);
      if (saveRequest.current?.payload !== payload) saveRequest.current = { id: crypto.randomUUID(), payload };
      sessionStorage.setItem(storageKey('editor', editorKey), JSON.stringify({ document, revision: editing?.revision,
        request_id: saveRequest.current?.id }));
      setDraftSaved(true);
      return true;
    } catch {
      setDraftSaved(false);
      setError('一時下書きを保存できませんでした。画面を閉じずに再試行するか、内容を保存してください。');
      return false;
    }
  };
  useEffect(() => {
    const key = query.get('edit');
    if (!document || !key || (key !== 'new' && editing?.id !== key) || (key === 'new' && editing)) return;
    persistEditor();
  }, [document, editing, query, loadedEditor]);
  useEffect(() => { setExportInfo(null); }, [format, exportItem]);
  useEffect(() => {
    if (!previewId) { setPreview(null); setDrafts([]); pending.current = null; return; }
    if (preview?.preview_id === previewId) return;
    const controller = new AbortController();
    fetchPreview(previewId, controller.signal).then(value => {
      if (controller.signal.aborted || !currentScope()) return;
      let saved: { drafts: Draft[]; pending: ImportCommit | null } | null = null;
      try { saved = draftOwnerKnown ? JSON.parse(sessionStorage.getItem(storageKey('preview', previewId)) ?? 'null') : null; if (saved) saved.drafts.forEach(d => PortableDocumentSchema.parse(d.document)); } catch { saved = null; }
      setPreview(value); setDrafts(saved?.drafts ?? value.documents.map(d => ({ document: d, selected: true, histories: [] }))); pending.current = saved?.pending ?? null;
      setDraftSaved(!!saved);
      setDocument(null); setEditing(undefined);
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => controller.abort();
  }, [previewId]);
  useEffect(() => {
    if (!preview || !drafts.length || !currentScope()) return;
    if (!draftOwnerKnown) { setDraftSaved(false); setError('アカウントを確認できないため、一時下書きを保存できません。ログイン状態を確認してください。'); return; }
    try { sessionStorage.setItem(storageKey('preview', preview.preview_id), JSON.stringify({ drafts, pending: pending.current })); sessionStorage.setItem(`${draftPrefix}:last-preview`, preview.preview_id); setLastPreview(preview.preview_id); setDraftSaved(true); }
    catch { setDraftSaved(false); setError('一時下書きを保存できませんでした。入力はこの画面に残っています。'); }
  }, [preview, drafts]);
  useEffect(() => {
    if (!dirty && !preview) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, !!preview]);
  const run = async (work: () => Promise<void>) => { if (busy || !currentScope()) return; setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { if (currentScope()) setError(friendlyMessage(e)); } finally { if (currentScope()) setBusy(false); } };
  const receive = (value: ImportPreview) => { if (!currentScope()) return; setPreview(value); setDrafts(value.documents.map(d => ({ document: d, selected: true, histories: [] }))); setDraftSaved(false); setDocument(null); setEditing(undefined); setInvalid({}); pending.current = null; setQuery({ preview: value.preview_id }, { replace: true }); };
  const clearPreview = (remove = false) => {
    if (remove && preview) {
      try { sessionStorage.removeItem(storageKey('preview', preview.preview_id)); sessionStorage.removeItem(`${draftPrefix}:last-preview`); } catch { /* A completed import can still be retried with its original request ID. */ }
      setLastPreview(null);
    }
    setPreview(null); setDrafts([]); setInvalid({}); pending.current = null; setQuery({}, { replace: true });
  };
  const leavePreview = async () => {
    if (busy || !preview || !await confirm({ title: '取り込みの確認を中断しますか？', description: '入力した内容は、このブラウザーの一時下書きに残します。ライブラリへの保存はまだ完了していません。', confirmLabel: '下書きを残して戻る', cancelLabel: '編集を続ける' })) return;
    if (!currentScope()) return;
    if (!draftOwnerKnown) { setDraftSaved(false); setError('アカウントを確認できないため、一時下書きを保存できません。'); return; }
    try { sessionStorage.setItem(storageKey('preview', preview.preview_id), JSON.stringify({ drafts, pending: pending.current })); sessionStorage.setItem(`${draftPrefix}:last-preview`, preview.preview_id); setLastPreview(preview.preview_id); clearPreview(); }
    catch { setDraftSaved(false); setError('一時下書きを保存できませんでした。画面を閉じずに再試行してください。'); }
  };
  const importFile = (file?: File) => { if (file) void run(async () => receive(await previewFile(file))); };
  const updateDraft = (index: number, update: Partial<Draft>) => { setDrafts(all => all.map((d, i) => i === index ? { ...d, ...update } : d)); pending.current = null; };
  const commit = () => run(async () => {
    if (!preview) return;
    const body: ImportCommit = pending.current ?? { request_id: crypto.randomUUID(), selections: drafts.flatMap((d, index) => d.selected ? [{ index, document: d.document, history_indices: d.histories, target_id: d.target?.id ?? null, expected_revision: d.target?.revision ?? null, content_rating: d.rating ?? null, duplicate_action: d.copy ? 'copy' as const : null }] : []) };
    pending.current = body;
    try { if (draftOwnerKnown) sessionStorage.setItem(storageKey('preview', preview.preview_id), JSON.stringify({ drafts, pending: body })); } catch { setDraftSaved(false); /* In-memory retry ID remains stable. */ }
    const result = await commitImport(preview.preview_id, body);
    if (!currentScope()) return;
    setSessions(result.sessions); clearPreview(true);
    await refresh(); if (currentScope()) setMessage(`${result.items.length}件を${storageLabel}に保存しました。プロットを開いて会話を始められます。`);
  });
  const save = () => run(async () => {
    if (!document) return;
    // Persist the matching payload/ID before sending, as with an import commit.
    if (!persistEditor()) return;
    let result: LibraryItem;
    try { result = await saveLibraryItem(document, editing, saveRequest.current?.id); }
    catch (error) {
      if (currentScope() && error instanceof Error && 'status' in error && error.status === 409) setConflict(true);
      if (currentScope() && !(error instanceof Error && 'status' in error && typeof error.status === 'number' && error.status < 500))
        throw new Error(`${friendlyMessage(error)} この下書きと保存IDは残っています。内容を変えずに再保存すると同じ保存IDで結果を確認します。内容を変える前にライブラリの保存結果を確認してください。`);
      throw error;
    }
    if (!currentScope()) return;
    saveRequest.current = null;
    setConflict(false);
    if (editorKey) { try { sessionStorage.removeItem(storageKey('editor', editorKey)); } catch { /* The server save has already succeeded. */ } }
    openedEditor.current = result.id;
    baseline.current = JSON.stringify(result.document);
    setLoadedEditor(result.id);
    setEditing(result); setDocument(result.document); setQuery({ edit: result.id }, { replace: true });
    await refresh(); if (currentScope()) setMessage(`${storageLabel}に保存しました。これまでの会話は、はじめた時点の設定のまま続きます。`);
  });
  const reviewConflict = () => run(async () => {
    if (!editing || !document) return;
    const latest = await fetchLibraryItem(editing.id);
    if (!currentScope()) return;
    if (!await confirm({ title: '別の端末で保存された版を確認',
      description: <><p>保存済みの版{latest.revision}とこの下書きを確認してください。続けると、次の保存でこの下書きを新しい版として保存します。過去の版は残ります。</p>{[['保存済みの最新版', latest.document], ['この下書き', document]].map(([label, value]) => <details key={String(label)}><summary>{String(label)}</summary><pre style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(value, null, 2)}</pre></details>)}</>,
      confirmLabel: 'この下書きで編集を続ける', cancelLabel: '下書きに戻る' })) return;
    if (!currentScope()) return;
    setEditing(latest); setConflict(false);
    setMessage(`版${latest.revision}を確認しました。「新しい版として保存」でこの下書きを保存できます。`);
  });
  const closeEditor = async () => {
    if (busy) return;
    if (dirty && !await confirm({ title: '保存前の下書きを残して戻りますか？', description: `${storageLabel}への保存はまだ完了していません。一時下書きはこのブラウザーに残り、同じ項目を開くと再開できます。`, confirmLabel: '下書きを残して戻る', cancelLabel: '編集を続ける' })) return;
    if (!persistEditor()) return;
    setDocument(null); setEditing(undefined); setLoadedEditor(null); setInvalid({}); setQuery({}, { replace: true });
    void refresh().catch(error => { if (currentScope()) setError(friendlyMessage(error)); });
  };
  const openEditor = (id: string, kind: PortableDocument['kind'] = 'character') => { setChooserOpen(false); setQuery(id === 'new' ? { edit: id, kind } : { edit: id }, { replace: true }); setInvalid({}); setMessage(''); };
  const portraitOf = (item: LibraryItem) => assetUrl(item.document.assets.find(a => a.type === 'icon')?.asset_id ?? item.document.assets[0]?.asset_id);
  const hasInvalid = preview ? drafts.some((d, i) => d.selected && (invalid[i] || (cloud && (d.document.nsfw || d.rating === 'nsfw')) || ((d.document.source.remote as { content_rating?: string } | undefined)?.content_rating === 'unknown' && !d.rating) || ((preview.duplicates[String(i)]?.length ?? 0) > 0 && !d.target && !d.copy))) : !!invalid.editor || (cloud && !!document?.nsfw);
  const banners = <>
    {error && <div className="k-create-banner k-create-banner--error" role="alert"><Icon name="info" size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="閉じる"><Icon name="close" size={14} /></button></div>}
    {message && <div className="k-create-banner" role="status"><Icon name="check" size={16} /><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="閉じる"><Icon name="close" size={14} /></button></div>}
    {sessions.length > 0 && <div className="k-create-migrated">{sessions.map(s => <Link key={s.session_id} to={`/chats/${s.session_id}`} className="k-chip"><Icon name="chat" size={13} /> 移行した会話を開く：{s.name}</Link>)}</div>}
  </>;
  const editorHint = !document?.name.trim() ? '名前を入力すると保存できます' : hasInvalid ? '入力内容を確認してください' : dirty ? `${storageLabel}への保存はまだ完了していません` : 'ライブラリへの保存が完了しています';

  if (document) return <div className="k-page k-create k-create--focus">
    {confirmation}
    <header className="k-create-editor-head">
      <div className="k-create-editor-head__title"><button type="button" className="k-back-link" disabled={busy} onClick={() => void closeEditor()} aria-label="マイライブラリに戻る"><Icon name="back" size={20} /></button><div><p className="k-studio-kicker">{kindLabel[document.kind]}{editing ? ` · 版${editing.revision}` : ' · 新規作成'}</p><h1 className="k-page-title">{document.name || `新しい${kindLabel[document.kind]}`}</h1></div></div>
      <div className="k-create-editor-head__actions"><Button variant="secondary" size="sm" disabled={busy} onClick={() => { if (persistEditor()) setMessage('一時下書きをこのブラウザーに保存しました。ライブラリへの保存は「保存」ボタンで行います。'); }}>一時下書きを保存</Button><Button size="sm" disabled={busy || hasInvalid || !document.name.trim()} onClick={() => void save()}>{busy ? '保存中…' : editing ? '新しい版として保存' : '保存'}</Button></div>
    </header>
    <div className="k-create-storage" role="note"><Icon name={cloud ? 'lock' : 'library'} size={15} /><span>保存先：{storageLabel}{cloud ? ' · アカウント内で共有 · 全年齢の内容' : ''}</span><span className="k-create-draft-state">{draftSaved ? '一時下書き：このブラウザーに保存済み' : '一時下書き：未保存'}</span></div>
    {banners}
    {conflict && editing && <div className="k-create-note" role="alert"><p>別の端末で変更されています。この下書きは残っています。保存前に最新版を確認してください。</p><Button variant="secondary" disabled={busy} onClick={() => void reviewConflict()}>競合した版を確認</Button></div>}
    <Card className="k-create-editor-card"><fieldset disabled={busy}><PortableEditor library={items} key={`${loadedEditor}-${editing?.revision ?? 0}`} document={document} onChange={value => { setDraftSaved(false); setDocument(value); }} onValidity={valid => setInvalid(x => x.editor === !valid ? x : ({ ...x, editor: !valid }))} /></fieldset></Card>
    <footer className="k-create-editor-footer"><p>{editorHint}</p><div className="k-create-editor-footer__links"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void closeEditor()}>下書きを残して戻る</Button>{editing?.document.kind === 'character' && <Button variant="secondary" size="sm" disabled={busy || dirty} onClick={() => navigate(`/characters/${editing.id}`)}><Icon name="chat" size={15} /> プロットを開く</Button>}</div><small>一時下書きは再読み込み後も同じアカウント・ブラウザーで再開できます。{editing ? '新しい版を保存しても、進行中の会話は開始時の設定を使います。' : ''}</small></footer>
  </div>;

  if (preview) return <div className="k-page k-create k-create--focus">
    {confirmation}
    <button type="button" className="k-back-link" onClick={() => void leavePreview()} disabled={busy}><Icon name="back" size={15} /> 下書きを残して戻る</button>
    <header className="k-create-focus-head"><div><p className="k-studio-kicker">{preview.filename} · {drafts.length}件</p><h1 className="k-page-title">取り込み内容を確認</h1><p className="k-page-sub">保存する前に、名前や挨拶などを整えられます。</p></div></header>
    <div className="k-create-storage" role="note"><Icon name={cloud ? 'lock' : 'library'} size={15} /><span>保存先：{storageLabel}{cloud ? ' · アカウント内で共有 · 全年齢の内容' : ''}</span><span>{draftSaved ? '一時下書き：このブラウザーに保存済み' : '一時下書き：未保存'}</span></div>
    {banners}
    <section aria-label="取り込みプレビュー" className="k-create-stack">
      {drafts.map((draft, index) => <Card key={index}>
        <label className="k-create-check"><input type="checkbox" checked={draft.selected} onChange={e => updateDraft(index, { selected: e.target.checked })} /> <strong>{draft.document.name || '名前未設定'}</strong>を取り込む<span className="k-badge">{kindLabel[draft.document.kind]}</span></label>
        <fieldset disabled={busy || !draft.selected}>
          {!!draft.document.source.remote && <div><ImportSource value={draft.document.source.remote} />
            {(draft.document.source.remote as { content_rating?: string }).content_rating === 'unknown' && <label className="k-create-field">内容区分（未判定）<select aria-label={`内容区分 ${index + 1}`} value={draft.rating ?? ''} onChange={e => updateDraft(index, { rating: e.target.value as Draft['rating'] })}><option value="">内容を確認して選択</option><option value="sfw">全年齢</option>{!cloud && <option value="nsfw">成人向け</option>}</select></label>}
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
    <div className="k-create-savebar"><span className="k-create-savebar__hint">{hasInvalid ? '入力内容・保存先・内容区分を確認してください' : `${drafts.filter(d => d.selected).length}件を${storageLabel}に保存します`}</span><Button variant="ghost" disabled={busy} onClick={() => void leavePreview()}>戻る</Button><Button disabled={busy || hasInvalid || !drafts.some(d => d.selected)} onClick={() => void commit()}>{busy ? '保存中…' : '選択した内容を保存'}</Button></div>
  </div>;

  return <div className="k-page k-create">
    <div className="k-page-head"><div><p className="k-studio-kicker">マイライブラリ</p><h1 className="k-page-title">クリエイト</h1><p className="k-page-sub">キャラクターと世界を、ひとつのプロットに。</p></div>
      <Button onClick={() => setChooserOpen(true)}><Icon name="plus" size={16} /> 新しく作る</Button></div>
    {banners}
    <div className="k-create-storage" role="note"><Icon name={cloud ? 'lock' : 'library'} size={15} /><span>ライブラリの保存先：{storageLabel}{cloud ? ' · アカウント内で共有 · 全年齢の内容' : ''}</span><Link to="/create/settings">ペルソナ・世界観の設定</Link></div>
    <section className="k-create-start" aria-labelledby="k-create-start-title"><div><h2 id="k-create-start-title">物語をはじめよう</h2><p>プロット・設定集・生成プリセットを、自分の言葉で作れます。</p></div><Button variant="secondary" onClick={() => setChooserOpen(true)}><Icon name="plus" size={16} /> 作るものを選ぶ</Button></section>
    {lastPreview && <div className="k-create-resume"><div><strong>取り込みの一時下書きがあります</strong><p>保存前の内容を続きから確認できます。取り込みの有効期限が切れた場合は、原本を再度読み込んでください。</p></div><Button variant="secondary" size="sm" onClick={() => setQuery({ preview: lastPreview }, { replace: true })}>下書きを再開</Button></div>}
    <section id="k-create-import-section" className="k-section" aria-label="取り込む">
      <h2 className="k-section__title"><span className="k-section__mark">✦</span> プロット・設定集を取り込む</h2>
      <div className="k-create-import">
        <div className={`k-create-drop ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); importFile(e.dataTransfer.files[0]); }}>
          <span className="k-create-drop__icon" aria-hidden="true"><Icon name="upload" size={26} /></span>
          <h3>ファイルから取り込む</h3>
          <p>Character Card / SillyTavern / Backyard AI / RisuAI</p>
          <label className={`k-btn k-btn--primary k-btn--md k-create-file ${busy ? 'is-disabled' : ''}`}>{busy ? '読み込み中…' : 'ファイルを選ぶ'}<input aria-label="取り込むファイル" type="file" accept=".json,.png,.apng,.charx,.byaf,.zip,.txt" disabled={busy} onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <small>ドラッグ＆ドロップにも対応 · JSON・PNG・CHARX・BYAF・テキスト（最大32 MiB）</small>
        </div>
          {administrative ? <Card className="k-create-url">
            <UrlImportBox onPreview={receive} disabled={busy} onBusyChange={setBusy} />
          </Card> : <Card className="k-create-url"><p>この端末ではファイルやテキストから取り込めます。URLからの取得はサーバー側のPCで行ってください。</p></Card>}
      </div>
      <div className="k-create-more">
        <details open={query.get('import') === 'characterai' || undefined}><summary>Character.AIの設定や世界の知識を貼り付ける</summary>
          <div className="k-create-more__body"><p>名前・説明・挨拶・Definitionの原文を貼り付けて確認できます。</p>
            <Textarea aria-label="移行する設定テキスト" rows={8} value={text} placeholder={'Name: キャラの名前\nDescription: 説明\nGreeting: 最初の挨拶\nDefinition: 定義の原文'} onChange={e => setText(e.target.value)} />
            <Button disabled={busy || !text.trim()} onClick={() => void run(async () => receive(await previewText(text)))}>貼り付け内容を確認</Button></div>
        </details>
        {administrative && !cloud && <details><summary>外部Hubサイトを開く</summary><div className="k-create-more__body"><HubLinks /></div></details>}
      </div>
    </section>

    <section className="k-section" aria-label="マイライブラリ">
      <div className="k-section__head"><h2 className="k-section__title"><span className="k-section__mark">✦</span> マイライブラリ <span className="k-count">{items.length}件</span></h2>
        {adult && <label className="k-create-check k-create-check--sm"><input type="checkbox" checked={includeNsfw} onChange={e => setIncludeNsfw(e.target.checked)} /> 成人向けも表示</label>}</div>
      {items.length === 0 ? <EmptyState mascot="wink" title="最初のプロットを作ろう" description="「新しく作る」から作成するか、お気に入りのキャラクターカードを取り込めます。" action={<Button variant="secondary" onClick={() => setChooserOpen(true)}><Icon name="plus" size={15} /> 新しく作る</Button>} />
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

    <Dialog open={chooserOpen} onClose={() => setChooserOpen(false)} labelledBy="k-create-chooser-title" contentClassName="k-create-chooser" overlayClassName="k-dialog-overlay k-create-chooser-overlay">
      <div className="k-create-chooser__handle" aria-hidden="true" />
      <div className="k-create-chooser__head"><h2 id="k-create-chooser-title">何を作りますか？</h2><Button variant="ghost" size="sm" aria-label="作成メニューを閉じる" onClick={() => setChooserOpen(false)}><Icon name="close" size={18} /></Button></div>
      <div className="k-create-chooser__options">{creationOptions.map(option => {
        let saved = false;
        try { saved = draftOwnerKnown && !!sessionStorage.getItem(storageKey('editor', `new-${option.kind}`)); } catch { /* Creation remains available when browser storage is disabled. */ }
        return <button key={option.kind} type="button" className={`k-create-choice${option.kind === 'character' ? ' k-create-choice--primary' : ''}`} onClick={() => openEditor('new', option.kind)}><span className="k-create-choice__icon"><Icon name={option.icon} size={22} /></span><span><strong>{option.title}</strong><small>{option.description}</small>{saved && <span className="k-create-choice__draft">一時下書きから再開</span>}</span><Icon name="chevron" size={18} /></button>;
      })}</div>
      <button type="button" className="k-create-choice k-create-choice--import" onClick={() => { setChooserOpen(false); window.document.getElementById('k-create-import-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span className="k-create-choice__icon"><Icon name="upload" size={22} /></span><span><strong>ファイル・テキストから取り込む</strong><small>手元のキャラクターカードや設定を読み込みます。</small></span><Icon name="chevron" size={18} /></button>
    </Dialog>

    <Dialog open={!!exportItem} onClose={() => setExportItem(null)} labelledBy="k-export-title" wide>
      {exportItem && <div className="k-confirm">
        <h2 id="k-export-title" className="k-confirm__title">{exportItem.document.name}を書き出す</h2>
        <p className="k-confirm__desc">ほかのアプリで使える形式でファイルに保存します。形式によっては一部の設定が引き継がれません。</p>
        <label className="k-create-field">形式<select aria-label="書き出し形式" value={format} onChange={e => setFormat(e.target.value)}>{formats.filter(f => f !== 'original' || exportItem.original_id).map(f => <option key={f} value={f}>{formatLabel[f] ?? f}</option>)}</select></label>
        {exportInfo ? <>{exportInfo.notices.length > 0 && <ul className="k-create-notices">{exportInfo.notices.map((n, i) => <li key={i}>{n.path}：{n.reason}</li>)}</ul>}
          <div className="k-confirm__actions"><Button variant="ghost" onClick={() => setExportItem(null)}>閉じる</Button><RuntimeDownload className="k-btn k-btn--primary k-btn--md" href={`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}&download=true`} download><Icon name="download" size={15} /> {exportInfo.filename}</RuntimeDownload></div></>
          : <div className="k-confirm__actions"><Button variant="ghost" onClick={() => setExportItem(null)}>閉じる</Button><Button disabled={busy} onClick={() => void run(async () => setExportInfo(await libraryRequest(`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}`)))}>{busy ? '確認中…' : '書き出し内容を確認'}</Button></div>}
        {error && <p className="k-inline-error" role="alert">{error}</p>}
      </div>}
    </Dialog>
  </div>;
}
