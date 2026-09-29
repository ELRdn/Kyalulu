# Standalone Relay deployment (not deployed)

For Cloudflare Pages static hosting with a separate VPS Relay, see
[Cloudflare deployment preparation](CLOUDFLARE.md). Appwrite is not required.

The cloud serves static APP files and routes opaque Noise bytes only. No models,
runtime inference, Noise keys or PSKs are shipped. See
[`CONTRACT.md`](../../runtime/python/relay/CONTRACT.md) for the integration protocol.

Use distinct `APP_DOMAIN` and `RELAY_DOMAIN` DNS names. Copy `.env.example` to `.env`
here and supply the absolute path to a separately built PWA. The app build must
use the public Relay URL. Caddy terminates TLS and serves that build. Scripts use
`script-src 'self' 'wasm-unsafe-eval'`: Noise WASM compilation is allowed, but
inline JS, JavaScript eval/new Function and third-party scripts are not. Styles
use `style-src 'self'; style-src-attr 'unsafe-inline'` so React style props work;
inline style elements and external stylesheets remain prohibited. QR data images
are allowed by `img-src ... data:`. Camera permission
is limited to the APP origin for QR scanning; microphone/geolocation are disabled.

## Local operation

Use an environment with FastAPI, Uvicorn and websockets installed. Repository
manifests are intentionally unchanged. From the repository root:

```powershell
$env:RELAY_ORIGINS = 'https://app.example.com'
python scripts/relay.py --db .artifacts/relay.sqlite3 invite --ttl 300
python scripts/relay.py --db .artifacts/relay.sqlite3 serve
```

`serve` defaults to loopback port 8787. Use the same DB for invite and serve.
CLI invitation output is a secret: share privately, do not paste into logs.
`invite --owner OWNER_ID` enrolls a second host under an existing owner. Tokens
cannot be recovered from SQLite. Revoke and enroll again after loss.

## Deployment preparation and activation

Do not run activation commands until deployment is authorized. Validate the app
build under the CSP, DNS names, TLS and firewall before exposing the service.
No deployment, image pull, domain change or public listener was run for this change.

```sh
docker compose --env-file deploy/remote/.env -f deploy/remote/compose.yaml config
docker compose --env-file deploy/remote/.env -f deploy/remote/compose.yaml build
# After approval:
docker compose --env-file deploy/remote/.env -f deploy/remote/compose.yaml up -d
docker compose --env-file deploy/remote/.env -f deploy/remote/compose.yaml exec relay python scripts/relay.py invite --ttl 300
```

Only Caddy exposes ports. Relay must use exactly one worker and one replica;
SQLite persistence is the `relay_data` volume. Uvicorn disables access logs,
proxy trust, compression and verbose exception logs. Caddy discards runtime logs
and does not enable access logs. Compose uses no log driver. This deliberately
trades request diagnostics for secrecy. Healthchecks expose no identities.
The direct Caddy peer shares the per-IP limit, with an additional global limit.
Do not enable forwarded-header trust without a separately reviewed proxy policy.

## Backups and restore

SQLite online backup captures committed WAL transactions. Destination must not
exist; private permissions are used where the OS supports them. Encrypt backups
and limit filesystem access: they contain identity metadata and token hashes.

```sh
python scripts/relay.py --db relay.sqlite3 backup backups/relay-001.sqlite3
# Stop Relay before restoring. Restore into a NEW DB path, never an active file.
python scripts/relay.py --db restored.sqlite3 restore backups/relay-001.sqlite3 --offline
# Verify the restored DB and then configure RELAY_DB to use it before restart.
```

In Compose run backup via `exec relay` to a new `/data/...` destination and copy it
to protected off-machine storage. For recovery stop Relay, restore on an offline
machine or one-off container with the volume, and point `RELAY_DB` at the new file.
`--offline` is an operator acknowledgement, not automatic process detection.
Restoring an older backup can resurrect revoked credentials: isolate the restored
service and revoke/re-enroll affected hosts before making it available. No token
revocation history beyond the snapshot can be reconstructed automatically.

## Real loopback load / soak acceptance

The runner starts an actual local Uvicorn WebSocket server on an OS-selected,
reserved **127.0.0.1-only** port, with a disposable SQLite database. There is no
production URL/database option. It provisions 10 synthetic owners offline through
Store before server startup, each with one host and five approved clients. This
avoids consuming HTTP enrollment limits; fixture approval is not E2EE approval.
All 60 sockets stay connected simultaneously. Host simulators validate connection
ownership and echo random opaque bytes; each client checks its exact payload.
No payload, invitation, bearer token or device identifier is printed.

```powershell
# Default: operational verification plus a 60-second soak, 1 KiB payloads,
# at most 2 roundtrips/second/client, five clients/owner.
python scripts/remote_acceptance.py
# Explicit 24-hour run (not run during implementation):
python scripts/remote_acceptance.py --duration 86400
# CLI backup/restore verification without opening a listener:
python scripts/remote_acceptance.py --operations-only
# Optional bounded tuning:
python scripts/remote_acceptance.py --duration 60 --clients-per-owner 5 --rate 2 --payload-bytes 1024
python -m pytest tests/test_relay_operations.py -q
```

