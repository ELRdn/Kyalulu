import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState<string>("確認中...");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setHealth(`${d.status} (v${d.version})`))
      .catch(() => setHealth("未接続 (API起動前)"));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>My Zeta — Skeleton</h1>
      <p style={{ color: "#666", marginTop: 8 }}>
        Local-first Character AI Runtime / Benchmark — 土台構築中
      </p>

      <div
        style={{
          marginTop: 24,
          padding: 16,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
        }}
      >
        <div style={{ fontSize: 14, color: "#6b7280" }}>Runtime API</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{health}</div>
        <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 8 }}>
          API: <code>http://127.0.0.1:8000/api/health</code> / Web: <code>http://localhost:5173</code>
        </div>
      </div>

      <div style={{ marginTop: 32, display: "grid", gap: 12 }}>
        <section style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>次のステップ</h2>
          <ul style={{ marginTop: 8, paddingLeft: 20, color: "#374151", lineHeight: 1.8 }}>
            <li>Research Mode: A/B/C グリッド</li>
            <li>Prompt / State / Token Budget Inspector</li>
            <li>ベンチマーク実行 (20ターン × 3ラン)</li>
          </ul>
        </section>
        <section style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 12 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>仕様</h2>
          <p style={{ marginTop: 8, color: "#374151" }}>
            詳細は <code>PROJECT_SPEC.md</code> を参照。現在 v0.1 Definition of Done に向けて骨組みを構築中。
          </p>
        </section>
      </div>
    </div>
  );
}
