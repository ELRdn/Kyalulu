# Unified Cloud Stop and accounting: local acceptance

2026-10-31, shared workspace `D:/VibeCoding/my zeta`, branch
`codex/unified-app-integration`, baseline
`19b4fcd02dc0728599e7a23cabbe4558eb470c65`. Repository `.venv`: Python 3.13.5.
Cloud status/cancel session conflicts now return 409 while preserving both
tenants; explicit Stop fences late successful results and charges zero Credits.

## Changes and coverage audit

The backend portion of this change comprises:

- `runtime/python/cloud/app.py`: a four-line `generations.Conflict` exception handler.
- `tests/test_cloud_stop_acceptance.py`: three test functions, eight collected cases.
- This validation note.

Existing Cloud tests already cover the following; no duplicate cases were added:

| Contract | Existing evidence executed |
| --- | --- |
| Provider failure/cancellation charges the user zero Credits while retaining operator cost | Entire `test_cloud_cost_accounting.py`, including `test_failed_generation_retains_known_stream_bill_once_and_replay_is_free` (13 stream faults), upstream 429, missing/invalid usage, client-close cancellation/failure, and crash recovery |
| Successful replay does not send again or debit again; no user credit holds | `test_low_balance_caps_output_without_credit_hold_and_replay` and other cases in `test_cloud_direct_generation.py`; `test_generation_quote_screened_commit_and_idempotency` |
| Credit tariff version changes invalidate quotes, while already reserved markup stays fixed | `test_pending_tariff_stays_fixed_and_old_quotes_are_rejected` |
| Provider tariff changes invalidate quotes, including legacy migration | `test_legacy_quotes_migrate_and_changed_provider_tariff_requires_a_new_quote` |
| Changed route/reasoning conditions invalidate a quote before sending | `test_changed_route_or_reasoning_conditions_require_new_quote` |
| Changed memory content invalidates quotes; retrieval timing alone does not | Both `test_cloud_memory_quote_ignores_only_retrieval_duration` cases |
| Erasure during preparation/reservation cannot start a generation | Both `test_cloud_erasure_fences_prepared_memory_before_reservation` cases |
| Late storage completion cannot restore a cancelled reply or lose training consent | All three `test_training_record_survives_interruption_without_restoring_reply` cases |

The missing integration coverage was the authenticated **Cloud Stop API** combined
with late provider success and financial settlement, plus concrete owner,
acceptance-limit, and time-expiry quote rejection. The added tests reuse the
existing fictional configuration/enrollment/ASGI-client/SSE-response helpers and
the existing autouse `forbid_real_http` fixture. Both native HTTPX transport entry
points are blocked; ASGI and MockTransport are the only intended traffic paths.

`test_explicit_cloud_stop_fences_late_success_and_settlement`:

- Obtains a quote through `/api/cloud/quotes`, starts `/api/chat`, and waits on a
  provider event rather than a sleep. The public status is pending before Stop.
- Posts the explicit `/api/chat/generations/{id}/cancel` request. The fictional
  provider catches cancellation and then delivers a valid successful SSE response
  with a known 10,000 nano-USD bill. The `save` stage proves the successful result
  reached the persistence path; the cancellation tombstone still wins.
- Checks cancelled public/durable state, empty reply, **0 charged Credits**,
  unchanged 500-Credit balance, empty history/runtime state/memories/memory events,
  and unchanged sync revision. Repeated Stop and POST replay preserve the terminal
  outcome, with exactly one provider call.
- Checks both the live store and a reopened `CloudStore`: recovery followed by a
  late `settle(..., 20_000, success=True)` preserves the failed ledger state,
  original 10,000 operator cost and zero user charge. There is only one operation,
  and no credit/fund holds remain. Tenant status `cancelled` and ledger state
  `failed` are the existing separate representations.
- Always shuts down jobs and joins the owned request task. Deadlock guards are
  ten seconds, not latency acceptance thresholds.

`test_cloud_quote_boundary_rejects_before_reservation_or_provider` has three cases:
another funded owner submits the quote; `max_credits` is one below the quote;
the persisted expiry is set to zero. All reject with 409 and the expected
`quote_expired` / `quote_not_accepted` code, no operation or holds, no tenant
generation, no job, no provider call, and unchanged balances for both owners.
The two-owner fixture uses an isolated, fictional public configuration and local
subsidy ledger because the existing private-test configuration intentionally
admits only one account. No real registration, funds or payment activity occurs.

## Commands and results

