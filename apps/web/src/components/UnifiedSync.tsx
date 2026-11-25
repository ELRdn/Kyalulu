import { useEffect } from 'react';
import { deviceOwner, generationBusy } from '../lib/appContext';

export default function UnifiedSync() {
  useEffect(() => {
    let mounted = true;
    const run = () => {
      const owner = deviceOwner();
      if (document.visibilityState === 'hidden' || owner === 'guest' || generationBusy()) return;
      void import('../lib/appSync').then(({ syncNow }) => {
        if (mounted && document.visibilityState !== 'hidden') return syncNow(owner);
      }).catch(() => { /* Retry at the next interval or online event. */ });
    };
    // Sync can start after the initial rendering work. Installed clients still
    // run it on reconnect and on the same recurring interval.
    const canRunWhenIdle = typeof window.requestIdleCallback === 'function';
    const initial = canRunWhenIdle ? window.requestIdleCallback(run, { timeout: 1000 }) : window.setTimeout(run, 0);
    const timer = window.setInterval(run, 15000);
    window.addEventListener('online', run);
    return () => {
      mounted = false;
      if (canRunWhenIdle) window.cancelIdleCallback(initial);
      else window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener('online', run);
    };
  }, []);
  return null;
}
