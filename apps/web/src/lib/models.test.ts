import { describe, expect, it } from "vitest";
import { isModelAvailable, pickModel } from "./models";
import type { ModelInfo, ProviderHealth } from "./api";

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
