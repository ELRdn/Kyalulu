# JA/EN chat management and uncertain-send recovery

Product source: `07affb5`. The unified build and full Web suite used a clean
Git export collected by the shared release-source collector. Unrelated working
tree changes and pending whole-DB Core restoration were excluded.

## Changes

- The chat list now translates search/sort controls, saved-character sections,
  empty states and recoverable errors. Generated conversation titles match both
  Japanese and English searches regardless of display language. Authored names,
  previews, IDs and existing pin/sort behavior remain intact.
- Message editing, deletion, branching, reply versions, one-attempt regeneration
  directions and conversation information follow JA/EN. Clearing displayed
  history is explicitly distinguished from permanent erasure. Erasure warnings
  retain synced-copy scope, conflict review, unsent local edits, cost ledgers and
  backup-retention limitations. Mutation guards and API ordering are unchanged.
- Persona/world/narration/story controls translate their labels. Display-language
  changes do not rewrite saved prompt instructions or story drafts. Applying a
  story direction remains an explicit action.
- Recovery notices translate at render time while preserving the existing v1
  draft/pending record, reconciliation and polling. An uncertain result still
  blocks new sends and conversation changes and never causes automatic resending.
  Known ID/storage failures and HTTP result-check diagnostics are translated.
- The shared error formatter preserves partial-erasure context before matching a
  generic network failure: server erasure succeeded but local cleanup could not
  be verified. A trailing `Failed to fetch` no longer hides that distinction.

## Evidence

- Related language/recovery suites: **28 passed**.
- Full collected-source Web suite: **716 passed / 56 files**.
- Web typecheck and clean-source unified `build:app`: passed. Existing Node
  localStorage and Vite script/externalization/chunk warnings remain.
- Unit checks cover two-conversation ordering and pin precedence, bilingual
  generated-title queries, original-name retention, recovery diagnostics,
  partial-erasure warnings and explicit-only story prompt application.
- `tests/e2e_unified_pwa.py` passed against the actual built App, Native static
  server and Chromium in four fresh disposable profiles:

| Language | Width | Theme |
|---|---:|---|
| JA | 393 px | Light |
| EN | 393 px | Dark |
| JA | 1280 px | Dark |
| EN | 1280 px | Light |

The driver edits a fictional greeting and cancels; opens message-deletion and
branch confirmations and cancels; opens both history-clearing and permanent-
erasure confirmations, verifies their distinct warnings and cancels. Every
cancellation retains the full IndexedDB conversation record and composer draft.
No destructive confirmation is accepted.

It then searches the one actual local conversation, pins it, changes sort order
and switches languages without changing the query, result link or pressed state.
Returning to the conversation retains the draft, payload, revision, IDs and
sync/deletion flags. Reopening updates the existing `opened` cache-recency
timestamp, so only that field is excluded when comparing across navigation or
reload; live language changes and cancellations still compare full records.

For recovery, the new profile receives a fictional pending ID in its existing
draft record. The real Device adapter returns HTTP 404 for that absent ID. The
localized notice explains uncertainty and no automatic resend; changing language
retains the exact pending record, submitted draft, current draft and conversation
content. The original fixture record is restored before subsequent update tests.

Explicit PWA updates, another-tab update rejection and full-browser offline
restart still pass. Each condition records **0 server API requests, 0 external
requests and 0 page errors**. Device adapter calls use real local IndexedDB and
are distinct from server-network requests. English mobile erasure and recovery
captures were inspected; tested pages have no horizontal document overflow.

## Limits

No deletion, branch creation, saved message edit, generation, real provider or
production request was performed in this display/cancellation check. Successful
mutation semantics remain covered by their separate fixtures. Browser sort
checks use one conversation; relative ordering is tested with two in the unit
suite. Arbitrary Runtime/provider error bodies may remain in their original
language.

Eligibility, the absent-generation ID and worker update markers are fictional.
Offline status uses renderer emulation separately from uncached-network rejection
and persistent-profile restart. These checks do not establish real models,
physical Android/iPhone behavior, OS IME, live Cloud/Remote, commercial contracts
or production acceptance. Other screens still need language review. Previously
recorded distribution candidates require rebuilding at the final release revision.
