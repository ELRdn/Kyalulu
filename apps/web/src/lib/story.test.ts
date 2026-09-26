import { expect, test } from "vitest";
import { applyStory, readStory } from "./story";

test("story controls preserve other instructions and do not accumulate blocks", () => {
  const initial = "元の口調\n<!-- narration -->丁寧な描写";
  const first = applyStory(initial, { scene: "喫茶店", goal: "約束する", pace: "slow" });
  const next = applyStory(first, { scene: "図書館", goal: "本を選ぶ", pace: "forward" });
  expect(next.match(/<!-- kyalulu-story -->/g)).toHaveLength(1);
  expect(next).toContain(initial);
  expect(readStory(next)).toEqual({ scene: "図書館", goal: "本を選ぶ", pace: "forward" });
  expect(applyStory(next, { scene: "", goal: "", pace: "natural" })).toBe(initial);
});

test("malformed story metadata is recoverable without losing the prompt", () => {
  expect(readStory("<!-- kyalulu-story -->\nnot json")).toEqual({ scene: "", goal: "", pace: "natural" });
});
