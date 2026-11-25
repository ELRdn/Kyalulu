'use client';

import dynamic from 'next/dynamic';

export const DeviceScreen = dynamic(() => import('./DeviceApplication'), { ssr: false });
