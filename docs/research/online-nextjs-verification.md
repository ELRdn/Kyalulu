# Online migration verification

Baseline revision `4f24140c5b1ad30ee2d20221ef831aa65783ea8d` plus the existing uncommitted device and generation changes. The current release has a Python Cloud boundary, the unified Vite build and Caddy. This record tracks local evidence. Production artifact identity and host configuration are unknown.

## Route ownership before cutover

The old HTML owner in this table is Cloud WebDist serving the unified build. Private reads and writes stay on the selected runtime. Cloud guests can open several tab roots with limited actions. Local PC administration requires a capable PC distribution. A paired PC exposes only the operations allowed by its runtime. The browser device target stores its own data.

| URL or document | Current owner and entry behavior | Acceptance cases for migration |
|---|---|---|
| `/` | Home. Cloud can browse anonymously. Entry also chooses the execution target. | Recommendations, eligibility on non-Cloud targets, language, old installed start URL |
| `/discover` | Discover and Python public catalog HTML. | Guest, owner, mood/world filters, Back |
| `/characters/:characterId` | Python public head/body for eligible native cards, CharacterEntry for interactive catalog, personal library and resume. | Official SFW, restricted, absent, owner library, saved state and first message |
| `/published`, `/published/:publicationId` | Published catalog and detail. Public snapshot subject to runtime eligibility. | Direct visit, restricted viewer, withdrawal |
| `/works/:workId`, `/authors/:authorId` | Community snapshots. Server checks availability, blocks and viewer permissions. | Anonymous and signed-in views, hidden author/work, private interactions |
| `/publications` | Submission, review and publication management. | Signed-in submitter, other user and moderator |
| `/chats`, `/chats/:sessionId` | Guest tab shell, selected-runtime conversation list and private chat. | Quote, consent, SSE, generation ID recovery, branch, deletion and account changes |
| `/create`, `/create/settings` | Guest tab, authenticated creation, owner-scoped settings. | Import, edit query, save and reopen in each supported runtime |
| `/profile`, `/profile/advanced` | Guest-readable profile and execution picker. | Guest, member, pending generation and target switch |
| `/profile/:section` | settings, interests, age, edit, saved, credits, account, connection, pairing, devices. CloudRouteChoice gates private pages. | Owner, account change, region/age, credit settings, pending sync, pairing, section anchors |
| `/profile/legal/:doc` | Guest-readable legal screen. Terms, privacy and sales where enabled. | Direct visits, language, missing document |
| `/studio`, `/status` | Studio and diagnostics behind AdminPage. | Local administrator, Cloud, paired PC and browser restriction |
| `/research`, `/research/benchmarks` | Device-scoped research or PC administration. | Owner switch, stored runs, denied remote capabilities |
| `/login?returnTo=…`, `/?login_error=…` | CloudRouteChoice, sessionStorage return path and pending start. | Cancel, valid callback, expired callback, draft and Back |
| `/auth/callback` | FastAPI exchanges auth and redirects to `/#/` or error fragment. | Cookie, origin, same-tab return, duplicate entry |
| `/#/…`, `#remote=…` | main.tsx consumes pairing before analytics, then normalizes old hash locations. | Old bookmark, invalid/expired pairing, reconnect, no fragment disclosure |
| `/device`, `/device/`, `/device/index.html` | Dedicated isolated entry. Hash router owns arbitrary `#/chats/:sessionId` offline. | Cold offline startup, existing IndexedDB/OPFS, generation and reload |
| `/migration`, `/migration/`, `/migration/index.html` | Direct HTTP serves the migration document. SPA navigation to /migration can render the Migration component. | Older Mobile imports, isolation and network restrictions |
| Unknown paths, missing assets | WebDist and React NotFound. A recognized first segment can still resolve to a client-side 404 with HTTP 200. | Distinguish unknown document, invalid nested path, missing script and API |
| `/api/*`, `/source.tar.gz` | FastAPI. Browser transport selects Cloud, device, local or encrypted Relay. Source archive is a separate release artifact. | No fallback HTML for API, source download matches deployed version |
| `/assets/*`, `/runtime/*`, `/ort/*`, `/icons/*`, `/mascot/*`, `/legal/*` | Unified build, worker, model runtime and assets. Worker gets dedicated isolation policy. | Integrity, WASM variants, old chunks and private media boundaries |
| `/sw.js`, `/manifest.webmanifest`, `/index.html`, theme/init and icons | Existing PWA precaches exact build files. Query URLs and personal API data bypass the cache. | Consent-based upgrade, second open tab, worker recovery and saved data |
| `/_next/static/*` | New opt-in asset upstream. Only the official Mocha detail path is eligible for the first traffic switch. | Old and new assets available during rollback |

## Baseline and thresholds

Anonymous public HTTP GET with `Accept: text/html` returned 404 for /discover, /published and /characters/mocha_sfw, and 200 for / and /device/. Local unified Vite emits a 404.html. Starlette 1.6.0 returns this file with status 404. The original WebDist handled only a raised 404, so the direct character journey stopped before login. This reproduces the public symptom. It does not identify the production revision.

After the WebDist fix, the same Vite build serves the character name and introduction with JavaScript disabled. The legacy app replaces this public HTML during startup. Three cold Chromium 151.0.7922.34 profiles at 393 × 852 CSS pixels, DPR 2, ja-JP, 80 ms latency, 2 Mbps down and 750 kbps up, with service workers blocked, used disposable FastAPI storage and gzip on loopback. No model or auth provider was contacted. The shell SHA-256 was `c22284b2eab34c1ac50c428fd2c573dd90159cdcbd9587fcef6f9a82add9f5fe`.

| Corrected legacy direct entry | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| First observed frame with the character heading (ms) | 582 | 568 | 566 |
| First usable character composer (ms) | 2019 | 1945 | 1938 |
| LCP by first interaction (ms) | 1732 | 1708 | 1696 |
| Initial script transfer (bytes) | 319958 | 319958 | 319958 |
| Completed API reads up to composer readiness | 3 | 3 | 3 |
| Submitted first draft retained in login sheet storage | yes | yes | yes |

Acceptance criteria set before measuring the new journey: keep direct HTTP 200 and a readable JS-disabled introduction. Compare like-for-like three-run medians on the same proxy and fixture. Target at least 20% less initial JavaScript, earlier usable input and no regression above 10% in heading or LCP timing. A complete journey requires three successful fixture login returns with exactly one intended send each, zero lost drafts or duplicate ledger operations, and an independent account-switch check. Consent, quote and model latency are separate measurements.

To reproduce the local legacy baseline, set `VITE_RELAY_ORIGIN=https://relay.test`, run `pnpm --filter web exec vite build --mode unified --outDir ../../.artifacts/next-migration-baseline` with the verified WASM inputs present, then run `python tests/e2e_online_character_baseline.py .artifacts/next-migration-baseline` in the project venv with its matching Playwright Chromium.

## Local same-origin pilot

`apps/online` uses the workspace pnpm version, React 19.2.8 and pinned Next.js 16.4.6. A dynamic Server Component reads one FastAPI public card through the configured HTTPS app origin with no viewer cookie. The API projects only presentation fields and checks official and SFW eligibility on every request. A client composer loads the current Cloud identity after the public page renders. Its tab-local draft is scoped by owner and character. A one-use ID hands the first line to the existing runtime UI. The character route with a start query stays on WebDist so an installed cache-first worker cannot supply a stale root shell for this handoff.

The first image experiment delivered the original 1,314,107-byte PNG as the largest element. Its median LCP was 6,388 ms. The pilot now uses responsive image sizes from the bundled official portrait. The image optimizer accepts only the matching local static media pattern. The table compares consecutive off/on cohorts in the same local HTTPS Caddy fixture, with the mobile profile above. Values are three-sample medians.

| Character entry metric | Corrected legacy | Next pilot |
|---|---:|---:|
| First observed heading frame | 850 ms | 551 ms |
| First usable composer | 2,237 ms | 1,488 ms |
| LCP at first interaction | 2,008 ms | 1,284 ms |
| Initial script transfer | 320,319 B | 143,916 B |
| Completed API reads to composer | 3 | 1 |
| Intended draft present in login sheet storage | 3/3 | 3/3 |

The HTTPS fixture exercised a page switch in both directions, refresh, Back, nominal cookie retention, enforced CSP and continued delivery of Next chunks after rollback. A Chromium persistent profile installed the unified worker before the switch. After the proxy stopped, a fresh offline browser process reopened the isolated device shell at an arbitrary local conversation ID and loaded the chat composer. This is browser emulation. Prior stored history, inference, device models, real devices and recovery from a replacement worker are separate acceptance cases.

Three fresh visitor journeys completed fixture authorization, the real FastAPI callback, draft transfer and the first conversation. Two immediate submit events per attempt produced three distinct sessions with one intended user message each, three generation records and three settled test credit operations in total. Each contained the expected reply after refresh. The browser also exercised login cancellation, session expiration during composition and switching to paired-PC mode before submission. The latter two cases prevented dispatch from the stale composer. A local Node process used 105 MiB RSS after these journeys. This single observation cannot size the production host.

The initial character pilot was archived as `.artifacts/next-pilot-source.tar.gz`, SHA-256 `1b1f57b33befdc48ea645c5657048cd286ce4e69f4c286d797630a1d04fc02e8`. Thirteen build inputs were byte-compared with that pilot. Later route groups require the updated source archive.

For a developer adding another public detail screen, the pilot puts its route, server read, metadata and initial view in a single App Router page. The old path spans App.tsx, the guest-route decision, WebDist's segment table, Python public_pages metadata and the client page. The FastAPI visibility rule and proxy ownership decision still require explicit review. A timed developer comparison and a second migrated detail route remain open.

Local rehearsal commands:

1. Install workspace dependencies with `pnpm install --frozen-lockfile`. Build with `pnpm --filter online build` and the unified Vite command above, using `.artifacts/next-migration-coexist` for the current bundle.
2. Run `python tests/e2e_online_coexistence.py --dist .artifacts/next-migration-coexist --caddy PATH_TO_CADDY --samples 3`. The fixture creates ephemeral loopback ports, a local TLS CA and disposable data. On this machine the existing Caddy binary is under `.artifacts/unified-migration-inputs-20261030/tool`.
3. For a designated staging site, point `KYALULU_PUBLIC_ORIGIN` at its exact HTTPS origin, start `pnpm --filter online start` on a private interface and set Caddy's `ONLINE_UPSTREAM` to it. Run the updated FastAPI and unified bundle on `CLOUD_UPSTREAM`. Enable `ONLINE_ASSETS=on` before `ONLINE_CHARACTER=on`. The Caddy example defaults both switches off.
4. To roll back this pilot, set `ONLINE_CHARACTER=off` and reload the validated site configuration. Leave `ONLINE_ASSETS=on` and retain the matching builds while existing tabs depend on them. Check a direct Mocha visit, the chat composer, the isolated device document and an already-open tab. Deployment, host capacity, staged cohort allocation and the operator observation window remain open.

## Cloud conversation routes and account screens

On November 24, the local release candidate added App Router pages for the chat list and session, profile and its sections, legal documents, creation and creator settings, publication review, Studio, research, benchmarks and status. These pages reuse the shared React views and the existing browser-to-FastAPI transport. Next owns document requests and navigation within each migrated group. A React Router adapter supplies location, route parameters and navigation to the shared views used by the PC distribution. Private data loads after RuntimeGate has identified the viewer. Device and paired-PC chat visits still enter their existing client shell.

The opt-in `ONLINE_CHATS` and `ONLINE_PAGES` Caddy switches control these two route groups independently. The proxy announces the current assignment on the runtime status response. The old UI pins it for the life of its document and opens the appropriate Next document on entry, before mounting the previous view. An active conversation retains its UI across a focus check. For local rehearsal, use the instructions above with `.artifacts/next-migration-pages` as the unified Vite build. The Next build uses webpack for the shared browser modules. Both builds use the same SDK hash and WASM compatibility checks. Roll back the affected group by turning off its switch, keeping assets available.

The Cloud chat fixture runs the built browser application, Caddy and FastAPI over local TLS with simulated OAuth and model providers. It checks three distinct first sends after login and a duplicate submit interaction. It interrupts a send before the POST reaches the runtime and again after the runtime commits but before the browser receives the reply. Explicit cancellation fences the missing generation ID and restores its draft. The second interruption recovers the single committed reply by generation ID after refresh. It also exercises quote-consent cancellation, regeneration, branching, deletion within the branch, list-to-chat client navigation and server-side credit reconciliation.

Two signed-in fixture accounts share one browser for the account-switch check. The second account sees its own empty draft and history for the same conversation URL. Returning to the original account restores its draft. After the Caddy group is rolled back, the old UI opens the committed conversation and its unsent draft. The browser emulator also reopens an arbitrary device chat offline after a cold restart. Physical-device inference, target-host capacity, a staged cohort and production cutover are outstanding.

## Public browsing and the app entry

Twenty App Router page definitions now cover the Cloud home, login, discovery, official and private character details, two chat routes, profile and legal subroutes, creation, publication management, the two public catalog routes, legacy community work and author links, Studio, research, benchmarks and status. Cloud-only clients see the existing PC administration restriction on Studio, research, benchmarks and status. The older community work and author API is disabled by FastAPI in unified mode. Its corresponding pages show their existing availability message.

`ONLINE_BROWSE` switches discovery, characters, published works and the community links. A signed-in character-library entry loads its private content after runtime authorization. An official card renders its public introduction immediately and can open the full interactive profile. Discovery requests the character and world catalogs; it no longer fetches the viewer's chat sessions. `ONLINE_ENTRY` switches home and login. Old hash links are interpreted within the same origin. The root's legacy service-worker precache request still receives the exact Vite document whose integrity it checks. A browser navigation to home receives Next. An updated Vite client under a cache-first worker can take a one-time network entry and restore the clean root URL.

In the local browser rehearsal a member saved a new character, reopened the editor and visited its private character URL. The server-rendered document contained no private character name. A second account received the same API response for the foreign library item as it did for an absent ID. Help-tab anchors, browser Back and a Japanese → English → Japanese settings change were exercised. The member submitted the character for review; a fixture moderator reviewed and approved it; a verified viewer saw it; the owner withdrew it and the viewer's next visit showed it was unavailable. FastAPI requires a regional eligibility receipt even for anonymous general-audience publications. Public HTML and share metadata therefore use a generic work label throughout. The browser supplies the existing viewer credentials to FastAPI before showing the work.

The local acceptance command for these groups is `python tests/e2e_online_coexistence.py --dist .artifacts/next-migration-entry --caddy PATH_TO_CADDY --samples 3`. Build the unified artifact at that path using the Vite command above, and build the Next app against the same verified SDK. Keep `ONLINE_ASSETS=on` throughout an off → on → off route rehearsal. All five page switches default off. The fixture changes them only on its temporary loopback Caddy instances.

The remaining release work includes migrating the isolated device and migration documents, pairing and remote execution on the new UI, an installed-old-build upgrade with model data, outbox and drafts, and a versioned deployment with retained assets and cohort monitoring. Unknown HTML requests outside the current route matchers still reach WebDist. Production and physical-device acceptance remain open.

The Cloud frontend source artifact is `.artifacts/next-cloud-frontend/source.tar.gz`, SHA-256 `bcee85fd2fba040f3590f12f0c7750d4a46027b2732310276cf4a57d7663c920`. Fifty-three implementation and build inputs were byte-compared with the workspace, including every App Router source and the Caddy and browser checks.

The November 24 comparison with all five switches enabled used the same Caddy, FastAPI mock provider, official Mocha card, cold 393 × 852 Chromium profiles and network settings described above. Three-run medians were 846 → 542 ms to the character heading, 2,258 → 1,583 ms to usable input, 2,016 → 1,208 ms LCP, 321,682 → 145,819 initial script bytes and 3 → 1 completed API reads before input readiness. These are character-page lab measurements.

### Developer workflow at this increment

For a public detail page such as an author profile, the legacy implementation declares its path in App.tsx, its guest access and known segment in cloudGuest.ts, and its document fallback segment in mobile.py. Its hydrated view loads the author through the browser. Adding server-rendered sharing information to that implementation also requires a Python public_pages renderer. The Next implementation declares the page and metadata entry points together in authors/[authorId]/page.tsx. It reuses the common public-read policy and the same interactive author component used by PC.

In the current build an author-style route in an existing rollout group needs its page file, its shared view binding and its entry in `onlineRouteGroups.json`. Reuse the catalog renderer when its response shape and visibility rules fit. The shared guest policy still governs public access and login returns. Regenerate Caddy's matchers with `python scripts/sync_online_route_groups.py --write`. Next's shared page middleware applies the CSP automatically. Full coexistence review builds both frontends and runs Caddy, FastAPI and the Node service. The comparison identifies reusable rendering and delivery rules. Developer hours and deployment effort remain unmeasured.

## Device and PC acceptance

The packaged device and migration documents are prerendered by Next. WebDist serves them with their distinct isolation headers. The packager externalizes their inline boot scripts, verifies the unified worker and compressed WASM, and adds the new assets to the integrity-checked service worker inventory. The installed root tries the current online frontend when connected and opens a cached Next entry when offline. The device shell can resolve a local chat ID without consulting the server.

On local HTTPS, Chromium opened the Next pairing entry, erased an invalid and a valid fragment, completed the existing Noise handshake and PC approval, sent a turn to the mock provider on the disposable PC, and recovered the saved reply and unsent draft after a host socket disconnect and page reload. The check monitors direct Cloud chat requests and counts the recovered user message. Reproduce with `python tests/e2e_next_remote.py --dist WEB --caddy CADDY` using builds compiled for `https://relay.test`. The test maps both ends of the Relay connection to loopback.

The old Mobile worker fixture and the current Mobile exporter exercised the cross-origin popup, cancelled and confirmed import, Japanese/English switching, checksummed file export, corruption rejection and repeated import into the same Next installation. Existing data, OPFS marker and cleared drafts survived, with zero API requests, external requests or page errors. Build the exporter into a fresh directory with `pnpm --filter web exec vite build --mode mobile --outDir OUTPUT`. Run `python tests/e2e_mobile_migration.py --legacy OLD_MOBILE --mobile EXPORTER --app WEB --output FRESH_RESULTS --caddy CADDY`.

## Reproducing the release and rehearsing recovery

1. Use matching prepared SDK/WASM inputs and the exact HTTPS Relay origin in both frontend builds. Set `VITE_RELAY_ORIGIN`, build unified Vite into a fresh directory, then run `pnpm --filter online build`. Run `python scripts/prepare_cloud_bundle.py --online --web-dist UNIFIED --retain-web PRIOR_WEB --output NEW_RELEASE`. Repeat `--retain-web` for each supported release. This produces a private operator bundle with a Node service, a FastAPI distribution, a public corresponding-source archive, the worker version, the Next build ID and checksums. Keep the previous complete operator bundle, its deployed configuration and its matching source archive with the release.
2. Verify the outer checksum and the extracted `SHA256SUMS` before starting either service. From the extracted `online` directory, install the locked packages with the recorded Node version and `pnpm --filter online install --frozen-lockfile`. Set `KYALULU_PUBLIC_ORIGIN` to the canonical app origin. For local preview run `pnpm --filter online start --hostname 127.0.0.1 --port 3000` with the unified FastAPI service and the Caddy example. The browser integration command accepts `--dist EXTRACTED/web --online EXTRACTED/online/apps/online`. Only `kyalulu-source.tar.gz` belongs at the public source URL.
3. For an authorized Linux staging environment, build the FastAPI image from the extracted bundle and the Node image from its `online` subdirectory with `docker build --build-arg NODE_VERSION=RECORDED_VERSION --build-arg NEXT_BUILD_ID=RECORDED_BUILD_ID -t VERSIONED_ONLINE_IMAGE online`. Apply `deploy/cloud/compose.online.yml` alongside the existing Cloud and VPS files with versioned images. Set Caddy's `ONLINE_UPSTREAM=kyalulu-online:3000`, `ONLINE_ASSETS=on` and `ONLINE_PACKAGED_ASSETS=on` so retained chunks are available from WebDist. Verify the actual Linux image, proxy headers, optimized portrait and the effective memory limits in staging.
4. Enable the intended route groups and start with `ONLINE_COHORT=pilot`. A first HTML visit receives a secure first-party bucket cookie and opens the predecessor. Subsequent visits use the bucket for 90 days. Pilot selects one hexadecimal bucket out of sixteen. Quarter selects four. All enables each configured group for everyone. Device documents and worker updates are distribution-wide, so qualify the installed-client upgrade before publishing the new bundle. Enable `ONLINE_FALLBACK=on` only when the entry, browsing, chat and remaining page groups are all on.
5. Before expanding a wave, verify anonymous character entry, login return, successful first send, quote/credit reconciliation, error and recovery rates, asset 404s, device startup and Node memory against the baseline. Use counts, timings, status classes and opaque generation IDs for reconciliation. Agree on the observation window with the operator. Stop expansion immediately on cross-account material, missing history, double sends/charges or a send to the wrong target.
6. Rehearse route rollback by disabling the affected group and keeping the matching Node service and immutable asset union available to open tabs. Verify an active conversation, a fresh visit, browser Back and a held chunk URL. For installed-worker recovery, serve the archived matching worker and its entire integrity inventory, explicitly apply the waiting update after closing other tabs, restart offline and check conversation ownership, draft, pending sync and the committed reply. Rehearse with `python tests/e2e_next_device_upgrade.py --old OLD_WEB --new WEB --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. Keep both releases available through the observation and recovery windows.

The local acceptance Relay is a fixture origin. Build a distinct candidate with the designated staging or production origin and verify that candidate at its intended destination. Physical-device and production acceptance require their own evidence.

Prepare a companion recovery bundle from the same source revision with `python scripts/prepare_cloud_bundle.py --unified --web-dist UNIFIED --retain-web EXTRACTED_NEXT/web --output NEW_RECOVERY_DIRECTORY`. It restores the unified predecessor's worker, root and device documents and retains the candidate's immutable chunks for open tabs. Keep the Node service available for the image optimizer. Verify the release bundle using `python scripts/verify_online_release.py NEW_RELEASE --expected-sha256 OPERATOR_DIGEST --compare-worktree` and the recovery bundle and member checksums before use. Validate the combined Caddy configuration; follow the installed Caddy version's restart procedure in the VPS instructions.

### November 24 local release measurements

Next build `t_9-_rqUHvL2w_nHSkqC_` and service worker `9c1615025ecdf10e2360` use the fixture Relay. Chrome on Windows restored a verified five-shard `kyalulu-iq3m` model from a disposable OPFS profile, opened the installed root offline, generated one reply, restarted in a fresh offline process and recovered the same completed generation. The predecessor UI reopened the stored conversation after the explicit worker rollback. A separate earlier headless Chromium run produced tokens but exceeded its original 15-minute test deadline. No physical phone was involved. Chrome initially blocked the migration page's inherited manifest; the measured build omits that manifest and passes the effective CSP.

On the same 393 × 852 cold Chromium Mocha journey, the three-run medians were:

| Metric | Unified predecessor | Next |
|---|---:|---:|
| First frame with heading | 860 ms | 555 ms |
| Usable first-message input | 2,319 ms | 1,600 ms |
| LCP | 2,028 ms | 1,228 ms |
| Initial script transfer | 321,779 B | 149,061 B |
| Completed API reads to usable input | 3 | 1 |

All three Next sign-in returns completed the intended first send. From clicking the fixture identity provider, the median time to the chat URL was 1,286 ms and to the visible reply was 2,645 ms. The existing client instrumentation recorded medians of 42 ms for context, 66 ms for the quote and 129 ms from dispatch to the completed mock reply. These routes required no per-send training consent; the separate cancellation case kept the draft. Node RSS after the journeys was 123.2 MiB. Provider and identity-provider timings describe local fixtures.

The HTTPS exercise switched the same route off, on and back, checked the packaged asset delivery and the unknown-page 404, then exercised stable cookie assignment under both pilot and quarter settings. In the preceding packaged-service rehearsal the extracted Node application started after a frozen offline install of 31 packages. Docker Desktop's Linux engine was unavailable. The Node image and VPS memory envelope still need staging acceptance.

## Local handoff after sync conflict recovery

Working tree based on `4f24140`. The actual build ID is `pY0BrRpcs43lFTjkQpnXd`. The candidate and recovery records were generated from the same workspace. The full operator archives are local fixtures for `https://relay.test`.

| Artifact | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-online-verified-release/kyalulu-cloud.tar.gz` | `4d5041aa1910242b324a` | `b158a4cc9014bf3cf8a704961bd7fc6f6fc038b794bc802edb3b955b3b84f8ea` |
| `.artifacts/next-online-verified-recovery/kyalulu-cloud.tar.gz` | `29be60a01c99fc4778ff` | `aec18e5f27f0aec141c5868e56469ee0a04219600324f26c4a728daa36f33b88` |
| Public corresponding sources in both bundles | | `314ec6b73fa3e660353df2a98a8da251c9302211f728f75e411b4aae3feb8311` |

The verifier compared 635 candidate files and 383 recovery files to their manifests and compared 973 source files in each archive with the workspace. FastAPI served the verified corresponding-source bytes from its public source URL on loopback. The companion recovery rehearsal restored the unified worker and read a held Next chunk directly from the recovery server. The real offline inference check used desktop Chrome with a 393 × 852 viewport and five verified local GGUF shards in a disposable profile.

The installed-client test uncovered a conflict when a queued edit reached the server but the response was lost. The old client downloaded the new branch, then repeatedly failed to apply the returned acknowledgment because the branch ID was already present. The new client defers matching incoming forks while it settles the fixed request. It also recognizes a clean, previously received replica by its owner-scoped download record, revision, parent, fork revision and lineage. The local test preserved both histories, produced one server branch, and kept the message IDs allocated by the old client. An unrelated identity collision still fails closed.

Reproduce the two sync cases by running `tests/e2e_next_device_upgrade.py` with the old and new web directories and either `--sync-conflict pending` or `--sync-conflict previously-received`. For the companion rollback rehearsal add `--rollback RECOVERY_WEB --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. The sync fixtures use disposable real Cloud storage and simulate loss of the committed response. The focused existing branch suite also passed collision, reload, edited-source, cached-receipt and atomic two-ack scenarios.

The Compose overlays passed `docker compose config` with fixture settings. At this checkpoint the Linux containers had yet to run. Physical-phone acceptance, staging, live cohort assignment and retirement of the deployed legacy UI require their own release gates.

The final HTTPS run started the Node service from the extracted candidate after installing its frozen dependencies offline. Three cold samples per frontend on the named Mocha journey gave the following medians. Heading visibility went from 850 to 561 ms, input readiness from 2,263 to 1,593 ms, LCP from 2,012 to 1,216 ms, initial script transfer from 322,286 to 149,060 bytes and pre-input API reads from three to one. All three fixture login returns sent the intended message exactly once. Median login-click-to-chat time was 1,287 ms and login-click-to-reply time was 2,645 ms. Median context, quote and post-to-completion times were 42, 61 and 110 ms. No per-send consent wait applied to these three quotes. Node RSS after the exercise was 148.6 MiB. The ledger, route rollback, stale-tab chunk, 404, cohort and offline checks passed.

### Local developer preview measurement

The representative edit changed the sharing-title suffix on `/characters/mocha_sfw`. A link-preview request had to return the edited `og:title` and the same character's canonical URL in the HTML head. The predecessor required one edit to `runtime/python/cloud/public_pages.py`; Next required one edit to `apps/online/app/characters/[characterId]/page.tsx`. Neither path required a route or proxy change for this task.

