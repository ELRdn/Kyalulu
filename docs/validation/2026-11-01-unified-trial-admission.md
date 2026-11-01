# Unified account admission when free grants pause

Unified enrollment previously required the initial free-credit reservation to
succeed. With no free funding, account creation rolled back and the mocked
OAuth callback returned `login_error=authentication_failed`. The requirement is
to pause new grants when their backing is unavailable, while preserving account
access and existing paid balances.

`CloudStore.account()` now makes the initial grant optional only in unified
mode. `_trial()` returns false only when that optional reservation reports
`free_budget_exhausted`. No credit, backing or successful-trial marker is created.
Other errors still escape the surrounding transaction and roll it back. Legacy
beta enrollment still requires backing; signup limits and provider/commercial
acceptance gates remain unchanged. No schema, prices or production settings
change.

## Local evidence

Before the fix, the new store regression and mocked OAuth regression both fail.
Afterward, six focused tests pass, followed by all **182** tests in:

```text
tests/test_cloud.py
tests/test_cloud_auth.py
tests/test_cloud_beta_admission.py
tests/test_cloud_cost_accounting.py
tests/test_billing_price_history.py
tests/test_unified_app.py
tests/test_unified_reward_acceptance.py
```

The checks cover zero-budget registration/login, no unbacked grants, unchanged
paid-credit ledgers on repeated login, signup-cap rejection, rollback after a
reservation error, and the existing backed 1,000-credit/30-day grant without
duplicates. The OAuth test uses ASGI and MockTransport with fictional identity
and region policy; checkout remains closed with
`billing_awaiting_acceptance`. No real identity, payment or production data is
used. Private evidence is under
`.artifacts/unified-trial-admission-20261101/` (`red-store.log`, `red-auth.xml`,
`green-focused.xml`, `related.xml`). `git diff --check` passes.

Hosted validation of this change, real OAuth and production acceptance remain
pending. PR #9 stays Draft; region/provider confirmation still gates cutover.
