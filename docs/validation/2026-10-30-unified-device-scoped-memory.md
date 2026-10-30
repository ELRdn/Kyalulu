# Device memory routes and normal generation

2026-10-30. This follows the [atomic scope contract](2026-10-30-unified-memory-scope-contract.md).
The common Device memory routes and normal generator now use those domains;
`/scope-migrate` performs a revision-checked copy rather than returning a stub 409.

## Behavior

- New conversations use world/revision memory scopes. Existing conversations stay
  private until explicit preview/migration. Branch and recovery copies remain
  independent. Same-asset version drift requires migration even with memory off.
- Public scope addresses keep the logical `work:`/`char:`/`session:` prefix and
  add `|device:local` or `|device:sync`; identical identities never cross storage
  policies or accounts. Rows with missing, deleted or differently stored sources
  are excluded from retrieval. Evicted source bodies require opening the source.
- Scoped list/detail/search/events/manual CRUD, toggle, preview/migration and
  explicit shared clear use the actual pool. Manual additions can be attributed
  to a validated same-scope conversation; source-less global additions remain
  outside canonical conversations. Existing legacy audit records are retained
  when the source is first bound.
- Normal generation retrieves shared rows but persists only each conversation's
  attributable own projection. Foreign numeric source IDs never enter its
  canonical memory arrays or before/after snapshots. Pool access/audit changes,
  own projections and generation receipts share source revision CAS.
- Regeneration retains the accepted reply and pool until replacement succeeds.
  It invalidates that reply's model-produced memories across retained pools,
  preserving other sources, later manual facts and explicit corrections. Manual
  corrections keep generation/quote provenance while dropping the numeric link
  to the replaced reply. A failed generation restores the admitted domain and
  retains the previous accepted body. Legacy regeneration also retains later
  manual facts.
- History deletion/editing invalidates model memories derived from affected
  generation receipts, detaches deleted numeric references in manual memories and
  snapshots, and removes invalid derived summaries/debug pointers atomically.
  Pending work must be reconciled first. User-authored manual facts remain; the
  next generation and sync validation remain usable. Individual history writes
  reject GET/POST before loading private records.
- Proposal deduplication uses the conversation's own facts, retaining independently
  stated equal facts from peers. Python uses the same source rule, including the
  existing exact private-session NULL-source compatibility. Forgotten rows do not
  suppress a fresh memory from new evidence; their old IDs remain deleted.
- Erasure removes attributable copies and foreign diagnostic evidence, while
  authored input/replies remain in the other conversation. Identical text in a
  user's own input is not treated as proof that it came from the erased source.

## Local evidence

- Scoped API: **39** cases; scoped generation/lifecycle: **11** cases. These use real storage
  functions with a transaction harness and a fictional inference result.
- The final full Web run passed **1,244 tests / 80 files**.
  TypeScript and the production Web build passed.
- Python identity/provenance/manual-memory/conversation/restore/source-collection/
  fingerprint selection: **153 passed**, with the original provenance goldens
  unchanged. Both runtimes retain separate sources for equal facts.
- Real Chromium/IndexedDB with the common MemoryPanel passed **JA/393px/light**
  and **EN/1280px/dark**: UI legacy-to-world migration, normal Device generation
  recalling a peer, own-only canonical/history memories, source erasure with
  diagnostic redaction and retained authored reply, explicit cross-world copy,
  correct debug scope, and document reload. Existing scope atomicity, corruption,
  orphan recovery and quota rollback probes also passed.
  The normal generation also retained its own independently repeated fact after
  erasing a peer, and remained usable after deleting its source user message.
- The inference Worker and model metadata are fictional. External/API network
  requests and page errors were zero. Report and screenshots are private under
  `.artifacts/device-memory-scopes-browser/`. Owned Vite/browser processes closed.
- Existing common memory UI **3**, legacy memory API/recovery **2** and Device
  Research **2** browser cases passed after integration.

## Remaining acceptance

Fresh clean CI and matching fixed-source Native/Cloud artifacts are required.
Actual model behavior, full Python/Device lifecycle parity, physical Android/iPhone,
operational-scale memory domains and bounded decoded RAM remain unverified.
Source bodies/domains are still decoded as a whole; segmented bytes do not prove
1 GB restoration. Production backup/cutover and uncontracted providers remain
separate closed gates. This is not completion of the entire unified plan.
