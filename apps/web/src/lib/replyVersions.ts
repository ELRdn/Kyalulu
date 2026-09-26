/**
 * 作り直した返事の履歴。サーバーは最新の返事を上書き保存するので、
 * 以前の案はこのデバイスに残して「‹ 2/3 ›」で行き来できるようにする。
 */
const LS_KEY = "kyalulu-reply-versions";
const MAX_ENTRIES = 40;
const MAX_VERSIONS = 10;

export type ReplyVersions = { versions: string[]; index: number };
type Store = Record<string, ReplyVersions & { at: number }>;

const keyOf = (sessionId: string, messageId: number) => `${sessionId}:${messageId}`;

function read(): Store {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  const entries = Object.entries(store).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Storage unavailable: versions last only for this view. */
  }
}

export function getReplyVersions(sessionId: string, messageId: number): ReplyVersions | null {
  const v = read()[keyOf(sessionId, messageId)];
  return v && Array.isArray(v.versions) && v.versions.length > 1 ? { versions: v.versions, index: v.index } : null;
}

/** 作り直しが終わったときに、直前の案と新しい案を記録する */
export function recordReplyVersion(sessionId: string, messageId: number, previous: string, next: string) {
  const store = read();
  const key = keyOf(sessionId, messageId);
  const versions = store[key]?.versions?.length ? [...store[key].versions] : [];
  if (!versions.includes(previous)) versions.push(previous);
  const existing = versions.indexOf(next);
  if (existing !== -1) versions.splice(existing, 1);
  versions.push(next);
  const trimmed = versions.slice(-MAX_VERSIONS);
  store[key] = { versions: trimmed, index: trimmed.length - 1, at: Date.now() };
  write(store);
}

export function selectReplyVersion(sessionId: string, messageId: number, index: number) {
  const store = read();
  const key = keyOf(sessionId, messageId);
  if (!store[key]) return;
  store[key] = { ...store[key], index, at: Date.now() };
  write(store);
}
