import { useEffect } from "react";

const BASE = "Kyalulu";

export function useDocumentTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} | ${BASE}` : `${BASE} — キャラクターと物語をつむぐ場所`;
  }, [title]);
}