Working directory for every command: `D:/VibeCoding/my zeta`.

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_cloud_stop_acceptance.py tests/test_cloud_cost_accounting.py tests/test_cloud_direct_generation.py tests/test_cloud_model_choices.py tests/test_cloud_safety_pricing.py tests/test_cloud.py::test_integer_aggregate_and_failed_cost tests/test_cloud.py::test_reservation_expiry_order_and_quotes tests/test_cloud.py::test_pending_tariff_stays_fixed_and_old_quotes_are_rejected tests/test_cloud.py::test_generation_quote_screened_commit_and_idempotency tests/test_cloud_parity.py::test_cloud_memory_quote_ignores_only_retrieval_duration tests/test_cloud_parity.py::test_cloud_erasure_fences_prepared_memory_before_reservation -q -p no:cacheprovider --basetemp=.artifacts/pytest-cloud-stop-20261031-04
```

**94 passed in 35.84s**, no warnings reported: 90 existing cases and 4 added cases.
After adding the explicit successful-save-stage assertion, the affected file was
rerun without broadening/repeating the existing suite:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_cloud_stop_acceptance.py -q -p no:cacheprovider --basetemp=.artifacts/pytest-cloud-stop-20261031-05
.\.venv\Scripts\python.exe --version
```

**4 passed in 2.88s**; Python 3.13.5. Each pytest invocation used a fresh repository
`.artifacts` basetemp and disabled pytest's cache provider. Initial attempts `-01`
and `-02` exposed test-setup assumptions (single-account capacity, public grant
funding, transient telemetry equality) and the separate session-error issue below;
the fixture/assertions were corrected. `-03` passed all four cases before the
combined `-04` run. During that initial test-only pass, the newly added file was
inspected in full; no existing tests or runtime code were edited. Parent-owned
browser/workflow files, lockfiles and unrelated dirty documents/webtools remain
outside this task's writes, including the follow-up below.

## Session-conflict mapping

The initial audit found that a mismatched `session_id` raised
`python.storage.generations.Conflict` without a Cloud exception mapping. Default
ASGITransport re-raised it; with `raise_app_exceptions=False`, the generic handler
returned **503** with `{"error":"cloud_unavailable"}`. This was a separate
error-contract issue, not an observed credit loss or terminal-state overwrite.

A standalone local diagnostic reproduced the pre-fix behavior using existing config/enroll
helpers, blocked native HTTPX transports and ASGI only. Its isolated database is
under `.artifacts/cloud-stop-session-diagnostic-20261031-01`. Sequence:

```text
POST /api/chat/generations/session-diagnostic/cancel?session_id=original -> 200
POST /api/chat/generations/session-diagnostic/cancel?session_id=different -> 503
GET  /api/chat/generations/session-diagnostic?session_id=original -> cancelled
```

`create_app` now has a shared exception handler for
`generations.Conflict` returning `JSONResponse({"error": str(exc)}, status_code=409)`.
This matches local chat API semantics and covers both generation status and cancel
without duplicating catches or changing storage, task cancellation or accounting.
Other uncaught instances of this same domain exception in the Cloud app naturally
receive the same mapping; unrelated exception handlers retain their behavior.

`test_cloud_generation_session_conflict_preserves_both_tenants` adds four cases:
GET status / POST cancel, each against pending / cancelled original generations.
Two isolated, authenticated tenants deliberately use the same generation ID but
different sessions. After initializing each tenant through ASGI, the test seeds
real generation rows through existing storage functions (no running provider or
background job is needed). Each wrong-session request must return 409 with the
exact existing Conflict message. Correct-session status remains pending/cancelled
for the original owner and pending for the other owner. Full generation-row
snapshots in both SQLite databases remain identical, including the cancelled
terminal result; both wallets retain 500 Credits, with no ledger operations,
provider requests or jobs. The previous real-job Stop/late-success case remains
part of the affected suite.

Before adding the handler, all four new cases failed with the expected unhandled
Conflict (**4 failed, 4 deselected in 3.85s**):

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_cloud_stop_acceptance.py -k session_conflict -q --tb=short -p no:cacheprovider --basetemp=.artifacts/pytest-cloud-conflict-20261031-01
```

After adding the handler, the full 94-case pytest command in "Commands and results"
(all listed files and node IDs, without the `-k` filter) was rerun with
`--basetemp=.artifacts/pytest-cloud-conflict-20261031-02`: **98 passed in 37.32s**,
no warnings reported (90 existing cases, 8 acceptance cases). This includes the
original Stop/late-success/zero-charge test and all four new conflict cases.
The runtime diff adds only the four-line exception handler; storage, task and
wallet mutation semantics are unchanged. Final parent verification reran all
eight acceptance cases successfully, with its raw log at
`.artifacts/cloud-stop-parent-final.log`. The shared error presenter now explains
the existing conflict in JA/EN and directs the user to the original chat, without
assuming the generation was cancelled or free. Its two language cases and
existing error/Cloud-request regressions pass **161 tests / 2 files** in
`.artifacts/cloud-switch-web-errors.log`.

## Limits

This accepts the named local ASGI/SQLite/MockTransport contract only. It does not
claim browser/actual-App target-switch acceptance (parent-owned), a full Python
suite or CI pass, production readiness, real provider billing/cancellation, real
accounts, or process-kill/network fault testing. The reopened-store check is a
fresh store instance, not a restarted operating-system process. No installs,
deployments, production access, real provider requests or Git commands were used.
The separate [actual-App/owned-HTTP browser result](2026-10-31-unified-cloud-target-switch.md)
covers the final stop, saved-result gate, destination return and explicit resumed
send in JA/EN. It does not turn these local fixtures into hosted acceptance.
