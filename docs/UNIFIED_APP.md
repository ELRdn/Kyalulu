# Unified App Implementation Status

2026-10-23 to 2026-10-29. **Partial implementation, not release acceptance.** No production
deployment, provider application, purchase, contract or DNS change has been performed.
PR #8 was merged as `fc590baf`; its post-merge Windows/Ubuntu CI passed. Follow-up
work continues incrementally on `codex/unified-app-integration`. Unrelated local
changes remain outside the integration commits.

## Local Build

```powershell
pnpm --filter web typecheck
pnpm --filter web test -- --pool threads --maxWorkers 1
$env:VITE_RELAY_ORIGIN='https://relay.kyalulu.com'
pnpm --filter web build:app
.venv/Scripts/python.exe scripts/unified_preview.py
```

Preview: http://127.0.0.1:5187/. This loopback-only fixture server has no login,
payment, advertisement, age-verification or inference connector. JP/US and age 18+
in its onboarding are **test fixtures, not approved regional policies**. Do not
publish this server. The built application is `.artifacts/unified-app`.
For the packed PC Runtime, use `pnpm --filter web build:native` and
`.artifacts/native-app`; a hosted App build is not a Native entry. Local first-use
uses the Runtime's explicitly configured `KYALULU_REGION_POLICIES`; absent regional
approval stays closed. No Cloud account or online policy lookup is required.
Existing `build` and `build:mobile` entry points remain separate and supported.
Pinned Mobile WASM outputs in `.artifacts/mobile-wasm` are required for `build:app`.

## Delivered Behavior

- Browser sync receive/ack transactions scan one record at a time, retaining only
  target/referenced bodies plus owner-wide IDs and the numeric high-water mark.
  Real IndexedDB cases preserve historical-only references, immutable current
  versions, unsent originals, collision/owner-change rollback and cached receipts.
  Outgoing batches now retain at most 50 dirty sync entities and only their
  referenced documents in one readonly snapshot; final counts recheck consent.
  List/individual-entity storage segmentation remains open. See
  [selective sync validation](validation/2026-10-29-unified-sync-selection.md).

- Same-path Cloud/PC target changes now force document reload, so previous Cloud
  access state and drafts are not reused on a missing PC. Unregistered PC Runtime
  calls are rejected before HTTP dispatch. Unit navigation cases and 24 actual
  commercial UI cases pass. See
  [runtime routing](validation/2026-10-29-unified-runtime-routing.md).

- Fixed `b133ce0` Cloud/Windows/legacy-Mobile candidates now include those client
  fixes. Clean-source tests/build, archive/precache/source comparisons and the
  Windows packed CLI's isolated recovery checks passed. Gates remain false;
  signing, real devices and production recovery are not accepted. See
  [package validation](validation/2026-10-30-unified-native-mobile.md).

- The fixed `bf83d03` Cloud candidate now builds as a distinct Linux image and
  passes isolated read-only/network-none application and default-command checks.
  Authorized production aggregates/digests matched before/after; running services
  were retained. Public cutover, migrations and recovery remain separate. See
  [isolated image validation](validation/2026-10-29-unified-container.md).

- Native Chromium IndexedDB quota errors now have explicit acceptance coverage:
  two owners each retain originals, revisions, durable outboxes and receipts
  after new/update saves fail at a 128 KiB origin quota; identical saves succeed
  after release and survive page reload. Physical disk/device acceptance remains
  separate. See [quota validation](validation/2026-10-29-unified-device-quota.md).

- Commercial UI now has actual-app JA/EN Chromium coverage at mobile/light and
  desktop/dark widths: home/explore/chat banners, 15-second/150-credit disclosure,
  insufficient-balance recovery, draft preservation, no automatic resend, and
  delayed responses across account switches. All 24 fixture cases passed; real
  advertising, payments and provider completion remain gated. See
  [commercial UI validation](validation/2026-10-29-unified-commercial-ui.md).

- Browser Runtime health/capability calls no longer load account entities, and
  selected conversation/Library operations skip unrelated conversation bodies.
  Lists and imports retain their required owner-wide reads. Captured-owner
  fencing, bindings, immutable revisions and unsent input are covered by new
  unit checks and existing real IndexedDB memory/export scenarios. See
  [route-read validation](validation/2026-10-29-unified-device-reads.md).

