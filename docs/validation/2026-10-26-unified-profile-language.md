# JA/EN profile and direct-server settings

Product source: `57236d8`, exported from Git into a clean collected-source tree.
Pending Core restore and unrelated documentation/tool changes were excluded.

## Changes

- Profile names, save/loading/failure states, counts, theme controls, saved
  characters, pinned chats and management guidance follow JA/EN. Catalog failures
  retain their causes and translate when displayed, without refetching on a
  language change. Known account-sync errors use the shared error formatter.
- Local names still save on blur. Cloud names still require an explicit save,
  remain locked before a profile is available and retain their pending-save
  state. The composing-Enter guard, account ownership and mutation ordering are
  unchanged. Language changes do not reset the name draft.
- Direct-server bookmarks and their confirmation/errors follow JA/EN. Existing
  bookmark names/addresses and in-progress form input remain original. HTTPS,
  loopback and credential/path validation, the twelve-entry limit and explicit
  navigation are retained. The warning still requires checking an active
  generation before switching and explains that conversations do not transfer.
- When execution is on-device, the settings now identify this browser as the
  storage location. Previously they described the connected server as storing
  conversations even in Device mode. Registered-PC connection controls in this
  section are reserved for other execution modes; the shared execution selector
  and PC settings continue to provide the linked-PC route.
- Unified profile pages still hide the legacy local adult-content toggle. This
  change does not activate adult/provider services or replace server verification.

## Evidence

- Related language/account-profile/error suites: **85 passed**.
- Full clean-source Web suite: **720 passed / 56 files**.
- Web typecheck and clean-source unified build: passed. Existing Node localStorage
  and Vite script/externalization/chunk warnings remain.
- Unit checks retain names, authored character labels, saved/pinned links,
  account save and unavailable-profile locking, composing Enter, unverified-count
  hiding, sync failure text and explicit destination-review links. Nested settings
  modules and account responses are fictional stubs in those profile unit checks.
- The actual built App, Native static server and Chromium passed the extended
  `tests/e2e_unified_pwa.py` in fresh profiles:

| Language | Width | Theme |
|---|---:|---|
| JA | 393 px | Light |
| EN | 393 px | Dark |
| JA | 1280 px | Dark |
| EN | 1280 px | Light |

The driver enters a fictional local display name, switches language while the
field remains focused and verifies that input persists without an early save.
Blurring via a theme control then saves that exact name using the existing local
behavior. Both theme choices update their checked state and the original theme
is restored. In-progress destination name/HTTPS-address fields survive the next
language switch while the bookmark store remains unchanged: the form is never
submitted and its external address is never opened.

The Device storage disclosure is visible in both languages. The legacy adult
switch is absent. Returning through the actual pinned-chat link retains the
composer draft, conversation payload, revision, IDs and sync/deletion flags;
only the existing cache-recency timestamp changes when reopening. Tested pages
have no horizontal document overflow. English 393px profile and server settings
captures were visually inspected.

The preceding search/management/uncertain-result checks and subsequent explicit
PWA update, another-tab rejection and full-browser offline restart also pass.
Every condition records **0 server API requests, 0 external requests and 0 page
errors**. Device adapter requests continue to use actual local IndexedDB.

## Limits

The browser name-save test is Device/local-only. Cloud name saves, unavailable
profiles and composition boundaries here have fixture evidence, not live OAuth,
real account or OS IME acceptance. Direct-server validation/navigation retains
its existing behavior; no actual server, relay pairing or new bookmark was used.
Legacy relay/pairing/registration screens and other untranslated fields still
need language review.

Eligibility, pending-generation and worker-update fixtures, offline renderer
emulation and hardware/provider limits remain as documented in
[Chat management language](2026-10-26-unified-chat-management-language.md).
No model download/generation, destructive confirmation, production deployment or
commercial activation was performed. Earlier distribution candidates must be
rebuilt at the final release revision.
