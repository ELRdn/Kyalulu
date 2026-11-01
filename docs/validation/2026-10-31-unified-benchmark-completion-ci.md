# Benchmark browser completion boundary — 2026-10-31

The Windows job in [PR run41194220598](https://github.com/ELRdn/Kyalulu/actions/runs/41194220598)
failed while expecting four result rows within Playwright's default5s assertion.
Its trace shows0,1, then3 rows. The driver checked the table before waiting for
the existing asynchronous benchmark job to complete.

The driver now waits for the returned job card before reading its ID, waits for
that job's completed status using the existing poll, and then applies the same
four-row assertion. Product execution, UI polling, inference limits, assertions
and timeouts are unchanged.

The shared synthetic Worker fixture can hold and release one specified generation
call. In both language/viewport cases, call25 holds the fourth experiment after
three completed experiments. The driver checks running status, three saved results
and three visible rows, releases the reply, then requires completion and four rows.
This gate defaults off for other fixture callers.

## Evidence

- The published57c3537 driver, with only the call25 hold injected, reproduces the
  original four-row assertion failure with three visible rows at the unchanged5s
  deadline. `.artifacts/benchmark-completion-red.py` and its log retain this probe.
- TypeScript passes. The shared Research browser regression passes JA/393/light
  and EN/1280/dark, including ratings/reload, account separation, stop/navigation
  persistence and no synced private experiments.
- The complete Benchmark browser driver passes **2/2**: JA/393/light and
  EN/1280/dark. Both require the held three-row state and completed four-row state;
  paired32turns, exported Python schema validation, navigation continuity,
  cross-tab cancellation, reload interruption and owner separation remain checked.
  English additionally checks load timeout/recovery and100 synthetic turns.
  External requests and page errors are zero.
- Combined local Web checks: **1,469 passed /93 files**,15.05s. Corresponding-source
  closure **3 passed /10 deselected**,16.37s with an explicit writable temporary
  directory. An earlier sandbox default-temp setup error is retained separately.
- Unified application build passes in9.84s using the documented
  `VITE_RELAY_ORIGIN=https://relay.kyalulu.com`. An initial invocation without this
  required variable correctly refused to build; no build guard was changed.

Logs: `.artifacts/benchmark-completion-browser.log`,
`benchmark-completion-research-regression.log`, `benchmark-completion-typecheck.log`,
`unified-ci-followup-web-all.log`, `benchmark-completion-source-closure-final.log`.
Structured results/screenshots: `.artifacts/device-benchmarks-browser/` and
`.artifacts/device-research-browser/` (fictional local records, excluded from Git).

## Limits

This controlled partial-progress reproduction establishes the missing completion
boundary. It does not reconstruct the hosted runner's exact processing speed.
Inference and model availability remain synthetic; no weights, external provider,
physical Android/iPhone, RSS/performance target or production acceptance is claimed.
