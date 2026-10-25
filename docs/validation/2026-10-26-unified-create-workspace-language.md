# JA/EN Create workspace and transactional source-import choices

Product changes: `c31a6e8`, then `a65b493`; mock-store fixture: `3eaa0a6`.
Validation began with a clean Git export/collection of `c31a6e8`. The changed
source/tests from the subsequent commits were copied directly from Git into that
isolated tree. Test drivers were added only for validation. Unrelated working
tree changes and pending Core restore work were excluded.

## Changes

- Create library actions, temporary-draft/storage status, import review,
  duplicate/rating choices, conflict review, save/export dialogs and creation
  chooser follow JA/EN. Stable format IDs, URLs, versions, user-authored content,
  request IDs and scope guards remain unchanged.
- Success notices retain semantic state and render in the current language.
  Errors retain their original Error/status metadata until rendering. A failed
  save still preserves its matching draft/payload and request ID; the shared
  formatter keeps that recovery warning even with a generic network failure.
- URL import and source-information labels follow JA/EN. Licensing, source URLs
  and author text remain original. Browser provenance is still described as
  user-supplied; source-link allowlists and opener/referrer protections remain.
  Blocked browser storage no longer crashes URL input initialization. Retrieval
  still requires an explicit action and preserves format/licensing options.
- The Device Runtime had always returned an empty duplicate list. It now matches
  live, same-owner Library items using the complete source identity fields used
  by Native: source, source ID, source SHA-256 and optional document index.
  Incomplete/absent provenance is not inferred from names or raw file bytes.
- Commit rechecks duplicates in the same IndexedDB read/write transaction as
  item/history/original/receipt writes. New source imports require an existing
  target or explicit copy; two concurrent unchecked requests cannot both commit.
  An already committed request ID returns its receipt before duplicate checks.
  Unclassified source content requires a rating, and adult declarations remain
  blocked pending verification. Provenance always comes from the saved preview.

Ordinary local files without source identity may still be imported again, as in
Native. This is not a global byte-hash deduplication or automatic merge feature.

## Evidence

- Related Create/error/source-match suites: **76 passed**. After extending the
  old mock IndexedDB with the owner-range scan, affected Library/source/Create
  suites: **26 passed**.
- Full final-source Web suite: **747 passed / 61 files**; typecheck and unified
  build passed. Existing Node localStorage and Vite warnings remain.
- Unit checks retain authored names/versions, pinned export format/revision,
  same-ID failed-save recovery, permission status, singular counts, licensing,
  source-link filtering and explicit-only URL retrieval. Source matches exclude
  other owners, deleted items, different hashes/indexes and incomplete identities.
- Actual IndexedDB/Device API acceptance in `tests/e2e_device_export.py` passed
  both setup and reload. It covers duplicate preview, rejection without mutation,
  explicit copy and revision update, retained preview provenance despite a forged
  client claim, successful receipt replay, and concurrent new requests returning
  one 200 and one 409. Missing rating returns 400; adult selection returns 403;
  an explicit general rating succeeds. Another owner sees no duplicate candidates.
- The same browser acceptance retains its prior six export formats, exact
  original bytes, quota rollback/retry, revision conflicts, Native asset
  re-import and three denied foreign-owner exports. Blocked network requests: 0.
- The actual final unified build passes the expanded
  `tests/e2e_unified_pwa.py` in fresh profiles:

| Initial language | Width | Theme |
|---|---:|---|
| JA | 393 px | Light |
| EN | 393 px | Dark |
| JA | 1280 px | Dark |
| EN | 1280 px | Light |

Each condition creates a fictional plot draft, switches language and reloads.
The complete temporary record and request ID remain unchanged. Canceling the
leave dialog retains editing; choosing Keep draft and reopening the chooser
resumes the same draft. Explicit saves create versions 1 and 2 under one stable
ID, retaining the first version. Export review retains its format after language
change, and the actual downloaded V3 JSON contains the second description.

The browser imports a fictional Portable file with explicit browser provenance.
Changing language preserves its preview URL without saving automatically. The
second import exposes the source duplicate and disables saving until a choice
is made. Explicit copy selection survives another language change; canceling and
then leaving review preserves both saved items and the temporary import draft.
No duplicate copy is committed in this UI-cancellation check; copy success and
concurrent enforcement are tested separately in the IndexedDB acceptance above.

The source tuple in this file is a fictional user assertion. No source site is
contacted, and it is not treated as verified origin/licensing evidence. The
English 393px workspace capture was visually inspected, with no horizontal
document overflow in the four conditions.

Existing creator/version/owner checks, conversation payload/draft preservation,
uncertain-send recovery, explicit updates, another-tab rejection and full-browser
offline conversation restart also pass. Every condition records **0 server API
requests, 0 external requests and 0 page errors**; Device API operations are local.

## Limits

PortableEditor's internal detailed field labels are still primarily Japanese.
This phase qualifies the surrounding Create workspace controls, not complete
English authoring. Raw conversion/source diagnostics may retain their original
language. URL import options have fictional unit responses, not live provider
qualification.

Temporary Create drafts use the existing browser session storage. The test
qualifies same-tab reload/resume, not persistence after closing the browser.
The later offline browser restart checks conversation drafts separately. Live
OAuth/Cloud/Remote authoring, actual media/model generation, large-library scale,
OS IME, physical phones and production were not qualified here. Commercial
connections stay closed; release candidates still need rebuilding at the final
revision, and the full integration plan remains open.
