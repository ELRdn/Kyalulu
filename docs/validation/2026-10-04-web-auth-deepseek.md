# Web authentication and selected DeepSeek route

Scope: user chose DeepSeek V4.1 Flash; requested no subscription, credit usage,
an administrator grant worth $0.05, and Google-backed Web accounts before testing.

## Implemented

- OpenRouter transport, quotes and safety use only `deepseek/deepseek-v4.1-flash`
  via `inference-net` (InferenceNet). Alternative model IDs are rejected.
  Prompt/completion ceilings are $0.02/$0.45 per million; actual charge is `usage.cost`.
- Updated provider disclosure, consent version and JA/EN privacy drafts. Earlier
  DeepInfra/Go consent cannot authorize this destination. Public acceptance flags stay off.
- Google/email-link login UI, invitation and unconfigured states, retry after cancelled
  OAuth, verified account identity and logout. Existing Supabase PKCE was extended,
  including encrypted identity, invited-email enforcement and bounded callback errors.
- A private test configuration allows exactly one email/one account, no automatic
  1,000-credit trial, Stripe keys, billing workers, billing endpoints or purchase UI.
  This explicitly separate private test does not mark public legal acceptance complete.
- Offline `cloud_admin.py grant` issues 500 credits with an idempotent source,
  30-day expiration and budget backing, after the verified account exists. It cannot
  create an account or grant through the public API.
- Wallet exposes available balance, reserved/used credits and recent generation usage.
  Durable replay returns the settled charge without charging again.
- Private API budget includes prior actual fees and uncertain reservations. It carries
  49,548,721 nanodollars forward against the authorized 100,000,000 ceiling. Spent,
  failed, uncertain and held amounts survive restarts and month boundaries. Reducing
  the configured prior amount does not refill the durable allowance.
- Runtime character constraints preserve the selected voice and prevent assertions
  about unstated user history/actions. This is not additional human quality acceptance.

## Verification

Python tests use mock HTTP only. Across affected batches, 115 distinct cases passed in
`test_cloud_auth.py`, `test_openrouter_launch.py`, `test_cloud.py`,
`test_opencode_go.py`, `test_deepseek_vision.py`. The latest auth/route batch passes
41 cases, including the additional wrong-Google-email callback. After credit-usage/
replay changes, 69 affected cases passed. Web tests: 8 passed. Web production build and Ruff F pass.
Existing bundle-size and browser externalization warnings remain.

Chromium at 390px verifies configured/unconfigured login states, consent gating,
mock OAuth initiation, email acknowledgement, cancelled-login recovery, verified
identity, 500-credit fixture balance, no subscription/purchase controls, sync off,
and fixed DeepSeek selection. Page errors: 0. No real inference requests.
Evidence: `.artifacts/cloud-auth-ui-2026-10-04/acceptance.json` and screenshots.
The browser's 500-credit account is a fixture, not the user's real account.

## Still required

- Supabase project URL/anon key, enabled Google OAuth client, exact redirect URLs,
  invited email, HTTPS runtime hosting and optionally custom SMTP.
- Live Google login, expiry/revocation, browser/device acceptance and selected
  production SSE transport verification.
- Actual administrator grant to the user's verified UUID. **Not performed:** no
  verified real account exists yet. No placeholder/private local account was issued.
- No deployment/publication or additional API charges in this implementation session.
  Original quality evidence and its $0.0495487202 accounted total are unchanged.

Setup: [Web login](../WEB_AUTH.md). Local secret configuration was prepared as
Git-ignored `.env.cloud.local`; it is not a deployment or OAuth registration.
