# Windows initial-sync timeout investigation

PR run `41214778993`, Windows job `124576922632`, on `b9feb73` failed because `missing-creator` did not publish its result within the existing 90-second deadline. The final matrix was 29/30 with no blocked requests or page errors. The same-HEAD push succeeded on both OSes; the PR Ubuntu job also succeeded.

The timeout remains **unresolved and locally unreproduced**. No timeout, retry, staging driver, fixture or product condition was changed to make it pass.

## Local evidence

An independent investigation ran the existing assertions and old oracle on fixed pre-correction working sources: 40 focused repetitions, the original 30-result matrix, and 60 observed missing-library/missing-creator alternations. All **130/130** results passed; `missing-creator` passed 71 times. All cases had zero page errors, blocked requests or downloads and preserved authored source bytes without publishing tentative outbox parts.

The 60 lifecycle traces each observed one abort on the readonly prepare transaction, its abort event, and a successful subsequent rollback-check snapshot. Missing creator resolution throws from `withLibrarySnapshots`; `appTransaction` rejects and closes the DB. No second abort or active storage-write queue was observed in this path. Therefore the separate incoming receive double-abort correction does not explain this historical hang.

Artifacts: `.artifacts/staging-ci-diagnostic-local/{summary.json,source-before.json,ci-source-comparison.json,repeat40.log,full.log,observed60.log}`. These runs pinned 329 files at aggregate `7d82820f9fcc6cca61da396bfed0a166691b053450978686a0d2fa4676e403cd`. They used installed Chromium 151.0.7922.34, Python 3.13.5 and Node 26.5.1. The artifact launcher used the existing Vite config with Node TS loading and an artifact-local cache; hosted CI used Python 3.13.16/Node 22. These are local diagnostics rather than an exact hosted-environment reproduction.

After the shared storage-failure correction, the parent ran the unchanged normal `e2e_sync_staging.py --accept-current-source`: **30/30**, exit 0, unchanged before/after sources, old oracle and independent byte checks retained. Evidence: `.artifacts/staging-ci-diagnostic-local/post-parent-fix-final.log`. This verifies the final local path; it does not prove the prior hosted timeout is fixed.

## Remaining evidence

The old CI log has no in-page progress checkpoint or outstanding-request/transaction state, so the stalled await cannot be identified. New hosted CI remains separate evidence. Local passes and the separate receive defect must not be presented as root-cause resolution of this timeout. No production, model or provider traffic was involved.
