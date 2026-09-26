import { useEffect, useState } from "react";

/** 保存（お気に入り）したキャラクター。アカウント同期が無いため、このデバイスのlocalStorageだけで管理する。 */
const LS_SAVED = "kyalulu-saved-characters";
const EVENT = "kyalulu-saved-change";

function read(): string[] {
  try {
    const raw = localStorage.getItem(LS_SAVED);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toggleSaved(characterId: string) {
  const cur = read();
  const next = cur.includes(characterId) ? cur.filter((x) => x !== characterId) : [characterId, ...cur];
  try {
    localStorage.setItem(LS_SAVED, JSON.stringify(next));
  } catch {
    /* Storage unavailable: the heart simply won't persist. */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useSavedCharacters(): string[] {
  const [ids, setIds] = useState<string[]>(read);
  useEffect(() => {
    const onChange = () => setIds(read());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return ids;
}
