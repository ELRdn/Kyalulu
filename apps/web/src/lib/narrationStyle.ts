/**
 * Narration style は「見た目だけのダミー設定」にしない。
 * 選択値を実際の生成へ安全に反映するため、既存の system_prompt（Chat.tsx の
 * systemPrompt ステート、saveSettings / compilePrompt の extra_system_prompt）に
 * 専用マーカー区間として追記する。ユーザーが自由記述した本文はマーカーの外側にあるため、
 * 選択を変える／解除するたびにマーカー区間だけを安全に置換・削除できる。
 */

export type NarrationStyleId = "minimal" | "descriptive" | "dialogue_heavy" | "light_novel" | "first_person" | "third_person" | "cinematic";

export const NARRATION_STYLES: { id: NarrationStyleId; label: string; instruction: string }[] = [
  { id: "minimal", label: "ミニマル", instruction: "地の文・情景描写は最小限にし、セリフ中心で簡潔に応答する。" },
  { id: "descriptive", label: "描写重視", instruction: "情景・仕草・表情の描写を*テキスト*で丁寧に添え、雰囲気を大切にする。" },
  { id: "dialogue_heavy", label: "会話中心", instruction: "地の文は最小限にとどめ、キャラクター同士の掛け合い・セリフを中心に展開する。" },
  { id: "light_novel", label: "ライトノベル風", instruction: "ライトノベル的な文体で、地の文とセリフのバランスを取りながら物語調に描写する。" },
  { id: "first_person", label: "一人称視点", instruction: "キャラクター自身の一人称視点で、内心の感情も交えて描写する。" },
  { id: "third_person", label: "三人称視点", instruction: "三人称視点で、客観的にシーン全体を描写する。" },
  { id: "cinematic", label: "シネマティック", instruction: "映画のワンシーンのように、カメラワークを意識した情景描写を心がける。" },
];

const MARK_START = "<!-- kyalulu:narration-style";
const MARK_END = "<!-- /kyalulu:narration-style -->";
const BLOCK_RE = /<!-- kyalulu:narration-style:([a-z_]+) -->\n[\s\S]*?<!-- \/kyalulu:narration-style -->\n?/;

/** 現在の system_prompt からマーカー区間を探し、選択中の style id を返す（未設定ならnull） */
export function extractNarrationStyle(systemPrompt: string): NarrationStyleId | null {
  const m = systemPrompt.match(BLOCK_RE);
  if (!m) return null;
  const id = m[1] as NarrationStyleId;
  return NARRATION_STYLES.some((s) => s.id === id) ? id : null;
}

/** マーカー区間を除いた「ユーザー本文」を取り出す */
export function stripNarrationStyle(systemPrompt: string): string {
  return systemPrompt.replace(BLOCK_RE, "").trim();
}

/** styleId(nullで解除)を適用した新しい system_prompt を返す。ユーザー本文は保持する。 */
export function applyNarrationStyle(systemPrompt: string, styleId: NarrationStyleId | null): string {
  const rest = stripNarrationStyle(systemPrompt);
  if (!styleId) return rest;
  const style = NARRATION_STYLES.find((s) => s.id === styleId);
  if (!style) return rest;
  const block = `${MARK_START}:${styleId} -->\n${style.instruction}\n${MARK_END}`;
  return rest ? `${block}\n\n${rest}` : block;
}
