import { useEffect, useState } from "react";
import { fetchProvidersHealth, type ProviderHealth } from "../lib/api";
import { useLanguage } from "../lib/appContext";

function dotColor(status: string) {
  if (status === "ok") return "#22c55e";
  if (status === "offline") return "#ef4444";
  if (status === "not_configured") return "#9ca3af";
  return "#f59e0b";
}

function statusLabel(status: string, en: boolean) {
  if (status === "ok") return en ? "Connected" : "接続OK";
  if (status === "offline") return en ? "Offline" : "オフライン";
  if (status === "not_configured") return en ? "Not configured" : "未設定";
  if (status === "unauthorized") return en ? "Authentication failed" : "認証失敗";
  return status;
}

export default function ProviderStatus() {
  const en = useLanguage() === 'en';
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const h = await fetchProvidersHealth();
      setHealth(h);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--bg-card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>{en ? 'Provider status' : 'Provider 状態'}</div>
        <button
          onClick={load}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer" }}
        >
          {en ? 'Recheck' : '再確認'}
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{en ? 'Checking...' : '確認中...'}</div>
      ) : (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {health.map((h) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor(h.status), display: "inline-block" }} />
              <span style={{ fontWeight: 600, minWidth: 120, color: "var(--text)" }}>{h.id}</span>
              <span style={{ color: "var(--text-faint)" }}>{statusLabel(h.status, en)}</span>
              <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.base_url ?? ""}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
            {en ? 'Configure destinations in .env using ' : '接続先は .env の '}<code>OLLAMA_URL</code> / <code>LM_STUDIO_URL</code> / <code>OPENAI_COMPATIBLE_URL</code>{en ? '.' : ' で設定します'}
          </div>
        </div>
      )}
    </div>
  );
}
