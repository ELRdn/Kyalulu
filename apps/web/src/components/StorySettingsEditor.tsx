import { useEffect, useRef, useState } from 'react';
import { CastMemberSchema, RPGOptionsSchema, type CastMember, type RPGOptions } from '../../../../packages/schemas/src';
import { useCapabilities } from '../lib/capabilities';
import { Input, Textarea } from './ui/Input';
import Button from './ui/Button';

export default function StorySettingsEditor({ cast, rpg, onChange, onValidity, disabled }: {
  cast: CastMember[]; rpg: RPGOptions | null; onChange: (cast: CastMember[], rpg: RPGOptions | null) => void;
  onValidity: (valid: boolean) => void; disabled: boolean;
}) {
  const { capabilities } = useCapabilities();
  const [raw, setRaw] = useState(() => JSON.stringify(rpg, null, 2));
  const [error, setError] = useState('');
  const last = useRef(JSON.stringify(rpg));
  const validity = useRef(onValidity); validity.current = onValidity;
  const castValid = cast.length <= 12 && cast.every(member => CastMemberSchema.safeParse(member).success) && new Set(cast.map(member => member.id)).size === cast.length;
  useEffect(() => {
    const value = JSON.stringify(rpg);
    if (value !== last.current) { last.current = value; setRaw(JSON.stringify(rpg, null, 2)); setError(''); }
  }, [rpg]);
  useEffect(() => validity.current(!error && castValid), [error, castValid]);
  const changeCast = (index: number, key: keyof CastMember, value: string) => onChange(cast.map((member, i) => i === index ? { ...member, [key]: value } : member), rpg);
  return <section style={{ display: 'grid', gap: 14 }}>
    <h3>登場人物とRPGのルール</h3>
    {!capabilities?.features.story_rules && <p>この接続先は登場人物・RPGルールに対応していません。保存された設定は保持しています。</p>}
    <fieldset disabled={disabled || !capabilities?.features.story_rules} style={{ border: 0, padding: 0 }}>
      <legend>登場人物（最大12人）</legend>
      {cast.map((member, index) => <article key={member.id} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <label>人物名<Input required maxLength={120} value={member.display_name} onChange={event => changeCast(index, 'display_name', event.target.value)} /></label>
        {([['personality', '性格', 2000], ['speaking_style', '話し方', 1000], ['knowledge', 'この人物だけが知ること', 2000], ['relationships', '他の人物との関係', 2000]] as const).map(([key, label, maxLength]) => <label key={key}>{label}<Textarea rows={2} maxLength={maxLength} value={member[key]} onChange={event => changeCast(index, key, event.target.value)} /></label>)}
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(cast.filter((_, i) => i !== index), rpg)}>この人物を外す</Button>
      </article>)}
      <Button size="sm" type="button" disabled={cast.length >= 12} onClick={() => onChange([...cast, CastMemberSchema.parse({ id: crypto.randomUUID(), display_name: '新しい人物' })], rpg)}>人物を追加</Button>
      {!castValid && <p role="alert">人物名・ID・人数を確認してください。</p>}
      <label style={{ display: 'block', marginTop: 16 }}><input type="checkbox" checked={!!rpg} onChange={event => {
        const value = event.target.checked ? RPGOptionsSchema.parse({}) : null;
        setRaw(JSON.stringify(value, null, 2)); setError(''); last.current = JSON.stringify(value); onChange(cast, value);
      }} /> サーバーでdice・HP・所持品を管理する</label>
      {rpg && <><p>発言全体が行動のキーワードと一致したとき、サーバーがd20＋技能を判定します。前後の空白・英字の大小は区別しません。成功時のみHP・所持品を更新します。</p>
        <label>RPGルール（JSON）<Textarea rows={12} value={raw} aria-invalid={!!error} aria-describedby="rpg-rule-help" spellCheck={false} onChange={event => {
          setRaw(event.target.value);
          try { const value = RPGOptionsSchema.parse(JSON.parse(event.target.value)); last.current = JSON.stringify(value); setError(''); onChange(cast, value); }
          catch { setError('HP・技能・行動の形式を確認してください。修正するまで保存できません。'); }
        }} /></label><small id="rpg-rule-help">initial_hp：初期HP、initial_inventory：所持品、skills：技能と補正、actions：判定する行動。任意のスクリプトは実行しません。</small>
        <details><summary>行動の設定例</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ initial_hp: 100, initial_inventory: ['鍵'], skills: { 探索: 2 }, actions: [{ id: 'search', label: '周囲を探索', trigger: '探索する', skill: '探索', difficulty: 10, hp_delta: 0, inventory_add: ['地図'], inventory_remove: [] }] }, null, 2)}</pre></details>
        {error && <p role="alert">{error}</p>}
      </>}
    </fieldset>
  </section>;
}
