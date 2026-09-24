import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  getAppPath: (): Promise<string> => ipcRenderer.invoke("get-app-path"),
  getApiBase: (): Promise<string> => ipcRenderer.invoke("get-api-base"),
  checkPythonHealth: (): Promise<{ ok: boolean; status?: number; error?: string }> =>
    ipcRenderer.invoke("check-python-health"),
  getLEStatus: (): Promise<LEStatus> => ipcRenderer.invoke("get-le-status"),
  platform: process.platform
});

type LEStatus = {
  state: "disabled" | "starting" | "owned" | "external" | "unavailable" | "exited";
  url: string;
  healthy: boolean;
  error?: string;
};

declare global {
  interface Window {
    electronAPI?: {
      getAppPath: () => Promise<string>;
      getApiBase: () => Promise<string>;
      checkPythonHealth: () => Promise<{ ok: boolean; status?: number; error?: string }>;
      getLEStatus: () => Promise<LEStatus>;
      platform: string;
    };
  }
}
