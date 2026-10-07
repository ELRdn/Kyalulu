# Separate SFW Cloud Runtime

As of 2026-10-05, this Runtime is deployed at `https://cloud.kyalulu.com` for
one invited owner. Google login succeeded and private inference is enabled.
**Public launch and sales are not accepted.** Cloud Runtime owns the
character/history/memory database. Relay remains a separate encrypted transport.
No Redis, Postgres connection, or desktop process is required for Character Core;
Supabase is used for authentication only. SQLite has a single writer/process.

For the private Google-login test on the existing ConoHa VPS, see
[the VPS cloud runbook](VPS.md) and [current handoff](../../docs/HANDOFF.md).
Subscriptions, purchases, ads and unvalidated image storage/sync remain disabled.
The current release includes account preferences, the catalog fix and the plot
creator UI; its recorded ledger snapshot is 500 credits and zero operations.
The setup steps below describe fresh environments and public acceptance; do not
overwrite the existing private release's settings just to match default-off examples.

1. Configure a separate hostname, e.g. `cloud.kyalulu.com`. Preserve the existing
   `app.kyalulu.com`/Relay configuration. Web and API must share the exact HTTPS origin.
2. Copy `.env.example` to a private `.env`. Generate a random ≥32-character master
   secret. Keep it outside backups and retain it securely for disaster recovery.
3. Supabase: enable Google and email OTP/PKCE; whitelist exactly
   `https://cloud.kyalulu.com/auth/callback`. Enable email verification, use a custom
   SMTP sender with SPF/DKIM/DMARC, configure rate limits/abuse protection. Verify
   email delivery and Google redirects on real browsers. Never ship a service role key.
4. Complete/publish Japanese and English legal pages and seller disclosures. Set
   `KYALULU_LEGAL_APPROVED=1` only afterwards. Auth is blocked before this gate.
5. The initial operator backend is OpenRouter (`KYALULU_OPERATOR_BACKEND=openrouter`),
   with DeepSeek V4.1 Flash for conversations, structured work and SFW screening,
   pinned to InferenceNet (`inference-net`). Other models are not auto-routed.
   Set `KYALULU_OPENROUTER_API_KEY` privately. Keep `KYALULU_OPENROUTER_APPROVED=0`
   until real request/response schemas, retention/training conditions, processing
   locations, price ceilings, `usage.cost` and invoices are accepted. Keep
   `KYALULU_INFERENCE_APPROVED=0` until the real-model acceptance campaign passes.
   Data collection and provider fallback are denied by the request policy.
   Muse Contributor is not offered on this initial route; no Go subscription is required.
   Direct DeepSeek remains an explicit option (`KYALULU_OPERATOR_BACKEND=deepseek`)
   and a separate BYOK route. Actual non-thinking/JSON/usage and image screening
   quality still require validation. See [Web authentication](../../docs/WEB_AUTH.md).
6. Provision backup retention capacity and offsite storage. The local Docker volume
   is only a staging copy. Quoted capacity admission is conservative, including
   retained images/DB/encryption. Test restore into a new environment.

OpenRouter is selected from day one, not after a Go pilot or calendar-based switch.
The first-ten phase does not require a completed 72h pilot; that observation gates
expansion to one hundred. Prepared metadata checks are strict and need real acceptance.
Existing Go/direct-DeepSeek consent cannot authorize OpenRouter sends. For future
backend changes, drain jobs, update privacy/credit disclosures, deploy explicitly,
then ask users to log in again. Rollback also requires consent for its destination.
The retained optional Go adapter is not used by this deployment example and retains
its own permission/accounting gates; do not enable it through a personal subscription.

