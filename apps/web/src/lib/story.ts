export type StoryDirection = { scene: string; goal: string; pace: "natural" | "slow" | "forward" };
const block = /\n?<!-- kyalulu-story -->[\s\S]*?<!-- \/kyalulu-story -->\n?/g;
export function readStory(prompt: string): StoryDirection {
  const text = prompt.match(/<!-- kyalulu-story -->\n([^\n]*)/);
  try {
    const data = JSON.parse(text?.[1] ?? "{}");
    return { scene: typeof data.scene === "string" ? data.scene : "", goal: typeof data.goal === "string" ? data.goal : "", pace: ["slow", "forward"].includes(data.pace) ? data.pace : "natural" };
  } catch { return { scene: "", goal: "", pace: "natural" }; }
}
export function applyStory(prompt: string, direction: StoryDirection): string {
  const rest = prompt.replace(block, "\n").trim();
  const scene = direction.scene.trim().slice(0, 500);
  const goal = direction.goal.trim().slice(0, 500);
  if (!scene && !goal && direction.pace === "natural") return rest;
  const pace = { natural: "自然な流れ", slow: "情景と気持ちを丁寧に描き、ゆっくり進める", forward: "小さな出来事や選択肢を示し、物語を進める" }[direction.pace];
  return `${rest}\n\n<!-- kyalulu-story -->\n${JSON.stringify({ scene, goal, pace: direction.pace })}\n物語の方向：場面は${scene || "会話の流れに合わせる"}。目標は${goal || "会話の流れに合わせる"}。進め方は${pace}。ユーザー自身の行動や気持ちを勝手に決めない。\n<!-- /kyalulu-story -->`.trim();
}
