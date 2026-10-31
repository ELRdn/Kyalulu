import PublishWorkButton from '../components/PublishWorkButton';
import PublicationSubmit from '../components/PublicationSubmit';
import { useCapabilities } from '../lib/capabilities';
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
import { useLanguage } from '../lib/appContext';

type Draft = { document: PortableDocument; selected: boolean; histories: number[]; target?: LibraryItem; rating?: 'sfw' | 'nsfw'; copy?: boolean };
const formats = ['ccv3-json', 'ccv3-png', 'charx', 'ccv2-json', 'ccv2-png', 'backup', 'original'];
const statusLabels = { ja: { applied: '反映できる', converted: '変換する', preserved: '保存のみ', error: 'エラー' }, en: { applied: 'Applied', converted: 'Converted', preserved: 'Preserved only', error: 'Error' } };
const formatLabels: Record<string, [string,string]> = { 'ccv3-json': ['Character Card V3（JSON）','Character Card V3 (JSON)'], 'ccv3-png': ['Character Card V3（PNG画像）','Character Card V3 (PNG)'], charx: ['CHARX','CHARX'], 'ccv2-json': ['Character Card V2（JSON）','Character Card V2 (JSON)'], 'ccv2-png': ['Character Card V2（PNG画像）','Character Card V2 (PNG)'], backup: ['Kyaluluバックアップ','Kyalulu backup'], original: ['取り込んだ原本','Imported original'] };
const kindLabels = { ja: { character: 'プロット', profile: '生成プリセット', lorebook: '設定集' }, en: { character: 'Plot', profile: 'Generation preset', lorebook: 'Lorebook' } };
type Notice = '' | {kind:'imported';count:number} | {kind:'saved'} | {kind:'draft'} | {kind:'reviewed';revision:number};
const creationOptions = [
  { kind: 'character', icon: 'sparkle', title: ['プロットを作る','Create a plot'], description: ['キャラクターと世界観、会話のはじまりを設定します。','Set up characters, a world and the opening scene.'] },
  { kind: 'lorebook', icon: 'book', title: ['設定集を作る','Create a lorebook'], description: ['世界の知識をキーワードと一緒にまとめます。','Organize world knowledge with keywords.'] },
  { kind: 'profile', icon: 'settings', title: ['生成プリセットを作る','Create a generation preset'], description: ['文体や生成パラメーターをまとめて保存します。','Save writing style and generation settings together.'] },
] as const;

export default function Create() {
  useRuntimeAccess();
  // An account/host change must tear down the previous owner's editor state.
  return <CreateWorkspace key={scopedKey('kyalulu-create')} />;
}

