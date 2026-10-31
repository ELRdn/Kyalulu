# Memory migration ownership and erasure diagnostics

2026-10-30. Source changes and synthetic validation only; no production data was
read, erased, restored or migrated for this change.

## Corrected paths

- Copying a manual memory from an explicitly attributable `session:<sid>` scope
  now fills a missing source session on the copy. World/shared copies can then be
  found by the source conversation's permanent-erasure operation. The original
  row is retained; existing non-null provenance is preserved. Unknown provenance
  in genuinely shared/world scopes remains unknown.
- Erasing a referenced source already removed retrieval candidates, decisions,
  injected/evidenced IDs and raw prompt/compiled/attempt snapshots. The same
  operation now clears `validation.errors`, which duplicates attempt diagnostics
  and can include the original text. Reply, state, validation status/retry count,
  unrelated memories and the input object are preserved.
- The common debug drawer now renders its headings, empty/loading/error labels,
  close control and accessible name in the selected JA/EN language. Saved prompts,
  JSON, model/source IDs and fetch handlers are unchanged.

## Fresh evidence

- The pre-fix synthetic regression run failed all three selected cases: both
  world/shared ownership cases and diagnostic erasure.
- `tests/test_conversation_parity.py`: 27 passed after the fix. The two new cases
  migrate, retain the original, erase the source and check another conversation's
  retained result. They also preserve an explicitly different source owner.
- `tests/test_backup_parity.py` and `tests/test_core_restore_sync.py`: 22 passed.
  Existing cases now check diagnostics after local restore, encrypted Cloud Core
  restore and explicitly resumed runtime sync. All files/DBs use `tmp_path`.
- `pnpm --filter web exec tsc --noEmit --incremental false`: passed.
- Earlier source `93eae08` PR CI run `41018909468` finished successfully on both
  Windows and Ubuntu, including the real Chromium memory-audit transaction test.
  That result predates this change and does not validate this source revision.

## Remaining boundaries

Previously migrated shared rows with lost provenance cannot safely be assigned
to a source by matching their text; this change does not rewrite them. Browser
Device world/shared-scope migration still returns 409. A real implementation must
partition owner and storage policy, keep foreign message IDs out of canonical
conversation snapshots, and cover generation fences, branches, erasure and sync
recovery together. It is not accepted by this repair.

No physical-device or debug-drawer browser/accessibility test was run for these
labels. Fixed-source distribution rebuilds, production backup/cutover, provider
contracts and PR #9 merge remain separate outstanding steps.