- Offline-cache selection walks one entity at a time and retains only selection
  metadata; eviction waits for each body read/write in one atomic transaction.
  Fresh IndexedDB checks cover protected records, concurrent changes, account
  switches, rollback after a write error and page restart. Single-entity capacity
  and real quota/device acceptance remain open. See
  [offline-cache validation](validation/2026-10-29-unified-offline-cache.md).

- Browser/Native downloads and Cloud transfer commit now parse UTF-8 and JSON
  incrementally without a whole encoded-document buffer. Verified syntax/hash
  and final consent still precede atomic storage; failed receives preserve data
  and cursors. Decoded trees/scalars and persistent storage still need segmentation.
  See [receive-stream validation](validation/2026-10-26-unified-sync-receive-streams.md).

- Browser/Native uploads and Cloud downloads serialize transfer bytes in 1MiB
  pages without a whole-batch UTF-8 buffer. Existing wire hashes, restart points,
  inline receipts and cancellation fences remain compatible; hashing-time account
  or consent changes stop before upload. Whole-entity storage/receive still needs
  segmentation. See [sync byte-stream validation](validation/2026-10-26-unified-sync-byte-streams.md).

- Cloud sign-in, consent, invitation/availability, provider explanations and
  success/errors follow JA/EN while retaining entered data and known disclosure
  gates. Pending authentication respects the latest analytics choice; replies
  after leaving the page cannot grant analytics or redirect. Actual app fixtures
  and callback tests pass. See [login language validation](validation/2026-10-26-unified-login-language.md).
  Residence choices now follow the server's accepted regional policies, with
  JA/EN names. Missing/malformed lists and removed selections close login;
  changed lists require fresh consent. Existing eligibility tickets remain
  mandatory. See [login regions validation](validation/2026-10-26-unified-login-regions.md).

- Actual initial entry verifies server eligibility and a complete ticket before
  the three optional interest screens. Interest edits retain current language,
  favorites and other unedited fields, and reset volatile choices across owners.
  Actual JA/EN app tests cover back/skip/later edits, Cloud chat login and anonymous
  device-only conversation creation. See [entry validation](validation/2026-10-26-unified-entry.md).

- Recommendations update immediately for same-tab and cross-tab preference
  changes, using existing tags and eligible catalog data. General surfaces retain
  publication ratings; guest favorites persist in their browser scope without
  an account write or implicit account merge. Actual Cloud chat still requires
  login. See [recommendation validation](validation/2026-10-26-unified-recommendations.md).

- Cloud and Native now share guarded static delivery. The unified Cloud bundle
  includes a canonical Caddy template with separate main/device/migration
  policies, explicit worker scope and HTML transformation protection. Actual
  loopback HTTPS/Caddy/Chromium checks pass; public cutover remains open. See
  [proxy validation](validation/2026-10-26-unified-proxy.md) and
  [deployment conditions](UNIFIED_DEPLOYMENT.md).
- Portable editor details now follow JA/EN across character, lorebook and preset
  kinds. Language/tab switches retain incomplete JSON and tag drafts; invalid
  JSON blocks Library Save. Authored content and original fields stay unchanged.
  See [Portable editor language validation](validation/2026-10-26-unified-portable-editor-language.md).
- Whole-Core restores now preserve current Native delivery/owner state, merge
  erasures and require separate-copy review for Native and Cloud links. Local
  recovery archives are created under the Runtime lock; the existing Cloud
  tenant lock/encrypted recovery archive remains in use. Fictional DB/media
  failures and related sync checks passed; production recovery remains open.
  See [Core restore validation](validation/2026-10-26-unified-core-restore.md).
- Preset, Lorebook, pinned-revision and expression controls follow JA/EN without
  changing saved titles or choosing newer revisions automatically. Existing error
  detail is rendered in the current language without re-fetching the Library.
  See [model/settings language validation](validation/2026-10-26-unified-model-language.md).
- Restoring a legacy logical snapshot now stops Native automatic sync for affected
  namespaces and retains old outboxes as withdrawn receipts. PC settings requires
  a fresh restore review before sending an independent copy; old Cloud data stays
  unchanged. Stale review IDs, account changes and unresolved receipts fail closed.
  See [Native restore validation](validation/2026-10-26-unified-native-restore.md).
- Native branches made before enrollment now retain a local canonical identity
  map for messages, memories and summaries. Explicit selection adopts the map;
  enrollment alone never uploads a branch. Ownership also propagates before the
  first upload receipt. Equal text in legacy branches is not ancestry evidence.
  See [local identity validation](validation/2026-10-26-unified-native-local-identity.md).
