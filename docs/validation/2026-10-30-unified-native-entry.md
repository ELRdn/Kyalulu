# Native first-use entry and local general eligibility

This is implementation/fixture work, not a release or production change.

## Reproduced defect

A fresh Chromium profile opened the actual packed a22984a Native CLI with a new
isolated data/home root and empty PATH. The UI showed Cloud onboarding, the
local server returned 404 to `/api/cloud/app/eligibility`, and even seeded fake
preferences left the target at Cloud with choices Cloud/Device/PC but no Local.
No external request or real inference occurred; the owned Runtime was stopped.
The earlier packed-CLI recovery check bypassed this browser flow. Its successful
result remains valid for that narrower scope and does not accept the Native UI.

## Correction

- `build:native` uses the same renderer and isolated Device/neutral migration
  pipeline, with a distinct Native build context and HTML marker. Native defaults
  to Local and exposes This PC; hosted App still defaults to Cloud. Existing saved
  target choices remain intact. Device transitions still use `/device/`.
- The Native packager requires that marker before downloads/output creation and
  defaults to `.artifacts/native-app`. It refuses a hosted-only UI. Already-built
  legacy archives remain readable; the launcher format has not changed.
- General first-use confirmation posts to `/api/local/eligibility` in Native.
  The local Runtime reuses Cloud's exact region/age/guardian policy logic and
  policy schema checks. `KYALULU_REGION_POLICIES` is explicit operator input;
  unconfigured/unaccepted countries and missing guardian proof remain closed.
  No real policy approval is supplied by this change or its fake JP tests.
- The endpoint requires local administration and an exact same-origin request;
  proxies/forwarded headers and remote clients cannot borrow it. It creates no
  Cloud store/account or network request. The `native:` receipt only completes
  local onboarding; it is neither Cloud authentication nor verified adult status.
- A confirmed Cloud choice opens exactly `https://app.kyalulu.com/` separately,
  using `noopener,noreferrer`, keeping local target, drafts and receipt. A saved
  Cloud target on Native shows an explicit handoff instead of calling local APIs
  as Cloud. The existing Electron external-window handler is reused; legacy
  file/app entry assumptions are retained. Actual Electron runtime is untested.

## Checks and distribution

The new backend with Mobile/unified policy and build-boundary suites passed
88 tests; the broader Cloud/auth/source-boundary selection passed 99. Typecheck and all 910 Web tests / 69 files passed. The first-use
browser fixture must additionally exercise the **packed Native interpreter/UI**:
`tests/e2e_native_entry.py --acceptance <owned packed-CLI acceptance.json> --output <new owned directory>`.
It uses a new fake home, an explicitly fictional policy, blocked external traffic,
mock generation and a fulfilled fake Cloud destination. It must prove local
first-use/guardian denials, canonical popup without credentials/referrer/opener,
draft/target preservation and local history across restart. Do not claim that
new browser acceptance until the fixture actually passes; results are below.

The manual npm artifact workflow builds pinned WASM on Linux, hashes exact
binary/license/patch inputs, passes them to Windows/macOS jobs, verifies hashes
and compiled patch/source agreement, builds Native UI and runs both packed-CLI
and browser checks. Its first actual dispatch is recorded below. It does not
publish npm/releases or satisfy signing, clean-OS, real-model or physical-device
gates. The historical ordinary Web build was insufficient for Native packaging.

## Local Linux attempt

Docker Desktop client 29.6.2 pointed to this PC's named pipe, initially unavailable.
A startup attempt ended in an Inference-manager socket initialization error; no
Linux image/container was built. The UI's coordinate Quit action was rejected by
automatic approval review because its target could be confused with factory
reset. Accessibility targeting had mismatched window geometry; normal vendor
CLI stop also failed. Only the owned hanging CLI observers were terminated.
Docker's error UI exit is unverified and a human Quit action was requested.
No factory reset, diagnostics upload, settings/volume change or engine repair was
performed. The separately requested production-backup authorization is still
pending. Private record: `.artifacts/unified-linux-a22984a/local-engine-check.json`.

## Packed browser result and shutdown correction

The committed ac2ffc2 Native archive (`1bde27fb4505f6f0e7fc3ab0e7156a5802af725e1326e8bffbc544fa68f25fb9`)
passed the actual browser first-use, guardian denial, Mock browser Send, canonical
Cloud handoff and restart checks with four persisted history rows, no external
requests and no page errors. This is fictional-policy/Mock evidence only.

