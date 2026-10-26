# Cloud sign-in language and current privacy choices

Application source: `b1e9c9f`. Local UI/protocol acceptance with mocked auth/email;
no real Google login, email delivery, provider contract or production change.

## Delivered behavior

Cloud login, registration guidance, country/terms/analytics controls, invitation
and unavailable states, email success/errors and return navigation now follow
JA/EN. Switching language keeps entered email, country and existing consent and
does not refetch status or submit authentication. Notices retain their error code
or state key so translation uses the current language rather than a frozen string.
The login region declares its text language; selects have 44px minimum targets.

The shared provider-disclosure formatter accepts a language while preserving its
previous Japanese default. English retains destination/model identifiers, input
retention and training/per-send-consent warnings, direct-generation disclosure,
settlement/limit rules and no automatic provider forwarding. Provider-authored
privacy notes remain verbatim. Known consent versions and metadata validation
are unchanged; translation does not approve an unknown disclosure.

An unknown disclosure closes login, clears stale provider metadata/consent and
requires a known status plus fresh consent. Pending/unknown metadata no longer
renders a guessed default DeepSeek destination. Country, terms and email inputs
stay locked during an auth request; language and optional analytics remain usable.
The latest analytics choice in that form is read when the request completes, so an
older request cannot grant analytics after withdrawal. Replies after leaving the
login component cannot grant analytics, set notices or redirect the new page.

## Verification

- Login/disclosure/guest-route unit subset: **35 passed / 3 files**. Components
  retain both-language fields, render error codes without retry, refuse unavailable
  auth and preserve provider IDs/version gates. Callback tests with mocked
  hook/auth/analytics boundaries cover denied→denied, denied→explicit grant, and
  an unmounted login response with an OAuth URL. No real redirect is executed.
- Clean committed source `b1e9c9f`, frozen-lockfile offline dependencies:
  **765 Web tests / 64 files**, TypeScript and unified App build passed. Existing
  Node localStorage, static-script/browser-external and bundle-size warnings remain.
- Actual main application/RuntimeGate/CloudLogin in Chromium passes **JA / 393px /
  light** and **EN / 1280px / dark** through `tests/e2e_cloud_login.py`. It uses a
  disposable Cloud ASGI store, a genuine fixture-store eligibility ticket and an
  HTTPX MockTransport accepting only the fictional Supabase OTP request.
- The fixture preserves existing private-test constraints: one invited email,
  one signup slot, no trial/sales/ads. Its two mocked OTP calls deliver no email.
  There is no callback/token exchange, account creation or credit-lot creation.
- Country selection withdraws terms consent. Missing country/consent keeps login
  disabled; known status and explicit consent allow the test email request. Its
  JSON matches the original eligibility/provider/version fields exactly.
- A held auth response allows language changes and analytics withdrawal while
  keeping email/country/terms locked. Success and injected HTTP failure notices
  translate afterward without another auth request or status fetch. Entered data
  and the original safe return path remain intact.
- Injected future disclosure metadata closes the form and clears consent. Restoring
  known metadata requires another checkbox confirmation. Injected unavailable
  status remains closed even for a programmatic submit. Each case makes **5**
  deliberate/initial status reads and **2** explicit auth attempts; only the first
  reaches the mock OTP provider, with the second receiving a fixture HTTP 503.
- The long login panel fits its viewport horizontally and both header and footer
  remain reachable by scrolling. Header/footer screenshots complete animations.
  Observed page errors and external requests: **0**.
- Existing actual initial-entry/interest/Cloud-login/device-chat browser flow was
  rerun after the login change and passed both JA/light and EN/dark cases.
- Preceding application head `3ebb42d` completed Runtime/Web CI on Ubuntu and
  Windows (PR run `40254996628`). The new login driver is added to both CI
  platforms; this is not a claim that the current head's new run has completed.

Actual browser analytics is disabled on loopback. The latest-choice assertions
use the component callback tests' analytics spy; they do not qualify real public
GA cookies, scripts, consent revocation or collection. No tracking endpoint is
added or activated by these changes.

Local summary: `.artifacts/cloud-login-browser/results.json`; header/footer
screenshots are alongside it. Reproduce with `python tests/e2e_cloud_login.py`.
The driver owns only its loopback Vite/Chromium and temporary fixture store and
restores its temporary `VITE_UNIFIED_APP=1` environment afterward. Corresponding
source includes the driver and this record; the shared fixture-server helper was
already collected.

## Remaining delivery evidence

Real OAuth/email completion and cookies, public TLS/CSP delivery, accepted regional
and provider terms, legal-copy approval, real public analytics, assistive
technologies, OS IME and physical devices remain unqualified. The existing JP/US
login country choices are retained; this phase does not establish global regional
coverage. The subsequent [region-choice change](2026-10-26-unified-login-regions.md)
replaces the fixed choices with accepted server policies. Raw provider notes remain authored data. Final distributions must be
regenerated from the completed integration source; the earlier `0d9b2f5` candidate
predates these changes. No production settings, data, finances or deployment changed.
