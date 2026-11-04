import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ThemeProvider } from "./lib/theme";
import RuntimeGate from "./components/RuntimeGate";
import AppErrorBoundary from './components/AppErrorBoundary';
import MobileAppStatus from './components/MobileAppStatus';
import RemoteSetup, { RemoteBanner } from './components/RemoteSetup';
import { takePairing } from './lib/remotePairing';
import UnifiedEntry, { ExecutionPicker } from './components/UnifiedEntry';
import { executionTarget, isDesktop } from './lib/appContext';

const remoteEntry = takePairing();

// Electron (app://) と /device/ シェルにはSPAフォールバックがないため、ハッシュ経路を残す。
const hashRouting = isDesktop() || location.pathname.startsWith('/device/');
// 旧URL・PWAのstart_url・サーバーのリダイレクト（/#/profile 等）をパスへ読み替える。
if (!hashRouting && location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
const Router = hashRouting ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary><ThemeProvider>
      <Router>
        <div className="k-pwa-root"><MobileAppStatus local={executionTarget()==='device'} quiet /><UnifiedEntry><ExecutionPicker /><RemoteSetup entry={remoteEntry}><RemoteBanner /><RuntimeGate><App /></RuntimeGate></RemoteSetup></UnifiedEntry></div>
      </Router>
    </ThemeProvider></AppErrorBoundary>
  </React.StrictMode>,
);
