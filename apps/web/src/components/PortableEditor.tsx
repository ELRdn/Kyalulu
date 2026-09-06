import { useEffect, useRef, useState } from 'react';
import Button from './ui/Button';
import { Input, Textarea } from './ui/Input';
import { uploadAsset, assetUrl, type PortableDocument, type LibraryItem } from '../lib/library';

function JsonField({ label, value, onChange, onValidity }: { label: string; value: unknown; onChange: (v: any) => void; onValidity: (ok: boolean) => void }) {
  const [error, setError] = useState('');
  const [raw, setRaw] = useState(JSON.stringify(value, null, 2));
  const lastValue = useRef(JSON.stringify(value));
  useEffect(() => { const current = JSON.stringify(value); if (current !== lastValue.current) { lastValue.current = current; setRaw(JSON.stringify(value, null, 2)); setError(''); onValidity(true); } }, [value, onValidity]);
  return <label className="k-create-field">{label}<Textarea aria-label={label} rows={6} value={raw} onChange={e => {
    setRaw(e.target.value);
    try { const v = JSON.parse(e.target.value); if (!v || typeof v !== 'object' || Array.isArray(v) !== Array.isArray(value)) throw new Error('形式を確認してください'); lastValue.current = JSON.stringify(v); onChange(v); setError(''); onValidity(true); }
    catch { setError('JSONの形式を確認してください。修正するまで保存できません。'); onValidity(false); }
  }} />{error && <span role="alert">{error}</span>}</label>;
}

