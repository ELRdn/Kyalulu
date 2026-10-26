# Legacy Mobile migration and update acceptance

Application source: `e25ec63`. This is a Chromium fixture acceptance record,
not a production migration or physical-device/model-capacity qualification.

## Defect and change

Replaying a previously imported Mobile backup restored its old draft when the
user had deliberately cleared the current draft. An empty current draft with a
pending generation was also overwritten. The actual migration page now validates
existing recovery records and initializes the old draft only when no recovery
record exists. The entity/receipt transaction and owner isolation are unchanged.
Selecting a file clears the file input so the same file can be selected again.

## Private real-origin fixture

`tests/e2e_mobile_migration.py` starts a static-only backend and verified Caddy
2.10.2 on loopback. The test's fresh Chromium profile maps the exact production
App and Mobile hostnames to loopback; the product's origin allowlists and popup
protocol are unchanged. The private CA is not installed into OS trust. Both leaf
certificates are validated against that CA before their public keys are pinned
in the test browser. No real account, production API, provider or model is used.

The anonymous public Mobile shell snapshot contains 34 precache files. Its
Service Worker version is `02e69ee875c5b202578f`, SHA-256
`8323c1a0b22ca1a904524a8b6a8c63d57ea1e9b4af8b76aa4923db44dda73676`.
Every precache integrity and compressed-asset hash is verified before use.
The old worker is installed and controlling the page before switching the
fixture's Mobile delivery to the candidate. The old snapshot does not precache
the new neutral migration page, so that page must reach the fixture network.

Input is entirely fictional: two library characters, a differently named
historical character snapshot, 14 messages containing more than 1 MiB of UTF-8
text, complete/stopped states and a Japanese/emoji draft. A separate 2,097,171-byte
OPFS marker proves source-file preservation; it is not a model or model-transfer
test. No ready-model entries are inserted.

## Accepted behavior

- Canceling connection or declining the import dialog writes no target entities.
  Source permission and a separate target import confirmation are required.
- The real `/migration/` popup retains its opener and is not isolated. The actual
  MessageChannel transfers the multi-chunk envelope between the two exact origins.
- Atomic import creates one device-only conversation and three character
  snapshots. Message text, stopped/complete states and the original draft survive.
  Replays preserve IDs and do not duplicate entities.
- Replays keep both a deliberately cleared draft and an existing pending record.
  Corrupt SHA-256 input is rejected without writes. File export validates payload
  size/hash; repeated selection and import of the same file remain idempotent.
- While the source popup is open, explicit Mobile update is refused and the old
  cache remains. After closing it and confirming update, actual navigation occurs,
  the old cache is removed and candidate worker version `c3c68ca26fb31d487e91`
  takes over. Source IndexedDB and the OPFS marker match their original contents.
- The imported conversation opens through the actual `/device/` chat UI. The
  cleared composer stays cleared after reload. Only the expected `opened` timestamp
  changes; every other entity field, including payload and revision, is retained.
- Observed API requests, external requests and page errors: **0**. The fixture
  backend exposes only static files, with no provider or write APIs.

The first browser run reproduced the draft defect. Test-only fixes then addressed
TLS/backend readiness and an observer that accidentally created an empty target
database. Update checks wait for navigation/activation rather than mistaking the
new worker's installed cache for activation. Comparing a chat after opening
excludes only its expected recent-use timestamp.

Related clean-source unit checks: **70 passed / 3 files** (`appSync`,
`migration-channel`, `chatRecovery`). Unified and legacy Mobile builds, including
TypeScript checks, passed. Existing bundle-size/static-script/browser-external
warnings remain. Local summary and screenshot are retained as
`.artifacts/unified-mobile-migration-browser-results.json` and
`.artifacts/unified-mobile-migration-imported.png`.

Reproduce with separately verified inputs and a new output directory:

```text
python tests/e2e_mobile_migration.py --legacy <verified-old-shell> --mobile <candidate-mobile> --app <extracted-cloud-web> --caddy <verified-caddy-2.10.2> --output <new-disposable-directory>
```

Loopback port 443 must be free. The driver never stops unrelated services,
modifies OS DNS/hosts/trust, or reuses an existing browser profile. The old-shell
input also includes `observed-headers.json` with its public `csp`, `coop`, `coep`.

## Refreshed retained candidates

The `a6cbd98` application candidate is superseded by `e25ec63` for App migration
because it can resurrect a cleared draft. Earlier Worker-isolation evidence still
applies to the unchanged delivery implementation; this record does not repeat
all earlier feature/PWA/proxy tests or claim the new candidate passed them afresh.

- Cloud tar SHA-256:
  `ae666b34587dce95f367a27d210e4f812e3cd503d3805206f6e6616856a8f66a`.
  All 222 manifest hashes and 61 precache entries verified; source inventory 747.
  Migration/recovery/Runtime/proxy source matches the Git export, with a separate
  line-ending-normalized Git-blob comparison. The tar was actually extracted and
  used for the final browser run. Managed Relay origin remains fixed to
  `https://relay.kyalulu.com`; App worker version is `a682b3a31c8e59459842`.
- Mobile has 78 files, 40 verified precache entries, four pinned model descriptors
  and no model weights. All manifest hashes were independently checked. Its
  corresponding-source ZIP SHA-256 is
  `bb015db39269bfbe81c9c0da7b731d1536d39ac59ae471689b9f7668b61bbce6`;
  source inventory 747 and largest file 16,811,691 bytes. Its application bytes
  are unchanged from the earlier Mobile candidate; its corresponding source is
  refreshed to the new commit.
- Retained under `.artifacts/unified-canonical-e25ec63/`; copy hashes verified.
  Existing WASM outputs and license texts are reused, not rebuilt or legally
  reapproved. Docker image creation, signatures and current Windows packaging
  remain open.

Real model transfer/capacity, interrupted large-model recovery, Android/iPhone,
public-domain delivery/Cloudflare, OAuth, regional/provider approvals and
production data/ledger reconciliation remain unverified. No production data,
keys, databases, deployments or financial state were changed.
