import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";

describe("friendlyError", () => {
  it("turns an unloaded LE model into a load command", () => {
    const f = friendlyError("HTTPStatusError: model_not_loaded [le/qwen3-8b-q4]");
    expect(f.command).toEqual({ label: "ロードする", input: "/le load le/qwen3-8b-q4" });
    expect(f.message).toContain("le/qwen3-8b-q4");
  });

  it("points LE connection failures at the diagnostics page", () => {
    expect(friendlyError("le_unavailable").action?.to).toBe("/status");
  });

  it("keeps the generic HTTP mapping for other provider errors", () => {
    const f = friendlyError("HTTPStatusError: model_not_found [le:ollama/x]");
    expect(f.command).toBeUndefined();
    expect(f.action?.to).toBe("/studio");
  });
});
