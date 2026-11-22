import { fetchPublicationQueue } from '../lib/publications';
import PublishWorkButton from '../components/PublishWorkButton';
import PublicationSubmit from '../components/PublicationSubmit';
import { useCapabilities } from '../lib/capabilities';
import { RuntimeDownload, RuntimeImage } from '../components/RuntimeMedia';
import ScenePreview from '../components/ScenePreview';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import { Textarea } from '../components/ui/Input';
import Dialog, { useConfirm } from '../components/ui/Dialog';
import Icon from '../components/ui/Icon';
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
import CloudLogin from '../components/CloudLogin';
import { fetchBrowseCatalog, isCloudGuest } from '../lib/cloudGuest';
import type { CharacterInfo } from '../lib/api';
import { fetchSessions } from '../lib/api';

type Draft = { document: PortableDocument; selected: boolean; histories: number[]; target?: LibraryItem; rating?: 'sfw' | 'nsfw'; copy?: boolean };
const formats = ['ccv3-json', 'ccv3-png', 'charx', 'ccv2-json', 'ccv2-png', 'backup', 'original'];
const statusLabels = { ja: { applied: '反映できる', converted: '変換する', preserved: '保存のみ', error: 'エラー' }, en: { applied: 'Applied', converted: 'Converted', preserved: 'Preserved only', error: 'Error' } };
const formatLabels: Record<string, [string,string]> = { 'ccv3-json': ['Character Card V3（JSON）','Character Card V3 (JSON)'], 'ccv3-png': ['Character Card V3（PNG画像）','Character Card V3 (PNG)'], charx: ['CHARX','CHARX'], 'ccv2-json': ['Character Card V2（JSON）','Character Card V2 (JSON)'], 'ccv2-png': ['Character Card V2（PNG画像）','Character Card V2 (PNG)'], backup: ['Kyaluluバックアップ','Kyalulu backup'], original: ['取り込んだ原本','Imported original'] };
const kindLabels = { ja: { character: 'プロット', profile: '生成プリセット', lorebook: '設定集' }, en: { character: 'Plot', profile: 'Generation preset', lorebook: 'Lorebook' } };
type Notice = '' | {kind:'imported';count:number} | {kind:'saved'} | {kind:'draft'} | {kind:'reviewed';revision:number};
export default function Create() {
  const guest = isCloudGuest(useRuntimeAccess());
  // An account/host change must tear down the previous owner's editor state.
  return guest ? <GuestCreate /> : <CreateWorkspace key={scopedKey('kyalulu-create')} />;
}

