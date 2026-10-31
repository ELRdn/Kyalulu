# Memory scope catalog without full history restoration

`/api/memory/scopes` used `allEntities` to find legacy scopes, both alongside
shared domains and through the raw Device fallback when domains were empty.
Opening the catalog could therefore retain every conversation's complete body
and decode unrelated library entries before filtering them.

The catalog now handles empty, legacy-only and mixed catalogs in one route.
`visitMemorySources` advances one IndexedDB cursor only after the current source
has passed complete checksum/JSON validation. Its synchronous visitor retains
scope counts/dates, while source messages are discarded. It shares the same
decoder with `readMemorySource`; no partial `AppEntity` is constructed or saved.
Non-conversations, deleted headers and other owners are filtered before body
reads. Existing local/sync binding visibility, active/total counts and date sort
remain. The obsolete full-entity fallback in `deviceApi.ts` is removed.

No schema, persisted entity, owner, consent, synchronization or inference contract
changes. Empty catalogs now return their final `{scopes: []}` directly rather
than internally delegating to another handler; the existing owner-isolation test
checks that response instead of the old internal null sentinel.

## Validation

- Seven new route tests fail against the old implementation: one null fallback
  and six forbidden whole-entity reads. The tests use the existing IDB harness
  through real `appTransaction`; the shared harness itself is unchanged.
- All **150 focused cases / 4 files** pass after the correction. They include
  82-message segmented legacy sources, inline compatibility, mixed local/sync
  domains, exact counts/order, zero retained root messages, a synchronous cursor,
  skipped corrupt unrelated/deleted/foreign bodies, missing/checksum-corrupt final
  parts, invalid closing JSON with valid manifest SHA and owner changes. Read-only
  failures preserve entities, domains, receipts and the fixed outbox.
- All **1,385 Web tests / 87 files**, TypeScript checking and the unified Vite
  production build pass with existing dependencies. Sandbox temporary SSR cache
  paths initially caused missing-module-file setup errors; an owned workspace
  TEMP/TMP directory and `--no-cache --maxWorkers 1` allow the same assertions to
  run. No deadline/assertion or dependency change was made.
- The actual Chromium projection driver passes **14/14 scenarios**, including a
  new catalog case with a full 80-message peer, an 80-message unbound legacy source
  and a corrupt non-conversation whose body must not be opened. Complete entity,
  domain, receipt and fixed-outbox comparisons survive reload. No API/external
  attempts or page errors occur; all 15 contexts and owned Vite are closed.
- The existing common-UI scope driver is rerun after this integration: JA/393px
  and EN/1280px shared recall, own snapshots, migration, erasure, durable reply
  and reload checks pass with synthetic inference and no external/API attempts.

Local logs: `.artifacts/memory-catalog-red.log`,
`.artifacts/memory-catalog-green-reviewed.log`, `.artifacts/memory-catalog-web-all.log`,
`.artifacts/memory-catalog-typecheck.log`, `.artifacts/memory-catalog-unified-build.log`,
`.artifacts/memory-catalog-projection-browser.log` and
`.artifacts/memory-source-projection-browser/result.json`; common-UI evidence is
`.artifacts/memory-catalog-scopes-browser.log` and
`.artifacts/device-memory-scopes-browser/result.json`.

The separate [1 GB memory projection diagnostic](2026-10-31-unified-memory-projection-capacity.md)
uses the earlier fixed source before this decoder extraction/catalog integration.
It is not a current-source 1 GB catalog measurement. Catalog reads still scan
complete bodies, metadata/scalars and domains can remain whole, inline bodies
remain inline, and scope counts grow with the number of scopes. Full generation,
history mutations, export/sync capacity and physical-device acceptance remain
separate work. This change performs no deployment or production-data operation.
