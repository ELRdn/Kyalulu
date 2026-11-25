'use client';

import { HashRouter, Route, Routes } from 'react-router-dom';
import AppErrorBoundary from '../../../web/src/components/AppErrorBoundary';
import MobileAppStatus from '../../../web/src/components/MobileAppStatus';
import RuntimeGate from '../../../web/src/components/RuntimeGate';
import UnifiedEntry from '../../../web/src/components/UnifiedEntry';
import RemoteSetup, { RemoteBanner } from '../../../web/src/components/RemoteSetup';
import { takePairing } from '../../../web/src/lib/remotePairing';
import AppShell from '../../../web/src/layout/AppShell';
import Migration from '../../../web/src/pages/Migration';
import NotFound from '../../../web/src/pages/NotFound';
import { screenPaths, ScreenView } from '../_runtime/views';
import '../../../web/src/index.css';

const entry = takePairing();

export default function DeviceApplication() {
  return <AppErrorBoundary><HashRouter>
    <div className="k-pwa-root"><MobileAppStatus local quiet /><UnifiedEntry><RemoteSetup entry={entry}>
      <RemoteBanner /><RuntimeGate><Routes><Route element={<AppShell />}>
        {screenPaths.map(path => <Route key={path} path={path} element={<ScreenView path={path} />} />)}
        <Route path="/migration" element={<Migration />} />
        <Route path="*" element={<NotFound />} />
      </Route></Routes></RuntimeGate>
    </RemoteSetup></UnifiedEntry></div>
  </HashRouter></AppErrorBoundary>;
}
