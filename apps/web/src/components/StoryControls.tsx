import { useEffect, useState } from "react";
import Button from "./ui/Button";
import { Input } from "./ui/Input";
import { applyStory, readStory } from "../lib/story";

export default function StoryControls({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState(() => readStory(value));
  useEffect(() => { setDraft(readStory(value)); }, [value]);
  return <details className="k-context-section"><summary className="k-context-section__title">物語の進め方</summary>
    <form style={{ display: "grid", gap: 10, marginTop: 12 }} onSubmit={e => { e.preventDefault(); onChange(applyStory(value, draft)); }}>
      <label>場面<Input maxLength={500} value={draft.scene} disabled={disabled} placeholder="例：雨の日の喫茶店" onChange={e => setDraft({ ...draft, scene: e.target.value })} /></label>
      <label>目指す展開<Input maxLength={500} value={draft.goal} disabled={disabled} placeholder="例：次の休日の約束をする" onChange={e => setDraft({ ...draft, goal: e.target.value })} /></label>
      <label>ペース<select className="k-input" value={draft.pace} disabled={disabled} onChange={e => setDraft({ ...draft, pace: e.target.value as typeof draft.pace })}><option value="natural">自然に</option><option value="slow">ゆっくり味わう</option><option value="forward">展開を進める</option></select></label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button size="sm" type="submit" disabled={disabled}>会話に反映</Button><Button size="sm" type="button" variant="ghost" disabled={disabled} onClick={() => onChange(applyStory(value, { scene: "", goal: "", pace: "natural" }))}>指定を解除</Button></div>
    </form>
  </details>;
}
