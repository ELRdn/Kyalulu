import { useEffect, useState } from 'react';
import { fetchChatDebug } from '../lib/api';
import { friendlyMessage } from '../lib/errors';
import { useLanguage } from '../lib/appContext';
import { CastMemberSchema, type CastMember } from '../../../../packages/schemas/src';

export default function StoryRuntime({ sessionId, refreshKey, visible=true }: { sessionId: string; refreshKey: number; visible?:boolean }) {
  const en = useLanguage() === 'en';
  const [state, setState] = useState<Record<string, unknown> | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [error, setError] = useState('');
  const [loading,setLoading]=useState(true);
  const [open,setOpen]=useState(false);
  useEffect(() => {
    if(!open||!visible)return;
    let active = true;
    setLoading(true);
    fetchChatDebug(sessionId).then(value => {
      if (!active) return;
      const candidate = value.state.rpg;
      setState(candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as Record<string, unknown> : null);
      const story = value.compiled.sections.story ?? (value.compiled.sections.portable_snapshot as Record<string, unknown> | undefined)?.world;
      const raw = story && typeof story === 'object' && 'cast' in story ? story.cast : [];
      setCast(Array.isArray(raw) ? raw.flatMap(member => { const result = CastMemberSchema.safeParse(member); return result.success ? [result.data] : []; }) : []);
      setError('');
    }).catch(error => { if (active) setError(friendlyMessage(error)); }).finally(()=>{if(active)setLoading(false);});
    return () => { active = false; };
  }, [sessionId, refreshKey,open,visible]);
  const rolls = Array.isArray(state?.rolls) ? state.rolls.filter((roll): roll is Record<string, unknown> => !!roll && typeof roll === 'object').slice(-3) : [];
  return <details className="k-context-section" open={open} onToggle={event=>{if(event.target===event.currentTarget)setOpen(event.currentTarget.open);}}><summary>{en ? 'Characters & RPG state' : '登場人物・RPGの状態'}</summary>
    {error && <p role="alert">{error}</p>}
    {loading&&!error&&<p role="status">{en?'Loading story state…':'物語の状態を読み込んでいます…'}</p>}
    {!loading&&!error&&!state&&cast.length===0&&<p>{en?'No story state yet.':'まだ物語の状態はありません。'}</p>}
    {cast.length > 0 && <ul>{cast.map(member => <li key={member.id}><strong>{member.display_name}</strong><p>{member.personality}</p><details><summary>{en ? 'Knowledge, relationships & speaking style' : '知識・関係・話し方'}</summary><p>{member.knowledge}</p><p>{member.relationships}</p><p>{member.speaking_style}</p></details></li>)}</ul>}
    {typeof state?.hp === 'number' && <p>{en ? 'HP: ' : 'HP：'}{state.hp}</p>}
    {Array.isArray(state?.inventory) && <p>{en ? 'Inventory: ' : '所持品：'}{state.inventory.filter((item): item is string => typeof item === 'string').join(en ? ', ' : '、') || (en ? 'None' : 'なし')}</p>}
    {!!state?.skills && typeof state.skills === 'object' && <p>{en ? 'Skills: ' : '技能：'}{Object.entries(state.skills).filter(([, value]) => typeof value === 'number').map(([key, value]) => `${key} ${value}`).join(en ? ', ' : '、')}</p>}
    {rolls.map((roll, index) => <p key={index}>{en ? 'Check: ' : '判定：'}{typeof roll.action_id === 'string' ? roll.action_id : ''} · {typeof roll.die === 'number' ? `d20 ${roll.die}` : (en ? 'Inventory requirements not met' : '所持品条件を満たしません')} · {roll.success === true ? (en ? 'Success' : '成功') : (en ? 'Failure' : '失敗')}</p>)}
    {!loading&&!error&&state&&<p className="k-context-note">{en ? 'This state is confirmed by the runtime. Events redelivered after reconnecting do not reroll the dice.' : '実行先で確定した状態です。再接続時の再配送でdiceを振り直しません。'}</p>}
  </details>;
}