`KYALULU_CLOUD_SIGNUP_LIMIT=10` caps new accounts atomically. Zero closes new intake
without removing existing access. Increase to 100 only after the observation campaign.
Checkout stops when inference is unavailable; Customer Portal remains accessible.
Unexpected billed overages retain full known cost, return customer credits, record
budget debt and halt further funded sends. `cloud_admin.py budget` reports incidents.
7. Stripe test mode: configure USD prices `plus=$5`, `pro=$10`, `credits_5=$5`,
   `credits_10=$10`, portal, legal URL and signed webhook endpoint
   `/api/cloud/billing/webhook`. Reconcile fees, tax and billing country before sales.
   Only JP/US settled USD payments activate credit funding. Unknown invoice shapes,
   unavailable balance transactions and other countries require manual review.
   Pin/validate your Stripe API version; newer invoice payment retrieval is a release gate.
   Exercise event replay, backwards order, renewal/cancellation, proration, refund,
   dispute, and browser interruption. Leave billing approval off until accepted.
8. Build and deploy explicitly with approval. Compose exposes only a loopback
   port; integrate `Caddyfile.example` into the existing reverse proxy. Do not let
   Caddy access logs record auth callback codes. Limit logs to aggregate status/cost.
9. Measure the actual ~1GB VPS headroom. Container memory/CPU limits do not prove
   Relay latency, ten-user concurrency, 24h stability, or backup capacity. Stop
   rollout if Relay is affected. Production requires protected tenant/control/backup
   volumes and TLS; the app has no public administrative endpoints.

```sh
# After explicit deployment approval
docker compose -f deploy/cloud/compose.yml build
docker compose -f deploy/cloud/compose.yml up -d
# Offline operator tasks, with cloud env configured. Stop the service first.
python scripts/cloud_admin.py backup --file /private/disaster.kybackup
python scripts/cloud_admin.py upload --file /private/disaster.kybackup
# New empty data root + the same master secret:
python scripts/cloud_admin.py restore --file /private/disaster.kybackup
python scripts/cloud_admin.py budget
```

Hosted sync defaults off. Browser settings can issue up to five scoped 30-day
sync tokens for the local Runtime; keep them private and revoke them through
`DELETE /api/cloud/sync/devices`. They share the browser's authenticated session,
are revalidated with Supabase, and expire/revoke when the parent session disappears.
Local users explicitly opt in and choose selected sessions/all; no automatic push
or stale-write resolution. Runtime settings/keys/Remote data are excluded.

DeepSeek's official [pricing](https://api-docs.deepseek.com/quick_start/pricing)
and [vision](https://api-docs.deepseek.com/guides/vision) docs confirm that
`deepseek-flash` is DeepSeek-V4.1-Flash and supports vision. The adapter accepts
bounded, decoded inline static images. Image SFW screening is implemented behind
a default-off internal acceptance gate; public image storage, imports and sync
remain unavailable until accuracy and data consent are accepted. Indexed encrypted
image pages and atomic adoption are implemented (static images up to 1MB each).
Set `KYALULU_IMAGES_APPROVED=1` only after real-image SFW acceptance; it defaults
to zero. Each upload requires separate image consent, including local UI opt-in.
Image imports remain closed. No second provider or fallback is required.
Peak rates bound reservations; off-peak and holiday billing must be reconciled
against actual receipts before commercial acceptance. Local sync uses
encrypted paged staging, atomic CAS commit and immutable paged downloads. An
individual uploaded text row is capped at 50KB to fit the validated classifier
context. The compatibility single-snapshot API remains bounded to 16MB. Large
250MB/1GB transfers need throughput/memory/disk acceptance. Manual logical ZIP
export remains available without credit charges or storage-write admission.
Free trial maximum quotes must be proven usable in real onboarding.
Operator tax/FX reserves need real financial verification. AppLixir is a candidate,
not a working reward integration; all ad rewards remain disabled. These are release
limitations, not evidence of a completed cloud product.

The Docker image includes matching application sources, pinned build inputs,
renderer license texts and `/source.tar.gz` for the AGPL source offer. Review the
generated dependency inventory before distribution. The local artifact has the
same source archive. No operator credentials, databases or model weights belong
in either image or archive.
