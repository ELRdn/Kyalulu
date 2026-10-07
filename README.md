# Kyalulu

**Character AI that keeps your characters, memories and worlds with you.**
Free, local-first OSS Character Runtime with an optional SFW cloud service.

[日本語](README.jp.md) · [Launch specification](docs/LAUNCH.md) · [Roadmap](docs/ROADMAP.md) · [Current status / handoff](docs/HANDOFF.md)

Characters, conversations, Memory Lab, Persona/World, relationships, import/export,
local model connections and BYOK are part of the free Core. No Kyalulu subscription,
cloud account or K-Credits are required for local inference/BYOK. You pay your BYOK
provider separately. Paid cloud plans increase resources; personality and memory
algorithms are shared with the free Core.

## Launch channels

| Channel | Scope | Status |
|---|---|---|
| npm local beta | Node.js 22+, Windows 11 x64 / macOS Apple Silicon | Implementation candidate; unpublished |
| Browser/PWA cloud | Independent SFW Runtime, DeepSeek via OpenRouter/InferenceNet, Google login | Deployed private test for one invited account; public acceptance pending |
| Developer checkout | Python + Web + existing LE/LM Studio/Ollama | Available for development |
| Self-hosted GPU / signed Desktop / Expo | Later roadmap | Coming soon |

The local beta is designed for `npx kyalulu`: a pinned Python/dependency/Web bundle
is downloaded and verified by SHA-256. There is no Git/Python/uv/pnpm setup for end
users. The checked-in manifest remains empty until native artifacts, licenses,
name permissions and device acceptance are cleared. See [launcher](packages/launcher/README.md).

The cloud runs while your PC is off. It stores/processes conversation, character and
memory data. The selected model is **DeepSeek V4.1 Flash**, through OpenRouter
and InferenceNet for conversations, structured work and SFW screening.
Muse Contributor is not offered on this initial route.
Requests pin `inference-net`, deny provider data collection and disable fallback.
Private hosted inference is enabled for the invited owner. Public rollout still
requires privacy/retention, billed-cost and operational acceptance.
See [quality evidence](docs/validation/2026-10-04-openrouter-quality.md) and
[Google/email login setup](docs/WEB_AUTH.md). The current private test allows one
invited account, disables subscriptions/purchases/ads and has received an offline
grant of 500 K-Credits ($0.05 retail equivalent, not $0.05 of API cost).
Google OAuth and the owner's login succeeded. Custom SMTP/email delivery remains
unaccepted. Account display names, saved characters and pinned chats now persist
on the server. The plot creator has six tabs, intro previews and account-scoped
temporary drafts. See the [profile](docs/validation/2026-10-05-cloud-profile-sync.md),
[catalog](docs/validation/2026-10-05-cloud-catalog.md) and
[creator UI](docs/validation/2026-10-05-plot-creator-ui.md) records.
The current invitation limit is one; the planned first public phase allows ten.
72h observation is required before
expanding to one hundred, not before admitting the first ten. Lowering the cap
preserves existing login/export access.
Cloud BYOK initially supports only direct DeepSeek. No automatic provider
fallback. Sync defaults off; keys, Remote identities, experiments and device settings
are excluded. Conflicts require an explicit choice with a separate local backup.
See [cloud setup](deploy/cloud/README.md) and [legal drafts](docs/legal/README.md).

## Optional cloud plans

| | Free | Plus | Pro |
|---|---:|---:|---:|
| Monthly price | $0 | $5 | $10 |
| Operator credits | One-time 1,000 trial, subject to verification/funding | 12,500/month | 25,000/month |
| Cloud storage | 25MB | 250MB | 1GB |
| User restore | Manual export | 7 days | 30 days |
| Queue | Normal | Normal | Priority, preserving normal queue opportunities |

10,000 integer K-Credits = $1 retail reference; top-ups $5/50,000 and $10/100,000.
Charges aggregate input/output/safety/retries at six times API cost and round up
once. OpenRouter settlement uses reported `usage.cost`; published token price ceilings
are used for maximum reservations. Missing actual cost fails with zero user charge.
Maximum reservation
is confirmed before submission; failure charges zero.
Local/BYOK and normal CRUD/sync/export use zero K-Credits. Commercial activation
remains off pending payment, legal, capacity and operational acceptance. Reward
ads remain in preparation; future ad revenue does not fund trials.

## Developer quick start

Python 3.11+, uv, Node.js 22+ and pnpm 10 are development tools only.

```sh
cp .env.example .env
uv sync --frozen --all-packages --all-extras --no-install-workspace
uv run --no-sync uvicorn python.api.main:app --app-dir runtime --reload --port 8000
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173`. Connect an existing LE, LM Studio or Ollama. Mock Echo
can exercise the UI/Core without paid inference; mock output does not demonstrate
character quality. [Japanese developer guide](README.jp.md) covers import formats,
Hub adapters, Memory Lab, model configuration and evaluation commands.

```sh
uv run --no-sync python -m pytest tests -q
pnpm typecheck
pnpm --filter web test
pnpm --filter web build
node --test packages/launcher/test/launcher.test.mjs
```

## Architecture and boundaries

`runtime/python` owns character/history/memory/state; LE or another provider runs
models. `apps/web` supplies the shared UI; `packages/launcher` bootstraps the local
runtime; `runtime/python/cloud` is a separate allowlisted hosted API. Desktop and
Research tools remain available to developers. [CharacterBench](benchmarks/characterbench/README.md)
is a separate evaluation track, not a claim of real-model release acceptance.

[Encrypted Remote](docs/REMOTE.md) is a separate transport candidate requiring a
PC Runtime and external security review. Existing [PC-connected PWA](docs/ANDROID_PWA.md)
instructions apply to that developer channel.

Later: KCS/Character Compiler → Tool/MCP/events → Proactive/notifications →
voice/images/Expo → self-hosted GPU. Unimplemented continuous activity is not part
of the launch promise. Real models/devices, 24h operation, restore to another
environment and 10-user/72h observation precede broader rollout.

## License

AGPL-3.0-only. Runtime bundles include corresponding application source and
dependency license metadata; redistribution review precedes publication. No
credentials, personal data, model weights or proprietary DLLs are bundled.