- Memory controls, provenance, inspection and summary corrections now follow JA/EN,
  including cross-world sharing and irreversible scope-erasure warnings. Small
  screens place memory type labels above content. Real device-storage UI checks
  cover canceled erasure and saved edits; OS IME composition remains unverified.
  See [memory language validation](validation/2026-10-26-unified-memory-language.md).
- Shared API/network error guidance and action labels use the browser language,
  while preserving existing routes, commands and accounting distinctions. Unknown
  provider detail text remains unchanged; other screen copy is still incomplete.
  See [error language validation](validation/2026-10-26-unified-error-language.md).
- Model disclosures, quote/training consent, route guidance and official-reasoning
  summary labels follow JA/EN. Consent remains revocable and an expired quote stays
  unsendable. Provider-supplied privacy notes remain verbatim. See
  [model language validation](validation/2026-10-26-unified-model-language.md).
- Cloud settings and legacy backup-sync labels, consent/confirmation copy and
  dates follow the selected JA/EN language. Subscription choices show their
  monthly credit quantity before secondary top-ups; closed billing stays closed.
  Other screens and shared/API error localization remain incomplete. See
  [settings language validation](validation/2026-10-25-unified-cloud-settings-language.md).
- Consented entity sync now sends large outboxes as resumable, encrypted 1 MiB
  transfer pages. Size and SHA-256 verification precede the existing atomic push;
  paged downloads are fenced by owner/revision/deletion. Browser/Native withdrawal
  stops the next part. Existing small-request APIs and pre-upgrade receipts remain
  supported. Multi-megabyte fixtures pass; single-JSON storage and
  250 MB/1 GB physical acceptance remain open. Staging lifecycle checks are in
  [transfer cleanup validation](validation/2026-10-25-unified-transfer-cleanup.md). See
  [entity transfer validation](validation/2026-10-25-unified-entity-transfers.md).
- Shared navigation, compact mascot home, recommendations before recent chats,
  three optional interest screens, and a target selector outside RuntimeGate.
- Public unified entry defaults to Cloud. `/device/` uses the same UI and browser
  Worker, account-scoped IndexedDB and existing pinned model download verification.
  Target changes preserve the original data/draft scope and never transfer chats.
- Generation or unresolved recovery blocks target changes and PWA activation.
  Device chat is not blocked by an offline network indicator.
- Browser memory retrieval, evidence validation, source-linked extractive
  chapter/arc summaries, basic RPG state and historical generation snapshots.
  Python/TypeScript share `tests/fixtures/unified-core.json`.
- Portable character/profile/Lore compilation now follows the Python portable
  compiler's macro, prompt-order, example, scan-depth, recursion, budget and
  compatibility rules on shared `tests/fixtures/portable-prompt.json` cases.
  A generated Python casefold table pins Unicode matching semantics. Selected
  library versions are checked for kind and rating instead of being ignored.
- Device Persona/World creation, immutable revision lists and creator JSON export
  use the existing shared screens. Cast knowledge/relationships and RPG outcomes
  are included in the device generation contract. Created settings travel as
  referenced snapshots through the consented Cloud bridge and hydrate in browsers;
  other private works are excluded. See
  [Portable validation](validation/2026-10-24-unified-portable.md).
- Device Library exports honor format, saved revision and preview/download for
  CCv2/3 JSON/PNG, CHARX and backups. JSON import retains verified original bytes;
  selected histories, revisions and fingerprinted receipts commit atomically.
  Shared fixtures and native readers check 30 outputs, with real IndexedDB
  rollback/concurrency/reload evidence. Imported card media requires renewed
  rights confirmation in Native storage. See
  [device export validation](validation/2026-10-25-unified-device-exports.md).
- Session/request temperatures, supported sampler overrides and the output token
  reserve reach the Worker. GGUF names are mapped to the installed runtime API;
  ONNX-only limitations and stop strings are reported as unsupported. Adjacent
  same-role prompt parts are combined, and context fitting retains system
  instructions and the newest user input rather than dropping World rules first.
- Browser conversation entities have revisions, durable dirty state and stable
  UUIDs. A consented outbox uses Web Locks and persistent request IDs; account
  verification precedes upload. The server encrypts payloads, rejects local-only
  uploads/credential metadata and preserves conflicting entities as branches.
