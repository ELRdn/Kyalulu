# Browser generation ownership and pending recovery

2026-10-30. Local implementation and fictional validation; no production action.

Normal Browser chat and Research now share the existing owner-scoped Web Lock.
Chat retains it after returning the streaming Response, through model execution
and the final durable save or failed-save handling. Research already holds the
lock for its complete run, so its shared generator does not acquire it again.
Unsupported Web Locks reject new chat generation before input persistence.

Another document's status lookup cannot infer a crash from its own empty
`running` variable. Recovery first obtains the execution lock, rereads the saved
generation, checks the source session's pending ID and revision, and atomically
clears the session pending flag with its failed status. Failed saves preserve
both originals. Live cross-document cancellation returns a localized instruction
to stop in the owning tab; it does not pretend that the worker was cancelled.

New pending records carry the lock protocol/name. Older unmarked or mismatched
records are never failed automatically. Their read response includes a transient
revision for review, without changing the stored generation. Explicit Stop and
check asks the user to confirm that the original result was checked and all old
tabs were closed. The confirmed POST must match the current revision; conflicts
require fresh review. Saved replies, pending input and newer drafts are retained,
and no generation is automatically resubmitted. Older apps cannot participate in
the new lock protocol; their actual termination remains the user's confirmation.

## Evidence

- Full Web suite: 1,118 passed across 76 files; TypeScript check passed. Source
  collection/fingerprint selection: 42 passed.
- Unit cases cover lock lifetime through execution/save, blocked second send,
  live cross-document status/cancel, atomic failed-save preservation, unsupported
  locks, and legacy confirmation/revision/idempotency. JA/EN instructions are
  checked through the shared error renderer.
- Actual Chromium opens two documents with shared IndexedDB and the real Web
  Locks API. A synthetic live lock preserves pending data and rejects a second
  send/cancel. Closing its document releases the lock. Injected metadata quota
  failure rolls back the entity and status together; retry/reload are durable
  and repeated recovery does not write again.
- The same browser test mounts the actual recovery hook and common confirmation
  dialog in JA and EN. Cancel preserves the old pending record; an edit after the
  dialog appears causes a revision conflict; fresh confirmation recovers the sent
  input plus newer draft while preserving an existing saved reply.
- The browser made zero external/API network requests and had zero page errors;
  owned contexts/browser/Vite were closed. Report:
  `.artifacts/device-generation-lock-browser/result.json` (private).
- The test is included in Windows/Ubuntu Runtime and Web CI and the corresponding
  source allowlist. Real model inference and physical devices are not exercised
  by this synthetic ownership/transaction test.

Browser world/shared memory pools and their lifecycle are still unimplemented.
This establishes an execution fence prerequisite; it does not claim memory-scope
parity, fixed-source artifact acceptance or production readiness.

## Follow-up sync boundary

Outgoing selection also consults the durable entity pending flag, so a different
document cannot send an intermediate conversation just because its own busy
counter is zero. Finished conversations become eligible again. Independent
received/branched/recovery copies clear the foreign worker flag while retaining
their messages and draft; another device cannot resume that local worker.
Unit selection/receive cases and the real-IDB dirty-recovery case cover this.
The follow-up full Web run passed 1,120 tests/76 files and typecheck; Chromium
selective-sync passed ten cases and memory API/recovery passed JA/EN two cases.

Ubuntu CI on `ed8e3c7` exposed an E2E ordering assumption: document close returned
before the lock broker reported release, so the API safely retained pending.
The test now waits for the real `navigator.locks.query()` state before injecting
the recovery write failure. No delay/timeout is used as proof of a stopped worker.
Fresh cross-platform CI for this correction is still required.
