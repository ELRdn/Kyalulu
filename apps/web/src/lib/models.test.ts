import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationModel, isModelAvailable, loadModelCatalog, pickConversationModel, pickModel } from "./models";
import type { ModelInfo, ProviderHealth } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("conversation model continuity", () => {
  const models: ModelInfo[] = [
    { id: "cloud", display_name: "Cloud", provider_type: "openai", provider_model: "remote", quantization: "" },
    { id: "gemma", display_name: "Gemma", provider_type: "ollama", provider_model: "gemma", quantization: "" },
  ];
  it("continues the PC model on a fresh Android browser instead of choosing the first cloud entry", () => {
    const baseline = conversationModel([{ role: "assistant", model_id: "intro" }, { role: "assistant", model_id: "gemma" }, { role: "user" }]);
    expect(pickConversationModel(models, null, { administrative: false, baseline })).toBe("gemma");
  });
  it("keeps missing or unhealthy conversation models selected but unavailable", () => {
    const id = pickConversationModel([models[0]], null, { administrative: false, baseline: "gemma", storedExplicit: "cloud" });
    expect(id).toBe("gemma");
    expect(isModelAvailable([models[0]].find(m => m.id === id), null)).toBe(false);
    expect(pickConversationModel(models, [], { administrative: true, baseline: "gemma" })).toBe("gemma");
    expect(isModelAvailable(models[1], [])).toBe(false);
  });
  it("requires a deliberate paired choice for a new conversation; ignores legacy auto selections", () => {
    expect(pickConversationModel(models, null, { administrative: false, stored: "cloud" })).toBe("");
    expect(pickConversationModel(models, null, { administrative: false, storedExplicit: "gemma" })).toBe("gemma");
    expect(pickConversationModel(models, null, { administrative: false, baseline: "gemma", explicit: "cloud" })).toBe("cloud");
  });
  it("never uses the intro pseudo model as the conversation baseline", () => {
    expect(conversationModel([{ role: "assistant", model_id: "intro" }])).toBeNull();
    expect(conversationModel([{ role: "assistant", model_id: "old" }, { role: "assistant", model_id: "gemma" }])).toBe("gemma");
  });
  it("paired catalog reads sanitized models without requesting provider health", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ models })));
    vi.stubGlobal("fetch", fetch);
    expect(await loadModelCatalog(false)).toEqual({ models, health: null });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toMatch(/^\/api\/models/);
  });
});

describe("local model availability", () => {
  const models: ModelInfo[] = [
    { id: "example", display_name: "Example", provider_type: "ollama", provider_model: "missing:7b", quantization: "" },
    { id: "installed", display_name: "Installed", provider_type: "ollama", provider_model: "present:9b", quantization: "" },
    { id: "mock", display_name: "Mock", provider_type: "mock", provider_model: "echo", quantization: "" },
  ];
  const health: ProviderHealth[] = [
    { id: "ollama", provider: "ollama", status: "ok", models: ["present:9b"] },
    { id: "mock", provider: "mock", status: "ok" },
  ];
  it("skips absent examples even while their server is healthy", () => {
    expect(isModelAvailable(models[0], health)).toBe(false);
    expect(isModelAvailable(models[1], health)).toBe(true);
    expect(pickModel(models, health, "example")).toBe("installed");
  });
  it("preserves an explicitly selected mock and excludes an empty local server", () => {
    expect(pickModel(models, health, "mock")).toBe("mock");
    expect(pickModel(models, [{ ...health[0], models: [] }, health[1]], "installed")).toBe("mock");
  });
});
