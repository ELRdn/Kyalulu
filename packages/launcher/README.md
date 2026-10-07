# Kyalulu local beta

Free Character AI Core: characters, conversations, Memory Lab, Persona/World,
relationships, import/export, local models and BYOK. No Kyalulu subscription,
cloud account, or K-Credits are required for local inference/BYOK.

Target: Node.js 22+, Windows 11 x64 / macOS Apple Silicon.

```sh
npx kyalulu
npx kyalulu doctor
npx kyalulu stop
npx kyalulu backup ./kyalulu-backup.zip
npx kyalulu restore ./kyalulu-backup.zip
npx kyalulu@latest update
npx kyalulu rollback
```

The first launch downloads a versioned runtime/Python/dependency/Web bundle
verified by SHA-256. It does not download model weights. Connect your existing
LE, LM Studio or Ollama. LE automatic installation is currently disabled.

Data stays in `%LOCALAPPDATA%/Kyalulu/data` or
`~/Library/Application Support/Kyalulu/data`. Backups precede updates/restores.
`stop` uses an ownership token and never kills another API or model server.
`rollback` selects the previous runtime; restore the before-update backup if a
schema migration requires rolling back data too. Keep backups private.

**Publication gate:** the checked-in manifest intentionally has no artifacts.
The package cannot bootstrap until both native artifacts, corresponding source,
licenses, fresh-device acceptance and npm-name permissions are confirmed.
Registry lookup on 2026-10-03 returned 404 for `kyalulu`; ownership is still
unconfirmed. This source tree is an implementation candidate, not a published CLI.

AGPL-3.0-only. Each runtime artifact includes corresponding application source
and Python package license metadata. See THIRD_PARTY_NOTICES.md.
