// Python API (Kyalulu Runtime) supervision.
// - An API that already answers /api/health is treated as external and left alive on quit.
// - Otherwise it is started as an owned child: KYALULU_API_COMMAND when set, else uvicorn from
//   the repository's .venv, else `uv run`. The owned process tree is stopped on quit.
// Data stays where the API keeps it (KYALULU_DATA_DIR, or the repository default in development),
// so history and library come back after a restart of the app or of Windows.
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";

export type APIState = "starting" | "owned" | "external" | "unavailable" | "exited";

export const API_BASE = (process.env["KYALULU_API_BASE"] || "http://127.0.0.1:8000").replace(/\/+$/, "");
const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 5_000;

let child: ChildProcess | null = null;
let state: APIState = "exited";
let lastError: string | undefined;
let starting: Promise<APIState> | null = null;
let stopping: Promise<void> | null = null;
let generation = 0;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function apiHealthy(timeoutMs = 2_000): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return false;
    const body = await res.json();
    return body.status === "ok" && typeof body.runtime === "string";
  } catch {
    return false;
  }
}

/** The repository root: KYALULU_REPO_ROOT, or the first parent of `from` holding the runtime. */
export function findRepoRoot(from: string): string | null {
  const env = process.env["KYALULU_REPO_ROOT"];
  if (env) return existsSync(join(env, "runtime", "python", "api", "main.py")) ? env : null;
  let dir = resolve(from);
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "runtime", "python", "api", "main.py"))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export function apiCommand(root: string, port: string): { cmd: string; args: string[]; shell: boolean } {
  const custom = process.env["KYALULU_API_COMMAND"];
  if (custom) return { cmd: custom, args: [], shell: true };
  const uvicorn = ["-m", "uvicorn", "python.api.main:app", "--app-dir", "runtime", "--host", "127.0.0.1", "--port", port];
  const venv = process.platform === "win32" ? join(root, ".venv", "Scripts", "python.exe") : join(root, ".venv", "bin", "python");
  if (existsSync(venv)) return { cmd: venv, args: uvicorn, shell: false };
  return { cmd: "uv", args: ["run", "--package", "kyalulu-runtime", "python", ...uvicorn], shell: false };
}

export async function startAPI(opts: { searchFrom: string; dataDir?: string }): Promise<APIState> {
  if (stopping) await stopping;
  if (starting) return starting;
  if (child) return state;
  const pending = launchAPI(opts, generation);
  starting = pending;
  try { return await pending; }
  finally { if (starting === pending) starting = null; }
}

async function launchAPI(opts: { searchFrom: string; dataDir?: string }, current: number): Promise<APIState> {
  const healthy = await apiHealthy();
  if (current !== generation) return state;
  if (healthy) {
    state = "external";
    return state;
  }
  const url = new URL(API_BASE);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/") {
    lastError = "The configured API is unavailable; automatic startup requires a local HTTP URL";
    state = "unavailable";
    return state;
  }
  const root = findRepoRoot(opts.searchFrom);
  if (!root && !process.env["KYALULU_API_COMMAND"]) {
    lastError = "Kyalulu runtime not found; set KYALULU_REPO_ROOT or KYALULU_API_COMMAND";
    state = "unavailable";
    return state;
  }
  const port = url.port || "80";
  const { cmd, args, shell } = apiCommand(root ?? process.cwd(), port);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts.dataDir && !env["KYALULU_DATA_DIR"]) env["KYALULU_DATA_DIR"] = opts.dataDir;
  if (env["KYALULU_DATA_DIR"] && !env["KYALULU_EXPERIMENTS_DIR"]) {
    env["KYALULU_EXPERIMENTS_DIR"] = join(env["KYALULU_DATA_DIR"], "experiments");
  }
  state = "starting";
  lastError = undefined;
  const proc = spawn(cmd, args, { cwd: root ?? undefined, env, shell, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child = proc;
  proc.stdout?.on("data", (d) => process.stdout.write(`[api] ${d}`));
  proc.stderr?.on("data", (d) => process.stderr.write(`[api] ${d}`));
  proc.on("error", (e) => {
    if (child !== proc) return;
    lastError = String(e);
    child = null;
  });
  proc.on("exit", (code) => {
    if (child !== proc) return;
    child = null;
    if (state !== "unavailable") state = "exited";
    if (code) lastError = `API exited with code ${code}`;
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline && child === proc && current === generation) {
    const healthy = await apiHealthy();
    if (current !== generation) return state;
    if (healthy && child === proc) {
      state = "owned";
      return state;
    }
    await delay(300);
  }
  if (current !== generation) return state;
  lastError ??= "API did not become healthy in time";
  state = "unavailable";
  killTree(proc);
  return state;
}

/** uv and shells start the server as a grandchild; stop the whole tree. */
function killTree(proc: ChildProcess): void {
  if (proc.pid === undefined || proc.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
  } else {
    proc.kill("SIGTERM");
  }
}

export async function stopAPI(): Promise<void> {
  if (stopping) return stopping;
  generation++;
  const pending = stopOwnedAPI();
  stopping = pending;
  try { await pending; }
  finally { if (stopping === pending) stopping = null; }
}

async function stopOwnedAPI(): Promise<void> {
  const proc = child;
  if (proc) {
    const exited = new Promise<void>((r) => proc.once("exit", () => r()));
    killTree(proc);
    await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
    if (child === proc) child = null;
  }
  if (state !== "external") state = "exited";
  await starting;
}

export async function apiStatus(): Promise<{ state: APIState; url: string; healthy: boolean; error?: string }> {
  return { state, url: API_BASE, healthy: await apiHealthy(), error: lastError };
}