The experiment ran on Windows against a separate copy of the verified release source. Each version had one warm-up before five timed startups, with alternating execution order and 50 ms between HTTP probes. The predecessor served its normal FastAPI HTML renderer with prebuilt Vite assets. The Next development server used webpack and an already running local FastAPI fixture. Dependency installation, stopping the previous process, and authoring time were outside the startup measurement.

| Local review operation | Predecessor | Next |
|---|---:|---:|
| Server launch to verified HTML head, median of five | 1,589 ms | 5,780 ms |
| Save to verified HTML head on a running server | Incomplete series | 720 ms median of five |

Two Uvicorn autoreload runs detected the edits and delivered their first change, but failed to serve the second change within the observation window. The data therefore supports a warm-edit figure only for Next. The slower Next startup matters when launching preview servers repeatedly. Neither timing measures human implementation effort. This experiment exercises server-rendered metadata; it does not time browser hydration or client-side React refresh. The local measurement drivers and five individual timings are in `.artifacts/next-dx-share-title/`.

## Local character-draft acceptance

Build `nFFNLvyCJlFYYlyCcM7Yy` supersedes the earlier local candidate for the character-to-chat journey. In the earlier build, a guest could enter a draft, press Enter, dismiss sign-in with Escape and see the draft. Reloading that same full-profile URL showed an empty input even though the value remained in the tab. The profile now reads and updates the existing character-and-account-scoped draft and keeps the one-use send intent separate. Cancel, edit, clear and reload require no provider request.

Chromium 151.0.7922.34 exercised Japanese and English entry at 320 and 1280 CSS pixels. All four JavaScript-disabled cases rendered the character introduction, portrait, language-appropriate navigation, canonical URL and sharing metadata without horizontal overflow. With JavaScript enabled, all four keyboard journeys reached the input and submit button using Tab and Shift+Tab, opened sign-in with Enter and dismissed it with Escape. The edited draft survived reload, clearing it survived a second reload, and values seeded under another owner or character were excluded. No mutation or external request occurred during the cancelled journeys. The before/after observations and browser driver are in `.artifacts/next-local-keyboard/`.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-character-draft-release/kyalulu-cloud.tar.gz` | `c5857f7e4df9d3230a3f` | `158bb11443261ec9022209ffc7ff2ff10049711eb48269eaec98cacd71897c2c` |
| `.artifacts/next-character-draft-recovery/kyalulu-cloud.tar.gz` | `13b48cfd3d86530c35a7` | `e670391337ae80267aaf19cace41a263072f11bf2ca55dd8e17db402501fb7ea` |

Both archives passed checksum verification against the current worktree. The verifier checked 658 release members, 406 recovery members and 973 workspace source files in each. All 1,522 uncompressed public-source members match between the two bundles. The four interactive locale/viewport cases were rerun against the extracted release using the packaged static assets and the release proxy policy.

The full local HTTPS run passed three fixture login returns with one intended first send each, account and test-ledger reconciliation, interruption recovery, publication checks, cohort switching, and route rollback. In three cold profiles per frontend, the median time to usable input was 2,269 ms on the predecessor and 1,610 ms on Next. Median LCP was 2,024 and 1,236 ms, respectively. The packaged device and recovery distributions also passed offline generation with verified GGUF shards, fresh-process history recovery and the worker rollback check. The remote-PC fixture passed pairing, one mock-provider turn, disconnection and draft recovery.

## Local Linux container acceptance

Docker Desktop Engine 29.9.2 ran build `nFFNLvyCJlFYYlyCcM7Yy` on `linux/amd64`. The input was a fresh extraction of the verified `158bb114…` release archive. The build contexts contained no host-installed Node modules or Windows native binaries. The Next image used Node 26.5.1 and the FastAPI image used the packaged Dockerfile and pinned requirements. BuildKit reported a missing default for the `NODE_VERSION` build argument; the build supplied the recorded version.

The packaged Cloud, VPS and online Compose definitions ran with an ephemeral project, synthetic Cloud data and internal application networks. Only Caddy 2.10.2 published a host port, bound to loopback. Node trusted the project-local CA and Chromium pinned the test leaf public key. The authenticated checks used a seeded session.

| Check | Observed result |
|---|---|
| Public entry | The character heading, canonical link and optimized portrait appeared. Keyboard sign-in cancellation and reload preserved the draft. |
| Authenticated Cloud | The disposable account opened the Next chat list and composer. Its unsent draft survived reload. External OAuth and model generation were outside this container run. |
| Dedicated documents and source | Device and migration headers matched their isolation policies. The public source archive matched its expected SHA-256. |
| Rollback | Recreating Caddy with the page switches off reopened the legacy chat with the same draft. The held Next chunk remained available. |
| Runtime | Both application containers ran as non-root with read-only root filesystems. Cgroup memory peaks during this single-browser run were 118.6 MiB for Next and 81.7 MiB for FastAPI. Neither was OOM-killed. |

The initial internal-only proxy network supported container health checks but refused the Windows browser connection. Giving only Caddy a separate ingress network with a loopback-bound port provided the tested topology. The fixture removed its containers, networks and volumes and verified cleanup by project label. Docker Desktop and the local images were retained.

The clean build contexts, driver and results are under `.artifacts/next-linux-acceptance/`. Build the `package/online` context with `--build-arg NODE_VERSION=26.5.1 -t kyalulu-online-local:nffnlvycjl` and the `package` context with `-t kyalulu-cloud-local:nffnlvycjl`. Run `python .artifacts/next-linux-acceptance/accept.py` with Caddy 2.10.2 and the installed Playwright Chromium. Physical devices, staging capacity, production rollout and the observation window remain open.

## Local progressive rollout rehearsal

The production procedure now uses `deploy/cloud/compose.online-proxy.yml` to pass the route switches and cohort to Caddy in the existing Relay project. The overlay resolves with both repository Relay Compose bases. It defaults to the pilot cohort with every page switch off. The operator commands and recovery procedure are in [Canonical app delivery and cutover](../UNIFIED_DEPLOYMENT.md#rolling-out-the-nextjs-frontend).

The two bundles below supersede the earlier local artifacts. The release reuses Next build `nFFNLvyCJlFYYlyCcM7Yy` from the character-draft and Linux runs. Its prior manifest differs only in the new Compose overlay, the corresponding-source archive, and removal of the generated comment in `requirements.txt` that included a local path. All dependency pins and hashes match. Both archives include the overlay and the same 1,523 corresponding-source members by content.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-rollout-release-v2/kyalulu-cloud.tar.gz` | `c5857f7e4df9d3230a3f` | `a41ab153f67989e6ac90a7c027bf475e0893a1b0659a5e818e19e27b425fe302` |
| `.artifacts/next-rollout-recovery-v2/kyalulu-cloud.tar.gz` | `13b48cfd3d86530c35a7` | `d6712137b8515703452839208d03f67038be7d4edfd919fa46d5f35119a52100` |

The verifier checked 659 release members, 407 recovery members and 974 current workspace source files in each. Both are loopback candidates compiled for `https://relay.test`.

The final Docker Desktop run built both images from the verified release. An isolated Caddy 2.10.2 project applied the packaged overlay. Each wave validated the effective configuration with a one-off Caddy container and recreated only Caddy. The first wave put Mocha on Next for the pilot bucket and kept chat on the predecessor. With the page groups enabled, the pilot and quarter waves enrolled fresh visitors on the predecessor and kept their responses private. The expected buckets received Next, and API delivery flags agreed with the frontend. The all wave served the Next character route for every tested bucket and fresh visits. The worker hash matched throughout the waves.

Chromium checked public SSR, the image optimizer, keyboard draft recovery and an authenticated test composer. Turning the page switches off reopened the predecessor with the same draft and retained the held Next script. Next and FastAPI kept the same container IDs across the waves. The run used an isolated data store with a seeded session. Relay socket recovery and external OAuth during a wave still need destination testing.

The final run recorded cgroup peaks of 128.0 MiB for Next and 86.8 MiB for FastAPI. The preceding rollout rehearsal recorded 346.1 MiB and 154.5 MiB. These samples cover one local browser and repeated proxy switches. Capacity with the full staging service set and its concurrent traffic remains to be measured.

The driver and results are in `.artifacts/next-rollout-linux-v2/`. Build its verified `package/online` and `package` contexts with the tags `kyalulu-online-local:rollout-v2` and `kyalulu-cloud-local:rollout-v2` and `--build-arg NODE_VERSION=26.5.1` for Next. Then run `python .artifacts/next-rollout-linux-v2/accept.py`. The run removed its temporary Compose resources and retained the local images. The next environment-specific checks are physical-device PWA acceptance and staging capacity, real authentication and Relay recovery. Public rollout and retirement of the old UI remain pending.

## Local canonical-origin rehearsal

Built the unified Vite fallback and Next `fQMb6dMUcfCF3qYA29JmP` with `VITE_RELAY_ORIGIN=https://relay.kyalulu.com`. The unified worker records the build origin. Package creation and verification compare it with the Next build manifest and the selected destination. Both commands rejected `--expected-relay-origin https://relay.test` for this build. Five focused tests cover matching builds, mixed builds, older workers without origin metadata, and recovery origin validation. The emitted Next, Vite and recovery scripts also contain the intended Relay origin.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-canonical-release-checked/kyalulu-cloud.tar.gz` | `341a20a07ee17cd9f028` | `465e7b7bf5e8cfd736ff6f085522d801d458ae88471137565a8516ec25c22dbe` |
| `.artifacts/next-canonical-recovery-checked/kyalulu-cloud.tar.gz` | `c628dae69c789ffec8e3` | `9fd0bb196bb0e432d9c473dcb74d5d5fc2b321c3f9a461ff9e6dee377a545848` |

Both archives passed exact checksum and origin verification against the current worktree. They share 1,524 corresponding-source members by content. The companion recovery bundle retains the candidate's hashed chunks. Before scheduling a destination rollout, obtain the deployed release inventory with the operator and retain the required assets from its supported predecessors. The rehearsal uses a newly built matching Vite fallback.

`tests/e2e_next_remote.py --relay-origin https://relay.kyalulu.com --dist .artifacts/next-canonical-linux/package/web --caddy CADDY` mapped the Relay hostname to loopback and blocked other browser destinations. The local Relay and disposable PC exercised the Noise handshake, host approval, one mock-provider reply, socket loss, reconnection and recovery of the reply and draft. The checked release and recovery bundles have the same Web files byte for byte as the versions exercised in the Relay and PWA runs.

The installed-PWA rehearsal started from `.artifacts/next-canonical-unified`, applied the candidate worker, reopened the same device conversation from the installed root after an offline browser restart, and applied the archived recovery worker. The conversation, draft at update, saved outbox and held chunk checks passed. This run used Chromium and fixture data. The real GGUF proof remains the earlier device rehearsal.

The first Linux build reused the preceding release's Next build ID and referenced its obsolete hydration chunks. Both archives had given the same-size build ID file a 1970 timestamp. The packager now keeps file modification times. The Next Dockerfile requires the verified build ID as `NEXT_BUILD_ID`. The corrected Docker build accepted `fQMb6dMUcfCF3qYA29JmP` and rejected the preceding ID.

The final Linux run used the canonical app and Relay names with an isolated proxy and the app hostname mapped to loopback. The in-container Next and FastAPI files matched the bundle manifest by SHA-256. Caddy served every script requested by the initial character HTML. Pilot, quarter and all delivery checks passed. The browser completed keyboard draft recovery, authenticated test conversation access and route rollback, with the draft and held chunk intact. The run removed its temporary containers, networks and volumes. The driver and JSON results are in `.artifacts/next-canonical-linux-checked/`.

This closes local verification of the selected build identity, app origin and Relay configuration. The destination's deployed predecessor inventory, full staging capacity, real OAuth and physical-device PWA acceptance remain open before a live rollout.

## Shared route declarations and candidate

`onlineRouteGroups.json` now supplies the route selection for browser navigation and the generated Caddy page matchers. To add an online page, create its Next App Router page, add its rollout path once in the shared list and run `python scripts/sync_online_route_groups.py --write`. The build check compares the list with both the source pages and the built Next manifest. It detects missing or obsolete routes, overlapping groups and stale Caddy matchers. Adding a shared screen still requires implementing the view for its intended runtimes. This change reduces hand-edited rollout declarations and adds an automated parity check.

Build `zEv5LQV31RifLBCmbdyzV` uses the canonical Relay origin. Both archives passed SHA-256 and origin verification, and their 1,527 corresponding-source members match. The release and recovery retain immutable assets from the preceding local candidate. The recovery also retains the new candidate's chunks.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-route-groups-release/kyalulu-cloud.tar.gz` | `2e621c128f4dbfa5c719` | `b2bdf574d09ad15d81b151ad9090ab70847eb91d8d541753e4606eeeb9f52653` |
| `.artifacts/next-route-groups-recovery/kyalulu-cloud.tar.gz` | `2c1cf7c3420539c85846` | `e0c867cf974ddbf729670b6b5fb7915b0596193ce9de3b114ef5425602b99cf5` |

Eight focused source tests passed. On loopback Linux, each rollout group was enabled alone and all 20 route patterns were requested with concrete paths, for 80 group and route combinations. Each route received Next only under its own switch. The test also confirmed SHA-256 of the built application files, prior-JavaScript retention, dedicated document headers, authenticated test chat and rollback. The driver and results are in `.artifacts/next-route-groups-linux/`.

The browser suite verified the guest and member pages, private and withdrawn publications, fixture login, first send, cancellation, generation recovery, credit ledger and offline restart. The installed Chromium PWA also updated from the Vite fallback and recovered through the companion worker with the conversation and outbox intact. Production authorization, the deployed predecessor inventory, target staging and physical-device acceptance remain pending.

## Active Cloud generation during a route switch

`tests/e2e_online_active_rollout.py` pauses a mock model response after FastAPI admits a generation and the browser receives the SSE headers. It restarts the actual local Caddy process while that generation remains pending. The same FastAPI process and data store run through the switch. The browser observes the failed stream request without resubmitting the generation.

The first rehearsal reproduced a stale failed-send alert after the existing Next tab recovered the saved reply. The app now clears that send's error when it confirms a completed response for the same generation ID in persisted history. Failure and cancellation keep their recovery behavior.

In the passing rehearsal, the Next tab stayed open through rollback and recovered its reply without reloading. For the reverse switch, the predecessor tab reloaded into Next with its send still pending and recovered after the mock model finished. Both retained the same conversation URL and displayed one copy of each user message and reply. SQLite confirmed the exact message IDs. There were three browser POSTs, three model calls and three settled credit operations including the initial conversation start. The balances matched the ledger and both hold tables were empty. An already-referenced Next chunk remained retrievable after the switches.

Build `XvbqWfM5dAXSeagNyeRuf` uses the canonical Relay origin. The release and recovery archives passed SHA-256 and origin verification. Their 1,528 corresponding-source members match.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-active-rollout-release/kyalulu-cloud.tar.gz` | `acd55469af2006efd53c` | `fc6994cc820cc3a18a63b2864e14b1a500b552789d0bedb34d21de101ada6659` |
| `.artifacts/next-active-rollout-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `7c1f7bae597d5f3ddb3ecfc84aefb129d86f6c73e93fb238fc1c98c54af14f07` |

Run `python tests/e2e_online_active_rollout.py --dist .artifacts/next-active-rollout-check/package/web --caddy CADDY` from the verified workspace with its matching Next build. The browser result is `.artifacts/next-active-rollout-check/browser-results.txt`. This evidence covers a loopback proxy switch with a disposable Cloud account and a mock provider. The destination's running predecessor, real OAuth, capacity and physical-device behavior remain to be verified.

The Web typecheck and all 19 recovery tests passed. The full loopback browser suite passed consent cancellation, generation recovery, regeneration, branch, deletion and rollback. The installed Chromium PWA passed update, offline restart and worker recovery. Docker Desktop ran both candidate images on `linux/amd64` and checked file hashes, hydration, staged delivery and rollback. Its results are in `.artifacts/next-active-rollout-check/results.json`.

## Active remote PC generation during a route switch

The remote browser fixture now routes both TLS WebSockets through the same local Caddy process. It uses the repository's Relay site configuration, the real local Relay implementation, a disposable Host and a paused mock model. Chromium and the Host resolve the fixture through loopback. The test starts the user-facing Next flow by pairing and approving the browser on the PC.

With a generation pending in the PC database, the test restarts Caddy and switches chat delivery to the predecessor. Both sockets disconnect. The existing browser tab reconnects to the same approved device and resumes the original RPC while the PC is still holding the same generation. For the reverse switch the test reloads the conversation into Next before releasing the paused model. Next retrieves the pending generation and recovers the reply. Both switches preserve the conversation URL and the unsent draft written before the final reload. The PC receives exactly two generation submissions for these two switches. Its database contains one matching user record and one matching reply for each generation, and the browser makes zero direct requests to the Cloud chat API.

The new archives include the reproducible fixture and Relay site source. Member checksums differ from the preceding pair only for `kyalulu-source.tar.gz`. Build `XvbqWfM5dAXSeagNyeRuf` and the worker files therefore match the preceding Linux and PWA rehearsal. Both archives passed SHA-256 and Relay-origin verification and share the same 1,529 corresponding-source members.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-remote-rollout-release/kyalulu-cloud.tar.gz` | `acd55469af2006efd53c` | `ee88d98ee793c9ef76db298e89ac05fa2b0394a9e4e86ba8b8334ee258230884` |
| `.artifacts/next-remote-rollout-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `bb3d370dbe9fdc3daa120136aacbb909406cb7fe330da7e752d39c7ca6d06595` |

Run `python tests/e2e_next_remote.py --dist .artifacts/next-remote-rollout-check/package/web --caddy CADDY --relay-origin https://relay.kyalulu.com`. The browser result is `.artifacts/next-remote-rollout-check/browser-results.txt`. The bridge, route-group and release-portability suites also passed 65 tests. A real Relay and physical-client rehearsal requires the designated environment and devices.

## HTTPS checks for a rollout wave