An earlier failed browser run exposed a second defect: the launcher reported
stopped as soon as HTTP ownership disappeared while its Python PID remained.
The failed fixture log contained Windows error 10054 from Python 3.13.7's
Proactor transport `socket.shutdown()`. Its exception skips socket close/server
detach and can leave `Server.wait_closed()` waiting indefinitely. A read-only
stack probe confirmed the old fixture still waited in its event loop. That exact
failed fixture process was identity-checked and forcibly cleaned up; this is
recorded separately and is **not** normal-shutdown acceptance.

Native now uses the standard Selector event loop on Windows; macOS/Linux retain
the existing automatic choice. It supports at most 512 sockets and no asyncio
subprocesses on Windows. The current Python runtime has no async subprocess
callers; revisit the loop if Native needs either capability. No dependency or
bundled interpreter version was changed.

The lifecycle regression exercises real loopback TCP resets and fault-injects
the observed shutdown syscall error. On the actual bundled Python 3.13.7, the
original Proactor configuration reproduced the hang (owned fixture cleanup was
required), while the corrected loop exited normally. The lifecycle and local
onboarding suites passed 23 checks. Real-reset-only checks passed too; ordinary
TCP resets do not reproduce the timing fault on every run.

The combined lifecycle/onboarding/package/source-boundary selection passed 62
tests, and launcher tests passed 50, including live-unverifiable/corrupt state,
shutdown rejection, deferred PID exit and pointer-commit failure boundaries.

The launcher keeps `process.json` until its PID is confirmed absent, checks
shutdown responses, preserves unverified/live ownership records and refuses to
overwrite them on start. PID probes send only signal 0; saved PIDs are never
terminated. Restore cannot proceed while shutdown is incomplete. Update/rollback
retain the existing pointer-commit-before-stop ordering, so a stop failure can
leave the new selection committed while preserving the old process record.
Packed CLI/browser acceptance now checks actual process exit and emits success
only after final cleanup. The ac2ffc2 artifact predates these lifecycle fixes;
its narrower historical browser success does not accept the lifecycle behavior.

## Fixed 87f560d Native artifact

The exact committed source `87f560d138f125e121b326fc3646d7ef7378b67a` was exported
to a new private directory. Catalog generation uses the actual managed Python
3.13.7; the workstation's default Python 3.14 generated a different Unicode
casefold map and that first artifact failed the source audit. It is excluded.
The corrected candidate passed its entire source/export/lock/license/WASM audit.

| Candidate | Bytes | SHA-256 |
| --- | ---: | --- |
| Windows Native tar | 140,340,692 | `885c8314869db97bc7df6c33da860e36a267f9c1864fdfb94da52c3dca906fad` |
| Unpublished packed CLI | 18,794 | `3fa9cd62ffbec9cdfea55cfb6e82c2a1c5694cc4a0bae683b09b21981e5b48b4` |

All 8,734 archive members were safe; 218 product files, 33 locked Python
packages, 223 renderer license files and four WASM outputs were checked. The
812-member corresponding-source offer includes 587 committed files equal to the
Git export: 31 also match raw Git bytes, while 556 differ only by strictly checked
UTF-8 CRLF-to-LF conversion. Raw-byte and exported-source equality remain distinct.

The actual packed CLI passed empty-PATH start/restart, fictional memory/history
backup/restore/rollback, seven pointer faults and unrelated-process protection.
The browser passed Local entry/guardian denial, actual Mock Send, four persisted
history rows and unsent draft after restart, canonical Cloud popup isolation,
zero external requests and zero page errors. Both suites verify actual process
exit and emit success only after cleanup; candidate-owned Python processes were
independently confirmed absent, without forced cleanup of this candidate.
Private evidence: `.artifacts/unified-native-87f560d-audit.json` and the fixed
source's `.artifacts/native-entry-acceptance-py313/result.json`.

## First manual workflow failure

Run 40993302006 on 87f560d failed before compilation: bootstrap's ZIP extraction
discarded the executable mode on `emsdk/emsdk`, so `emsdk_env.sh` reported
permission denied and could not expose `emcmake`. No Windows/macOS bundle job
ran. Preserve only the ZIP execute bit as mode 0755 (never special permissions),
with an offline ZIP regression. All nine source-collection tests passed, and a
separate Linux/WSL fixture confirmed actual POSIX mode/content. This build-helper
correction is later than the fixed Native artifact above; it does not retroactively
accept that failed workflow. Its fresh dispatch remains a separate gate.

## 82099da local candidates and CI lifecycle corrections

Both candidates below use the exact committed source
`82099da158d88a571d7798fcf51bcc529ee6587a`, pinned Python 3.13.7 catalog generation,
explicit Relay origin and the previously verified four WASM inputs. Native again
passed packed CLI/browser/actual-exit checks and the complete archive/source audit.
Cloud and Native have identical 812-member corresponding-source offers. All 225
Cloud manifest entries, 214 product files, 61 precache hashes (including inflated
gzip members), four WASM outputs and the compiled Relay origin were verified.