- Browser consent withdrawal atomically marks pending requests as withdrawn.
  Only the request ID is sent for cancellation/receipt resolution. Applied receipts
  survive document reload without further traffic while consent is off, and are
  adopted after renewed consent without replaying the old body or losing newer
  edits. See [withdrawal validation](validation/2026-10-24-unified-browser-withdrawal.md).
- Cloud SQLite now has an opt-in, append-only entity bridge. Cloud/device Settings
  requires explicit consent and individual Cloud conversation selections; there
  is no automatic all-session export. Incoming device revisions create separate
  native conversations, labelled as synced copies. Original native rows and IDs
  are preserved. See [selected-sync validation](validation/2026-10-24-unified-sync.md).
- Received browser histories allocate device-wide numeric IDs while retaining
  message/memory UUIDs. Memory/summaries/snapshot/generation references move in
  the same transaction. Referenced Portable library versions are hydrated without
  replacing editable local documents; changed immutable versions abort the page.
- Completed Python generations now save attributable before/after state and memory
  snapshots in the finish transaction. Device snapshots import as native historical
  generations and export back without provider prompts or private shared memories.
  Native/device branches use the saved memory version, including user-message cut
  points, and regeneration invalidates only the corresponding branch's memory.
  Shared fixture tests cover this interchange. Historical snapshots also preserve
  the request system prompt, temperature and referenced Library/Creator versions;
  branches restore these settings without reading later edits. Missing historical
  versions roll back the complete receive transaction. Verified common ancestry
  is now recorded as an encrypted revision/message manifest, with the exact shared
  prefix compared against the stored ancestor, current head and incoming branch.
  Legacy/missing ancestry is labelled unverified; this proof covers messages, not
  equality of branch memories or a restorable archive of ancestor bodies.
  Synced Native branches retain common message/memory/summary identities and their
  namespace without opting the branch into upload. See
  [lineage validation](validation/2026-10-25-unified-lineage.md),
  [history snapshot validation](validation/2026-10-24-unified-history-snapshots.md)
  and [historical settings validation](validation/2026-10-25-unified-history-settings.md).
- Confirmed Cloud/device conversation erasure now uses account-scoped durable
  tombstones, revision checks, replay-safe receipts and backup/legacy-restore
  fences. Unsent edits survive as independent device-only recoveries. Updated
  Cloud revisions require another confirmation in Settings. Native-PC evidence
  is listed separately; production migration acceptance remains open. See
  [erasure validation](validation/2026-10-24-unified-erasure.md).
- Remote management is a separately persisted device permission granted/revoked
  on the PC. It does not grant Cloud, Host or pairing administration.
- Native PC entity sync now has explicit on-PC enrollment, sync-only session-bound
  credentials, owner/origin namespaces and durable SQLite outboxes. Selected local
  chats upload; account-synced chats arrive as separate native copies. Lost responses
  replay the same request, and withdrawal resolves by receipt or cancellation fence
  without resending the body. Local-only registration rejects LAN, public Host,
  proxies, Relay administrators and Cloud tenants. Settings and chat headers expose
  the state in JA/EN. See [Native sync validation](validation/2026-10-24-unified-native-sync.md).
- New pricing snapshots bind quantity, bonus, Stripe price and checkout expiry
  to the original request. Legacy checkouts retain legacy grants. Credit liability
  is backed without resetting existing funds, balances or private-test budgets.
- Funded trial/daily/ad grants, one pending reward per owner, reservations,
  verified completion input, expiration and replay-safe accounting are implemented.
  No production ad adapter is supplied. Client time never grants a reward.
- A 50px top banner slot and credit-options dialog are wired into shared screens.
  Device/native-local chats and subscribers do not display banners. Isolated
  sandboxed cross-origin frames receive no private app data.
- Regional eligibility tickets are issued and checked server-side for unified
  login. Unknown policies and unverified guardian consent fail closed. This is
  not adult verification; an independent provider receipt is required for that.
- Publication snapshots have revision/hash-bound human review, public search and
  shared links, reporting, hiding, appeals and withdrawal. Region/age/adult consent
  and author blocks precede ranking; legacy approvals without current evidence
  stay private. Classification/media adapters and operational acceptance remain
  open. See [publication validation](validation/2026-10-26-unified-publication-workflow.md).
- Old Mobile has `?migrate=1`; App has `#/migration`. The fallback file checks
  revision, byte length and SHA-256 before an atomic, replay-safe local copy.
  Originals remain intact; failed quota transactions do not replace existing data.
  Drafts are retained in the migrated payload even if localStorage restoration
  fails. Model files are never uploaded; fallback requires re-download.
