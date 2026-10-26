# Portable settings, pinned World revisions and browser prompt assembly

2026-10-24. Local implementation and artificial-data validation. No production
deployment, real inference, contracts, payments, account changes or production
conversation erasure. The overall plan remains open in `UNIFIED_DELIVERY.md`.

## Changes

- The browser no longer ignores selected Lorebooks or generation profiles.
  `devicePrompt.ts` implements the portable compiler's bounded macro expansion,
  card overrides, original/variable macros, ordered markers, conversation examples,
  context templates and compatibility notices. Lore matches use scan depth,
  priority/insertion order, token budgets, selective secondary keys and recursive
  scans. Regex/probability/time/depth conditions are preserved as unsupported.
- `build_app_catalog.py` also generates a Python Unicode casefold map. Literal
  matching includes expansions, sigma and supplementary-plane characters without
  relying on JavaScript's different lowercase semantics. RPG triggers use it too.
- `tests/fixtures/portable-prompt.json` contains five frozen Python compiler and
  message-assembly results. Both Python and TypeScript check these exact results.
  This tests the portable path, not every legacy template/YAML route.
- Persona/World create/read/update/history/export now work through the shared
  creator UI and device store. Current editable heads and referenced immutable
  versions remain distinct. Cast IDs, fields, RPG rules and owner scopes are
  validated; source scripts are not executed.
- Device generation receives selected cast knowledge and relationships, a
  server-owned-style RPG outcome contract, selected Lore, profile instructions,
  request-only instructions and sampler overrides. Unsupported options are
  reported. GGUF API names use the installed wllama types; ONNX supports the common
  temperature/top-p/top-k/output-limit controls. Stop strings and ONNX seed and
  GGUF-specific options are not claimed as applied.
- Context fitting reserves the selected output length, merges adjacent equal
  roles and preserves system parts plus the latest input. It fails if those
  protected parts exceed capacity, rather than discarding World instructions.
- Referenced creator snapshots accompany consented conversation synchronization.
  Browser receipts hydrate exact versions atomically. Native projection creates
  separate creator identities and maps them back on export. Missing, mistyped,
  malformed, scripted or duplicate-cast dependencies roll back the copy/receipt.
- Incoming library/creator versions advance the local entity revision used by
  save compare-and-swap. Editing cannot overwrite a version already received
  from synchronization. This protects a referenced version while an editable
  local head remains on an older revision.
- The story editor labels the selected execution location instead of implying
  every RPG action runs on a server.

## Evidence

- Final frontend suite: **412 passed**. Earlier 411 predates the final immutable
  version collision regression. The final build includes the context merge and
  revision protections.
- Unified/bridge/portable fixture/source/bundle backend suite: **71 passed**.
  This includes native import/compile/export of exact World/Persona versions,
  cast knowledge and RPG options, plus rollback on invalid dependencies.
- Frontend typecheck and unified build passed; Mobile build is checked separately
  with the same source. Existing upstream externalized-module, static theme-script
  and chunk-size warnings remain; no dependency/lockfile changes were made here.
- Real browser: `127.0.0.1:5197/.artifacts/portable-ui.html`, isolated random fake
  owner, actual IndexedDB and shared `CreatorSettings` UI. Editing the fixture
  World from version1 to version2 preserved version1 in a conversation's compiled
  rules and outbound snapshots. Cast knowledge, RPG initial state, constant Lore
  and selected profile settings were retained. An initial text-input attempt
  appended to the field; a fresh run replaced the field and saved the intended
  exact text before acceptance. No source/model/provider data was used.
- Screenshot: `.artifacts/unified-portable-ui/verified.jpg`. Fixture owner/target
  settings were restored and the agent-created test tab was closed.
- Generation integration tests use a fake Worker result and assert the actual
  assembled messages, RPG state, requested/applied options and unsupported list.
  They are not evidence of real model quality or phone performance.

## Still open

Native-PC entity synchronization, canonical shared-history branching, historical
generation snapshot interchange, all imported media/binary formats, browser
research execution, full JA/EN coverage and real-model/device acceptance remain
open. Source-linked summaries still need complete context-policy parity. The new
code does not establish that long prompts fit a phone model, that profile options
produce identical samples across runtimes, or that unsupported source conditions
can be executed. The old release candidate is stale and must not be deployed.

Public-domain/OAuth/CSP cutover, backups and production acceptance remain separate.
Commercial/adult/guardian integrations remain closed pending accepted providers.
