import { useEffect, useState } from 'react';
import { fetchLibrary, LibraryBindingSchema, type LibraryBinding, type LibraryItem } from '../lib/library';
import Button from './ui/Button';
import { fetchModels, type ModelInfo } from '../lib/api';
import { useCapabilities } from '../lib/capabilities';
import { friendlyMessage } from '../lib/errors';
import './portableSessionControls.css';

export default function PortableSessionControls({ value, characterId, character, allowNsfw, onChange, onTemperature }: { value: LibraryBinding | null; characterId: string | null; character: LibraryItem | null; allowNsfw: boolean; onChange: (b: LibraryBinding) => void; onTemperature: (n: number) => void }) {
  const { capabilities } = useCapabilities();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState('');
  useEffect(() => {
    let active = true;
    fetchModels().then(x => { if (active) setModels(x); })
      .catch(e => { if (active) setModelsError(friendlyMessage(e)); })
      .finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setItems([]);
    fetchLibrary(allowNsfw).then(x => { if (active) setItems(x); })
      .catch(e => { if (active) setError(friendlyMessage(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [allowNsfw]);
  const binding = value ?? LibraryBindingSchema.parse({});
  const set = (patch: Partial<LibraryBinding>) => onChange({ ...binding, ...patch });
  const latest = items.find(i => i.id === characterId);
  const profiles = items.filter(i => i.document.kind === 'profile');
  const lorebooks = items.filter(i => i.document.kind === 'lorebook');
  const modelHint = (profiles.find(i => i.id === binding.profile?.id)?.document ?? character?.document)?.profile.model_hint ?? '';
  const normalizedHint = modelHint.toLowerCase().replace(/[^a-z0-9]/g, '');
  const candidates = normalizedHint.length >= 3 ? models.filter(m => [m.id, m.display_name, m.provider_model].some(v => v.toLowerCase().replace(/[^a-z0-9]/g, '').includes(normalizedHint))) : [];
  const selectProfile = (id: string) => { const item = profiles.find(i => i.id === id); set({ profile: item ? { id, revision: item.revision } : null }); const temp = item?.document.profile.settings.temperature ?? character?.document.profile.settings.temperature; if (typeof temp === 'number') onTemperature(temp); };
  return <div className="k-portable-session" aria-busy={loading}>
    <p>プリセットと知識を選べます。変更は自動保存されます。</p>
    {loading && <p role="status">プリセットと知識を読込中…</p>}
    {error && <p role="alert">プリセットと知識を取得できません：{error}</p>}
    {modelHint && <details className="k-portable-session__details"><summary>プリセットの推奨モデル</summary><p>元のモデル：{modelHint}<br />登録モデルの候補：{modelsLoading ? '読込中…' : modelsError ? '取得できません' : candidates.map(m => m.display_name).join('、') || '一致なし'}。会話モデルは上のモデル欄で選べます。</p>{modelsError && <p role="alert">{modelsError}</p>}</details>}
    <label>生成プリセット<select className="k-input" aria-label="会話の生成プリセット" disabled={loading || Boolean(error)} value={binding.profile?.id ?? ''} onChange={e => selectProfile(e.target.value)}><option value="">キャラの設定を使う</option>{binding.profile && !profiles.some(i => i.id === binding.profile?.id) && <option value={binding.profile.id}>選択済み（{loading ? '読込中' : error ? '一覧未取得' : '表示対象外'}・版{binding.profile.revision}）</option>}{profiles.map(i => <option value={i.id} key={i.id}>{i.document.name}</option>)}</select></label>
    {!loading && !error && profiles.length === 0 && <p role="status">追加できる生成プリセットがありません。</p>}
    {binding.profile && <p>選択中の版：{binding.profile.revision}<Button variant="ghost" size="sm" disabled={loading || Boolean(error) || !profiles.some(i => i.id === binding.profile?.id)} onClick={() => selectProfile(binding.profile!.id)}>プリセットを最新版に切り替える</Button></p>}
    <fieldset><legend>知識（Lorebook）</legend>
      {!loading && !error && lorebooks.length === 0 && <p role="status">追加できる知識がありません。</p>}
      {lorebooks.map(i => { const current = binding.lorebooks.find(ref => ref.id === i.id); return <div key={i.id}><label className="k-portable-session__lore"><input type="checkbox" checked={Boolean(current)} disabled={loading || Boolean(error)} onChange={e => set({ lorebooks: e.target.checked ? [...binding.lorebooks, { id: i.id, revision: i.revision }] : binding.lorebooks.filter(r => r.id !== i.id) })} /> {i.document.name}{current && `（版${current.revision}）`}</label>{current && current.revision !== i.revision && <Button variant="ghost" size="sm" onClick={() => set({ lorebooks: binding.lorebooks.map(r => r.id === i.id ? { id: i.id, revision: i.revision } : r) })}>このLoreを最新版に切り替える</Button>}</div>; })}
      {binding.lorebooks.filter(ref => !lorebooks.some(i => i.id === ref.id)).map(ref => <p key={ref.id}>選択済みの知識（版{ref.revision}・{loading ? '読込中' : error ? '一覧未取得' : '表示対象外'}）</p>)}
    </fieldset>
    {character && <><label>表情<select className="k-input" aria-label="表情" disabled={!capabilities?.features.media_playback} value={binding.expression_asset_id ?? ''} onChange={e => set({ expression_asset_id: e.target.value || null })}><option value="">基本のアイコン</option>{character.document.assets.filter(a => a.asset_id && ['emotion', 'icon'].includes(a.type)).map((a, i) => <option value={a.asset_id!} key={i}>{a.name}</option>)}</select></label>{!capabilities?.features.media_playback && <p>この接続先では持ち込み媒体の再生・表情切替に対応していません。</p>}<p>キャラの版：{character.revision}</p>{latest && latest.revision !== character.revision && <Button variant="secondary" onClick={() => set({ character: { id: latest.id, revision: latest.revision }, expression_asset_id: null })}>キャラを最新版に切り替える（版{latest.revision}）</Button>}</>}
  </div>;
}
