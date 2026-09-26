export async function labRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : data.error ?? `保存・取得に失敗しました (${response.status})`);
  return data;
}

export type CreatorKind = "persona" | "world";
export type CreatorDocument = { display_name: string; description: string; traits: string; rules: string };
export type CreatorItem = CreatorDocument & { id: string; revision: number; kind: CreatorKind; created_at: string };
export type BenchmarkJob = {
  id: string; status: string; created_at: string; planned_runs: number; planned_turns: number; error?: string;
  current: { model_id: string; scenario_id: string; run: number; memory: boolean; experiment_id?: string; turns_completed: number; turns_planned: number } | null;
  results: { experiment_id: string; model_id: string; scenario_id: string; memory_enabled: boolean; seed: number; status: string;
    metrics: { avg_elapsed_ms: number | null; turn_count: number; failure_rate: number; first_attempt_success_rate?: number;
      memory?: { recall_rate: number | null; recalled: number; probes: number; hallucinated: number; outcomes: Record<string, number> } } }[];
};
