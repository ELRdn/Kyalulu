# Initial entry and scoped interest editing

Application source: `13c5568`. Local JA/EN acceptance against fictional policies;
this does not approve production regions, guardian verification or public launch.

## Corrections

Interest editing previously captured the whole preference record. Completing the
three screens could restore an old language, favorite/dismissal list or another
owner's choices. It now renders the current language and saves only the three
edited choice groups into current preferences. The existing owner-keyed component
pattern resets volatile choices on owner changes; the finish action also checks
its original owner before writing. Existing saved preferences are not deleted.

Initial eligibility checking now rejects incomplete success responses and replies
that arrive after an owner change. It requires a nonempty bounded ticket, matching
country, known age band and policy version before saving confirmation. Only
confirmed region/age fields are merged into current preferences. Inputs stay
disabled during the check. Guardian-required and account-changed outcomes have
specific JA/EN guidance; unavailable verification remains closed.

Initial entry and interest sections declare their actual text language. The entry
language control has an explicit accessible name, and entry controls/interest
labels have at least 44px targets. The loopback-only preview returns a clearly
marked dummy ticket for its existing fictional eligibility response; it is not a
real authorization token and cannot be used for real sign-in or publication.

## Actual application browser acceptance

`tests/e2e_unified_entry.py` uses the actual `main.tsx` application, navigation,
RuntimeGate, initial entry, character/chat pages and settings. A private Vite
process enables the existing unified-entry build flag. Requests reach an isolated
Cloud ASGI app through a loopback broker; external/provider requests are rejected.
The two complete cases are **JA / 393px / light** and **EN / 1280px / dark**.

Accepted in each case:

1. Required terms consent blocks submission before any eligibility request.
   An unknown region is rejected by the real server. A fictional JP policy with
   minimum age 13 and guardian threshold 18 rejects age 15 without verified
   guardian consent. This is fixture policy, not a regional legal determination.
2. An injected HTTP 200 response missing its confirmation fields is rejected.
   A valid server reply held until after an account switch is also rejected;
   neither installs a ticket nor marks entry accepted. The pending controls are
   disabled. A later valid confirmation supplies a real fixture-store ticket
   that the same server verifies for JP before continuing.
3. All three interest screens are used. Back retains earlier choices, Skip
   advances, and finishing saves school/cool/comfort choices. Recommendations
   appear with Cloud as the initial execution choice.
4. Selecting a character's Cloud conversation enters login. No OAuth request is
   submitted. Explicit execution switching then opens `/device/` without login;
   the actual character action creates a conversation and opens the composer.
   Real IndexedDB contains one guest-owned conversation with local storage policy.
   Creation issues no Cloud request. No model is downloaded or run.
5. Settings reopen the saved interests. Changing the genre to fantasy, switching
   language while the editor is open, and updating favorites/dismissals through
   the shared preference event preserve all those changes when finishing.
   Unedited mood/activity choices remain intact.
6. Changing owner while holding a reference to the previous finish button cannot
   save the previous draft into the next scope. The new editor starts with empty
   choices; skipping all three saves an independent empty selection. The previous
   owner's saved fantasy choice and favorite remain intact.
7. After switching to device, conversation creation and all subsequent preference
   operations produce no Cloud traffic. No account or credit lot is created in
   the fixture Cloud database. Page errors and external requests remain **0**.
   Final settings fit the tested viewport. Screenshots complete finite animations.

The first browser run reproduced the stale-language behavior. The follow-up tests
then proved current preference preservation, owner isolation, actual genre edits,
missing-ticket denial and held-response denial. They are not simulated screenshots
or a helper-only implementation of the onboarding UI.

## Other verification and reproducibility

- Shared-entry/search/favorite unit subset: **22 passed / 3 files**, TypeScript
  passed. The dedicated real-browser scenarios cover the new async/UI branches.
- Clean committed source `13c5568`, fixed-lockfile offline dependencies:
  **758 Web tests / 63 files**, TypeScript and unified App build passed. Existing
  Node localStorage, static-script/browser-external and bundle-size warnings remain.
- CI now includes `uv run --no-sync python tests/e2e_unified_entry.py` on both
  Ubuntu and Windows. Local success is not a claim that current-head CI finished.
- Local summary: `.artifacts/unified-entry-browser/results.json`. Genre/settings
  screenshots are retained alongside it. Reproduce with
  `python tests/e2e_unified_entry.py`; it owns only its loopback Vite/Chromium and
  temporary fixture store. It temporarily sets `VITE_UNIFIED_APP=1` for that test
  process, restoring the original environment afterward.
- Corresponding source includes this record, the entry driver, its existing
  `browser_fixture_server.py` helper and the referenced loopback preview script.

## Remaining evidence

Production policies remain unapproved/closed. These checks do not qualify actual
guardian/adult providers, OAuth completion, real inference, Android/iPhone,
assistive technologies, OS IME or production cutover. The build is a source/dev
browser acceptance, not fresh production HTTPS, PWA, installer or packaged-release
acceptance. Final distribution must be regenerated from all integration changes;
the earlier `0d9b2f5` candidate is not the current application source.
