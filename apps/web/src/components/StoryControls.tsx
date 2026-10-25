import { useEffect, useState } from "react";
import Button from "./ui/Button";
import { Input } from "./ui/Input";
import { applyStory, readStory } from "../lib/story";
import { useLanguage } from '../lib/appContext';

export default function StoryControls({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const en = useLanguage() === 'en';
  const [draft, setDraft] = useState(() => readStory(value));
  useEffect(() => { setDraft(readStory(value)); }, [value]);
  return <details className="k-context-section"><summary className="k-context-section__title">{en ? 'Story direction' : '物語の進め方'}</summary>
    <form style={{ display: "grid", gap: 10, marginTop: 12 }} onSubmit={e => { e.preventDefault(); onChange(applyStory(value, draft)); }}>
      <label>{en ? 'Scene' : '場面'}<Input maxLength={500} value={draft.scene} disabled={disabled} placeholder={en ? 'e.g. a café on a rainy day' : '例：雨の日の喫茶店'} onChange={e => setDraft({ ...draft, scene: e.target.value })} /></label>
      <label>{en ? 'Goal' : '目指す展開'}<Input maxLength={500} value={draft.goal} disabled={disabled} placeholder={en ? 'e.g. make plans for the next day off' : '例：次の休日の約束をする'} onChange={e => setDraft({ ...draft, goal: e.target.value })} /></label>
      <label>{en ? 'Pace' : 'ペース'}<select className="k-input" value={draft.pace} disabled={disabled} onChange={e => setDraft({ ...draft, pace: e.target.value as typeof draft.pace })}><option value="natural">{en ? 'Natural' : '自然に'}</option><option value="slow">{en ? 'Take it slowly' : 'ゆっくり味わう'}</option><option value="forward">{en ? 'Move the story forward' : '展開を進める'}</option></select></label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button size="sm" type="submit" disabled={disabled}>{en ? 'Apply to conversation' : '会話に反映'}</Button><Button size="sm" type="button" variant="ghost" disabled={disabled} onClick={() => onChange(applyStory(value, { scene: "", goal: "", pace: "natural" }))}>{en ? 'Clear direction' : '指定を解除'}</Button></div>
    </form>
  </details>;
}
