import { useEffect, useState } from "react";
import { fetchProvidersHealth, type ProviderHealth } from "../lib/api";

function dotColor(status: string) {
  if (status === "ok") return "#22c55e";
  if (status === "offline") return "#ef4444";
  if (status === "not_configured") return "#9ca3af";
  return "#f59e0b";
}

function labelJa(status: string) {
  if (status === "ok") return "接続OK";
  if (status === "offline") return "オフライン";
  if (status === "not_configured") return "未設定";
  return status;
}

export default function ProviderStatus() {
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
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>Provider 状態</div>
        <button
          onClick={load}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #e5e7eb", background: "#f9fafb", cursor: "pointer" }}
        >
          再確認
        </button>
      </div>
      {loading ? (
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>確認中...</div>
      ) : (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {health.map((h) => (
            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 8, height: 8, borderRadius: 99, background: dotColor(h.status), display: "inline-block" }} />
              <span style={{ fontWeight: 600, minWidth: 120 }}>{h.id}</span>
              <span style={{ color: "#6b7280" }}>{labelJa(h.status)}</span>
              <span style={{ color: "#9ca3af", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.base_url ?? ""}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
            `{"{"}` .env で `OLLAMA_URL` / `LM_STUDIO_URL` / `OPENAI_COMPATIBLE_URL` を設定
          </div>
        </div>
      )}
    </div>
  );
}
