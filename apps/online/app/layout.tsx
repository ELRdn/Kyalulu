import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import './online.css';
import { initialLanguage } from './language';
import { PairingBoundary } from './_runtime/PairingBoundary';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Kyalulu' },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', interactiveWidget: 'resizes-content',
  themeColor: '#0E0D12', colorScheme: 'dark',
};

export default async function Layout({ children }: { children: ReactNode }) {
  return <html lang={await initialLanguage()} data-theme="dark" data-kyalulu-frontend="next"><body><PairingBoundary>{children}</PairingBoundary></body></html>;
}
