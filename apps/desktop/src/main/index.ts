import { app, BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";

let mainWindow: BrowserWindow | null = null;

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
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // 案A: 薄ラッパー — 既存の Vite dev server or ビルド済み renderer を表示
  // dev: http://localhost:5173 (web) をそのまま表示、prod: out/renderer/index.html
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else if (is.dev) {
    // フォールバック: web の dev server を直接表示（案A）
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Researcher時のみ DevTools を許可（Ctrl+Shift+I はデフォルトで有効）
  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.kyalulu.app");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC: 将来の Python sidecar 用に app path などを公開
  ipcMain.handle("get-app-path", () => app.getAppPath());
  ipcMain.handle("get-api-base", () => process.env["KYALULU_API_BASE"] || "http://127.0.0.1:8000");
  ipcMain.handle("check-python-health", async () => {
    const base = process.env["KYALULU_API_BASE"] || "http://127.0.0.1:8000";
    try {
      const res = await fetch(`${base}/api/health`);
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
