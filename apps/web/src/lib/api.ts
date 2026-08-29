/** API クライアント - Milestone 2 */

export type ModelInfo = {
  id: string;
  display_name: string;
  provider_type: string;
  provider_model: string;
  quantization: string;
  context_length?: number;
};

export type ProviderHealth = {
  id: string;
  status: string;
  provider: string;
  base_url?: string;
  error?: string;
};

export async function fetchModels(): Promise<ModelInfo[]> {
  const r = await fetch(`/api/models?t=${Date.now()}`, { cache: "no-store" });
  const j = await r.json();
  console.log("[fetchModels] got", j.models?.length, j.models?.map((m: ModelInfo) => m.id));
  return j.models ?? [];
}

export async function fetchProvidersHealth(): Promise<ProviderHealth[]> {
  const r = await fetch("/api/providers/health");
  const j = await r.json();
  return j.health ?? [];
}

export async function fetchHealth(): Promise<{ status: string; version: string }> {
  const r = await fetch("/api/health");
  return r.json();
}

export type ChatMessage = { role: string; content: string };

export type SessionInfo = {
  session_id: string;
  count: number;
  last_at: string | null;
  last_preview: string | null;
};

const API_BASE = "http://127.0.0.1:8000"; // SSEがVite proxyでバッファされる問題を避けるため直接叩く（CORSは許可済み）

export async function fetchHistory(sessionId?: string): Promise<(ChatMessage & { model_id?: string; created_at?: string; session_id?: string })[]> {
  const url = sessionId ? `${API_BASE}/api/chat/history?session_id=${encodeURIComponent(sessionId)}` : `${API_BASE}/api/chat/history`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  return j.history ?? [];
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  const r = await fetch(`${API_BASE}/api/chat/sessions`, { cache: "no-store" });
  const j = await r.json();
  return j.sessions ?? [];
}

export async function clearHistory(sessionId?: string): Promise<void> {
  const url = sessionId ? `${API_BASE}/api/chat/history?session_id=${encodeURIComponent(sessionId)}` : `${API_BASE}/api/chat/history`;
  await fetch(url, { method: "DELETE" });
}

export async function fetchChatNonStream(model_id: string, messages: ChatMessage[], session_id?: string): Promise<string> {
  const r = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id, messages, stream: false, session_id: session_id ?? "default" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.reply ?? "";
}

/** SSEストリーミングでチャット */
export function streamChat(
  model_id: string,
  messages: ChatMessage[],
  opts: { temperature?: number; session_id?: string } = {},
  handlers: {
    onToken: (t: string) => void;
    onMeta?: (m: unknown) => void;
    onDone?: (full: string) => void;
    onError?: (e: string) => void;
  },
): () => void {
  const controller = new AbortController();
  (async () => {
    console.log("[streamChat] start", { model_id, messages: messages.length, session_id: opts.session_id });
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_id, messages, stream: true, temperature: opts.temperature ?? 0.8, session_id: opts.session_id ?? "default" }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      let body = "";
      try {
        body = await res.text();
      } catch {}
      console.error("[streamChat] HTTP error", res.status, body);
      handlers.onError?.(`HTTP ${res.status} ${body.slice(0, 200)}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSEは "event: ...\ndata: ...\n\n" の塊
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        const lines = part.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!data) continue;
        try {
          const obj = JSON.parse(data);
          if (event === "token") handlers.onToken(obj.token ?? "");
          else if (event === "meta") handlers.onMeta?.(obj);
          else if (event === "done") handlers.onDone?.(obj.full ?? "");
          else if (event === "error") handlers.onError?.(obj.error ?? "unknown error");
        } catch {
          // ignore
        }
      }
    }
  })().catch((e) => {
    console.error("[streamChat] catch", e);
    if (e.name !== "AbortError") handlers.onError?.(String(e));
  });
  return () => controller.abort();
}
