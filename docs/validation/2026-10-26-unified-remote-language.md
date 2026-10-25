# JA/EN PC registration and generation-safe key retention

Final product source: `2662dd3`, following `f9f290e`. The isolated source tree
began with a clean Git export/collection of `f9f290e`. Only ConnectionSettings,
Profile and the Remote E2E driver were then copied from `2662dd3`; no uncommitted
Core or unrelated work was included. Release collection intentionally omits test
drivers, so the same-commit Remote driver was added only to the validation tree.

## Changes

- Registered-PC lists, encrypted-pairing instructions, pending/success notices,
  connection status and direct-server device registration/revocation follow
  JA/EN. Device/host names, relay addresses, approval codes and key records remain
  original. Known QR/key/lockout/connection failures use the shared error formatter
  and retain meaningful HTTP status diagnostics.
- Language is read at render time. Changing it does not add a registration
  request, clear the name/code fields, repeat polling or change the selected PC.
  Existing origin/pinned-key validation, PC approval, encrypted transport,
  eight-digit direct-server codes and authentication ordering are unchanged.
- Key removal now rejects while generation is active, before opening IndexedDB.
  Previously the UI could delete a key and only afterward discover that the
  following connection switch was blocked. The key, selected destination and
  saved drafts now remain available for result reconciliation.
- Switch/key-removal failures retain their diagnostic instead of disappearing
  into an unhandled click or a generic deletion failure. Both languages explain
  stopping generation and confirming its saved result before switching.
- PC-mode profiles show the registered-PC list once, through the existing shared
  DeviceSettings component. Direct-server bookmarks remain available; standalone
  connection-recovery screens retain their PC list. No new pairing protocol,
  credential store or dependency was introduced.

## Evidence

- Related Remote language/store/RPC/error suites: **81 passed** before the
  follow-up; affected search/profile/Remote suites: **23 passed** afterward.
- Full final-source Web suite: **730 passed / 58 files**.
- Web typecheck and final-source unified `build:app`: passed. Existing Node
  localStorage and Vite script/externalization/chunk warnings remain.
- Unit fixtures cover retained names/codes, explicit-only actions, hidden key
  canaries, localized guard/lockout/HTTP errors, eight-digit code constraints,
  failed-pair draft retention and direct-registration revocation guidance.
  Store checks prove generation blocks key removal before any IndexedDB open and
  blocks connection changes before localStorage/location writes. Stopped-state
  storage failures still propagate.
- `tests/e2e_remote.py`: **12 acceptance checks passed** using actual Chromium,
  a loopback Relay, an isolated Native Host/SQLite runtime and real Noise
  encryption. Model responses are Mock. The final run uses the unified app shell
  with an explicit fictional region/age/preferences record.

The browser registers in English, changes to Japanese while PC approval is
pending and retains the exact name, confirmation code and single pending device.
After PC approval, changing language retains a SHA-256 fingerprint of the actual
IndexedDB key records. The unified profile shows exactly one registered-PC list.
Opening its destination review, switching language and canceling retains the same
key fingerprint and one authorized device. English pairing/settings captures were
visually inspected.

During a delayed Mock generation, the actual browser store refuses key erasure;
IndexedDB records, selected destination and active-key reference remain unchanged.
The subsequent disconnection/reload yields one authoritative completion without
resubmitting the generation. Existing checks also pass for denied Host/Runtime
administration, a hash-identical 3 MiB encrypted media roundtrip, no plaintext
Runtime HTTP, widths 320/360/393/1280 without horizontal overflow, Host reconnect
and device revocation preventing further Runtime access.

- The actual final unified build also passes the full Device/PWA driver in four
  fresh profiles: JA/393/light, EN/393/dark, JA/1280/dark and EN/1280/light.
  Search, management cancellations, uncertain-send and profile drafts, explicit
  updates, other-tab rejection and full-browser offline restart remain valid.
  Each condition records **0 server API requests, 0 external requests and 0 page
  errors**, while Device adapter calls use actual IndexedDB.

## Limits

The encrypted PC run uses development Vite/loopback origins, an emulated phone,
fictional eligibility and Mock generation. It does not qualify hosted TLS,
deployed CSP, real pairing QR scanning, physical phones, real models, OS IME or
production origin/key migration. The separate built Device check does not turn
the development PC run into a production-build transport qualification.

Direct-server registration controls and failure states here have unit fixture
evidence; live direct-cookie registration/revocation is outside this phase.
No existing user key, production DB, ledger or deployment was changed. Whole-DB
Core restoration, commercial/provider acceptance and complete release gates
remain open. Distribution candidates must be rebuilt at the final release
revision.
