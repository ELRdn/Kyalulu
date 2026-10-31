# Unified sync receipt CI timeout (2026-10-31)

- Base: `57c3537`, branch `codex/unified-app-integration`, Windows local validation.
- PR run `41199510375`: `lineage=false` timed out at 5,000 ms (reported duration 5,553 ms); the other 1,468 tests passed. Source log: `.artifacts/ci-57c3537-pr-failed.log`.

## Cause and bounded fix

The unchanged focused test took 2,738 ms locally for `lineage=false`, versus 134 ms for `true`. Temporary phase instrumentation measured setup 41 ms, sync 67 ms, decoded-data assertions 4 ms, and the final `expect([...fixture.parts]).toEqual(before)` **2,281 ms**. Only the false case performs that last comparison. Generic deep equality over the stored typed-array bytes dominated the test; no production performance defect was demonstrated. Instrumentation was removed after diagnosis.

`appSync.test.ts` now compares the exact ordered part keys with `toEqual` and every part's complete bytes with Node's native `Buffer.compare` (already used by another test in this repository). This still detects changed, truncated, extended, missing, extra, or reordered parts. Added explicit assertions require more than one stored part and more than 1 MiB of serialized bytes. The 80-message Unicode fixture, exact decoded payload/metadata, dirty revision handling, empty retained parser root messages, GET-only receipt adoption, and outbox removal assertions remain intact. No timeout, production code, shared harness, or dependency changes.

## Fresh checks and evidence

Commands run from the repository root with `TEMP` and `TMP` set to `.artifacts/sync-ack-ci-temp`:

```powershell
node apps/web/node_modules/vitest/vitest.mjs run --root apps/web src/lib/appSync.test.ts --reporter default --reporter json --outputFile '../../.artifacts/sync-ack-ci-fixed.json'
node apps/web/node_modules/vitest/vitest.mjs run --root apps/web src/lib/appSync.test.ts src/lib/jsonStream.test.ts --reporter default --reporter json --outputFile '../../.artifacts/sync-ack-ci-regression.json'
node apps/web/node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit --incremental false
```

- Sync suite: **71/71 passed**; receipt cases false/true: **114/123 ms**.
- Sync plus streaming regression: **93/93 passed**; receipt cases: **92/117 ms**.
- TypeScript check and scoped `git diff --check`: passed.
- Before: `.artifacts/sync-ack-ci-baseline.log`, `.artifacts/sync-ack-ci-baseline.json`.
- Phase diagnosis: `.artifacts/sync-ack-ci-phase-timings.log`.
- After: `.artifacts/sync-ack-ci-fixed.{log,json}`, `.artifacts/sync-ack-ci-regression.{log,json}`, `.artifacts/sync-ack-ci-typecheck.log` (records exit 0 with no compiler output).

Limits: the full web suite and hosted CI were not rerun by this worker; physical browser/storage and release acceptance remain separate. Shared-worktree unrelated changes were left in place; no commit or push.
