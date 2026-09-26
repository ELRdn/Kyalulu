import { useEffect, useState } from "react";
import { fetchDiagnostics, type DiagnosticCheck } from "../lib/api";
import Card from "./ui/Card";

const LABELS: Record<string, string> = {
  api: "API",
  storage: "保存データ",
  providers: "会話エンジン",
  le: "LE",
  le_engine: "LE 内蔵モデル",
  le_models: "LE 会話用モデル",
  desktop_api: "Desktop: API",
  desktop_le: "Desktop: LE"
};

function dot(ok: boolean | null) {
  if (ok === true) return "var(--success, #22c55e)";
  if (ok === false) return "var(--error-text, #ef4444)";
  return "var(--text-dim, #9ca3af)";
}

type DesktopStatus = { state: string; healthy: boolean; error?: string };

type DesktopBridge = { getSupervision?: () => Promise<{ api: DesktopStatus; le: DesktopStatus }> };

/** Desktop が監督している API / LE の状態を、診断の行として足す（ブラウザでは何もしない）。 */
async function desktopChecks(): Promise<DiagnosticCheck[]> {
  const api = (window as unknown as { electronAPI?: DesktopBridge }).electronAPI;
  if (!api?.getSupervision) return [];
  const s = await api.getSupervision();
  const row = (id: string, x: DesktopStatus): DiagnosticCheck => ({
    id,
    ok: x.state === "disabled" ? null : x.healthy,
    message: `${x.state}${x.healthy ? "（応答あり）" : ""}`,
    hint: x.error ?? null,
    detail: null
  });
  return [row("desktop_api", s.api), row("desktop_le", s.le)];
}

export default function Diagnostics() {
  const [checks, setChecks] = useState<DiagnosticCheck[] | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setFailed(false);
    const desktop = await desktopChecks().catch(() => []);
    try {
      const d = await fetchDiagnostics();
      setChecks([...d.checks, ...desktop]);
      setReady(d.ready);
    } catch {
      setChecks(desktop);
      setReady(false);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>接続診断</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            {checks === null ? "確認中..." : failed ? "API に接続できません。API が起動しているか確認してね。" : ready ? "会話できる状態です" : "会話の前に対処が必要です"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer" }}
        >
          再診断
        </button>
      </div>
      {checks && checks.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
          {checks.map((c) => (
            <li key={c.id} style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr)", gap: 8, fontSize: 12 }}>
              <span aria-hidden style={{ width: 8, height: 8, marginTop: 5, borderRadius: 99, background: dot(c.ok) }} />
              <div style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>{LABELS[c.id] ?? c.id}</span>
                <span style={{ color: "var(--text-secondary)", marginLeft: 8, overflowWrap: "anywhere" }}>{c.message}</span>
                {c.hint && <div style={{ color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>→ {c.hint}</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
