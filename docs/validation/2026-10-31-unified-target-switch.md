# Explicit Remote stop and target switching — 2026-10-31

`tests/e2e_remote.py` extends the existing real Chromium → Noise-encrypted
loopback Relay → Host → isolated Python Runtime test. No product behavior or
generation deadline was changed. The existing Runtime/Web workflow already runs
this driver after the wrapper build.

A separate Mock generation is held by an event, so the check does not race the
completion of a short reply. While pending, the actual execution picker is
disabled and direct calls to `switchTarget` reject Cloud, Device and PC without
changing the URL or localStorage. Explicit Stop cancels the real Runtime job.
The real cancelled-status response is then held at the Runtime read boundary:
the picker remains disabled, the recovery control stays visible, and Device
switching still rejects until saved-result verification completes.

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

Private evidence: `.artifacts/remote-target-switch-browser.log` and
`.artifacts/remote-v1/e2e-f373acff/acceptance.json`. The initial launch could not
find Chromium under the sandbox's default path; the final run explicitly uses
the already installed browser. No browser installation was required.

## Limits

The originating generation is PC Remote, with a Mock provider, fictional data,
Japanese switch controls and a 393px emulated mobile viewport. Cloud-origin and
Device-origin generation/stop/switch flows, English switch controls, real models,
physical phones and production TLS/CSP/origin migration still require separate
evidence. Trying all three destinations from a pending PC job is not acceptance
of all three originating execution modes. No production service, account,
conversation, key or configuration was accessed or changed.
