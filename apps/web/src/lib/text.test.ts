import { describe, expect, it, vi } from "vitest";
import { cleanPreview, parseDbTime, splitSegments, displayProfileText, formatRelative, formatCount, type Segment } from "./text";
import { collectMoods, matchesMood, moodsOf } from "./moodTaxonomy";
import { readFileSync } from "node:fs";

const rpExamples = JSON.parse(readFileSync(new URL("../../../../tests/fixtures/rp-format.json", import.meta.url), "utf8")) as { name: string; input: string; display: Segment[] }[];

describe("cleanPreview", () => {
  it("strips narrator labels, emphasis and mock prefixes", () => {
    expect(cleanPreview("NARRATOR: *放課後の教室*\n\nねぇ…")).toBe("放課後の教室 ねぇ…");
    expect(cleanPreview("[Mock Echo] あなたはこう言いました")).toBe("あなたはこう言いました");
    expect(cleanPreview(null)).toBe("");
    expect(cleanPreview("＠キャルル：\n*（ＡＢＣ）*\n@: *夜の教室*" )).toBe("（ＡＢＣ） 夜の教室");
  });
});

describe("splitSegments", () => {
  it("keeps standalone actions in the character message", () => {
    expect(splitSegments("*扉が開く*\n\nお帰りなさいませ。\n本日は？")).toEqual([
      { kind: "speech", text: "*扉が開く*\n\nお帰りなさいませ。\n本日は？" },
    ]);
  });
  it.each(rpExamples)("$name", ({ input, display }) => {
    expect(splitSegments(input)).toEqual(display);
  });
  it("does not interpret quoted, escaped or fenced labels as structure", () => {
    const content = "\\@: 記号\n> @: 引用\n```text\n@: コード\n@名前: サンプル\n```\n*（まだ内緒）*";
    expect(splitSegments(content)).toEqual([{ kind: "speech", text: content }]);
  });
  it("does not end a fence on a shorter run or an info string", () => {
    const content = "````text\n```\n@: コード\n````suffix\n@: まだコード\n````\n@: *外側*";
    expect(splitSegments(content)).toEqual([
      { kind: "speech", text: content.slice(0, content.lastIndexOf("\n@:")) },
      { kind: "narration", text: "外側" },
    ]);
  });
  it("keeps unfinished streamed thoughts visible as character text", () => {
    expect(splitSegments("@アキ: *（まだ途中")).toEqual([{ kind: "speech", speaker: "アキ", text: "*（まだ途中" }]);
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
  it('translates known labels while keeping stable aliases, ordering and unknown authored tags', () => {
    const tags = ['cat', 'formal', 'hard', '狼族'];
    const ja = moodsOf(tags), en = moodsOf(tags, 'en');
    expect(en.map(m => m.tag)).toEqual(ja.map(m => m.tag));
    expect(en.map(m => m.label)).toEqual(['Beastkin', 'Polite', '狼族']);
    expect(collectMoods([['cat'], ['wolf', 'butler']], 'en').map(m => m.label)).toEqual(['Beastkin', 'Butler']);
  });
  it("merges synonyms and hides technical tags", () => {
    expect(moodsOf(["butler", "cat", "formal", "hard"]).map((m) => m.label)).toEqual(["執事", "獣人", "礼儀正しい"]);
    expect(collectMoods([["cat"], ["beastkin", "wolf"]]).map((m) => m.tag)).toEqual(["beastkin"]);
    expect(matchesMood(["wolf"], "beastkin")).toBe(true);
    expect(matchesMood(["wolf"], "cat")).toBe(true);
  });
});

it('formats display time/count and user placeholders without changing character content', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
  try {
    expect(formatRelative('2026-10-26 12:00:00', 'en')).toBe('Just now');
    expect(formatRelative('2026-10-26 11:57:00', 'en')).toBe('3m ago');
    expect(formatRelative('2026-10-25 12:00:00', 'en')).toBe('Yesterday');
    expect(formatRelative('2026-10-24 12:00:00', 'en')).toBe('2d ago');
    expect(formatRelative('invalid', 'en')).toBe('');
    expect(formatRelative('2026-10-26 12:00:00')).toBe('たった今');
    expect(formatCount(12500, 'en')).toBe('12.5K');
    expect(formatCount(12500)).toBe('1.3万');
    expect(displayProfileText('{{char}} likes {{user}}. 原文', '原本', 'en')).toBe('原本 likes you. 原文');
    expect(displayProfileText('{{char}} likes {{user}}.', '原本')).toBe('原本 likes あなた.');
  } finally { vi.useRealTimers(); }
});
