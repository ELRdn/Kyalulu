import { useEffect, useState } from 'react';
import { fetchChatDebug } from '../lib/api';
import { friendlyMessage } from '../lib/errors';
import { CastMemberSchema, type CastMember } from '../../../../packages/schemas/src';

export default function StoryRuntime({ sessionId, refreshKey }: { sessionId: string; refreshKey: number }) {
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetchChatDebug(sessionId).then(value => {
      if (!active) return;
      const candidate = value.state.rpg;
      setState(candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null);
      const story = value.compiled.sections.story ?? (value.compiled.sections.portable_snapshot as Record<string, unknown> | undefined)?.world;
      const raw = story && typeof story === 'object' && 'cast' in story ? story.cast : [];
      setCast(Array.isArray(raw) ? raw.flatMap(member => { const result = CastMemberSchema.safeParse(member); return result.success ? [result.data] : []; }) : []);
      setError('');
    }).catch(error => { if (active) setError(friendlyMessage(error)); });
    return () => { active = false; };
  }, [sessionId, refreshKey]);
  if (!state && !cast.length && !error) return null;
  const rolls = Array.isArray(state?.rolls) ? state.rolls.filter((roll): roll is Record<string, unknown> => !!roll && typeof roll === 'object').slice(-3) : [];
  return <details className="k-context-section"><summary>登場人物・RPGの状態</summary>
    {error && <p role="alert">{error}</p>}
    {cast.length > 0 && <ul>{cast.map(member => <li key={member.id}><strong>{member.display_name}</strong><p>{member.personality}</p><details><summary>知識・関係・話し方</summary><p>{member.knowledge}</p><p>{member.relationships}</p><p>{member.speaking_style}</p></details></li>)}</ul>}
    {typeof state?.hp === 'number' && <p>HP：{state.hp}</p>}
    {Array.isArray(state?.inventory) && <p>所持品：{state.inventory.filter((item): item is string => typeof item === 'string').join('、') || 'なし'}</p>}
    {!!state?.skills && typeof state.skills === 'object' && <p>技能：{Object.entries(state.skills).filter(([, value]) => typeof value === 'number').map(([key, value]) => `${key} ${value}`).join('、')}</p>}
    {rolls.map((roll, index) => <p key={index}>判定：{typeof roll.action_id === 'string' ? roll.action_id : ''} · {typeof roll.die === 'number' ? `d20 ${roll.die}` : '所持品条件を満たしません'} · {roll.success === true ? '成功' : '失敗'}</p>)}
    <p className="k-context-note">サーバーで確定した状態です。再接続時の再配送でdiceを振り直しません。</p>
  </details>;
}
