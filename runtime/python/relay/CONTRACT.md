# Relay v1 contract

Relay stores routing metadata, never Noise keys or PSKs. The host generates the
QR Noise PSK independently. Relay transports opaque bytes and cannot determine
whether a packet is a handshake or application data. Hosts MUST reject application
payload until E2EE identity verification and local approval succeed. Cloud performs
no inference. HTTPS/WSS is mandatory outside loopback.

All IDs are UUID strings. Secrets are random 256-bit URL-safe tokens returned only
at creation; SQLite stores SHA-256 digests. HTTP auth is `Authorization: Bearer TOKEN`.
No tokens in URLs. Request JSON rejects unknown fields. Errors never echo bodies.

* Local CLI `invite --ttl 300 [--owner OWNER_ID]` creates a single-use invitation
  (maximum TTL 300 seconds). Omit owner to create a new owner upon redemption.
* `POST /v1/invitations/redeem {"invite":"…","name":"…"}` ->
  `{owner_id,host_id,host_token}`. Existing-owner invitations add a host.
* Host `POST /v1/pairings {"ttl":300}` ->
  `{pairing_id,token,expires_at}`. This token is a single-use client enrollment
  ticket, NOT a Noise PSK. TTL is an integer from 1 to 300 seconds.
* `POST /v1/pairings/{id}/redeem {"token":"…","name":"…"}` ->
  `{owner_id,host_id,device_id,device_token,pending:true,expires_at}`.
  Pending clients expire 300 seconds after redemption. Enrollment alone grants
  transport access for E2EE verification, never application authorization.
* Host `POST /v1/devices/{id}/approve` -> `{device_id,pending:false}`.
  Call ONLY after E2EE verification/local user approval. Only the paired host may
  approve. Persistent client quota is charged here; repeat approval is idempotent.
* Host/client `GET /v1/hosts` -> `{hosts:[{host_id,name,online}]}`. Hosts see their
  owner's hosts; clients see only their paired host. A token cannot select another host.
* Host `DELETE /v1/devices/{id}` -> 204. Any host of the same owner may revoke
  a client or host. Host revocation cascades to its clients and tickets. Active
  sockets close before the response; revocation survives restart. Self-revoke allowed.
* `GET /healthz` -> `{status:"ok"}` after SQLite connectivity check.

WebSocket `/v1/socket`: send text JSON `{"role":"host"|"client","token":"…"}`
within five seconds (maximum 1024 UTF-8 bytes). Server replies `{"type":"ready"}`.
No query string is accepted. Client Origin must match configured `RELAY_ORIGINS`
(the explicit APP HTTPS origin, never wildcard). Host MUST omit Origin. HTTP CORS
allows only those APP origins, GET/POST/DELETE and Authorization/Content-Type;
credentials/cookies are not used. A second connection for the same device is rejected.
A client requires its paired host online; there is no offline message storage.

Host receives `{"type":"open","connection_id":"UUID","device_id":"UUID",
"pending":true|false}` before any client binary data. Client and host may start
Noise exchange after ready/open. Client sends and receives raw Noise bytes, maximum
65536 bytes. Host binary format is 16 bytes UUID.bytes (network order) followed by
Noise bytes, maximum 65552 bytes. Unknown/cross-host connection UUIDs close the host
socket. Host may send only text `{"type":"close","connection_id":"UUID"}` after
authentication. Server sends that close control when a client disconnects. Closing
a host closes all its sessions. Clients cannot send text after authentication.

Close codes: 1008 invalid auth/protocol/expired/revoked/rate limit, 1009 oversize,
1013 unavailable/duplicate/slow peer, 1001 host disconnected or shutdown.
Ready is queued before open/data for each recipient. Delivery is not durable.
Approval changes persisted status; open.pending is a snapshot, not authorization.

Limits: 10 owners, 2 hosts/owner, 5 approved clients/owner, 5 live pending clients/owner,
10 outstanding pairings/host, 100 live CLI invitations. Deleted owners are not recycled.
FIFO queues are 32 frames/socket; send deadline is 5 seconds. Saturated sockets are
disconnected with their sessions. At most 128 concurrent WebSockets including auth,
120 HTTP/WS attempts per IP/minute, 1200 globally/minute, 256 frames/socket/second
and 4 MiB/socket/second. Rate limits are process-local: exactly ONE worker/replica.
HTTP JSON limit 4096 bytes, body/auth read deadline 5 seconds. Application/Caddy
access logging is disabled; no request bodies, tokens or Noise frames are logged.
Untrusted proxy headers are ignored; behind Caddy the per-IP limit is shared.
Validation errors expose only a generic message. Responses use Cache-Control: no-store.

Failures: 401 invalid/expired credentials or enrollment ticket, 403 wrong role,
404 unknown/out-of-scope resource, 409 quota, 413 body too large, 422 invalid JSON
schema, 429 rate limit, 408 body timeout. Ticket consumption, creation and quota
checks are atomic. Failed redemption/approval does not consume a ticket/slot.

Operational secrets (invites/tokens) printed by CLI must be shared privately. Backup
files contain credential hashes and metadata and must be protected. No recovery of
lost tokens; revoke/re-enroll. No inference or cryptographic implementation here.
