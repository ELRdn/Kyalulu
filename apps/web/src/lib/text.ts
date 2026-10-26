/** Display helpers that keep raw generation markup out of consumer surfaces. */
import type { Language } from './appContext';

const TECH_PREFIX = /^\s*\[(?:Mock Echo|mock|debug)[^\]]*\]\s*/i;

/** One-line preview for session lists: strips narrator labels, markdown emphasis and extra whitespace. */
export function cleanPreview(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  const s = text
    .replace(TECH_PREFIX, "")
    .replace(/^\s*NARRATOR\s*[:：]\s*/gim, "")
    .replace(/^\s*[@＠][^:：\r\n]*[:：][ \t]*/gm, "")
    .replace(/[*_~`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export type Segment = { kind: "narration" | "speech"; text: string; speaker?: string };

/**
 * Splits a character reply into narration and speech blocks.
 * Only explicit @: blocks are narration. Actions and fictional inner monologues stay with their speaker.
 * Legacy NARRATOR: paragraphs are accepted as an input alias.
 */
export function splitSegments(content: string): Segment[] {
  const out: Segment[] = [];
  let kind: Segment["kind"] = "speech";
  let speaker: string | undefined;
  let lines: string[] = [];
  let legacyNarration = false;
  let fence = "";
  const flush = () => {
    const text = lines.join("\n").trim();
    if (text) out.push({ kind, text: kind === "narration" ? unwrapEmphasis(text) : text, ...(speaker ? { speaker } : {}) });
    lines = [];
  };
  for (const line of content.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && !fence) {
      fence = marker[1];
      lines.push(line);
      continue;
    }
    if (fence) {
      lines.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = "";
      continue;
    }
    const header = line.match(/^\s*[@＠]([^:：\r\n]*)[:：][ \t]*(.*)$/);
    const legacy = line.match(/^\s*NARRATOR\s*[:：][ \t]*(.*)$/i);
    if (header || legacy) {
      flush();
      const name = header?.[1].trim();
      legacyNarration = !!legacy || name?.toUpperCase() === "NARRATOR";
      kind = !name || legacyNarration ? "narration" : "speech";
      speaker = kind === "speech" ? name : undefined;
      lines.push(header ? header[2] : legacy![1]);
    } else if (legacyNarration && !line.trim()) {
      flush();
      kind = "speech";
      legacyNarration = false;
    } else {
      lines.push(line);
    }
  }
  flush();
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

export function formatRelative(value: string | null | undefined, language: Language = 'ja'): string {
  const en = language === 'en', locale = en ? 'en-US' : 'ja-JP';
  const d = parseDbTime(value);
  if (!d) return "";
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return en ? 'Just now' : 'たった今';
  if (diff < 3600) return en ? `${Math.floor(diff / 60)}m ago` : `${Math.floor(diff / 60)}分前`;
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return en ? 'Yesterday' : '昨日';
  if (diff < 7 * 86400) return en ? `${Math.floor(diff / 86400)}d ago` : `${Math.floor(diff / 86400)}日前`;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** プロフィール表示用: プロンプト向けの {{user}} / USER / {{char}} を読み手向けの言葉に置き換える。 */
export function displayProfileText(text: string | null | undefined, charName: string, language: Language = 'ja'): string {
  if (!text) return "";
  return text
    .replace(/\{\{\s*user\s*\}\}|<user>|\bUSER\b/gi, language === 'en' ? 'you' : 'あなた')
    .replace(/\{\{\s*char\s*\}\}|<char>/gi, charName)
    .replace(/^\s*[-・*]\s+/gm, "・")
    .trim();
}

/** 1万以上を「1.2万」のように短く表す */
export function formatCount(n: number, language: Language = 'ja'): string {
  if (language === 'en') return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}億`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return n.toLocaleString("ja-JP");
}