The release and recovery bundles ship `scripts/probe_online_rollout.py`. Its anonymous HTTPS checks record the observed frontend on representative routes for every cohort, verify the API delivery flags and cache policy, and compare current JavaScript, held chunks and the active worker with the selected bundle manifest. The operator can also check Relay health and the corresponding-source download. Discrepancies produce a JSON failure report and a nonzero exit code. The signed-in browser and ledger rehearsals remain separate checks. The rollout procedure shows how to pass the active switches to the probe. [Rollout procedure](../UNIFIED_DEPLOYMENT.md#rolling-out-the-nextjs-frontend)

The exact bundled script ran against local Caddy, Next, FastAPI and Relay. It passed 39 HTTPS requests in the character-only pilot, 42 in the quarter wave, 42 at full delivery and 33 after restoring the recovery bundle. The negative run asked the probe to verify the quarter wave while Caddy served the full wave. It reported the mismatch and exited with code 1. The rollback used the recovery worker and checked a held chunk from Next. Thirteen focused source tests passed, including wrong-worker, stale-chunk and wrong-cohort cases. Reproduce the loopback run with `python .artifacts/next-monitor-check/rehearse.py`. The per-request reports are in `.artifacts/next-monitor-check/results.json`.

The two archives contain the same application and worker bytes as the preceding rehearsal and add the monitoring script and its corresponding source. They share the same 1,531 corresponding-source members. Both passed checksum and Relay-origin verification.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-monitor-release/kyalulu-cloud.tar.gz` | `acd55469af2006efd53c` | `2d3b83eafbba4b48cfca3ee28ffac3218746154585971bac24a37de1aa3623a3` |
| `.artifacts/next-monitor-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `eb655ee97e90134a59d1383968e2d0d10467704179b6d3bf53b4e461322ffa0e` |

The destination's old asset inventory, real authentication, capacity, physical-device acceptance and the authorized rollout observation period remain open.

## Local capacity rehearsal with Relay connected

Build `XvbqWfM5dAXSeagNyeRuf` from the verified monitor bundle ran alongside FastAPI, Caddy 2.10.2 and the Relay image built from `deploy/remote/Dockerfile`. Docker Desktop 29.9.2 ran Linux cgroup v2. The four containers shared logical CPUs 0 and 1. CPU quotas summed to two CPUs. The per-service RAM ceilings were 288 MiB for Next, 288 MiB for FastAPI, 96 MiB for Caddy and 96 MiB for Relay, with container swap disabled. This selects a 768 MiB application envelope using the repository's historical 960 MiB VPS measurement as a reference. The production hosts' operating system, other services and network require their own measurements.

Both frontends used the same stack and verified bundle. The Vite cases kept Next available for the coexistence period. Each case warmed the server once, then opened fresh Chromium 151.0.7922.34 profiles at 393 × 852 CSS pixels and DPR 2, with 80 ms emulated latency, 2 Mbps down and 750 kbps up. Each profile opened Mocha, typed into the composer and opened the login sheet. This workload exercises anonymous entry through the login draft. Two authenticated fixture Host WebSockets received pings through Relay and Caddy in each batch.

| Concurrent browser profiles | Legacy median usable input | Next median usable input | Legacy median LCP | Next median LCP | Highest sampled stack memory, legacy / Next |
|---|---:|---:|---:|---:|---:|
| 1 | 5,323 ms | 2,645 ms | 5,096 ms | 952 ms | 482.38 / 483.14 MiB |
| 4 | 5,465.5 ms | 2,657 ms | 5,208 ms | 908 ms | 474.68 / 478.50 MiB |
| 8 | 5,436.5 ms | 2,640.5 ms | 5,170 ms | 934 ms | 481.57 / 491.18 MiB |

All 26 measured browser journeys passed. The Relay connections stayed up and its health check passed after each batch. Cgroup samples include file cache. OOM counters, OOM-kill counters and unexpected restarts stayed at zero. The maximum Relay ping observed in the first run was 2,116.74 ms during the eight-profile Next batch.

The follow-up ran eight profiles twice per frontend in Next, Vite, Vite, Next order. It took cgroup snapshots at batch boundaries and measured the two sockets concurrently every 500 ms while the browsers worked. All 32 journeys passed. The two Next input medians were 2,717 and 2,708.5 ms. The Vite medians were 5,485 and 5,385.5 ms. Per-batch median Relay ping ranged from 1.30 to 1.50 ms. The largest follow-up values were 337.51 ms for Next and 909.93 ms for Vite. This leaves the first run's 2,116.74 ms sample unexplained. The Relay latency distribution requires a longer destination measurement.

The driver and raw results are under `.artifacts/next-stack-capacity/`. Build the verified monitor bundle's FastAPI and Next contexts with the tags `kyalulu-cloud-local:capacity` and `kyalulu-online-local:capacity`, with `NODE_VERSION=26.5.1` and `NEXT_BUILD_ID=XvbqWfM5dAXSeagNyeRuf` for Next. Build `kyalulu-relay-local:capacity` with `deploy/remote/Dockerfile`. Run `python .artifacts/next-stack-capacity/run.py` for the six batches and add `--relay-repeat` for the four follow-up batches. Both runs removed the temporary Compose projects. Use the release and recovery hashes in “HTTPS checks for a rollout wave” for this rehearsal. Physical devices, authenticated traffic, model traffic and capacity on the authorized staging host remain to be tested there.

## Local capacity rehearsal through an authenticated Cloud reply

The follow-up uses the same build, CPU and memory limits, Relay connections, emulated mobile Chromium profiles and network shaping. Each cold browser profile receives a distinct disposable session with 500 test credits, the current provider agreement and general eligibility. At each concurrency level the browsers open Mocha together, fill the first-message field and submit after all inputs are ready. The FastAPI container uses the release code and a read-only fixture factory. Its `httpx.MockTransport` returns a deterministic OpenRouter response after 120 ms and can revalidate seeded sessions against a mock Supabase user endpoint. Cloud and Next run on internal Docker networks. Browser traffic resolves only through the loopback proxy and the fixture uses synthetic identities. This run starts with established sessions. Interactive OAuth, a live model, installed service workers and the destination host require their own measurements.

The verification requires exactly one quote, generation POST, mock model call and completed settlement for each intended first message. It checks the generation ID and saved message IDs against the owner's SQLite history, reloads the reply and reconciles the exact charge and resulting balance. The eight-profile cases also check that another account receives a `not_found` status for each generation. Credit and operator fund holds must be empty. Timings use the browser automation's time to usable input and visible reply and the app's own quote and SSE timing. The same cases check the two Relay sockets and sample all four cgroups while requests run.

With the packaged Cloud `pids_limit: 64`, one authenticated profile completed on each frontend. A focused eight-profile Next batch reproduced a `503` from `PUT /api/chat/settings` before the affected browser issued a quote or generation POST. The FastAPI cgroup registered 21 refused task creations by the diagnostic snapshot, with zero memory-limit events, OOMs or OOM kills. Increasing the task limit to 128 eliminated task-creation refusals in the observed trials with the same CPU and memory budgets.

One eight-profile trial on each frontend passed every check at `pids_limit: 128`. In total, 16 browser sends produced 16 saved replies and 16 credit settlements of one credit each, with no outstanding holds. No container went OOM or restarted, and the temporary Compose projects and volumes were removed. A separate Next run at 128 returned seven model calls for eight attempted sends. The remaining browser showed a failed-send alert after its quote and POST. The setting change addresses the observed task-limit failure. The intermittent send failure and completion latency remain relevant to cutover acceptance.

| Eight profiles, one completed batch per frontend | Vite | Next |
|---|---:|---:|
| Median time to usable input | 10,864 ms | 3,318 ms |
| Median click to visible reply | 7,375 ms | 19,341 ms |
| Median quote request duration | 781 ms | 725 ms |
| Median generation POST to full reply event | 1,333 ms | 1,475 ms |
| FastAPI peak task count | 50 | 82 |
| Highest sampled total memory | 208.81 MiB | 249.98 MiB |
| Maximum Relay ping observed | 912.52 ms | 307.17 ms |

The post-click delay in the successful Next batch exceeds the difference in quote or SSE timing. These one-batch medians describe the observed run in each mode. Repeated testing needs to account for the extra browser navigation between the public character page and the shared interactive runtime, along with possible blocking in the shared control database.

The test driver and aggregate results are under `.artifacts/next-stack-capacity/`. Use `python .artifacts/next-stack-capacity/authenticated.py --diagnose next --pids-limit 128` and the corresponding `--diagnose legacy` for the eight-profile cases. The original Next failure can be probed at `--pids-limit 64`. Use the repository virtual environment and its installed Chromium. The driver uses the four local images from the anonymous capacity rehearsal.

The candidate and recovery were rebuilt with `pids_limit: 128` in `deploy/cloud/compose.yml`. Compared with the previous monitoring bundles, the packaged Compose definition and corresponding-source archive are the two changed manifest entries in each bundle. The Next build ID and all worker and frontend asset bytes are identical to the previous candidates. Both packages passed full archive checksum, exact Relay origin and 982-file worktree verification.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-capacity-release/kyalulu-cloud.tar.gz` | `acd55469af2006efd53c` | `ee24fa56be007fdd1ff17611ebc6d10f146c2c6fadf159c2fafc5571f683fcc0` |
| `.artifacts/next-capacity-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `e25d715f29c5e45c5d9b7f071f9b1385479c67651bee0fc41c992fe4d991a01b` |

## Shared SQLite contention during signed-in sends

A follow-up on the task-limit-only build reproduced a timeout in the Vite batch after the Next batch completed. Seven Vite generations were pending when diagnostics ran. Two synchronous control database transactions reported `SQLITE_BUSY` after 15,077 and 15,058 ms. The cgroup had zero task rejections and zero OOMs. This demonstrates a failure in the backend both frontends use. The separate Next timeout observed earlier did not record a durable error code.

Saving a reply and permanently deleting a conversation attach the shared control database to an account's conversation database. A synchronous control-plane request can wait on the attached write while the main event loop needs to advance its commit. The Cloud callers now finish these attached transactions on a worker event loop. They retain the account's lock until the transaction reaches a durable outcome, including repeated cancellation requests. The synchronous connection closes on all outcomes, including failure to begin its transaction.

Seven focused tests passed, including the regression that holds an attached write open while a synchronous control write waits and the original caller is cancelled twice. The 56 Cloud parity and guest tests passed. The Windows browser test rebuilt its loopback Caddy routes in both directions while generation was pending. Its setup and two switches produced three browser POSTs, three mock model calls, three settled operations and zero outstanding holds. The original conversation recovered in both directions.

The rebuilt Linux FastAPI image is `kyalulu-cloud-local:capacity-concurrency`. Both archives passed the full checksum, exact Relay origin and corresponding-source verification against 982 worktree files. The Next build ID and worker identities match the earlier rehearsals. Use these archives together for the current candidate.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-concurrency-release/kyalulu-cloud.tar.gz` | `acd55469af2006efd53c` | `a57710117b1f46556eb48abe6aa63c6355cc2ed1f891d5584a8892fd83361bcb` |
| `.artifacts/next-concurrency-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `d556265a2db4c4aa84114231910f4e440a05cf0a82e44fa54957793b5f05d044` |

Using that Linux image and the packaged Compose settings, two batches per frontend ran in Next, Vite, Vite, Next order. Each batch started eight signed-in profiles. All 32 intended messages produced one quote, one browser POST, one mock model call, one reply that survived reload, and one credit settlement. Cross-account status checks returned no message IDs. There were zero outstanding holds, task-creation refusals, SQLite errors, OOMs, and unexpected container restarts. Two successful control transactions waited 331 and 430 ms. The peak FastAPI task count was 87 and the highest sampled total memory was 271.06 MiB. The two Relay sockets stayed usable in the completed run. The maximum recorded ping was 930.37 ms. A preceding attempt had one 5-second Relay probe timeout and was aborted before sending by the monitor. The driver now records ping errors independently of the browser workload.

| Median across 16 completed profiles per frontend | Vite | Next |
|---|---:|---:|
| Navigation to filled input | 8,091 ms | 3,227 ms |
| Submit to chat URL | 1,168 ms | 9,261 ms |
| Submit to quote request | 5,201 ms | 17,708 ms |
| Quote request duration | 1,024 ms | 632 ms |
| Generation POST to full reply event | 2,082 ms | 1,463 ms |
| Submit to visible reply | 8,556 ms | 19,882 ms |
| Sum of input and submit phases, excluding the synchronization pause | 16,887 ms | 23,145 ms |

The additional delay was already present when Next reached the chat URL and before the quote request. The browser trace observed the one-time character handoff navigation in a median of 160 ms after the click. This series used Playwright routing to enforce loopback. Routing disables the browser HTTP cache, including reuse across document navigations. The table describes that condition. For this packaged build, run `python .artifacts/next-stack-capacity/authenticated.py --trace-pair` using the project venv, the installed Playwright Chromium and the four local images. The aggregate data is `.artifacts/next-stack-capacity/authenticated-concurrency-pair.json`.

A separate eight-profile batch per frontend kept Chromium's normal HTTP cache and confined all connection attempts to loopback through browser proxy and resolver settings. All 16 sends passed. The medians for usable input, visible reply after submit, and the sum of the two phases were 8,014, 5,746 and 13,755 ms for Vite and 3,201, 19,494 and 22,464 ms for Next. Each profile reused one resource from the HTTP cache. This preserved the slowdown with the normal browser cache setting. The raw results are `.artifacts/next-stack-capacity/authenticated-cached-pair.json`. In the verified delivery path, FastAPI serves the packaged Next static files and applied `no-store, no-transform` to those files as well as HTML.

## Reuse of packaged Next.js assets during conversation entry

FastAPI now gives successful responses for content-hashed JavaScript and CSS under `/_next/static/chunks/` and `/_next/static/css/` a private, immutable browser cache policy. Packaging checks retained filenames and rejects conflicting bytes. HTML, mutable asset names, missing files, the service worker script and API responses retain their non-cacheable policies. Packaged Next static requests also skip the public HTML renderer. The 40 Cloud guest and rollout-probe tests passed, including conditional asset reads and no-store for missing files, HTML, the worker script and Cloud status. Windows loopback Caddy interruption and recovery passed again with three browser sends, mock model calls and settlements, and zero holds.

The packaged Linux FastAPI image is `kyalulu-cloud-local:capacity-cache`. These two archives are the current release and recovery pair. Their Next build and worker identities match the original rollout rehearsal, and both archives passed full checksum and worktree source verification. Use the compatible recovery package together with the route switches in the deployment runbook.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-cache-release/kyalulu-cloud.tar.gz` | `acd55469af2006efd53c` | `a09d7234cb0be9aebb5ea7d152de089e38d492db5e02bc504f6acdc68eeb4067` |
| `.artifacts/next-cache-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `6a10ed05fa03e420eb42bd8cb446d01fb43e1660122d2f8eb06c632e8c963764` |

The latest eight-profile batch per frontend used the same normal browser cache and network conditions as the previous comparison. All 16 attempted sends passed, with 16 verified saved replies, mock generations and settlements, and zero outstanding holds. No task creation was rejected. SQLite contention errors, OOMs and unexpected container restarts stayed at zero. Both Relay sockets responded throughout the measured batches. Peak sampled total memory was 286.65 MiB and the maximum observed Relay ping was 910.77 ms. The temporary projects were removed.

| Median across eight completed profiles per frontend | Vite | Next |
|---|---:|---:|
| Navigation to filled input | 7,583 ms | 1,750 ms |
| Submit to chat URL | 1,067 ms | 4,559 ms |
| Submit to visible reply | 5,819 ms | 9,745 ms |
| Sum of input and submit phases, excluding the synchronization pause | 13,643 ms | 11,444 ms |
| Resources served from the browser HTTP cache | 1 | 30 |

The measured journey sum was 16% shorter on Next than on Vite, and Next's submit-to-reply time fell from 19,494 ms in the preceding test to 9,745 ms. The click-to-chat transition and time after submit still took longer on Next than on Vite in the latest batch. These are local cold-profile results for a fixed mock model and one official character. Reproduce with `python .artifacts/next-stack-capacity/authenticated.py --trace-pair --cached-client --cache-candidate`. The detailed phase data is `.artifacts/next-stack-capacity/authenticated-immutable-assets.json`. The next environment-specific checks need the deployed predecessor inventory, an authorized staging host, real identity and model integrations, physical PWA devices, and an approved rollout observation period.

## Signed-in character handoff within the Next.js document

The public character composer checks the signed-in owner and current browse delivery together before transferring the first message. When the full browse group is assigned to Next, the composer opens the interactive character screen through the App Router with the same one-time, owner-bound reference. The character-only switch continues to use a document navigation so the assigned legacy screen can consume that reference. Guest sign-in continues through the existing document and callback flow. The interactive character screen remains responsible for creating the conversation, then passes the queued send to chat.

The Windows Caddy and Chromium coexistence run observed a React Server Component response for the signed-in handoff and zero document requests for that step. After a reload, the completed first message still had exactly one browser POST and one stored user row. The ledger matched all six completed sends in the suite. The run also passed its three fixture login returns, chat interruption recovery, publication visibility, cross-account isolation and Vite rollback. A separate installed-PWA fixture upgraded from the earlier unified build to this candidate, reopened the device chat offline, and applied the companion recovery with the same outbox and a retained Next chunk.

The current bundle pair uses Next build `k2uvbNTCjyTJBiFY1wkvC`. Both archives passed checksum, exact Relay origin and worktree source verification against 982 files. The release retained the preceding worker fixture `acd55469af2006efd53c` and two earlier worker fixtures. The recovery also retains the new worker's immutable files for already-open tabs.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-handoff-current/kyalulu-cloud.tar.gz` | `8c6158518e9dee9fb327` | `05d879c797a647da15e1e464fe525a73475955f4d6b669d9caac4255590957ea` |
| `.artifacts/next-handoff-current-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `5d3897d79ffade4fd8f47918264da3ba66566f0bb3ae2c3225b612d4a190f4aa` |

The initial Linux test passed 17 sends with exact persisted history and settlement. All eight full Next profiles used a component request for the handoff. The character-only case entered on Next, made one document handoff, and completed on Vite. The Next and Vite medians for submit to visible reply were 13.71 and 7.71 s, respectively. The sum of the input and submit phases was 15.51 and 15.53 s. Two Relay probes timed out during the Next batch, and the earlier immutable-cache candidate's measurements came from a different run. These comparisons did not establish a speed improvement for the new transition. The recorded phases, request types and service measurements are in `.artifacts/next-stack-capacity/authenticated-handoff.json`.

The controlled comparison held the build, Caddy routes, browser cache and resource limits constant. The fixture changed the browse-delivery header only to select the document branch or the App Router branch in the composer. Each eight-profile batch used a fresh set of test accounts. The order was document, App Router, App Router, document. The trace verified the requested transition type for every profile and confirmed that every chat finished on Next.

| Median across 16 completed profiles per transition | Document reload | App Router |
|---|---:|---:|
| Submit to chat URL | 5.52 s | 4.62 s |
| Submit to quote request | 8.33 s | 7.63 s |
| Submit to visible first reply | 10.12 s | 10.15 s |
| Sum of input and submit phases, excluding the synchronization pause | 11.91 s | 11.88 s |

The candidate retains the App Router handoff for the removal of one document load and earlier arrival at the chat URL. This comparison does not establish a first-reply speed gain. All 32 sends had exactly one generation, persisted reply and settlement. There were zero outstanding holds, SQLite contention errors, task-creation refusals, OOMs and unexpected restarts. The controlled run had zero Relay probe timeouts. Its maximum observed Relay ping was 4.53 s. Peak sampled total memory reached 322.06 MiB, and cleanup removed the disposable Compose project. Run `python .artifacts/next-stack-capacity/authenticated.py --trace-pair --cached-client --handoff-candidate --compare-handoffs` to reproduce. The data is `.artifacts/next-stack-capacity/authenticated-handoff-ab.json`.

## Reuse of initialized Cloud conversation databases

The chat document's eight-profile trace showed the final chat-specific JS chunk completing about 0.85 s from navigation, while the quote request started about 3.47 s from navigation. The remaining application requests included status, history, settings and stored context. The hosted request boundary already initialized the owner's database, and the individual storage helpers called the schema initializer again. Each call executed the table declarations and checked every column migration.

The hosted boundary now records the SQLite file's device and inode after successful initialization and interrupted-job recovery under the owner's lock. It passes that identity in the existing request storage context. A storage helper can reuse the successful initialization while the identity matches. Backup restore discards the record, migrates the restored file under the owner's lock and records the new identity after success. Missing or replaced files still run migrations, and an unavailable inode leaves helper-level migrations enabled. Local storage callers have no hosted initialization identity. The generation request, quote inputs and billing rules use the same existing paths.

The 58 Cloud parity and guest tests and seven focused accounting and cancellation checks passed. The Cloud parity suite verifies warm reuse, file replacement, migration of restored older backups and recovery after a failed restore migration. The Windows active-rollout regression switched both ways while generation was pending. Setup and recovery reconciled three POSTs, three provider calls, three settled operations and no holds. The production frontend build and worker IDs match the preceding milestone.

| Local operator bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-schema-release/kyalulu-cloud.tar.gz` | `8c6158518e9dee9fb327` | `39d7f9cbccc6eaf2a040e9426ab4475c4fa361e00fb76d775025a7317a5f2a65` |
| `.artifacts/next-schema-recovery/kyalulu-cloud.tar.gz` | `0d94b2b00435628aa0de` | `5d235effaf716b268130654a0f192d24528eec40074de45aaea2d8c8bfaee5e6` |

Docker rehearsed the previous Cloud image and the new one in old–new and new–old order. Each batch used eight fresh signed-in Chromium profiles, the same Next.js build, the normal browser HTTP cache, identical network limits and the deterministic model fixture. The matching release manifests differ in three hosted Python files and their corresponding source archive. For each completed batch, the fixture counted calls to the actual SQLite schema script before the browser-reload verification. The count fell from 336 and 338 in the two old-image runs to eight in each new-image run.

| Median across 16 complete profiles per Cloud image | Previous image | Schema reuse |
|---|---:|---:|
| Chat URL to quote request | 3.10 s | 2.08 s |
| Submit to visible first reply | 9.52 s | 7.87 s |
| Sum of input and submit phases, excluding the synchronization pause | 11.29 s | 9.77 s |

Submit-to-reply medians were 9.56 and 9.49 s on the previous image and 7.62 and 8.14 s on the new image. All 32 sends produced one persisted reply, one mock model call and one settlement each. The four completed batches had zero lost credits, outstanding holds, SQLite contention errors, task-limit refusals, OOMs, restarts or Relay timeouts. A preceding reverse-order attempt stopped because the resource monitor could not read one Docker cgroup. The fixture now records failed intermediate resource reads and requires a final cgroup read. The completed repeat recorded zero sampling faults.

Reproduce with `python .artifacts/next-stack-capacity/authenticated.py --trace-pair --cached-client --handoff-candidate --profile-chat`. Add `--schema-candidate` to select the new image, and `--profile-repeat` to record the reverse order separately. The sanitized timing and reconciliation data is in `authenticated-chat-bootstrap-{baseline,schema}[-repeat].json` under `.artifacts/next-stack-capacity/`. Resource traces include only static asset paths and fixed API endpoint labels. The current bundles passed checksum, exact Relay origin and 982-file worktree source verification. Staging with real integrations, physical-device PWA acceptance, staged rollout and retirement of the legacy online UI remain outstanding.

## Chat startup request reduction

In the working tree based on `4f24140`, the shared chat page starts loading history and settings before the catalog, removes the duplicate preset and catalog effect, and uses the loaded runtime capabilities in the session policy. The mobile character and preset sheet mounts its controls on first opening. The 393 × 852 browser check confirms the controls are absent on entry, the library request starts on opening, and Escape closes the sheet.

Docker Desktop ran build `k2uvbNTCjyTJBiFY1wkvC` followed by `NLk5JdM5dHRxRmvXJMer4`, then repeated the comparison in reverse order. Each batch used eight fresh signed-in Chromium 151.0.7922.34 profiles, normal HTTP caching within each profile, the same mobile network shaping and container limits, two active fixture Relay Host sockets, and the same deterministic model. The packaged FastAPI and proxy files match the predecessor byte for byte. The browser resource snapshot captures completed requests and counts the listed endpoints whose start precedes the first quote request in the chat document.

| Requests per profile before the quote | Previous Next build | Current Next build |
|---|---:|---:|
| `/api/capabilities` | 3 | 1 |
| `/api/models` | 2 | 1 |
| `/api/library` | 1 | 0 |
| Presets, characters, personas, worlds | 2 each | 1 each |
| All captured API requests | 19 | 11 |

| Median across 16 completed profiles per build | Previous Next build | Current Next build |
|---|---:|---:|
| Character navigation to filled input | 1.83 s | 1.94 s |
| Submit to chat URL | 4.30 s | 4.38 s |
| Chat document navigation to quote request | 2.09 s | 1.68 s |
| Submit to visible first reply | 7.81 s | 7.53 s |
| Sum of input and submit phases, excluding the synchronization pause | 9.67 s | 9.54 s |

The request counts matched in all 32 profiles. The batch medians for chat-to-quote were 1.81 and 2.26 s before the change and 1.74 and 1.68 s after it. Submit-to-reply improved by 0.43 s in the first comparison and 0.12 s in the reverse comparison. The size of a first-reply improvement remains uncertain at this sample size. Sampled peak memory also varied across runs, from 257 to 602 MiB for the stack, including a larger file-cache charge in the first predecessor run. Use the staging workload to establish the latency and resource budgets.

Each of the 32 journeys issued one quote and one generation POST, reloaded the same saved history, and reconciled one mock generation and one settlement in the test ledger. The runs recorded zero outstanding holds, logged database waits, task-limit refusals, OOMs, unexpected restarts, Relay timeouts and sampling faults. All four disposable Compose projects were removed. From the project venv with the installed Playwright Chromium, run `python .artifacts/next-stack-capacity/authenticated.py --trace-pair --cached-client --handoff-candidate --profile-chat --schema-candidate --chat-load before` and repeat with `--chat-load after`. Add `--profile-repeat` when running after then before. The JSON reports are `authenticated-chat-load-{before,after}[-repeat].json` in `.artifacts/next-stack-capacity/`.

The Next production and unified Vite builds and all 21 focused frontend tests passed. Windows HTTPS browser checks covered the mobile preset sheet, Cloud chat recovery, consent cancellation, regeneration, branching, ledger reconciliation, and route rollback. The loopback Relay run switched proxy delivery in both directions with a generation pending on the PC, and recorded two PC generation submissions and zero direct Cloud generation requests. The installed Chromium PWA upgraded from the preceding Next build, reopened its device chat offline with the draft and outbox intact, and applied the companion recovery worker with browser fixture data.

The same candidate also passed both installed-client sync conflict cases in Chromium. Start from `.artifacts/next-migration-pages`, whose worker is `dff2d5e2ea987975b004`. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-migration-pages --new .artifacts/next-chat-load-release/package/web --channel chromium --sync-conflict pending` and repeat with `--sync-conflict previously-received`. Each run simulates a lost acknowledgment from disposable Cloud storage, retains both histories and produces one server branch. The previously received case also preserves the predecessor's message IDs. An initial run with worker `b57d10d2901e5c69c76a` stopped at the predecessor's preexisting-branch assertion before exercising the new code. Use the named older worker to reproduce that starting state.

| Current local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-chat-load-release/kyalulu-cloud.tar.gz` | `6a8a2c54f0516b83e8b9` | `9765a219d8cebd55bf4c5e3bf1fa4648da649b78daa75664f68b50773ffe20d8` |
| `.artifacts/next-chat-load-recovery/kyalulu-cloud.tar.gz` | `3c5461f8522e0bd45f1b` | `c92ec1eefcc769189f2887c0aaa3019d439333fcd48031ecbdb0565e3c6ef26d` |

Both archives passed SHA-256, canonical Relay origin and 982-file worktree verification. The release keeps five earlier worker inventories, including the immediate Next predecessor and the earlier unified Vite root. Adopt this pair for local handoff. Verify the destination's deployed predecessor assets, staging capacity with real OAuth, model and Relay integrations, and installed PWA behavior on physical devices before authorizing a production wave. Production cohort observation and legacy online UI retirement remain pending.

### Real offline model and Mobile import on the selected candidate

Windows Chrome 157.0.8103.79 used a fresh persistent browser profile at 393 × 852 CSS pixels. The fixture checked all five local `kyalulu-iq3m` shard hashes against the pinned model catalog and seeded their installed representation into the disposable profile. It upgraded from the Vite baseline to build `NLk5JdM5dHRxRmvXJMer4`, opened the existing device chat from the offline root, and ran the actual GGUF worker. The completed receipt and assistant message survived closing and reopening Chrome offline. Applying recovery worker `3c5461f8522e0bd45f1b` retained the same conversation owner and generation receipt, preserved the outbox, and served the held Next chunk. The fixture made zero API writes. The scope is desktop Chrome with an emulated phone viewport and preverified model files.

Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-migration-baseline --new .artifacts/next-chat-load-release/package/web --rollback .artifacts/next-chat-load-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. The terminal transcript is `.artifacts/next-chat-load-release/offline-gguf-chrome.log`.

The Mobile migration browser run used the same extracted release, a captured older Mobile distribution and the built exporter. The two origins resolved to loopback through Caddy. The run passed consent cancellation, cross-origin copy, checksummed backup export, corruption rejection, import replay and opening the migrated chat after a reload. The original IndexedDB and OPFS, the cleared draft and the pending draft marker survived the tested transitions. The result recorded zero API requests, external requests and page errors. Reproduce with `python tests/e2e_mobile_migration.py --legacy .artifacts/unified-migration-inputs-20261030/legacy --mobile .artifacts/next-stage5-mobile-export-v1 --app .artifacts/next-chat-load-release/package/web --output FRESH_RESULTS --caddy .artifacts/unified-migration-inputs-20261030/tool/caddy.exe`. The result is `.artifacts/next-chat-load-mobile-import/results.json`.

### Linux rollout and recovery on the selected candidate

The release and companion recovery images ran in an isolated Linux/amd64 Compose project. Caddy served the app and the local Relay under their canonical HTTPS hostnames mapped to a loopback address. The rehearsal verified the running Node and FastAPI files against the release SHA-256 manifest. It exercised each of the four page switches in isolation against 20 declared route patterns, for 80 combinations. Chromium also verified the optimized character portrait, CSP, keyboard draft recovery and authenticated chat access.

| Wave | Bundled HTTPS probe observations |
|---|---:|
| Character-only pilot | 40 |
| All page groups at pilot, quarter and all | 43 each |
| Proxy rollback with the candidate worker still delivered | 33 |
| Companion image recovery with its own worker | 33 |

All 235 expected observations passed, including Relay health and the hashes of the source offer, worker and retained chunks. A deliberate quarter-versus-all mismatch exited with code 1 and reported 21 discrepancies. During proxy-only rollback, the authenticated browser recovered both saved fixture messages and its unsent draft. For companion recovery, the rehearsal stopped the Cloud writer, started the matching recovery image on the same disposable volume, checked its files against its own SHA-256 manifest, and repeated the browser verification. The two history rows, including IDs and timestamps, and the draft matched. Caddy delivered the recovery worker and a held Next chunk at its original URL. Node and Relay kept their original container IDs. The rehearsal removed the disposable containers, networks and volumes.

Next peaked at 341.4 MiB of cgroup usage in this rehearsal. Its final anonymous memory was 84.8 MiB and its final file memory was 219.3 MiB. The packaged Next overlay in this run had no per-container memory cap. Use the separate capped load runs for the local concurrency comparison and measure the authorized staging host's capacity before expanding traffic.

Use the project venv with Playwright Chromium and run `python .artifacts/next-chat-load-linux-rollout/rehearse.py`. The driver uses the two release images tagged `:capacity-chat-load`, `kyalulu-cloud-local:chat-load-recovery` built from the extracted recovery bundle, `kyalulu-relay-local:capacity`, and `caddy:2.10.2`. It reads the immediate predecessor from `.artifacts/next-schema-release/package` to verify a retained asset. The per-request report is `.artifacts/next-chat-load-linux-rollout/results.json`.

### Next and Vite on the same release

The latest release's Caddy, FastAPI, Vite files and running Next build `NLk5JdM5dHRxRmvXJMer4` stayed fixed while Caddy assigned the Mocha journey to either frontend. Both comparisons ran in Vite, Next, Next, Vite order on Linux/amd64. Fresh Chromium 151.0.7922.34 profiles used the Japanese locale, 393 × 852 CSS pixels, DPR 2, and 80 ms latency with 2 Mbps down and 750 kbps up. Service workers were blocked. The route comparison includes the packaged asset and caching policies of each frontend.

The anonymous entry comparison ran two batches of three sequential cold profiles per frontend. Both delivered HTTP 200 and the character introduction with JavaScript disabled. All twelve interactive entries retained the intended draft when opening sign-in. The established entry thresholds were met in both pairs.

| Median of six anonymous entries per frontend | Vite | Next |
|---|---:|---:|
| First visible heading | 1.96 s | 0.24 s |
| Usable first-message input | 5.40 s | 1.31 s |
| LCP by interaction | 5.12 s | 0.90 s |
| Script transfer up to input readiness | 1,031,331 B | 153,690 B |
| Completed API reads up to input readiness | 3 | 1 |

The transfer difference includes delivery configuration. A separate cold-profile diagnostic captured identity encoding with `no-store, no-transform` on the three initial Vite scripts and Zstandard with `private, max-age=31536000, immutable` on eight Next scripts. Their decoded totals were 1,030,431 and 483,816 bytes, respectively. Transfer and timing figures describe the tested proxy configuration. The diagnostic measured decoded size and response headers under that configuration.

The signed-in comparison used two batches of eight concurrent profiles per frontend, the normal browser HTTP cache within each fresh profile, two fixture Relay host connections, matching container limits and the same deterministic model. The accounts began with valid synthetic sessions, 500 test credits and the provider agreement. The test separates submit latency, quote latency and provider-response timing. All 32 journeys made one quote and one generation POST, recovered one saved reply after reload, and reconciled one provider call and one settlement. Cross-account reads returned no generation data. All four batches finished with zero outstanding holds, logged database waits, task refusals, OOMs and Relay timeouts. The fixtures and their volumes were removed.

| Median of 16 signed-in journeys per frontend | Vite | Next |
|---|---:|---:|
| Character navigation to filled input | 7.51 s | 1.69 s |
| Submit to chat URL | 0.78 s | 4.74 s |
| Submit to quote request | 1.98 s | 6.42 s |
| Quote request duration | 0.34 s | 0.24 s |
| Generation POST to full reply event | 1.19 s | 0.78 s |
| Submit to visible first reply | 3.74 s | 7.80 s |
| Sum of input and submit phases, excluding the synchronization pause | 11.27 s | 9.43 s |

The combined phases were 16.4% shorter on Next. The post-submit wait was 4.06 s longer and was longer in both batches. The difference accumulated before the quote request, with most of the gap already present at the chat URL. The current signed-in handoff opens the shared character profile through the App Router, and that view waits for its catalog before creating the session. Keep the post-submit regression open in the UX criteria while tracing that transition. The test has established sessions, so real OAuth time remains outside these figures.

Run `python .artifacts/next-chat-load-frontend-comparison/compare.py guest` and then the same command with `signed-in` and `delivery`. The three JSON reports are in that directory. The diagnostic records encoded and decoded script bytes with their effective response headers.

### Direct Cloud chat start experiment

Build `Rut_YrkeVp6BdwYj0xCvZ` let a signed-in visitor start an official character's session from the public composer when both the browse and chat groups were assigned to Next. The prototype used the existing FastAPI settings and greeting APIs with an explicit owner header, then entered the chat document with the shared owner-scoped first-message state. The Windows Caddy and Chromium suite forwarded a settings write and dropped its response. The browser retained the draft, retried the same session ID, and generated once after navigation. It settled one operation for that send and recovered the saved reply after reload. The fixture also passed its login, consent, interruption, account and target-switch checks.

| Median across two eight-profile batches per Next build | Current profile handoff | Direct start experiment |
|---|---:|---:|
| Character navigation to filled input | 1.81 s | 1.89 s |
| Submit to chat URL | 5.19 s | 5.01 s |
| Submit to quote request | 6.87 s | 8.02 s |
| Submit to visible first reply | 8.26 s | 10.30 s |
| Resource requests served by the browser HTTP cache | 20 | 11 |

The completed Linux batches used the same mobile shaping, resource limits, mock model and two fixture Relay connections, in current, direct, direct, current order. All 32 completed journeys had one quote, one generation, one saved reply and one settlement. The initial final current-build batch stalled after entering the character handoff URL and hit the navigation deadline. Its diagnostic read also failed. A fresh run of the same batch completed all eight journeys. The table uses the four complete batches.

A separate one-profile trace placed the chat document request at 1.97 s on the current build and 1.66 s with direct start. Its quote requests began at 3.29 and 3.95 s, respectively. The direct-start import referenced five JavaScript chunks totaling about 139 kB before compression, and the chat document still loaded the runtime after navigation. Treat the lower browser-cache reuse and the document-to-quote delay as leads for the next transition change.

The worktree was restored to the 982 source files verified against `NLk5JdM5dHRxRmvXJMer4`. That build and its companion recovery bundle were kept for handoff at that point. The experiment's release archive, build, worker and browser log are retained in `.artifacts/next-direct-start-release/` for reproduction. To reproduce the measured sequences with the recorded images, run `python .artifacts/next-direct-start-comparison/compare.py` with `before 1`, `after 1`, `after 2` and `before 2`, then with `before 1 --trace` and `after 1 --trace` for the diagnostic pair. The JSON files are in the same directory as the driver.

### Same-document Cloud chat handoff

Build `AF2Z9Z_woYKPcdPMYAW_n` keeps the existing shared character profile and session setup. When the authenticated Cloud profile is delivered by Next and its route assignment also enables Next chats, it saves the first line in the existing conversation draft and enters the chat through App Router. The automatic-send marker lives in the current document, matches the account, destination and exact draft, and can be consumed once. An interrupted navigation that opens a new document preserves the message as an editable draft. The direct document handoff remains available for other route assignments and failed draft staging.

The production Next and Vite builds passed, with 54 focused frontend tests. Windows Caddy and Chromium observed React Server Component responses for both the character and chat transitions, with zero document requests between them. The fixture saw one first message after automatic send and after reload. Login, account and destination checks, generation interruption and recovery, ledger, route rollback and offline restart also passed.

The controlled Linux test kept the images, route matchers, browser cache policy, mock provider and workload fixed. Only the fixture's chat-delivery header changed between the two modes. It ran two eight-profile batches per mode in document, App Router, App Router, document order. The trace classified the chat request in every profile. All 32 sends generated, persisted and settled once. The test confirmed owner isolation and no outstanding holds, database waits, task-limit refusals, OOMs, unexpected restarts or Relay timeouts in the completed run.

| Median across 16 completed profiles per transition | Document navigation | App Router |
|---|---:|---:|
| Submit to quote request | 6.19 s | 6.04 s |
| Submit to visible first reply | 7.65 s | 7.40 s |
| JavaScript requests after submit, including cache hits | 28 | 13 |

The first comparison's reply medians were 7.77 and 7.21 s. The reverse comparison's medians were 7.46 and 7.81 s. The direction of the reply-time difference varied. App Router consistently avoided a document reload and the pooled request count fell by 15. Keep the end-to-end reply latency open in the UX comparison with Vite.

An earlier fixture run at a 96 MiB Caddy limit stopped with `OOMKilled=true` and exit 137. The completed control used the same 192 MiB Caddy limit in every batch, observed a maximum Caddy cgroup peak of 137.42 MiB, and retained the other CPU, memory and task limits. This limit describes the test fixture. The mixed-build attempt at 96 MiB completed one predecessor batch after a retry and both new-build batches. Its final predecessor batch timed out twice, so the control provides the paired measurements above. The failed control and successful retry are in `control.log` and `control-192.log` under `.artifacts/next-same-document-comparison/`.

Run `python .artifacts/next-same-document-comparison/control.py --proxy-mib 192` using the installed Playwright Chromium and the `:capacity-same-document` images. The per-profile report is `same-build-control-192.json`. Use the verified release and recovery archives below for this candidate.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-same-document-release/kyalulu-cloud.tar.gz` | `c40dec2ad10cd38f4cdf` | `310b267b1d380b1e7a799c013a18629bf3723149d10d491c3830fd81937c359e` |
| `.artifacts/next-same-document-recovery/kyalulu-cloud.tar.gz` | `4a1c2261e932662dac37` | `03c38d35e59f31cdbaabee44a02e8662716a6ca30bb59775d580aef9c18c2e5d` |

Both archives passed SHA-256, canonical Relay origin and 984-file worktree verification. The release retains six prior worker inventories including the immediate predecessor. The companion also retains the new worker's immutable files. The packaged FastAPI and proxy files match the preceding release byte for byte.

The exact Linux image pair passed 80 route-switch combinations and 235 HTTPS probe observations. The probe rejected a deliberate wrong-wave check. Proxy rollback and replacement with the companion Cloud image kept the same authenticated history and draft. The probe also checked the held chunk, source offer and recovery worker. The fixture removed its containers, networks and volumes. Reproduce with `python .artifacts/next-same-document-linux-rollout/rehearse.py` and the recorded release images, Relay `:capacity` image, Caddy 2.10.2 and `kyalulu-cloud-local:same-document-recovery` built from the extracted recovery archive. The results are in that driver's directory.

Windows desktop Chrome also upgraded the installed worker from `6a8a2c54f0516b83e8b9` to `c40dec2ad10cd38f4cdf`, ran a real offline WebGPU GGUF turn from five preverified shards, and recovered the same saved reply and generation ID after a fresh offline process. It applied the companion worker and checked the held chunk and outbox. The first attempt under concurrent local test activity stopped before a receipt was available. The standalone repeat with identical artifacts completed, with one worker generation and zero worker errors. The initial failure's cause remains unverified. The two transcripts are `offline-gguf-chrome.log` and `offline-gguf-retry.log` in `.artifacts/next-same-document-release/`. Use this archive pair for local handoff. Staging, the physical-device upgrade and the authorized production wave remain outstanding.

### Cloud quote with a captured history revision

Build `nikGQ17a4kd-d5k3kDhmt` was built from the working tree based on `4f24140`. It uses `quote_resolves_history` to opt into `POST /api/cloud/quotes?resolve_history=true`. FastAPI resolves the conversation and computes its revision from the same SQLite snapshot. The quote binds that revision to its request fingerprint. The client sends the quoted revision with the generation request. A stale or missing revision is rejected before provider dispatch and settlement. The split lookup stays available for older clients and servers. The send still saves conversation settings before requesting the quote.

The production Next and unified Vite builds passed, along with 96 focused Python tests and 48 focused frontend tests. Windows Caddy and Chromium confirmed that the follow-up send used the quoted revision and skipped the context GET. The coexistence suite passed the consent, interruption, regeneration, branch, deletion, ledger, rollback and offline restart checks. The first consent test failed because its route glob skipped the query string. The passing rerun matches the request path and checks the same consent UI. Its transcript is `.artifacts/next-quote-history-release/coexistence-rerun.log`.

The Linux comparison held the Next and FastAPI code, App Router navigation, cache policy and mock provider constant. It changed only the capability advertised to the client. Four batches ran eight signed-in Chromium profiles each in split, combined, combined, split order, with two fixture Relay Host sockets active. Caddy had a 192 MiB limit in both arms. The trace labels the split arm `next-document` as an inherited fixture name. All chat transitions used App Router.

| Median across 16 profiles per arm | Split lookup | Combined quote |
|---|---:|---:|
| History context GETs per send | 1 | 0 |
| Submit to quote request | 6.31 s | 6.33 s |
| Quote fetch | 320 ms | 314 ms |
| Submit to visible first reply | 7.96 s | 7.75 s |

The first pair's reply medians were 7.96 and 7.99 s. The reverse pair's were 8.04 and 7.75 s when expressed in split and combined order. Every combined send avoided one GET. The end-to-end latency difference varied across the two pairs and leaves the matched Next-versus-Vite reply criterion open. All 32 journeys produced one browser generation POST, one provider call, one persisted reply and one settlement each. There were zero outstanding holds, measured database contention waits, Relay errors, OOM kills or unexpected restarts. The disposable stack was removed.

Reproduce the comparison with `python .artifacts/next-quote-history-comparison/control.py --proxy-mib 192`, installed Playwright Chromium and the `:capacity-quote-history` images. The results are in `same-build-control-192.json`. The comparison used the earlier packaging of the same runtime and web files. The verified archives below differ from that packaging in the corresponding-source archive, which now includes the corrected browser test.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-quote-history-release-verified/kyalulu-cloud.tar.gz` | `c346544239e00a6dc7fb` | `f63f205ae21d1cddb7f4cb26eaaa40303756fc8a665746b89289386af7eae3fe` |
| `.artifacts/next-quote-history-recovery-verified/kyalulu-cloud.tar.gz` | `570e7a38ac3a5da2541f` | `a9ca1f436d44d08d4a60f186391436c31b5a2f8a43bccf8464564a121c82e9b5` |

Both archives passed verification of their full manifests, exact hashes, `https://relay.kyalulu.com` and 984 worktree files. The release retains seven prior worker inventories, including `c40dec2ad10cd38f4cdf` from build `AF2Z9Z_woYKPcdPMYAW_n`. The companion also keeps the new worker's immutable assets.

The verified archives passed the loopback Linux rollout rehearsal with 80 route-switch combinations and 235 successful HTTPS probe observations. The deliberately wrong wave failed its probe. Both the proxy rollback and the companion image swap preserved the same authenticated history and draft. The rehearsal also verified the running bundle files, corresponding source, a held predecessor chunk and the companion worker. Next and Cloud ran as non-root with read-only roots. The stack removed its disposable containers, networks and volumes. The record is `.artifacts/next-quote-history-linux-rollout/results.json`.

Reproduce with `python .artifacts/next-quote-history-linux-rollout/rehearse.py` using the installed Playwright Chromium. Build `kyalulu-online-local:capacity-quote-history-final` from the extracted release's `online` directory with the recorded `NODE_VERSION` and `NEXT_BUILD_ID` arguments. Build `kyalulu-cloud-local:capacity-quote-history-final` and `kyalulu-cloud-local:quote-history-recovery-final` from the roots of the respective extracted bundles. The fixture also uses `kyalulu-relay-local:capacity` and Caddy 2.10.2.

Desktop Chrome upgraded the installed worker from `c40dec2ad10cd38f4cdf` to `c346544239e00a6dc7fb` and retained the same offline conversation, draft and pending outbox. The fixture verified five catalog GGUF shards by SHA-256 before importing them into a disposable browser profile. A real offline turn committed an assistant message and generation ID, and a fresh offline browser process recovered both. The companion worker `570e7a38ac3a5da2541f` preserved the committed result and outbox, and the held Next chunk remained addressable. The migration document kept its separate isolation policy. The transcript is `.artifacts/next-quote-history-release-verified/offline-gguf-chrome.log`.

Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-same-document-release/package/web --new .artifacts/next-quote-history-release-verified/package/web --rollback .artifacts/next-quote-history-recovery-verified/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. Use the verified archive pair above for local handoff. Keep the legacy Mobile import and sync-conflict evidence attached to their earlier tested builds. Staging, physical-device acceptance and a production observation window remain pending.

#### Signed-in Next and Vite comparison on this candidate

The exact Linux release images ran four batches of eight signed-in sessions in Vite, Next, Next, Vite order. Both frontends used the same source bundle, combined quote, deterministic provider and target character. Each profile was fresh, with Chromium set to 393 × 852 CSS pixels, DPR 2, 80 ms network latency, 2 Mbps down and 750 kbps up. Service workers were blocked and browser HTTP caching was available during the journey. Both arms used the same container limits and two fixture Relay Host sockets per batch.

| Median across 16 profiles per frontend | Vite | Next.js |
|---|---:|---:|
| Open character page to usable first-message input | 9.07 s | 1.79 s |
| Submit to chat URL | 0.86 s | 4.73 s |
| Submit to quote request | 2.04 s | 6.27 s |
| Submit to visible first reply | 3.82 s | 7.96 s |
| Per-profile sum of input and submit phases | 13.08 s | 9.72 s |

In the paired runs, Vite reply medians were 3.91 and 3.80 s, and Next medians were 7.91 and 8.04 s. The Next profile handoff request began 145 ms after submit at the median, and most of the reply delay was already present when the chat URL appeared. Quote fetch medians were 439 and 229 ms in Vite and Next. The total measured phases favor Next, while the post-submit regression remains open for cutover. Every journey produced one browser generation POST, one provider call, one persisted reply and one settlement. All four batches ended with zero holds, and the test removed the disposable stack.

Run `python .artifacts/next-quote-history-frontend-comparison/compare.py signed-in` with `tests` on `PYTHONPATH`, the installed Playwright Chromium and the exact Linux release images named above. Review `signed-in.json` in the same directory. Use the separate input, submit and quote timings to localize future changes to the conversation entry flow.

### Official character setup from the public card

Build `OeDXcPpSxN-a8y7wkDwhC` carries the official general-audience character's opening fields in the existing App Router response for a conversation handoff. The public API exposes the greeting choices and recommended temperature for that character when requested. The default card fields stay the same. FastAPI still checks access and saves the conversation through the existing settings and greeting APIs. The browser checks the one-time transfer against the current account and character before using these fields. The full profile loads when the transfer or opening fields are unavailable, including with the previous API version.

Both production builds, Web type checking, 59 Python tests and 16 frontend tests passed. Windows Caddy and Chromium confirmed that the first settings write preceded any full catalog reads. The browser also verified both App Router transitions, one initial generation, one saved first message after reload, account and execution target isolation, and the existing Cloud consent, interruption and rollback checks. See `.artifacts/next-character-opening-release/coexistence.log`.

The Linux comparison held both application images, route ownership, mock provider, browser cache policy, profile settings and container limits constant. The fixture removed the opening flag from the private loopback request in the control arm. Four eight-account batches ran in full catalog, opening fields, opening fields, full catalog order. Both arms used App Router. The trace labels the control `next-document` because of the inherited fixture convention.

| Median across 16 profiles per arm | Full catalog | Opening fields |
|---|---:|---:|
| Catalog and session-list reads before setup | 3 | 0 |
| Submit to first chat settings request | 3.77 s | 2.14 s |
| Submit to chat URL | 4.69 s | 4.48 s |
| Submit to visible first reply | 7.53 s | 7.18 s |

The two reply comparisons ran in opposite directions. The first pair recorded 8.03 and 7.18 s and the reversed pair recorded 6.92 and 7.19 s when expressed in full-catalog then opening-fields order. In the full-catalog batches, medians between the settings request and the subsequent greeting request were 474 and 389 ms. In the opening-fields batches they were 2.15 and 2.06 s. The new order reliably starts setup earlier. Separate the cold account database initialization, settings validation and backup work in a server trace before choosing the next optimization. The existing matched Next-versus-Vite first-reply criterion remains open.

All 32 sends produced one generation, one persisted reply and one settlement each, with zero outstanding holds. No measured database contention waits, Relay errors, OOM kills or extra restarts were observed. The fixture cleaned up its temporary stack. Reproduce with `python .artifacts/next-character-opening-comparison/compare.py`, the installed Playwright Chromium and the `:capacity-character-opening` Linux images. The per-profile data are in `same-build-control.json`.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-character-opening-release/kyalulu-cloud.tar.gz` | `e6c0b264912ba09873f4` | `2b1222bdaa2f27778f42e0d3fe042daefb317cdaf1ffcc91a25563b4c7b52a1d` |
| `.artifacts/next-character-opening-recovery/kyalulu-cloud.tar.gz` | `5867936eb8f5922e1421` | `0cdd0bef1c5f282dc69defe70f7a8921b0ae73d90819be3659dd5598a80117d4` |

Both archives passed checks of their full manifests, exact hashes, `https://relay.kyalulu.com` and 984 worktree files. The release retains eight previous worker inventories. The companion retains the release worker's immutable assets as well.

The paired Linux images passed 80 route-switch combinations and 235 successful HTTPS observations. The deliberately mismatched wave returned the expected failure. Proxy rollback and the companion image preserved the authenticated history, draft and held chunk, and the fallback served the companion's exact worker and corresponding source. The temporary stack was removed. Run `python .artifacts/next-character-opening-linux-rollout/rehearse.py` with the `:capacity-character-opening` Next and Cloud images and `kyalulu-cloud-local:character-opening-recovery` built from the extracted recovery root. The fixture uses the existing `kyalulu-relay-local:capacity` and Caddy 2.10.2 images. The report is `.artifacts/next-character-opening-linux-rollout/results.json`.

Desktop Chrome upgraded the installed worker from `c346544239e00a6dc7fb` to `e6c0b264912ba09873f4`. The browser preserved the conversation, draft and pending outbox, ran an offline turn with five verified GGUF shards, and recovered the committed reply by generation ID in a fresh offline process. Applying the companion worker `5867936eb8f5922e1421` preserved the saved reply, the pending outbox and the held chunk. The separate migration document kept its isolation policy. Use this archive pair for local handoff. The transcript is `.artifacts/next-character-opening-release/offline-gguf-chrome.log`.

Reproduce with `python tests/e2e_next_device_upgrade.py --old .artifacts/next-quote-history-release-verified/package/web --new .artifacts/next-character-opening-release/package/web --rollback .artifacts/next-character-opening-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. Keep the prior bundles' Mobile import and sync-conflict evidence attached to those builds. The remaining release gates include the first-reply UX criterion, designated staging, physical-device acceptance and the authorized production observation window.

### Atomic Cloud database initialization

The loopback diagnostic on build `OeDXcPpSxN-a8y7wkDwhC` timed 16 signed-in journeys, eight per handoff mode. The account profile request started the first initialization in every account. Schema initialization took medians of 2.63 s with the full catalog and 2.25 s with the earlier settings dispatch. In the latter group the median settings-to-greeting interval was 2.03 s. Separate spans recorded authentication, eligibility, prompt validation, storage usage, backup and settings persistence. The in-process measurements excluded browser and proxy scheduling time. Reproduce on the previous Cloud image with `python .artifacts/next-character-opening-comparison/compare.py --profile-settings`. The trace is `settings-phases.json` in that directory.

The new Cloud image runs the existing tenant schema and column migrations in one SQLite transaction. The DDL, columns and defaults are the same. Initialization in the shared local runtime continues to use its previous DDL path. The commit happens after the last migration. The rollback test injected an error after the schema and one column had been applied, then verified the empty database and a successful retry. The 62 Python checks also exercised reuse, replacement, legacy backup migration and recovery after a failed migration.

The same-build Docker comparison used the new Cloud image in both arms. A fixture-only header selected schema autocommit or an explicit transaction. The Next application, account setup, opening-fields handoff, Caddy limits, provider and browser conditions were fixed. Four eight-profile batches ran in autocommit, transaction, transaction, autocommit order. Cold schema timings were selected from the requests that also ran interrupted-generation recovery, yielding 16 per arm.

| Median across 16 profiles per arm | Autocommit | One transaction |
|---|---:|---:|
| Cold tenant schema initialization | 2.38 s | 146 ms |
| First settings request inside FastAPI | 2.25 s | 399 ms |
| Browser settings request to greeting request | 2.26 s | 426 ms |
| Submit to chat URL | 4.74 s | 2.57 s |
| Submit to visible first reply | 7.46 s | 5.90 s |

The paired reply medians were 7.86 and 5.90 s in the first pair and 7.16 and 5.90 s in the reversed pair, expressed in autocommit then transaction order. Each batch initialized eight schemas and settled eight generations. All 32 journeys persisted one reply each and left zero outstanding holds. The fixture removed its containers, volumes and networks. Reproduce with `python .artifacts/next-character-opening-comparison/compare.py --schema-transaction` and review `schema-transaction-control.json`. Use `kyalulu-online-local:capacity-character-opening`, the installed Chromium and `kyalulu-cloud-local:capacity-schema-transaction` built from the extracted current release root.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-cloud-schema-transaction-release/kyalulu-cloud.tar.gz` | `e6c0b264912ba09873f4` | `e95e4427357aa6b290f9c1c8229f602c878edc6c16a04e91566e1444a62f75b6` |
| `.artifacts/next-character-opening-recovery/kyalulu-cloud.tar.gz` | `5867936eb8f5922e1421` | `0cdd0bef1c5f282dc69defe70f7a8921b0ae73d90819be3659dd5598a80117d4` |

The release verifier checked 818 archive members, 984 corresponding-source files and the exact Relay origin. The recovery archive was rechecked against its original hash and manifest. It contains the previous FastAPI version. The two release manifests differ in `runtime/python/storage/db.py`, the source archive and the retention metadata. The 672 `web/` and `online/` files, including the build ID and service worker, match the previous release byte for byte. That is the frontend and worker pair exercised by the desktop Chrome offline generation and rollback above.

#### Signed-in Next and Vite on the atomic initialization release

The same production Cloud image with atomic initialization served both frontends. Next.js and Vite used the same fixture accounts, mock provider, hash-verified release and 192 MiB Caddy cap. Four batches of eight fresh Chromium profiles ran in Vite, Next, Next, Vite order using the same phone viewport, network shaping and cache policy as the earlier signed-in comparison.

| Median across 16 profiles per frontend | Vite | Next.js |
|---|---:|---:|
| Open character page to usable first-message input | 5.98 s | 1.74 s |
| Submit to chat URL | 0.82 s | 2.74 s |
| Submit to quote request | 1.85 s | 4.11 s |
| Submit to visible first reply | 4.07 s | 5.88 s |
| Per-profile sum of input and submit phases | 10.08 s | 7.59 s |

Vite's reply medians were 4.85 and 3.23 s. Next's were 5.89 and 5.66 s. The submission gap remains in both batch pairs. Most of the pooled difference was already present when Next reached the chat URL. The median from generation dispatch to the first reply body was 1.66 s on Vite and 1.02 s on Next in this run. Investigate the browser handoff to chat before changing the provider path. All 32 journeys produced one persisted reply and settled once, with zero outstanding holds. Reproduce with `python .artifacts/next-cloud-schema-transaction-frontend-comparison/compare.py`. Its report is `signed-in.json`.

The exact backend image and previous recovery image passed the Linux loopback rollout: 80 route-switch combinations and 235 successful HTTPS observations, plus the expected failure for a deliberately mismatched wave. The old FastAPI image opened the same authenticated conversation after the new writer stopped, preserving its history and draft. The operator probe checked the exact source and worker from each selected archive and the held Next asset. The fixture removed its disposable stack. Run `python .artifacts/next-cloud-schema-transaction-linux-rollout/rehearse.py` with the images above, `kyalulu-cloud-local:character-opening-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. The report is `.artifacts/next-cloud-schema-transaction-linux-rollout/results.json`. Use this archive pair for the local handoff. The remaining gates are the first-reply criterion, designated staging, physical-device acceptance and the authorized production rollout and retirement.

### Direct App Router start from the character composer

The transaction-enabled baseline placed the first settings request at 1.62 s after submit. Its trace showed the profile RSC request, eight shared client chunk requests, the runtime status check and the character view's chunks before that write. The direct start experiment uses the existing public character opening fields and shares the session settings, optional persona resolution and greeting path with the existing runtime. The public composer rechecks the Cloud account and both route switches, then attaches the verified owner scope to each request. The FastAPI boundary still owns authorization and all writes. The owner-scoped draft and one-time first-send marker carry the message into the same App Router document. Guest, empty-draft and mixed-route starts use the shared profile handoff.

The first variant (`yZafxlbeVTNEdIqrEjSVI`) loaded chat JavaScript while the session writes were in flight. The same-build loopback control used four eight-profile batches in profile, direct, direct, profile order. A browser fixture withheld the chat delivery flag only from status reads on the initial public page in the control arm. Both chat transitions stayed in App Router and HTTP caching remained active. Median submit-to-first-settings went from 1.61 s to 144 ms. The reply median was 5.58 s through the profile and 5.56 s directly. The paired reply medians were 5.90 and 5.14 s in the first pair and 5.27 and 6.49 s in the reversed pair, expressed in profile then direct order. The two direct batches waited a median of 1.22 and 1.91 s between the settings and greeting requests, compared with 324 and 383 ms in the profile batches. The first variant remains an experiment. See `.artifacts/next-direct-app-router-comparison/same-build-control.json`.

Build `K-uQN_p5NFFDJzZMymmPh` completes the settings and greeting writes before starting chat module loads alongside the route transition. Web type checking, 40 focused frontend tests and both frontend production builds passed. The Windows browser fixture committed the initial settings write and dropped its response. The composer retained the text and retry used the same session ID. The completed send used one quote and one generation. The saved reply appeared once after reload. Account and execution-target switching, consent, interruption recovery and route rollback passed. See `.artifacts/next-direct-app-router-write-first-release/coexistence.log`.

| Same build, medians across 16 profiles per arm | Profile handoff | Direct start after writes |
|---|---:|---:|
| Submit to first settings request | 1.89 s | 139 ms |
| Settings request to greeting request | 303 ms | 717 ms |
| Submit to chat URL | 2.66 s | 1.89 s |
| Submit to quote request | 4.03 s | 3.65 s |
| Submit to visible first reply | 5.51 s | 5.59 s |

Chat URL arrival was earlier with direct start in both pairs. Reply medians were 5.49 and 5.20 s in the first pair and 5.54 and 6.81 s in the reverse pair, expressed in profile then direct order. The direct route removes the intermediate navigation and starts the settings request earlier. The overall first-reply effect remains inconclusive. Both arms used the same mock provider and browser network profile. Every one of the 32 journeys produced one stored reply and one settlement, with zero outstanding holds. The fixture removed the temporary stack. Run `python .artifacts/next-direct-app-router-comparison/compare.py --write-first` with the `:capacity-direct-app-router-write-first` images and Playwright Chromium. The report is `write-first-control.json`.

#### Signed-in Next and Vite before deferring chat rendering dependencies

The Vite and Next comparison used the same candidate archive, configured Caddy, fresh shaped mobile profiles and deterministic provider. It ran in Vite, Next, Next, Vite order, with eight profiles per batch. The added observer waited for the chat textarea to become visible and recorded its elapsed time from the submit interaction. The prior comparison tracked arrival at the URL.

| Median across 16 profiles per frontend | Vite | Next.js |
|---|---:|---:|
| Open character page to usable first-message input | 5.95 s | 1.77 s |
| Submit to chat URL | 0.75 s | 2.14 s |
| Submit to visible chat textarea | 0.91 s | 3.35 s |
| Submit to visible first reply | 3.27 s | 5.57 s |
| Per-profile sum of input and submit phases | 9.23 s | 7.42 s |

Vite's reply medians were 3.29 and 3.24 s. Next's were 6.50 and 5.36 s. The 2.44 s pooled gap before the textarea was visible identifies a user-visible delay during the chat transition. Keep the textarea and reply as separate acceptance measurements. The temporary stack also ran one signed-in visit with only the official character pilot enabled. The public page came from Next, one document handoff reached Vite chat, and the correct reply persisted and settled once. Across all 33 journeys there were zero outstanding holds. Reproduce with `python .artifacts/next-direct-app-router-frontend-comparison/compare.py`. The report is `signed-in.json` in that directory.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-direct-app-router-write-first-release/kyalulu-cloud.tar.gz` | `d5ab1889a7a0a24ee62a` | `cf7c422b1bca3ac0f28e8946fb956b29deab76e0cd3b1ff02d5ce5af6b232026` |
| `.artifacts/next-direct-app-router-recovery/kyalulu-cloud.tar.gz` | `47d592414ddc09e01c5c` | `f4f9a7c366fa022adeb5b3356ed5227f99e035665e60db1e141fe9c795acfd01` |

The verifier checked the exact archive hashes, `https://relay.kyalulu.com`, 921 release members, 663 recovery members and 986 corresponding-source files in each archive. The release retains nine prior worker inventories. The recovery archive also contains the new worker's held immutable assets.

All 111 FastAPI runtime files matched the preceding release byte for byte. The exact Linux release and recovery images passed 80 route-switch combinations and 235 successful HTTPS observations. The intentionally wrong wave failed as expected. Proxy rollback and the recovery image preserved the same authenticated history and draft, and the probes checked the worker, corresponding source and held assets. The fixture removed its temporary stack. Run `python .artifacts/next-direct-app-router-linux-rollout/rehearse.py` with the exact `:capacity-direct-app-router-write-first` images, `kyalulu-cloud-local:direct-app-router-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. See the driver's `results.json`.

Desktop Chrome applied worker `d5ab1889a7a0a24ee62a` over `e6c0b264912ba09873f4` and retained the existing offline conversation, draft and outbox. It ran a true offline GGUF turn from five verified shards and recovered the saved reply by generation ID in a fresh offline browser. Recovery worker `47d592414ddc09e01c5c` retained the same result, pending outbox and held Next asset. The migration document kept its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-cloud-schema-transaction-release/package/web --new .artifacts/next-direct-app-router-write-first-release/package/web --rollback .artifacts/next-direct-app-router-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. The transcript is `.artifacts/next-direct-app-router-write-first-release/offline-gguf-chrome.log`.

This pair verifies direct navigation and same-tab retry and serves as the predecessor in the following comparison.

### Keep the chat composer usable while Markdown loads

Build `4MsRtcZ_x4bZO0Hin-9Kb` loads the Markdown renderer when a message needs it. The conversation shows literal text within the existing speaker and narration layout while the script loads. Visual-novel mode and portable presets load on use. An official character chat can open without loading the portable library client. Both production builds, Web type checking and 53 focused frontend tests passed. Vite reported a bundling warning because other screens still import the Markdown renderer directly.

Windows Chromium behind Caddy opened the signed-in journey in a fresh profile with service workers blocked. The test held the 144,625-byte Markdown parser response. The composer became editable and the existing message showed as literal text while the response was held. Releasing the response restored formatted markup. The same run covered a dropped settings response followed by a same-session retry, one quote, one generation and one stored copy of the first message. The mobile-sized preset sheet loaded its library when opened and closed with Escape. The persistent-profile checks covered account changes, interruption, regeneration, ledger settlement, route rollback and a separate offline restart. See `.artifacts/next-chat-lazy-release/coexistence-cold.log`.

The signed-in Linux comparison used disposable accounts, the same deterministic provider, Chromium 151.0.7922.34 at 393 × 852 CSS pixels and the shaped network at 80 ms latency, 2 Mbps down and 750 kbps up. Each measured batch had eight concurrent browser profiles and two active fixture Relay host sockets. Profiles started fresh and used normal HTTP caching during the journey. Caddy was capped at 192 MiB. Next builds ran in before, after, after, before order. The two after runs also exercised Vite in opposite order relative to Next. A separate character-only visit verified the single document handoff to Vite chat.

| Median across 16 profiles per column | Next before | Next after | Vite after |
|---|---:|---:|---:|
| Character page open to usable input | 1.81 s | 1.81 s | 6.07 s |
| Submit to chat URL | 2.11 s | 1.88 s | 0.48 s |
| Submit to visible chat textarea | 3.36 s | 2.85 s | 0.82 s |
| Submit to visible first reply | 4.92 s | 5.07 s | 2.93 s |
| Submit to formatted first reply | 5.08 s | 5.18 s | 3.11 s |
| Per-profile sum of input wait and visible-reply wait | 6.64 s | 6.85 s | 8.97 s |

The paired textarea medians changed from 3.40 to 2.42 s and from 2.90 to 3.10 s. The visible-reply medians increased in both pairs, from 5.09 to 5.36 s and from 4.65 to 4.92 s. The browser proof establishes that the composer can open independently of Markdown delivery. The load comparison shows a pooled textarea gain with mixed batch results and no first-reply gain. Against Vite in the same release, the Next textarea still appeared 2.03 s later after submit and the visible reply appeared 2.14 s later. The initial input appeared 4.26 s earlier in Next. The median measured start of generation was 3.94 s in Next and 1.78 s in Vite. From the start of that request to visible reply, the per-profile medians were 1.22 and 1.13 s. The longer wait accumulates primarily before the generation request.

In the old Next traces, the Markdown parser request began at least 1.67 s before the composer was observed. In the new traces its start was within 204 ms of that observation. Decoded file sizes for distinct Next scripts requested from submit through the composer observation had batch medians of 705,138 bytes in both old batches and 547,580 and 694,720 bytes in the new batches. These are sizes on disk for requests that had started by the observer's cutoff. Transfer sizes and download completion times are separate measurements.

All 49 journeys reconciled one persisted reply and one test settlement per visit, with zero outstanding holds and no journey errors. Reproduce with `python .artifacts/next-chat-lazy-comparison/compare.py before 1`, followed by `after 1`, `after 2` and `before 2`. Use the `:capacity-direct-app-router-write-first` and `:capacity-chat-lazy` image pairs and the same installed Playwright Chromium. The four JSON reports retain the sanitized phase timing and ledger evidence. The fixture removed all four test projects.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-chat-lazy-release-verified/kyalulu-cloud.tar.gz` | `147a2f4810da97dedaab` | `34d4040c34ff63f2a25bad78c78b991d18ec6c08c948cf3de9e9ca5045c9d18f` |
| `.artifacts/next-chat-lazy-recovery/kyalulu-cloud.tar.gz` | `abaf6e02f40324431a85` | `3d8609e77ef374fd9fe37095a42ed37210dd4f56b9420c1303d9c3f6c52d3e05` |

The verifier matched the archive hashes, pinned `https://relay.kyalulu.com`, checked 977 release members and 712 recovery members, and compared 987 corresponding-source files per archive. All 832 online and Web members compared with the measured bundle matched. Each bundle's 111 FastAPI runtime members matched the predecessor. The release retains ten prior worker inventories and the recovery bundle retains those ten plus the new worker's hashed assets.

The Linux Docker Desktop rehearsal ran the final artifacts behind Caddy 2.10.2 on loopback. It passed 80 switch combinations across 20 online routes and 235 HTTPS observations across the character pilot, phased cohorts, proxy rollback and companion recovery. A deliberate wrong-wave expectation failed as designed. The authenticated conversation and its draft survived both recovery paths. The fixture verified the worker, corresponding source and held immutable chunks, then removed the temporary project. Run `python .artifacts/next-chat-lazy-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-chat-lazy`, `kyalulu-cloud-local:capacity-chat-lazy-final`, `kyalulu-cloud-local:chat-lazy-recovery`, `kyalulu-relay-local:capacity` and the named Caddy version. The full probe report is `.artifacts/next-chat-lazy-linux-rollout/results.json`.

On Windows desktop Chrome, worker `147a2f4810da97dedaab` upgraded `d5ab1889a7a0a24ee62a`. The test rehydrated an existing offline conversation and ran a real GGUF turn from verified local shards. A fresh offline browser process found the committed reply and generation receipt under the original owner. Recovery worker `abaf6e02f40324431a85` retained that result, the pending outbox and a held Next asset. The migration document remained accessible with its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-direct-app-router-write-first-release/package/web --new .artifacts/next-chat-lazy-release-verified/package/web --rollback .artifacts/next-chat-lazy-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. The transcript is `.artifacts/next-chat-lazy-release-verified/offline-gguf-chrome.log`.

This build also passed pairing, PC approval and both active proxy switch directions through the loopback TLS Relay. The same conversation and draft recovered after reconnect. The two turns reached the PC exactly once each and issued zero direct Cloud requests. Run `python tests/e2e_next_remote.py --dist .artifacts/next-chat-lazy-release-verified/package/web --caddy CADDY --relay-origin https://relay.kyalulu.com`. The transcript is `.artifacts/next-chat-lazy-release-verified/remote-pc.log`.

The separate Cloud rollout test switched Caddy in both directions during an admitted generation with SSE interrupted. One arm reloaded while the turn was pending. The browser recovered the same conversations and the test reconciled three browser POSTs, three fixture model calls, three settlements and zero holds. Run `python tests/e2e_online_active_rollout.py --dist .artifacts/next-chat-lazy-release-verified/package/web --caddy CADDY`. The transcript is `.artifacts/next-chat-lazy-release-verified/active-cloud-rollout.log`.

The 393 px Chromium Mobile migration run used the prior fixture exporter and the new release. Consent cancellation, cross-origin copy, export and replay, corruption rejection and opening the migrated conversation after reload passed. The original IndexedDB and OPFS contents survived. The run recorded zero API requests, external requests and page errors. Use the earlier `tests/e2e_mobile_migration.py` command with this release's `package/web` as `--app` and a fresh output directory. The report is `.artifacts/next-chat-lazy-mobile-import/results.json`.

The Chromium sync-conflict runs passed from `.artifacts/next-migration-pages` with both `--sync-conflict pending` and `--sync-conflict previously-received`. The lost acknowledgment resulted in one branch and both histories survived. The test preserved the earlier branch's message IDs. An initial run using the companion recovery worker stopped at the starting-state assertion for a previously received branch. The documented older worker reproduced that state before exercising the new release. See `sync-legacy-pending.log` and `sync-legacy-previously-received.log` in the verified release directory.

This archive pair is the measured predecessor for the optional shell changes below.

### Load optional shell features when needed

Build `aHylT3KTo5z5G7kC3DETZ` loads search when opened, connection settings when authentication requires that screen, the paired-PC setup when that execution target is selected, and conversation save status when the information panel is visible. The background sync trigger loads its implementation after rendering can yield, with a one-second deadline for scheduling the initial attempt in browsers that support idle callbacks. The 15-second interval and reconnect triggers remain in place. Account changes and pending turns are still checked by the sync implementation. The FastAPI runtime matched all 111 files in the preceding candidate.

The two Next.js dynamic imports initiated after the official chat's session writes requested 532,670 distinct JavaScript bytes in the previous build and 415,371 in this build, as listed in each production loadable manifest. These are decoded file sizes before any browser caching or compression. The sync module can still download in the background when an eligible owner is present.

The Next and Vite production builds, Web type checking and 87 focused tests passed. Vite's bundler reported that other statically loaded routes also import connection settings and sync, limiting the split in that build. The local Windows Chromium check verified that Ctrl+K opens search, Escape returns focus to the chat composer, and the save destination and preset library are available when requested. The existing held-Markdown response, settings retry, account switch, publication visibility and offline restart checks also passed. The transcript is `.artifacts/next-shell-release/coexistence-shortcut.log`.

The loopback Linux comparison kept the same browser profile, traffic shaping, deterministic provider, accounts and resource limits as the previous signed-in measurement. Next builds ran in before, after, after, before order, with eight concurrent profiles per batch. Vite ran once before and once after the new Next build in the two after rounds. The character-only route again crossed one document boundary to Vite chat.

| Median across 16 profiles per column | Next before | Next after | Vite after |
|---|---:|---:|---:|
| Open character to usable input | 1.84 s | 1.84 s | 5.88 s |
| Submit to chat URL | 2.11 s | 1.75 s | 0.48 s |
| Submit to visible chat textarea | 3.14 s | 2.89 s | 0.83 s |
| Submit to generation request | 3.88 s | 3.88 s | 1.83 s |
| Submit to visible first reply | 5.47 s | 4.89 s | 2.91 s |
| Per-profile sum of input and visible-reply waits | 7.39 s | 6.66 s | 8.78 s |

The paired textarea medians changed from 3.87 to 2.86 s and from 2.87 to 2.90 s. The paired visible-reply medians changed from 6.11 to 4.71 s and from 4.94 to 5.07 s. The median span from completed greeting insertion to the first history request remained 1.82 s. The pooled reply median improved while the paired runs differed in direction and the generation request started at the same pooled median. The dependency reduction gives a smaller startup payload. A repeatable latency gain remains unconfirmed. In the same after release, Next still lagged Vite by 2.06 s to the textarea and 1.98 s to visible reply after submit.

All 49 journeys persisted one reply and settled once with zero outstanding holds and no journey errors. Run `python .artifacts/next-shell-comparison/compare.py before 1`, then `after 1`, `after 2` and `before 2` with the named images in the driver. The four JSON reports contain the sanitized timings, fixture accounting, browser version and limits. All four temporary projects were removed.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-shell-release-verified/kyalulu-cloud.tar.gz` | `911f8e64d12ebdc77c5d` | `f2e0381392e7f029ce85088a91c4825b56b5981a00d3ecf323a58a79507a210b` |
| `.artifacts/next-shell-recovery/kyalulu-cloud.tar.gz` | `7238c4fb17f63c1808ea` | `3bf0f3ae02df041166e1da768656ab4cbb2ac9547e4010da2dced9e69b31512b` |

The verifier matched both archive hashes, pinned `https://relay.kyalulu.com`, checked 1,086 release members and 804 recovery members, and compared 988 corresponding-source files per archive. All 941 compared application members matched the measured bundle byte for byte. The release retains eleven older worker inventories, with the candidate's hashed assets also in the recovery bundle.

Linux Caddy 2.10.2 behind Docker Desktop passed 80 switch combinations across 20 routes and 235 successful HTTPS probe observations. The deliberate wrong-wave check failed as designed. Both the proxy rollback and the recovery image retained the authenticated history, draft and held asset. Run `python .artifacts/next-shell-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-shell`, `kyalulu-cloud-local:capacity-shell-final`, `kyalulu-cloud-local:shell-recovery` and `kyalulu-relay-local:capacity`. See `.artifacts/next-shell-linux-rollout/results.json`.

Windows Chromium passed the separate active Cloud and loopback paired-PC rollout suites for this build. The Cloud suite reconciled three browser POSTs, three fixture model calls, three settlements and zero holds. The PC suite recovered both pending turns after the two switches, with two PC submissions and zero direct Cloud requests. Both documented Chromium sync-conflict cases passed from `.artifacts/next-migration-pages`, including preserving the previously received branch's message IDs. The 393 px legacy Mobile import preserved the original IndexedDB and OPFS and reopened the migrated chat, with zero API requests, external requests and page errors. The logs are in `.artifacts/next-shell-release-verified/`. Reuse the prior section's commands with this candidate's `package/web` and the Mobile report at `.artifacts/next-shell-mobile-import/results.json`.

Desktop Chrome upgraded worker `147a2f4810da97dedaab` to `911f8e64d12ebdc77c5d`, ran a real offline turn from verified GGUF shards, and recovered the committed reply by generation ID in a fresh offline browser. Recovery worker `7238c4fb17f63c1808ea` booted the Vite device shell with the same result and outbox and kept the held Next asset available. The migration document kept its separate isolation policy. Use `python tests/e2e_next_device_upgrade.py --old .artifacts/next-chat-lazy-release-verified/package/web --new .artifacts/next-shell-release-verified/package/web --rollback .artifacts/next-shell-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. The transcript is `.artifacts/next-shell-release-verified/offline-gguf-chrome.log`.

This archive pair is the predecessor for the installed-worker upgrade below.

### Persist the official chat opening in one request

Build `b-pzzIs0TLDn7jO2UEaEL` uses one owner-scoped request to save the session settings and greeting for the direct signed-in official character journey when Cloud advertises support. FastAPI applies the existing origin, account, eligibility and settings checks. The settings, memory scope and assistant greeting commit in one tenant database transaction. An exact retry returns success for the same session ID and greeting. A request that would replace different settings or an existing conversation returns a conflict. The browser retains the draft and the exact settings for the attempt if it loses the response. Older responses can still use the existing settings and greeting sequence. The schema and saved history format are compatible with the previous runtime.

The backend test forced the greeting insert to fail after settings and memory scope had been written. All three rolled back. Concurrent requests created one greeting and returned one creation and one replay. The checks also covered account and origin rejection, a replay after settings changed, and the legacy greeting endpoint reading the same row. The Cloud wrapper retains its existing workspace revision update on successful requests, including retries, so a retry can publish a tenant commit that happened just before a process stopped.

Both frontend production builds, Web type checking, 70 focused frontend tests and 208 Python tests passed. The Windows browser fixture committed the opening and dropped the response. The retry used the same session ID and received replay success, then issued one quote and one generation. There was no split greeting request and the first reply remained present after refresh. The held Markdown, keyboard search, account switch, route rollback and offline boot checks also passed. See `.artifacts/next-opening-release/coexistence.log`.

The comparison requires one setup request and one settled generation in the new path, and a working split path with the feature flag absent. Assess setup, composer, generation request and reply timing individually. Treat a timing gain as repeatable only when the paired batch results agree in direction.

The two Docker runs used the same production Next and Cloud images, Caddy at 192 MiB, eight fresh mobile-sized Chromium profiles per batch, two fixture Relay Host sockets and the same shaped connection and mock generation provider. The browser fixture omitted the feature flag on the public character page for the control and let both paths navigate by App Router. The orders were split, atomic, atomic, split and atomic, split, split, atomic. The first run also exercised eight Vite journeys and one Next-character-to-Vite-chat pilot. All 73 visits produced one stored reply and one test settlement each, with zero outstanding holds or journey errors.

| Median across 32 Next profiles per path | Split writes | Atomic opening |
|---|---:|---:|
| Preparation requests before navigation | 2 | 1 |
| First preparation request to App Router request | 941 ms | 751 ms |
| Character page open to usable input | 1.74 s | 1.78 s |
| Submit to visible chat textarea | 2.86 s | 2.87 s |
| Submit to generation request | 3.81 s | 4.12 s |
| Submit to visible first reply | 5.15 s | 5.26 s |

The four paired preparation medians were 2,025 to 751 ms, 677 to 833 ms, 939 to 792 ms and 959 to 480 ms. Excluding the first batch of each Docker run as a sensitivity check gave preparation medians of 880 and 736 ms. The pooled composer time was nearly unchanged. The pooled generation request and reply times were later with atomic opening. Use the guaranteed request reduction and transaction behavior as the measured result. A repeatable end-to-end speed gain remains unconfirmed. In the eight matched-configuration Vite visits, the input and visible reply medians were 6.15 s from page open and 3.85 s from submit. The mixed-route pilot crossed one document boundary and settled once.

Run `python .artifacts/next-opening-comparison/compare.py` and then `python .artifacts/next-opening-comparison/compare.py --reverse`. The two JSON reports record all sanitized timing and ledger data, the browser version and resource limits. Both temporary projects were removed.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-opening-release/kyalulu-cloud.tar.gz` | `1226956705c34b707565` | `1f28eddef715e3cc885ca7523842883ef0d67e09ce6c018ed205ffe1bc500f84` |
| `.artifacts/next-opening-recovery/kyalulu-cloud.tar.gz` | `c3ce6055827fb89e83f3` | `e36acea9836d016a79c24f1863d919d6aeca988a6f7d243b27b9e8bef44b3eb5` |

The verifier checked 1,117 release members and 835 recovery members, compared 989 corresponding-source files in each bundle and pinned `https://relay.kyalulu.com`. The candidate and recovery use identical backend files. Only the chat handler and Cloud app changed among the 111 FastAPI files relative to the predecessor. The recovery restores the Vite distribution and keeps the candidate's immutable assets.

The local Linux rehearsal passed 80 switch combinations across 20 routes and 235 HTTPS observations. It checked the exact candidate and recovery images and verified history, draft and asset availability through both rollback paths. The deliberate wrong-wave check failed as designed. Run `python .artifacts/next-opening-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-opening`, `kyalulu-cloud-local:capacity-opening`, `kyalulu-cloud-local:opening-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. The report is `.artifacts/next-opening-linux-rollout/results.json`.

The Windows active Cloud test reconciled three browser POSTs, three mock provider calls, three settlements and zero holds while switching in both directions during a generation. Both paired-PC switches recovered their pending turns without any direct Cloud generation request. The legacy Mobile browser import preserved IndexedDB and OPFS and opened the recovered chat with zero API or external requests. Both old-client sync conflict cases passed, including the case with an already downloaded branch. Reuse the preceding release's browser commands with this candidate's `package/web`. The logs are in `.artifacts/next-opening-release/` and the import report is `.artifacts/next-opening-mobile-import/results.json`.

Desktop Chrome upgraded worker `911f8e64d12ebdc77c5d` to `1226956705c34b707565`. A real GGUF turn committed while offline, and a fresh offline browser found the same generation receipt and reply. Recovery worker `c3ce6055827fb89e83f3` booted the Vite device shell with the reply and pending outbox intact and the held Next asset available. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-shell-release-verified/package/web --new .artifacts/next-opening-release/package/web --rollback .artifacts/next-opening-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-opening-release/offline-gguf-chrome.log`.

This pair is the predecessor for the opening-revision upgrade below.

### Reuse the saved opening revision for the first send

The opening endpoint returns the existing stored-context revision in a response header from the same SQLite transaction that created or verified the opening. The unchanged tab-local draft carries this revision into the signed-in first send. If the loaded settings still match the current local settings, the chat skips the repeated settings PUT and sends the exact revision to both Cloud quote and generation. Opening responses without a valid revision use the previous path.

The backend regression confirmed that the returned revision matches the stored conversation and that a concurrent settings change causes rejection at quote and generation with zero ledger operations. A confirmed opening conflict keeps the draft, disables sending and offers to reload the conversation. The reload uses the existing draft recovery path and requires a fresh send action.

Compare the paths on the same production images by withholding the revision header only in the control browser. Require exactly one fewer settings PUT and one stored reply and settlement per completed visit. Compare timing across counterbalanced batches before treating it as a reproducible speed gain. Both arms compute the opening revision on the server, so this control isolates using the revision in the browser.

The Next and Vite production builds, Web type checking, 149 focused frontend tests and 208 Python tests passed.

Windows Chromium passed the dropped opening response case. The replay's revision reached the quote and generation unchanged, with one quote, one generation and no repeated settings PUT or context GET. A simulated quote conflict left the text in the disabled composer. The reload action restored the same editable draft without dispatching another generation. The run also passed the existing held Markdown, account switch, route rollback and offline boot checks. See `.artifacts/next-opening-revision-release/coexistence.log`.

Both Docker runs used the same Next and FastAPI images, Caddy at 192 MiB, eight fresh 393 × 852 Chromium profiles per batch, two fixture Relay Host sockets and a deterministic provider. The shaped network used 80 ms latency, 2 Mbps down and 750 kbps up. The batch orders were save, reuse, reuse, save and reuse, save, save, reuse. A separate character-only case crossed a single document boundary to Vite chat.

| Median across 32 Next profiles per path | Save settings again | Reuse opening revision |
|---|---:|---:|
| Settings PUTs before quote, including opening | 2 | 1 |
| Open character to usable input | 1.74 s | 1.74 s |
| Submit to visible chat textarea | 2.38 s | 2.41 s |
| First history request to quote request | 799 ms | 381 ms |
| Submit to quote request | 3.26 s | 2.78 s |
| Submit to generation request | 3.61 s | 3.39 s |
| Submit to visible first reply | 4.66 s | 4.52 s |

The four paired medians from the first history request to quote were 825 to 422 ms, 799 to 508 ms, 964 to 300 ms and 623 to 373 ms. Submit-to-quote also improved in all four pairs. Generation-request timing improved in three pairs. Reply timing changed direction across the two stack orders. Excluding the first batch of each stack gave pooled reply medians of 4.43 and 4.44 s. The measured gain is the earlier quote. A repeatable first-reply improvement remains unconfirmed.

All 65 visits produced one stored reply and one test settlement, with no outstanding holds or journey errors. Run `python .artifacts/next-opening-revision-comparison/compare.py` and then repeat with `--reverse`. The JSON reports retain the sanitized timings, ledger reconciliation and container limits. Both temporary projects were removed.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-opening-revision-release/kyalulu-cloud.tar.gz` | `499bb25f457d25859913` | `b47626754b2e3b3c435ffd17928ec53f18b4c8839d4a0ba57a3982b74ce12b18` |
| `.artifacts/next-opening-revision-recovery/kyalulu-cloud.tar.gz` | `5e35fd5ba74444eaab87` | `c38f4e987f0c25e34cc5b8f49f2eeada649a4968f82316a1519fc0117695c291` |

Build `6vaJtdSH-ftxNC5wYQ5nJ` retains thirteen prior worker inventories. The verifier checked 1,151 release members and 869 recovery members, compared 989 corresponding-source files per bundle and verified the exact Relay origin. The two bundles use the same FastAPI files. Relative to the previous candidate, only `runtime/python/api/chat.py` changed among the 111 runtime members.

The Linux Docker rehearsal passed 80 switch combinations on 20 routes and 235 successful HTTPS observations. It rejected the deliberate wrong-cohort check and verified the worker, source and held assets against both named archives. The signed-in browser retained the conversation and draft across proxy rollback and the recovery image. Run `python .artifacts/next-opening-revision-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-opening-revision`, `kyalulu-cloud-local:capacity-opening-revision`, `kyalulu-cloud-local:opening-revision-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. See `.artifacts/next-opening-revision-linux-rollout/results.json`.

Windows Chromium passed both active Cloud and paired-PC switch directions, both documented legacy sync conflict cases and the legacy Mobile import. The Cloud suite reconciled three model calls and settlements with three browser POSTs. The PC suite recovered two turns with two PC submissions and zero direct Cloud requests. The migrated chat reopened after reload and the source stores survived, with zero API requests, external requests and page errors in the import fixture. Reuse the prior commands with this candidate's `package/web`. Logs are in `.artifacts/next-opening-revision-release/` and the import report is `.artifacts/next-opening-revision-mobile-import/results.json`.

Desktop Chrome upgraded worker `1226956705c34b707565` to `499bb25f457d25859913`, ran a real GGUF turn offline and found the committed reply by generation ID in a fresh offline browser. Recovery worker `5e35fd5ba74444eaab87` booted the Vite device shell with the same reply and pending outbox. The held Next asset remained available, and the migration document kept its isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-opening-release/package/web --new .artifacts/next-opening-revision-release/package/web --rollback .artifacts/next-opening-revision-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-opening-revision-release/offline-gguf-chrome.log`.

This archive pair is the installed-worker predecessor for the shared-loader candidate below. The first-reply latency gap, staging verification, physical-device acceptance and production rollout remain open.

### Share route modules between preloading and rendering

In the preceding revision-reuse experiment, the median span from the App Router request to first history read was 1.60 s. This included 1.06 s to start the destination's status request and a median 433 ms from its completion to the first history request. The production manifest contained separate entries for the imperative and rendered imports of the same runtime and chat code.

The new build shares one import of each module between the official character handoff and the destination. If the component has finished loading by the time it is needed, the destination can render it immediately. A cold destination still uses the deferred component. Each mounted view keeps its initial component type. The loader holds only JS modules. It leaves the account check and all history reads at the destination and starts the preload after the session writes, alongside navigation.

The production manifest went from four Runtime and ActiveChat dynamic entries to two. The Next build, eight route and package checks and 48 focused frontend tests passed. The recovery distribution uses the same verified Vite build as the predecessor. Accept functional parity and count a reproducible startup timing gain only if the route-to-history measurements improve across both paired Docker orders.

The changed entries reference 11 distinct JavaScript files totaling 423,628 decoded bytes, compared with 13 files and 427,613 bytes before the change. Their CSS totals are both 91,528 decoded bytes. Windows Chromium passed cold entry, held Markdown, lost opening response, stale revision and draft reload, account switch, route rollback and offline startup. See `.artifacts/next-shared-loader-release/coexistence.log`.

The Docker comparison ran original, shared, shared, original with eight fresh Chromium profiles per batch. The 393 × 852 profile used 80 ms latency, 2 Mbps down and 750 kbps up. The FastAPI members, mock provider, Caddy resource cap and two fixture Relay Host sockets matched. All 33 visits, including the additional Next character to Vite chat case, persisted one reply and settled once. The ledgers had zero outstanding holds. The Next visits kept the same document, checked status before reading history and made one opening PUT before the quote. The mixed route made one document navigation. The four disposable projects were removed.

| Median across 16 Next profiles per build | Original loader | Shared loader |
|---|---:|---:|
| Character entry to usable input | 1,829 ms | 1,832 ms |
| Submit to chat URL | 1,535 ms | 1,638 ms |
| Route request to destination status request | 1,168 ms | 1,306 ms |
| Destination status completion to history request | 435 ms | 134 ms |
| Route request to history request | 1,704 ms | 1,592 ms |
| Submit to visible chat textarea | 2,418 ms | 2,347 ms |
| Submit to quote request | 2,840 ms | 2,720 ms |
| Submit to generation request | 3,329 ms | 3,228 ms |
| Submit to visible first reply | 4,407 ms | 4,029 ms |

Route request to history improved in both paired orders, from 1,858 to 1,638 ms and from 1,596 to 1,537 ms. The chat URL appeared later in both pairs. Textarea timing improved in one pair. Reply medians improved from 4,710 to 4,151 ms and from 4,277 to 3,938 ms. These are loopback fixture timings. Run `python .artifacts/next-shared-loader-comparison/compare.py` in the order `original 1`, `shared 1`, `shared 2`, `original 2` with the corresponding `capacity-opening-revision` and `capacity-shared-loader` images. The JSON files retain the request spans and ledger checks.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-shared-loader-release/kyalulu-cloud.tar.gz` | `077e1281f7b1f5461931` | `dc2fae113860713577d9a33386dee841c65aad8dea2acb1b3ffae58dc151efd6` |
| `.artifacts/next-shared-loader-recovery/kyalulu-cloud.tar.gz` | `5e35fd5ba74444eaab87` | `85e0683450d3b420c51ff4e545eb78ce38775e34abb8e621ff17004e576961a5` |

Next build `b8_TG8cfsHL3jIMKW90Ov` retains fourteen predecessor worker inventories. The verifier checked 1,192 release members, 910 recovery members and 990 workspace source files per archive, with Relay pinned to `https://relay.kyalulu.com`. All 111 FastAPI members match the previous candidate in both archives. The recovery keeps the old Vite output and serves the shared-loader candidate's retained assets.

The loopback Linux rehearsal passed 80 switch combinations across 20 routes and 235 successful HTTPS observations. It rejected the deliberate wrong-wave probe. The exact in-container files matched the extracted bundles. The signed-in browser kept its history and draft through both proxy rollback and the companion image, and a held Next chunk remained retrievable. The disposable Compose project was removed. Run `python .artifacts/next-shared-loader-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-shared-loader`, `kyalulu-cloud-local:capacity-shared-loader`, `kyalulu-cloud-local:shared-loader-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. See `.artifacts/next-shared-loader-linux-rollout/results.json`.

Windows Chromium passed both active Cloud and paired-PC switch directions against the candidate. The Cloud test recorded three browser POSTs, three mock provider calls, three settlements and zero outstanding holds. The paired-PC test committed both interrupted generations, with two PC submissions and zero direct Cloud requests. Both legacy sync-conflict cases passed, including lost acknowledgment after a conflict branch had already been downloaded. The Mobile import fixture kept IndexedDB and OPFS, restored the migrated chat after reload and recorded zero API requests, external requests and page errors. Logs are under `.artifacts/next-shared-loader-release/`, and the import report is `.artifacts/next-shared-loader-mobile-import/results.json`.

Desktop Chrome upgraded installed worker `499bb25f457d25859913` to `077e1281f7b1f5461931` and completed a real GGUF turn with the browser offline. A fresh offline process retrieved the same owner-scoped generation receipt and saved reply. Companion worker `5e35fd5ba74444eaab87` opened the recovery device shell with the receipt, outbox and held Next asset intact. The migration document kept its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-opening-revision-release/package/web --new .artifacts/next-shared-loader-release/package/web --rollback .artifacts/next-shared-loader-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-shared-loader-release/offline-gguf-chrome.log`.

This archive pair supplies the installed-worker predecessor for the runtime-priority candidate. The post-submit regression compared with Vite, designated staging, physical-device acceptance and the authorized production rollout remain open.

### Vite and Next on the shared-loader candidate

The two frontends ran against the same packaged FastAPI image, mock provider and Caddy setup under the same shaped mobile Chromium profile. One disposable stack ran Vite, Next, Next, Vite with eight fresh profiles per batch. All 32 visits persisted their first reply and settled once, with no outstanding holds or journey errors. The disposable project was removed.

| Median across 16 signed-in profiles per frontend | Vite | Next |
|---|---:|---:|
| Character entry to usable input | 5.89 s | 1.81 s |
| Submit to visible chat textarea | 0.84 s | 2.35 s |
| Submit to quote request | 1.56 s | 2.60 s |
| Submit to generation request | 1.86 s | 3.13 s |
| Submit to visible first reply | 2.95 s | 4.10 s |
| Sum of entry-to-input and submit-to-reply per profile | 8.84 s | 5.83 s |

Both pairs showed earlier input and longer post-submit waits on Next. The paired Vite and Next reply medians were 2.95 and 4.02 s, then 2.74 and 4.24 s. The median per-profile interval from generation request to visible reply was 1.12 s on Vite and 1.04 s on Next. Profile the session setup and chat initialization before quote and generation when addressing the post-submit gap. Keep both phases as cutover criteria. The combined wait improved by 34% on the fixture. Reproduce with `python .artifacts/next-shared-loader-comparison/compare_frontends.py`. The report is `frontend-parity.json` beside the script.

### Development workflow for public detail pages

The migrated work and author details are concrete examples. On the Vite path, `apps/web/src/App.tsx` registers the route and view, `cloudGuest.ts` classifies guest paths and known segments, and `runtime/python/api/mobile.py` admits the direct request to the shell. The shared React view reads the domain API. Matching the new initial HTML and share metadata would also require a server renderer entry in `runtime/python/cloud/public_pages.py`, whose legacy `_page` handles discovery and character detail.

On the Next path, `app/works/[workId]/page.tsx` and `app/authors/[authorId]/page.tsx` each consist of a route file with two delegating exports. The exports share request-scoped data in `app/_public/catalog.tsx`, which owns the initial content, canonical metadata and anonymous read. The existing interactive work and author views are registered in `app/_runtime/views.tsx` and reused during coexistence. A rollout path is written once in `apps/web/src/lib/onlineRouteGroups.json`, and `python scripts/sync_online_route_groups.py --write` generates the proxy matchers. FastAPI still owns visibility and access rules. Preview online changes with `pnpm --filter online dev` and the configured local backend, then verify public HTML and route switching with the built package and the Caddy fixture. This compares code and review steps for the existing examples. Authoring time has yet to be measured.

### Runtime code loading during the opening write

The selected build `b8_TG8cfsHL3jIMKW90Ov` starts loading runtime code after the opening response. In the matched frontend comparison, that code loaded before the destination could check status. The overlap experiment started just the Runtime import immediately after dispatching the atomic opening PUT. ActiveChat loaded after the write as before. The destination performed its own status check, and navigation and history waited for the successful write.

The production build, 36 focused Web tests, 13 Python tests and Windows coexistence test passed. The browser could retry a dropped opening response with the same session ID, then recovered one persisted reply. The experimental archive has Next build `9mfDTLd9-7tHvC4GBU7kQ`, worker `81f3a5d38364036e32c6` and SHA-256 `1bba27f412ddbf83e174b26b4b76fbceafbfc53e6e9a3ef1acb8d735ebdf1424`. The verifier checked 1,219 packaged members and 990 corresponding source files before the experimental source was reverted. All 111 FastAPI files and active Vite assets match the prior release.

The Linux fixture ran original, overlap, overlap, original. Each batch used eight fresh 393 × 852 Chromium profiles, 80 ms latency, 2 Mbps download, 750 kbps upload, a deterministic provider, a 192 MiB Caddy cap and two fixture Relay Host sockets. All 32 visits used a same-document transition, one opening PUT before quote and status before history. Each persisted one reply and settled once with zero outstanding holds. The four disposable projects were removed.

| Median across 16 profiles per arm | Original | Overlap |
|---|---:|---:|
| Opening PUT to response | 472 ms | 965 ms |
| Submit to destination status request | 1,924 ms | 1,671 ms |
| Submit to visible chat textarea | 2,357 ms | 2,351 ms |
| Submit to quote request | 2,516 ms | 2,515 ms |
| Submit to generation request | 3,134 ms | 3,141 ms |
| Submit to visible first reply | 3,939 ms | 4,196 ms |

The first code request started before the opening response in all 16 overlap profiles and none of the original profiles. Opening-response medians increased from 596 to 921 ms and from 438 to 1,000 ms in the two matched pairs. Visible-reply medians increased from 3,978 to 4,191 ms and from 3,920 to 4,317 ms. The source of the added wait during the write remains unresolved.

The experiment's source changes were reverted after measurement. To reproduce, run `python .artifacts/next-runtime-overlap-comparison/compare.py` with `original 1`, `overlap 1`, `overlap 2` and `original 2`, using the `capacity-shared-loader` and `capacity-runtime-overlap` image pairs. The reports retain timings and ledger counts from disposable accounts. The Windows coexistence log and the experimental bundle verification are in `.artifacts/next-runtime-overlap-release`.

### Prioritize runtime scripts after the opening response

The dedicated runtime import carries a Webpack fetch-priority hint. The first send still waits for the opening response, then loads the runtime and chat modules alongside App Router navigation. The runtime continues to check status before opening the chat. The build emits the hint on the runtime script tags. Chromium recorded high initial and final priority for all 128 runtime and shared script requests in the changed arm. The 48 chat-only requests in that arm retained low priority. All 176 matching script requests in the original arm had low priority.

The four eight-profile batches ran original, priority, priority, original, with the same shaped mobile Chromium settings and Docker caps as the overlap experiment. The 111 FastAPI files and active Vite assets match the baseline. All 32 visits completed one same-document handoff, one opening PUT, one stored reply and one settlement, with no outstanding holds. The destination status request preceded history in every case. The fixture removed all four projects. Production build and Windows coexistence passed, including dropped opening response, stale revision, draft recovery, account changes and rollback.

| Median across 16 signed-in Next profiles per arm | Original | Priority hint |
|---|---:|---:|
| Character entry to usable input | 1,810 ms | 1,909 ms |
| Opening PUT to response | 575 ms | 651 ms |
| Submit to destination status request | 2,008 ms | 1,848 ms |
| Submit to visible chat textarea | 2,397 ms | 2,364 ms |
| Submit to quote request | 2,640 ms | 2,480 ms |
| Submit to generation request | 3,319 ms | 3,061 ms |
| Submit to visible first reply | 4,664 ms | 3,917 ms |

Destination status began 158 ms and 166 ms earlier in the paired batches. The paired reply medians moved from 4.08 to 3.92 s and from 5.10 to 3.92 s. In the second pair the original also had a longer quote-to-generation interval. The paired status measurements are the repeatable timing result and the reply medians include variance after status. Run `python .artifacts/next-runtime-priority-comparison/compare.py` with `original 1`, `priority 1`, `priority 2` and `original 2`, using the `capacity-shared-loader` and `capacity-runtime-priority` image pairs. The JSON reports include the browser's script priorities, timings and ledger results.

#### Vite and Next on the runtime-priority build

The same release ran Vite, Next, Next, Vite with eight fresh profiles per batch. The additional character-only visit transitioned from the Next character page to Vite chat with one document request. All 33 visits persisted one reply and settled once, with zero outstanding holds. The fixture removed the project. Run `python .artifacts/next-runtime-priority-comparison/compare.py priority frontend` to reproduce `priority-frontend.json`.

| Median across 16 signed-in profiles per frontend | Vite | Next |
|---|---:|---:|
| Character entry to usable input | 5.93 s | 1.84 s |
| Submit to visible chat textarea | 0.83 s | 2.37 s |
| Submit to quote request | 1.49 s | 2.71 s |
| Submit to generation request | 1.86 s | 3.32 s |
| Submit to visible first reply | 2.95 s | 4.40 s |
| Sum of entry-to-input and submit-to-reply per profile | 8.84 s | 6.15 s |

Both pairs favored Next on entry to input and Vite on the post-submit wait. The median per-profile generation-request-to-reply interval was 1.07 s on Vite and 1.05 s on Next. The post-submit regression remains a cutover criterion. The combined wait fell by 30% in the fixture.

#### Public works and author visibility on the Community backend

The unified fixture intentionally disables the older Community APIs and checks the unavailable states. A separate loopback TLS fixture configured Cloud with Community enabled and seeded a public work and an author through the existing Python service. Chromium with JavaScript disabled displayed both initial pages. HTTP confirmed canonical links, Open Graph titles, `no-store`, and omission of a private input field. A signed-in viewer who blocked the author received neither public preview in the initial HTML and saw a denied state in the hydrated views. The same pages stayed available to an anonymous reader. Author withdrawal returned a 404 without the work title or summary, and the author's list showed no remaining works. The fixture used mock authentication state and rejected external provider calls. Run `python .artifacts/next-community-visibility/run.py --dist .artifacts/next-runtime-priority-release/package/web --caddy PATH_TO_CADDY` with build `go3yKhgbSdGQJrZ7N1U6k`. See `.artifacts/next-community-visibility/run.log`.

#### Runtime-priority archive pair

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-runtime-priority-release/kyalulu-cloud.tar.gz` | `2d5d83ee59d5faa60bae` | `c7a46846ab91755315e23aed04905421d62b6f4b500fb48f3f947ea3b97cc790` |
| `.artifacts/next-runtime-priority-recovery/kyalulu-cloud.tar.gz` | `5e35fd5ba74444eaab87` | `c9b91e787fc0bef24d6cd3cf36fabc25753973ac175a022cfb4277e6f4a1fba7` |

Next build `go3yKhgbSdGQJrZ7N1U6k` retains fifteen preceding worker inventories. The archives passed hash and Relay-origin verification, with 1,219 release members, 937 recovery members and 990 corresponding worktree files checked per archive. `apps/online/app/_runtime/chatRouteModules.ts` is the only corresponding-source file that changed relative to the shared-loader release. Recovery restores the verified Vite worker and retains the runtime-priority release's immutable assets.

The exact release and recovery passed the Linux rollout rehearsal with 80 switch combinations across 20 routes and 235 successful HTTPS observations. The probe rejected the deliberately mismatched cohort. History, draft and a held Next chunk survived both recovery procedures. The disposable project was removed. Run `python .artifacts/next-runtime-priority-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-runtime-priority`, `kyalulu-cloud-local:capacity-runtime-priority`, `kyalulu-cloud-local:runtime-priority-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. See `.artifacts/next-runtime-priority-linux-rollout/results.json`.

Windows Chromium preserved active Cloud and paired-PC generations through route switches in both directions. Cloud reconciled three browser POSTs with three mock model calls and three settlements. The paired-PC fixture committed both generations with two PC submissions and zero direct Cloud requests. The Mobile import retained IndexedDB and OPFS and reopened the migrated chat without API or external requests. Both legacy sync-conflict fixtures retained their histories after a lost acknowledgment. Logs are in `.artifacts/next-runtime-priority-release/`. The import report is `.artifacts/next-runtime-priority-mobile-import/results.json`.

Desktop Chrome upgraded installed worker `077e1281f7b1f5461931` to `2d5d83ee59d5faa60bae` and ran a real GGUF turn offline. It recovered the saved reply and generation receipt in a fresh offline browser process. Applying companion worker `5e35fd5ba74444eaab87` retained the receipt, outbox and held Next asset. The migration document kept its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-shared-loader-release/package/web --new .artifacts/next-runtime-priority-release/package/web --rollback .artifacts/next-runtime-priority-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-runtime-priority-release/offline-gguf-chrome.log`.

The runtime-priority archive pair supplies the installed-worker predecessor for the character-progress build below. The post-submit regression compared with Vite, designated staging, physical-device acceptance and production rollout remain open.

### Test separate loading of the navigation layout

In the runtime-priority build's matched frontend run, the first history request began 635 ms after submit on Vite and 2,322 ms on Next. The median interval from the later of history and settings completion to the quote request was 433 ms on Vite and 23 ms on Next. In Next the median from App Router request start to destination status start was 1,258 ms. The status request itself took 106 ms. This comparison points to the startup before the history request. Vite enters chat with a mounted application shell and the status request observed there is independent of the first history request.

The layout experiment moved the AppShell import behind the existing runtime gate and started downloading it in parallel with the Runtime and ActiveChat imports after the successful opening response. Runtime's manifest referenced 247,615 decoded JavaScript bytes instead of 259,352. The union for the full destination grew from 423,628 to 427,894 bytes and from 11 to 12 JavaScript files. The Windows browser held the layout-only script and verified that destination status completed while history, quotes and sends stayed pending. It released the script and completed the first send and the rest of the coexistence regression.

The Docker batches ran original, split, split, original with eight fresh profiles each. All 32 visits persisted one reply and settled once with zero outstanding holds. The four disposable projects were removed. Median opening-response-to-status increased from 1.09 to 1.51 s and median submit-to-visible-reply increased from 4.10 to 4.53 s. Reply medians increased from 3.87 to 4.28 s and from 4.46 to 4.88 s in the two paired orders. The source reverted to the combined runtime and navigation layout. The experimental build was `l7B1AnpOXzgUSWa3oalPl` with worker `bfee415742b8df5c3559`. Run `python .artifacts/next-app-shell-split-comparison/compare.py` with `original 1`, `split 1`, `split 2` and `original 2` using the `capacity-runtime-priority` and `capacity-app-shell-split` images. The held-script fixture is `coexistence_shell_order.py` beside the timing driver.

### Show progress from character submission to chat navigation

The official character composer exposes two phases in a persistent live region. It reports preparing while it checks the account and saves the opening, then reports opening while the browser requests the chat page. The same form remains busy through both phases. The error path clears progress and keeps the draft for retry. The browser uses the same account, session ID and opening revision checks for the first send.

The Windows coexistence regression held the response after the server committed the opening. It observed the preparing status and the disabled input, then dropped the response. Progress cleared, the draft survived and no generation was sent. On retry, the test held the App Router request and observed the opening status with no quote or generation. The successful retry reused the session ID, quoted and generated once, then displayed one saved reply. The loading message cleared when the chat opened. The production build and the rest of the Windows regression passed. See `.artifacts/next-character-start-status-release/coexistence.log`.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-character-start-status-release/kyalulu-cloud.tar.gz` | `253b1729c90e75ec7384` | `8933786b4c1b2bbbdc803fe0791456e162061b541615993566a0687d67899037` |
| `.artifacts/next-character-start-status-recovery/kyalulu-cloud.tar.gz` | `5e35fd5ba74444eaab87` | `f7ff309cfa5bfb0051693eb1287a436fb2c81a51b241766a6b40d8a67d4d8076` |

Next build `KQ3y36hqdh-gop0BBDsAF` retains sixteen predecessor worker inventories. The verifier checked 1,225 release members, 943 recovery members and 990 worktree source files per archive. The two differing corresponding-source files against the runtime-priority build are `CharacterComposer.tsx` and its Windows browser regression in `tests/e2e_online_coexistence.py`.

#### Vite and Next on the character-progress build

The exact release ran Vite, Next, Next, Vite with eight fresh signed-in profiles per batch and the same mobile network shaping. The extra character-only visit completed one document handoff from Next to Vite chat. All 33 visits persisted one reply and settled once with no outstanding holds. The fixture removed the disposable project. Run `python .artifacts/next-character-start-status-comparison/compare.py priority frontend` to reproduce `priority-frontend.json`.

| Median across 16 profiles per frontend | Vite | Next |
|---|---:|---:|
| Character entry to usable input | 5.88 s | 1.75 s |
| Submit to visible chat textarea | 0.95 s | 2.94 s |
| Submit to quote request | 1.84 s | 3.06 s |
| Submit to generation request | 2.16 s | 3.80 s |
| Submit to visible first reply | 3.66 s | 5.08 s |
| Sum of entry-to-input and submit-to-reply per profile | 9.53 s | 6.88 s |

The two reply pairs were 3.66 and 4.59 s, then 3.50 and 5.71 s, in Vite and Next order. The measurements reproduce the post-submit regression and a 28% lower combined wait. The progress display improves feedback. Its effect on latency relative to the preceding release remains unmeasured.

The Linux rehearsal passed 80 route switch combinations and 235 successful HTTPS observations. It preserved history, draft and held chunks through both recovery procedures, and removed the disposable project. The first attempt stopped because the fixture expected a different shared root script. The shared root scripts are byte-identical for this page-only change. The repaired fixture selects a changed predecessor script and checks the exact retained bytes. Run `python .artifacts/next-character-start-status-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-character-start-status`, `kyalulu-cloud-local:capacity-character-start-status`, `kyalulu-cloud-local:character-start-status-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. See `results.json`, `rehearsal.log` and `rehearsal-retry.log` in the fixture directory.

Windows Chromium passed the active Cloud and paired-PC recoveries in both switch directions. Cloud reconciled three browser sends, model calls and settlements. The paired-PC fixture issued two PC submissions and zero direct Cloud requests. Legacy Mobile import kept IndexedDB and OPFS and reopened the migrated chat. Both sync-conflict fixtures passed after a lost acknowledgment. The Community-enabled fixture also passed anonymous HTML without JavaScript, blocked-viewer checks and work withdrawal on this build. See `.artifacts/next-character-start-status-release/`, `.artifacts/next-character-start-status-mobile-import/results.json` and `.artifacts/next-community-visibility/character-progress.log`.

Desktop Chrome upgraded installed worker `2d5d83ee59d5faa60bae` to `253b1729c90e75ec7384`, completed a real GGUF turn offline and recovered the saved reply and generation receipt in a fresh offline process. Companion worker `5e35fd5ba74444eaab87` preserved the receipt, outbox and held Next asset. The migration document retained its isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-runtime-priority-release/package/web --new .artifacts/next-character-start-status-release/package/web --rollback .artifacts/next-character-start-status-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-character-start-status-release/offline-gguf-chrome.log`.

The character-progress archive pair supplies the installed-worker predecessor for the draft-prefetch build below. The post-submit regression, designated staging, physical-device acceptance and the authorized production rollout remain open.

### Test low-priority script fetching while drafting

The experiment takes the Runtime's hashed JavaScript paths from the packaged Next build manifest. After a signed-in visitor edits a nonempty draft, it waits 400 ms before making low-priority same-origin fetches for those immutable paths. The page requires the two Next route switches, a visible document, the Cloud target and an inactive data saver. Submit aborts pending fetches synchronously. The normal Runtime and ActiveChat imports still execute after the opening response. The destination performs the existing account check before opening history.

A direct background Runtime import also brings in global CSS and executes modules. The cache-only variant keeps stylesheet loading and module evaluation in the navigation path. The browser fixture observes the input position, computed styles and focus before and after the drafting pause. It records runtime-script HTTP-cache hits and cancellation, the first attributed API request, quote, generation, reply and ledger. The data saver control replaces only the value read by the app, so the route pipeline and network shaping match on the exact same build.

| Median across 16 signed-in profiles per arm after a 2.5 s drafting interval | Vite | Next control | Next cache warming |
|---|---:|---:|---:|
| Character entry to visible input | 5.87 s | 1.75 s | 1.74 s |
| Submit to visible chat textarea | 0.95 s | 2.94 s | 1.89 s |
| Submit to quote request | 1.83 s | 3.10 s | 2.15 s |
| Submit to visible first reply | 3.39 s | 4.93 s | 4.15 s |
| Sum of entry-to-input and submit-to-reply per profile | 9.26 s | 6.66 s | 5.91 s |

The two Next reply pairs were 5.22 and 3.97 s, then 4.67 and 4.40 s, in control and warming order. Each warmed profile fetched eight runtime scripts at low priority before submit and reused all eight from its HTTP cache when opening chat. Geometry, computed colors and input focus stayed stable. No chat API, quote or write ran during that pause. The listed waits exclude the matched drafting interval. The remaining post-submit difference compared with Vite in this workload was approximately 0.75 s.

The eight immediate-submit profiles did not start a background fetch before submit. In the separate 550 ms experiment, each of the eight warmed profiles started eight fetches and cancelled seven as it entered submit. Each reused one cached script. The partial-control and partial-warm reply medians were 4.43 and 4.34 s. These single pairs show the mechanisms and report observed timings. Replicated latency effects for quick and partial starts remain unmeasured. The mixed character-only route made one document navigation to Vite, with zero runtime prefetch requests.

All 81 visits completed with one provider call, persisted reply and settlement each, and zero outstanding holds. Every Next route waited for its opening write and destination account status before reading history. The disposable stack was removed. To reproduce, run `python .artifacts/next-draft-script-prefetch-comparison/compare.py` using `:capacity-draft-script-prefetch` images. `draft-script-prefetch.json` contains the final report, and `completed-batches.json` checkpoints each reconciled batch. The earlier attempt completed 64 visits before the fixture's hard-coded registration limit prevented the mixed-route account from being created. The new driver gives its disposable fixture 100 account slots. The packaged release and FastAPI settings are held constant across comparison arms.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-draft-script-prefetch-release/kyalulu-cloud.tar.gz` | `99b72b10c197404c0d34` | `d315202bcdcddf71905eb13b3f88df017de2058a43bda47978b13de26ada099d` |
| `.artifacts/next-draft-script-prefetch-recovery/kyalulu-cloud.tar.gz` | `5e35fd5ba74444eaab87` | `211f850e6a317d1b32e77c4e462d1a0c56b91bd418edf2049a9b08d2520f9a14` |

Next build `JxjEvnbg9dxesjjdaW54N` retains seventeen preceding worker inventories. The verifier checked 1,231 release members, 949 recovery members and 991 corresponding worktree files per archive. The corresponding-source diff from the character-progress build consists of the private manifest reader, the character page and its composer. Windows Chromium passed the held opening response and navigation, stale revision, account switch, draft, chat and rollback checks on the exact build. See `.artifacts/next-draft-script-prefetch-release/coexistence.log`.

The Linux rehearsal passed 80 route switch combinations and 235 successful HTTPS observations. History, draft and held assets survived proxy and companion-image recovery. The deliberate wave mismatch was rejected and the temporary project was removed. Run `python .artifacts/next-draft-script-prefetch-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-draft-script-prefetch`, `kyalulu-cloud-local:capacity-draft-script-prefetch`, `kyalulu-cloud-local:draft-script-prefetch-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. See the fixture's `results.json`.

Windows Chromium passed active Cloud generation and paired-PC switches in both directions. Cloud recorded three browser POSTs, three model calls and three settlements. The paired-PC fixture recorded two PC submissions and zero direct Cloud requests. The older Mobile import retained IndexedDB and OPFS with zero API requests, external requests or page errors. Both lost-acknowledgment sync-conflict cases passed. See `.artifacts/next-draft-script-prefetch-release/` and `.artifacts/next-draft-script-prefetch-mobile-import/results.json`.

Desktop Chrome upgraded installed worker `253b1729c90e75ec7384` to `99b72b10c197404c0d34`, completed a real GGUF turn offline and retrieved the saved reply and generation receipt in a fresh offline browser process. Companion worker `5e35fd5ba74444eaab87` retained the receipt, outbox and held Next asset. The migration document kept its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-character-start-status-release/package/web --new .artifacts/next-draft-script-prefetch-release/package/web --rollback .artifacts/next-draft-script-prefetch-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-draft-script-prefetch-release/offline-gguf-chrome.log`.

The draft-prefetch archive pair supplies the installed-worker predecessor for the chat route recovery candidate below.

### Recover a chat when its JavaScript fails to load

The chat list and conversation share App Router loading and error boundaries. Both reuse the same localized loading message while their runtime or view loads. The chat error screen focuses its heading, offers a full reload of the current URL and links to the chat list. Next owns the error boundary for its interactive routes, with a page reload available on the general fallback. The legacy app retains its existing boundary.

The Windows coexistence fixture interrupted a required ActiveChat script after opening a signed-in conversation. It saw the English loading message in the authenticated shell, then keyboard focus on the error heading. Reload restored the same conversation URL and editable draft, with zero automatic quotes or generation requests. An explicit click submitted the draft once and retrieved one saved reply. A second refresh left a single reply. SQLite confirmed one settlement and one user message for this fixture account. The remaining Japanese journeys, account switching, cancellation, branching, publication visibility and rollback suite passed alongside it. The first combined test shared the account with six existing turns and could hit the production limiter of six generations per minute. The recovery case has its own fixture account. See `.artifacts/next-chat-route-boundary-release/coexistence.log`.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-chat-route-boundary-release/kyalulu-cloud.tar.gz` | `81604fac7cda7b3ae300` | `5f6bb437dd594b8ea22e4954f12d527fa2b9403ed11c6a3c33a278de24ce8ba3` |
| `.artifacts/next-chat-route-boundary-recovery/kyalulu-cloud.tar.gz` | `5e35fd5ba74444eaab87` | `b9706a33a7677454bd9a0eb7a010d9f43e41de09781ce2478c4b7448b24ec458` |

Next build `xLA8kbpV_XfXmnT_Tst8q` retains eighteen preceding worker inventories. The verifier checked 1,275 release members, 990 recovery members and 994 corresponding worktree files in each archive. FastAPI and active Vite assets match the preceding build.

The same-release timing run used loopback Linux Docker, disposable signed-in profiles, a deterministic provider and two active fixture Relay Host sockets. Fresh Chromium 151.0.7922.34 profiles used a 393 × 852 CSS pixel viewport, DPR 2, 80 ms network latency, 2 Mbps down and 750 kbps up. The HTTP cache was available and service workers were blocked. The run used four eight-profile batches in Vite, warmed Next, warmed Next and Vite order. Each profile drafted for approximately 2.5 s before submit. The times below exclude that interval. The highest sampled aggregate service memory was 536.36 MiB on Vite and 623.48 MiB on Next under these local limits.

| Pooled median across 16 profiles per frontend | Vite | Next |
|---|---:|---:|
| Character entry to visible input | 5.90 s | 1.74 s |
| Submit to visible chat textarea | 0.94 s | 1.82 s |
| Submit to quote request | 1.87 s | 2.04 s |
| Submit to generation request | 2.39 s | 2.61 s |
| Submit to visible first reply | 3.72 s | 3.63 s |
| Sum of entry-to-input and submit-to-reply per profile | 9.59 s | 5.48 s |

The first pair's reply medians were 4.26 s on Vite and 3.62 s on Next. The reverse pair gave 3.68 s on Next and 3.21 s on Vite. The character entry improvement held in both pairs. Chat textarea appearance took longer on Next in both pairs. First-reply latency varied with the pair, so the pooled difference leaves a release decision open. Each Next profile reused all eight prefetched runtime scripts from its HTTP cache. The mixed character-only case made one document navigation to Vite and skipped prefetch. All 33 visits had one quote POST, one generation POST, one model call, one saved reply and one settlement each, with zero outstanding holds. The disposable Compose project was removed. Run `python .artifacts/next-chat-route-boundary-comparison/compare.py` with the `:capacity-chat-route-boundary` images. See `same-release.json` for the exact timings and resource limits.

The Linux Docker rehearsal passed 80 switch combinations across 20 declared routes and 238 HTTPS checks across the configured waves and recovery phases, including 24 expected 404 responses. The probe rejected the deliberate wave mismatch. The Next and FastAPI files inside the running containers matched the extracted bundles by SHA-256. The authenticated browser kept its history and draft through both Caddy rollback and the companion image, and the held Next chunk remained accessible. The disposable project was removed. Run `python .artifacts/next-chat-route-boundary-linux-rollout/rehearse.py` with `kyalulu-online-local:capacity-chat-route-boundary`, `kyalulu-cloud-local:capacity-chat-route-boundary`, `kyalulu-cloud-local:chat-route-boundary-recovery`, `kyalulu-relay-local:capacity` and Caddy 2.10.2. See the rehearsal's `results.json`.

Windows Chromium passed the active Cloud and loopback paired-PC generation switches. Cloud reconciled three browser POSTs, model calls and settlements, with zero outstanding holds. The Relay fixture recorded two PC submissions across its two switches and zero direct Cloud requests. Both older installed-client sync-conflict cases preserved history. The legacy Mobile import retained IndexedDB and OPFS with zero API requests, external requests and page errors. See the logs under `.artifacts/next-chat-route-boundary-release/` and the report under `.artifacts/next-chat-route-boundary-mobile-import/`.

Desktop Chrome upgraded installed worker `99b72b10c197404c0d34` to `81604fac7cda7b3ae300` with verified model files seeded into a disposable browser profile. Chrome completed a real GGUF turn offline, then recovered the saved reply and receipt by generation ID in a fresh offline process. Companion worker `5e35fd5ba74444eaab87` kept the receipt, pending outbox and held Next chunk. The migration document retained its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-draft-script-prefetch-release/package/web --new .artifacts/next-chat-route-boundary-release/package/web --rollback .artifacts/next-chat-route-boundary-recovery/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-chat-route-boundary-release/offline-gguf-chrome.log`.

### Compare prefetching the chat view during drafting

The selected release warms eight Runtime scripts. Experimental build `7DVLDkOAsIVjGUEUa-NDE` also warmed the three remaining immutable ActiveChat scripts when an eligible signed-in visitor drafted on the official character page. It used the same low-priority, cancellable fetches. Script execution and styles were still deferred until navigation. The experimental bundle used the same 111 FastAPI files and 259 Vite assets as the selected release.

The same-build comparison used the preceding Docker and Chromium network profile. Four eight-profile batches alternated Runtime only, Runtime and ActiveChat, Runtime and ActiveChat, and Runtime only. Each profile drafted for approximately 2.5 s before submit. The control intercepted only the three extra low-priority cache-fill fetches before they reached the network. Both arms used the normal HTTP cache and identical submit code. A browser observer recorded when the visible chat textarea became enabled, separately from its first appearance.

| Pooled median across 16 profiles per arm | Runtime only | Runtime and ActiveChat |
|---|---:|---:|
| Draft-time transferred script bytes, including response overhead | 88,893 | 147,055 |
| Submit to visible textarea | 1.89 s | 2.15 s |
| Submit to editable textarea | 2.08 s | 2.15 s |
| Opening response to editable textarea, estimated per profile | 1.25 s | 1.01 s |
| Submit to visible first reply | 3.95 s | 4.22 s |

The editable-textarea median after the opening response moved from 1.25 to 0.80 s in the first pair and from 1.26 to 1.06 s in the reverse pair. The submit-to-editable result changed direction across those pairs. First-reply medians were 4.11 to 4.42 s and 3.69 to 3.91 s in Runtime-only and expanded-prefetch order. All prefetched scripts were reused, and focus, input geometry and computed styling stayed stable while drafting. Every visit made one quote and generation, retained one reply and settled once. The mixed-route case skipped prefetch and crossed one document boundary. All 33 visits completed with zero outstanding holds, and the fixture removed its Compose project.

The first pair's pre-write `/api/mobile/status` response arrived at median 131 and 964 ms after submit. In the reverse pair it arrived at 126 and 143 ms in Runtime-only and expanded-prefetch order. The measured time from the opening write to its response was similar across the pooled arms. The cause of the first pair's status delay remains unknown. Look at this status round trip independently of the opening write when analyzing the next timing run.

The source returned to Runtime-only prefetch after the extra draft-time transfer produced inconsistent submit-to-editable results and slower first replies in both pairs. At that point the selected release `xLA8kbpV_XfXmnT_Tst8q` matched all 994 corresponding worktree files. To reproduce, copy `.artifacts/next-chat-view-prefetch-comparison/compare.py` into a fresh directory directly under `.artifacts/` and run it with the experimental bundle and `:capacity-chat-view-prefetch` images. See the original `same-release.json` for the full timings, cache counts and ledgers.

### Read authentication status without reserving SQLite's writer lock

The prior Cloud runtime used `BEGIN IMMEDIATE` to read the current session and account. The Windows regression test starts a separate SQLite transaction and leaves an account suspension uncommitted. Before the change, `GET /api/mobile/status` exhausted the SQLite lock wait and raised `database is locked`. With read-only connections the same endpoint returns the last committed state while the transaction is open. After commit it reports the session unauthenticated and revokes the session row.

`SupabaseAuth._owner` and account lookup without consent now use SQLite read-only connections. The refresh and revalidation path, per-token lock, revocation, consent enrollment and all account writes retain their existing transactions. The read path opens the current database and observes committed data on each request. This removes one source of writer-lock contention. The fixture has no evidence that this caused the earlier single-batch delay. The 51 focused tests passed, covering Cloud authentication and routes.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-auth-read-release/kyalulu-cloud.tar.gz` | `81604fac7cda7b3ae300` | `58e89edf3607e05470ff946e9c93780423d313e543d45065366be8029c8eabb5` |
| `.artifacts/next-auth-read-recovery/kyalulu-cloud.tar.gz` | `5e35fd5ba74444eaab87` | `92c9115a733ff0d8ab3c0a99900fe21e3f0f33d2182e5bf6df4b09eb9cc69ee1` |

Both archives passed integrity, Relay origin and corresponding-source checks against 994 worktree files. Comparing each with its chat-route-boundary predecessor by member hash shows two changed runtime files, `cloud/auth.py` and `cloud/store.py`, and the corresponding-source archive, which also includes the regression test. The frontend assets, Next build, service workers and release manifests are byte-identical. Run `package_release.py` in `.artifacts/next-auth-read-comparison/` to reproduce the artifact assembly. It uses the existing verified Next build and retained worker inventories.

The loopback Docker workload used the same Next build, Chromium network profile, Runtime script prefetch, 2.5 s drafting interval and deterministic provider. It ran eight signed-in profiles per batch in baseline, reader, reader, baseline order. The FastAPI fixture added a numeric header for elapsed time from ASGI entry through response headers on status, opening and quote requests. Chromium CDP independently measured from the request event through response headers. The header is confined to the fixture. The browser interval also includes scheduling and transport outside the measured application interval.

| Pooled median across 16 profiles per arm | Baseline | Read-only lookups |
|---|---:|---:|
| First status, measured FastAPI handling | 1.38 ms | 1.69 ms |
| First status, browser request to response headers | 217 ms | 520 ms |
| Opening write to response | 1.04 s | 0.82 s |
| Submit to visible chat textarea | 2.39 s | 2.41 s |
| Submit to first visible reply | 4.64 s | 5.10 s |

The first status browser medians, in run order, were 111, 933, 100 and 327 ms. The corresponding FastAPI medians were 1.41, 1.50, 2.12 and 1.24 ms. In the slowest batch the median DevTools interval from send start to the first response headers was 924 ms. This places most of that delay outside the measured FastAPI interval. The fixture did not isolate Docker forwarding, Caddy, server ingress and Chromium's shaped transport. Visible reply medians were 5.02 to 5.00 s and 4.05 to 5.19 s in baseline and reader order. Use the deterministic lock test as evidence for the reliability fix. The timing workload gives no repeatable improvement in the browser's first reply.

All 32 journeys completed one same-document handoff, one quote, one generation and one persisted reply. The model calls and ledger settled once per profile with zero outstanding holds. All four projects were removed. Run `measure.py` with arguments `baseline 1`, `reader 1`, `reader 2` and `baseline 2` in order, from a fresh copy of the driver one directory below `.artifacts/`. Use the `:capacity-chat-route-boundary` Node image and the two Cloud images selected by the driver. See the four JSON files in the original fixture directory. A preliminary run completed generation but failed the fixture timing parser. The recorded comparison used the corrected numeric match for all four batches.

Linux Docker passed all 80 switch combinations across 20 routes and 238 HTTPS checks, including 24 expected 404 responses. The deliberate wrong-wave probe failed as designed. Both proxy and companion-image recovery preserved the authenticated conversation, draft and held chunk. The temporary project was removed. Run `rehearse.py` in the fixture directory with `kyalulu-online-local:capacity-chat-route-boundary`, `kyalulu-cloud-local:capacity-auth-read`, `kyalulu-cloud-local:auth-read-recovery` and `kyalulu-relay-local:capacity`. See `results.json`.

Windows Chromium ran the active Cloud generation regression against the packaged Next build and the updated FastAPI source. Three model requests and three settlements matched the browser submissions, with no outstanding holds. Pending generations remained recoverable after both directions of proxy switching. See `active-cloud.log`. The prior worker upgrade and offline inference results cover the identical frontend assets and worker bytes. The new run verifies Cloud authentication and runtime recovery on the updated backend.

### Measure Caddy and browser time separately

The selected release ran behind Caddy 2.10.2 on loopback Linux Docker. Four eight-profile batches used 0.25, 1, 1 and 0.25 CPU for Caddy. Its 192 MiB cap, the other service limits, the 80 ms shaped Chromium profile, the 2.5 s drafting interval and the exact application images stayed fixed. Only the fixture Caddyfile adds timing headers. It records entry to the Cloud reverse-proxy branch and upstream response headers. The browser independently records request and response events. Each profile sent once, persisted one reply and settled once. The 32 journeys left zero outstanding holds, and all four temporary projects were removed.

| Pooled median across 16 profiles per arm | 0.25 CPU | 1 CPU |
|---|---:|---:|
| First status inside FastAPI | 1.38 ms | 1.03 ms |
| First status from Caddy proxy entry to upstream headers | 13 ms | 9 ms |
| First status from browser request to response headers | 111 ms | 323 ms |
| Submit to visible chat textarea | 2.16 s | 2.01 s |
| Submit to first visible reply | 4.69 s | 4.26 s |

Caddy recorded 18 and 15 throttled periods in the two 0.25 CPU batches and zero in both 1 CPU batches. The two paired reply comparisons moved from 4.73 to 3.99 s and from 4.09 to 4.52 s in 0.25 to 1 CPU order. The 1 CPU batches still spent roughly 315 ms outside the measured Caddy-to-upstream segment for the first status. Eliminating observed Caddy throttling leaves the status delay and a repeatable reply improvement unresolved.

Reproduce the quota comparison by copying `measure.py` and `summarize.py` from `.artifacts/next-proxy-capacity-comparison/` to a fresh child of `.artifacts/`. Run `measure.py` with `quarter 1`, `whole 1`, `whole 2` and `quarter 2` in order using the named local images. Run `summarize.py` to reconcile the 32 results and build the timing summary.

Two additional eight-profile batches at 1 CPU added local TLS clock probes before and after the workload. These probes bound the host-to-container clock offset to a range about 45 ms wide. Median first-status browser times in these batches were 101 and 105 ms. The estimated median lower bounds from Caddy receiving the upstream headers to Chromium seeing the response were 89 and 87 ms, respectively. These estimates locate much of the time in the normal-latency runs after the measured Caddy stage. The 323 ms batch medians from the quota comparison and the earlier 933 ms batch median did not recur with the additional probes. Their location within the unmeasured stages remains unresolved. All 16 extra journeys settled once and the disposable projects were removed. Use `locate.py` with `whole 1` and `whole 2` to reproduce these clock measurements. Repeat the stage timings on the designated network before setting proxy CPU limits.

### Recover shared online screens when their JavaScript fails to load

The App Router screen wrapper supplies a Japanese or English live status. Runtime startup, the initial account check, remote shell startup and lazy view loading can display the same status. A public preview continues to render before the shell starts. Chat routes supply their existing conversation-specific copy. Both error boundaries use the same focus and reload behavior. The generic recovery screen enables a return home, and the chat recovery screen links to the chat list.

The production Windows Chromium fixture held the first account-status response on the creation route, then held the built Create chunk. It observed the localized loading status in both phases in both languages. After the script was aborted, the focused heading announced the failure. Reload in the English case preserved the query and fragment and opened the guest Create screen. Keyboard navigation in the Japanese case activated Home. The full coexistence suite also passed the chat-specific failed-script case, draft and account isolation, public visibility, member and moderator flows, rollback and offline restart. See `.artifacts/next-page-recovery-release/coexistence.log`. The Next and Vite builds, Web type check and 11 focused routing and package tests passed.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-page-recovery-release/kyalulu-cloud.tar.gz` | `fe2e60537bd0735f3da1` | `f123bdc1f5304b0c1fa9b43cf47d4fb287bdaad2c63e262f9e61a4b39e41eb89` |
| `.artifacts/next-page-recovery-fallback/kyalulu-cloud.tar.gz` | `b430468eda289c69d340` | `09c78fb55c3b8c428b356951aca42af4e524de6b7a420ec796b22223edc44d56` |

The verified Next build is `xcJgumLDEGjA_lspqNI92`. Both archives match 996 corresponding worktree source files. The package contains the preceding immutable assets required by nineteen installed worker inventories. The 111 FastAPI files match the previous release byte for byte. Compared with the prior build, the eight runtime-import scripts went from 258,492 to 258,502 decoded bytes and the four Create-import scripts remained at 272,015 decoded bytes. The root error chunk gained 988 decoded bytes. The signed-in browser timing comparison for this build follows below.

Linux Docker passed the 80 switch combinations for 20 routes and 238 HTTPS probe checks, including 24 expected 404 responses. The deliberate wrong-wave probe failed as designed. A signed-in Chromium session retained its history and draft through both the proxy switch and the companion-image switch. The held Next chunk stayed retrievable and the disposable project was removed. Run `python .artifacts/next-page-recovery-linux/rehearse.py` with `kyalulu-online-local:page-recovery`, `kyalulu-cloud-local:page-recovery`, `kyalulu-cloud-local:page-recovery-fallback` and `kyalulu-relay-local:capacity`. See `results.json`.

Windows Chromium passed active Cloud and paired-PC generation switching in both directions. The Cloud fixture reconciled three browser POSTs, model calls and settlements with zero outstanding holds. The Relay fixture recorded two PC submissions and zero direct Cloud requests. The 393 px legacy Mobile import preserved IndexedDB and OPFS without API calls or external requests. Both installed-client sync-conflict cases kept one conflict branch with both histories. See the exact build logs in `.artifacts/next-page-recovery-release/` and the import report in `.artifacts/next-page-recovery-mobile-import/`.

Desktop Chrome upgraded worker `81604fac7cda7b3ae300` to `fe2e60537bd0735f3da1` using verified GGUF model files imported into disposable OPFS. It generated a reply offline and found the saved reply and generation receipt in a fresh offline process. Companion worker `b430468eda289c69d340` preserved the receipt, pending outbox and held Next chunk. The migration document kept its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-auth-read-release/package/web --new .artifacts/next-page-recovery-release/package/web --rollback .artifacts/next-page-recovery-fallback/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-page-recovery-release/offline-gguf-chrome.log`.

### Compare the latest build across three drafting intervals

The session-start comparison uses Next build `xcJgumLDEGjA_lspqNI92` and its Vite fallback under the same Caddy and FastAPI stack. Measure entry to the character input, submit to visible chat textarea, submit to editable chat textarea and submit to first visible reply independently. In each of the three drafting conditions, the matched local acceptance bounds are the two paired Vite medians. A stage meets the local bound when both Next batch medians are at or below their respective Vite baselines.

The fixture uses the same 393 × 852 Chromium viewport, 80 ms emulated latency, 2 Mbps down, 750 kbps up and deterministic provider. Each measured batch uses eight fresh signed-in profiles and two active fixture Relay Host sockets. Browser HTTP cache is available and service workers are blocked. The two frontend orders are balanced within each of three requested drafting intervals, immediate, 550 ms and 2.5 s. The editable-field observer records the actual input-to-click and click-to-enabled intervals in the browser, including same-origin document navigation.

| Pooled median in seconds, Vite → Next, 16 profiles per frontend | Immediate | Short draft | Full draft |
|---|---:|---:|---:|
| Character entry to visible input | 5.90 → 1.71 | 6.09 → 1.76 | 6.02 → 1.65 |
| Submit to visible chat textarea | 0.88 → 2.35 | 0.84 → 2.36 | 1.34 → 1.85 |
| Submit to editable chat textarea | 1.24 → 2.72 | 1.22 → 2.67 | 1.99 → 2.18 |
| Submit to first visible reply | 3.45 → 4.84 | 3.42 → 4.52 | 4.62 → 4.05 |
| Entry-to-input plus submit-to-reply per profile | 9.39 → 6.68 | 9.40 → 6.23 | 10.67 → 5.64 |

Actual input-to-click times ranged from 35 to 45 ms, 586 to 625 ms and 2,548 to 2,589 ms across the respective groups. The table excludes these drafting intervals. Entry to visible input and the two waits combined met the paired Vite bounds in all three conditions. Visible chat textarea arrival missed the bound in both pairs in each condition. The editable textarea and visible reply missed both paired bounds for immediate and short drafts. Their full-draft pairs changed direction. Next reply waits were 1.49 and 1.21 s longer on immediate sends, 1.42 and 0.94 s longer on short drafts, and 0.11 s longer and 1.14 s shorter on full drafts. The first quote began 0.43–1.14 s later on immediate sends and 0.78–1.03 s later on short drafts. These stage timings identify a reproducible wait before the quote in the two quick-submit conditions. They leave the underlying cause open.

The immediate arm initiated zero prefetches. Across the 16 short-draft Next profiles, 128 Runtime fetches started, 13 finished, 115 were cancelled and 17 script requests hit the browser cache. All 128 Runtime fetches completed and were reused by the 16 full-draft Next profiles. The separate character-only case made one document navigation to Vite with zero prefetches. All 97 journeys reconciled one quote, generation, stored reply and settlement apiece, with zero outstanding holds. The disposable Compose project was removed.

For reproduction use `compare.py` and `summarize.py` in `.artifacts/next-page-recovery-performance/` with both `:page-recovery` images. Copy the scripts to a fresh child of `.artifacts/` to retain the original reports. See `same-release.json`, `completed-batches.json` and `summary.json`. A preliminary run completed eight legacy generations before the timing observer failed to recognize the icon-only submit button. Counting the accessible label as well as visible text repaired the measurement before the 97-journey run.

### Confirm delivery on the atomic conversation opening response

The signed-in official-character flow previously performed a fresh mobile status GET before its atomic opening PUT. The PUT already checks the request origin, the current session owner's identity, the expected owner header and eligibility. The packaged Caddy site now marks status and opening responses with `X-Kyalulu-Next-Opening` when both source and destination route groups deliver Next for that cohort. With that initial capability and atomic opening support, the browser can start the owner-guarded write directly. The destination still checks status before history.

The old status-first path remains available for existing proxy configurations, guest visits, mixed route ownership and split opening settings. If a successful write lacks the delivery signal, the browser opens the exact saved conversation by document navigation and retains the draft for explicit review. The same session ID is still used after a lost response. Sign-out and owner mismatch close the stale composer. The owner draft remains scoped in storage.

The Windows browser test removed the delivery signal from a real successful opening response and verified a document navigation to that session, the original editable draft and zero quote or generation requests. The full coexistence suite also passed lost-response retry, stale revision, sign-out and execution target changes, localized page and chat recovery, normal App Router first send and rollback. See `.artifacts/next-opening-delivery-release/coexistence.log`. The first regression run stopped because Playwright could not wrap a built-in list method as an event listener. The corrected test runs with the same packaged application bytes. The correction is included in the corresponding-source archive in the table.

| Local bundle | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-opening-delivery-release-verified/kyalulu-cloud.tar.gz` | `e5e292f29da6a318f464` | `d851677baccf12300ceffb98f5cd4aded4a59fd7e5a88227c2bcd756708830b7` |
| `.artifacts/next-opening-delivery-recovery-verified/kyalulu-cloud.tar.gz` | `b430468eda289c69d340` | `817b275bff7612552b4e1ae68683444e792d6c95e0f16f008af77f406f02a0bf` |

Next build `0-IOFsF8GbV3PmxZBvOOQ` passed its production build and eleven routing and packaging tests. Both archives matched 996 corresponding worktree files. The release uses the preceding Vite build and retains twenty earlier worker inventories. The fallback retains the new Next assets for clients already using the candidate.

The loopback Linux comparison used the same build, FastAPI, Vite assets, Caddy limits, shaped Chromium profile and deterministic provider in all arms. The control set the new delivery signal to zero in the fixture. There were two eight-profile batches per path and drafting interval, with opposite orders within each interval. The controlled browser recorded when the textarea became editable instead of stopping at its first visible render.

| Pooled median, 16 profiles per path | Immediate, status first | Immediate, direct | Short, status first | Short, direct |
|---|---:|---:|---:|---:|
| Submit to start of opening PUT | 155 ms | 40 ms | 183 ms | 40 ms |
| Submit to editable chat textarea | 2.94 s | 2.46 s | 2.62 s | 2.54 s |
| Submit to quote request | 3.01 s | 2.51 s | 2.65 s | 2.59 s |
| Submit to first visible reply | 4.80 s | 4.41 s | 4.42 s | 4.64 s |

The immediate PUT started 103 and 118 ms sooner in the two paired orders. Input became editable 748 and 277 ms sooner, and first replies appeared 515 and 218 ms sooner. With a short draft, the PUT started 78 and 196 ms sooner. The two reply pairs moved 93 ms earlier and 351 ms later. The following section compares this build directly with Vite.

Every direct arm removed one pre-write status GET. The destination status request preceded history in all Next visits. The extra character-only visit made one document transition to Vite. All 65 journeys completed one quote, one model call, one stored reply and one settlement apiece, with no outstanding holds. The disposable stack was removed. To repeat the comparison, run `compare.py` in `.artifacts/next-opening-delivery-performance/` with the two `:opening-delivery` images. Copy it to a fresh child of `.artifacts/` to preserve the original files. See `summary.json`, `same-release.json` and `completed-batches.json`.

The Linux rehearsal passed 80 switch combinations across 20 routes and 238 HTTPS checks, including 24 expected 404 responses. It rejected the intentional wrong-wave probe. The signed-in browser kept its history and draft through both proxy rollback and the companion image, and the retained Next chunk stayed available. The temporary project was removed. Run `python .artifacts/next-opening-delivery-linux/rehearse.py` with `kyalulu-online-local:opening-delivery`, `kyalulu-cloud-local:opening-delivery`, `kyalulu-cloud-local:opening-delivery-recovery` and `kyalulu-relay-local:capacity`. See the rehearsal's `results.json`.

The 111 FastAPI files match the preceding build. The atomic opening boundary test passed and rejected wrong-owner and wrong-origin requests before creating history. Windows Chromium also passed active Cloud and paired-PC switching in both directions. Cloud matched three model requests and three settlements with zero outstanding holds. The Relay fixture recorded two PC submissions and zero direct Cloud requests. Legacy Mobile import and both installed-client sync cases passed. See the logs under `.artifacts/next-opening-delivery-release-verified/` and the import report under `.artifacts/next-opening-delivery-mobile-import/`.

Desktop Chrome upgraded worker `fe2e60537bd0735f3da1` to `e5e292f29da6a318f464` and ran a real GGUF turn offline. A fresh offline process found the saved reply and receipt by generation ID. Companion worker `b430468eda289c69d340` kept that result, the pending outbox and the held Next chunk. The migration document retained its separate isolation policy. Run `python tests/e2e_next_device_upgrade.py --old .artifacts/next-page-recovery-release/package/web --new .artifacts/next-opening-delivery-release-verified/package/web --rollback .artifacts/next-opening-delivery-recovery-verified/package/web --channel chrome --weights VERIFIED_SHARD_DIRECTORY`. See `.artifacts/next-opening-delivery-release-verified/offline-gguf-chrome.log`.

### Compare the opening-delivery candidate directly with Vite

The verified `0-IOFsF8GbV3PmxZBvOOQ` bundle supplies both the Next and Vite paths behind the same Linux proxy. Use the same 393 × 852, DPR 2 Chromium profile, 80 ms emulated network latency, 2 Mbps down, 750 kbps up and mock provider. Each batch uses eight fresh signed-in profiles, ordinary browser HTTP caching, blocked service workers and two local Relay Host sockets. The timing fixture repeats the immediate, 550 ms and 2.5 s requested drafting intervals in opposite frontend orders. As in the previous run, a local bound is met when the Next median is at or below its matched Vite median in both orders.

The Next trace checks that the owner-guarded opening PUT starts before any new status GET, the destination subsequently checks status before reading history, and the handoff stays in the same document. It separately timestamps the opening response, the route request, completed Runtime imports and the destination status request. Resource timestamps locate phases in the browser. They give no direct attribution to script evaluation, browser scheduling or network throughput.

The first run completed 48 visits before Relay rejected a reconnect with close code 1013. The reused fixture identity could still have its preceding connection registered. A bounded reconnect before measurement now waits for both Host sockets to report readiness. The final comparison uses a fresh disposable stack and the complete counterbalanced order from that run.

| Pooled median in seconds, Vite → Next, 16 profiles per frontend | Immediate | Short draft | Full draft |
|---|---:|---:|---:|
| Character entry to visible input | 5.99 → 1.74 | 6.40 → 1.77 | 5.87 → 1.79 |
| Submit to visible chat textarea | 1.34 → 2.17 | 1.13 → 2.32 | 0.94 → 1.84 |
| Submit to editable chat textarea | 1.50 → 2.41 | 1.40 → 2.38 | 1.31 → 2.09 |
| Submit to first visible reply | 3.64 → 4.28 | 3.34 → 4.27 | 3.26 → 4.08 |
| Entry-to-input plus submit-to-reply per profile | 9.56 → 6.10 | 9.77 → 6.08 | 9.14 → 5.89 |

The observed input-to-click intervals ranged from 35–94 ms, 585–648 ms and 2,553–2,581 ms. The waits above exclude drafting. In all six pairs Next met the paired bounds for the first input and the two waits combined. It missed the paired bounds for visible and editable chat input, quote start and first reply. Next replies came 0.73 and 0.60 s later in the immediate pairs, 0.66 and 1.04 s later in the short pairs, and 0.98 and 0.80 s later in the full pairs. Quote requests began 0.20–0.67 s later across the six pairs. The latest local comparison therefore leaves a consistent post-submit gap across the three conditions.

Within Next, median route request to destination status start was 1,085, 1,022 and 522 ms. In profiles with both RSC and Runtime completion timestamps, the median route request to the last observed Runtime completion was 939 ms across ten immediate profiles, 851 ms across eight short profiles and 7 ms across eleven full profiles. In that full-draft subset, 119 ms elapsed from the last observed route dependency completion to destination status start. These timings overlap and their medians should be read independently. The immediate and short results point to reducing the Runtime code on the critical path. Pooled quote-fetch medians across the three drafting conditions were approximately 578–669 ms on Next and 291–325 ms on Vite under this fixture.

The immediate sends made zero prefetch requests. Short-draft Next profiles started 128 prefetches, cancelled 112 and observed 20 script cache hits. The full-draft profiles reused all 128 prefetched scripts. The mixed-route visit navigated once by document to Vite chat with zero prefetches. All 97 visits made one quote, sent and saved one turn, and settled once with zero outstanding holds. The temporary Compose project was removed. See `.artifacts/next-opening-delivery-frontend/summary.json` and `same-release.json`. Use `compare.py` and `summarize.py` from the same directory with the named `:opening-delivery` images. Copy the scripts to a fresh child of `.artifacts/` before repeating.

### Compare loading sign-in and execution controls on demand

Build `_EXpKxCE1Cz-tPVzy743J` moved the registration picker, remote entry and route-gated sign-in UI out of the signed-in chat imports. The production manifest's combined Runtime and ActiveChat imports went from 11 scripts and 422,778 decoded bytes to 10 scripts and 396,898 bytes, counting a shared file once. The candidate's sign-in and picker scripts were absent from the signed-in opening requests recorded from drafting through first reply in all 16 candidate profiles. The Web type check, 63 focused tests, Windows Chromium coexistence suite and paired-PC tests passed. The coexistence suite exercised fixture login, Escape dismissal, route-gated guest pages, switching to Device or PC, and same-URL recovery.

The Linux comparison used the immediate drafting condition, the same emulated network and Chromium profile, two fixture Relay Host sockets and the same mock model. It alternated the build order across two pairs of eight fresh signed-in profiles per build. Timings are medians in seconds.

| Phase | Pair 1 selected → on-demand | Pair 2 selected → on-demand |
|---|---:|---:|
| Character entry to visible input | 1.74 → 1.83 | 1.89 → 1.82 |
| Submit to editable chat textarea | 2.63 → 2.81 | 2.52 → 2.40 |
| Submit to quote request | 2.69 → 2.88 | 2.58 → 2.48 |
| Submit to first visible reply | 4.58 → 4.93 | 4.45 → 5.68 |
| Generation POST to full response | 0.78 → 1.16 | 0.95 → 2.31 |

All 32 journeys sent, persisted and settled one turn each, with zero outstanding holds. All four temporary Compose projects were removed. The editor and quote pairs changed direction, and the full generation response took longer in both candidate batches. The comparison leaves the cause of the longer response interval unresolved. The release selection stays with `0-IOFsF8GbV3PmxZBvOOQ` because first reply missed both paired bounds. The four experimental source files were restored from the verified release. Both selected release and recovery archives were rechecked against 996 worktree source files, and their SHA-256 values matched the recorded digests.

Run `compare.py` from a fresh child of `.artifacts/` with `baseline 1`, `candidate 1`, `candidate 2` and `baseline 2` in order. The original driver and four reports are under `.artifacts/next-optional-ui-comparison/`. The trial package at `.artifacts/next-optional-ui-release/kyalulu-cloud.tar.gz` has SHA-256 `3e16c0991135bd6755a60da8e8350ef58644a7a579bcb27195703e623a2ecf0c` and uses the two `:optional-ui` Linux images. The comparison uses the `:opening-delivery` images for the selected build.

### Locate the immediate-send delay around the quote

Build `0-IOFsF8GbV3PmxZBvOOQ` served both frontends from the same local images. The immediate-send comparison used Chromium 151.0.7922.34 at 393 × 852, normal HTTP caching, blocked service workers, the existing 80 ms emulation profile and a deterministic provider. Run order was Vite, Next, Next, Vite with eight fresh signed-in accounts per batch. The 32 browser sends, stored replies and settlements reconciled one to one. The disposable Compose project was removed.

The fixture records request-to-response durations in Chromium and FastAPI using their individual monotonic clocks. Caddy marks its proxy branch entry and upstream headers. Each observation is joined by a disposable request ID, which is dropped from the final report. For generation, FastAPI measures through the final SSE event containing the reply. Chromium records only network durations and the existing client completion timing. Preliminary runs exposed two fixture defects. The browser can cancel the response body after consuming the terminal SSE event, and attaching an additional observer separates two inherited stopwatch starts. The final run handles stream termination and retains event-order checks on the shared request trace. Preliminary samples are excluded.

| Median across 16 profiles per frontend | Vite | Next |
|---|---:|---:|
| Character entry to visible input | 5.88 s | 1.75 s |
| Submit to quote request | 1.92 s | 2.56 s |
| Quote request to parsed response in the client | 275 ms | 591 ms |
| Quote request duration inside FastAPI | 242 ms | 520 ms |
| Generation POST to full response in the client | 988 ms | 1,042 ms |
| Generation POST to final SSE event inside FastAPI | 949 ms | 992 ms |
| Submit to first visible reply | 3.31 s | 4.40 s |

The Next quote started 796 and 535 ms later in the paired orders. The browser's quote interval increased by 279 and 412 ms, and the FastAPI interval by 236 and 351 ms. The generation POST to client completion moved from 1,042 to 1,026 ms in the first pair and from 956 to 1,044 ms in the second. In this fixture the repeatable gap is concentrated before the generation POST.

The session-list request was still in flight at quote start in 16 of 16 Next visits and zero of 16 Vite visits. The 393 px layout hides the chat sidebar. `ActiveChat` also uses the list for session identity and recovery of old navigation drafts. The overlap makes this request a candidate for a controlled scheduling experiment. It leaves causation and the impact on desktop behavior open. Compare postponing only the list on the eligible small-screen first-send path while preserving desktop access, authentication, old-draft recovery and the ledger checks.

Use `.artifacts/next-reply-transport/measure.py` and `summarize.py` from a fresh child of `.artifacts/` with the `:opening-delivery` images and the same Playwright Chromium. The fixture changes are confined to temporary files. The raw timing and aggregate reports are `same-release.json` and `summary.json`.

### Test deferring the initial session-list request

Run the selected Next build with the same loopback Docker stack, 393 × 852 browser profile, mock provider, two Relay hosts and immediate sends. Both arms intercept the exact session-list GET, including its cache-busting query, after the character input has loaded. The control releases it immediately. The deferred arm releases the first list request only when that profile finishes receiving its quote. Subsequent list requests continue as usual. An initial fixture run missed the query-bearing request and is excluded. In the final run all 16 deferred visits held their initial list until their quote completed. The median hold was 945 and 930 ms in the two arm orders.

| Batch medians, control → deferred | Pair 1 | Pair 2 |
|---|---:|---:|
| Submit to editable chat textarea | 2.70 → 2.43 s | 2.43 → 2.43 s |
| Submit to quote request | 2.75 → 2.51 s | 2.48 → 2.48 s |
| Quote request to parsed response | 620 → 631 ms | 593 → 598 ms |
| Quote duration inside FastAPI | 547 → 532 ms | 513 → 495 ms |
| Submit to first visible reply | 4.90 → 4.42 s | 4.31 → 4.32 s |

The first pair already differed by 165 ms in character input time before interception began. Across the two pairs, delaying the list reduced FastAPI quote medians by 15–18 ms and browser quote waits increased by 5–11 ms. The first-reply improvement occurred in one pair. This leaves the larger Vite-to-Next quote gap unexplained and the selected release retains its existing list timing. All 32 sends, saved replies and settlements reconciled one to one, with zero outstanding holds, and the disposable project was removed.

Repeat with `.artifacts/next-session-list-schedule/compare.py` from a fresh child of `.artifacts/`. It uses the shared `next-reply-transport` fixture and the same `:opening-delivery` images. The final data is in `same-release.json` and `summary.json`.

### Measure the phases of FastAPI quote preparation

The same verified build and images completed another immediate-send comparison in Vite, Next, Next, Vite order, eight signed-in accounts per batch. The fixture binds durations to each request with a context variable and records only duration and history-mode metadata. It records elapsed time including awaits. The wrapped calls include SQLite connection and scheduling time, so this measurement cannot isolate SQL execution.

| Median inside FastAPI, Vite → Next | Pair 1 | Pair 2 |
|---|---:|---:|
| Whole quote response | 234 → 516 ms | 341 → 549 ms |
| `CloudGenerations.prepare` | 211 → 477 ms | 319 → 503 ms |
| Stored history and revision | 27 → 168 ms | 70 → 207 ms |
| Memory scope selection | 29 → 118 ms | 69 → 113 ms |
| Settings load | 13 → 80 ms | 49 → 31 ms |
| Prompt compilation | 1.71 → 1.99 ms | 1.98 → 2.31 ms |
| Quote persistence | 13 → 12 ms | 12 → 23 ms |

The phase medians are independent, and preparation includes the history, settings, prompt and memory calls. All 16 Vite quotes captured the history revision within the quote. All 16 Next quotes carried the revision returned by the atomic opening write and validated it against the stored snapshot. The two paths use the same history resolver with different revision arguments. No fixture request had enabled memory retrieval. All 32 generations, stored turns and settlements reconciled, with zero outstanding holds. The fixture project was removed.

The largest repeated gaps were the stored-history and memory-scope operations. The current scope path can open a write transaction even when it returns an existing identity. Check CPU quota sensitivity and the revision modes before attributing the difference to a query or changing the transaction boundaries. Carry forward same-account isolation, stale-revision rejection, scope migration rules and quote-to-generation fingerprint agreement. The release candidate remains the verified `0-IOFsF8GbV3PmxZBvOOQ` build.

Run `.artifacts/next-quote-phases/measure.py` from a fresh child of `.artifacts/` using the shared timing fixture and the `:opening-delivery` images. See `same-release.json` and `summary.json` for durations and reconciliation.

### Isolate the FastAPI CPU quota in the first-send fixture

Keep the selected images, mock provider, two Relay sessions, Chromium profile and memory and task limits from the quote phase comparison. Switch only the disposable FastAPI container between 0.5 and 1 CPU and read the applied cgroup quota before every batch. The four combinations run in Vite 0.5, Next 0.5, Next 1, Vite 1 order and then in reverse. Each batch uses eight fresh profiles. Every visit completed its send and persisted and settled once, with zero outstanding holds. The temporary project was removed.

| Pooled medians across 16 profiles per combination | Vite 0.5 CPU | Vite 1 CPU | Next 0.5 CPU | Next 1 CPU |
|---|---:|---:|---:|---:|
| FastAPI quote | 285 ms | 174 ms | 422 ms | 169 ms |
| Stored history and revision | 83 ms | 27 ms | 155 ms | 57 ms |
| Memory scope selection | 86 ms | 23 ms | 51 ms | 25 ms |
| Submit to quote request | 1.96 s | 1.44 s | 2.59 s | 3.46 s |
| Submit to first visible reply | 3.44 s | 2.70 s | 4.19 s | 4.51 s |

FastAPI quote medians improved with 1 CPU in both orders. On Next they changed from 389 to 203 ms and from 458 to 139 ms. FastAPI's measured throttle count fell from 22–25 periods per batch at 0.5 CPU to 2–5 at 1 CPU across both frontends. The 1 CPU Next batches still differed substantially before quote start. Their route request began 0.64 and 1.60 s after submit, and the per-profile median from route request to destination account status start was 1.20 and 2.76 s. First reply moved from 4.03 to 3.74 s in one Next pair and 4.40 to 6.40 s in the other. Capacity is a lever for the quote phase in this fixture. End-to-end first reply still needs its own acceptance on the destination host and network.

Run `.artifacts/next-quote-cpu/compare.py` from a fresh child of `.artifacts/` using the shared phase fixture and the `:opening-delivery` images. See `same-release.json` and `summary.json` for the applied limits, cgroup counters and raw timings.

### Compare supplied and captured history revisions within Next

Hold the Next build, profiler, 1 CPU FastAPI limit and immediate-send workload fixed. The control passes the saved opening revision to the real quote implementation. The comparison fixture clears the revision on a copy of the synthetic quote request and asks that implementation to capture it. It asserts that the captured revision equals the original receipt before returning the quote. Both arms leave the browser's generation request and generation validation on the existing path. The fixture uses the real storage and accounting on disposable data.

| Batch medians, supplied → captured | Pair 1 | Pair 2 |
|---|---:|---:|
| Stored history and revision | 148 → 65 ms | 108 → 95 ms |
| Whole quote response inside FastAPI | 289 → 425 ms | 259 → 269 ms |
| Submit to quote request | 2.89 → 1.98 s | 1.99 → 2.15 s |
| Submit to first visible reply | 4.14 → 4.44 s | 3.60 → 3.63 s |

The history resolver interval fell in both captures, while the whole quote and first reply took longer in both pairs. The first pair already differed by about 0.91 s before the fixture's quote-stage change could act. The comparison leaves the differences in per-stage scheduling unresolved and provides no release case for changing the revision handshake. All 32 visits completed one generation, one saved turn and one settlement, with zero outstanding holds. The project was removed. The selected release keeps the supplied-revision path and all current revision checks.

Repeat with `.artifacts/next-quote-revision-mode/compare.py` from a fresh child of `.artifacts/`. It uses the shared quote and CPU fixtures and `:opening-delivery` images. See `same-release.json` and `summary.json`.

### Give the chat route response priority over chat-only scripts

Keep the verified Next build and the 1 CPU FastAPI fixture. Intercept the three immutable ActiveChat scripts outside the Runtime manifest on all visits. The control releases them immediately. The comparison releases them after the browser finishes the successful App Router fetch. Runtime's shared scripts and the account check keep their existing paths. The initial instrumentation missed some resource completions. The final run accounts for the delivery URL suffix and terminal fetch events and asserts that all expected scripts are intercepted.

| Batch medians, control → route first | Pair 1 | Pair 2 |
|---|---:|---:|
| Submit to App Router request | 0.67 → 1.61 s | 0.75 → 0.60 s |
| App Router request to destination status start | 1,126 → 1,038 ms | 1,001 → 976 ms |
| Submit to editable chat textarea | 2.19 → 3.38 s | 2.10 → 2.08 s |
| Submit to first visible reply | 3.81 → 4.81 s | 3.47 → 3.62 s |

All 48 held scripts across the 16 route-first visits resumed after their route fetch, with no timeout. The median holds were 121 and 348 ms. The account check started slightly earlier relative to the route in both pairs. The first pair also incurred a longer wait before the route request. Visible reply was later in both pairs, so the selected release keeps its current script ordering. All 32 fixture visits opened in the same document, checked destination status before requesting history, and generated, saved and settled once. The disposable Docker project was removed.

Run `.artifacts/next-chat-route-first/compare.py` from a fresh child of `.artifacts/` using the shared timing fixture and `:opening-delivery` images. The reports are `same-release.json` and `summary.json`.

### Verify an account change while the first chat transition is pending

The Windows Chromium fixture runs the selected release's packaged Next service behind the local Caddy policy. After account A's opening write completes, it holds the App Router request, changes the fixture session cookie to account B and resumes the request. The destination status and the first history request use account B's scope. Account B sees an empty composer. The fixture observes no quote or generation POST. It then restores account A's cookie and reloads the same chat URL. The exact draft is editable again, and the fixture still observes zero quote and generation requests for that conversation.

The first integrated attempt passed the handoff check while its shared cookie jar interfered with the original tab's later composer check. The final check uses a separate browser context with a restored copy of the fixture sign-in. The full coexistence suite then passed, including its full history and credit reconciliation, failed-script recovery, proxy rollback and offline startup. This is a local synthetic account-switch check of the selected build. Real OAuth and cross-device session propagation remain destination acceptance cases.

Reproduce with `.artifacts/next-chat-route-first/check_handoff_account.py` using the installed workspace Next runtime, matching Playwright Chromium and the selected package. The final record is `handoff-account-isolated.log`.

### Check Firefox and WebKit on Windows

Exercise the selected build `0-IOFsF8GbV3PmxZBvOOQ` at a 393 × 852 viewport. The fixture sends a real HTTP redirect from a separate loopback HTTPS origin and mocks the identity exchange and generation in FastAPI. It checks the official character HTML and canonical URL with scripts disabled, activates the conversation button with the keyboard, submits through the mock callback, reloads the chat and rolls all page switches back to Vite. A separate disposable Firefox profile exercises the device shell. No physical browser or model provider participates.

| Engine | Cloud journey and proxy rollback | Device shell and worker lifecycle |
|---|---|---|
| Firefox 153.0, English UI | Passed. One mock authorization request, one quote, one generation, one saved turn and one settlement. Reload and Vite rollback preserved the history and unsent draft. | Passed after stopping the disposable loopback listener. Upgraded the companion Vite worker to the selected Next worker, reopened the saved device chat in a fresh browser process with the listener down, retained its draft and outbox, checked migration isolation, and restored the Vite worker and held chunk. |
| Playwright WebKit 26.5, Japanese UI | The final journey completed and reconciled once. Review stays open because a cancelled stylesheet load during the first-send navigation produced an unhandled rejection. The error reproduced with native navigation and no Playwright request interception. | Open. A secure isolated context registered the older worker and created its cache. The worker was still installing after 30 seconds with no controller. An earlier 120-second controller wait also expired. |

The Firefox sandbox process initially exited while creating a Windows registry key. A host launch with a disposable profile completed. Firefox's Playwright offline emulation returned `NS_ERROR_OFFLINE` at the cold root navigation after a successful update. The passing transport-loss run keeps the browser's offline emulation disabled and verifies that the actual fixture listener refuses connections during the reopen. The shardless run checks persistence and launch behavior.

Playwright WebKit rejected the original redirect interception. Both final Cloud runs use real local HTTPS responses. WebKit's final report records `[object Event]` from the cancelled `/_next/static/css/77d36f1879029b46.css` during first send, alongside one earlier visit that reached chat but missed the five-second reply wait. Keep the strict page error check and investigate the navigation and worker install before claiming WebKit acceptance. The prior desktop Chrome offline GGUF evidence and the Firefox shell evidence leave physical Android and iPhone acceptance open.

Run `.artifacts/next-cross-browser/verify.py firefox` and `verify.py webkit` with the matching Playwright engines and installed workspace Next dependencies. For the Firefox shell test run `verify_device_shell.py firefox --disconnect`; use `verify_device_shell.py webkit` for the installation probe. See `firefox-native-navigation.log`, `firefox-real-disconnect.log`, `webkit-native-navigation.log` and `webkit-device-diagnostics.log`.

## Current local release candidate

Next build `HhX6361m-9hQW6dhAOC8u` keeps the localized return status visible while a signed-in callback resolves its saved destination. The intermediate home screen stays unmounted. The focused login-return regression, 38 Web tests across login, session setup and first-send behavior, and the Next type check passed.

The packaged build passed the 393 × 852 Cloud journey on Windows Chromium, Firefox 153.0 and Playwright WebKit 26.5. The Firefox and WebKit fixtures each completed one simulated authorization, quote, generation, stored turn and settlement. Both preserved history and the unsent draft after proxy rollback, with zero unhandled browser errors. The combined run also emitted one FastAPI incomplete-response diagnostic during the Firefox case. The journey and reconciliation assertions still passed.

Desktop WebKit upgraded an installed Vite worker directly to the candidate. After the loopback listener stopped, a fresh browser process reopened its existing isolated device chat with the same conversation ID, draft and pending outbox. Reconnecting allowed the companion worker to restore the Vite delivery, and the held Next chunk remained available. This checks the shell, upgrade and recovery. The last real offline GGUF turn was on desktop Chrome with the preceding `0-IOFsF8GbV3PmxZBvOOQ` build.

Three cold Chromium 151.0.7922.34 profiles per frontend compared the candidate's Mocha entry and its bundled Vite fallback behind the same loopback proxy. The 393 × 852 profiles used 80 ms emulated latency, 2 Mbps download, 750 kbps upload and blocked service workers. Each column is a median.

| Character entry | Vite | Next |
|---|---:|---:|
| First readable heading | 870 ms | 558 ms |
| First usable character input | 2,260 ms | 1,618 ms |
| LCP at first interaction | 2,032 ms | 1,228 ms |
| Initial JavaScript transfer | 317,382 B | 153,239 B |
| Completed API reads to usable input | 3 | 1 |

All three captured drafts per frontend matched the submitted text at the login sheet. The three candidate logins sent and persisted the intended first message once per journey. Their median from the fixture login click was 1,241 ms to chat and 2,171 ms to the first reply. The previous build's balanced signed-in comparison put the median from immediate submit to first visible reply at 3.31 s on Vite and 4.40 s on Next. Repeat that matched signed-in comparison on the destination host before expanding traffic.

Docker Desktop ran the candidate on Linux amd64 behind Caddy. Next and FastAPI started as non-root processes with read-only root filesystems. The rehearsal passed all 80 individual switch combinations across 20 declared routes. The deliberate wrong-wave probe was rejected, and pilot, quarter and all assigned the expected cohorts. Both the proxy rollback and replacement with the companion Cloud image preserved signed-in history, the unsent draft and the held immutable chunk. The corresponding-source endpoint returned the archive bytes from the candidate. The Next cgroup peaked at 326.6 MiB in this rehearsal with no OOM kill. The disposable Compose project, network and data volume were removed.

| Local artifact | Worker | SHA-256 |
|---|---|---|
| `.artifacts/next-oauth-return-release/kyalulu-cloud.tar.gz` | `2dd25ec38bea01165df6` | `6e21cdaf1c7d45792124f2140d676fc3d425508ced5bb574d8c16e80139ebdef` |
| `.artifacts/next-oauth-return-recovery/kyalulu-cloud.tar.gz` | `94341d9af19480a93719` | `d208c87fe899bf253f35d8a2db49c076c592f0952af640fa82432b1675afdd85` |

Both archives use the configured `https://relay.kyalulu.com` Relay origin. The Linux rehearsal resolves the application and Relay hostnames within its disposable fixture. Each archive matched 996 corresponding files from the `4f24140` worktree. The verifier checked 1,364 candidate members and 1,078 recovery members. Reproduce with `scripts/verify_online_release.py DIRECTORY --expected-sha256 DIGEST --expected-relay-origin https://relay.kyalulu.com --compare-worktree`.

Run `verify.py webkit firefox --candidate` and `verify_device_shell.py webkit --candidate --legacy --disconnect` from `.artifacts/next-cross-browser/` with the workspace venv and the matching Playwright browsers. For the character entry measurement use `tests/e2e_online_coexistence.py` with `--samples 3`, the extracted candidate web directory and the matching Node build. See `candidate-cross-browser.log`, `candidate-chromium-measurement.log` and `candidate-webkit-legacy-device.log` in the release directory. For Linux, run `.artifacts/next-oauth-return-linux/rehearse.py` with `kyalulu-online-local:oauth-return`, `kyalulu-cloud-local:oauth-return`, `kyalulu-cloud-local:oauth-return-recovery` and `kyalulu-relay-local:capacity`. The rollout and recovery evidence is in its `results.json`.

| Migration stage | Verified scope | Remaining acceptance |
|---|---|---|
| 0. Baseline | Route inventory, prior public HTTP sample, local reproduction of the direct-navigation 404 and three-sample UX baseline | The destination operator identifies the deployed revision and routing configuration. |
| 1. Coexistence | Same-origin Caddy delivery, current Linux container startup, cohorts, CSP, old chunks and route rollback on loopback | The destination operator verifies TLS, headers, deployed predecessor worker inventories and resource limits. |
| 2. Character to first send | Public HTML, share metadata, keyboard draft recovery and fixture login in Chromium, Firefox and WebKit | Repeat with the authorized identity provider and target device profiles. Apply the first-reply performance budget before expanding beyond the pilot. |
| 3. Cloud chat | Quote, consent, interruption, in-flight account change, recovery, active rollback and synthetic ledger reconciliation | Run the target load with real integrations and the agreed error and latency budgets. |
| 4. Remaining online pages | Route switches, account and role checks, publication withdrawal and language changes in the local browser suite | Validate all selected routes with staging configuration and roles. |
| 5. Device, remote PC and PWA | Desktop Chrome offline GGUF on the preceding build, Firefox and WebKit shell upgrades and transport-loss recovery, legacy data import, sync conflicts and fixture Relay switching | Verify an installed upgrade, inference and recovery on physical Android and iPhone devices. Exercise the real Relay and paired PC. |
| 6. Cutover and retirement | Latest release and companion image, local wave checks, proxy and image recovery preserving fixture history | Production authorization, live observation, followed by legacy online delivery retirement. |
