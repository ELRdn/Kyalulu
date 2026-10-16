# Account preferences and Cloud profile UI — 2026-10-05

## Delivered

- Account-scoped display name, saved characters and pinned chats. Encrypted
  preference payloads live in the existing control database; Google identity,
  API keys, theme and device settings are separate. The local Core retains its
  existing device-local settings.
- Authenticated profile GET/PUT routes with server-authoritative revisions.
  Concurrent stale changes return409; clients refresh, preserve the latest value
  and ask for a deliberate retry. Changes are serialized within each browser.
- Another account's in-flight responses cannot populate the new account state.
  Refresh happens at login, page/window focus, reconnection and manual refresh.
- Cloud settings show credits, expiration, usage/reservations, storage and account
  sync first. BYOK, local-device transfer, usage detail and data management use
  expandable sections. Cloud profiles hide the unrelated server-bookmark form.
- Mobile profile compacted; cloud controls placed ahead of display preferences.
  Existing theme tokens, icons and confirmation dialogs are reused.

## Validation

- Backend:28 auth/profile cases plus2 encrypted backup/restore cases passed.
  Covers two authenticated clients, account isolation, competing revisions,
  invalid inputs, persisted encrypted preferences and no credit consumption.
- Frontend:9 relevant cases passed, including serial revisions, account switching,
  conflict handling and releasing the saving state after an initial network error.
- Production Web build and targeted Ruff/whitespace checks passed. Existing
  bundling warnings remain.
- Chromium desktop1440px and mobile390px: two isolated browser contexts sharing a
  mocked account; display-name save updates the header and the other browser;
  stale edits display the latest value. Light/dark, no horizontal overflow,
  collapsed advanced sections and billing absence checked. No inference sent.
- Actual HTTPS serves exactly the built JavaScript. Profile routes deny anonymous
  access. Private inference remains available, sales disabled, Relay health200.

## Deployment and recovery

Release: `/opt/kyalulu-cloud/releases/20261005-profile-sync/bundle-final`.
Image: `kyalulu-cloud:20261005-profile-sync-final`, ID `7d2b2b4c4c04`.
Final archive SHA256:
`f80987687c3421346a4c45f58838c47b0dae02a64ab31091ce7e2a837b3a1d1b`.
Fresh staging avoids carrying previous hashed assets into the build. A staging
`.dockerignore` excludes private env/key/database files from later builds too.
Secrets are transferred separately and never printed or packaged in the image.

The first backup attempt failed because the CLI interpreted its own temporary
directory under the configured backup root as a tenant UUID. Old service was
resumed. The CLI now excludes only its exact staging directory, retaining other
path/UUID validation. A regression test exercises both destination locations.

After the fix, an encrypted backup completed before the switch. Only Cloud was
recreated. Update preserved one account, one grant,500 credits, zero operations
and no pending generation. Actual encrypted backup restored into a temporary
isolated environment with SQLite integrity checks and the same account/balance.
Encrypted copy was downloaded to the PC; VPS/PC SHA256 both:
`a9eabed9093cd034fa1b2cfaf71cb52c46340405b64a95bb64e7d37d0b0fb3cc`.

Evidence in ignored `.artifacts/cloud-profile-ui` and `.artifacts/cloud-profile-vps`.
Backend tests and deployed code checks establish implementation; authenticated
cross-device use on the user's actual physical devices remains a human check.
No extra paid API requests, Git commit or push were made.
