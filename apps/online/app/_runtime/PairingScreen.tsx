'use client';

import { BrowserRouter } from 'react-router-dom';
import RemoteSetup from '../../../web/src/components/RemoteSetup';
import UnifiedEntry from '../../../web/src/components/UnifiedEntry';
import AppErrorBoundary from '../../../web/src/components/AppErrorBoundary';
import type { takePairing } from '../../../web/src/lib/remotePairing';
import { useLanguage } from '../../../web/src/lib/appContext';
import { dismissPairing } from './pairing';
import '../../../web/src/index.css';

export default function PairingScreen({ entry }: { entry: ReturnType<typeof takePairing> }) {
  const en = useLanguage() === 'en';
  return <AppErrorBoundary><BrowserRouter>
    {entry.error ? <main className="k-page"><p role="alert">{en ? 'This registration link is invalid or expired.' : entry.error}</p>
      <button type="button" className="k-btn" onClick={dismissPairing}>{en ? 'Close' : '閉じる'}</button></main>
      : <UnifiedEntry><RemoteSetup entry={entry} onDismiss={dismissPairing}>{null}</RemoteSetup></UnifiedEntry>}
  </BrowserRouter></AppErrorBoundary>;
}
