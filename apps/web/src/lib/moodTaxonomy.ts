/**
 * キャラクターの生 tags (characters/*.yaml の tags 配列) を
 * ユーザー向け mood ラベルへ変換する層。
 *
 * Home/Discover の mood chips はこの層を必ず経由し、tags に直接密結合しない。
 * 複数の tag が同じ mood に集約される（cat / beastkin / wolf → 獣人）。
 * 難易度などの技術的な tag は consumer 画面に出さない。
 */

export type MoodTag = {
  /** mood の安定キー（URL の ?mood= に使う） */
  tag: string;
  /** UI表示用ラベル */
  label: string;
  /** 任意のモチーフ */
  icon?: string;
};

const MOODS: Record<string, { label: string; icon?: string }> = {
  yandere: { label: "ヤンデレ", icon: "♡" },
  beastkin: { label: "獣人", icon: "✦" },
  "onee-san": { label: "お姉さん", icon: "✧" },
  tsundere: { label: "ツンデレ", icon: "×" },
  butler: { label: "執事", icon: "✦" },
  senior: { label: "先輩", icon: "✧" },
  cool: { label: "クール", icon: "❄" },
  night: { label: "深夜", icon: "☾" },
  healing: { label: "癒し", icon: "✧" },
  mysterious: { label: "ミステリアス", icon: "✦" },
  polite: { label: "礼儀正しい", icon: "✧" },
  smart: { label: "知的", icon: "✦" },
  sweet: { label: "甘々", icon: "♡" },
  school: { label: "学園", icon: "✎" },
  fantasy: { label: "異世界", icon: "☾" },
};

/** 生 tag → mood キー。同義語はここで集約する。 */
const ALIASES: Record<string, string> = {
  cat: "beastkin",
  wolf: "beastkin",
  fox: "beastkin",
  kemonomimi: "beastkin",
  formal: "polite",
  logical: "smart",
  intellectual: "smart",
  onee: "onee-san",
  oneesan: "onee-san",
  kuudere: "cool",
  isekai: "fantasy",
  academy: "school",
  "癒し": "healing",
  "獣人": "beastkin",
};

/** consumer 向けに出さない技術的・評価用の tag */
const HIDDEN = new Set(["easy", "normal", "medium", "hard", "benchmark", "test", "sfw", "nsfw", "official"]);

function moodKey(tag: string): string | null {
  const t = tag.trim().toLowerCase();
  if (!t || HIDDEN.has(t)) return null;
  return ALIASES[t] ?? t;
}

/** 未知の tag は ASCII の技術語なら隠し、それ以外（日本語タグ等）はそのまま出す */
export function moodLabelFor(tag: string): MoodTag | null {
  const key = moodKey(tag);
  if (!key) return null;
  const known = MOODS[key];
  if (known) return { tag: key, ...known };
  if (/^[a-z0-9 _-]+$/i.test(key)) return null;
  return { tag: key, label: tag.trim() };
}

/** 1キャラの tags を重複なしの mood 一覧へ */
export function moodsOf(tags: string[] = []): MoodTag[] {
  return collectMoods([tags]);
}

/** 複数キャラクターの tags からユニークな mood chip 一覧を作る（出現順） */
export function collectMoods(allTags: string[][]): MoodTag[] {
  const seen = new Set<string>();
  const result: MoodTag[] = [];
  for (const tags of allTags) {
    for (const t of tags) {
      const m = moodLabelFor(t);
      if (!m || seen.has(m.tag)) continue;
      seen.add(m.tag);
      result.push(m);
    }
  }
  return result;
}

/** ?mood= の値（mood キー、または旧来の生 tag）にキャラが該当するか */
export function matchesMood(tags: string[] = [], mood: string): boolean {
  const want = moodKey(mood) ?? mood.toLowerCase();
  return tags.some((t) => moodKey(t) === want);
}
