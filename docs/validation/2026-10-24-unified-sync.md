# Selected Cloud/device synchronization — 2026-10-24

Partial implementation of the approved unified-app plan. No deployment, Git-state
change, provider call, contract or purchase was performed. Fixtures use disposable
tenant databases and invented browser data. This is not public-release acceptance.

## Implemented boundary

- Settings exposes individual Cloud conversation selection, explicit disclosure,
  versioned consent and revocation. Device-only conversations are not selected.
  Local synchronization stops before attempting server-side revocation, including
  while the Cloud connector is unavailable. Existing copies are retained.
- Sync and consent HTTP requests pin `X-Kyalulu-Owner` to the expected authenticated
  owner. Missing/mismatched sync account headers are rejected before tenant access.
  CAS conflicts require reloading the current consent revision.
- The bridge attaches only the owner's tenant `data.db`, rejects symlink scopes,
  requires rollback journals for atomic attached-DB commits, and refuses pending
  generations. Selected native sessions alone are exported. Unattributed/shared
  memories belonging to other sessions are excluded.
- An accepted device revision inserts a separate native conversation and isolated
  memory scope. Original numeric IDs/content remain untouched. Entity receipt,
  native copy, revision mapping and capacity checks share the transaction.
- Library snapshots carry the exact referenced revisions. Message/memory UUIDs,
  revisions, summary IDs and numeric provenance references survive round trips.
  Adult/media library snapshots remain closed.
- Browser receipt allocates device-wide message IDs atomically with cursor and
  library hydration. Historical memory snapshots and extractive summary links are
  remapped; shared JS object references are processed once. Independent branch
  numeric/memory IDs prevent edit APIs from matching another conversation.
- Immutable library revisions reject changed content. Library revision numbers
  are separate from entity transport revisions. Editable local current documents
  are preserved when adding a referenced snapshot.
- Acknowledgments retain edits made during upload and keep the source plus its
  branch copy. Conflicts rewind the download cursor so the original Cloud
  continuation is received as well. Duplicate acknowledgments do not clear the
  durable outbox. Revocation during receipt retains the outbox for reconciliation.
- Synced native copies are labelled in conversation lists. Imported native
  histories without trustworthy generation snapshots cannot branch/regenerate;
  the original history remains intact on refusal.

## Checks

- Cloud/account/auth/budget/catalog/pricing/sync/generation/conversation regression:
  **381 passed** before the final UUID/summary mapping additions.
- Final unified, Runtime bridge, generation and conversation subset: **64 passed**.
- Frontend full suite: **371 passed**; the subsequently expanded sync test file
  has **9 passed**, including two added end-to-end unit transaction scenarios.
  Transaction unit tests simulate queued IndexedDB requests and rollback; they
  are not evidence of real browser storage exhaustion.
- Final typecheck and unified build passed. The final two sync test files have
  **17 passed**, including acknowledgment/revocation race regressions.
- Build retains upstream WASM/externalized Node-module/chunk-size warnings.

## Browser fixture evidence

The fixture at `127.0.0.1:5191/.artifacts/sync-ui.html` renders the actual Settings
component and uses real IndexedDB with an in-page fake Cloud connector. It has no
real login and cannot call external providers. It uses a separate origin from the
existing preview at port 5187.

Observed: explicit confirmation; only checked `fixture-a` copied; unchecked
`fixture-b` absent; existing device-only `private` retained; numeric IDs unique;
referenced library revision 3 available; consent revision advanced on stop; local
consent false and existing copied data retained after stop. No console errors.
After the final UI change, a simulated Cloud consent-API outage was also verified:
the local consent becomes false first, Cloud consent remains explicitly
unconfirmed, the UI requests a retry, and all existing conversations remain.

At a 393×852 CSS viewport, the document's measured scroll/client width was 385px:
no horizontal overflow. The viewport override misaligned automated clicks, so
revocation was verified only after resetting the override. This is layout
evidence, not complete mobile interaction or physical-device acceptance.

Screenshots: `.artifacts/sync-ui/consent-mobile.jpg` and
`.artifacts/sync-ui/revoked-desktop.jpg`, and
`.artifacts/sync-ui/offline-revocation.jpg`. These show a fixture, not production data.
The temporary viewport override was reset. The existing conversation draft in
the original browser tab was not edited. The temporary fixture tab was closed.

## Remaining limits and recovery

Synced deletion fails closed with `sync_runtime_delete_confirmation_required`;
the durable batch stays queued. Do not erase it to hide the failure. Native
history snapshots, native-PC entity bridging, complete shared-history lineage,
automatic offline cache eviction/hydration and migration streaming remain open.
Revisions uploaded before native-copy consent are not retroactively projected.
New native copies require explicit selection for exporting later Cloud edits.
Media-bearing or adult Portable references require separately accepted adapters.
Native erasure/legacy snapshot replacement is not yet reconciled with the new
entity ledger and its revision links. Deleting one native copy must not be
advertised as global erasure of all synchronized copies. This lifecycle boundary
must be completed and tested before production activation.

On failure, stop generation and retain all source data/outboxes. For consent CAS
conflicts reload Settings. For quota failure free explicitly chosen, already
backed-up data; no unsynced data is automatically removed. Preserve control and
tenant databases together when restoring. Do not change journal modes underneath
active sync. `KYALULU_UNIFIED_APP_ENABLED` remains false by default.

Automatic approval review rejected an earlier patch containing source-record
deletion due to unsynced-data loss risk. That patch was not applied. The accepted
implementation retains the source and a separate branch copy; no permission
exception was used.