- Both builds now include a neutral `/migration/` document. The old Mobile
  requires source-window consent before a nonce-bound, exact-origin MessageChannel
  is opened. One-MiB requests transfer the verified backup and selected matching
  catalog models directly between top-level windows. Model readiness is committed
  only after every file passes byte length and SHA-256; interrupted files are
  aborted without replacing an existing file. File export remains available.
- Offline retention keeps the ten most recently opened conversations plus pinned,
  dirty, device-only and pending-generation records. Older acknowledged synchronized
  bodies become identity-preserving stubs. Opening or pinning rehydrates through
  an owner-checked endpoint without rewinding the main sync cursor. Unavailable
  bodies return 503 rather than an empty conversation. See
  [cache/migration validation](validation/2026-10-24-unified-cache-migration.md).

## Feature Matrix

"Existing" means retained code, not a new full acceptance run on that target.

| Surface | Cloud/Python | Own PC/Python | Browser Device | Acceptance Gap |
|---|---|---|---|---|
| Character chat/settings | Existing | Existing | Adapter implemented | Real-model device 20-turn test |
| Memory/provenance | Existing; attributed manual-source API | Existing; attributed manual-source API | Retrieval/proposals/manual CRUD, source-kind/Python fixtures, Inspector/audit; shared-scope identity/CAS/segmented-domain/erasure foundation verified | Explicit Browser world/shared-scope migration still returns 409; normal generator/routes, regeneration/policy lifecycle and full real-model/shared-scope parity remain |
| Summaries | Existing | Existing | Extractive chapters/arcs/manual edits | Long-context/end-to-end fixtures |
| World/cast/RPG | Existing + creator snapshot bridge | Existing | Creator revisions, cast contract, RPG and selected Lore | Historical snapshot interchange and physical real-model acceptance |
| Branches | Saved state/memory/settings; recorded revision/message ancestry | Synced and pre-enrollment branch UUIDs retained; owner claims precede receipts; explicit upload selection | Saved snapshots and independent numeric IDs; user/assistant cut points | Legacy branches without saved proofs, restorable revision bodies and physical acceptance |
| Character creation | Existing | Existing | Portable editing, verified inert media upload and imported cards | Complete editor journeys, real-model/physical-file acceptance |
| Library interchange | Existing SFW restrictions | Existing + typed card media verification/confirmation | Six export formats, saved versions/originals; JSON/PNG/CHARX/backup/ST/CAI/BYAF import, atomic selected histories, explicit media playback | Additional real-world layouts, full editor/media journeys, supported codec differences and physical-file acceptance |
| Research/experiments | Cloud restricted | Explicit management permission | Shared generator, 16 scenarios, per-run memories, ratings/export/replay, scoped leaderboard and paired BenchmarkLab jobs with progress, timeout and cross-tab cancellation; no PC admin grant | Real model/hardware and operational-scale acceptance; Device jobs require their owning document to remain open |
| Sync | Selected SQLite export, separate copies, confirmed erasure | Scoped entity enrollment/outbox/cancel receipts; legacy backup retained | Outbox, withdrawal receipts, version consent, library hydration, local recoveries | Complete lineage, large conversations and production migration |
| Offline | Network generation required | Existing standalone | Recent ten, pinned, protected edits, hydration and stub identity | Real quota exhaustion, full PWA/browser/device restart acceptance |
| Mobile migration | Not a Cloud upload | Not applicable | Verified file fallback and selected chunked model/data transfer | Deployed-domain popup/CSP, Android/iPhone and large-model acceptance |
| Localization | Common entry/chat/creation/research/settings and reviewed snapshots JA/EN | Same shared UI, diagnostics/PC hosting/visual-novel controls JA/EN | Migration waiting/success/errors and model progress/errors follow language; memory errors retain the original cause | Complete screen inventory including remaining debug-drawer labels; real IME/device acceptance |
| Adult publication | Closed | Existing local controls retained | Closed | Vendor acceptance and public APIs/media gates |

