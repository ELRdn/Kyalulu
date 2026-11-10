import { useEffect, useId, useState } from 'react';
import { fetchLibrary, LibraryBindingSchema, type LibraryBinding, type LibraryItem } from '../lib/library';
import Button from './ui/Button';
import { fetchModels, type ModelInfo } from '../lib/api';
import { useCapabilities } from '../lib/capabilities';
import { friendlyMessage } from '../lib/errors';
import './portableSessionControls.css';
import { useLanguage } from '../lib/appContext';

type Option = { value: string; label: string; sub?: string };
const STYLES = {
  'style:story': { ja: 'じっくり物語', jaSub: '情景を多めに、長めの返事', en: 'Slow story', enSub: 'More scenery, longer replies', prompt: 'Describe the scene in rich detail and write longer replies.' },
  'style:tempo': { ja: 'テンポよく', jaSub: '短い返事で会話を回す', en: 'Quick pace', enSub: 'Short replies that keep things moving', prompt: 'Keep replies short and keep the conversation moving.' },
} as const;
const STYLE_IDS = Object.keys(STYLES) as (keyof typeof STYLES)[];
const withoutStyle = (prompt: string) => STYLE_IDS.reduce((text, id) => text.replace(STYLES[id].prompt, ''), prompt).trim();
/** Design 11: presets as a radio list; keeps the select-like value/onChange contract. */
function PresetList({ 'aria-label': label, value, disabled, onChange, options }: { 'aria-label': string; value: string; disabled: boolean; onChange: (event: { target: { value: string } }) => void; options: Option[] }) {
  const name = useId();
  return <div role="radiogroup" aria-label={label} className="k-preset-list">{options.map(option => <label key={option.value} className="k-preset-row">
    <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange({ target: { value: option.value } })} />
    <span><strong>{option.label}</strong>{option.sub && <small>{option.sub}</small>}</span>
  </label>)}</div>;
}

