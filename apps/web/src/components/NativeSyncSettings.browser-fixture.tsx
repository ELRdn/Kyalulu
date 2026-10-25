/** Disposable local-PC settings screen, driven by the isolated ASGI fixture. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import NativeSyncSettings from './NativeSyncSettings';
import { preferences, savePreferences } from '../lib/appContext';
import { setCloud } from '../lib/cloudMode';
import '../index.css';

export function mount(node: HTMLElement, language: 'ja' | 'en', theme: 'light' | 'dark') {
  localStorage.setItem('kyalulu-execution-target', 'local'); setCloud(false);
  savePreferences({ ...preferences(), language }); document.documentElement.dataset.theme = theme;
  const root = createRoot(node);
  root.render(<StrictMode><main style={{ maxWidth: 900, margin: 'auto', padding: 16 }}><NativeSyncSettings /></main></StrictMode>);
  return () => root.unmount();
}
