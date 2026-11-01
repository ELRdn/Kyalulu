import { useEffect, useState } from "react";
import { fetchDiagnostics, type DiagnosticCheck } from "../lib/api";
import { useLanguage } from "../lib/appContext";
import Card from "./ui/Card";

const LABELS: Record<string, [string, string]> = {
  api: ["API", "API"],
  storage: ["保存データ", "Saved data"],
  providers: ["会話エンジン", "Conversation engines"],
  le: ["LE", "LE"],
  le_engine: ["LE 内蔵モデル", "LE built-in model"],
  le_models: ["LE 会話用モデル", "LE conversation models"],
  browser: ["この端末", "This device"],
  desktop_api: ["Desktop: API", "Desktop: API"],
  desktop_le: ["Desktop: LE", "Desktop: LE"],
  desktop_supervision: ["Desktop: 状態確認", "Desktop: supervision"]
};

// Match complete first-party templates within their check; custom evidence stays verbatim.
const ENGLISH: Record<string, Record<string, string>> = {
  api: { "API 稼働中": "API is running" },
  storage: { "KYALULU_DATA_DIR の場所と書き込み権限を確認してね": "Check the KYALULU_DATA_DIR location and write permissions." },
  providers: {
    "直接つながる会話エンジンはありません": "No directly connected conversation engines",
    "Ollama や LM Studio を起動するか、LE 経由のモデルを使ってね": "Start Ollama or LM Studio, or use a model through LE."
  },
  le: {
    "LE は未設定（トークンなし）": "LE is not configured (no token)",
    "LE を使うなら le-daemon を起動するか、Desktop で KYALULU_LE_BINARY を設定してね": "To use LE, start le-daemon or set KYALULU_LE_BINARY in Desktop.",
    "LE がトークンを拒否しました": "LE rejected the token",
    "LE の api-token と Kyalulu の LE_API_TOKEN が一致しているか確認してね": "Check that LE's api-token matches Kyalulu's LE_API_TOKEN.",
    "le-daemon が起動しているか、LE_API_URL を確認してね": "Check that le-daemon is running and verify LE_API_URL."
  },
  le_models: {
    "会話用モデルは配信されていません": "No conversation models are being served",
    "/le models で確認し、/le load <id> でモデルをロードしてね": "Check /le models and load a model with /le load <id>."
  },
  le_engine: {
    "内蔵エンジン（llama-server）は未設定": "The built-in engine (llama-server) is not configured",
    "GGUF を LE で直接動かすなら LE_LLAMA_SERVER_BIN を設定してね": "To run GGUF directly in LE, set LE_LLAMA_SERVER_BIN.",
    "内蔵モデルはロードされていません": "No built-in model is loaded",
    "内蔵モデルは未インストール": "No built-in model is installed",
    "/le download <GGUFのURL> でダウンロードできるよ": "Download a model with /le download <GGUF URL>."
  }
};

const STATES: Record<string, [string, string]> = {
  disabled: ["無効", "Disabled"], starting: ["起動中", "Starting"],
  owned: ["Desktop が起動", "Started by Desktop"], external: ["外部で稼働", "Running externally"],
  unavailable: ["利用不可", "Unavailable"], exited: ["終了", "Exited"]
};

const DESKTOP_ERRORS: Record<string, string> = {
  "The configured API is unavailable; automatic startup requires a local HTTP URL": "設定された API は利用できません。自動起動にはローカルの HTTP URL が必要です",
  "Kyalulu runtime not found; set KYALULU_REPO_ROOT or KYALULU_API_COMMAND": "Kyalulu ランタイムが見つかりません。KYALULU_REPO_ROOT または KYALULU_API_COMMAND を設定してください",
  "API did not become healthy in time": "API の応答確認がタイムアウトしました",
  "LE did not become healthy in time": "LE の応答確認がタイムアウトしました"
};

type Check = DiagnosticCheck & { desktop?: DesktopStatus };

function known<T>(values: Record<string, T> | undefined, key: string): T | undefined {
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}

