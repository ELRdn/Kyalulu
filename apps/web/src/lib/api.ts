import { SSEDecoder } from "./sse";
import type { GenerationRecord } from "../../../../packages/schemas/src";
import type { LibraryBinding } from '../../../../packages/schemas/src/portable';
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

const API_BASE_STREAM = ""; // Same-origin SSE through the tested Vite proxy.

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
  library_binding?: LibraryBinding | null;
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
    library_binding: j.library_binding ?? null,
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

export type CharacterInfo = { official?: boolean; id: string; display_name: string; version: string; description: string; intro?: string; difficulty?: string; tags?: string[]; portrait_url?: string | null; library_revision?: number; alternate_greetings?: string[]; recommended_generation?: Record<string, unknown> };
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
  sections: Record<string, unknown>;
  ordered_messages?: Record<string, unknown>[];
};
export async function compilePrompt(p: { character_id?: string | null; persona_id?: string | null; world_id?: string | null; extra_system_prompt?: string | null; library_binding?: SessionSettings["library_binding"] }): Promise<CompiledPrompt> {
  const r = await fetch("/api/prompt/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export async function fetchChatDebug(sessionId: string): Promise<{ session_id: string; settings: SessionSettings; compiled: CompiledPrompt; history_count: number; approx_turn: number; relationship: string; state: Record<string, unknown>; generation: GenerationResult | null }> {
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
  turns: { turn: number; type: string; user: string; assistant: string; elapsed_ms: number; state: Record<string, unknown>; status?: string; token_budget?: Record<string, unknown>; telemetry?: Record<string, unknown>; compiled?: CompiledPrompt; generation_config?: GenerationResult["generation_config"]; validation?: GenerationResult["validation"]; raw_prompt?: string; state_before?: Record<string, unknown>; attempts?: unknown[] }[];
  raw_prompt: string;
  ratings: Record<string, { score: number; comment: string; rater?: string; updated_at?: string }>;
  metrics?: ExperimentMetrics | null;
};
export async function fetchExperimentDetail(id: string): Promise<ExperimentDetail> {
  const r = await fetch(`/api/experiments/${encodeURIComponent(id)}`, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export async function putRating(experiment_id: string, turn: number, score: number, comment = "", rater = "local"): Promise<void> {
  const r = await fetch("/api/ratings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ experiment_id, turn, score, comment, rater }),
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
export async function runExperiments(scenario: string, model_id: string, runs = 1, temperature?: number, allow_nsfw = false): Promise<{ experiment_id: string }[]> {
  const r = await fetch("/api/experiments/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario, model_id, runs, temperature, allow_nsfw }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j.results ?? [];
}

export type LeaderboardEntry = { model_id: string; runs: number; avg_human: number | null; auto_score: number | null; avg_chars: number | null; avg_failure_rate: number | null; avg_repetition: number | null };
export type Leaderboard = { scope: string; ranking: LeaderboardEntry[]; generated_at: string; total_experiments: number; excluded?: Record<string, number> };
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
  opts: { temperature?: number | null; system_prompt?: string | null; session_id?: string; generation_id?: string; regenerate_message_id?: number; allow_nsfw?: boolean } = {},
  handlers: {
    onToken: (t: string) => void;
    onMeta?: (m: unknown) => void;
    onReset?: (full: string) => void;
    onDone?: (full: string, result?: GenerationResult) => void;
    onError?: (e: string) => void;
  },
): () => void {
  const controller = new AbortController();
  (async () => {
    const response = await fetch(`${API_BASE_STREAM}/api/chat/stream`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      signal: controller.signal,
      body: JSON.stringify({ model_id, messages, ...opts, generation_id: opts.generation_id ?? crypto.randomUUID(), stream: true }),
    });
    if (!response.ok || !response.body) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error ?? `HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const text = new TextDecoder();
    const parser = new SSEDecoder();
    let terminal = false;
    try {
      while (!terminal) {
        const { done, value } = await reader.read();
        for (const event of parser.feed(text.decode(value, { stream: !done }), done)) {
          const data = JSON.parse(event.data);
          if (event.event === "token") handlers.onToken(data.token ?? "");
          else if (event.event === "reset") handlers.onReset?.(data.full ?? "");
          else if (event.event === "meta") handlers.onMeta?.(data);
          else if (event.event === "done") {
            terminal = true;
            handlers.onDone?.(data.full ?? "", data);
          } else if (event.event === "error") {
            terminal = true;
            handlers.onError?.(data.error ?? "Generation failed");
          }
        }
        if (done) break;
      }
      if (!terminal) throw new Error("応答の途中で接続が終了しました。再送は自動実行しません。");
    } finally { await reader.cancel().catch(() => {}); }
  })().catch(e => { if (!controller.signal.aborted) handlers.onError?.(String(e)); });
  return () => controller.abort();
}

export type GenerationResult = {
  generation_id: string; status: string; reply: string; full: string;
  state: Record<string, unknown>; telemetry: Record<string, unknown>;
  generation_config: GenerationRecord['generation_config'];
  validation: GenerationRecord['validation'];
  raw_prompt?: string; attempts?: { number: number; raw: string; errors: string[]; messages: ChatMessage[] }[];
  snapshot_valid?: boolean; token_budget?: Record<string, unknown>;
};
export async function replayExperiment(id: string, allow_nsfw = false): Promise<{ experiment_id: string }[]> {
  const r = await fetch(`/api/experiments/${encodeURIComponent(id)}/rerun`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runs: 1, allow_nsfw }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j.results;
}