function CreateWorkspace() {
  const language=useLanguage(),en=language==='en',kindLabel=kindLabels[language],statusLabel=statusLabels[language];
  const countItems=(value:number)=>en?`${value} item${value===1?'':'s'}`:`${value}件`;
  const { capabilities } = useCapabilities();
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
  const [error, setError] = useState<Error|string>('');
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<Notice>('');
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
  const storageLabel = cloud ? (en?'this account':'このアカウント') : remote ? (en?'the connected PC':'接続先のPC') : (en?'this device':'この端末');
  const messageText=!message?'':message.kind==='imported'?(en?`Saved ${countItems(message.count)} to ${storageLabel}. Open a plot to start a conversation.`:`${message.count}件を${storageLabel}に保存しました。プロットを開いて会話を始められます。`)
    :message.kind==='saved'?(en?`Saved to ${storageLabel}. Existing conversations keep the settings they started with.`:`${storageLabel}に保存しました。これまでの会話は、はじめた時点の設定のまま続きます。`)
    :message.kind==='draft'?(en?'A temporary draft was saved in this browser. Use Save to store it in your library.':'一時下書きをこのブラウザーに保存しました。ライブラリへの保存は「保存」ボタンで行います。')
    :(en?`Reviewed version ${message.revision}. Use Save as a new version to save this draft.`:`版${message.revision}を確認しました。「新しい版として保存」でこの下書きを保存できます。`);
  useDocumentTitle(en?'Create':'クリエイト');
  useEffect(() => { if (!adult) setIncludeNsfw(false); }, [adult]);
  // 編集・確認モードへ切り替わったら画面の先頭から見せる（下に追加されて気づけない問題の対策）
  useEffect(() => { window.document.getElementById('main')?.scrollTo({ top: 0, behavior: 'smooth' }); }, [!!previewId, query.get('edit')]);
  const refresh = async () => { const value = await fetchLibrary(includeNsfw); if (currentScope()) setItems(value); };
  useEffect(() => { let active = true; fetchLibrary(includeNsfw).then(x => { if (active && currentScope()) setItems(x); }).catch(e => { if (active && currentScope()) setError(e instanceof Error?e:String(e)); }); return () => { active = false; }; }, [includeNsfw]);
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
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error?e:String(e)); });
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
  const run = async (work: () => Promise<void>) => { if (busy || !currentScope()) return; setBusy(true); setError(''); setMessage(''); try { await work(); } catch (e) { if (currentScope()) setError(e instanceof Error?e:String(e)); } finally { if (currentScope()) setBusy(false); } };
  const receive = (value: ImportPreview) => { if (!currentScope()) return; setPreview(value); setDrafts(value.documents.map(d => ({ document: d, selected: true, histories: [] }))); setDraftSaved(false); setDocument(null); setEditing(undefined); setInvalid({}); pending.current = null; setQuery({ preview: value.preview_id }, { replace: true }); };
  const clearPreview = (remove = false) => {
    if (remove && preview) {
      try { sessionStorage.removeItem(storageKey('preview', preview.preview_id)); sessionStorage.removeItem(`${draftPrefix}:last-preview`); } catch { /* A completed import can still be retried with its original request ID. */ }
      setLastPreview(null);
    }
    setPreview(null); setDrafts([]); setInvalid({}); pending.current = null; setQuery({}, { replace: true });
  };
  const leavePreview = async () => {
    if (busy || !preview || !await confirm({ title: en?'Leave import review?':'取り込みの確認を中断しますか？', description: en?'Your input stays as a temporary draft in this browser. It has not been saved to the library yet.':'入力した内容は、このブラウザーの一時下書きに残します。ライブラリへの保存はまだ完了していません。', confirmLabel: en?'Keep draft and go back':'下書きを残して戻る', cancelLabel: en?'Continue editing':'編集を続ける' })) return;
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
    await refresh(); if (currentScope()) setMessage({kind:'imported',count:result.items.length});
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
        throw new Error(`${String(error)} この下書きと保存IDは残っています。内容を変えずに再保存すると同じ保存IDで結果を確認します。内容を変える前にライブラリの保存結果を確認してください。`);
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
    await refresh(); if (currentScope()) setMessage({kind:'saved'});
  });
  const reviewConflict = () => run(async () => {
    if (!editing || !document) return;
    const latest = await fetchLibraryItem(editing.id);
    if (!currentScope()) return;
    if (!await confirm({ title: en?'Review the version saved on another device':'別の端末で保存された版を確認',
      description: <><p>{en?`Review saved version ${latest.revision} and this draft. Continuing lets the next save create a new version from this draft. Past versions are kept.`:`保存済みの版${latest.revision}とこの下書きを確認してください。続けると、次の保存でこの下書きを新しい版として保存します。過去の版は残ります。`}</p>{[[en?'Latest saved version':'保存済みの最新版', latest.document], [en?'This draft':'この下書き', document]].map(([label, value]) => <details key={String(label)}><summary>{String(label)}</summary><pre style={{maxHeight:240,overflow:'auto',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(value, null, 2)}</pre></details>)}</>,
      confirmLabel: en?'Continue editing this draft':'この下書きで編集を続ける', cancelLabel: en?'Return to draft':'下書きに戻る' })) return;
    if (!currentScope()) return;
    setEditing(latest); setConflict(false);
    setMessage({kind:'reviewed',revision:latest.revision});
  });
  const closeEditor = async () => {
    if (busy) return;
    if (dirty && !await confirm({ title: en?'Keep this unsaved draft and go back?':'保存前の下書きを残して戻りますか？', description: en?`Saving to ${storageLabel} is not complete. A temporary draft stays in this browser and resumes when you reopen this item.`:`${storageLabel}への保存はまだ完了していません。一時下書きはこのブラウザーに残り、同じ項目を開くと再開できます。`, confirmLabel: en?'Keep draft and go back':'下書きを残して戻る', cancelLabel: en?'Continue editing':'編集を続ける' })) return;
    if (!persistEditor()) return;
    setDocument(null); setEditing(undefined); setLoadedEditor(null); setInvalid({}); setQuery({}, { replace: true });
    void refresh().catch(error => { if (currentScope()) setError(error instanceof Error?error:String(error)); });
  };
  const openEditor = (id: string, kind: PortableDocument['kind'] = 'character') => { setChooserOpen(false); setQuery(id === 'new' ? { edit: id, kind } : { edit: id }, { replace: true }); setInvalid({}); setMessage(''); };
  const portraitOf = (item: LibraryItem) => assetUrl(item.document.assets.find(a => a.type === 'icon')?.asset_id ?? item.document.assets[0]?.asset_id);
  const hasInvalid = preview ? drafts.some((d, i) => d.selected && (invalid[i] || (cloud && (d.document.nsfw || d.rating === 'nsfw')) || ((d.document.source.remote as { content_rating?: string } | undefined)?.content_rating === 'unknown' && !d.rating) || ((preview.duplicates[String(i)]?.length ?? 0) > 0 && !d.target && !d.copy))) : !!invalid.editor || (cloud && !!document?.nsfw);
  const banners = <>
    {error && <div className="k-create-banner k-create-banner--error" role="alert"><Icon name="info" size={16} /><span>{friendlyMessage(error,language)}</span><button type="button" onClick={() => setError('')} aria-label={en?'Close':'閉じる'}><Icon name="close" size={14} /></button></div>}
    {message && <div className="k-create-banner" role="status"><Icon name="check" size={16} /><span>{messageText}</span><button type="button" onClick={() => setMessage('')} aria-label={en?'Close':'閉じる'}><Icon name="close" size={14} /></button></div>}
    {sessions.length > 0 && <div className="k-create-migrated">{sessions.map(s => <Link key={s.session_id} to={`/chats/${s.session_id}`} className="k-chip"><Icon name="chat" size={13} /> {en?'Open migrated conversation: ':'移行した会話を開く：'}{s.name}</Link>)}</div>}
  </>;
  const editorHint = !document?.name.trim() ? (en?'Enter a name to enable saving':'名前を入力すると保存できます') : hasInvalid ? (en?'Check your input':'入力内容を確認してください') : dirty ? (en?`Saving to ${storageLabel} is not complete`:`${storageLabel}への保存はまだ完了していません`) : (en?'Saved to the library':'ライブラリへの保存が完了しています');

  if (document) return <div className="k-page k-create k-create--focus">
    {confirmation}
    <header className="k-create-editor-head">
      <div className="k-create-editor-head__title"><button type="button" className="k-back-link" disabled={busy} onClick={() => void closeEditor()} aria-label={en?'Back to my library':'マイライブラリに戻る'}><Icon name="back" size={20} /></button><div><p className="k-studio-kicker">{kindLabel[document.kind]}{editing ? (en?` · Version ${editing.revision}`:` · 版${editing.revision}`) : (en?' · New':' · 新規作成')}</p><h1 className="k-page-title">{document.name || (en?`New ${kindLabel[document.kind].toLowerCase()}`:`新しい${kindLabel[document.kind]}`)}</h1></div></div>
      <div className="k-create-editor-head__actions"><Button variant="secondary" size="sm" disabled={busy} onClick={() => { if (persistEditor()) setMessage({kind:'draft'}); }}>{en?'Save temporary draft':'一時下書きを保存'}</Button><Button size="sm" disabled={busy || hasInvalid || !document.name.trim()} onClick={() => void save()}>{busy ? (en?'Saving…':'保存中…') : editing ? (en?'Save as a new version':'新しい版として保存') : (en?'Save':'保存')}</Button></div>
    </header>
    <div className="k-create-storage" role="note"><Icon name={cloud ? 'lock' : 'library'} size={15} /><span>{en?'Save to: ':'保存先：'}{storageLabel}{cloud ? (en?' · Shared within your account · General content':' · アカウント内で共有 · 全年齢の内容') : ''}</span><span className="k-create-draft-state">{draftSaved ? (en?'Temporary draft saved in this browser':'一時下書き：このブラウザーに保存済み') : (en?'Temporary draft not saved':'一時下書き：未保存')}</span></div>
    {banners}
    {conflict && editing && <div className="k-create-note" role="alert"><p>{en?'Another device changed this item. Your draft is retained. Review the latest version before saving.':'別の端末で変更されています。この下書きは残っています。保存前に最新版を確認してください。'}</p><Button variant="secondary" disabled={busy} onClick={() => void reviewConflict()}>{en?'Review conflicting version':'競合した版を確認'}</Button></div>}
    <Card className="k-create-editor-card"><fieldset disabled={busy}><PortableEditor library={items} key={`${loadedEditor}-${editing?.revision ?? 0}`} document={document} onChange={value => { setDraftSaved(false); setDocument(value); }} onValidity={valid => setInvalid(x => x.editor === !valid ? x : ({ ...x, editor: !valid }))} /></fieldset></Card>
    <footer className="k-create-editor-footer"><p>{editorHint}</p><div className="k-create-editor-footer__links"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void closeEditor()}>{en?'Keep draft and go back':'下書きを残して戻る'}</Button>{editing?.document.kind === 'character' && <Button variant="secondary" size="sm" disabled={busy || dirty} onClick={() => navigate(`/characters/${editing.id}`)}><Icon name="chat" size={15} /> {en?'Open plot':'プロットを開く'}</Button>}</div><small>{en?'Temporary drafts can resume after reload in the same account and browser.':'一時下書きは再読み込み後も同じアカウント・ブラウザーで再開できます。'}{editing ? (en?' Saving a new version keeps ongoing conversations on their original settings.':'新しい版を保存しても、進行中の会話は開始時の設定を使います。') : ''}</small></footer>
  </div>;

  if (preview) return <div className="k-page k-create k-create--focus">
    {confirmation}
    <button type="button" className="k-back-link" onClick={() => void leavePreview()} disabled={busy}><Icon name="back" size={15} /> {en?'Keep draft and go back':'下書きを残して戻る'}</button>
    <header className="k-create-focus-head"><div><p className="k-studio-kicker">{preview.filename} · {countItems(drafts.length)}</p><h1 className="k-page-title">{en?'Review import':'取り込み内容を確認'}</h1><p className="k-page-sub">{en?'Adjust names, greetings and other fields before saving.':'保存する前に、名前や挨拶などを整えられます。'}</p></div></header>
    <div className="k-create-storage" role="note"><Icon name={cloud ? 'lock' : 'library'} size={15} /><span>{en?'Save to: ':'保存先：'}{storageLabel}{cloud ? (en?' · Shared within your account · General content':' · アカウント内で共有 · 全年齢の内容') : ''}</span><span>{draftSaved ? (en?'Temporary draft saved in this browser':'一時下書き：このブラウザーに保存済み') : (en?'Temporary draft not saved':'一時下書き：未保存')}</span></div>
    {banners}
    <section aria-label={en?'Import preview':'取り込みプレビュー'} className="k-create-stack">
      {drafts.map((draft, index) => <Card key={index}>
        <label className="k-create-check"><input type="checkbox" checked={draft.selected} onChange={e => updateDraft(index, { selected: e.target.checked })} /> {en?'Import ':''}<strong>{draft.document.name || (en?'Unnamed':'名前未設定')}</strong>{en?'':'を取り込む'}<span className="k-badge">{kindLabel[draft.document.kind]}</span></label>
        <fieldset disabled={busy || !draft.selected}>
          {!!draft.document.source.remote && <div><ImportSource value={draft.document.source.remote} />
            {(draft.document.source.remote as { content_rating?: string }).content_rating === 'unknown' && <label className="k-create-field">{en?'Content rating (unclassified)':'内容区分（未判定）'}<select aria-label={en?`Content rating ${index + 1}`:`内容区分 ${index + 1}`} value={draft.rating ?? ''} onChange={e => updateDraft(index, { rating: e.target.value as Draft['rating'] })}><option value="">{en?'Review content and choose':'内容を確認して選択'}</option><option value="sfw">{en?'General':'全年齢'}</option>{!cloud && <option value="nsfw">{en?'Adult':'成人向け'}</option>}</select></label>}
          </div>}
          {(preview.duplicates[String(index)]?.length ?? 0) > 0 && <div className="k-create-note"><p>{en?'This original was already imported.':'同じ原本を取り込み済みです。'}</p>{preview.duplicates[String(index)].map(item => <p key={item.id}><Link to={`/create?edit=${item.id}`}>{en?`Open ${item.name} (version ${item.revision})`:`${item.name}（版${item.revision}）を開く`}</Link></p>)}<label className="k-create-check"><input type="checkbox" checked={draft.copy ?? false} onChange={e => updateDraft(index, { copy: e.target.checked })} /> {en?'Duplicate as a new item':'新しい項目として複製する'}</label><p>{en?'Or choose an existing destination item to update it.':'または、保存先で既存の項目を選んで更新できます。'}</p></div>}
          <label className="k-create-field">{en?'Destination':'保存先'}<select aria-label={en?`Destination ${index + 1}`:`保存先 ${index + 1}`} value={draft.target?.id ?? ''} onChange={e => updateDraft(index, { target: items.find(i => i.id === e.target.value) })}><option value="">{en?'Create a new item':'新しい項目として作成'}</option>{items.filter(i => i.document.kind === draft.document.kind).map(i => <option key={i.id} value={i.id}>{en?`Update ${i.document.name} (version ${i.revision})`:`${i.document.name}を更新（版${i.revision}）`}</option>)}</select></label>
          <PortableEditor library={items} key={`${preview.preview_id}-${index}`} document={draft.document} onChange={d => updateDraft(index, { document: d })} onValidity={valid => setInvalid(x => x[index] === !valid ? x : ({ ...x, [index]: !valid }))} />
          {draft.document.histories.length > 0 && <section><h3>{en?'Conversations to migrate':'移行する会話'}</h3><p>{en?'Selected conversations are saved as separate sessions.':'選択した会話を別セッションに保存します。'}</p>{draft.document.histories.map((h, j) => <label className="k-create-check" key={j}><input type="checkbox" checked={draft.histories.includes(j)} onChange={e => updateDraft(index, { histories: e.target.checked ? [...draft.histories, j] : draft.histories.filter(n => n !== j) })} /> {h.name}{en?` (${h.messages.length} message${h.messages.length===1?'':'s'})`:`（${h.messages.length}メッセージ）`}</label>)}</section>}
          {draft.document.notices.length > 0 && <details><summary>{en?`Conversion and unsupported fields (${countItems(draft.document.notices.length)})`:`変換結果と未対応項目（${draft.document.notices.length}件）`}</summary><ul className="k-create-notices">{draft.document.notices.map((n, j) => <li key={j}><strong>{statusLabel[n.status]}</strong> · {n.path}：{n.reason}</li>)}</ul></details>}
          <details><summary>{en?'Review original text and settings':'原文・元の設定を確認'}</summary><pre>{JSON.stringify(draft.document.source, null, 2)}</pre></details>
        </fieldset>
      </Card>)}
    </section>
    <div className="k-create-savebar"><span className="k-create-savebar__hint">{hasInvalid ? (en?'Check input, destination and content rating':'入力内容・保存先・内容区分を確認してください') : (en?`Save ${countItems(drafts.filter(d => d.selected).length)} to ${storageLabel}`:`${drafts.filter(d => d.selected).length}件を${storageLabel}に保存します`)}</span><Button variant="ghost" disabled={busy} onClick={() => void leavePreview()}>{en?'Back':'戻る'}</Button><Button disabled={busy || hasInvalid || !drafts.some(d => d.selected)} onClick={() => void commit()}>{busy ? (en?'Saving…':'保存中…') : (en?'Save selected content':'選択した内容を保存')}</Button></div>
  </div>;

  return <div className="k-page k-create">
    <div className="k-page-head"><div><p className="k-studio-kicker">{en?'My library':'マイライブラリ'}</p><h1 className="k-page-title">{en?'Create':'クリエイト'}</h1><p className="k-page-sub">{en?'Bring characters and worlds together in a plot.':'キャラクターと世界を、ひとつのプロットに。'}</p></div>
      <Button onClick={() => setChooserOpen(true)}><Icon name="plus" size={16} /> {en?'Create new':'新しく作る'}</Button></div>
    {banners}
    <div className="k-create-storage" role="note"><Icon name={cloud ? 'lock' : 'library'} size={15} /><span>{en?'Library location: ':'ライブラリの保存先：'}{storageLabel}{cloud ? (en?' · Shared within your account · General content':' · アカウント内で共有 · 全年齢の内容') : ''}</span><Link to="/create/settings">{en?'Persona and world settings':'ペルソナ・世界観の設定'}</Link></div>
    <section className="k-create-start" aria-labelledby="k-create-start-title"><div><h2 id="k-create-start-title">{en?'Start a story':'物語をはじめよう'}</h2><p>{en?'Create plots, lorebooks and generation presets in your own words.':'プロット・設定集・生成プリセットを、自分の言葉で作れます。'}</p></div><Button variant="secondary" onClick={() => setChooserOpen(true)}><Icon name="plus" size={16} /> {en?'Choose what to create':'作るものを選ぶ'}</Button></section>
    {lastPreview && <div className="k-create-resume"><div><strong>{en?'A temporary import draft is available':'取り込みの一時下書きがあります'}</strong><p>{en?'Continue reviewing unsaved content. If the import expired, load the original file again.':'保存前の内容を続きから確認できます。取り込みの有効期限が切れた場合は、原本を再度読み込んでください。'}</p></div><Button variant="secondary" size="sm" onClick={() => setQuery({ preview: lastPreview }, { replace: true })}>{en?'Resume draft':'下書きを再開'}</Button></div>}
    <section id="k-create-import-section" className="k-section" aria-label={en?'Import':'取り込む'}>
      <h2 className="k-section__title"><span className="k-section__mark">✦</span> {en?'Import plots and lorebooks':'プロット・設定集を取り込む'}</h2>
      <div className="k-create-import">
        <div className={`k-create-drop ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); importFile(e.dataTransfer.files[0]); }}>
          <span className="k-create-drop__icon" aria-hidden="true"><Icon name="upload" size={26} /></span>
          <h3>{en?'Import a file':'ファイルから取り込む'}</h3>
          <p>Character Card / SillyTavern / Backyard AI / RisuAI</p>
          <label className={`k-btn k-btn--primary k-btn--md k-create-file ${busy ? 'is-disabled' : ''}`}>{busy ? (en?'Loading…':'読み込み中…') : (en?'Choose a file':'ファイルを選ぶ')}<input aria-label={en?'File to import':'取り込むファイル'} type="file" accept=".json,.png,.apng,.charx,.byaf,.zip,.txt" disabled={busy} onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <small>{en?'Drag and drop supported · JSON, PNG, CHARX, BYAF, text (up to 32 MiB)':'ドラッグ＆ドロップにも対応 · JSON・PNG・CHARX・BYAF・テキスト（最大32 MiB）'}</small>
        </div>
          {administrative ? <Card className="k-create-url">
            <UrlImportBox onPreview={receive} disabled={busy} onBusyChange={setBusy} />
          </Card> : <Card className="k-create-url"><p>{en?'Import files or text on this device. Retrieve URLs on the PC running the server.':'この端末ではファイルやテキストから取り込めます。URLからの取得はサーバー側のPCで行ってください。'}</p></Card>}
      </div>
      <div className="k-create-more">
        <details open={query.get('import') === 'characterai' || undefined}><summary>{en?'Paste Character.AI settings or world knowledge':'Character.AIの設定や世界の知識を貼り付ける'}</summary>
          <div className="k-create-more__body"><p>{en?'Paste original names, descriptions, greetings and definitions for review.':'名前・説明・挨拶・Definitionの原文を貼り付けて確認できます。'}</p>
            <Textarea aria-label={en?'Settings text to migrate':'移行する設定テキスト'} rows={8} value={text} placeholder={en?'Name: Character name\nDescription: Description\nGreeting: First greeting\nDefinition: Original definition':'Name: キャラの名前\nDescription: 説明\nGreeting: 最初の挨拶\nDefinition: 定義の原文'} onChange={e => setText(e.target.value)} />
            <Button disabled={busy || !text.trim()} onClick={() => void run(async () => receive(await previewText(text)))}>{en?'Review pasted content':'貼り付け内容を確認'}</Button></div>
        </details>
        {administrative && !cloud && <details><summary>{en?'Open external Hub sites':'外部Hubサイトを開く'}</summary><div className="k-create-more__body"><HubLinks /></div></details>}
      </div>
    </section>

    <section className="k-section" aria-label={en?'My library':'マイライブラリ'}>
      <div className="k-section__head"><h2 className="k-section__title"><span className="k-section__mark">✦</span> {en?'My library':'マイライブラリ'} <span className="k-count">{countItems(items.length)}</span></h2>
        {adult && <label className="k-create-check k-create-check--sm"><input type="checkbox" checked={includeNsfw} onChange={e => setIncludeNsfw(e.target.checked)} /> {en?'Include adult content':'成人向けも表示'}</label>}</div>
      {items.length === 0 ? <EmptyState mascot="wink" title={en?'Create your first plot':'最初のプロットを作ろう'} description={en?'Choose Create new, or import a favorite character card.':'「新しく作る」から作成するか、お気に入りのキャラクターカードを取り込めます。'} action={<Button variant="secondary" onClick={() => setChooserOpen(true)}><Icon name="plus" size={15} /> {en?'Create new':'新しく作る'}</Button>} />
        : <div className="k-create-library">{items.map(item => <article key={item.id} className="k-lib-card">
          <button type="button" className="k-lib-card__main" onClick={() => openEditor(item.id)} aria-label={en?`Edit ${item.document.name}`:`${item.document.name}を編集`}>
            <Avatar name={item.document.name} seed={item.id} size="lg" src={portraitOf(item)} />
            <span className="k-lib-card__who"><span className="k-lib-card__name">{item.document.name}</span><span className="k-lib-card__meta">{kindLabel[item.document.kind]} · {en?'Version ':'版'}{item.revision}{item.document.nsfw ? (en?' · Adult':' · 成人向け') : ''}</span></span>
          </button>
          <div className="k-lib-card__actions">
            {item.document.kind === 'character' && <Button size="sm" onClick={() => navigate(`/characters/${item.id}`)}><Icon name="chat" size={13} /> {en?'Chat':'話す'}</Button>}
            <Button variant="secondary" size="sm" onClick={() => openEditor(item.id)}><Icon name="edit" size={13} /> {en?'Edit':'編集'}</Button>
            <Button variant="ghost" size="sm" onClick={() => setExportItem(item)}><Icon name="download" size={13} /> {en?'Export':'書き出し'}</Button>
            {capabilities?.features.publication_review?<PublicationSubmit item={item}/>:<PublishWorkButton item={item} enabled={!!capabilities?.features.community} />}
          </div>
        </article>)}</div>}
    </section>

    <Dialog open={chooserOpen} onClose={() => setChooserOpen(false)} labelledBy="k-create-chooser-title" contentClassName="k-create-chooser" overlayClassName="k-dialog-overlay k-create-chooser-overlay">
      <div className="k-create-chooser__handle" aria-hidden="true" />
      <div className="k-create-chooser__head"><h2 id="k-create-chooser-title">{en?'What would you like to create?':'何を作りますか？'}</h2><Button variant="ghost" size="sm" aria-label={en?'Close creation menu':'作成メニューを閉じる'} onClick={() => setChooserOpen(false)}><Icon name="close" size={18} /></Button></div>
      <div className="k-create-chooser__options">{creationOptions.map(option => {
        let saved = false;
        try { saved = draftOwnerKnown && !!sessionStorage.getItem(storageKey('editor', `new-${option.kind}`)); } catch { /* Creation remains available when browser storage is disabled. */ }
        return <button key={option.kind} type="button" className={`k-create-choice${option.kind === 'character' ? ' k-create-choice--primary' : ''}`} onClick={() => openEditor('new', option.kind)}><span className="k-create-choice__icon"><Icon name={option.icon} size={22} /></span><span><strong>{option.title[en?1:0]}</strong><small>{option.description[en?1:0]}</small>{saved && <span className="k-create-choice__draft">{en?'Resume temporary draft':'一時下書きから再開'}</span>}</span><Icon name="chevron" size={18} /></button>;
      })}</div>
      <button type="button" className="k-create-choice k-create-choice--import" onClick={() => { setChooserOpen(false); window.document.getElementById('k-create-import-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span className="k-create-choice__icon"><Icon name="upload" size={22} /></span><span><strong>{en?'Import files or text':'ファイル・テキストから取り込む'}</strong><small>{en?'Load your character cards or settings.':'手元のキャラクターカードや設定を読み込みます。'}</small></span><Icon name="chevron" size={18} /></button>
    </Dialog>

    <Dialog open={!!exportItem} onClose={() => setExportItem(null)} labelledBy="k-export-title" wide>
      {exportItem && <div className="k-confirm">
        <h2 id="k-export-title" className="k-confirm__title">{en?`Export ${exportItem.document.name}`:`${exportItem.document.name}を書き出す`}</h2>
        <p className="k-confirm__desc">{en?'Save a file for use in other apps. Some settings may not transfer in the selected format.':'ほかのアプリで使える形式でファイルに保存します。形式によっては一部の設定が引き継がれません。'}</p>
        <label className="k-create-field">{en?'Format':'形式'}<select aria-label={en?'Export format':'書き出し形式'} value={format} onChange={e => setFormat(e.target.value)}>{formats.filter(f => f !== 'original' || exportItem.original_id).map(f => <option key={f} value={f}>{formatLabels[f]?.[en?1:0] ?? f}</option>)}</select></label>
        {exportInfo ? <>{exportInfo.notices.length > 0 && <ul className="k-create-notices">{exportInfo.notices.map((n, i) => <li key={i}>{n.path}：{n.reason}</li>)}</ul>}
          <div className="k-confirm__actions"><Button variant="ghost" onClick={() => setExportItem(null)}>{en?'Close':'閉じる'}</Button><RuntimeDownload className="k-btn k-btn--primary k-btn--md" href={`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}&download=true`} download={exportInfo.filename}><Icon name="download" size={15} /> {exportInfo.filename}</RuntimeDownload></div></>
          : <div className="k-confirm__actions"><Button variant="ghost" onClick={() => setExportItem(null)}>{en?'Close':'閉じる'}</Button><Button disabled={busy} onClick={() => void run(async () => setExportInfo(await libraryRequest(`/api/library/${exportItem.id}/export?format=${format}&revision=${exportItem.revision}`)))}>{busy ? (en?'Checking…':'確認中…') : (en?'Review export':'書き出し内容を確認')}</Button></div>}
        {error && <p className="k-inline-error" role="alert">{friendlyMessage(error,language)}</p>}
      </div>}
    </Dialog>
  </div>;
}
