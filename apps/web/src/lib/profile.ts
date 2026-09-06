import { useEffect, useState } from "react";

/**
 * ローカルのみのプロフィール状態。バックエンドにユーザーアカウント概念が無いため、
 * 表示名はlocalStorageで管理する（サーバー同期はしない）。
 */
const LS_NAME = "kyalulu-display-name";
const DEFAULT_NAME = "Traveler";

export function getDisplayName(): string {
  return localStorage.getItem(LS_NAME) || DEFAULT_NAME;
}

export function setDisplayName(name: string) {
  const v = name.trim() || DEFAULT_NAME;
  localStorage.setItem(LS_NAME, v);
  window.dispatchEvent(new Event("kyalulu-profile-change"));
}

export function useDisplayName(): string {
  const [name, setName] = useState(getDisplayName);
  useEffect(() => {
    const onChange = () => setName(getDisplayName());
    window.addEventListener("kyalulu-profile-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("kyalulu-profile-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return name;
}
