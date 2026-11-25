export type ExecutionTarget = 'cloud' | 'device' | 'pc' | 'local';
export const TARGET_STORAGE_KEY = 'kyalulu-execution-target';

export function selectedExecutionTarget(defaultTarget: 'cloud' | 'local'): ExecutionTarget {
  if (typeof location !== 'undefined' && /^\/device(?:\/|$)/.test(location.pathname)) return 'device';
  try {
    const value = localStorage.getItem(TARGET_STORAGE_KEY);
    if (value === 'cloud' || value === 'device' || value === 'pc' || value === 'local') return value;
    if (localStorage.getItem('kyalulu-active-remote')) return 'pc';
  } catch { /* The distribution supplies the default when storage is unavailable. */ }
  return defaultTarget;
}
