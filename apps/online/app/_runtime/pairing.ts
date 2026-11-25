import { takePairing } from '../../../web/src/lib/remotePairing';

type Entry = ReturnType<typeof takePairing>;
let entry: Entry | null = null;
const listeners = new Set<() => void>();

export function capturePairing() {
  if (!location.hash.startsWith('#remote=') || /^\/(?:device|migration)(?:\/|$)/.test(location.pathname)) return;
  entry = takePairing('');
  for (const listener of listeners) listener();
}

export function dismissPairing() {
  entry = null;
  for (const listener of listeners) listener();
}

export function subscribePairing(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export const currentPairing = () => entry;
