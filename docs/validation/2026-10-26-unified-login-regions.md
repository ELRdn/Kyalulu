# Cloud residence choices from server policy

2026-10-26. Application source: `10edfd6`. Local acceptance only; no production
regional policy, legal approval, authentication provider or deployment was changed.

## Behavior

Both `/api/cloud/status` and `/api/mobile/status` expose `login_countries`.
In unified mode this sorted list includes only configured policies with
`accepted` exactly `true`. No configured accepted region means
`login_available: false`, even when authentication credentials and legal approval
are present. Non-unified Cloud retains its existing JP/US eligibility behavior.
The response does not publish the regional policy configuration or credentials.

CloudLogin renders these choices using platform JA/EN region names, with region
codes as the fallback when display names are unavailable. It no longer hardcodes
JP/US. Missing, empty, malformed or duplicate lists close the form. Submission
also checks membership, including programmatic submission. A changed list
withdraws terms consent; a removed selection is cleared. Restoring a region does
not restore the old selection or consent or start authentication automatically.
Language changes retain the entered data without fetching status or starting auth.

Country selection grants no eligibility. Existing server ticket validation still
checks country, age/guardian requirements, expiry and current policy version before
an auth flow can begin. No new region is implicitly approved. Existing clients
can ignore the additive status field; new login UI against an old status response
remains closed. Deliver the matching server and app together, with the server
updated first if a staged cutover is required.

## Verification

- Cloud contract/auth tests: **50 passed**, including both status aliases,
  accepted fictional GB, rejected JP/US/CA policies, no accepted region, legacy
  JP/US compatibility, missing/mismatched eligibility tickets and mocked OTP.
  Country selection alone reaches no provider. No account or credit lot is created.
- Login/disclosure/guest component subset: **36 passed / 3 files**. The subset
  includes JA/EN region names, exclusion of an unlisted country, direct-submit
  rejection of stale membership, and existing consent/analytics behavior.
- Clean committed corresponding source, frozen offline dependencies:
  **766 Web tests / 64 files**, TypeScript and unified App build passed. Existing
  Node localStorage, dependency-script, static-script, browser-external and
  bundle-size warnings remain; they are not new acceptance evidence.
- `tests/e2e_cloud_login.py` runs the actual main App/RuntimeGate/CloudLogin
  with disposable ASGI data and mocked OTP in **JA / 393px / light** and
  **EN / 1280px / dark**. Its fictional GB ticket is accepted, JP remains a
  selectable fixture, and unaccepted US is absent. The browser passes only the
  selected GB and original ticket/version fields to auth.
- The same browser test removes selected GB and confirms empty selection,
  withdrawn consent, no implicit auth and rejection of direct form submission.
  Missing, empty, null, scalar, duplicate, mixed-type and lowercase lists each
  keep authentication closed. Returning the normal list requires selection and
  consent again. There are **14 status reads / 2 explicit auth attempts** per
  language case. Only one attempt per case reaches the fictional OTP provider;
  the other receives an injected HTTP error. No real email is delivered.
- Existing actual initial entry, interest editing, Cloud login timing and
  anonymous IndexedDB device-chat creation pass both language/width/theme cases
  against this committed source. External requests and page errors are **0**.
- Preceding head `ae51ead` passed Runtime/Web CI on Ubuntu and Windows, PR run
  `40304741386` and push run `40304735813`. This does not assert a later head's
  CI outcome. Current CI is tracked on the draft PR.

Local browser evidence is under `.artifacts/cloud-login-browser/` and
`.artifacts/unified-entry-browser/` in the corresponding-source verification tree.
Reproduce with `python tests/e2e_cloud_login.py` and
`python tests/e2e_unified_entry.py`. Drivers own their temporary Cloud store,
loopback Vite and Chromium; they do not use production cookies or accounts.

## Remaining evidence

GB/JP here are explicitly fictional fixtures, not country-launch approvals.
Real regional/guardian/provider suitability, public OAuth/email completion,
cookies, public analytics, physical devices and production delivery remain open.
The old `0d9b2f5` distribution predates this change; final artifacts require
regeneration and audit from the completed integration source.
