/** One atomic localStorage record: a crash must never lose the sent draft or ID. */
export type PendingGeneration = { id: string; draft: string; regenerate: boolean };
export type ChatDraft = { version: 1; draft: string; pending: PendingGeneration | null };
export type GenerationStatus = {
  generation_id: string;
  session_id: string;
  status: string;
  assistant_id: number | null;
  user_id: number | null;
};
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export class ChatRecovery {
  readonly key: string;
  constructor(private storage: StorageLike, origin: string, readonly sessionId: string) {
    this.key = `kyalulu:chat-recovery:v1:${encodeURIComponent(origin)}:${encodeURIComponent(sessionId)}`;
  }
  read(): ChatDraft {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return { version: 1, draft: "", pending: null };
    const value = JSON.parse(raw);
    if (value?.version !== 1 || typeof value.draft !== "string" ||
      (value.pending !== null && (!value.pending || typeof value.pending.id !== "string" ||
        !value.pending.id || typeof value.pending.draft !== "string" || typeof value.pending.regenerate !== "boolean"))) {
      throw new Error("下書きの保存データを読み込めません。送信を停止しています。");
    }
    return value;
  }
  private write(value: ChatDraft) {
    const raw = JSON.stringify(value);
    this.storage.setItem(this.key, raw);
    if (this.storage.getItem(this.key) !== raw) throw new Error("下書きを端末に保存できませんでした。");
    return value;
  }
  draft(text: string) { return this.write({ ...this.read(), draft: text }); }
  begin(id: string, regenerate = false, submittedDraft?: string) {
    const value = this.read();
    if (value.pending) throw new Error("前の送信結果を確認しています。");
    const sent = submittedDraft ?? value.draft;
    return this.write({ ...value, draft: regenerate || value.draft !== sent ? value.draft : "",
      pending: { id, draft: sent, regenerate } });
  }
  /** Only call after the server's terminal status AND authoritative history load. */
  settle(id: string, committed: boolean) {
    const value = this.read();
    if (value.pending?.id !== id) throw new Error("送信IDが変わったため確認を中断しました。");
    const restore = !committed && !value.pending.regenerate && value.draft !== value.pending.draft;
    return this.write({ ...value, pending: null,
      draft: restore ? [value.pending.draft, value.draft].filter(Boolean).join("\n\n") : value.draft });
  }
}

export function generationOutcome(value: GenerationStatus, pending: PendingGeneration, sessionId: string): "pending" | "committed" | "failed" {
  if (value.generation_id !== pending.id || value.session_id !== sessionId) throw new Error("送信結果のIDが一致しません。");
  if (value.status === "pending") return "pending";
  if (!["completed", "invalid", "cancelled", "failed"].includes(value.status)) throw new Error("送信結果をまだ確認できません。");
  // Invalid immersion output can also be committed. Never infer persistence from status alone.
  if (typeof value.assistant_id === "number" && value.assistant_id > 0) return "committed";
  if (value.assistant_id === null && value.status !== "completed") return "failed";
  throw new Error("履歴への保存結果を確認できません。");
}

/** Coalesces visibility/online/manual/poll requests without ever submitting a generation. */
export class RecoveryCheck {
  private flight: Promise<void> | null = null;
  run(check: () => Promise<void>): Promise<void> {
    if (!this.flight) this.flight = check().finally(() => { this.flight = null; });
    return this.flight;
  }
}

export async function reconcileGeneration<T extends { id?: number }>(
  store: ChatRecovery,
  loadStatus: (id: string, session: string) => Promise<GenerationStatus>,
  loadHistory: (session: string) => Promise<T[]>,
  active: () => boolean,
  beforeSettle: () => void = () => {},
) {
  const pending = store.read().pending;
  if (!pending || !active()) return null;
  const result = await loadStatus(pending.id, store.sessionId);
  if (!active()) return null;
  const outcome = generationOutcome(result, pending, store.sessionId);
  if (outcome === "pending") return { outcome, history: null, value: store.read() };
  const history = await loadHistory(store.sessionId);
  if (!active()) return null;
  if (!Array.isArray(history) || (outcome === "committed" && !history.some(m => m.id === result.assistant_id))) {
    throw new Error("保存された返信を履歴で確認できません。");
  }
  beforeSettle();
  return { outcome, history, value: store.settle(pending.id, outcome === "committed") };
}
