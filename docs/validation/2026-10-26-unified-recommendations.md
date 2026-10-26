# Live eligible recommendations and guest favorites

Application changes: `fcf79cf` and `42f98f5`. This is local application/fixture
acceptance, not public rollout or approval of regional service policies.

## Changes

- Home, the public-works section and the approved-work catalog use the shared
  preference subscription. Same-tab changes and real cross-tab storage events
  update ranking and dismissal without fetching the catalog again.
- Public lists retain their original eligible response and derive recommendations
  when rendering. Removing a dismissal restores the card immediately; previously
  the discarded card remained absent until another fetch.
- The shared ranker understands the publication `rating` as well as `nsfw`.
  General recommendations exclude an adult rating even when a candidate lacks a
  true `nsfw` flag. Favorites and official weighting cannot override audience,
  moderation, block or dismissal filters. The public section no longer rewrites
  returned ratings into a false `nsfw` flag.
- The public section uses the existing publication-scope remount pattern, clearing
  previous cards, filters and pending work on account/connection changes. Server
  approval, region, adult access and two-way author blocks remain authoritative;
  client ranking grants no access.
- Guest character favorites use the existing browser store in a separate guest
  connection namespace. Home previously silently attempted an account write;
  character detail required login for that same action. Both can now save a
  browser favorite before sign-in. Actual Cloud conversation still requires login.
  Signing in uses the existing account profile; guest favorites are not silently
  merged into it. Local execution retains its own existing namespace.

The ranker uses only tags, favorite/dismissed IDs and eligibility flags. Existing
taxonomy aliases such as `academy`→`school` and `癒し`→`healing` are reused. No
conversation text, memory analysis, analytics endpoint or new dependency is added.

## Verification

- Recommendation/taxonomy/publication unit subset: **14 passed / 2 files**. Tests
  cover audience/moderation/block/dismissal before favorite weighting, adult
  publication ratings, stable ties, existing tag aliases and a conversation-field
  getter that fails if the ranker reads it.
- Committed `fcf79cf`, fixed-lockfile offline dependencies: **756 passed / 62
  files**, TypeScript and unified App build passed. Existing Node localStorage,
  static-script/browser-external and bundle-size warnings remain. This full run
  precedes the guest-favorite follow-up, not a fresh full-suite claim for it.
- Guest-favorite/character-entry/account-profile subset after the follow-up:
  **12 passed / 3 files**, and TypeScript passed. Guests add/remove a browser
  favorite without an account write; login/logout/local execution remain separate.
  Character detail still sends a guest's actual chat-start action to login and
  still hides unverified adult content.
- `tests/e2e_publications.py` passes against actual React components, real
  Chromium storage events and an isolated Cloud ASGI database. A second browser
  tab changes tags, favorites and dismissals while each public list stays open.
  Reordering, removal and restoration happen with no additional catalog request;
  the test asserts that catalog traffic was observed before checking its count.
- The same browser fixture exercises human approval, fixed snapshots,
  report→hide→appeal→reapproval, blocking, account changes, adult enablement and
  expiry. Blocked works remain unavailable and switching accounts restores only
  the next account's eligible data and preference scope. There are **10** catalog
  GETs across the complete scenario and **8** explicit workflow writes; preference
  changes and the guest-home portion create no additional writes.
- The actual Home inside RuntimeGate is exercised anonymously. A browser favorite
  moves its card first, remains after reload and does not create an account or
  request private chat/profile data. Home's actual “Not interested” action removes
  the card immediately; clearing that preference restores it. Existing account
  count is unchanged. 393px/light and 1280px/dark screenshots fit their viewport;
  finite animations are completed before capture.
- Existing server tests for adult gates and block-before-search: **2 passed**
  (`tests/test_publication_workflow.py -k 'block_filters_before_search or adult'`).
  Fixtures use synthetic approved JP policies; these are not production approvals.
- Browser page errors and attempted external requests: **0**. Fixture submission
  assertions still reject private Library fields or externally fetched images.

Local results: `.artifacts/publication-browser/results.json`; UI evidence:
`.artifacts/publication-browser/guest-home-393-light.png` and
`.artifacts/publication-browser/guest-home-1280-dark.png`. Reproduce the browser
case with `python tests/e2e_publications.py`; it starts and stops only its own
loopback Vite process and uses fictional accounts/providers.

## Remaining delivery scope

This is component/RuntimeGate/ASGI evidence, not real OAuth, Android/iPhone,
production accounts, OS IME or a public-deployment claim. A guest favorite belongs
to this browser and is lost if its site data is cleared; account transfer is not
implicit. Existing signed-in profile error reporting is unchanged.

The retained `0d9b2f5` distribution predates these changes. Its recorded migration
evidence remains valid for that commit; regenerate and audit final release
artifacts from the completed integration source before production cutover.
No production state, provider settings, contracts, balances or deployment changed.
