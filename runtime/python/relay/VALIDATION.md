# Relay validation — 2026-09-29

Implemented only under `runtime/python/relay/`, `deploy/remote/`,
`scripts/relay.py`, and `tests/test_relay.py`. No Git commands, repository dependency
manifest edits, public listeners, image pulls/builds, or deployment actions.

Verified locally:

* `python -m pytest tests/test_relay.py -q --tb=short`: **27 passed**.
* `ruff check runtime/python/relay scripts/relay.py tests/test_relay.py`: passed.
* `docker compose -f deploy/remote/compose.yaml config --quiet` with separate
  example APP/Relay domains and an example APP_DIST: passed. Docker emitted a
  local config-read permission warning; configuration expansion still exited 0.

Tests cover owner/host/client quotas, pending expiry and quota recovery, concurrent
ticket redemption and last-slot approval, tenant scoping, paired-host approval,
CORS and WS origins, first-frame auth deadline, multiplexed opaque binary routing,
maximum/oversize frames, cross-host injection rejection, active revocation and
restart persistence, host disconnect cleanup, pending socket expiry, bounded
queues, slow sender timeout/isolation, rate limits, generic validation errors,
absence of token/body logs, and CLI backup/restore including overwrite refusal.

Test environment: FastAPI 0.141.1, Uvicorn 0.52.4, websockets 17.0.1. The only
test warning was Starlette deprecating its httpx-based TestClient transport; no
dependency installation or replacement was made.

Not verified: container image build/start, Caddy executable validation, actual TLS
or DNS, browser/PWA CSP compatibility, real TCP slow-reader behavior, and integrated
Noise/host/UI flow. WebSocket protocol tests use Starlette TestClient; slow senders
use controlled async sockets. No claim of end-to-end cryptographic acceptance.

The API contract is `CONTRACT.md`. Main-thread messaging was attempted on explicit
request but the app tool rejected native-ancestor messaging; the shared contract
file is the integration handoff.
