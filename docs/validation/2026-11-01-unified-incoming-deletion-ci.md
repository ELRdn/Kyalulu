# Incoming deletion: stale browser instrumentation assertion

Ubuntu PR CI 41250300113, job 124682227586, failed `delete-then-incoming` with
`Known deletion scrub did not read whole local A`. The corresponding push CI
failed the same step; its complete log was not independently diagnosed.

The assertion predated the segmented deletion rewrite. `scrubGenerationRecords`
now reads metadata with `JsonStream({limit:0})` and streams the original messages
into replacement parts. Requiring a parser to retain all four full message bodies
contradicted that implementation. The failed run already contained nine successful
independent old-oracle decodes, including the actual intermediate revision-2 scrub.

Only the HTML fixture changes: parser observations include the configured limit;
the assertion requires a zero-window scan counting four messages, zero retained
messages/content, and no whole four-message body. Every callback parser must also
count four messages without retaining them. Complete oracle comparisons, revision
1 -> 2 -> 3, UUID/numeric mapping, owner/deletion fences, domain checksums, shared
transaction, cursor, untouched bytes and rollback checks remain. Product logic,
oracle source, deadlines and scenario coverage are unchanged.

Windows Chromium 151.0.7922.34 reproduced the original assertion failure. The fixed
case passed 1/1; the complete driver passed 40/40 across 39 closed contexts.
Fingerprint `f39651b47829a450941e193fb5f02f6507c181c8daae33d77b6cf895a27de9d3`
was unchanged before/after; browser disconnection and Vite port closure were checked.
Initial sandbox asyncio startup interruptions are retained separately from the
completed baseline/fixed runs. The independent decode includes intermediate scrub
data and first/last body hashes, rather than inferring preservation from UI state.

Evidence: `.artifacts/sync-incoming-deletion-ci-20261101/investigation.json` and
its preserved run records/payload archives. These were Windows working-tree runs
with the existing unrelated dirt recorded in their fingerprints. They establish
the bounded assertion correction, not immutable release or Ubuntu CI acceptance.
The parent reran 63 source/fingerprint/license/bundle tests after source changes
stopped; all passed. Updated hosted CI and production/real-device acceptance remain
separate. The existing 9269 GGUF context-fit limitation remains unresolved.
