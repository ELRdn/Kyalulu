import { useCallback, useEffect, useState } from "react";
import { fetchModels, fetchProvidersHealth, type ModelInfo, type ProviderHealth } from "./api";

const LS_MODEL = "my-zeta-model";
const EVENT = "kyalulu-model-change";

function readStored(): string {
  try {
    return localStorage.getItem(LS_MODEL) ?? "";
  } catch {
    return "";
  }
}

function writeStored(id: string) {
  try {
    localStorage.setItem(LS_MODEL, id);
  } catch {
    /* The choice still lives in memory for this page. */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function isModelAvailable(model: ModelInfo | undefined, health: ProviderHealth[] | null): boolean {
  if (!model) return false;
  if (!health) return true;
  return health.some((h) => h.id === model.provider_type && h.status === "ok"
    && (!h.models || h.models.includes(model.provider_model)));
}

/**
 * 会話に使うモデルを決める。保存済みの選択が接続できるならそれを使い、
 * できなければ接続中の実モデル → Mock の順に自動で切り替える（利用者にモデル名を意識させない）。
 */
export function pickModel(models: ModelInfo[], health: ProviderHealth[] | null, current: string): string {
  const stored = models.find((m) => m.id === current);
  if (stored && isModelAvailable(stored, health)) return stored.id;
  if (!health) return stored?.id ?? models[0]?.id ?? "";
  const usable = models.filter((m) => isModelAvailable(m, health));
  return (usable.find((m) => m.provider_type !== "mock") ?? usable[0] ?? stored ?? models[0])?.id ?? "";
}

export function useChatModel() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [health, setHealth] = useState<ProviderHealth[] | null>(null);
  const [modelId, setModelIdState] = useState(readStored);
  const [loadFailed, setLoadFailed] = useState(false);

  const reload = useCallback(() => {
    setLoadFailed(false);
    setHealth(null);
    fetchModels()
      .then(setModels)
      .catch(() => setLoadFailed(true));
    fetchProvidersHealth()
      .then(setHealth)
      .catch(() => setHealth([]));
  }, []);

  useEffect(reload, [reload]);

  useEffect(() => {
    const sync = () => setModelIdState(readStored());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (!models.length) return;
    const next = pickModel(models, health, readStored());
    if (next && next !== readStored()) writeStored(next);
    setModelIdState(next);
  }, [models, health]);

  const setModelId = useCallback((id: string) => {
    setModelIdState(id);
    writeStored(id);
  }, []);

  return { models, health, modelId, setModelId, reload, loadFailed, current: models.find((m) => m.id === modelId) };
}
