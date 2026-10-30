# Device generation recovery history proof

Device terminal-result reconciliation now reads the generation receipt and selected
saved messages in one readonly IndexedDB transaction. It retains at most the
requested user/assistant messages plus the currently decoded candidate instead of
restoring the complete message array. Every body part, byte length, SHA-256, UTF-8
sequence and JSON structure is still validated. All bytes are scanned once per proof;
this is not an indexed random-access reader or a universal memory bound.

The JSON selector accepts one or two distinct positive safe integer IDs, snapshots
the request, supports nonmonotonic IDs and checks an object's final ID after it
closes. Non-object root messages are discarded with syntax validation. Duplicate
selected IDs in the final messages array fail closed. An overwritten root messages
key retains normal last-value semantics; nested messages and `__proto__` do not
change the selection scope.

The Device GET `/api/chat/history/proof` returns a separate proof containing the
receipt identity/status, conversation revision/body token and at most two minimal
message rows. It cannot become a saved `AppEntity`. The client compares receipt
generation/session/status/message IDs with its earlier status result and rejects
malformed proofs, duplicate/unrelated rows, aborts and owner/target changes.
Reconciliation still requires a matching terminal status and saved assistant ID
before settling the exact durable pending record. Failed checks preserve pending
and draft and never resubmit generation. The Device screen then reloads its latest
page; Cloud and PC continue using their existing full-history API.

New normal/regenerated receipts retain the originating user ID and input SHA-256.
A committed proof checks user/assistant roles, saved reply text when present, and
the input hash when present. Editing the regenerated input now invalidates
`last_generation` through the existing history mutation logic. Legacy receipts are
not rewritten: receipts without input hashes cannot prove unchanged input text,
and old regeneration receipts without a user ID can only verify the assistant
ID/role and any recorded reply. A changed/deleted generated reply remains unresolved for
review; this change introduces no automatic conflict acknowledgement or erasure.

Local validation passes:

- **1,314 Web tests / 84 files**, TypeScript and the unified production build.
- **35 real Chromium/IndexedDB scenarios**, including old IDs outside the latest
  page, matching receipt/body snapshots, unchanged storage, legacy/failed results,
  edited input/reply, deleted/duplicate/wrong-role messages, invalid receipts,
  missing discarded parts and owner changes during read/on completion.
- Real App JA/393/light and EN/1280/dark resume a historical committed reply outside
  the visible 50 messages, preserve the composer draft, and subsequently send and
  regenerate without losing any of the 152 saved messages. Existing navigation,
  stale cursor, editing, lazy tools and account-isolation checks also pass.
- The existing shared execution-lock browser scenarios pass. Model readiness and
  inference in these fixtures are synthetic; external requests and page errors
  are zero. These are not real inference or physical-device results.

Metadata, one candidate message and selected scalar values remain whole. Legacy
inline rows are cloned by IndexedDB before filtering. Pending/orphan recovery
writes, generation, mutation, memory projection, hydration, sync and export retain
full-read paths. The original 1 GB full-tree failure and the separate earlier page
sample are unchanged; no 1 GB proof/UI/generation acceptance is claimed here.
