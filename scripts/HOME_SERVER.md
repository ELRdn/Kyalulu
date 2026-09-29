# Android PWA home runtime (backend)

This is a single-user shared runtime. Paired devices can read the same conversations
and catalog and modify conversations/settings; pairing is not tenant isolation.
Remote access is OFF by default, and non-loopback clients are rejected even if the
ordinary development server accidentally binds to all interfaces.

## Start

Build the existing web app (`pnpm --filter web build`). Obtain a TLS certificate
trusted by the Android device for the public hostname. For public-name-only certificates, pass the public DNS name with
`--tls-name` to the local CLI. This sets TLS SNI and certificate hostname validation
while the connection URL and HTTP Host stay loopback. Keep the private key outside the web dist. Do not bypass browser or CLI certificate verification.

PowerShell, from the repository root:

```powershell
.venv/Scripts/python.exe scripts/home_server.py serve --origin https://home.example:8000 --cert C:/certs/home.pem --key C:/certs/home-key.pem
.venv/Scripts/python.exe scripts/home_server.py code --tls-name home.example --ca C:/certs/ca.pem
.venv/Scripts/python.exe scripts/home_server.py devices --tls-name home.example --ca C:/certs/ca.pem
.venv/Scripts/python.exe scripts/home_server.py revoke DEVICE_ID --tls-name home.example --ca C:/certs/ca.pem
```

With Tailscale installed on both PC and Android, enable MagicDNS and HTTPS certificates
in the tailnet, then use the PC's exact MagicDNS certificate name (replace the example):

```powershell
tailscale cert --cert-file C:/certs/pc.tail123.ts.net.crt --key-file C:/certs/pc.tail123.ts.net.key pc.tail123.ts.net
.venv/Scripts/python.exe scripts/home_server.py serve --host 0.0.0.0 --port 8000 --origin https://pc.tail123.ts.net:8000 --cert C:/certs/pc.tail123.ts.net.crt --key C:/certs/pc.tail123.ts.net.key
.venv/Scripts/python.exe scripts/home_server.py code --url https://127.0.0.1:8000 --tls-name pc.tail123.ts.net
.venv/Scripts/python.exe scripts/home_server.py devices --url https://127.0.0.1:8000 --tls-name pc.tail123.ts.net
.venv/Scripts/python.exe scripts/home_server.py revoke DEVICE_ID --url https://127.0.0.1:8000 --tls-name pc.tail123.ts.net
```

Allow inbound TCP 8000 only on the intended private/Tailscale interface in Windows
Firewall. The all-interface bind is needed for the same listener to accept both
loopback administration and Tailscale traffic. Use tailnet access policy to restrict
which peers can connect. Android must be connected to the tailnet. There is no need
for Tailscale Funnel or public router port forwarding. Public-CA certificates need
no `--ca`; a private CA needs its CA PEM. Renew certificates before expiry and
restart the server to load the replacement (all devices must pair again).
This direct-TLS Tailscale procedure is documented, not tested against a live tailnet.

Open the exact HTTPS origin on Android and enter the 8-digit code. Codes last 120
seconds, are single-use, and lock after five failed attempts. Issuing another code
invalidates the previous code. A global 30-attempt/minute gate bounds guessing
across addresses. Up to 32 devices may be paired. Cookies last 30 days; revoke or
logout denies subsequent API requests immediately. Requests already accepted
(including a running generation/SSE stream) can finish. Restart logs every device
out and removes any unused pairing code. Run **one worker**, with no auto-reload.

The launcher disables forwarded-header trust. Direct TLS is the supported launcher
configuration. If independently operating a TLS reverse proxy, it must preserve
public Host, sanitize forwarded headers, provide the HTTPS ASGI scheme through
explicitly trusted proxy configuration, and never expose a loopback-admin Host.
Forwarded requests cannot use local-admin privileges. Proxy deployment is not
validated by these tests. No automatic firewall, certificate, or tunnel setup occurs.