When unified mode is enabled, the legacy Community routes also stay closed,
including reads, so legacy publication cannot bypass the unfinished unified
age/moderation workflow. Existing Community rows are retained. See
[Community gate](validation/2026-10-25-unified-community-gate.md).
Unified publication now uses separate reviewed snapshots at `/api/cloud/app/works`
and a private author/moderator queue at `/api/cloud/app/publications`. Approval
requires explicit human checks and a matching immutable hash. Reports, hidden
states, appeals, withdrawal and adult-specific enablement have revision checks;
general discovery excludes adult works. See
[publication workflow](validation/2026-10-26-unified-publication-workflow.md).
Public media and automatic classification remain unconnected; production age
verification and operating acceptance remain required.

## Not Complete

The new entity store has a **limited consented Cloud SQLite bridge**. New uploads
after consent create independent conversations in the existing Cloud chat APIs.
Existing uploads/receipts created before bridge consent are not retroactively
projected. New copies are not silently selected for export; choose each native
copy explicitly to bring subsequent Cloud edits back to devices. Unchanged
versions are not copied repeatedly; successive uploaded revisions create new
native copies. Native-PC entity bridging has isolated API/UI evidence; large-conversation
support, pre-enrollment/legacy lineage and complete snapshot interchange remain incomplete.
Cloud/device deletion and restore protection are implemented with fixture and
browser evidence; production/account/device-scale migration is not yet accepted.
Historical state/memory snapshots now import when provided. Branch/regeneration
still refuse missing history rather than inventing state. Older snapshots without
settings retain their previous current-settings fallback; past settings cannot be
recovered from absent data. Revision/message manifests now prove a shared prefix
when the ancestor is recorded, but do not reconstruct absent ancestor bodies or
prove historical memory equality. Native branches now retain canonical identity
before enrollment; older forks without saved identity proofs still need explicit
recovery decisions. Do not enable unified production on the
strength of this bounded bridge.
Portable prompt fixtures cover the portable compiler path; they do not establish
byte-identical prompts for every legacy YAML/template route or equivalent model
quality. Unsupported Lore conditions stay preserved with an audit instead of
executing source scripts or regex. Real GGUF/ONNX inference with the new prompt
assembly and sampler overrides has not been exercised in this phase.
Cache trimming runs after synchronization and reopening hydrated conversations.
Fixture evidence now covers explicit PWA update and a full Chromium close/reopen
with offline traffic. It does not establish physical-device behavior or OS network
transitions.

Outstanding: canonical per-message/memory revision mapping for all old databases;
native-PC large-scale/legacy-restore acceptance; identity proofs for older forks and
restorable ancestor bodies; all browser feature parity; deployed/physical-device chunked migration;
complete English UI; moderation classifier/report/appeal/public search/image
integration; actual adult/guardian provider adapters; a contract-approved ad
inventory/completion adapter and settled-revenue reconciliation; source archive
and signed distribution inventory for the unified build; physical-device testing.

The current feature matrix does not satisfy the approved plan's completion
condition. Passing the bounded tests below must not be represented as that result.

## Production Gates

`KYALULU_UNIFIED_APP_ENABLED` defaults to false. `KYALULU_REGION_POLICIES` defaults
to an empty object. Do not insert guessed regional approvals. Policies require
explicit versions and accepted minimum ages/guardian thresholds; production legal
approval remains independent. An adapter injection is not vendor acceptance.

Retain existing private-test restrictions. Do not enable Stripe for an adult
offering. No identity documents belong in the app database/logs. Ad provider
completion must authenticate raw provider bytes before normalization; browser
timers/messages are not completion evidence. Settled net ad receipts, not eCPM
estimates, may fund new grants.

## Recovery And Rollback

1. Stop generation and confirm saved outcomes before changing target or applying
   a PWA update. Export local/native data before any production migration.
2. Leave the old Mobile URL live. Use its migration export or existing backup
   fallback. Never delete the source browser's IndexedDB/OPFS during migration.
   Deploy the new neutral `/migration/` on both domains before offering direct
   transfer. Open it as a top-level page; the isolated `/device/` page must link to
   it instead of embedding a third-party iframe or weakening inference isolation.
   Preserve popup opener access only between the exact two migration origins.
   Missing popup/OPFS/Web Locks support uses file export and model re-download.
3. For sync failure, retain outbox records/request IDs and dirty data. Restore
   connectivity/login for the same owner and retry; do not replay generation POSTs.
4. Keep the operator database and tenant/native databases together with backups.
   Schema additions are additive. Do not drop/reseed credit lots, funding,
   receipts, revocations or test-budget tables to undo a release.
