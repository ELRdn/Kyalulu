import { useEffect, useState } from "react";

/** Researcher/Beginner切替。Advanced機能（Studio導線・詳細設定）の表示可否を制御するグローバルフラグ。 */
const LS_RESEARCHER = "my-zeta-researcher";

export function isResearcherMode(): boolean {
  return localStorage.getItem(LS_RESEARCHER) === "1";
}

export function setResearcherMode(v: boolean) {
  localStorage.setItem(LS_RESEARCHER, v ? "1" : "0");
  window.dispatchEvent(new Event("kyalulu-mode-change"));
}

export function useResearcherMode(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(isResearcherMode);
  useEffect(() => {
    const onChange = () => setV(isResearcherMode());
    window.addEventListener("kyalulu-mode-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("kyalulu-mode-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return [v, setResearcherMode];
}
