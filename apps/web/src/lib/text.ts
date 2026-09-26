/** Display helpers that keep raw generation markup out of consumer surfaces. */

const NARRATOR_PREFIX = /^\s*NARRATOR\s*[:：]\s*/i;
const TECH_PREFIX = /^\s*\[(?:Mock Echo|mock|debug)[^\]]*\]\s*/i;

/** One-line preview for session lists: strips narrator labels, markdown emphasis and extra whitespace. */
export function cleanPreview(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  const s = text
    .replace(TECH_PREFIX, "")
    .replace(/^\s*NARRATOR\s*[:：]\s*/gim, "")
    .replace(/[*_~`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export type Segment = { kind: "narration" | "speech"; text: string };

/**
 * Splits a character reply into narration and speech blocks.
 * Structured roles are not available from the backend yet, so a paragraph counts as narration only when
 * it is explicitly marked (NARRATOR: prefix, or wrapped entirely in *...*). Everything else stays speech.
 */
export function splitSegments(content: string): Segment[] {
  const out: Segment[] = [];
  const push = (kind: Segment["kind"], text: string) => {
    const t = text.trim();
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += "\n\n" + t;
    else out.push({ kind, text: t });
  };
  for (const para of content.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (NARRATOR_PREFIX.test(p)) {
      push("narration", unwrapEmphasis(p.replace(NARRATOR_PREFIX, "")));
      continue;
    }
    // A line may mix *action* and dialogue: split by lines, then classify each line.
    for (const line of p.split("\n")) {
      const l = line.trim();
      if (!l) continue;
      if (/^\*[^*].*[^*]\*$|^\*[^*]\*$/.test(l) && !l.slice(1, -1).includes("*")) push("narration", l.slice(1, -1));
      else push("speech", l);
    }
  }
  return out;
}

function unwrapEmphasis(s: string) {
  const t = s.trim();
  return /^\*[^*]+\*$/.test(t) ? t.slice(1, -1) : t;
}

/** SQLite `datetime('now')` values are UTC without a zone marker. */
export function parseDbTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function formatRelative(value: string | null | undefined): string {
  const d = parseDbTime(value);
  if (!d) return "";
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "昨日";
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}日前`;
  return d.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
}

/** プロフィール表示用: プロンプト向けの {{user}} / USER / {{char}} を読み手向けの言葉に置き換える。 */
export function displayProfileText(text: string | null | undefined, charName: string): string {
  if (!text) return "";
  return text
    .replace(/\{\{\s*user\s*\}\}|<user>|\bUSER\b/gi, "あなた")
    .replace(/\{\{\s*char\s*\}\}|<char>/gi, charName)
    .replace(/^\s*[-・*]\s+/gm, "・")
    .trim();
}

/** 1万以上を「1.2万」のように短く表す */
export function formatCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return n.toLocaleString("ja-JP");
}
