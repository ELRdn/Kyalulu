# Private cloud VPS / Google auth — 2026-10-04

## Verified deployment

- Separate `kyalulu-cloud` Compose project on the existing ConoHa VPS.
- Release: `/opt/kyalulu-cloud/releases/20261004-google-private/bundle`.
- Image: `kyalulu-cloud:20261004-google-private`; initial image ID `7f45a56a2919`.
- Archive SHA256: `7ab7c207b6d51db59f323df8864d9a3da539e7993ebe8ec8b08b0791391f32d4`.
- Allowlisted prebuilt Web and source, 165 outer files / 824 corresponding-source
  files. Archive and nested source scanned against configured secret values;
  no env, keys, private databases or model weights transferred in the archive.
- Private env sent separately over the existing verified key-only SSH connection,
  mode 0600. One invited email; private signup limit one; automatic trial zero.
- Fixed OpenRouter/InferenceNet/DeepSeek V4.1 Flash route retained. Inference,
  billing, advertisements and image storage were disabled at initial deployment.
- Cloud runtime starts healthy with non-root UID10002, read-only filesystem,
  memory/CPU/process limits and no Docker request logs. Port8020 is loopback-only.
- Existing Caddy accesses `kyalulu-cloud-runtime:8000` over the existing Docker
  network. Combined config validated and original saved before one Caddy restart.
  Relay container was not restarted; Relay HTTPS health remained HTTP200.
- DNS resolves cloud.kyalulu.com to the VPS; trusted HTTPS cloud health is HTTP200.
- Web, source offer and legal draft pages respond. Anonymous account API is401,
  billing endpoints404, foreign-origin mutation403, invalid Host400.
- Real Chromium390px login screen has Google login, disabled before consent/age;
  no page errors or horizontal overflow. No mocked API in this deployed UI check.
- Local affected auth tests:19 passed; Web production build passed; Ruff F passed.
  Existing bundling warnings and local pytest cache permission warning remain.

## Resource observation

Before cloud launch: OS available531MiB, swap used61MiB; Relay and Caddy healthy.
After cloud launch: cloud46MiB, Relay13MiB, Caddy15MiB; OS available473MiB, swap
used71MiB. These are idle observations, not concurrent-load or 24h acceptance.
The VPS build used384MiB memory /512MiB including swap and0.5CPU limits on build
steps. Web was built on the PC. Docker's legacy builder is deprecated upstream.

## Google login and owner credits

Supabase's real auth settings return200 with Google enabled and an anon-role key.
Supabase's authorize endpoint returns302 to accounts.google.com with its own
project `/auth/v1/callback` as the Google redirect URI. The user initially encountered
Google400 `redirect_uri_mismatch`. The Google Web OAuth client's authorized
redirect must match that exact Supabase URI. Supabase's app redirect is separately
`https://cloud.kyalulu.com/auth/callback`.

After the redirect correction, one active account and its encrypted identity were
found. Its UUID and email were reverified against Supabase's real user endpoint
and the single invited email before the offline grant. `owner-initial-500` granted
500 K-Credits for 30 days, with balance 500 and exactly one grant record. No UUID,
email or auth credentials are printed in the saved evidence.

Private inference was then enabled for the selected OpenRouter/InferenceNet/
DeepSeek V4.1 Flash route. Public status confirms it is available while billing,
images and admission beyond the invited account remain disabled. Only the cloud
container was recreated; account, session and wallet data remain in the existing
cloud volume. Relay health remains HTTP200. This private testing authorization
does not clear public model-quality or operational acceptance.

No real cloud conversation/SSE, backup/restore, sustained load or device
acceptance is claimed yet. No extra paid API requests were made. Prior API
costs/reservations are carried forward as
49,548,721 nanodollars against the authorized100,000,000 cumulative limit.

Ignored evidence: `.artifacts/cloud-vps/{internal-acceptance,public-acceptance}.json`
and `live-login-390.png`. Public acceptance includes actual TLS and Relay checks.
Later evidence: `owner-grant.json` and `private-inference-enabled.json`. The earlier
public acceptance records the configuration before private inference activation.
Duplicate `nosniff` headers from Runtime and proxy contain the same value; the
probe validates all comma-separated values instead of requiring a single header.
