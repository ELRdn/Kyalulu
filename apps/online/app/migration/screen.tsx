'use client';

import dynamic from 'next/dynamic';
import AppErrorBoundary from '../../../web/src/components/AppErrorBoundary';
import '../../../web/src/index.css';

const Migration = dynamic(() => import('../../../web/src/pages/Migration'), { ssr: false });

export function MigrationScreen() {
  return <AppErrorBoundary><Migration /></AppErrorBoundary>;
}
