/**
 * キャラクターの生 tags (characters/*.yaml の tags 配列) を
 * ユーザー向け mood ラベルへ変換する層。
 *
 * Home/Discover の mood chips はこの層を必ず経由し、tags に直接密結合しない。
 * 現状は 1:1 の日本語ラベル化のみだが、将来 tag → mood の多対1マッピングや
 * 表示順の調整をここに集約できるようにする。
 */

export type MoodTag = {
  /** 元の character tag 値 */
  tag: string;
  /** UI表示用ラベル */
  label: string;
  /** 任意の絵文字/モチーフ */
  icon?: string;
};

const LABELS: Record<string, { label: string; icon?: string }> = {
  yandere: { label: "ヤンデレ", icon: "♡" },
  cat: { label: "獣人", icon: "✦" },
  beastkin: { label: "獣人", icon: "✦" },
  "onee-san": { label: "お姉さん", icon: "✧" },
  tsundere: { label: "ツンデレ", icon: "×" },
  butler: { label: "執事", icon: "✦" },
  senior: { label: "先輩", icon: "✧" },
  cool: { label: "クール", icon: "✦" },
  night: { label: "深夜", icon: "☾" },
  healing: { label: "癒し", icon: "✧" },
  mysterious: { label: "ミステリアス", icon: "✦" },
};

/** 未知の tag はケバブ/アンダースコアを取り除いた素朴な表示にフォールバックする */
function fallbackLabel(tag: string): string {
  return tag.replace(/[-_]/g, " ");
}

export function moodLabelFor(tag: string): MoodTag {
  const known = LABELS[tag.toLowerCase()];
  return { tag, label: known?.label ?? fallbackLabel(tag), icon: known?.icon };
}

/** 複数キャラクターの tags からユニークな mood chip 一覧を作る（出現順） */
export function collectMoods(allTags: string[][]): MoodTag[] {
  const seen = new Set<string>();
  const result: MoodTag[] = [];
  for (const tags of allTags) {
    for (const t of tags) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(moodLabelFor(t));
    }
  }
  return result;
}
