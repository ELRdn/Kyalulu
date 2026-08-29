import { useEffect, useRef, useState } from "react";
import {
  fetchModels,
  fetchHistory,
  fetchSessions,
  clearHistory,
  streamChat,
  fetchChatNonStream,
  type ModelInfo,
  type ChatMessage,
  type SessionInfo,
} from "../lib/api";
import ModelSelector from "../components/ModelSelector";

const LS_SESSION = "my-zeta-session";
const LS_MODEL = "my-zeta-model";

export default function ChatPage() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelId, setModelId] = useState(() => localStorage.getItem(LS_MODEL) || "");
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(LS_SESSION) || "default");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
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

  const loadSessions = async () => {
    try {
      const ss = await fetchSessions();
      setSessions(ss);
    } catch {
      // ignore
    }
  };

  const loadHistory = async (sid: string) => {
    try {
      const h = await fetchHistory(sid);
      // ChatMessage だけに変換
      setMessages(h.map((x) => ({ role: x.role, content: x.content })));
    } catch {
      setError("履歴の取得に失敗");
    }
  };

  useEffect(() => {
    reloadModels();
    loadSessions();
    loadHistory(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_SESSION, sessionId);
    loadHistory(sessionId);
  }, [sessionId]);

  useEffect(() => {
    if (modelId) localStorage.setItem(LS_MODEL, modelId);
  }, [modelId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleNewSession = () => {
    const newId = `chat_${Date.now().toString(36)}`;
    setSessionId(newId);
    setMessages([]);
    setError(null);
    // セッション一覧は次回送信時にDBに作られるので、ローカルで先に追加
    setSessions((prev) => [{ session_id: newId, count: 0, last_at: new Date().toISOString(), last_preview: "(新規会話)" }, ...prev]);
  };

  const handleClearSession = async () => {
    if (!confirm(`会話 "${sessionId}" を削除しますか？`)) return;
    await clearHistory(sessionId);
    setMessages([]);
    loadSessions();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming || !modelId) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    const withAssistant: ChatMessage[] = [...next, { role: "assistant", content: "" }];
    setMessages(withAssistant);
    setInput("");
    setStreaming(true);
    let acc = "";
    let gotToken = false;
    let streamFailed = false;
    console.log("[Chat] send", { modelId, sessionId, nextLen: next.length });

    // タイプライター用キュー（トークンが塊で来ても1文字ずつ流す）
    const queue: string[] = [];
    let typingTimer: number | null = null;
    const flushQueue = () => {
      if (queue.length === 0) return;
      // 1フレームで最大3文字まで出す（速すぎず遅すぎず）
      const chunk = queue.splice(0, 3).join("");
      acc += chunk;
      setMessages((prev) => {
        if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") return prev;
        const copy = [...prev];
        copy[copy.length - 1] = { role: "assistant", content: acc };
        return copy;
      });
    };
    const startTyping = () => {
      if (typingTimer !== null) return;
      typingTimer = window.setInterval(() => {
        if (queue.length > 0) flushQueue();
      }, 30);
    };

    const stop = streamChat(
      modelId,
      next,
      { session_id: sessionId },
      {
        onToken: (t) => {
          gotToken = true;
          // トークンを1文字ずつキューへ
          for (const ch of t) queue.push(ch);
          startTyping();
          console.log("[Chat] onToken", t, "queue:", queue.length);
        },
        onDone: () => {
          // キューを一気に吐き出してから完了
          const drain = () => {
            if (queue.length > 0) {
              flushQueue();
              setTimeout(drain, 30);
            } else {
              if (typingTimer !== null) {
                clearInterval(typingTimer);
                typingTimer = null;
              }
              setStreaming(false);
              loadSessions();
              if (!gotToken) setTimeout(() => loadHistory(sessionId), 500);
            }
          };
          drain();
        },
        onError: (e) => {
          console.error(e);
          streamFailed = true;
          if (typingTimer !== null) {
            clearInterval(typingTimer);
            typingTimer = null;
          }
          setError(e);
          setStreaming(false);
        },
      },
    );

    // 8秒経ってもトークンが来なければ非ストリームにフォールバック
    setTimeout(async () => {
      if (!gotToken && !streamFailed) {
        console.log("[Chat] no token after 8s, fallback to non-stream");
        if (typingTimer !== null) {
          clearInterval(typingTimer);
          typingTimer = null;
        }
        try {
          const reply = await fetchChatNonStream(modelId, next, sessionId);
          // フォールバックもタイプライターで流す
          queue.length = 0;
          for (const ch of reply) queue.push(ch);
          const fallbackDrain = () => {
            if (queue.length > 0) {
              flushQueue();
              setTimeout(fallbackDrain, 30);
            } else {
              setStreaming(false);
              loadSessions();
            }
          };
          fallbackDrain();
        } catch (e) {
          setError(String(e));
          setStreaming(false);
          loadHistory(sessionId);
        }
        stop();
      }
    }, 8000);
    void stop;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* 会話選択バー */}
      <div style={{ padding: 8, borderBottom: "1px solid #e5e7eb", background: "#fff", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          style={{ flex: 1, minWidth: 140, padding: "6px 8px", borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12, background: "#fff" }}
        >
          <option value="default">default</option>
          {sessions
            .filter((s) => s.session_id !== "default")
            .map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id} ({s.count}件) {s.last_preview ? `- ${s.last_preview.slice(0, 20)}` : ""}
              </option>
            ))}
          {/* 現在のsessionが一覧に無い場合でも表示 */}
          {!sessions.find((s) => s.session_id === sessionId) && sessionId !== "default" && (
            <option value={sessionId}>{sessionId} (新規)</option>
          )}
        </select>
        <button
          onClick={handleNewSession}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #111827", background: "#111827", color: "#fff", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          ＋ 新規会話
        </button>
        <button
          onClick={handleClearSession}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 11, cursor: "pointer" }}
        >
          削除
        </button>
        <button
          onClick={() => loadHistory(sessionId)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #e5e7eb", background: "#fff", fontSize: 11, cursor: "pointer" }}
        >
          ↻ 更新
        </button>
      </div>

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
            <code>{models.find((m) => m.id === modelId)?.provider_model}</code> / session: <code>{sessionId}</code>
          </div>
        )}
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: 16, display: "grid", gap: 12, background: "#f9fafb", alignContent: "start" }}>
        {messages.length === 0 && (
          <div style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", marginTop: 40 }}>
            モデルを選んで話しかけてみよう。会話は自動保存され、リフレッシュしても消えません。
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
        <div style={{ padding: "8px 12px", background: "#fef2f2", color: "#dc2626", fontSize: 12, borderTop: "1px solid #fecaca", whiteSpace: "pre-wrap" }}>
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
