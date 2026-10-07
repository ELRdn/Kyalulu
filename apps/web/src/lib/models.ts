import { scopedKey } from './remoteStore';
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchModels, fetchProvidersHealth, type ModelInfo, type ProviderHealth } from "./api";

import { useAdministrative, useRuntimeAccess } from "../components/RuntimeGate";

const LS_EXPLICIT_MODEL = "kyalulu-explicit-model";
const LS_MODEL = "my-zeta-model";
const EVENT = "kyalulu-model-change";

function readStored(key = LS_MODEL): string {
  try {
    return localStorage.getItem(scopedKey(key)) ?? "";
  } catch {
    return "";
  }
}

function writeStored(id: string) {
  try {
    localStorage.setItem(scopedKey(LS_MODEL), id);
    localStorage.setItem(scopedKey(LS_EXPLICIT_MODEL), id);
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

/** Existing conversations retain their server-persisted model, even when unavailable. */
export function conversationModel(history: { role: string; model_id?: string | null }[]): string | null {
  return [...history].reverse().find(m => m.role === "assistant" && m.model_id && m.model_id !== "intro")?.model_id ?? null;
}

export function pickConversationModel(models: ModelInfo[], health: ProviderHealth[] | null,
  choice: { administrative: boolean; baseline?: string | null; explicit?: string; storedExplicit?: string; stored?: string }) {
  const required = choice.explicit || choice.baseline || choice.storedExplicit;
  if (required) return required;
  // Paired devices never silently switch providers or choose the first remote model.
  if (!choice.administrative) return "";
  return pickModel(models, health, choice.stored ?? "");
}

export async function loadModelCatalog(administrative: boolean) {
  const [models, health] = await Promise.all([
    fetchModels(),
    administrative ? fetchProvidersHealth().catch(() => [] as ProviderHealth[]) : Promise.resolve(null),
  ]);
  return { models, health };
}

export function useChatModel(options: { conversationModel?: string | null } = {}) {
  const administrative = useAdministrative();
  const {cloud_mode} = useRuntimeAccess();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [health, setHealth] = useState<ProviderHealth[] | null>(null);
  const [explicit, setExplicit] = useState("");
  const [stored, setStored] = useState(() => ({ legacy: readStored(), explicit: readStored(LS_EXPLICIT_MODEL) }));
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);

  const reload = useCallback(() => {
    const request = ++sequence.current;
    setLoading(true);
    setLoadFailed(false);
    void loadModelCatalog(administrative).then(catalog => {
      if (request !== sequence.current) return;
      setModels(catalog.models); setHealth(catalog.health);
    }).catch(() => {
      if (request === sequence.current) setLoadFailed(true);
    }).finally(() => {
      if (request === sequence.current) setLoading(false);
    });
  }, [administrative]);

  useEffect(() => { reload(); return () => { sequence.current++; }; }, [reload]);
  useEffect(() => {
    const sync = () => setStored({ legacy: readStored(), explicit: readStored(LS_EXPLICIT_MODEL) });
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const modelId = cloud_mode && !options.conversationModel && !explicit && !stored.explicit ? 'cloud-standard' : pickConversationModel(models, health, {
    administrative, baseline: options.conversationModel, explicit,
    storedExplicit: stored.explicit, stored: stored.legacy,
  });
  const setModelId = useCallback((id: string) => { setExplicit(id); writeStored(id); }, []);
  const current = models.find(m => m.id === modelId);
  return { models, health, modelId, setModelId, reload, loadFailed, loading, current,
    available: !loading && !loadFailed && isModelAvailable(current, health) };
}
