import { scopedKey } from './remoteStore';
import { useEffect, useState } from "react";
import { accountProfile, changeAccountProfile } from './accountProfile';
import { isCloud } from './cloudMode';

/**
 * Chats landing の pin (PRODUCT_SPEC §7.2 で許可されている範囲)。
 * クラウドではアカウントに保存し、ローカルでは端末に保存する。
 * 「saved / favorite キャラクター」のような別概念はここに追加しない。
 */
const LS_PINS = "kyalulu-pinned-sessions";

function read(): string[] {
  if(isCloud()) return accountProfile()?.pinned_sessions || [];
  try {
    const raw = localStorage.getItem(scopedKey(LS_PINS));
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  localStorage.setItem(scopedKey(LS_PINS), JSON.stringify(ids));
  window.dispatchEvent(new Event("kyalulu-pins-change"));
}

export function isPinned(sessionId: string): boolean {
  return read().includes(sessionId);
}

export function togglePin(sessionId: string) {
  if(isCloud()){void changeAccountProfile({toggle_pin:sessionId}).catch(()=>{});return;}
  const cur = read();
  write(cur.includes(sessionId) ? cur.filter((x) => x !== sessionId) : [...cur, sessionId]);
}

export function usePinnedSessions(): string[] {
  const [pins, setPins] = useState<string[]>(read);
  useEffect(() => {
    const onChange = () => setPins(read());
    window.addEventListener("kyalulu-pins-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("kyalulu-pins-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return pins;
}
