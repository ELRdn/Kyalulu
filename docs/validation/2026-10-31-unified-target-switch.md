# Explicit Remote stop and target switching — 2026-10-31

`tests/e2e_remote.py` extends the existing real Chromium → Noise-encrypted
loopback Relay → Host → isolated Python Runtime test. Generation, storage and
status contracts remain unchanged. The existing Runtime/Web workflow already runs
this driver after the wrapper build.

A separate Mock generation is held by an event, so the check does not race the
completion of a short reply. While pending, the actual execution picker is
disabled and direct calls to `switchTarget` reject Cloud, Device and PC without
changing the URL or localStorage. Explicit Stop cancels the real Runtime job.
The real cancelled-status response is then held at the Runtime read boundary:
the picker remains disabled, the recovery control stays visible, and Device
switching still rejects until saved-result verification completes.

The added Profile navigation check reproduced a product bypass: unmounting
ActiveChat removed its in-memory busy count although the durable recovery record
was still pending. `generationBusy` now also checks existing ChatRecovery records
for the current connection/owner. It does not decode conversation bodies or
rewrite records. Unreadable current recovery data refuses switching. The picker
offers a JA/EN link back to the unresolved chat; recovery updates and Remote
identity restoration notify it. The final browser check navigates to Profile,
reloads the entire document while the real result is held, verifies switching
remains disabled, and returns through that link before releasing the result.
Other account/destination records do not block the current scope. A confirmation
opened before another pending send is rechecked before dispatch. The review's
Cancel label now follows JA/EN too.

After release, the terminal result has matching session/generation IDs,
`status=cancelled`, and no committed user/assistant IDs. The cancelled turn is
absent from authoritative history and its input is restored to the composer.
This follows the existing atomic-turn contract; the first added test incorrectly
expected an uncommitted user row and was corrected, without changing storage.

Canceling the destination review preserves the PC selection and draft. Accepting
the Device destination navigates to `/device/` without copying the PC
conversation into IndexedDB. Returning to the registered PC retains the unsent
draft and identical authoritative history, with no automatic resend. Existing
pairing, private media, disconnect/reconnect, key-retention and revocation checks
continue to pass. The driver also asserts no plaintext `/api/` browser requests
and no page errors, and waits for owned Relay/Vite shutdown in cleanup.

## Evidence

The final local run passed all **14 recorded checks**:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
.venv/Scripts/python.exe -B tests/e2e_remote.py
```

Private final browser evidence: `.artifacts/remote-target-route-after.log` and
`.artifacts/remote-v1/e2e-811fd3bf/acceptance.json`. The pre-fix Profile failure is
retained in `.artifacts/remote-target-route-before.log`. The initial launch could not
find Chromium under the sandbox's default path; the final run explicitly uses
the already installed browser. No browser installation was required.

## Limits

The originating generation is PC Remote, with a Mock provider, fictional data,
Japanese switch controls and a 393px emulated mobile viewport.
Cloud-origin generation/stop/switch flows, English Remote switch controls, real models,
physical phones and production TLS/CSP/origin migration still require separate
evidence. Trying all three destinations from a pending PC job is not acceptance
of all three originating execution modes. No production service, account,
conversation, key or configuration was accessed or changed.

The separate [Device-origin check](2026-10-31-unified-device-target-switch.md)
uses real Device storage/recovery with synthetic inference. It is separate from
the encrypted PC result, rather than proof of a real Device model.

Full Web unit verification passes **1,365 tests / 85 files**; the final focused
entry/context/Remote-store run passes **40 tests**. TypeScript, the Web production
build and the separate unified build pass. Logs are
`.artifacts/target-route-guards-{web-final,final,typecheck,build,unified-build}.log`.
The default-process Vitest attempt failed before affected-suite collection due
to a sandbox temporary SSR cache read; the successful runs used the existing
thread-pool option with one worker. Browser and unit success are local evidence;
latest-source CI acceptance remains separate.
The existing actual-app commercial driver also passes all **24 JA/EN cases**
at 393px/light and 1280px/dark, including rejected Cloud quotes, retained drafts,
replenishment and no automatic resend. Evidence:
`.artifacts/target-route-commercial-browser/results.json`. Three corresponding-
source fixture/helper closure checks pass after adding the new drivers/fixture
and records to the existing collector allowlist; no complete new distribution is
claimed.
