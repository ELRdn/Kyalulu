'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type ReactNode } from 'react';
import type { CharacterOpening } from '../../../web/src/lib/characterHandoff';
import type { ScreenPath } from './views';
import { runtimeModule } from './chatRouteModules';

const DeferredRuntime = dynamic(runtimeModule.load, { ssr: false });

export function ScreenClient({ path, preview, pending, opening }: {
  path: ScreenPath; preview?: ReactNode; pending: ReactNode; opening?: CharacterOpening;
}) {
  // Choose once per mount so becoming warm cannot remount a live runtime.
  const [Runtime] = useState(() => runtimeModule.current() ?? DeferredRuntime);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!preview) return;
    const recheck = (event: PageTransitionEvent) => { if (event.persisted) location.reload(); };
    window.addEventListener('pageshow', recheck);
    return () => window.removeEventListener('pageshow', recheck);
  }, [preview]);
  return <>{!ready && (preview ?? pending)}<Runtime path={path} opening={opening} pending={pending} onReady={setReady} /></>;
}