export default function PortableSessionControls({ value, characterId, character, allowNsfw, onChange, onTemperature, systemPrompt = '', onSystemPrompt }: { value: LibraryBinding | null; characterId: string | null; character: LibraryItem | null; allowNsfw: boolean; onChange: (b: LibraryBinding) => void; onTemperature: (n: number) => void; systemPrompt?: string; onSystemPrompt?: (prompt: string) => void }) {
  const language=useLanguage(),en=language==='en';
  const { capabilities } = useCapabilities();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    fetchModels().then(x => { if (active) setModels(x); })
      .catch(e => { if (active) setModelsError(e); })
      .finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, []);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setItems([]);
    fetchLibrary(allowNsfw).then(x => { if (active) setItems(x); })
      .catch(e => { if (active) setError(e); })
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
  const style = onSystemPrompt ? STYLE_IDS.find(id => systemPrompt.includes(STYLES[id].prompt)) : undefined;
  const choosePreset = (id: string) => {
    if (id in STYLES) { selectProfile(''); onSystemPrompt?.([withoutStyle(systemPrompt), STYLES[id as keyof typeof STYLES].prompt].filter(Boolean).join('\n')); return; }
    if (style) onSystemPrompt?.(withoutStyle(systemPrompt));
    selectProfile(id);
  };
  const hasError=error!==null,hasModelError=modelsError!==null;
  const hidden=loading?(en?'Loading':'読込中'):hasError?(en?'List unavailable':'一覧未取得'):(en?'Not shown':'表示対象外');
  return <div className="k-portable-session" aria-busy={loading}>
    <h3 className="k-portable-session__title">{en?'Presets':'プリセット'}</h3>
    <p className="k-portable-session__hint">{en?'Settings that shape reply length and mood.':'返事の長さや雰囲気をまとめた設定です。'}</p>
    {loading && <p role="status">{en?'Loading presets and knowledge…':'プリセットと知識を読込中…'}</p>}
    {hasError && <p role="alert">{en?'Could not load presets and knowledge: ':'プリセットと知識を取得できません：'}{friendlyMessage(error,language)}</p>}
    {modelHint && <details className="k-portable-session__details"><summary>{en?'Preset model recommendation':'プリセットの推奨モデル'}</summary><p>{en?'Original model: ':'元のモデル：'}{modelHint}<br />{en?'Registered candidates: ':'登録モデルの候補：'}{modelsLoading ? (en?'Loading…':'読込中…') : hasModelError ? (en?'Could not load':'取得できません') : candidates.map(m => m.display_name).join(en?', ':'、') || (en?'No match':'一致なし')}{en?'. Choose your conversation model in the model field above.':'。会話モデルは上のモデル欄で選べます。'}</p>{hasModelError && <p role="alert">{friendlyMessage(modelsError,language)}</p>}</details>}
    <PresetList aria-label={en?'Conversation generation preset':'会話の生成プリセット'} disabled={loading || hasError} value={binding.profile?.id ?? style ?? ''} onChange={e => choosePreset(e.target.value)} options={[
      { value: '', label: en?'Standard':'標準', sub: en?'Talks as the character is written':'キャラの設定どおりに話す' },
      ...(onSystemPrompt ? STYLE_IDS.map(id => ({ value: id, label: en ? STYLES[id].en : STYLES[id].ja, sub: en ? STYLES[id].enSub : STYLES[id].jaSub })) : []),
      ...(binding.profile && !profiles.some(i => i.id === binding.profile?.id) ? [{ value: binding.profile.id, label: en?`Selected (${hidden}; revision ${binding.profile.revision})`:`選択済み（${hidden}・版${binding.profile.revision}）` }] : []),
      ...profiles.map(i => ({ value: i.id, label: i.document.name, sub: typeof i.document.data.description === 'string' ? i.document.data.description.slice(0, 60) : undefined })),
    ]} />
    {!onSystemPrompt && !loading && !hasError && profiles.length === 0 && <p role="status">{en?'No generation presets to add.':'追加できる生成プリセットがありません。'}</p>}
    {binding.profile && <p>{en?'Selected revision: ':'選択中の版：'}{binding.profile.revision}<Button variant="ghost" size="sm" disabled={loading || hasError || !profiles.some(i => i.id === binding.profile?.id)} onClick={() => selectProfile(binding.profile!.id)}>{en?'Use latest preset':'プリセットを最新版に切り替える'}</Button></p>}
    {(!onSystemPrompt || lorebooks.length > 0 || binding.lorebooks.length > 0) && <fieldset><legend>{en?'Knowledge (Lorebook)':'知識（Lorebook）'}</legend>
      {!loading && !hasError && lorebooks.length === 0 && <p role="status">{en?'No knowledge to add.':'追加できる知識がありません。'}</p>}
      {lorebooks.map(i => { const current = binding.lorebooks.find(ref => ref.id === i.id); return <div key={i.id}><label className="k-portable-session__lore"><input type="checkbox" checked={Boolean(current)} disabled={loading || hasError} onChange={e => set({ lorebooks: e.target.checked ? [...binding.lorebooks, { id: i.id, revision: i.revision }] : binding.lorebooks.filter(r => r.id !== i.id) })} /> {i.document.name}{current && (en?` (revision ${current.revision})`:`（版${current.revision}）`)}</label>{current && current.revision !== i.revision && <Button variant="ghost" size="sm" onClick={() => set({ lorebooks: binding.lorebooks.map(r => r.id === i.id ? { id: i.id, revision: i.revision } : r) })}>{en?'Use latest Lorebook':'このLoreを最新版に切り替える'}</Button>}</div>; })}
      {binding.lorebooks.filter(ref => !lorebooks.some(i => i.id === ref.id)).map(ref => <p key={ref.id}>{en?`Selected knowledge (revision ${ref.revision}; ${hidden})`:`選択済みの知識（版${ref.revision}・${hidden}）`}</p>)}
    </fieldset>}
    {character && <><label>{en?'Expression':'表情'}<select className="k-input" aria-label={en?'Expression':'表情'} disabled={!capabilities?.features.media_playback} value={binding.expression_asset_id ?? ''} onChange={e => set({ expression_asset_id: e.target.value || null })}><option value="">{en?'Default icon':'基本のアイコン'}</option>{character.document.assets.filter(a => a.asset_id && ['emotion', 'icon'].includes(a.type)).map((a, i) => <option value={a.asset_id!} key={i}>{a.name}</option>)}</select></label>{!capabilities?.features.media_playback && <p>{en?'This connection does not support imported media playback or expression changes.':'この接続先では持ち込み媒体の再生・表情切替に対応していません。'}</p>}<p>{en?'Character revision: ':'キャラの版：'}{character.revision}</p>{latest && latest.revision !== character.revision && <Button variant="secondary" onClick={() => set({ character: { id: latest.id, revision: latest.revision }, expression_asset_id: null })}>{en?`Use latest character (revision ${latest.revision})`:`キャラを最新版に切り替える（版${latest.revision}）`}</Button>}</>}
  </div>;
}
