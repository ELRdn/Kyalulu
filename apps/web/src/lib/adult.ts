import { useEffect, useState } from "react";

/** 成人向けコンテンツの表示可否。年齢確認のうえ利用者自身が有効にする（既定はOFF）。 */
const LS_ADULT = "kyalulu-adult-content";
const EVENT = "kyalulu-adult-change";

export function isAdultContentEnabled(): boolean {
  try {
    return localStorage.getItem(LS_ADULT) === "1";
  } catch {
    return false;
  }
}

export function setAdultContentEnabled(v: boolean) {
  try {
    localStorage.setItem(LS_ADULT, v ? "1" : "0");
  } catch {
    /* Falls back to the default (off) on next load. */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useAdultContent(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(isAdultContentEnabled);
  useEffect(() => {
    const onChange = () => setV(isAdultContentEnabled());
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return [v, setAdultContentEnabled];
}
