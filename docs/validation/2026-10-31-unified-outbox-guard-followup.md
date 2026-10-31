# Outbox guard CI follow-up (2026-10-31)

The Ubuntu failure in PR run `41199510375`, starting HEAD `57c3537`, was an
obsolete fixture oracle, not evidence of an outbox reload regression. The unchanged
guard also failed at `fresh` on installed Windows Chromium before this fix.

`outboxSyncSource` reads each immutable saved part once for hashing and once for
upload, checking the compact header at each read. The old guard required both
header and part read counts to remain constant during upload. It also classified
compact-header JSON serialization as whole-body serialization, and its hashing
owner-change hook depended on encoding payload text, which streaming no longer does.

Only `tests/fixtures/outbox-guard.html`, `tests/e2e_outbox_guard.py` and this report
were changed for this follow-up. No product code, dependencies, timeout, Git state,
provider or production service was changed.

## Replacement checks and evidence

Migration restoration and the independent original-seed wire oracle are constructed
before measurement; the mock transfer-open callback now reads only the compact header.
The fixture checks exact manifest size/SHA, wire bytes/SHA, ordered 1 MiB output,
two sequential readonly saved-part passes, zero restored outbox payloads, and zero
payload-bearing whole-batch JSON serialization. Compact header serialization is
counted separately. Hash-time owner mutation now fires on a real saved-part read.
Failed uploads must preserve the complete local unsent entity. Existing receipt,
withdrawal/replacement/owner, foreign-account, storage and receive rollback checks
remain. The runner records all scenario failures and page errors, and blocks
service workers as well as real API/external requests.

Run with existing dependencies and disposable loopback Chromium only:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
.venv/Scripts/python.exe tests/e2e_outbox_guard.py
```

- **11/11 browser scenarios passed**, with zero blocked network attempts/page errors.
  Fresh segmented upload: three saved parts, reads `[0,1,2,0,1,2]`, all readonly;
  cumulative reads at parts/commit `[4,5,6,6]`; two payload-free parser completions;
  zero restored payloads, whole-body serializations or foreign-account reads.
- Hash-time owner change: one saved-part read, zero transfer requests/parts/commit,
  complete local unsent entity retained. Withdrawal/replacement/owner changes stop
  after one sent part without commit. All four invalid/withdrawn receives preserve
  the original entity and cursor `11`; valid receive advances to `12`.
- **Two negative browser probes were rejected**: response-only fixture injection
  of `fixedOutbox(owner)` per sent part fails the sequential-read check; injection
  of `JSON.stringify(pending)` fails the whole-body check. Product files were untouched.

Evidence under `.artifacts/`: `outbox-guard-followup-before.log` and `-before.json`
retain the original failure; `outbox-guard-followup-compact-oracle-failed.*` retains
the intermediate compact-header oracle failure; `outbox-guard-followup-after.log`
and `-after.json` contain the passing matrix; `outbox-guard-followup-negative.log`
and `outbox-guard-followup-negative/results.json` contain both rejecting probes.
Python syntax and scoped `git diff --check` pass.

This is synthetic Windows Chromium evidence. Ubuntu CI has not been rerun by this
worker; full-capacity/RSS, physical devices, real servers/providers and production
acceptance remain outside this follow-up.
