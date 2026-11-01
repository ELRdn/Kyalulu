# Cloud-origin stop, verification and destination return — 2026-10-31

`tests/e2e_cloud_target_switch.py` exercises the actual unified App against an
owned loopback Uvicorn Cloud server, tenant SQLite database, generation queue,
quote service and wallet. Existing Cloud fixture helpers create fictional
sessions, funded balances and a private-test configuration. A fictional `ZZ`
adult policy enables the local fixture only; production region/provider gates
are unchanged.

The browser navigates to `https://app.kyalulu.test`. Playwright intercepts that
reserved host: assets come from the owned Vite server, and API requests go to
the owned Cloud HTTP server with the browser's virtual authority/headers/body.
The actual Cloud Host, Origin, owner, consent and eligibility boundary runs.
The browser has a fictional secure HttpOnly session cookie. There is no real TLS
server, DNS change, OAuth login or hosted account. Inference is a strict
MockTransport response; no provider request leaves this fixture.

## Verified behavior

The same scenario passes in Japanese at 393px/light and English at 1280px/dark:

1. Send through the actual composer, settings save, stored-context read, quote
   and streaming endpoint. Hold the fictional provider's stream. The execution
   picker is disabled; direct Cloud/Device/PC switches reject without changing
   the URL or localStorage.
2. Explicit Stop reaches the real cancellation endpoint. The provider delivers
   a billed success after cancellation, exercising the terminal fence. The
   tenant remains cancelled with no committed message IDs; the operation is
   failed with zero charged Credits and the original wallet balance.
3. Hold the real cancelled-status response before browser delivery. Switching
   still rejects. Navigate to Profile, reload the complete document, verify the
   durable scope guard, and return through the JA/EN send-result link. Release
   the result; recovery restores the sent input and unlocks the picker.
4. Edit a new unsent draft and cancel the destination review. Accept Device,
   confirm the Cloud conversation was not copied to IndexedDB, then return to
   Cloud and reopen the original conversation. The draft is retained; actual
   status/history APIs still show the original cancellation and empty history.
   There is exactly one quote, stream request and provider call at this point.
5. Only after deliberately editing and sending again does a second generation
   run. Its real save/recovery completes, the draft clears, and one Credit is
   charged. The two ledger operations remain `(failed, 0)` and `(completed, 1)`.

All external HTTP/WebSocket attempts and page/route errors fail the test. Vite's
development sockets to the exact owned origins/port are closed and counted
separately. Before cleanup, no route coroutine remains active. Every intercepted
request is fulfilled or explicitly aborted, including browser-aborted streams;
the driver awaits Playwright's route drain, context/browser close, Cloud thread
exit and Vite termination. Temporary tenants are removed. No detached pending
task warnings occur in the final run.

## Evidence

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
.venv/Scripts/python.exe -B tests/e2e_cloud_target_switch.py
```

Final result: **2/2 pass**, installed Chromium **151.0.7922.34**, two deliberate
provider calls per case, cancelled charge **0**, resumed charge **1**, zero
blocked external requests, page errors and cancelled route callbacks. Local
evidence: `.artifacts/cloud-target-switch-browser.log`, the directory's
`results.json`, and JA/EN pending-Profile screenshots. The Japanese narrow capture
was visually inspected: the recovery link stays visible above the shared shell.
The Runtime/Web workflow now runs this driver; corresponding-source collection
includes it and its local Python helpers. CI acceptance is tracked separately.

Initial harness runs passed interaction checks but failed cleanup: an already
aborted stream returned from its route callback without an explicit route abort,
leaving Playwright's completion future unresolved. The final driver closes both
response paths and drains normally. Other setup corrections preserve the virtual
HTTPS authority and distinguish closed owned Vite sockets from foreign traffic.
These failed attempts are not acceptance evidence or changes to product limits.

## Limits

This is actual application/Cloud persistence and accounting with fictional
identity, policy, provider stream and browser-controlled HTTPS interception.
Real OAuth, provider billing/cancellation, hosted TLS/CSP, physical phones, OS IME,
large conversations, process-kill recovery and production cutover remain separate
acceptance requirements. The mocked late provider success does not establish
that a real provider can stop its invoice. The separate
[backend checks](2026-10-31-unified-cloud-stop-accounting.md) cover owner/quote
boundaries, late settlement/replay and session-conflict responses.
