import { scopedKey } from './remoteStore';

export type ClientTimings = {
  context_fetch_ms: number | null; quote_fetch_ms: number | null; quote_consent_ms: number | null;
  post_to_first_body_ms: number | null; post_to_full_ms: number | null;
};

/** Scoped, text-free client measurements; never mix browser timing with server timing. */
export function recordClientTimings(id: string, timings: ClientTimings) {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const key = scopedKey('kyalulu-client-timings-v1');
    const entries = JSON.parse(sessionStorage.getItem(key) ?? '{}');
    const bounded = Object.fromEntries(Object.entries(entries && typeof entries === 'object' && !Array.isArray(entries) ? entries : {}).slice(-99));
    sessionStorage.setItem(key, JSON.stringify({ ...bounded, [id]: timings }));
  } catch { /* Telemetry storage must never invalidate a committed generation. */ }
}
export function readClientTimings(id: string): ClientTimings | null {
  if (typeof sessionStorage === 'undefined') return null;
  try { return JSON.parse(sessionStorage.getItem(scopedKey('kyalulu-client-timings-v1')) ?? '{}')[id] ?? null; }
  catch { return null; }
}
