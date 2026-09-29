import { describe, expect, it, vi } from "vitest";
import { ChatRecovery, RecoveryCheck, generationOutcome, reconcileGeneration, type GenerationStatus } from "./chatRecovery";

function setup(origin = "https://one.test", session = "chat:a") {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const store = new ChatRecovery(storage, origin, session);
  return { store, storage, data };
}
const status = (change: Partial<GenerationStatus> = {}): GenerationStatus => ({
  generation_id: "g1", session_id: "chat:a", status: "completed", assistant_id: 2, user_id: 1, ...change,
});

describe("durable chat drafts", () => {
  it("separates origins and sessions and survives a reload with exact whitespace", () => {
    const { store, storage } = setup();
    store.draft("  下書き\n途中 ");
    expect(new ChatRecovery(storage, "https://one.test", "chat:a").read().draft).toBe("  下書き\n途中 ");
    expect(new ChatRecovery(storage, "https://two.test", "chat:a").read().draft).toBe("");
    expect(new ChatRecovery(storage, "https://one.test", "chat:b").read().draft).toBe("");
  });
  it("persists the pending ID and sent draft atomically before clearing the composer", () => {
    const { store, storage } = setup();
    store.draft("sent");
    store.begin("g1");
    const reload = new ChatRecovery(storage, "https://one.test", "chat:a");
    expect(reload.read()).toEqual({ version: 1, draft: "", pending: { id: "g1", draft: "sent", regenerate: false } });
    expect(() => reload.begin("g2")).toThrow();
  });
  it("retains edits typed during settings save and after submission", () => {
    const { store } = setup();
    store.draft("new edit");
    store.begin("g1", false, "sent");
    expect(store.read().draft).toBe("new edit");
    expect(store.read().pending?.draft).toBe("sent");
    store.draft("next message");
    expect(store.settle("g1", true).draft).toBe("next message");
  });
  it("restores failed text without losing the newer draft", () => {
    const { store } = setup();
    store.draft("original"); store.begin("g1"); store.draft("new draft");
    expect(store.settle("g1", false).draft).toBe("original\n\nnew draft");
  });
  it("does not destroy the composer draft on regeneration failure", () => {
    const { store } = setup();
    store.draft("next message"); store.begin("g1", true);
    expect(store.settle("g1", false).draft).toBe("next message");
  });
  it("fails closed on corrupt or unavailable storage, and retains a draft on quota failure", () => {
    const { store, storage, data } = setup();
    store.draft("keep me");
    storage.setItem = () => { throw new Error("quota"); };
    expect(() => store.begin("g1")).toThrow("quota");
    expect(store.read().draft).toBe("keep me");
    data.set(store.key, "broken");
    expect(() => store.read()).toThrow();
    expect(() => store.begin("g2")).toThrow();
  });
});

describe("generation reconciliation", () => {
  it("unlocks only after matching terminal ID and persisted history", async () => {
    const { store } = setup(); store.draft("sent"); store.begin("g1");
    const load = vi.fn().mockResolvedValue(status());
    const history = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]);
    const result = await reconcileGeneration(store, load, history, () => true);
    expect(load).toHaveBeenCalledWith("g1", "chat:a");
    expect(result?.outcome).toBe("committed");
    expect(store.read().pending).toBeNull();
  });
  it.each(["offline", "HTTP 401", "HTTP 404", "HTTP 500"])("keeps an uncertain %s locked without retrying submit", async error => {
    const { store } = setup(); store.draft("sent"); store.begin("g1");
    const history = vi.fn();
    await expect(reconcileGeneration(store, vi.fn().mockRejectedValue(new Error(error)), history, () => true)).rejects.toThrow(error);
    expect(history).not.toHaveBeenCalled();
    expect(store.read().pending?.id).toBe("g1");
    expect(() => store.begin("g2")).toThrow();
  });
  it("leaves pending work locked and never reads partial history", async () => {
    const { store } = setup(); store.begin("g1"); const history = vi.fn();
    expect((await reconcileGeneration(store, async () => status({ status: "pending" }), history, () => true))?.outcome).toBe("pending");
    expect(history).not.toHaveBeenCalled();
    expect(store.read().pending?.id).toBe("g1");
  });
  it("does not unlock when history fetch fails or omits the committed reply", async () => {
    const { store } = setup(); store.begin("g1");
    await expect(reconcileGeneration(store, async () => status(), async () => { throw Error("offline"); }, () => true)).rejects.toThrow();
    await expect(reconcileGeneration(store, async () => status(), async () => [], () => true)).rejects.toThrow();
    expect(store.read().pending?.id).toBe("g1");
  });
  it("keeps not_found unresolved until explicit cancellation establishes a terminal tombstone", async () => {
    const { store } = setup(); store.draft("sent"); store.begin("g1");
    const history = vi.fn().mockResolvedValue([]);
    await expect(reconcileGeneration(store, async () => status({ status: "not_found", assistant_id: null }), history, () => true)).rejects.toThrow();
    expect(history).not.toHaveBeenCalled(); expect(store.read().pending?.id).toBe("g1");
    const outcome = await reconcileGeneration(store, async () => status({ status: "cancelled", assistant_id: null, user_id: null }), history, () => true);
    expect(outcome?.value).toMatchObject({ draft: "sent", pending: null });
  });
  it("does not lose an unsaved in-memory edit if storage fails during reconciliation", async () => {
    const { store } = setup(); store.draft("sent"); store.begin("g1");
    await expect(reconcileGeneration(store, async () => status(), async () => [{ id: 2 }], () => true,
      () => { throw new Error("quota"); })).rejects.toThrow("quota");
    expect(store.read().pending?.draft).toBe("sent");
  });
  it("ignores a late result after a session switch", async () => {
    const { store } = setup(); store.draft("old"); store.begin("g1");
    let active = true;
    const history = vi.fn();
    const result = await reconcileGeneration(store, async () => { active = false; return status(); }, history, () => active);
    expect(result).toBeNull(); expect(history).not.toHaveBeenCalled();
    expect(store.read().pending?.draft).toBe("old");
  });
  it("also ignores a session switch during history loading", async () => {
    const { store } = setup(); store.begin("g1"); let active = true;
    expect(await reconcileGeneration(store, async () => status(), async () => { active = false; return [{ id: 2 }]; }, () => active)).toBeNull();
    expect(store.read().pending?.id).toBe("g1");
  });
  it("treats invalid immersion replies with assistant_id as committed", () => {
    const pending = { id: "g1", draft: "", regenerate: false };
    expect(generationOutcome(status({ status: "invalid" }), pending, "chat:a")).toBe("committed");
    expect(generationOutcome(status({ status: "cancelled", assistant_id: null }), pending, "chat:a")).toBe("failed");
    for (const change of [{ generation_id: "other" }, { session_id: "other" }, { status: "unknown" }, { assistant_id: null }]) {
      expect(() => generationOutcome(status(change), pending, "chat:a")).toThrow();
    }
  });
  it("coalesces overlapping resume checks and allows later retry", async () => {
    const checks = new RecoveryCheck();
    let resolve!: () => void;
    const read = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const first = checks.run(read); const second = checks.run(read);
    expect(first).toBe(second); expect(read).toHaveBeenCalledTimes(1);
    resolve(); await first;
    const third = checks.run(read); expect(read).toHaveBeenCalledTimes(2); resolve(); await third;
  });
});
