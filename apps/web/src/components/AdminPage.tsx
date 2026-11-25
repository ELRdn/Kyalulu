import type { ReactNode } from 'react';
import { useAdministrative } from './RuntimeGate';
import { useLanguage } from '../lib/appContext';

export default function AdminPage({ children }: { children: ReactNode }) {
  const en = useLanguage() === 'en';
  return useAdministrative() ? children : <div className="k-page"><h1>{en ? 'This feature requires PC management access' : 'サーバー側で管理する機能です'}</h1><p>{en ? 'Open model management, diagnostics and comparison experiments on the PC running the server. Character creation and conversations are available on this device.' : 'モデルの管理・診断・比較実験は、サーバーを実行しているPCで開いてください。この端末ではキャラの作成と会話を楽しめます。'}</p></div>;
}
