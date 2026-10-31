# Research browser startup: unresolved Windows CI failure

Actor source `1ab8f93` PR run `41224581983`, Windows job `124605965681`,
failed in `tests/e2e_research_language.py` while waiting 30 seconds for
`window.__RESEARCH_LANGUAGE__` to exist. The exception occurred before mounting
Research or executing its UI assertions. That job's Ubuntu result succeeded.
The log contains no page/module error identifying the underlying cause.

The driver now retains and prints the failing language/width/theme, phase,
exception, page URL, page errors, console errors, failed requests and blocked
fixture requests before rethrowing. The existing context/browser/Vite cleanup
remains active. This adds no retry, timeout increase, product change or relaxed
assertion, and does not claim to fix the unknown initialization failure.

On current source based on `d4e5192`, the unchanged driver first passed all three
JA/EN, 393/1280px, light/dark cases. With diagnostics added it again passed all
three, preserving rating drafts, explicit writes, experiment-change reset,
benchmark conditions and no horizontal overflow; no blocked requests or page
errors occurred during those normal runs.

A separate private probe injects a real browser page exception, console error and
aborted fictional HTTP request at that same import-wait boundary. It confirms all
three are retained in the failure JSON, the failure is rethrown, only one import
attempt occurs and no successful results file is created. This verifies diagnostic
behavior, not reproduction of the original CI cause. Its adapter and evidence are
`.artifacts/verify_research_language_diagnostics_20261101.py`,
`.artifacts/research-diagnostics-negative-20261101/` and
`.artifacts/research-language-diagnostics-20261101/`.

The Research driver/HTML were also absent from the corresponding-source
allowlist. Two source-closure regressions fail before adding those entries and
pass afterward; the collector additionally retains this report and the new
two-principal Remote report. All **45** affected source collection, unified/legacy
bundle and source-fingerprint tests pass. This is source coverage verification,
not a newly built complete delivery candidate.

The original Windows failure remains unresolved pending evidence from a repeated
failure or a proven cause. Later passes do not establish its root cause.
