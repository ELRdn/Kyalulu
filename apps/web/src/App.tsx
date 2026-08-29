import { useEffect, useState } from "react";
import ChatPage from "./pages/Chat";
import ProviderStatus from "./components/ProviderStatus";
import { fetchHealth } from "./lib/api";

type Tab = "chat" | "status";

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [health, setHealth] = useState<string>("確認中...");

  useEffect(() => {
    fetchHealth()
      .then((d) => setHealth(`${d.status} (v${d.version})`))
      .catch(() => setHealth("未接続 (API起動前)"));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ヘッダー */}
      <header
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          borderBottom: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>My Zeta</div>
          <span style={{ fontSize: 11, color: "#9ca3af", border: "1px solid #e5e7eb", padding: "2px 6px", borderRadius: 99 }}>
            Milestone 2
          </span>
          <span style={{ fontSize: 11, color: "#6b7280" }}>{health}</span>
        </div>
        <nav style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setTab("chat")}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: tab === "chat" ? "#111827" : "#fff",
              color: tab === "chat" ? "#fff" : "#374151",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            チャット
          </button>
          <button
            onClick={() => setTab("status")}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: tab === "status" ? "#111827" : "#fff",
              color: tab === "status" ? "#fff" : "#374151",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ステータス
          </button>
        </nav>
      </header>

      {/* メイン */}
      <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "chat" ? (
          <ChatPage />
        ) : (
          <div style={{ padding: 16, maxWidth: 720, margin: "0 auto", width: "100%", display: "grid", gap: 16 }}>
            <ProviderStatus />
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#fff" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>使い方</div>
              <ol style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: "#374151", lineHeight: 1.8 }}>
                <li>
                  <code>.env</code> を作成: <code>.env.example</code> をコピー
                </li>
                <li>
                  外部APIで試すなら <code>OPENAI_COMPATIBLE_URL</code> と <code>OPENAI_COMPATIBLE_API_KEY</code> を設定
                </li>
                <li>
                  ローカルLLMなら Ollama (<code>ollama serve</code>) / LM Studio を起動
                </li>
                <li>何もなくても Mock Echo でUI動作確認できるよ</li>
              </ol>
            </div>
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 16, background: "#f9fafb" }}>
              <div style={{ fontSize: 12, color: "#6b7280" }}>API</div>
              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, lineHeight: 1.6 }}>
                <div>
                  <code>GET /api/health</code> / <code>GET /api/models</code> / <code>GET /api/providers/health</code>
                </div>
                <div>
                  <code>POST /api/chat/stream</code> (SSE) / <code>POST /api/chat</code> (non-stream) /{" "}
                  <code>GET /api/chat/history</code>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
