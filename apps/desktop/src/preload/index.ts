import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getAppPath: (): Promise<string> => ipcRenderer.invoke("get-app-path"),
  getApiBase: (): Promise<string> => ipcRenderer.invoke("get-api-base"),
  checkPythonHealth: (): Promise<{ ok: boolean; status?: number; error?: string }> =>
    ipcRenderer.invoke("check-python-health"),
  platform: process.platform
});

declare global {
  interface Window {
    electronAPI?: {
      getAppPath: () => Promise<string>;
      getApiBase: () => Promise<string>;
      checkPythonHealth: () => Promise<{ ok: boolean; status?: number; error?: string }>;
      platform: string;
    };
  }
}
