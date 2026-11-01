# Missing-PC runtime routing — 2026-10-29

`apiFetch` previously fell through to the same-origin HTTP transport when the
execution target was `pc` but no Remote device was selected. The unified
managed-Relay screen usually intercepts this state, but the transport boundary
must also reject it. It now throws the existing localized destination-selection
error before dispatch. Explicit Cloud account/community API routes keep their
existing separate transport.

Four new unit cases cover status/history reads and a private chat mutation with
no selected PC, asserting zero HTTP requests, plus continued access to explicit
Cloud account/community APIs. All **27 transport tests**, **71 related
RemoteRpc/error-language tests**, and Web typecheck passed. A combined test run
initially could not read a temporary Vite SSR cache file; rerunning the affected
transport suite passed without source changes. This was not counted as a
successful first run.

The existing `tests/e2e_remote.py` passed **12 checks** using real installed
Chromium, an owned loopback Relay/Host and fictional Runtime data. It exercises
the normal selected-PC path, encrypted pairing/approval, JA/EN UI, persisted
keys, conversation history, uploads, reconnection and revocation. The new
missing-PC negative cases are unit tests, not a new physical-device test.

No production connection, credentials, model, data migration or deployment was
used. These source changes postdate the separately audited `6c8cdf4` archive
and the `bf83d03` Linux image; those artifacts do not include this fix.

## Same-document target changes — 2026-10-30

The `232c2ee` Ubuntu commercial UI check failed after missing-PC dispatch was
closed. Real Chromium reproduced two distinct problems: its PC fixture still
expected a Runtime without a registered PC, and switching Cloud to PC at `/`
only changed the URL fragment. The latter retained the old Cloud access state
and draft on the PC screen, although transport correctly blocked dispatch.

`switchTarget` now explicitly reloads a destination with the same path and no
query, resetting the route fragment first. Different document paths or removal
of a query still use normal navigation. Desktop/file reload and generation
protection remain unchanged. Six added unit cases cover these navigation forms;
all **40 unified/transport tests** passed.

The actual-app commercial fixture now expects the connection screen and **zero
API requests** for an unregistered PC. Cloud-to-PC switching shows no composer
or previous Cloud state; switching back restores the original scoped draft with
no automatic send. The full JA/EN, narrow-light/wide-dark run passed **24/24
cases, 472 recorded checks**, with zero unmocked API/model requests, external
requests and page errors. Local evidence:
`.artifacts/commercial-target-reload-20261030/results.json`.

This replaces the earlier fixture's invalid assumption of a working unregistered
PC. It does not prove the registered-PC three-screen advertising matrix; the
separate encrypted-Remote acceptance covers real loopback PC communication.
Cloud/Windows/Mobile artifacts at `232c2ee` predate this fix and are superseded.
