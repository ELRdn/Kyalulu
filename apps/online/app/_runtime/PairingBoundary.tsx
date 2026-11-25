'use client';

import dynamic from 'next/dynamic';
import { useSyncExternalStore, type ReactNode } from 'react';
import { currentPairing, subscribePairing } from './pairing';

const PairingScreen = dynamic(() => import('./PairingScreen'), { ssr: false });

export function PairingBoundary({ children }: { children: ReactNode }) {
  const entry = useSyncExternalStore(subscribePairing, currentPairing, () => null);
  return entry ? <PairingScreen entry={entry} /> : children;
}
