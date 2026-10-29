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
