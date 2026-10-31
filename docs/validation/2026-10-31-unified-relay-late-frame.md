# Relay detached-session response regression

During actual encrypted Remote browser acceptance, a late Host response for a
detached client raised `ValueError` and closed the whole Host with code 1008.
Other clients and reloads could lose their connection. The regression reproduced
another client's code 1001 disconnect before the fix.

`runtime/python/relay/app.py` now discards well-formed binary/close frames for an
absent session. It still rejects frames targeting another Host's active session
with 1008. Frame shape, UUID, size, rate and authentication checks remain before
the discard. No detached frame is delivered to a newly connected client.

Actual socket tests cover late binary plus close frames, a surviving second
client, reconnect with a different UUID, cross-Host binary/close injection and
five malformed Host frames. The related Relay/Host/bridge/management run records
135 passed with two failures: sandbox TEMP access in the CLI test and a missing
async marker on the new management test. After adding the marker and selecting
an owned TEMP directory, both failed cases pass (2 passed in 4.37 s). This is a
passing union, not a fresh 137-case aggregate run.

Evidence: `.artifacts/relay-late-frame-red.log`,
`.artifacts/relay-late-frame-green.log`, `.artifacts/relay-late-frame-final-two.log`.
The final [management browser acceptance](2026-10-31-unified-remote-management.md)
passes all 19 checks after this fix, including the character-less custom scenario.
Only fictional loopback sockets, owned fixture files and Mock inference were used;
no production Relay, TLS, real model or physical-device qualification is claimed.
