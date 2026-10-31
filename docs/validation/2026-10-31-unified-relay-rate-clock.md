# Deterministic Relay fixed-window test (2026-10-31)

The e76cc81 PR run41195754437 passed Ubuntu but failed Windows job124521453517 in
`test_rate_limit_bounded_and_http_throttles`: the final health response was200,
expected429. The complete Python job reported1failed/1,388passed. The individual
request timestamps were not captured, so the original exact clock ordering is unknown.

The limiter uses actual monotonic minute boundaries. The old test issued121 requests
without fixing its window, allowing a legitimate reset during the batch. A local
probe executes the exact old test from Git against a fictional SQLite/TestClient app,
advances only Relay's module clock after60 requests, and reproduces its failed
assertion at request121. This reproduces the mechanism, not the original worker trace.

The test now freezes Relay's time binding within one window, keeps all memory/global/
per-IP assertions and requires120successful responses followed by429. It then advances
to the exact next boundary and requires successful HTTP plus reset local limiter
count/IP state. Standard-library and event-loop clocks continue to run normally.
Production limiter code, thresholds and timeouts are unchanged; no retry is added.

Related Relay/operations suite: **51 passed**, **14.95 s**, including the existing
loopback10-owner/50-client checks. Pre-fix probe output is
`.artifacts/relay-rate-clock-red.log`; final suite log is
`.artifacts/relay-rate-clock-tests.log`; hosted failure log is
`.artifacts/ci-e76cc81-pr-windows-failed.log`.

The initial sandboxed TestClient could not start its asyncio self-pipe. A separate
one-request diagnostic captured socket.accept→fallback_socketpair→ProactorEventLoop
in `.artifacts/relay-testclient-sandbox-probe.log`. Both owned stalled diagnostics
were interrupted after this evidence; normal local runs then completed. This is an
execution-environment diagnosis, not an assertion suppressed by the test fix.
No real API, production DB, deployment or hosted Windows success is claimed here.
