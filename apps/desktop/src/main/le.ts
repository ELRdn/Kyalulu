// LE (Kyalulu Local Engine) supervision.
// - An LE that is already healthy is treated as external and left alive on quit.
// - Otherwise, when KYALULU_LE_BINARY is set, LE is spawned as an owned child and
//   stopped via POST /le/v1/shutdown (kill as fallback) on quit.
// The renderer only ever sees status, never the LE token.
import { spawn, type ChildProcess } from "child_process";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type LEState = "disabled" | "starting" | "owned" | "external" | "unavailable" | "exited";

const LE_URL = (process.env["LE_API_URL"] || "http://127.0.0.1:8130").replace(/\/+$/, "").replace(/\/v1$/, "");
const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;

let child: ChildProcess | null = null;
let state: LEState = "disabled";
let lastError: string | undefined;

function tokenFile(): string {
  if (process.env["LE_TOKEN_FILE"]) return process.env["LE_TOKEN_FILE"];
  if (process.env["LE_DATA_DIR"]) return join(process.env["LE_DATA_DIR"], "api-token");
  const root =
    process.platform === "win32"
      ? process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local")
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share");
  return join(root, "kyalulu-le", "api-token");
}

function readToken(): string {
  if (process.env["LE_API_TOKEN"]) return process.env["LE_API_TOKEN"];
  try {
    return readFileSync(tokenFile(), "utf-8").trim();
  } catch {
    return "";
  }
}

async function call(path: string, method = "GET", timeoutMs = 2_000): Promise<Response | null> {
  const token = readToken();
  if (!token) return null;
  try {
    return await fetch(`${LE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    return null;
  }
}

async function healthy(): Promise<boolean> {
  const res = await call("/le/v1/health");
  return !!res && res.ok;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startLE(): Promise<LEState> {
  if (await healthy()) {
    state = "external";
    return state;
  }
  const binary = process.env["KYALULU_LE_BINARY"];
  if (!binary) {
    state = "disabled";
    return state;
  }
  const port = new URL(LE_URL).port || "8130";
  state = "starting";
  const proc = spawn(binary, [], {
    env: { ...process.env, LE_API_PORT: port },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  child = proc;
  proc.stderr?.on("data", (d) => process.stderr.write(`[le] ${d}`));
  proc.on("error", (e) => {
    lastError = String(e);
  });
  proc.on("exit", (code) => {
    if (child === proc) child = null;
    if (state !== "unavailable") state = "exited";
    if (code) lastError = `LE exited with code ${code}`;
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline && child === proc) {
    if (await healthy()) {
      state = "owned";
      return state;
    }
    await delay(250);
  }
  lastError ??= "LE did not become healthy in time";
  state = "unavailable";
  if (child === proc) proc.kill();
  return state;
}

export async function stopLE(): Promise<void> {
  const proc = child;
  if (!proc || state !== "owned") return;
  const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));
  await call("/le/v1/shutdown", "POST");
  const timedOut = await Promise.race([exited.then(() => false), delay(STOP_TIMEOUT_MS).then(() => true)]);
  if (timedOut) proc.kill();
  state = "exited";
}

export async function leStatus(): Promise<{ state: LEState; url: string; healthy: boolean; error?: string }> {
  return { state, url: LE_URL, healthy: state === "disabled" ? false : await healthy(), error: lastError };
}
