import { useEffect, useState } from 'react';
import { fetchLibrary, LibraryBindingSchema, type LibraryBinding, type LibraryItem } from '../lib/library';
import Button from './ui/Button';
import { fetchModels, type ModelInfo } from '../lib/api';

export default function PortableSessionControls({ value, characterId, character, allowNsfw, onChange, onTemperature }: { value: LibraryBinding | null; characterId: string | null; character: LibraryItem | null; allowNsfw: boolean; onChange: (b: LibraryBinding) => void; onTemperature: (n: number) => void }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffect(() => { let active = true; fetchModels().then(x => { if (active) setModels(x); }).catch(() => {}); return () => { active = false; }; }, []);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; fetchLibrary(allowNsfw).then(x => { if (active) setItems(x); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [allowNsfw]);
  const binding = value ?? LibraryBindingSchema.parse({});
  const set = (patch: Partial<LibraryBinding>) => onChange({ ...binding, ...patch });
  const latest = items.find(i => i.id === characterId);
  const profiles = items.filter(i => i.document.kind === 'profile');
  const modelHint = (profiles.find(i => i.id === binding.profile?.id)?.document ?? character?.document)?.profile.model_hint ?? '';
  const normalizedHint = modelHint.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidates = normalizedHint.length >= 3 ? models.filter(m => [m.id, m.display_name, m.provider_model].some(v => v.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedHint))) : [];
  const selectProfile = (id: string) => { const item = profiles.find(i => i.id === id); set({ profile: item ? { id, revision: item.revision } : null }); const temp = item?.document.profile.settings.temperature ?? character?.document.profile.settings.temperature; if (typeof temp === 'number') onTemperature(temp); };
  return <div style={{ display: 'grid', gap: 16, fontSize: 13 }}>
    {error && <p role="alert">{error}</p>}
    <p>この会話に使うプリセットと知識を選べます。変更は自動保存されます。</p>
    {modelHint && <p>元のモデル：{modelHint}<br />登録モデルの候補：{candidates.map(m => m.display_name).join('、') || '一致なし'}。使用するモデルは設定画面で選べます。</p>}
    <label>生成プリセット<select aria-label="会話の生成プリセット" style={{ display: 'block', width: '100%', marginTop: 8 }} value={binding.profile?.id ?? ''} onChange={e => selectProfile(e.target.value)}><option value="">キャラの設定を使う</option>{binding.profile && !profiles.some(i => i.id === binding.profile?.id) && <option value={binding.profile.id}>選択済み（表示対象外）</option>}{profiles.map(i => <option value={i.id} key={i.id}>{i.document.name}</option>)}</select></label>
    {binding.profile && <p>選択中の版：{binding.profile.revision}<Button variant="ghost" size="sm" onClick={() => selectProfile(binding.profile!.id)}>プリセットを最新版に切り替える</Button></p>}
    <fieldset style={{ border: 0, padding: 0 }}><legend>Lorebook</legend>{items.filter(i => i.document.kind === 'lorebook').map(i => { const current = binding.lorebooks.find(ref => ref.id === i.id); return <div key={i.id}><label style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" checked={Boolean(current)} onChange={e => set({ lorebooks: e.target.checked ? [...binding.lorebooks, { id: i.id, revision: i.revision }] : binding.lorebooks.filter(r => r.id !== i.id) })} /> {i.document.name}{current && `（版${current.revision}）`}</label>{current && current.revision !== i.revision && <Button variant="ghost" size="sm" onClick={() => set({ lorebooks: binding.lorebooks.map(r => r.id === i.id ? { id: i.id, revision: i.revision } : r) })}>このLoreを最新版に切り替える</Button>}</div>; })}</fieldset>
    {character && <><label>表情<select aria-label="表情" value={binding.expression_asset_id ?? ''} style={{ display: 'block', width: '100%', marginTop: 8 }} onChange={e => set({ expression_asset_id: e.target.value || null })}><option value="">基本のアイコン</option>{character.document.assets.filter(a => a.asset_id && ['emotion', 'icon'].includes(a.type)).map((a, i) => <option value={a.asset_id!} key={i}>{a.name}</option>)}</select></label><p>キャラの版：{character.revision}</p>{latest && latest.revision !== character.revision && <Button variant="secondary" onClick={() => set({ character: { id: latest.id, revision: latest.revision }, expression_asset_id: null })}>キャラを最新版に切り替える（版{latest.revision}）</Button>}</>}
  </div>;
}
