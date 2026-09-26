import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import { Input, Textarea } from "../components/ui/Input";
import { labRequest, type CreatorDocument, type CreatorItem, type CreatorKind } from "../lib/lab";
import { useDocumentTitle } from "../lib/title";
import "./lab.css";

const empty = (): CreatorDocument => ({ display_name: "", description: "", traits: "", rules: "" });
const label = { persona: "ペルソナ", world: "世界観" };

export default function CreatorSettings() {
  useDocumentTitle("ペルソナ・世界観");
  const [kind, setKind] = useState<CreatorKind>("persona");
  const [items, setItems] = useState<CreatorItem[]>([]);
  const [selected, setSelected] = useState<CreatorItem | null>(null);
  const [versions, setVersions] = useState<CreatorItem[]>([]);
  const [draft, setDraft] = useState<CreatorDocument>(empty);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
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
    const x = detail.item;
    setDraft({ display_name: x.display_name, description: x.description, traits: x.traits, rules: x.rules });
  });
  const save = () => run(async () => {
    const item = await labRequest<CreatorItem>(`creator/${kind}${selected ? `/${selected.id}` : ""}`, {
      method: selected ? "PUT" : "POST", body: JSON.stringify(draft)
    });
    setSelected(item);
    setItems((await labRequest<{ items: CreatorItem[] }>(`creator/${kind}`)).items);
    setVersions((await labRequest<{ versions: CreatorItem[] }>(`creator/${kind}/${item.id}`)).versions);
    setNotice("保存しました。チャットの「会話の設定」で選べます。既存の会話は選択済みの版を使います。");
  });
  const importFile = (file?: File) => run(async () => {
    if (!file) return;
    if (file.size > 100_000) throw new Error("100KB以下の設定ファイルを選んでください。");
    const value = JSON.parse(await file.text());
    if (value.format !== "kyalulu-creator" || value.version !== 1 || value.kind !== kind) throw new Error(`${label[kind]}のKyalulu設定ファイルを選んでください。`);
    const d = value.document;
    if (!d || ["display_name", "description", "traits", "rules"].some(k => typeof d[k] !== "string")) throw new Error("設定ファイルの形式が正しくありません。");
    setSelected(null); setVersions([]); setDraft({ display_name: d.display_name, description: d.description, traits: d.traits, rules: d.rules });
    setNotice("内容を読み込みました。確認して保存してください。");
  });
  return <div className="k-page k-lab">
    <header><Link to="/create">← クリエイト</Link><h1 className="k-page-title">ペルソナ・世界観</h1>
      <p className="k-page-sub">会話に登場するあなたの人物像と、物語の舞台を作れます。</p></header>
    <div className="k-lab-actions" role="group" aria-label="設定の種類">
      {(["persona", "world"] as const).map(k => <Button key={k} disabled={busy} aria-pressed={kind === k} variant={kind === k ? "primary" : "secondary"} onClick={() => setKind(k)}>{label[k]}</Button>)}
    </div>
    {error && <p role="alert" className="k-lab-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="k-lab-columns">
      <Card><h2>保存した{label[kind]}</h2>
        <Button disabled={busy} onClick={() => { setSelected(null); setVersions([]); setDraft(empty()); setNotice(""); }}>新しく作る</Button>
        <ul className="k-lab-list">{items.map(x => <li key={x.id}><button disabled={busy} aria-pressed={selected?.id === x.id} onClick={() => void choose(x)}>{x.display_name} <small>版{x.revision}</small></button></li>)}</ul>
        {!items.length && <p className="k-page-sub">まだ保存した設定はありません。</p>}
      </Card>
      <Card><form className="k-lab-form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <h2>{selected ? `${selected.display_name} · 版${selected.revision}` : `新しい${label[kind]}`}</h2>
        <label>名前<Input required disabled={busy} maxLength={120} value={draft.display_name} onChange={e => setDraft({ ...draft, display_name: e.target.value })} /></label>
        <label>{kind === "persona" ? "人物紹介" : "舞台の紹介"}<Textarea disabled={busy} rows={4} maxLength={4000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <label>{kind === "persona" ? "性格・大切にしていること" : "世界のルール"}<Textarea disabled={busy} rows={5} maxLength={6000} value={kind === "persona" ? draft.traits : draft.rules} onChange={e => setDraft({ ...draft, [kind === "persona" ? "traits" : "rules"]: e.target.value })} /></label>
        <div className="k-lab-actions"><Button type="submit" disabled={busy || !draft.display_name.trim()}>{busy ? "処理中…" : selected ? "新しい版として保存" : "保存"}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>JSONを読み込む</Button>
          {selected && <a href={`/api/creator/${kind}/${selected.id}/export`} download={`${kind}.json`}>JSONを書き出す</a>}
        </div>
        <input ref={input} type="file" accept="application/json,.json" hidden onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
        {versions.length > 1 && <details><summary>保存履歴</summary><ul className="k-lab-list">{versions.map(x => <li key={x.id}>版{x.revision} · {x.display_name} <a href={`/api/creator/${kind}/${x.id}/export`} download>書き出す</a></li>)}</ul></details>}
      </form></Card>
    </div>
  </div>;
}
