import { useEffect, useRef, useState } from "react";
import { fetchModels, streamChat, type ModelInfo, type ChatMessage } from "../lib/api";
import ModelSelector from "../components/ModelSelector";

export default function ChatPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const reloadModels = () => {
    fetchModels()
      .then((ms) => {
        setModels(ms);
        if (ms.length > 0 && !modelId) setModelId(ms[0].id);
      })
      .catch(() => setError("モデル一覧の取得に失敗"));
  };
  useEffect(() => {
    reloadModels();
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text || streaming || !modelId) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    // assistant placeholder
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
    setStreaming(true);
    let acc = "";
    const stop = streamChat(
      modelId,
      next,
      {},
      {
        onToken: (t) => {
          acc += t;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: acc };
            return copy;
          });
        },
        onDone: () => setStreaming(false),
        onError: (e) => {
          setError(e);
          setStreaming(false);
        },
      },
    );
    // stopは必要なら保持 (中断ボタン等)
    void stop;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: 12, borderBottom: "1px solid #e5e7eb", background: "#fff", display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <ModelSelector models={models} value={modelId} onChange={setModelId} />
          </div>
          <button
            onClick={reloadModels}
            title="モデル一覧を再読込"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 12, cursor: "pointer" }}
          >
            ↻
          </button>
        </div>
        {models.find((m) => m.id === modelId) && (
          <div style={{ fontSize: 11, color: "#9ca3af" }}>
            provider: <code>{models.find((m) => m.id === modelId)?.provider_type}</code> / model:{" "}
            <code>{models.find((m) => m.id === modelId)?.provider_model}</code>
          </div>
        )}
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 12, background: "#f9fafb" }}>
        {messages.length === 0 && (
          <div style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            モデルを選んで話しかけてみよう。Mock Echoなら外部APIなしでも動くよ。
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              justifySelf: m.role === "user" ? "end" : "start",
              maxWidth: "80%",
              padding: "10px 12px",
              borderRadius: 12,
              background: m.role === "user" ? "#111827" : "#fff",
              color: m.role === "user" ? "#fff" : "#111827",
              border: m.role === "assistant" ? "1px solid #e5e7eb" : "none",
              whiteSpace: "pre-wrap",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            {m.content || (m.role === "assistant" && streaming && i === messages.length - 1 ? "▍" : "")}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#dc2626", fontSize: 12, borderTop: "1px solid #fecaca" }}>
          エラー: {error}
        </div>
      )}

      <div style={{ padding: 12, borderTop: "1px solid #e5e7eb", background: "#fff", display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={streaming ? "生成中..." : "メッセージを入力 (Enterで送信, Shift+Enterで改行)"}
          disabled={streaming}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            fontSize: 13,
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim() || !modelId}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "none",
            background: streaming || !input.trim() ? "#e5e7eb" : "#111827",
            color: streaming || !input.trim() ? "#9ca3af" : "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: streaming || !input.trim() ? "not-allowed" : "pointer",
          }}
        >
          {streaming ? "..." : "送信"}
        </button>
      </div>
    </div>
  );
}
