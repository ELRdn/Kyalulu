# Plot creation UI — 2026-10-05

## Changes

Three agents worked on separate files: PortableEditor and its scoped CSS, the
Create page shell, and the browser verification script. Their work was integrated
before deployment. The supplied zeta screenshots informed the layout.

- Creation chooser for plots, lorebooks and generation presets; mobile sheet
  and desktop dialog, sticky editing header and save controls.
- Six character tabs: plot, lorebook, style, intro, introduction and details.
  Grouped inputs, character counts, purple selection and chat-style intro preview
  use existing functionality. Tabs support ARIA and keyboard navigation.
- Hidden panels stay mounted, preserving invalid JSON text and blocking save
  until corrected. Unknown fields, greeting alternatives, lorebook dictionary
  keys, presets and existing asset operations are retained.
- Temporary drafts use account/host-scoped sessionStorage, report storage
  failures and restore on reload. Changing owner remounts the editor. Temporary
  browser storage and account/server persistence have separate explanations.
- Server revision checks and import idempotency remain in use. Returning from
  editing prompts to retain the draft; browser unload has a dirty-state guard.
- Cloud hides the adult-content toggle and disables unvalidated image uploads.
  Creator comments are described as unused for conversation generation, without
  implying that cloud safety inspection never receives them.

## Validation

- Production Web build passed after integration; related Cloud/account-profile
  frontend tests passed (11 tests). Targeted Ruff and diff whitespace checks
  passed. Existing Vite WASM externalization/bundle-size warnings remain.
- Chromium: 1440px desktop and 390px mobile, light and dark themes, all four
  cases passed. Covered tabs, intro preview, invalid JSON across tabs, draft
  reload, failed save/retry, stale revision conflict/retry, and reading a saved
  document from another browser. No horizontal overflow or page errors.
- Dark-theme cases additionally checked unknown fields, lorebook/preset reload,
  owner-scoped drafts and server item isolation. Account switching refreshed
  RuntimeGate through the actual focus/status path before assertions.
- These browser checks use strict mocked APIs: 130 mock API requests, 24 mock
  save attempts, zero external API requests and zero inference requests.
  They do not establish real Google OAuth or paid cloud safety acceptance.
- Related catalog backend integration passed two cases, including authenticated
  persistence across restart, account isolation, API save/edit with mocked safety,
  stale revision 409 and unknown-field preservation. See the catalog report.
- After deployment, HTTPS entry JavaScript and lazy Create JS/CSS exactly match
  the local build. Cloud health and Relay health returned 200; anonymous catalog
  access returned 401. A separate in-container ASGI process with a substituted
  authenticated owner verified four SFW characters and Mocha prompt compilation.
  This is a read-only handler check, not a fresh Google login.

Evidence is in ignored `.artifacts/plot-creator-ui/acceptance.json`, screenshots
and traces, and `.artifacts/plot-creator-vps/acceptance.json`. The user still needs
to exercise real account creation/save from their authenticated browser; this
work sent no paid safety or inference requests.

## Deployment

Release: `/opt/kyalulu-cloud/releases/20261005-plot-creator/bundle`.
Image: `kyalulu-cloud:20261005-plot-creator`.
Archive SHA256:
`9af3f718cfee5c39df9a83ba2c2733c4d837dc0594cd0e2f920d1e52b97090eb`.

The new image was built before stopping only Cloud. An encrypted backup was made
before switching and copied to ignored
`.artifacts/plot-creator-vps/pre-update.kybackup`.
Backup SHA256:
`2a0d62561802c4eb5da9d46618875ce83eb411d5487ebbeec427f828555311f6`.
Relay and Caddy were not recreated. One account, 500 credits and zero operations
remain. Subscriptions and paid inference were not enabled; no Git commit/push.

Rollback release: `/opt/kyalulu-cloud/releases/20261005-catalog-fix/bundle`.
Current entry asset: `index-DSxl2fL2.js`.
Create assets: `Create-CyTB4dJy.js`, `Create-HpIfnjhZ.css`.
