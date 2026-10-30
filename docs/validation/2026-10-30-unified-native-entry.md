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
new browser acceptance until the fixture actually passes.

The manual npm artifact workflow now builds pinned WASM on Linux, hashes exact
binary/license/patch inputs, passes them to Windows/macOS jobs, verifies hashes
and compiled patch/source agreement, builds Native UI and runs both packed-CLI
and browser checks. This workflow change has not been executed yet. It does not
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
the new matching artifact still needs its separate packaging/browser acceptance.