Duration is the traffic phase, excluding fixture creation, admission-limit probe
and teardown. Parameters are checked before startup: 1–5 clients/owner, 32–65536
payload bytes, at most 20 roundtrips/second/client, and at most half of the host's
frame/byte limits. Traffic is request/response with pacing, not a saturation or
capacity benchmark; observed frequency can be lower than the configured maximum.
The runner emits aggregate JSON progress every 30 seconds and a final JSON report.
It exits nonzero on mismatch, unexpected disconnect, timeout, unsafe settings or
cleanup failure. A 5-second roundtrip deadline bounds stalled peers. Cancellation
closes sockets/listener and removes the temporary DB. An interrupted CLI run emits
an error; already-emitted progress is partial evidence, never a passed soak.

RTT includes the synthetic host echo and local scheduling. Percentiles are
ceil-to-1-ms histogram upper bounds (overflow bucket above 10 seconds); min/mean/
max are measured values. Histogram memory is fixed, including a 24-hour run.
The client payload byte counter is for each direction, excluding UUID prefixes,
TCP/WebSocket overhead and admission probes. Crypto, Noise XX renewal, RPC replay,
browser integration, Caddy/TLS and inference are outside this transport test.

### Shared Caddy IP admission limit

The service sees Caddy's IP because proxy-header trust is disabled. **120 HTTP/WS
admissions per minute are shared by all owners**, not per end user. Sixty initial
sockets fit, and established WS frames do not consume this admission limit.
Frequent reconnects, simultaneous enrollment, CORS preflights and HTTP polling
can exhaust it. A fleet reconnect consumes another 60 slots, leaving no headroom
in the same fixed window. Avoid per-second host-list polling and use reconnect
backoff/jitter. Do not claim unrestricted 10-owner HTTP/reconnect load acceptance.

Each run deliberately exercises the existing limiter without raising/bypassing
it: once all sockets are open, 121 HTTP requests from the same loopback IP produce
429 responses and the next WS upgrade gets HTTP 403. The existing sockets then
carry the entire soak. This reproduces shared transport-IP semantics, not the
actual Caddy process. A short wait of at most five seconds avoids probing across
a rate-limit window; a crossed window fails explicitly.

### Operational recovery and version rollback

The runner uses the real `scripts/relay.py` CLI with dummy metadata to verify
online SQLite backup including a committed WAL-only ticket, integrity and foreign
keys, exact metadata restoration, long-lived credential validity, persistent
revocation, host quota, single-use enrollment, mandatory `--offline`, and refusal
to overwrite an existing destination. Tests also reject corrupt/non-Relay sources.
Dummy tokens are captured only in memory. This does not validate off-machine
storage, encryption, filesystem ACLs, a production snapshot, or old binary/schema
compatibility.

Rollback helper procedure (operator actions, not automatic commands):

1. Before an upgrade, record the exact running Relay/Caddy image digests and APP
   build version; retain those immutable artifacts and create a verified backup.
2. Stop new enrollment, stop Relay, and retain a backup of the current state.
   Never replace or mount an old SQLite snapshot over a running service.
3. If the prior Relay version supports the current schema, restart that pinned
   image against a copy of the current DB and verify health, owner scoping and
   revocation while isolated. Do not assume compatibility from a passing current
   version test; there is no schema downgrade/migration helper here.
4. If a schema restore is necessary, restore the pre-upgrade backup into a new
   path using `restore ... --offline`, select the old pinned image plus matching
   APP build, and preserve the failed state for diagnosis.
5. Reconcile all revocations/enrollments since that snapshot before re-exposure;
   a stale snapshot can resurrect credentials. Revoke/re-enroll if reconciliation
   is uncertain. Smoke-test a fresh Noise XX session and an idempotent read before
   allowing mutations. Do not retry an ambiguous mutation automatically.

### Local evidence (2026-09-29)

A 60-second run with 10 owners, 10 hosts and 50 clients completed 4050 identical
1-KiB roundtrips with no mismatch; all 50 clients completed 81. Mean RTT was
233.053 ms, p95 <=281 ms, p99 <=311 ms, maximum 312.097 ms. The shared-IP probe
returned 60 HTTP 200 and 61 HTTP 429 responses, then HTTP 403 for a new WS.
Established routing continued, and teardown left zero connections/sessions.
These numbers are a colocated Windows/Python loopback observation, not a production
SLO or a 24-hour acceptance result. The 24-hour configuration was validated only.

Headless Chromium also loaded the existing APP build through a local static server
with the exact APP CSP copied from Caddyfile: style attributes worked, the actual
built Noise WASM compiled, inline script was blocked, and an external self-origin
probe confirmed `eval`/`new Function` remained blocked. This was not a Caddy/TLS
deployment. The existing build's inline theme initializer and Google Fonts CSS
were blocked as expected; main must externalize/self-host those resources. The
connection screen rendered without a local runtime; full authenticated UI and
service-worker/WASM offline caching remain separate integration acceptance.

`tests/test_relay_operations.py`: 17 passed, including mid-soak cancellation and
failure cleanup. Ruff passed for the new runner/tests. Uvicorn's current legacy
WebSocket backend emits deprecation warnings; the runner intentionally uses the
same backend/settings as the existing Relay CLI, without changing dependencies.