function checkText(c: Check, en: boolean) {
  const translations = known(ENGLISH, c.id);
  let message = en ? known(translations, c.message) ?? c.message : c.message;
  let hint = en && c.hint ? known(translations, c.hint) ?? c.hint : c.hint;
  const d = c.detail;
  if (c.desktop) {
    message = (known(STATES, c.desktop.state)?.[en ? 1 : 0] ?? c.desktop.state) + (c.desktop.healthy ? en ? " (responding)" : "（応答あり）" : "");
    if (!en && hint) {
      const exit = hint.match(/^(API|LE) exited with code (-?\d+)$/);
      hint = known(DESKTOP_ERRORS, hint) ?? (exit ? `${exit[1]} がコード ${exit[2]} で終了しました` : hint);
    }
  } else if (!en && c.id === "desktop_supervision" && c.message === "Could not read Desktop supervision status") {
    message = "Desktop の状態を取得できません";
  } else if (!en && c.id === "browser" && c.message === "On-device runtime") {
    message = "端末内ランタイム";
  } else if (en) {
    let match: RegExpMatchArray | null;
    if (c.id === "storage") {
      if ((match = c.message.match(/^会話 (\d+) 件・ライブラリ (\d+) 件を保存済み$/))) {
        const sessions = typeof d?.sessions === "number" ? d.sessions : match[1];
        const library = typeof d?.library_versions === "number" ? d.library_versions : match[2];
        message = `Saved conversations: ${sessions}; library entries: ${library}`;
      } else if ((match = c.message.match(/^データベースを読めません（([^\r\n]+)）$/))) {
        message = `Cannot read the database (${match[1]})`;
      }
    } else if (c.id === "providers" && (match = c.message.match(/^直接つながるエンジン: (.+)$/))) {
      message = `Directly connected engines: ${match[1]}`;
    } else if (c.id === "le") {
      if ((match = c.message.match(/^LE 稼働中（(.+)）$/))) {
        message = `LE is running (${match[1]})`;
      } else if ((match = c.message.match(/^LE に接続できません（([^\r\n]+)）$/))) {
        message = `Cannot connect to LE (${match[1]})`;
      }
    } else if (c.id === "le_models" && (match = c.message.match(/^会話用モデル (\d+) 件$/))) {
      message = `Conversation models: ${match[1]}`;
    } else if (c.id === "le_engine") {
      if (typeof d?.model === "string" && c.message === `${d.model} をロード中`) {
        message = `Loaded model: ${d.model}`;
      }
      const model = Array.isArray(d?.installed) ? d.installed[0] : undefined;
      if (typeof model === "string" && c.hint === `チャット欄で /le load ${model} を実行するとロードできるよ`) {
        hint = `Load it by running /le load ${model} in chat.`;
      }
    }
  }
  return { message, hint };
}

function dot(ok: boolean | null) {
  if (ok === true) return "var(--success, #22c55e)";
  if (ok === false) return "var(--error-text, #ef4444)";
  return "var(--text-dim, #9ca3af)";
}

type DesktopStatus = { state: string; healthy: boolean; error?: string };

type DesktopBridge = { getSupervision?: () => Promise<{ api: DesktopStatus; le: DesktopStatus }> };

/** Desktop が監督している API / LE の状態を、診断の行として足す（ブラウザでは何もしない）。 */
async function desktopChecks(): Promise<Check[]> {
  const api = (window as unknown as { electronAPI?: DesktopBridge }).electronAPI;
  if (!api?.getSupervision) return [];
  const s = await api.getSupervision();
  const row = (id: string, x: DesktopStatus): Check => ({
    id,
    ok: x.state === "disabled" ? null : x.healthy,
    message: x.state,
    hint: x.error ?? null,
    detail: null,
    desktop: x
  });
  return [row("desktop_api", s.api), row("desktop_le", s.le)];
}

export default function Diagnostics() {
  const en = useLanguage() === "en";
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setFailed(null);
    const desktop = await desktopChecks().catch((error: unknown): Check[] => [{
      id: "desktop_supervision", ok: false, message: "Could not read Desktop supervision status", detail: null,
      hint: error instanceof Error ? error.message : String(error)
    }]);
    try {
      const d = await fetchDiagnostics();
      setChecks([...d.checks, ...desktop]);
      setReady(d.ready);
    } catch (error) {
      setChecks(desktop);
      setReady(false);
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const summary = busy || checks === null ? en ? "Checking..." : "確認中..."
    : failed !== null ? en ? "Cannot connect to the API. Check that it is running." : "API に接続できません。API が起動しているか確認してね。"
    : ready ? en ? "Ready to chat" : "会話できる状態です"
    : en ? "Action is needed before chatting" : "会話の前に対処が必要です";

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{en ? "Connection diagnostics" : "接続診断"}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {summary}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer" }}
        >
          {en ? "Refresh diagnostics" : "再診断"}
        </button>
      </div>
      {failed !== null && <div role="alert" style={{ fontSize: 12, overflowWrap: "anywhere" }}>{failed}</div>}
      {checks && checks.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
          {checks.map((c) => {
            const { message, hint } = checkText(c, en);
            return (
              <li key={c.id} style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr)", gap: 8, fontSize: 12 }}>
                <span aria-hidden style={{ width: 8, height: 8, marginTop: 5, borderRadius: 99, background: dot(c.ok) }} />
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{known(LABELS, c.id)?.[en ? 1 : 0] ?? c.id}</span>
                  <span style={{ color: "var(--text-secondary)", marginLeft: 8, overflowWrap: "anywhere" }}>{message}</span>
                  {hint && <div style={{ color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>→ {hint}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