/** Guests see a finished example and the three things to decide; the CTA opens the login sheet (docs/MOBILE_UX_SPEC.md §5.7). */
function GuestCreate() {
  const en = useLanguage() === 'en';
  const [sample, setSample] = useState<CharacterInfo | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  useDocumentTitle(en ? 'Create' : 'つくる');
  useEffect(() => {
    let active = true;
    fetchBrowseCatalog(true).then(([c]) => { if (active) setSample(c.find(x => x.official && x.hook) ?? c[0] ?? null); }).catch(() => { /* The example is optional. */ });
    return () => { active = false; };
  }, []);
  const steps: [string, string][] = en
    ? [['Name and look', 'e.g. Butler Sion, a black-cat beastfolk'], ['One line that sets the scene', 'e.g. A black-cat butler bows to greet you amid the scent of tea'], ['The first line they say', 'e.g. Welcome home, master.']]
    : [['名前と姿', '例：シオン執事・黒猫の獣人'], ['場面の一言', '例：紅茶の香りの中、黒猫の執事が一礼してあなたを迎える'], ['最初のセリフ', '例：お帰りなさいませ、ご主人様。']];
  return <div className="k-page k-create k-create--guest">
    <h1 className="k-page-title">{en ? 'Create' : 'つくる'}</h1>
    <section className="k-create-guest" aria-labelledby="k-create-guest-title">
      <h2 id="k-create-guest-title">{en ? 'Just decide three things' : '3つ決めるだけ'}</h2>
      <p>{en ? 'Your character could become someone\'s company for the day.' : 'あなたのキャラが、誰かの「今日の一人」になるかも。'}</p>
      <ol className="k-create-steps">{steps.map(([title, example], index) => <li key={title}><span className="k-create-steps__n" aria-hidden="true">{index + 1}</span><span><strong>{title}</strong><small>{example}</small></span></li>)}</ol>
      {sample && <Link to={`/characters/${sample.id}`} className="k-create-sample">
        <span className="k-create-sample__img">{sample.portrait_url ? <RuntimeImage src={sample.portrait_url} alt="" loading="lazy" /> : <Icon name="user" size={22} />}</span>
        <span><small>{en ? 'Example' : '完成見本'}</small><strong>{sample.display_name}</strong><span>{en ? 'An official character made from these three' : 'この3つから生まれた公式キャラ'}</span></span>
      </Link>}
      <Button className="k-create-cta" onClick={() => setLoginOpen(true)}>{en ? 'Create a character' : 'キャラをつくる'}</Button>
      <button type="button" className="k-text-link" onClick={() => setLoginOpen(true)}>{en ? 'Import from a file' : 'ファイルから取り込む'}</button>
    </section>
    {loginOpen && <CloudLogin returnTo="/create?edit=new" onClose={() => setLoginOpen(false)} />}
  </div>;
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
  useDocumentTitle(en?'Create':'つくる');
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
    catch { setDraftSaved(false); setError('保存できなかった…書いた内容はこの画面に残ってるよ'); }
  }, [preview, drafts]);
  useEffect(() => {
    if (!dirty && !preview) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, !!preview]);
  // 19: how each saved character is doing, separate from the editor's load.
  const [talks, setTalks] = useState<Record<string, number>>({});
  const [published, setPublished] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    fetchSessions().then(list => { if (active) setTalks(list.reduce<Record<string, number>>((all, item) => { if (item.character_id) all[item.character_id] = (all[item.character_id] ?? 0) + 1; return all; }, {})); }).catch(() => {});
    if (cloud) fetchPublicationQueue().then(queue => { if (active) setPublished(new Set(queue.publications.flatMap(item => item.status === 'approved' && item.source.item_id ? [item.source.item_id] : []))); }).catch(() => {});
    return () => { active = false; };
  }, [cloud]);
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
  const openEditor = (id: string, kind: PortableDocument['kind'] = 'character') => { setQuery(id === 'new' ? { edit: id, kind } : { edit: id }, { replace: true }); setInvalid({}); setMessage(''); };
  const portraitOf = (doc: PortableDocument) => assetUrl(doc.assets.find(a => a.type === 'icon' && !/^(audio|video)\//.test(a.media_type))?.asset_id ?? doc.assets.find(a => a.media_type.startsWith('image/'))?.asset_id);
  const hasInvalid = preview ? drafts.some((d, i) => d.selected && (invalid[i] || (cloud && (d.document.nsfw || d.rating === 'nsfw')) || ((d.document.source.remote as { content_rating?: string } | undefined)?.content_rating === 'unknown' && !d.rating) || ((preview.duplicates[String(i)]?.length ?? 0) > 0 && !d.target && !d.copy))) : !!invalid.editor || (cloud && !!document?.nsfw);
  const banners = <>
    {error && <div className="k-create-banner k-create-banner--error" role="alert"><Icon name="info" size={16} /><span>{friendlyMessage(error,language)}</span><button type="button" onClick={() => setError('')} aria-label={en?'Close':'閉じる'}><Icon name="close" size={14} /></button></div>}
    {message && <div className="k-create-banner" role="status"><Icon name="check" size={16} /><span>{messageText}</span><button type="button" onClick={() => setMessage('')} aria-label={en?'Close':'閉じる'}><Icon name="close" size={14} /></button></div>}
    {sessions.length > 0 && <div className="k-create-migrated">{sessions.map(s => <Link key={s.session_id} to={`/chats/${s.session_id}`} className="k-chip"><Icon name="chat" size={13} /> {en?'Open migrated conversation: ':'移行した会話を開く：'}{s.name}</Link>)}</div>}
  </>;
  const exportDialog = <>
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
  </>;
  const editorHint = !document?.name.trim() ? (en?'Enter a name to enable saving':'名前を入力すると保存できます') : hasInvalid ? (en?'Check your input':'入力内容を確認してください') : dirty ? (en?`Saving to ${storageLabel} is not complete`:`${storageLabel}への保存はまだ完了していません`) : (en?'Saved to the library':'ライブラリへの保存が完了しています');

  if (document) {
    const portrait = portraitOf(document), firstLine = typeof document.data.first_mes === 'string' ? document.data.first_mes : '', hook = typeof document.data.hook === 'string' ? document.data.hook : '';
    const title = document.kind === 'character' ? (editing ? (en ? 'Edit character' : 'キャラを編集') : (en ? 'Create a character' : 'キャラをつくる')) : editing ? (en ? `Edit ${kindLabel[document.kind].toLowerCase()}` : `${kindLabel[document.kind]}を編集`) : (en ? `New ${kindLabel[document.kind].toLowerCase()}` : `新しい${kindLabel[document.kind]}`);
    return <div className="k-page k-create k-create--focus k-create-edit">
    {confirmation}
    <header className="k-create-editor-head">
      <div className="k-create-editor-head__title"><button type="button" className="k-back-link" disabled={busy} onClick={() => void closeEditor()} aria-label={en?'Back to my library':'マイライブラリに戻る'}><Icon name="back" size={20} /></button><h1 className="k-page-title">{title}{document.name && <span className="k-create-editor-head__name"> · {document.name}</span>}</h1></div>
      <div className="k-create-editor-head__actions"><span className="k-create-draft-state" role="status">{draftSaved ? (en?'Autosaved':'自動保存済み') : ''}{editing ? (en?` · Version ${editing.revision}`:` · 版${editing.revision}`) : ''}</span><Button size="sm" disabled={busy || hasInvalid || !document.name.trim()} onClick={() => void save()}>{busy ? (en?'Saving…':'保存中…') : (en?'Save':'保存')}</Button></div>
    </header>
    {banners}
    {conflict && editing && <div className="k-create-note" role="alert"><p>{en?'Another device changed this item. Your draft is retained. Review the latest version before saving.':'別の端末で変更されています。この下書きは残っています。保存前に最新版を確認してください。'}</p><Button variant="secondary" disabled={busy} onClick={() => void reviewConflict()}>{en?'Review conflicting version':'競合した版を確認'}</Button></div>}
    <div className="k-create-edit__body">
      <fieldset disabled={busy} className="k-create-edit__form"><PortableEditor library={items} chooseKind={!editing} key={`${loadedEditor}-${editing?.revision ?? 0}`} document={document} onChange={value => { setDraftSaved(false); setDocument(value); }} onValidity={valid => setInvalid(x => x.editor === !valid ? x : ({ ...x, editor: !valid }))} /></fieldset>
      {document.kind === 'character' && <aside className="k-create-edit__preview" aria-label={en?'Preview':'プレビュー'}>
        <h2 className="k-create-edit__label">{en?'Preview':'プレビュー'}</h2>
        <div className="k-create-edit__card"><label htmlFor="k-portrait-input" className="k-create-edit__art" aria-label={en?'Choose image':'画像を選ぶ'}>{portrait ? <RuntimeImage src={portrait} alt="" /> : <span className="k-create-edit__noimg"><Icon name="user" size={32} /></span>}</label><strong>{document.name || (en?'Untitled':'名前未設定')}</strong>{hook && <span>{hook}</span>}</div>
        {firstLine.trim() && <><h2 className="k-create-edit__label">{en?'How the conversation starts':'会話の始まり'}</h2><div className="k-plot-editor__preview k-create-edit__scene"><ScenePreview name={document.name || (en?'Untitled':'名前未設定')} seed={editorKey ?? 'new'} portrait={portrait} content={firstLine} /></div></>}
      </aside>}
    </div>
    <footer className="k-create-editor-footer"><p>{editorHint}</p><div className="k-create-editor-footer__links"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void closeEditor()}>{en?'Keep draft and go back':'下書きを残して戻る'}</Button>{editing?.document.kind === 'character' && <Button variant="secondary" size="sm" disabled={busy || dirty} onClick={() => navigate(`/characters/${editing.id}`)}><Icon name="chat" size={15} /> {en?'Open plot':'プロットを開く'}</Button>}{editing && <Button variant="ghost" size="sm" disabled={busy || dirty} onClick={() => setExportItem(editing)}><Icon name="download" size={13} /> {en?'Export':'書き出し'}</Button>}{editing && (capabilities?.features.publication_review?<PublicationSubmit item={editing}/>:<PublishWorkButton item={editing} enabled={!!capabilities?.features.community} />)}</div><small>{en?'Temporary drafts can resume after reload in the same account and browser.':'一時下書きは再読み込み後も同じアカウント・ブラウザーで再開できます。'}{editing ? (en?' Saving a new version keeps ongoing conversations on their original settings.':'新しい版を保存しても、進行中の会話は開始時の設定を使います。') : ''}</small></footer>
    {exportDialog}
  </div>;
  }

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

  const closeImport = () => setQuery({}, { replace: true });
  return <div className="k-page k-create">
    <h1 className="k-page-title">{en?'Create':'つくる'}</h1>
    {banners}
    {lastPreview && <div className="k-create-resume"><div><strong>{en?'A temporary import draft is available':'取り込みの一時下書きがあります'}</strong><p>{en?'Continue reviewing unsaved content. If the import expired, load the original file again.':'保存前の内容を続きから確認できます。取り込みの有効期限が切れた場合は、原本を再度読み込んでください。'}</p></div><Button variant="secondary" size="sm" onClick={() => setQuery({ preview: lastPreview }, { replace: true })}>{en?'Resume draft':'下書きを再開'}</Button></div>}
    <section className="k-create-hero" aria-labelledby="k-create-hero-title">
      <h2 id="k-create-hero-title">{en?'Create a new character':'新しいキャラをつくる'}</h2>
      <p>{en?'Start from three things: name and look, one line that sets the scene, and the first line they say.':'名前と姿・場面の一言・最初のセリフの3つから始められます。'}</p>
      <Button className="k-create-cta" onClick={() => openEditor('new', 'character')}><Icon name="plus" size={16} /> {en?'Create new':'新しくつくる'}</Button>
    </section>
    <section className="k-create-made" aria-labelledby="k-create-made-title">
      <div className="k-create-made__head"><h2 id="k-create-made-title" className="k-create-made__title" hidden={!items.length}>{en?'Your characters':'つくったキャラ'}</h2>
        {adult && <label className="k-create-check k-create-check--sm"><input type="checkbox" checked={includeNsfw} onChange={e => setIncludeNsfw(e.target.checked)} /> {en?'Include adult content':'成人向けも表示'}</label>}</div>
      {items.length > 0 && <ul className="k-create-list">{items.map(item => { const portrait = portraitOf(item.document); return <li key={item.id} className="k-lib-card">
        <button type="button" className="k-lib-card__main" onClick={() => openEditor(item.id)} aria-label={en?`Edit ${item.document.name}`:`${item.document.name}を編集`}>
          <span className="k-lib-card__avatar">{portrait ? <RuntimeImage src={portrait} alt="" loading="lazy" /> : Array.from(item.document.name || '?')[0]}</span>
          <span className="k-lib-card__who"><span className="k-lib-card__name">{item.document.name}</span><span className="k-lib-card__meta" title={en?`Version ${item.revision}`:`版${item.revision}`}>{item.document.kind === 'character' ? '' : `${kindLabel[item.document.kind]} · `}{published.has(item.id) ? (en?'Published':'公開中') : (en?'Only you':'自分だけ')}{item.document.kind === 'character' ? (en?` · ${talks[item.id] ?? 0} chats`:` · 会話 ${talks[item.id] ?? 0}`) : ''}{item.document.nsfw ? (en?' · Adult':' · 成人向け') : ''}</span></span>
          <Icon name="chevron" size={18} />
        </button>
      </li>; })}</ul>}
      <button type="button" className="k-create-list__import" onClick={() => setQuery({ import: '1' }, { replace: true })}><Icon name="upload" size={20} /><span><strong>{en?'Import from a file':'ファイルから取り込む'}</strong><small>{en?'From a character card image or JSON':'キャラカード画像やJSONから'}</small></span><Icon name="chevron" size={18} /></button>
    </section>

    <Dialog open={!!query.get('import')} onClose={closeImport} labelledBy="k-create-import-title" sheet width={520}>
      <div className="k-create-import">
        <div className="k-create-chooser__head"><h2 id="k-create-import-title">{en?'Import from a file':'ファイルから取り込む'}</h2><Button variant="ghost" size="sm" aria-label={en?'Back':'戻る'} onClick={closeImport}><Icon name="back" size={18} /></Button></div>
        <div className={`k-create-drop ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); importFile(e.dataTransfer.files[0]); }}>
          <span className="k-create-drop__icon" aria-hidden="true"><Icon name="upload" size={26} /></span>
          <label className={`k-btn k-btn--primary k-btn--md k-create-file ${busy ? 'is-disabled' : ''}`}>{busy ? (en?'Loading…':'読み込み中…') : (en?'Choose a file':'ファイルを選ぶ')}<input aria-label={en?'File to import':'取り込むファイル'} type="file" accept=".json,.png,.apng,.charx,.byaf,.zip,.txt" disabled={busy} onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <small>{en?'Character card images (PNG) and JSON · drag and drop works too':'キャラカード画像（PNG）・JSON · ドラッグ＆ドロップにも対応'}</small>
        </div>
        {administrative ? <div className="k-create-url"><p className="k-create-or">{en?'Or from a URL':'またはURLから'}</p><UrlImportBox onPreview={receive} disabled={busy} onBusyChange={setBusy} /></div>
          : <p className="k-create-or">{en?'Import files or text on this device. Retrieve URLs on the PC running the server.':'この端末ではファイルやテキストから取り込めます。URLからの取得はサーバー側のPCで行ってください。'}</p>}
        <div className="k-create-formats"><strong>{en?'Supported formats':'対応している形式'}</strong><p>SillyTavern{en?' (V2/V3 cards)':'（V2/V3カード）'}・CharacterHub・RisuAI・Backyard AI・CHARX・Kyalulu</p><p>{en?'Fields that cannot be imported are kept as original text.':'取り込めない項目も原文のまま保存します。'}</p></div>
        <div className="k-create-more">
          <details open={query.get('import') === 'characterai' || undefined}><summary>{en?'Paste Character.AI settings or world knowledge':'Character.AIの設定や世界の知識を貼り付ける'}</summary>
            <div className="k-create-more__body"><p>{en?'Paste original names, descriptions, greetings and definitions for review.':'名前・説明・挨拶・Definitionの原文を貼り付けて確認できます。'}</p>
              <Textarea aria-label={en?'Settings text to migrate':'移行する設定テキスト'} rows={8} value={text} placeholder={en?'Name: Character name\nDescription: Description\nGreeting: First greeting\nDefinition: Original definition':'Name: キャラの名前\nDescription: 説明\nGreeting: 最初の挨拶\nDefinition: 定義の原文'} onChange={e => setText(e.target.value)} />
              <Button disabled={busy || !text.trim()} onClick={() => void run(async () => receive(await previewText(text)))}>{en?'Review pasted content':'貼り付け内容を確認'}</Button></div>
          </details>
          {administrative && !cloud && <details><summary>{en?'Open external Hub sites':'外部Hubサイトを開く'}</summary><div className="k-create-more__body"><HubLinks /></div></details>}
        </div>
        {error && <p className="k-inline-error" role="alert">{friendlyMessage(error,language)}</p>}
      </div>
    </Dialog>

    {exportDialog}
  </div>;
}
