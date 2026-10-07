# Cloud character plots — 2026-10-05

## Cause and fix

The bundled character, persona, world and prompt YAML files already existed in
the VPS image. `mocha_sfw` was present and compiled with its character version.
Character detail and chat requested `include_nsfw=true` even in Cloud. The SFW
boundary correctly returned 403; detail swallowed that error as an empty list
and incorrectly displayed “character not found.”

- The shared character API client always requests the SFW catalog in Cloud;
  local requests retain their existing adult-content setting.
- Character detail distinguishes load failures from a genuine missing ID,
  displays the error and offers a retry. Unmounted loads cannot update state.
- Reading existing chat settings no longer writes the same settings back. This
  avoids unnecessary hosted safety calls when simply opening a conversation.
  Edited settings continue to save after the existing debounce.

Bundled plots live in the deployed release. User-created/imported plots already
persist in the account's tenant database and are returned by the same catalog.
This change does not upload personal plots from the local installation; the
existing explicit synchronization/import flow is still needed for that.

## Checks

- Seven related frontend tests passed; Cloud/local catalog query regression
  covered. Production Web build and targeted Ruff/whitespace checks passed.
  Existing Vite WASM externalization and bundle-size warnings remain.
- Backend integration: authenticated catalog across app restart; bundled Mocha
  personality/style/intro; persisted private plot and account isolation;
  anonymous denial and adult-content rejection; zero provider calls/operations.
- Separate API save/edit test with mocked safety checks: a plot saved via the
  hosted API survives app restart, stale edits return409, unknown extensions
  survive, and editing consumes no user credits. Both backend cases passed.
- Chromium at 1440px and 390px with strict mocked APIs: actual bundled plot
  content, available start button, no horizontal overflow, failed load/retry,
  missing ID and chat character display. Opening/reopening a chat writes no
  settings; selecting a world writes once and survives reload in the mock server.
  No real generation or paid safety calls were sent.
- Deployed catalog handlers checked in a separate in-container ASGI process,
  with the authentication owner replaced for the check: four SFW characters,
  Mocha intro/personality and real prompt compilation. This is not a fresh
  Google OAuth or physical-device acceptance test.
- HTTPS JavaScript checked against the local build, anonymous catalog access
  denied, Cloud/Relay health checked. Evidence in ignored
  `.artifacts/cloud-catalog-ui` and `.artifacts/cloud-catalog-vps`.

## Deployment

Release: `/opt/kyalulu-cloud/releases/20261005-catalog-fix/bundle`.
Image: `kyalulu-cloud:20261005-catalog-fix`.
Archive SHA256:
`457237af5a8d376cee164b83fcd64ffad8dd36fe2cdb2141e7da469e9d7c85b0`.

Stopped only Cloud after building the new image; made an encrypted backup before
switching; retained a local copy in ignored
`.artifacts/cloud-catalog-vps/pre-update.kybackup`.
Backup SHA256:
`fa197473e2d5f0c0263d54f6eff4f512bec01694e943392bcbb314f5203fed91`.
One account, 500 credits and zero operations remain after the update.
Relay/Caddy were not recreated. No subscriptions, extra grants, paid inference,
Git commit or push were performed.

Rollback release: `/opt/kyalulu-cloud/releases/20261005-profile-sync/bundle-final`.
