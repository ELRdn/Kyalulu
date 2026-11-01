# Auxiliary UI language completion (2026-10-30)

## Current fixed candidate: 4bca277

Windows Native tar: 140,406,437 bytes, SHA-256
`d3591bac81ff66d17c7fb24205cdef2b9dd4cba3d765bffd186e6bd4a7e88a61`.
Actual packed CLI and the matching committed browser fixture passed. The browser
covered both languages in settings/diagnostics, visual-novel previous/next,
393px no overflow, missing-route recovery, Mock sends, four retained history rows,
unsent draft across restart, and isolated Cloud popup handoff. Both CLI/browser
verified actual runtime PID exit; zero candidate-owned processes remained.
External requests/page errors were zero; no real inference or production data.

Static audit passed with existing warnings: 8,748 safe members, 226 product files,
818 offered-source members, 33 locked Python packages, all four WASM hashes and
all eight delivered license texts. Source copies match the Git export; raw Git
comparison separately records CRLF-only differences. The 11 renderer inventory
entries lacking root license texts remain part of the pending license review;
this does not claim legal clearance or signed/clean-OS distribution acceptance.

Matching local Cloud tar: 66,115,362 bytes, SHA-256
`8b0b3202d4cfb75da8dd8a1946f1864676ac17cde1fa5416460789e566419fad`.
All 233 manifest entries and 61 precache hashes (including gzip members), four
WASM outputs, eight license texts and all 818 source-offer members matched Native.
Workflow 41010931510 on this same fixed revision passed all four jobs: WASM,
Cloud image, Windows Native and macOS Native. The CI Cloud code tar is separately
fixed at 66,163,069 bytes, SHA-256
`b2aae859399a9ad6b5c7faf395e6a8679e5d7f312c4a93fc4ceb147b50ae1e5b`,
image `sha256:49e18e115d04c0118c4be1f138188d61a018b757afd4643ce3b0066d2dbbc5ed`.
219 copied-image files, twelve network-none/read-only fictional checks and the
unmodified default Uvicorn command passed. Local audit of the retained CI tar
checked all 233 manifest/61 precache hashes, eight license originals and 593
committed offered files against raw Git blobs. Its source offer has 1,122 members;
platform-specific dependency-license inventory is distinct from the local
Windows offer's 818 members.

Private evidence is under `.artifacts/unified-canonical-4bca277/` and
`.artifacts/unified-native-4bca277-static-audit.json`; it is excluded from Git.
The source-preserving backup/cutover operation remains awaiting its separately
scoped authorization. Android/iPhone are deferred by the owner; provider gates
and the Draft/no-merge instruction remain unchanged.

## Scope and earlier checks

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
new workflow needed a fresh actual run at this stage; its later terminal results
and downloaded evidence are recorded above/below.

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
archive, its CLI/browser acceptance and exact text hashes were required before
selecting a candidate; their later successful evidence is recorded above/below. Retain the old 376 audit as a failed candidate record.

The fixture/tooling workflow 41010305199 (79ff007) subsequently passed all four
jobs: WASM, Cloud, Windows Native and macOS Native. Both OS acceptance JSONs and
screenshots were actually downloaded and checked, including identical per-OS
CLI/browser archive hash, JA/EN/visual-novel flags, actual PID exit and zero
external/page errors. This closes the UTF-8/selector/retained-evidence fixture
regressions. It does not select the pre-license-fix archives as release candidates.
The fixed license delivery remains workflow 41010931510 (4bca277).

The exact new CI standard WASM changed to `37abbdc2...206dbe27`; the other three
runtime files matched the preceding verified CI. Revalidated all ten artifact
inputs and all five existing cached model files (3,125,578,496 bytes), then
actually ran these CI binaries in local Chrome: standard/compat GPU offloaded
36/36 layers and returned `こんにちは。`; requested-zero-GPU CPU returned
`お元気ですか？`. Context 512, maximum eight tokens, seed 12345/temperature 0.
Every path reported lazy PLE and bounded nonzero reads. External/API requests and
page errors were zero. Verifier and owned Vite exited normally; the dedicated
profile/model cache was preserved, no profile process remained and IPv4/IPv6 port
5187 could be rebound. This is short functionality, not performance/quality,
old-build bit parity, a memory ceiling or physical-phone acceptance.

The same-run Windows/macOS artifact bytes were downloaded and checked against
both the platform manifest and retained CLI/browser reports. Windows:
119,097,294 bytes, SHA-256
`8625b48886f1c1de192deeca0d0f2f5a034c58f7aef60b80913bf120b4cd8e06`;
macOS arm64: 113,148,819 bytes, SHA-256
`c72c0e4869ce054b505b8136a2c1a70facaad61f6ad2f4053be0b7546dbeabf7`.
Both archives had safe unique regular paths, all eight notice originals and four
same-run WASM hashes. All 61 precache hashes passed. Packaged Runtime/catalog
files equal their offered originals. Of 593 committed offered files, Windows
has 31 raw-byte matches and 562 CRLF-only matches; macOS has 593 raw-byte matches.
Both actual browser reports confirm the same per-OS archive hash, JA/EN settings/
diagnostics, visual-novel navigation, 393px width, draft/history restart, zero
external/page errors and actual PID exit. Signing/license/device gates remain
false. This is runner/development-host acceptance, not a clean-OS public install.

Ordinary Runtime/Web push CI 41010880414 on the same 4bca277 also passed both OS:
Web 992 tests/75 files and typecheck; Windows Python 1,244 passed plus seven
subtests, Ubuntu 1,241 passed/three skipped plus seven subtests. The PR-context
duplicate 41010884409 was still running at this observation; no live job was
cancelled or restarted based on waiting time. The Draft remains unmerged.
