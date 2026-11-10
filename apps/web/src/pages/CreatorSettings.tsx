import { RuntimeDownload } from '../components/RuntimeMedia';
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/ui/Icon";
import Switch from "../components/ui/Switch";
import { useConfirm } from "../components/ui/Dialog";
import { defaultPersona, setDefaultPersona } from "../lib/session";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { Input, Textarea } from "../components/ui/Input";
import { labRequest, type CreatorDocument, type CreatorItem, type CreatorKind } from "../lib/lab";
import { useDocumentTitle } from "../lib/title";
import "./lab.css";
import "./pages.css";
import StorySettingsEditor from '../components/StorySettingsEditor';
import { CastMemberSchema, RPGOptionsSchema } from '../../../../packages/schemas/src';
import { friendlyMessage } from '../lib/errors';
import { useLanguage } from '../lib/appContext';

const empty = (): CreatorDocument => ({ display_name: "", call_name: "", description: "", traits: "", rules: "" });
const labels = { ja: { persona: '人物像', world: '世界観' }, en: { persona: 'Persona', world: 'World' } };

export default function CreatorSettings() {
  const language=useLanguage(),en=language==='en',label=labels[language];
  useDocumentTitle(en?'Personas and worlds':'人物像・世界観');
  const [kind, setKind] = useState<CreatorKind>("persona");
  const [items, setItems] = useState<CreatorItem[]>([]);
  const [selected, setSelected] = useState<CreatorItem | null>(null);
  const [versions, setVersions] = useState<CreatorItem[]>([]);
  const [draft, setDraft] = useState<CreatorDocument>(empty);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<'saved'|'imported'|''>('');
  const [busy, setBusy] = useState(false);
  const [storyValid, setStoryValid] = useState(true);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const loadGeneration = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const [usual, setUsual] = useState(defaultPersona);
  const [confirmDialog, confirm] = useConfirm();
  useEffect(() => {
    const generation = ++loadGeneration.current;
    setItems([]); setSelected(null); setVersions([]); setDraft(empty()); setNotice(""); setError(""); setEditing(false);
    labRequest<{ items: CreatorItem[] }>(`creator/${kind}`).then(x => {
      if (generation === loadGeneration.current) setItems(x.items);
    }).catch(e => { if (generation === loadGeneration.current) setError(String(e)); });
    return () => { loadGeneration.current++; };
  }, [kind]);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const choose = (item: CreatorItem) => run(async () => {
    const detail = await labRequest<{ item: CreatorItem; versions: CreatorItem[] }>(`creator/${kind}/${item.id}`);
    setSelected(detail.item); setVersions(detail.versions);
    setEditorEpoch(value => value + 1);
    const x = detail.item;
    setDraft({ display_name: x.display_name, call_name: x.call_name ?? '', description: x.description, traits: x.traits, rules: x.rules, cast: x.cast ?? [], rpg: x.rpg ?? null });
  });
  const save = () => run(async () => {
    if (kind === 'world' && !storyValid) throw Error('登場人物・RPGルールを確認してください。');
    const item = await labRequest<CreatorItem>(`creator/${kind}${selected ? `/${selected.id}` : ""}`, {
      method: selected ? "PUT" : "POST", body: JSON.stringify(draft)
    });
    setSelected(item);
    setItems((await labRequest<{ items: CreatorItem[] }>(`creator/${kind}`)).items);
    setVersions((await labRequest<{ versions: CreatorItem[] }>(`creator/${kind}/${item.id}`)).versions);
    setNotice('saved');
  });
  const importFile = (file?: File) => run(async () => {
    if (!file) return;
    if (file.size > 100_000) throw new Error("100KB以下の設定ファイルを選んでください。");
    const value = JSON.parse(await file.text());
    if (value.format !== "kyalulu-creator" || value.version !== 1 || value.kind !== kind) throw new Error(`${labels.ja[kind]}のKyalulu設定ファイルを選んでください。`);
    const d = value.document;
    if (!d || ["display_name", "description", "traits", "rules"].some(k => typeof d[k] !== "string")) throw new Error("設定ファイルの形式が正しくありません。");
    const cast = Array.isArray(d.cast) ? d.cast.map((member: unknown) => CastMemberSchema.parse(member)) : [];
    const rpg = d.rpg ? RPGOptionsSchema.parse(d.rpg) : null;
    if (cast.length > 12) throw Error('登場人物は12人までです。');
    setSelected(null); setVersions([]); setDraft({ display_name: d.display_name, call_name: typeof d.call_name === 'string' ? d.call_name : '', description: d.description, traits: d.traits, rules: d.rules, cast, rpg });
    setEditorEpoch(value => value + 1);
    setNotice('imported');
  });
  const assetOf = (item: CreatorItem) => item.asset_id ?? item.id.split('@')[0];
  const toggleUsual = (on: boolean) => { const next = on && selected ? assetOf(selected) : null; setDefaultPersona(next); setUsual(next); };
  const remove = async () => {
    if (!selected || !await confirm({ danger: true, confirmLabel: en ? 'Delete' : '削除', cancelLabel: en ? 'Cancel' : 'やめる',
      title: en ? `Delete this ${kind}?` : `この${label[kind]}を削除しますか？`,
      description: en ? 'It disappears from your list. Conversations that use it can continue as they are.' : '一覧から消えます。使っている会話は、そのまま続けられます。' })) return;
    await run(async () => {
      await labRequest(`creator/${kind}/${selected.id}`, { method: 'DELETE' });
      if (usual === assetOf(selected)) toggleUsual(false);
      setItems(items.filter(x => assetOf(x) !== assetOf(selected))); setSelected(null); setVersions([]); setDraft(empty()); setEditing(false);
    });
  };
  const startNew = () => { setSelected(null); setVersions([]); setDraft(empty()); setNotice(""); setEditorEpoch(value => value + 1); setEditing(true); };
  // 31: the saved list; 31b: one persona or world. With nothing saved yet the editor opens directly.
  const editorOpen = editing || selected !== null || items.length === 0;
  const back = () => editorOpen && items.length ? (setSelected(null), setVersions([]), setEditing(false)) : (window.history.length > 1 ? navigate(-1) : navigate('/profile'));
  const tabs = <div className="k-seg" role="group" aria-label={en?'Setting type':'設定の種類'}>
    {(["persona", "world"] as const).map(k => <button key={k} type="button" disabled={busy} aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'persona' ? (en ? 'Your persona' : 'あなたの人物像') : label.world}</button>)}
  </div>;
  const title = !editorOpen ? (en?'Personas and worlds':'人物像・世界観')
    : selected ? (en ? `Edit ${kind}` : `${label[kind]}の編集`) : (en ? `New ${kind}` : `新しい${label[kind]}`);
  const compact = selected !== null && kind === 'persona';
  const traits = <label>{kind === "persona" ? (en?'Personality and values':'性格・大切にしていること') : (en?'World rules':'世界のルール')}<Textarea disabled={busy} rows={5} maxLength={6000} value={kind === "persona" ? draft.traits : draft.rules} onChange={e => setDraft({ ...draft, [kind === "persona" ? "traits" : "rules"]: e.target.value })} /></label>;
  const fileTools = <>
    <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{en?'Load JSON':'JSONを読み込む'}</Button>
    {selected && <RuntimeDownload href={`/api/creator/${kind}/${selected.id}/export`} download={`${kind}.json`}>{en?'Export JSON':'JSONを書き出す'}</RuntimeDownload>}
  </>;
  return <div className="k-page k-me-sub k-lab">
    {confirmDialog}
    <header className="k-me-sub__head">
      <button type="button" className="k-me-sub__back" aria-label={en ? 'Back' : '戻る'} onClick={back}><Icon name="back" size={22} /></button>
      <h1>{title}</h1>
      {editorOpen && <Button type="submit" form="k-lab-form" size="sm" className="k-lab-head-save" disabled={busy || !draft.display_name.trim() || kind === 'world' && !storyValid}>{busy ? (en?'Working…':'処理中…') : (en?'Save':'保存')}</Button>}
    </header>
    {!editing && selected === null && tabs}
    {error && <p role="alert" className="k-lab-error">{friendlyMessage(error,language)}</p>}
    {notice && <p role="status" className="k-lab-notice">{notice==='saved'?(en?'Saved. Select it in the chat’s conversation settings. Existing conversations keep their selected version.':'保存しました。チャットの「会話の設定」で選べます。既存の会話は選択済みの版を使います。'):(en?'Loaded for review. Check the content and save it explicitly.':'内容を読み込みました。確認して保存してください。')}</p>}
    {!editorOpen ? <>
      <p className="k-lab-hint">{kind === 'persona' ? (en ? 'How characters know you in a conversation. Switch it in the conversation settings.' : '会話でキャラがあなたをどう知っているか。会話設定から切り替えられます。') : (en ? 'The stage for your conversations. Switch it in the conversation settings.' : '会話の舞台になる世界です。会話設定から切り替えられます。')}</p>
      <section className="k-set" aria-label={label[kind]}>
        <div className="k-set__group">{items.map(x => <button key={x.id} type="button" className="k-set-row k-lab-row" disabled={busy} onClick={() => { setEditing(true); void choose(x); }}>
          <span className="k-lab-row__avatar" aria-hidden="true">{[...x.display_name][0]}</span>
          <span className="k-set-row__text"><span className="k-set-row__label">{x.display_name} {kind === 'persona' && usual === assetOf(x) && <span className="k-lab-badge">{en ? 'Default' : 'いつもの'}</span>}</span>{x.description && <span className="k-set-row__sub">{x.description}</span>}</span>
          <Icon name="chevron" size={16} className="k-set-row__chev" />
        </button>)}</div>
      </section>
      <Button variant="secondary" className="k-lab-new" disabled={busy} onClick={startNew}><Icon name="plus" size={16} /> {kind === 'persona' ? (en ? 'Create a persona' : '人物像を作る') : (en ? 'Create a world' : '世界観を作る')}</Button>
    </> : <form id="k-lab-form" className="k-lab-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label><span>{en?'Name':'名前'}<small className="k-lab-req">{en?'Required':'必須'}</small></span><Input required disabled={busy} maxLength={120} value={draft.display_name} onChange={e => setDraft({ ...draft, display_name: e.target.value })} /></label>
      {kind === 'persona' && <label>{en ? 'What characters call you' : 'キャラからの呼ばれ方'}<Input disabled={busy} maxLength={60} placeholder={en ? 'e.g. Master (the character\'s own setting wins)' : '例：ご主人様（キャラの設定が優先）'} value={draft.call_name ?? ''} onChange={e => setDraft({ ...draft, call_name: e.target.value })} /></label>}
      <label>{kind === "persona" ? (en?'Persona':'人物像') : (en?'Setting introduction':'舞台の紹介')}<Textarea disabled={busy} rows={4} maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      {!compact && traits}
      {kind === 'world' && <StorySettingsEditor key={`${selected?.id ?? 'new-world'}:${editorEpoch}`} cast={draft.cast ?? []} rpg={draft.rpg ?? null} disabled={busy} onValidity={setStoryValid} onChange={(cast, rpg) => setDraft({ ...draft, cast, rpg })} />}
      {!compact && <div className="k-lab-actions"><Button type="submit" disabled={busy || !draft.display_name.trim() || kind === 'world' && !storyValid}>{busy ? (en?'Working…':'処理中…') : selected ? (en?'Save as a new version':'新しい版として保存') : (en?'Save':'保存')}</Button>
        {fileTools}
      </div>}
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
      {selected && kind === 'persona' && <section className="k-set" aria-label={en ? 'Default' : '既定'}><div className="k-set__group">
        <div className="k-set-row"><span className="k-set-row__text"><span className="k-set-row__label">{en ? 'Use as my default persona' : 'いつもの人物像にする'}</span><span className="k-set-row__sub">{en ? 'Chosen first in new conversations on this device' : '新しい会話で最初に選ばれます（この端末）'}</span></span>
          <Switch checked={usual === assetOf(selected)} onChange={toggleUsual} label={en ? 'Use as my default persona' : 'いつもの人物像にする'} disabled={busy} /></div></div></section>}
      {selected && <section className="k-set" aria-label={en ? 'Delete' : '削除'}><div className="k-set__group">
        <button type="button" className="k-set-row k-lab-danger" disabled={busy} onClick={() => void remove()}><span className="k-set-row__label">{en ? `Delete this ${kind}` : `この${label[kind]}を削除`}</span></button></div></section>}
      {compact && <details className="k-lab-more"><summary>{en ? 'More settings' : 'そのほかの設定'}</summary>{traits}<div className="k-lab-actions">{fileTools}</div></details>}
      {versions.length > 1 && <details><summary>{en?'Version history':'保存履歴'}</summary><ul className="k-lab-list">{versions.map(x => <li key={x.id}>{en?'Version ':'版'}{x.revision} · {x.display_name} <RuntimeDownload href={`/api/creator/${kind}/${x.id}/export`} download={`${kind}.json`}>{en?'Export':'書き出す'}</RuntimeDownload></li>)}</ul></details>}
    </form>}
  </div>;
}