| Candidate | Bytes | SHA-256 |
| --- | ---: | --- |
| Windows Native tar | 140,338,874 | `4c910aab65e5076f3242fddb9f241f72ed392353375cea767977d61ea9ef8a3b` |
| Cloud tar | 66,072,505 | `fd04ac0f0170e6562538c414647fbe0ff30e7690240fcdf5dde790dbab4693ad` |

The unpublished packed CLI remains the same 18,794-byte `3fa9cd62...5b48b4`
candidate. No updated Linux image or production selection is claimed by this
local packaging audit. Evidence is `.artifacts/unified-native-82099da-audit.json`
and `.artifacts/unified-canonical-82099da/cloud-verification.json`.

Manual run 40994190016 actually completed both WASM builds, exact hash/license
checks and artifact upload, but failed in setup-uv's post-job cache save because
this WASM-only job creates no uv dependency cache. Its platform jobs were skipped.
Disable that unused cache for the WASM job only. Downloaded artifact checks passed
all ten hashes and matched the repository patch text; source archive hashes also
match the earlier wllama/llama.cpp inputs. No bit-for-bit equality of binaries
against the earlier local build or real-model acceptance of these CI binaries is
claimed.

The same workflow now includes an isolated Ubuntu Cloud image job using that
run's verified WASM. It checks extracted code hashes and copied image files,
then runs the existing fictional fixture with network disabled, read-only rootfs,
UID 10002, no capabilities/privilege escalation and resource limits. A separate
owned container exercises the image's unmodified default Uvicorn command with
only fictional env, no mapped port and loopback health. Evidence is emitted only
after owned-container cleanup. Ten offline workflow/verifier checks passed;
actual image execution remains pending its fresh dispatch.

Windows PR run 40993200551 passed Python tests but failed publications E2E while
waiting for text also present in an uncommitted hide confirmation. A 300 ms fake
API delay reproduces that old assertion failure; waiting for the returned Hidden
queue status passes the full browser fixture, including block/adult/recommendation
boundaries. The backend behavior was not changed.

Separately, a Windows Remote fixture reproduced the Proactor reset/transport
detach failure in `Server.wait_closed()` with no Uvicorn connections/tasks left.
Run only its Relay in an owned Selector-loop thread, retain Playwright's Proactor
loop, bound shutdown and always clean Vite. Emit acceptance after cleanup. The
actual Windows 3.13.7 browser passed all 12 checks and normal shutdown in 28.16 s,
with zero remaining fixture children and no forced Job cleanup. Offline failure
cases also rejected false success. Linux and CI acceptance of that fixture change
remain separate. All changes here are validation infrastructure, not new product
features or production mutations.

## First successful updated Cloud image, and macOS discovery fix

Run 41001764535 on 8e0aff4 completed WASM and the new Cloud job. Image
`sha256:e487b6858f69be520668281952442ecc11df18dc5d06b1cc307d611ae7d31d60`
matched 211 copied-file hashes, passed all twelve isolated fixture checks and
started its unmodified default Uvicorn command under the sandbox. Its exact code
tar SHA-256 is `50a896c0d1335d75774fbe97534825c540c7ab00cadc1af5f9d8b41db080a9e2`.
This was a fresh GitHub runner, not the production VPS. The next workflow retains
the code tar with its hashes/report, so the exact checked candidate can be used
for a separately approved operation; it still does not publish a Release/image.

The run's four WASM files are byte-identical to run 40994190016. Those exact
binaries passed local Chrome standard/compat GPU and CPU generation using all
five verified cached model files (3,125,578,496 bytes), context 512 and at most
eight tokens. Each GPU path offloaded 36/36 layers and returned `こんにちは。`;
CPU, explicitly requested with zero GPU layers, returned `お元気ですか？`.
All paths reported lazy PLE and bounded nonzero reads. External/API requests and
page errors were zero. Owned Vite exited normally with no remaining owned child
or listener; the existing profile/model files were preserved. This is short
functionality evidence, not CPU/GPU quality equivalence or physical-device proof.

The overall workflow still failed: macOS installed staged 3.13.7 correctly, but
`uv python find` selected its surrounding CI venv. The staging boundary guard
correctly rejected that external interpreter. An actual offline Windows CLI probe
reproduced the same lookup choice; `--system --no-project` selects the staged
interpreter instead. Keep the resolved-path guard unchanged and cover both valid
staged selection and escaped returned paths. Readiness/workflow suites passed 18
tests. Disable bundle matrix fail-fast so an OS failure cannot cancel the other
independent OS validation; Windows in this failed run was cancelled, not accepted.
macOS and the new workflow still require their fresh actual run.
