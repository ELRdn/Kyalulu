import type { ModelInfo } from "../lib/api";

export default function ModelSelector({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <label style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap" }}>モデル</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          background: "#fff",
          fontSize: 13,
        }}
      >
        {models.length === 0 && <option value="">読込中...</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name} — {m.provider_type} {m.quantization ? `(${m.quantization})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
