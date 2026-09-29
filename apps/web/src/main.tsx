import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ThemeProvider } from "./lib/theme";
import RuntimeGate from "./components/RuntimeGate";
import AppErrorBoundary from './components/AppErrorBoundary';
import MobileAppStatus from './components/MobileAppStatus';
import RemoteSetup, { RemoteBanner } from './components/RemoteSetup';
import { takePairing } from './lib/remotePairing';

const remoteEntry = takePairing();

// HashRouterを使用: apps/desktop (Electron) の本番ビルドは file:// から配信されるため、
// history APIに依存するBrowserRouterでは静的配信時にルートが404になる。
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary><ThemeProvider>
      <HashRouter>
        <div className="k-pwa-root"><MobileAppStatus /><RemoteSetup entry={remoteEntry}><RemoteBanner /><RuntimeGate><App /></RuntimeGate></RemoteSetup></div>
      </HashRouter>
    </ThemeProvider></AppErrorBoundary>
  </React.StrictMode>,
);
