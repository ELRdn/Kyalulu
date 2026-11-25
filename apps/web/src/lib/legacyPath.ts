/** Resolve an older hash-router link within the current app, including section anchors. */
export function legacyPath(fragment: string, origin: string): string | null {
  if (!fragment.startsWith('#/') || fragment.startsWith('#//')) return null;
  try {
    const url = new URL(fragment.slice(1), origin);
    if (url.origin === origin) return url.pathname + url.search + url.hash;
  } catch { /* An invalid bookmark can still open the current page. */ }
  return null;
}
