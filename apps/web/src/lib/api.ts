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

const API_BASE_STREAM = "http://127.0.0.1:8000"; // SSEだけ直接叩く（Vite proxyがバッファするため）

export async function fetchHistory(sessionId?: string): Promise<(ChatMessage & { id?: number; model_id?: string; created_at?: string; session_id?: string })[]> {
  const url = sessionId ? `/api/chat/history?session_id=${encodeURIComponent(sessionId)}&t=${Date.now()}` : `/api/chat/history?t=${Date.now()}`;
  const r = await fetch(url, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  const j = await r.json();
  console.log("[fetchHistory]", sessionId, "got", j.history?.length, j.history?.slice(0, 2));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.history ?? [];
}

export async function updateHistoryMessage(id: number, content: string): Promise<void> {
  const r = await fetch(`/api/chat/history/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
}

export async function deleteHistoryMessage(id: number): Promise<void> {
  const r = await fetch(`/api/chat/history/${id}`, { method: "DELETE" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  const r = await fetch(`/api/chat/sessions?t=${Date.now()}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
  const j = await r.json();
  console.log("[fetchSessions] got", j.sessions?.length, j.sessions?.map((s: SessionInfo) => `${s.session_id}(${s.count})`));
  return j.sessions ?? [];
}

export async function clearHistory(sessionId?: string): Promise<void> {
  const url = sessionId ? `/api/chat/history?session_id=${encodeURIComponent(sessionId)}` : "/api/chat/history";
  await fetch(url, { method: "DELETE" });
}

export type SessionSettings = {
  session_id: string;
  system_prompt: string;
  temperature: number;
  character_id?: string | null;
  persona_id?: string | null;
  world_id?: string | null;
  intro?: string;
};

export async function fetchSettings(sessionId: string): Promise<SessionSettings> {
  const r = await fetch(`/api/chat/settings?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
  const j = await r.json();
  return {
    session_id: j.session_id ?? sessionId,
    system_prompt: j.system_prompt ?? "",
    temperature: j.temperature ?? 0.8,
    character_id: j.character_id ?? null,
    persona_id: j.persona_id ?? null,
    world_id: j.world_id ?? null,
    intro: j.intro ?? "",
  };
}

export async function injectIntro(sessionId: string): Promise<{ injected: boolean; intro?: string }> {
  const r = await fetch(`/api/chat/intro/inject?session_id=${encodeURIComponent(sessionId)}`, { method: "POST" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export async function saveSettings(s: SessionSettings): Promise<void> {
  const r = await fetch("/api/chat/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
}

export type CharacterInfo = { id: string; display_name: string; version: string; description: string; intro?: string; difficulty?: string; tags?: string[] };
export type PersonaInfo = { id: string; display_name: string; version: string; description: string };
export type WorldInfo = { id: string; display_name: string; version: string; description: string };

export async function fetchCharacters(include_nsfw = false): Promise<(CharacterInfo & { nsfw?: boolean })[]> {
  const r = await fetch(`/api/characters?include_nsfw=${include_nsfw}`, { cache: "no-store" });
  const j = await r.json();
  return j.characters ?? [];
}
export async function fetchPersonas(): Promise<PersonaInfo[]> {
  const r = await fetch("/api/personas", { cache: "no-store" });
  const j = await r.json();
  return j.personas ?? [];
}
export async function fetchWorlds(): Promise<WorldInfo[]> {
  const r = await fetch("/api/worlds", { cache: "no-store" });
  const j = await r.json();
  return j.worlds ?? [];
}

export type CompiledPrompt = {
  system_prompt: string;
  prompt_version: string;
  character_version: string | null;
  persona_version: string | null;
  world_version: string | null;
  token_estimate: number;
  sections: Record<string, string>;
};
export async function compilePrompt(p: { character_id?: string | null; persona_id?: string | null; world_id?: string | null; extra_system_prompt?: string | null }): Promise<CompiledPrompt> {
  const r = await fetch("/api/prompt/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export async function fetchChatDebug(sessionId: string): Promise<{ session_id: string; settings: SessionSettings; compiled: CompiledPrompt; history_count: number; approx_turn: number; relationship: string }> {
  const r = await fetch(`/api/chat/debug?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export type PromptPreset = {
  id: string;
  name: string;
  content: string;
  temperature: number;
  created_at?: string;
  updated_at?: string;
  nsfw?: boolean;
  nsfw_level?: string | null;
};

export async function fetchPresets(include_nsfw = false): Promise<PromptPreset[]> {
  const r = await fetch(`/api/prompts/presets?include_nsfw=${include_nsfw}`, { cache: "no-store" });
  const j = await r.json();
  return j.presets ?? [];
}

export async function createPreset(name: string, content: string, temperature: number, nsfw = false, nsfw_level: string | null = null): Promise<PromptPreset> {
  const r = await fetch("/api/prompts/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content, temperature, nsfw, nsfw_level }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export async function updatePreset(id: string, name: string, content: string, temperature: number): Promise<PromptPreset> {
  const r = await fetch(`/api/prompts/presets/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, content, temperature }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export async function deletePreset(id: string): Promise<void> {
  const r = await fetch(`/api/prompts/presets/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
}

// M5 Experiments
export type ExperimentMeta = {
  experiment_id: string;
  model_id: string;
  scenario_id: string;
  run_number: number;
  character_id?: string | null;
  world_id?: string | null;
  prompt_version?: string;
  timestamp?: string;
  turns?: number;
  [k: string]: unknown;
};
export type ExperimentListItem = ExperimentMeta;
export async function fetchExperiments(limit = 50, include_nsfw = false): Promise<ExperimentMeta[]> {
  const r = await fetch(`/api/experiments?limit=${limit}&include_nsfw=${include_nsfw}`, { cache: "no-store" });
  const j = await r.json();
  return j.experiments ?? [];
}
export async function fetchScenarios(include_nsfw = false): Promise<{ id: string; version: string; character: string; difficulty: string; turns: number; nsfw?: boolean; nsfw_level?: string | null }[]> {
  const r = await fetch(`/api/scenarios?include_nsfw=${include_nsfw}`, { cache: "no-store" });
  const j = await r.json();
  return j.scenarios ?? [];
}
export type ExperimentDetail = {
  meta: ExperimentMeta & { metrics?: ExperimentMetrics };
  turns: { turn: number; type: string; user: string; assistant: string; elapsed_ms: number; state: Record<string, unknown> }[];
  raw_prompt: string;
  ratings: Record<string, { score: number; comment: string }>;
  metrics?: ExperimentMetrics | null;
};
export async function fetchExperimentDetail(id: string): Promise<ExperimentDetail> {
  const r = await fetch(`/api/experiments/${encodeURIComponent(id)}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export async function putRating(experiment_id: string, turn: number, score: number, comment = ""): Promise<void> {
  const r = await fetch("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ experiment_id, turn, score, comment }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error || `HTTP ${r.status}`);
  }
}
export async function fetchRatings(experiment_id: string): Promise<{ turn: number; score: number; comment: string }[]> {
  const r = await fetch(`/api/ratings?experiment_id=${encodeURIComponent(experiment_id)}`, { cache: "no-store" });
  const j = await r.json();
  return j.ratings ?? [];
}
export async function runExperiments(scenario: string, model_id: string, runs = 1, temperature?: number): Promise<{ experiment_id: string }[]> {
  const r = await fetch("/api/experiments/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, model_id, runs, temperature }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.results ?? [];
}

export type LeaderboardEntry = { model_id: string; runs: number; avg_human: number | null; auto_score: number | null; avg_chars: number | null; avg_failure_rate: number | null; avg_repetition: number | null };
export type Leaderboard = { scope: string; ranking: LeaderboardEntry[]; generated_at: string; total_experiments: number };
export async function fetchLeaderboard(scope: "official" | "all" = "official"): Promise<Leaderboard> {
  const r = await fetch(`/api/leaderboard?scope=${scope}`, { cache: "no-store" });
  const j = await r.json();
  return j as Leaderboard;
}

export type ExperimentMetrics = { turn_count: number; char_count: number; avg_chars: number; max_chars: number; repetition_score: number | null; failure_rate: number; empty_rate: number; avg_elapsed_ms: number | null };

export async function fetchChatNonStream(model_id: string, messages: ChatMessage[], session_id?: string, temperature?: number | null, system_prompt?: string | null): Promise<string> {
  const body: Record<string, unknown> = { model_id, messages, stream: false, session_id: session_id ?? "default" };
  if (temperature !== undefined && temperature !== null) body.temperature = temperature;
  if (system_prompt !== undefined && system_prompt !== null) body.system_prompt = system_prompt;
  const r = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.reply ?? "";
}

/** SSEストリーミングでチャット — temperature/system_prompt未指定ならサーバ側のsession_settingsを使う */
export function streamChat(
  model_id: string,
  messages: ChatMessage[],
  opts: { temperature?: number | null; system_prompt?: string | null; session_id?: string } = {},
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
    const body: Record<string, unknown> = { model_id, messages, stream: true, session_id: opts.session_id ?? "default" };
    if (opts.temperature !== undefined && opts.temperature !== null) body.temperature = opts.temperature;
    if (opts.system_prompt !== undefined && opts.system_prompt !== null) body.system_prompt = opts.system_prompt;
    const res = await fetch(`${API_BASE_STREAM}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
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
    console.log("[streamChat] response headers", [...res.headers.entries()]);
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log("[streamChat] reader done, buf tail:", buf.slice(0, 100));
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      console.log("[streamChat] chunk", chunk.slice(0, 200).replace(/\n/g, "\\n"));
      buf += chunk;
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split("\n");
        let event = "message";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }
        if (!data) continue;
        console.log("[streamChat] event", event, data.slice(0, 100));
        try {
          const obj = JSON.parse(data);
          if (event === "token") handlers.onToken(obj.token ?? "");
          else if (event === "meta") handlers.onMeta?.(obj);
          else if (event === "done") handlers.onDone?.(obj.full ?? "");
          else if (event === "error") handlers.onError?.(obj.error ?? "unknown error");
        } catch (e) {
          console.warn("[streamChat] JSON parse failed", e, data);
        }
      }
    }
  })().catch((e) => {
    console.error("[streamChat] catch", e);
    if (e.name !== "AbortError") handlers.onError?.(String(e));
  });
  return () => controller.abort();
}
