# Private Cloud on the existing ConoHa VPS

Current release (2026-10-05):
`/opt/kyalulu-cloud/releases/20261005-official-portraits/bundle`,
image `kyalulu-cloud:20261005-official-portraits`.
Google login and the invited owner's inference route are enabled. Sales, ads and
image storage/sync remain disabled. See [handoff](../../docs/HANDOFF.md) and
[deployment verification](../../docs/validation/2026-10-05-official-portraits.md).
The initial-build commands below are historical setup examples; select a fresh
release name for future updates instead of rebuilding the old Google-test tag.

The cloud service uses its own Compose project `kyalulu-cloud`, data and backup
volumes. The existing `kyalulu-remote` project retains its Relay and Caddy. Web/API
share `https://cloud.kyalulu.com`; the cloud container exposes only loopback port
8020. The external `kyalulu-remote_default` Docker network lets Caddy reach
`kyalulu-cloud-runtime:8000`. Caddy's container cannot use the host's loopback.

## Prepare locally

```powershell
pnpm --filter web build
.venv/Scripts/python.exe scripts/prepare_cloud_bundle.py
.venv/Scripts/python.exe scripts/check_cloud_auth.py
```

The bundle has a file allowlist, hashes, prebuilt Web, corresponding source and
locked Python requirements. Env, keys, databases and model weights are excluded.
Transfer secrets separately over the existing verified SSH connection, write the
cloud `.env` with mode 0600, and never use secrets as command-line arguments.
Retain the master secret securely off-VPS; losing it prevents data recovery.

## Build and start the isolated release

Use a fresh release directory below `/opt/kyalulu-cloud/releases`. Verify archive
and file hashes before building. The 2026-10-04 private release is
`20261004-google-private/bundle`. Web is built on the PC; the Docker build only
installs pinned runtime wheels and copies allowlisted files. Docker's legacy
builder supports limits on this VPS:

```sh
sha256sum -c kyalulu-cloud.tar.gz.sha256
mkdir bundle
tar -xzf kyalulu-cloud.tar.gz -C bundle
cd bundle
sha256sum --quiet -c SHA256SUMS
DOCKER_BUILDKIT=0 docker build --memory 384m --memory-swap 512m \
  --cpu-period 100000 --cpu-quota 50000 \
  -t kyalulu-cloud:20261004-google-private .
```

Legacy building is deprecated upstream. These limits apply to build steps, not
every Docker operation; inspect actual RAM/swap and Relay availability throughout.
Do not silently change swap or upgrade the reverse proxy to avoid this limitation.

Put the private env at `deploy/cloud/.env`, use `/data` and `/backups` for storage,
and set `KYALULU_CLOUD_IMAGE=kyalulu-cloud:20261004-google-private`:

```sh
docker compose -p kyalulu-cloud --env-file deploy/cloud/.env \
  -f deploy/cloud/compose.yml -f deploy/cloud/compose.vps.yml config --quiet
docker compose -p kyalulu-cloud --env-file deploy/cloud/.env \
  -f deploy/cloud/compose.yml -f deploy/cloud/compose.vps.yml \
  up -d --no-build --wait --wait-timeout 60
```

One invited Google email, signup limit one, no automatic trial, billing or ads.
Inference was off during initial auth setup; the current owner's private route
is enabled. Carry forward prior API fees and unknown reservations; never refill the
cumulative private budget by redeploying or changing the prior-cost value.

## HTTPS and Google

Cloudflare: A `cloud` points at the existing VPS IPv4, DNS only. Verify the public
record before requesting a certificate. Supabase Site URL is
`https://cloud.kyalulu.com`; Redirect URLs contains the exact
`https://cloud.kyalulu.com/auth/callback`. Google's OAuth redirect remains the
Supabase project `/auth/v1/callback` URL.

Back up the existing bind-mounted Caddyfile before adding the cloud site from
`Caddyfile.example`, replacing the upstream with `kyalulu-cloud-runtime:8000`.
Preserve Relay's site and global no-log settings. Validate the combined file
inside the existing container before activation. Caddy 2.10.2 has admin disabled
and does **not** implement SIGUSR1 reload; the current deployment requires one
brief restart of Caddy. Relay's container/data are not restarted. Later Caddy
versions' signal documentation does not prove support in 2.10.2.

Verify trusted TLS, cloud health, private login status, authentication denial,
same-origin protections, corresponding-source availability, disabled billing,
owner-only inference policy, and existing Relay health. Read-only deployment
checks must send no inference requests. Observe memory and restart/OOM counters.
The owner completed Google's browser interaction and the initial 500-credit grant
already exists. The following command documents initial setup; do not issue a new
grant for the next thread. An initial grant requires the matching verified UUID:

```sh
docker exec kyalulu-cloud-cloud-1 python scripts/cloud_admin.py grant \
  --owner VERIFIED-UUID --credits 500 --source owner-initial-500 --days 30
```

This is $0.05 credit face value, not $0.05 of provider API spending. The grant is
idempotent. Keep public registration, public inference and subscriptions disabled until
their separate acceptance requirements are met.

## Recovery

Stop only the cloud service when investigating its failures. Preserve its named
volumes and master secret. Do not use `down -v`. Before replacing a used release,
make an encrypted backup and copy it off-VPS; validate schema compatibility before
using the old image. Restore into a fresh destination. Reverting the proxy means
restoring its saved Caddyfile and validating before the necessary brief restart.
