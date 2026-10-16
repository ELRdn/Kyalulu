# Official plot portraits — 2026-10-05

The user approved publication of the supplied Rei, Shion and Mocha images.
The existing Cloud catalog now serves these three SFW official plots:

- `senior_cool`: Rei, one portrait.
- `butler`: Shion, two portraits; the first is the catalog/chat image.
- `mocha_sfw`: Mocha (daily), two portraits; the first is the catalog/chat image.

The detail page offers thumbnail buttons for multiple portraits, synchronizes
the blurred backdrop, and resets the selection when changing plots. Buttons
support keyboard activation and expose their selection with `aria-pressed`.
Original Mocha and night variants share the local image references; their
existing NSFW status and Cloud exclusion remain in place.

## Verification

- Web production build passed. Existing Vite warnings about the theme script,
  WASM externals and bundle size remain.
- Local Chromium checks passed at 1440/390px in light/dark themes, including
  both photographs, keyboard operation, navigation reset, and Rei's single-image
  layout. Copies and packaged images exactly match the supplied 832×1248 PNGs.
- HTTPS responses for the five PNGs, entry JS/CSS and corresponding source
  archive exactly match the release. Previous hashed Web assets remain available
  for clients transitioning to the new build.
- A separate ASGI process inside the deployed container, with a substituted
  authenticated owner, verified the real catalog handlers, all three official
  flags, portrait references, SFW filtering and rejection of NSFW requests.
  The running service's authentication was not changed.
- Chromium loaded the actual published HTTPS renderer and images for 12
  combinations (three plots × desktop/mobile × light/dark), with no page errors
  or horizontal overflow. Catalog data came from the deployed handler readback;
  authentication and private metadata APIs were mocked. Real Google OAuth was
  not exercised in this update.
- Cloud/Relay health passed. Other container IDs, service flags and the ledger
  were preserved: one account, 500 credits, zero operations/pending operations.
  No paid safety or inference requests; no Git commit/push.

Evidence: `.artifacts/official-portraits-vps/acceptance.json`,
`browser-acceptance.json`, `scope.json`, catalog readback and screenshots.

## Deployment and recovery

- Release: `/opt/kyalulu-cloud/releases/20261005-official-portraits/bundle`.
- Image: `kyalulu-cloud:20261005-official-portraits`.
- Rollback: `/opt/kyalulu-cloud/releases/20261005-plot-creator/bundle`.
- Bundle SHA256: `c0e604c6fe31ba5f4af052f821d357fdf670be15d791f9c78f1b7ff1d8890f67`.
- Final pre-update encrypted backup:
  `.artifacts/official-portraits-vps/pre-update-verified.kybackup`.
  SHA256: `417aed69299d740b5015775b0e044e9461196ebc018e8e67071168bd87eaa27e`.
- Active entry files: `index-DT24htEA.js`, `index-BbBx-4_n.css`.

The first post-deployment check incorrectly requested `/api/cloud/source` and
triggered rollback. After correcting the verification URL to `/source.tar.gz`,
a fresh encrypted backup was taken, the same image was reactivated and all
checks passed. Only the Cloud container was recreated; Relay/Caddy were retained.

The corresponding-source diff against the prior release contains exactly the
five portraits, seven existing source/YAML updates, and no dependency changes.
Unrelated local README/package-script updates were excluded from this release.
The existing private login scope, sales/advertising settings and image-upload
restrictions were retained; this publishes official assets in the current Cloud
and does not establish general-service launch acceptance.
