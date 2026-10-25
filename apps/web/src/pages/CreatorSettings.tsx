import { RuntimeDownload } from '../components/RuntimeMedia';
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { Input, Textarea } from "../components/ui/Input";
import { labRequest, type CreatorDocument, type CreatorItem, type CreatorKind } from "../lib/lab";
import { useDocumentTitle } from "../lib/title";
import "./lab.css";
import StorySettingsEditor from '../components/StorySettingsEditor';
import { CastMemberSchema, RPGOptionsSchema } from '../../../../packages/schemas/src';
import { friendlyMessage } from '../lib/errors';
import { useLanguage } from '../lib/appContext';

const empty = (): CreatorDocument => ({ display_name: "", description: "", traits: "", rules: "" });
const labels = { ja: { persona: 'ペルソナ', world: '世界観' }, en: { persona: 'Persona', world: 'World' } };

export default function CreatorSettings() {
  const language=useLanguage(),en=language==='en',label=labels[language];
  useDocumentTitle(en?'Personas and worlds':'ペルソナ・世界観');
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
  useEffect(() => {
    const generation = ++loadGeneration.current;
    setItems([]); setSelected(null); setVersions([]); setDraft(empty()); setNotice(""); setError("");
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
    setDraft({ display_name: x.display_name, description: x.description, traits: x.traits, rules: x.rules, cast: x.cast ?? [], rpg: x.rpg ?? null });
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
    setSelected(null); setVersions([]); setDraft({ display_name: d.display_name, description: d.description, traits: d.traits, rules: d.rules, cast, rpg });
    setEditorEpoch(value => value + 1);
    setNotice('imported');
  });
  return <div className="k-page k-lab">
    <header><Link to="/create">← {en?'Create':'クリエイト'}</Link><h1 className="k-page-title">{en?'Personas and worlds':'ペルソナ・世界観'}</h1>
      <p className="k-page-sub">{en?'Create your persona and the setting for your conversations.':'会話に登場するあなたの人物像と、物語の舞台を作れます。'}</p></header>
    <div className="k-lab-actions" role="group" aria-label={en?'Setting type':'設定の種類'}>
      {(["persona", "world"] as const).map(k => <Button key={k} disabled={busy} aria-pressed={kind === k} variant={kind === k ? "primary" : "secondary"} onClick={() => setKind(k)}>{label[k]}</Button>)}
    </div>
    {error && <p role="alert" className="k-lab-error">{friendlyMessage(error,language)}</p>}
    {notice && <p role="status">{notice==='saved'?(en?'Saved. Select it in the chat’s conversation settings. Existing conversations keep their selected version.':'保存しました。チャットの「会話の設定」で選べます。既存の会話は選択済みの版を使います。'):(en?'Loaded for review. Check the content and save it explicitly.':'内容を読み込みました。確認して保存してください。')}</p>}
    <div className="k-lab-columns">
      <Card><h2>{en?`Saved ${kind==='persona'?'personas':'worlds'}`:`保存した${label[kind]}`}</h2>
        <Button disabled={busy} onClick={() => { setSelected(null); setVersions([]); setDraft(empty()); setNotice(""); setEditorEpoch(value => value + 1); }}>{en?'Create new':'新しく作る'}</Button>
        <ul className="k-lab-list">{items.map(x => <li key={x.id}><button disabled={busy} aria-pressed={selected?.id === x.id} onClick={() => void choose(x)}>{x.display_name} <small>{en?'Version ':'版'}{x.revision}</small></button></li>)}</ul>
        {!items.length && <p className="k-page-sub">{en?'No saved settings yet.':'まだ保存した設定はありません。'}</p>}
      </Card>
      <Card><form className="k-lab-form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <h2>{selected ? `${selected.display_name} · ${en?'Version ':'版'}${selected.revision}` : (en?`New ${kind==='persona'?'persona':'world'}`:`新しい${label[kind]}`)}</h2>
        <label>{en?'Name':'名前'}<Input required disabled={busy} maxLength={120} value={draft.display_name} onChange={e => setDraft({ ...draft, display_name: e.target.value })} /></label>
        <label>{kind === "persona" ? (en?'Persona introduction':'人物紹介') : (en?'Setting introduction':'舞台の紹介')}<Textarea disabled={busy} rows={4} maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>{kind === "persona" ? (en?'Personality and values':'性格・大切にしていること') : (en?'World rules':'世界のルール')}<Textarea disabled={busy} rows={5} maxLength={6000} value={kind === "persona" ? draft.traits : draft.rules} onChange={e => setDraft({ ...draft, [kind === "persona" ? "traits" : "rules"]: e.target.value })} /></label>
        {kind === 'world' && <StorySettingsEditor key={`${selected?.id ?? 'new-world'}:${editorEpoch}`} cast={draft.cast ?? []} rpg={draft.rpg ?? null} disabled={busy} onValidity={setStoryValid} onChange={(cast, rpg) => setDraft({ ...draft, cast, rpg })} />}
        <div className="k-lab-actions"><Button type="submit" disabled={busy || !draft.display_name.trim() || kind === 'world' && !storyValid}>{busy ? (en?'Working…':'処理中…') : selected ? (en?'Save as a new version':'新しい版として保存') : (en?'Save':'保存')}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{en?'Load JSON':'JSONを読み込む'}</Button>
          {selected && <RuntimeDownload href={`/api/creator/${kind}/${selected.id}/export`} download={`${kind}.json`}>{en?'Export JSON':'JSONを書き出す'}</RuntimeDownload>}
        </div>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        {versions.length > 1 && <details><summary>{en?'Version history':'保存履歴'}</summary><ul className="k-lab-list">{versions.map(x => <li key={x.id}>{en?'Version ':'版'}{x.revision} · {x.display_name} <RuntimeDownload href={`/api/creator/${kind}/${x.id}/export`} download>{en?'Export':'書き出す'}</RuntimeDownload></li>)}</ul></details>}
      </form></Card>
    </div>
  </div>;
}
