# Confirmed unified erasure and restore — 2026-10-24

The user explicitly approved implementation and disposable-fixture testing under
`docs/UNIFIED_SYNC_ERASURE_REVIEW.md` after an automatic review rejection. No real
production conversation was erased. This record supersedes the previous phase's
statement that every synced deletion is blocked.

## Verified behavior

- New deletions require `delete_confirmed`, the authenticated owner and the
  expected entity revision. Stale revisions return a conflict without erasing
  data. Settings shows the downloaded Cloud revision/message count and obtains
  another explicit confirmation before issuing a fresh deletion request.
- Durable owner/entity tombstones prevent old updates, duplicate receipts and
  legacy restores from reviving deleted conversations. A late update receives
  the tombstone instead of creating a new native copy.
- Unchanged linked native copies are erased with related source memories and
  generation references using the existing staged-restore erasure helper inside
  the attached-DB transaction. Other original conversations remain untouched.
- Unexported native edits are detached as local recoveries and deselected from
  automatic Cloud export. Browser dirty edits similarly become independent
  device-only copies. Generation records for retired conversations are scrubbed;
  records for another account remain untouched.
- Native confirmed purge updates the Cloud entity tombstone in the same
  transaction. Retention backups carry erasure fences. A pre-erasure backup and
  legacy snapshot cannot restore the erased native conversation.
- Legacy snapshot replacement invalidates old numeric-ID mappings. Export is
  blocked until the user confirms the selection again; restored content then
  uses a separate stable identity, preserving the existing Cloud continuation.
- Over-quota accounts can still receive existing data/tombstones and confirm
  erasure. Native uploads that do not fit are rolled back to a savepoint and
  reported as deferred; their source edits remain available locally.
- Device-only complete erasure clears payload and generation records in one
  IndexedDB transaction. Pending synchronized erasures retain their source
  payload until reconciliation so conflicting edits can be protected.
- Runtime mutation requests also pin the expected Cloud owner header. No Cloud
  credentials are forwarded to Remote.

## Evidence

Final checks for this phase: **123 backend/source-delivery tests passed**,
**378 frontend tests passed**, typecheck and unified build passed. The earlier
bounded counts below preserve the order in which coverage was added.

- Backend erasure/sync/restore/conversation/account subset: 96 passed before the
  legacy-replacement reconfirmation and capacity refinements.
- Expanded backend and source-delivery subset: 122 passed before the final
  over-quota deferral addition. Final unified subset: 37 passed.
- Frontend full suite: 377 passed before the last race regression and small
  generation-record helper refactor. Final affected frontend subset: 37 passed;
  final typecheck passed.
- Source/bundle/fingerprint subset: 22 passed. The final unified build also
  includes the shared generation-record helper and quota-deferral refinements.
- Real browser at `127.0.0.1:5192/.artifacts/erasure-ui.html`: the actual
  `SyncDeletionReview` displayed Cloud v2 / two messages, required explicit
  reconfirmation, then showed zero pending deletions and an empty retired
  payload. The actual device erasure endpoint cleared local-only payload and
  generation status. Remote erasure of dirty fixture history produced a
  `storage_policy=local`, `dirty=false` recovery. Console errors: zero.
- Screenshot: `.artifacts/unified-erasure-ui/verified.jpg`. The fixture is isolated
  from the existing preview and real accounts. Its tab was closed after checking.

## Production observations and remaining work

Read-only HTTPS checks: app/cloud/mobile returned 200; local did not connect.
Verified SSH inspection found `kyalulu-cloud:20261016-pr7-rp`, healthy, zero
restarts. The existing origin is still cloud.kyalulu.com, private test enabled,
one signup, zero trial grants, billing/ads disabled. Its existing private budget
configuration was inspected without modifying it. No provider was called.

The app.kyalulu.com cutover, native-PC bridge, complete imported-history snapshot
interchange, full device parity, offline-cache lifecycle, streamed migration,
complete localization, public moderation/report/appeal, signed packaging and
physical-device evidence remain open. Stripe/ad/age adapters are unaccepted
commercial integrations and remain closed. This is not completion of the full
unified-app plan or production deployment.
