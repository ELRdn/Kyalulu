# Auxiliary UI language completion (2026-10-30)

Diagnostics, provider status, PC hosting settings, visual-novel navigation,
Studio, Status, NotFound and legacy public work/author views now follow the
selected Japanese/English display language. Authored messages, names, model IDs,
URLs, QR data, drafts and request IDs remain original. Language switching does
not refetch catalogs, send comments, grant permissions or restart generation.

Diagnostics translate complete first-party templates scoped to each check ID;
unknown diagnostic evidence stays verbatim. Desktop supervision lookup failures
are displayed instead of silently discarded. Capabilities HTTP failures are
localized in the existing shared error renderer using an anchored template,
retaining the status and preserving custom surrounding evidence.

Verification: the initial integrated Web suite passed 986 tests in 75 files;
subsequent shared-error and legacy-community suites passed 91 tests (including
four added exact-template/status/custom-evidence cases). Typecheck passed after
that correction. Component tests cover drafts, idempotent request IDs, owner
changes during pending operations, original content and explicit confirmations.
The first targeted rerun failed on a sandbox temporary-file ENOENT; rerunning
with a dedicated workspace temporary directory passed.

The packed Native browser fixture is extended to cover visual-novel previous/
next scenes, Japanese/English settings and diagnostics, a 393px viewport, missing
route recovery and draft retention. Execution against a newly committed matching
bundle remains pending at this record's initial revision. Unit/markup tests are
not claimed as retained actual-browser or physical-device acceptance.

No production/provider settings, data, or contracts changed. Android/iPhone
acceptance remains explicitly deferred, and canonical production rollout still
requires the separately scoped backup/recovery operation.

Review follow-up: preserve distinct timeout and connection-failure categories in
Remote Host actions, with explicit unverified-result guidance before retrying.
Do not display raw transport error text, which may contain connection material.
Twelve Remote Host tests passed, including timeout/network/unknown failures and
language switches without automatic requests; typecheck passed again.
