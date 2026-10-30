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

Artifact CI 41008143261 accepted macOS Native, Cloud and WASM; Windows completed
packed CLI acceptance but its browser preflight failed before launch because the
fixture read UTF-8 HTML with the runner's cp1252 default. Explicit UTF-8 is now
used for all fixture text I/O (including paths in JSON), rather than changing the
runner's locale or hiding decode errors. Fresh Windows/browser execution remains
required; the old failed run is not accepted.

The exact old browser preflight now reproduces UnicodeDecodeError under a forced
cp1252 Path-read default; the corrected preflight passes against the new packed
HTML. This probe does not start Runtime. The updated packed browser subsequently
passed on local Windows with the corrected actual label `Language`, including
JA/EN settings/diagnostics, visual-novel scene navigation, 393px no-overflow,
unknown-route recovery, Mock send, draft/history restart and actual PID exit.
External/API requests and page errors were zero; two Mock generations, no real
inference. The initial expanded fixture failed only its incorrect `Display
language` selector, then cleanup completed; retain that failed run separately.

Workflow review also found that upload-artifact excludes `.artifacts` by default,
so the successful macOS run's acceptance JSON was present in logs but not retained
as a separate artifact. Enable hidden files only for the explicit three-path
fictional acceptance allowlist. All eleven workflow/sandbox checks passed. The
new workflow still needs a fresh actual run before Windows CI is accepted or
macOS's retained artifact evidence is claimed.

## Compiled-runtime license delivery

The independent static audit of fixed 376d0fc confirmed four missing upstream
license texts (llama.cpp, jsonhpp and WebGPU C/C++). Its source/218 copied files,
8,740 safe members, 33 locked Python packages and four WASM hashes passed, but
the candidate is not distributable. A cryptography SSH-header literal matched the
locked installed dependency exactly; it is not a discovered private key.

Reuse the existing eight-text Mobile license list through one shared copier.
Native and unified Cloud now include the same texts under `web/licenses/`;
legacy Cloud packaging stays unchanged. Validate all origins/targets before
writing any text; missing, blank and symlinked inputs fail, with no partial text
output in these failure cases. The Cloud manifest covers the delivered license
bytes. This does not declare a legal/license-review gate complete.

Source/bundle/readiness/workflow tests passed 35 cases. A fixed revised Native
archive, its CLI/browser acceptance and exact text hashes remain required before
selecting a candidate. Retain the old 376 audit as a failed candidate record.
