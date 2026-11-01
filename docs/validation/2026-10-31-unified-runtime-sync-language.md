# Runtime sync notices follow the selected language

Cloud/device sync settings stored already-translated success and validation text
in React state. Switching language after a request left that notice in the old
language. The component now stores local notice identifiers and translates them
when rendering. Local verification/reload/account-change messages follow the same
rule; unknown service diagnostics remain unchanged. The component's selection,
owner guards, confirmation, consent/revision requests and synchronization behavior
are retained.

Validation:

- All **1,359 Web tests / 85 files** pass; the final local account-notice change
  also passes the **13 focused cases**. They cover language changes during and
  after requests, success/stop/unverified stop, verification failures, raw errors,
  unchanged selection/requests, declined consent and owner change during confirmation.
- TypeScript and unified build pass.
- A real React/IndexedDB/dialog Chromium fixture verifies four notice states
  through JA→EN→JA→EN without remount, new HTTP requests, selection/consent changes
  or storage mutation. Only loopback HTTP responses are fictional; React, hooks,
  sync implementation and IndexedDB are real. Unknown diagnostics and request IDs
  remain unchanged. Local account-change refusal is also checked in both languages.
- Failed Cloud stop retains local `consent=false`, the withdrawn fixed outbox
  request ID/body and conversation draft. Successful stop preserves existing
  copies. Changing owner during confirmation sends no update and preserves storage.
- External requests and page errors are zero. Browser/context/server cleanup is
  awaited in finalizers and the process exits successfully; no separate PID/port
  inventory was collected. Real Cloud, physical devices and other browsers remain
  outside this fixture.
- The focused browser fixture is included in the Runtime and Web CI workflow;
  current-source CI completion is a separate acceptance result.

The audit also found DeviceSettings and RemoteHostSettings already use the current
language for their static UI and known errors, with model names and unknown
diagnostics intentionally preserved. Those components were not modified.

This fixes notice language behavior, not production OAuth, region/provider
eligibility or whole-plan acceptance. The integration PR remains Draft and
production cutover stays on hold.
