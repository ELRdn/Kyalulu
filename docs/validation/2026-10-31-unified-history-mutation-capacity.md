# Fictional 1 GB history mutation diagnostic

The history streaming changes based on `3688179`, before the later hydration/cache
follow-up, were measured on a fresh,
SHA-256-verified copy of the existing fictional profile: exactly
**1,000,000,000 UTF-8 JSON bytes**, 954 parts, 15,240 deterministic messages.
The real `deviceFetch` PATCH, DELETE and clear routes run under the owner's
execution lease. No model, external API or production data is used.

| Operation | Mutation ms | Independent verification ms | Remaining messages | Output bytes |
| --- | ---: | ---: | ---: | ---: |
| Edit middle message | 109,992.6 | 46,996.3 | 15,240 | 999,934,523 |
| Delete first message | 113,127.2 | 46,567.4 | 15,239 | 999,868,913 |
| Clear | 73,600.4 | 3.2 | 0 | 132 |

The independent verifier checks every remaining message's full content and
identity against the deterministic generator after edit/delete, plus metadata,
manifest and body digest. Fourteen complete parser scans retain zero root
messages. All three owner lease admissions succeed; the fixed outbox and original
profile remain unchanged. This is legacy local history, not a large shared-domain,
generation, branching, sync, export, restore or physical-device acceptance.
This frozen-source measurement is separate from final-source hydration tests.

The operation takes 390,290.9 ms; the browser phase takes 391.632 s, inside the
unchanged 480 s deadline. The owned Windows Job retains its 4 GiB commit/working-set
guard, 2 GiB available-physical-memory floor and 8 GiB free-disk floor.
Observed peak Job commit is 661,196,800 bytes; sampled aggregate process working
set is 1,251,307,520 bytes; sampled JS used heap is 44,636,092 bytes; backing
storage is 142,053,449 bytes (774 heap samples). These are distinct overlapping
metrics; do not add them or infer a universal memory ceiling. No forced GC or
heap snapshot is used. Metadata/scalars and one message still remain whole;
full scans and temporary output storage make these mutations slow.

Chromium 151.0.7922.34 reports no blocked request attempts, WebSocket attempts or
page errors. Measured product hashes and original-profile hashes remain unchanged.
All owned browser PIDs exit gracefully, browser exit is 0 and owned Vite exits
after termination. Diagnostic/original profiles are retained, not deleted.

Local evidence: `%LOCALAPPDATA%/Temp/kyalulu-history-1gb-mutations-20261031-070521-afb4dcd2/history-mutation-result.json`;
console `.artifacts/history-mutations-1gb-audit.log`. The private adapter
`.artifacts/unified-capacity-20261030/parser-memory-audit/history_mutation_audit.py`
reuses the earlier memory-projection/owned-Job diagnostics and public deterministic
capacity fixture. It requires retained local baselines and is not a standalone
public CI test. The separate [bounded public driver](2026-10-31-unified-history-mutations.md)
verifies shared/world/local/sync history semantics and failure rollback.
