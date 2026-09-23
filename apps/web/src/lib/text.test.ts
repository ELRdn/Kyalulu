import { describe, expect, it } from "vitest";
import { cleanPreview, parseDbTime, splitSegments } from "./text";
import { collectMoods, matchesMood, moodsOf } from "./moodTaxonomy";

describe("cleanPreview", () => {
  it("strips narrator labels, emphasis and mock prefixes", () => {
    expect(cleanPreview("NARRATOR: *放課後の教室*\n\nねぇ…")).toBe("放課後の教室 ねぇ…");
    expect(cleanPreview("[Mock Echo] あなたはこう言いました")).toBe("あなたはこう言いました");
    expect(cleanPreview(null)).toBe("");
  });
});

describe("splitSegments", () => {
  it("separates action lines from speech", () => {
    expect(splitSegments("*扉が開く*\n\nお帰りなさいませ。\n本日は？")).toEqual([
      { kind: "narration", text: "扉が開く" },
      { kind: "speech", text: "お帰りなさいませ。\n\n本日は？" },
    ]);
  });
  it("treats NARRATOR paragraphs as narration and keeps inline actions in speech", () => {
    expect(splitSegments("NARRATOR: 夜の廊下。\n\n*手を振る* こっちだよ")).toEqual([
      { kind: "narration", text: "夜の廊下。" },
      { kind: "speech", text: "*手を振る* こっちだよ" },
    ]);
  });
});

describe("parseDbTime", () => {
  it("reads SQLite UTC timestamps as UTC", () => {
    expect(parseDbTime("2026-08-30 07:47:16")?.toISOString()).toBe("2026-08-30T07:47:16.000Z");
  });
});

describe("mood taxonomy", () => {
  it("merges synonyms and hides technical tags", () => {
    expect(moodsOf(["butler", "cat", "formal", "hard"]).map((m) => m.label)).toEqual(["執事", "獣人", "礼儀正しい"]);
    expect(collectMoods([["cat"], ["beastkin", "wolf"]]).map((m) => m.tag)).toEqual(["beastkin"]);
    expect(matchesMood(["wolf"], "beastkin")).toBe(true);
    expect(matchesMood(["wolf"], "cat")).toBe(true);
  });
});