export default function PortableEditor({ document: doc, onChange, onValidity, library = [] }: { document: PortableDocument; onChange: (d: PortableDocument) => void; onValidity: (valid: boolean) => void; library?: LibraryItem[] }) {
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [assetError, setAssetError] = useState('');
  const [uploading, setUploading] = useState(false);
  const validityRef = useRef(onValidity); validityRef.current = onValidity;
  const valid = Boolean(doc.name.trim()) && !Object.values(errors).some(Boolean) && !uploading;
  useEffect(() => validityRef.current(valid), [valid]);
  const set = (patch: Partial<PortableDocument>) => onChange({ ...doc, ...patch });
  const data = (key: string, value: unknown) => set({ data: { ...doc.data, [key]: value } });
  const text = (key: string) => typeof doc.data[key] === 'string' ? doc.data[key] as string : '';
  const field = (key: string, label: string, rows = 4) => <label key={key} className="k-create-field">{label}<Textarea aria-label={label} rows={rows} value={text(key)} onChange={e => data(key, e.target.value)} /></label>;
  const book = (doc.data.character_book ?? {}) as Record<string, any>;
  const entries: Record<string, any>[] = Array.isArray(book.entries) ? book.entries : Object.values(book.entries ?? {});
  const setBook = (patch: Record<string, unknown>) => data('character_book', { ...book, ...patch });
  const setEntry = (index: number, patch: Record<string, unknown>) => setBook({ entries: entries.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
  const greetings = Array.isArray(doc.data.alternate_greetings) ? doc.data.alternate_greetings as string[] : [];
  const invalid = (key: string) => (ok: boolean) => setErrors(x => ({ ...x, [key]: !ok }));
  return <div className="k-portable-editor">
    <div className="k-create-grid"><label className="k-create-field">名前<Input aria-label="名前" value={doc.name} onChange={e => set({ name: e.target.value })} required /></label><label className="k-create-field">種類<select value={doc.kind} onChange={e => set({ kind: e.target.value as PortableDocument['kind'] })}><option value="character">キャラクター</option><option value="profile">生成プリセット</option><option value="lorebook">Lorebook</option></select></label></div>
    <label><input type="checkbox" checked={doc.nsfw} onChange={e => set({ nsfw: e.target.checked })} /> 成人向けの内容を含む</label>
    {doc.kind === 'character' && <>
      {field('description', '説明', 6)}
      {('definition' in doc.data) && field('definition', 'Definition（原文）', 8)}
      <div className="k-create-grid">{field('personality', '性格')}<label className="k-create-field">文体・話し方<Textarea aria-label="文体・話し方" rows={4} value={doc.speaking_style} onChange={e => set({ speaking_style: e.target.value })} /></label></div>
      {field('scenario', 'シナリオ・世界観')}{field('first_mes', '最初の挨拶')}
      <details><summary>ほかの挨拶候補（{greetings.length}件）</summary>{greetings.map((g, index) => <div key={index}><label className="k-create-field">挨拶候補 {index + 1}<Textarea rows={3} value={g} onChange={e => data('alternate_greetings', greetings.map((v, i) => i === index ? e.target.value : v))} /></label><Button variant="ghost" size="sm" onClick={() => data('alternate_greetings', greetings.filter((_, i) => i !== index))}>この候補を削除</Button></div>)}<Button variant="secondary" size="sm" onClick={() => data('alternate_greetings', [...greetings, ''])}>挨拶候補を追加</Button></details>
      {field('mes_example', '会話例')}
      <details><summary>作者情報とキャラの指示</summary>{field('creator', '作者', 1)}{field('creator_notes', '作者コメント（AIへは送信しません）')}{field('system_prompt', 'キャラのシステム指示')}{field('post_history_instructions', '履歴の後に置く指示')}</details>
    </>}
    {doc.kind !== 'profile' && <details open={doc.kind === 'lorebook'}><summary>Lorebook · 世界の知識（{entries.length}件）</summary>
      <div className="k-create-grid"><label className="k-create-field">参照するメッセージ数<Input type="number" min={0} max={1000} value={book.scan_depth ?? 2} onChange={e => setBook({ scan_depth: Number(e.target.value) })} /></label><label className="k-create-field">予算（推定トークン）<Input type="number" min={0} value={book.token_budget ?? 1024} onChange={e => setBook({ token_budget: Number(e.target.value) })} /></label></div>
      <label><input type="checkbox" checked={Boolean(book.recursive_scanning)} onChange={e => setBook({ recursive_scanning: e.target.checked })} /> 採用した知識から関連する知識も探す</label>
      {entries.map((entry, index) => <div key={index} className="k-lore-entry"><div className="k-create-actions"><label><input type="checkbox" checked={entry.enabled !== false} onChange={e => setEntry(index, { enabled: e.target.checked })} /> 有効</label><label><input type="checkbox" checked={Boolean(entry.constant)} onChange={e => setEntry(index, { constant: e.target.checked })} /> 常に使用</label><Button variant="ghost" size="sm" onClick={() => setBook({ entries: entries.filter((_, i) => i !== index) })}>項目を削除</Button></div>
        <label className="k-create-field">項目名<Input value={entry.name ?? entry.comment ?? ''} onChange={e => setEntry(index, { name: e.target.value, comment: e.target.value })} /></label>
        <label className="k-create-field">キーワード（カンマ区切り）<Input value={(entry.keys ?? []).join(', ')} onChange={e => setEntry(index, { keys: e.target.value.split(',').map(s => s.trim()) })} /></label>
        <label className="k-create-field">知識の本文<Textarea rows={4} value={entry.content ?? ''} onChange={e => setEntry(index, { content: e.target.value })} /></label>
        <details><summary>採用条件と順序</summary><label><input type="checkbox" checked={Boolean(entry.case_sensitive)} onChange={e => setEntry(index, { case_sensitive: e.target.checked })} /> 大文字・小文字を区別</label><label className="k-create-field"><span><input type="checkbox" checked={Boolean(entry.selective)} onChange={e => setEntry(index, { selective: e.target.checked })} /> 補助キーワードも必要</span><Input value={(entry.secondary_keys ?? []).join(', ')} onChange={e => setEntry(index, { secondary_keys: e.target.value.split(',').map(s => s.trim()) })} /></label><label className="k-create-field">順序<Input type="number" value={entry.insertion_order ?? index} onChange={e => setEntry(index, { insertion_order: Number(e.target.value) })} /></label><label className="k-create-field">位置<select value={entry.position ?? 'after_char'} onChange={e => setEntry(index, { position: e.target.value })}><option value="before_char">キャラ設定の前</option><option value="after_char">キャラ設定の後</option></select></label></details>
      </div>)}
      <Button variant="secondary" size="sm" onClick={() => setBook({ entries: [...entries, { keys: [], content: '', enabled: true, insertion_order: entries.length, extensions: {} }] })}>知識を追加</Button>
    </details>}
    {doc.kind !== 'lorebook' && <details open={doc.kind === 'profile'}><summary>生成プリセットと詳細な設定</summary>
      <p>対応する設定だけをモデルに渡します。実際の適用結果はチャットのDebugで確認できます。</p>
      {doc.kind === 'character' && <label className="k-create-field">保存したプリセットを適用<select aria-label="保存したプリセットを適用" value="" onChange={e => {
        const item = library.find(i => i.id === e.target.value); if (!item) return;
        set({ profile: structuredClone(item.document.profile), nsfw: doc.nsfw || item.document.nsfw,
          data: { ...doc.data, attached_profile: { id: item.id, revision: item.revision, name: item.document.name }, attached_profile_lore: item.document.data.character_book ?? null },
          notices: [...doc.notices, ...item.document.notices] });
      }}><option value="">この版の設定をキャラへコピー…</option>{library.filter(i => i.document.kind === 'profile').map(i => <option key={i.id} value={i.id}>{i.document.name}（版{i.revision}）</option>)}</select><small>コピー後も編集できます。元のプリセットを更新しても自動変更されません。</small></label>}
      {doc.profile.model_hint && <p>元のモデル名：{doc.profile.model_hint}（モデル選択で対応するものを選んでください）</p>}
      <label className="k-create-field">プリセットのシステム指示<Textarea rows={4} value={doc.profile.system_prompt} onChange={e => set({ profile: { ...doc.profile, system_prompt: e.target.value } })} /></label>
      <label className="k-create-field">プリセットの履歴後指示<Textarea rows={3} value={doc.profile.post_history_instructions} onChange={e => set({ profile: { ...doc.profile, post_history_instructions: e.target.value } })} /></label>
      <label className="k-create-field">Contextの本文テンプレート<Textarea rows={4} value={doc.profile.context_template} onChange={e => set({ profile: { ...doc.profile, context_template: e.target.value } })} /></label>
      <JsonField label="生成パラメータ（JSON）" value={doc.profile.settings} onChange={v => set({ profile: { ...doc.profile, settings: v } })} onValidity={invalid('settings')} />
      <JsonField label="プロンプトの順序（JSON）" value={doc.profile.prompts} onChange={v => set({ profile: { ...doc.profile, prompts: v } })} onValidity={invalid('prompts')} />
    </details>}
    {doc.kind === 'character' && <details open={doc.assets.length > 0}><summary>画像・表情・背景（{doc.assets.length}件）</summary><div className="k-create-assets">{doc.assets.map((a, i) => <figure key={i}>{a.asset_id ? <img src={assetUrl(a.asset_id)} alt={a.name} /> : <p>外部参照（自動取得しません）<br />{a.uri}</p>}<figcaption><Input aria-label={`画像名 ${i + 1}`} value={a.name} onChange={e => set({ assets: doc.assets.map((v, j) => j === i ? { ...v, name: e.target.value } : v) })} /><select aria-label={`画像の用途 ${i + 1}`} value={a.type} onChange={e => set({ assets: doc.assets.map((v, j) => j === i ? { ...v, type: e.target.value } : v) })}><option value="icon">アイコン</option><option value="emotion">表情</option><option value="background">背景</option>{!['icon', 'emotion', 'background'].includes(a.type) && <option>{a.type}</option>}</select><Button variant="ghost" size="sm" onClick={() => set({ assets: doc.assets.filter((_, j) => j !== i) })}>画像を外す</Button></figcaption></figure>)}</div>
      <label className="k-create-field">画像を追加<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={uploading} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; setUploading(true); setAssetError(''); try { const asset = await uploadAsset(file); set({ assets: [...doc.assets, asset] }); } catch (error) { setAssetError(String(error)); } finally { setUploading(false); } }} /></label>{assetError && <p role="alert">{assetError}</p>}
    </details>}
  </div>;
}