For custom startup, set `KYALULU_REMOTE_MODE=1`, `KYALULU_PUBLIC_ORIGIN` to the exact
HTTPS origin (no path/trailing slash), and `KYALULU_WEB_DIST` to the absolute built
dist directory before importing `python.api.main:app`. Missing/invalid remote
origin or dist fails startup. Do not add the public origin to development CORS;
remote clients navigate to the HTTPS runtime and use relative same-origin URLs.
Environment changes require a restart. Local desktop development origins retain
the existing trusted-origin behavior. Loopback access without a device cookie is
administrative; public Host, forwarded requests, and paired cookies never inherit
that privilege. Treat local processes and the trusted local desktop as administrators.

## API contract

All `/api` responses, including errors and SSE, use `Cache-Control: no-store, private`.
The frontend/service worker must ALSO exclude API requests from its own Cache API:
HTTP cache headers cannot prevent a service worker from explicitly caching data.

- `GET /api/mobile/status`: public `{remote_mode: boolean, authenticated: boolean, administrative: boolean, device_name?: string}`.
  Local desktop reports authenticated/administrative; public devices never report administrative.
  The frontend can hide Studio, Research, debug and URL Hub import when administrative is false.
- `POST /api/mobile/pair`: JSON `{code: "12345678", name: "Pixel"}`. Name: 1–80
  characters. Success: `{authenticated: true, device_name: "Pixel"}` and an opaque
  `__Host-kyalulu_device` cookie (Secure, HttpOnly, SameSite=Strict, Path=/, no Domain).
- `POST /api/mobile/logout`: 204, revoke the current cookie and delete it.
- `GET /api/models` (also `/api/mobile/models`): authenticated read-only selector `{models: [{id, display_name}]}`.
- `GET /api/health`: public, only fixed status/version/runtime identifiers.
- Local administration: `POST /api/mobile/admin/code` → `{code, expires_in}`;
  `GET /api/mobile/admin/devices` → `{devices: [{id, name, created_at, expires_at}]}`;
  `DELETE /api/mobile/admin/devices/{id}` → 204 (404 if absent). No cookie secrets
  or code hashes are exposed. Times are Unix seconds.

Remote mutations require the exact public `Origin` header. Cross-origin requests
and cross-site fetch metadata are rejected. Public endpoints require the configured
HTTPS Host too. Errors have `{error, code}`. 401 `authentication_required` means
return to the pairing gate; 403 means origin/permission rejection, not session expiry.
Bad/expired/reused codes: 400; lock/rate limit: 429; full device list: 409.
Malformed request bodies: 422.

Paired devices may use chat (including stream/suggest/intro/history/session settings),
read characters/personas/worlds, edit presets, use memory CRUD/session toggles,
create and revise persona/world content, and import local character files/text,
save library content, upload images and export content. Recovery route contracts are
`GET /api/chat/generations/{generation_id}` and
`POST /api/chat/generations/{generation_id}/cancel`; both require `?session_id=...`,
and the chat implementation owns generation/session matching. Paired chat submit,
suggestions and settings require an explicit JSON `session_id`; history clearing
and intro injection require it in the query. Empty, whitespace, control characters
and reserved `__...` IDs are rejected. Individual history edits/deletes validate
the stored message session. Local administrator behavior remains unchanged.
The reviewed method/path allowlist lives in `runtime/python/api/mobile.py`.
Other APIs are denied, including unknown future APIs, LE/commands/model management,
model downloads, providers/diagnostics, chat debug, URL imports/hub proxy, research,
experiments, benchmarks, and admin. Remote `/api/models` returns only id/display_name;
local desktop keeps its existing response. API docs/OpenAPI are unavailable remotely.

Static dist is mounted after API routes. Extensionless HTML navigation falls back
to index; missing scripts/assets and unknown API routes never receive SPA HTML.
Static files revalidate; root `sw.js` and `service-worker.js` use no-store plus
`Service-Worker-Allowed: /`. Dotfiles and symlinks outside the dist are not served.
Only deploy public build output to dist; never place credentials/source data there.

## Verification boundary

Backend tests cover pairing, expiry, revocation, origin/Host boundaries, default-deny
permissions, desktop compatibility, mock chat/SSE, and static headers. They do not
verify Android installation, TLS trust, real-device service-worker updates/offline
behavior, or a real-model generation over a phone network. Those are release
acceptance checks, not implied by a passing backend suite.
