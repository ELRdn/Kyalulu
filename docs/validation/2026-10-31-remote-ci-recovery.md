# Remote E2E: authenticated reload recovery

Scope: `tests/e2e_remote.py`, shared checkout supplied as HEAD `1de2cac`.
No Git commands, product-code edits, installs, deployment or CI reruns/cancellations.

## Evidence and diagnosis

- Run `41126298352`, Ubuntu job `124305603808`: the supplied
  `.artifacts/ci-1de2cac-ubuntu-pr.log` fails at the original line 435,
  `expect(composer).to_be_visible()` (5 seconds).
- Its snapshot is RuntimeGate's connection-error screen, with a disconnected
  RemoteBanner. The disabled destination picker and recovery link survive outside
  RuntimeGate. `Remoteの接続先` is also rendered on the error screen: waiting for
  this region does **not** establish that authenticated Profile has mounted.
- `RuntimeGate.tsx` checks `GET /api/mobile/status` with a 10-second abort signal.
  `RemoteConnection.connect()` has a separate 15-second established-device
  handshake budget; `RemoteRpc` admission has a 15-second budget and 12 slots;
  Host followers / per-device live bridge requests have 16 slots. Waiting longer
  for the composer cannot recover a completed failed access check.
- The held cancelled-status read waits after `generations.status()` closes its
  database connection. Bridge requests execute in separate tasks, and a transport
  disconnect detaches followers rather than cancelling their Runtime requests.
  Normal reload succeeded with the held read still blocked. There is no evidence
  that this one held GET by itself serializes or starves access checking.
- During local diagnosis the same gate-error/disconnected-banner state also
  occurred at the existing full navigation after PC/Device/PC, after the controlled
  metadata fault was disabled and the observation wrapper restored. Evidence:
  `.artifacts/remote-v1/e2e-e9005b68/failure.txt` and `failure.png`.
  This is a second bootstrap boundary, not a failure of draft-value comparison.

The confirmed test defect is treating settings chrome / URL changes as successful
Runtime bootstrap. The initiating CI channel failure is **not established**.
Relay attachment diagnostics in later local runs recorded HTTP 409 with
`existing_peer=false`, followed by Host registration. In that branch of
`Hub.attach`, the Host is absent or stopping; a duplicate client peer is not the
explanation for those local records. Some runs deliberately close the Host as
part of existing acceptance coverage, so this observation alone neither proves
why the Host disappeared nor identifies the initiating failure in Ubuntu CI.

## Change and regression coverage

- `runtime_ready` waits for authenticated route content or an enabled RuntimeGate
  retry button. It uses the existing button at most once and then requires real
  route content. Its bounded 30-second wait covers channel/access establishment;
  the original composer visibility assertion remains at its default 5 seconds.
- Profile readiness requires its `表示名` textbox, a successful real access GET,
  and the encrypted-connection banner before following the saved-result link.
- The same barrier undergoes a normal full reload and a controlled failing access
  read. Only `/api/mobile/status` GET fails at the adapter invocation boundary;
  bridge authorization remains real, and no successful access response is forged.
  Overlapping bootstrap checks remain faulty until the explicit retry is enabled.
  The test first proves the error screen contains the old region/link predicates
  while the composer is absent, then permits the real access check to succeed.
- Observed requests through Profile recovery must all be GET. Each return to the
  composer must start a fresh cancelled-status read while `release_saved` remains
  unset and the picker remains disabled. The barrier is released only afterward.
  Input restoration, empty committed history, exact cancelled terminal state,
  draft roundtrip and the other existing acceptance assertions remain intact.
- The later full navigation after PC/Device/PC also uses bounded explicit Runtime
  recovery before checking the original saved draft value.
- `recovery-metadata.json` records only phase, elapsed milliseconds, HTTP method,
  access/other route category, response status and exception class / injected-fault
  marker. Failure output includes this metadata and Host connection counts.
  `acceptance.json` also records Relay attachment role, existing-peer boolean and
  attachment failure type/status when present. No keys, tokens, headers, actual
  session IDs, prompts or response bodies are added to these diagnostics.

## Validation and limits

Run with the installed browser; no installation is needed:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:/Users/hiron/AppData/Local/ms-playwright'
.venv/Scripts/python.exe tests/e2e_remote.py
```

- Unchanged baseline: 14 checks passed,
  `.artifacts/remote-v1/e2e-f5b5ff94/acceptance.json`.
- Expanded normal + controlled-failure case: 15 checks passed,
  `.artifacts/remote-v1/e2e-8dfc81b5/acceptance.json`.
- Full recovery implementation, including PC/Device/PC readiness and Relay
  diagnostics: 15 checks passed,
  `.artifacts/remote-v1/e2e-433c7fc9/acceptance.json`.
  A temporary `.artifacts/remote_relay_probe.py` observed Relay close code,
  exception class and source line only; this successful run did not reproduce
  the unexplained channel loss.
- A previous run of the single-retry implementation still failed at
  PC/Device/PC when its only UI retry could not establish access:
  `.artifacts/remote-v1/e2e-7601daf2/failure.txt`. This is retained evidence
  that persistent failures are not suppressed by looping, early barrier release
  or timeout-only acceptance.
- The final acceptance report includes `runtime_recoveries` with per-boundary
  UI retry counts (0 or 1); the controlled failure requires exactly one.
- Final direct run after adding retry-count evidence: **15 checks passed**,
  `.artifacts/remote-v1/e2e-76e1bccf/acceptance.json`, with complete Relay shutdown.
  UI retries were normal reload **0**, controlled failed-access reload **1**,
  PC/Device/PC reload **0**. `recovery-metadata.json` contains only GETs during
  both Profile reload phases: normal access statuses `[200, 200]`; controlled
  access outcomes `[injected_failure, injected_failure, 200]`.
- Final source is also compiled and its focused diff inspected without Git.

These are Windows loopback Chromium checks with the Mock provider and emulated
mobile viewport. The controlled fault reproduces failed metadata access, not the
original physical Noise/WebSocket failure. Ubuntu CI and physical devices were
not rerun; continued channel failures must still fail after the single UI retry.
