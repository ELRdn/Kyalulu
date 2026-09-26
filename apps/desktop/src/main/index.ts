import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { leStatus, startLE, stopLE } from "./le";
import { API_BASE, apiStatus, startAPI, stopAPI } from "./api";
import { installProtocol } from "./protocol";

let mainWindow: BrowserWindow | null = null;
let quitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: join(__dirname, "../../resources/icon.ico"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (/^https?:\/\//i.test(details.url)) void shell.openExternal(details.url);
    return { action: "deny" };
  });

  // 案A: 薄ラッパー — 既存の Vite dev server or ビルド済み renderer を表示
  // dev: http://localhost:5173 (web) をそのまま表示、prod: out/renderer/index.html
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadURL("app://kyalulu/index.html");
  }

  // Researcher時のみ DevTools を許可（Ctrl+Shift+I はデフォルトで有効）
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(async () => {
  installProtocol(join(__dirname, "../renderer"));
  electronApp.setAppUserModelId("com.kyalulu.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC: 将来の Python sidecar 用に app path などを公開
  ipcMain.handle("get-app-path", () => app.getAppPath());
  ipcMain.handle("get-api-base", () => API_BASE);
  ipcMain.handle("check-python-health", async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("get-le-status", () => leStatus());
  ipcMain.handle("get-supervision", async () => ({ api: await apiStatus(), le: await leStatus() }));

  // Startup order: LE first (the API reads its token), then the API, then the renderer.
  const le = await startLE();
  if (quitting) return;
  console.log(`[le] ${le}`);
  // Packaged builds keep data under userData; development keeps the repository's data.db.
  const api = await startAPI({
    searchFrom: app.getAppPath(),
    dataDir: app.isPackaged ? join(app.getPath("userData"), "data") : undefined
  });
  if (quitting) return;
  console.log(`[api] ${api}`);

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

let stopped = false;
app.on("before-quit", (event) => {
  if (stopped) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  // API first so nothing is mid-request to LE when LE goes away.
  stopAPI()
    .then(() => stopLE())
    .finally(() => {
      stopped = true;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