5. Disable the unified flag, advertising and sales for an unaccepted environment.
   Do not erase new IndexedDB stores, Remote keys or outboxes to roll back the UI.
   The app store now uses schema 2 with an additive outbox index. A client pinned
   to `indexedDB.open(DB, 1)` cannot reopen it; retain the schema-2-compatible
   client during backend rollback. Never delete the database to bypass this.
6. `/device/` documents require COOP/COEP and a CSP excluding advertising frames;
   the main app document must remain compatible with separately isolated ads.
   A deployment using Cloudflare/static hosting must apply the generated headers.
   `/migration/` requires `COOP: unsafe-none`, `COEP: unsafe-none` and its own CSP
   with `connect-src 'none'`. A reverse proxy must not add a conflicting global
   policy. Generated Pages headers use distinct document paths, without relying
   on overlapping COOP/CSP values being overridden.
7. Entity-transfer staging is disposable ciphertext. Startup and a 60-second
   worker reap expired/applied/canceled uploads and obsolete downloads. Retain
   source outboxes and request IDs: a missing stage restarts at part zero, while
   durable receipts and cancellation fences remain authoritative. Unreadable or
   linked stages are retained with count-only warnings. See
   [staging recovery](validation/2026-10-25-unified-transfer-cleanup.md).

## Bounded Validation

Indexed outbox guards, additive IndexedDB migration and five real Chromium
fixture scenarios are recorded in
[Outbox guards](validation/2026-10-25-unified-outbox-guards.md). Chunk checks no
longer load the entire outbox; staging and projection still materialize JSON.

Browser persistence now uses an additive IndexedDB v3 `parts` store for entity
and immutable outbox payloads, with pieces up to 1 MiB. Existing inline records
remain readable and are not eagerly rewritten at upgrade. See
[segmented storage](validation/2026-10-30-unified-segmented-storage.md) for the
transaction/owner/corruption checks and limits. A v2 client cannot reopen v3;
recovery requires a v3-compatible bundle and must preserve all stores. Decoded
trees and UI arrays remain whole. A separate opt-in Windows storage measurement
passed a 250 MB save/browser-restart/restore; 1 GB restored bodies did not pass
under the test's 4 GiB safety cap. Full chat/sync/phone capacity remains open.

Research exports now use the same RuntimeDownload/apiFetch path as Library and
Creator. Late bodies are rejected after account/target changes. Shared component
and transport fixtures are recorded in
[Runtime downloads](validation/2026-10-25-unified-runtime-downloads.md); complete
multi-source import parity and Browser Research execution remain open. Library
export-format/preview behavior now has
[separate validation](validation/2026-10-25-unified-device-exports.md).
JSON/PNG/CHARX/backup imports and owner-scoped inert media APIs/playback now have
[native-reference and real-decoder checks](validation/2026-10-25-unified-device-imports.md).
SillyTavern presets/WorldInfo, Character.AI JSON/text and BYAF scenarios/histories
also have [shared source fixtures](validation/2026-10-25-unified-device-source-imports.md).
Additional real-world layouts and complete upload/editor journeys remain open.

Current selected-sync work and browser fixture evidence are recorded separately
in [2026-10-24-unified-sync.md](validation/2026-10-24-unified-sync.md). The historical
counts below describe the preceding implementation phase, not the final tree.

- `tests/test_cloud*.py`, `test_unified_app.py`, Remote bridge/Host and Mobile API:
  459 passed before the final checkout-snapshot regression addition.
- Frontend suite: 356 passed, including shared core and damaged migration fixtures.
- Final unified boundary suite: 15 passed. Final pricing/Cloud-store subset:
  42 passed before the last two malformed/HTTP-boundary test additions.
- `build:app` passed with existing upstream WASM/chunk-size warnings.
- `build:mobile` and final frontend typecheck passed.
- In-app browser, isolated loopback fixture: three onboarding screens, Cloud
  default, device target confirmation, shared character intro, 393px light/dark
  layout, 1280px layout, Japanese draft after reload, and offline shell/data restart
  were observed. No real model was generated and no payment/ad was served.
- Explicit PWA update was offered, but browser automation stopped responding
  during activation. Application of the update and final viewport cleanup could
  not be confirmed; do not record that interaction as a passing test.
- Android/iPhone 20-turn generation, lock/resume, network transition, real ads,
  signed age verification, billing settlement, cache quota/race E2E and complete
  three-target functionality remain unverified. Desktop packaged artifacts were
  not rebuilt or installed.
