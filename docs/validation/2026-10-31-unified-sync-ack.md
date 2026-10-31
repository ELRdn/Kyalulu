# Non-branch sync acceptance without restored history (2026-10-31)

Normal synchronization receipts previously restored every selected local conversation
and serialized it again, even when only serverRevision/dirty changed. The fixed
outbox was already durable, but receipt processing retained another local history.

## Change and compatibility

The existing owner-scoped identity/message-ID scan first selects stored headers.
Receive paths still restore the required records; acknowledgment processing visits
one header at a time. Non-branch, non-deleted conversations use the new store writer:

- Without new lineage, all source parts/SHA and JSON syntax are verified with a
  zero-message root window, then only the entity header is updated. Its exact body
  manifest, authored revision, message IDs, draft and current edits remain unchanged.
- With lineage, the existing streaming conversation writer copies messages and
  replaces only root lineage metadata. Authored revision and numeric IDs stay fixed.
- Memory-domain pending checks, owner/generation/consent fences and the durable
  request-ID check remain. Source update, sequence and fixed-outbox removal share
  the same guarded transaction; a late failure aborts all of them.

Branch acceptance, deletions and non-conversation records keep the complete-record
path, including identity collision checks, imported ID mapping, source retention,
memory-event copies and deletion reconciliation. Stable authored IDs are not replaced
just because a normal server revision is accepted. An edit newer than the uploaded
revision remains dirty.

## Evidence on the combined serializer/ACK source

- Full Web: **1,456 passed / 92 files**, **16.87 s**. Focused sync/transfer:
  **92 passed**, **6.96 s**. TypeScript and unified build **10.44 s** passed.
- Actual Chromium sync matrix: **15/15**, including all ten previous receive/branch/
  selection/deletion/reference/fence scenarios. The five added normal-ACK cases use
  **5,045,278 bytes / five parts / 80 messages**. Every observed root message array
  stays empty; the body-only path retains the exact part manifest.
- Complete payload comparisons preserve source state, draft, extension fields,
  identities and newer local edits. Correct lineage is added without remapping IDs.
- Last-part corruption, second-new-part quota and owner switch at the final source
  read retain the exact physical source, fixed outbox, sequence and unrelated state.
  The corrupted fixture part is restored only after the failed transaction to verify
  that the complete original logical record is recoverable.
- All **326 source hashes** stay fixed; external/page errors are zero. Fifteen
  contexts close, Chromium disconnects, owned Vite stops and its fixture directory
  is removed. Synthetic responses exist only inside the page's fetch adapter.
- Shared-writer Research regression: **19/19**, all **325** inputs unchanged;
  independent multi-part body/physical-byte oracle and late rollback checks pass.
- Corresponding-source fixture/helper closure: **3 passed, 10 deselected**, **13.19 s**.

The unit initially compared the harness's internal memoryReferences with a public
entity; that expectation was corrected. Its new fixture uses two parts to keep the
unit focused, while the five-part browser data and existing assertions/deadlines are
unchanged. A preliminary browser pass preceded source freeze; the final run above
includes the serializer change and records its complete source fingerprint.

Logs: `.artifacts/sync-ack-web-all.log`, `sync-ack-unit-final.log`,
`sync-ack-typecheck-final.log`, `sync-ack-unified-build.log`, `sync-ack-browser-final.log`
and `sync-ack-research-browser.log`.
Sync result retained as `.artifacts/sync-ack-browser-result.json`, SHA-256
`6112d73d4cfbd17d4c301063911e7a4e177d8fcd29ac92d04a9bbda6408135c7`;
source fingerprint `b246b0c118550eb70eddbf03b9fcabf60bf8f5c17aafd4429e6c6894c4523204`.
Research result: `.artifacts/sync-ack-research-browser/result.json`, SHA-256
`d1cefb977d33c71092e7a981f6ece353c562fa6c632fdd597bafd45553ec2019`.

## Limits

Every source byte is still scanned. Metadata/scalars, a decoded current message,
legacy inline records and selected headers/IDs can remain whole. Fixed outboxes are
still fully restored for upload/receipt handling; branch acceptance and hydration/
export/receive retain their existing whole-tree paths. This does not accept complete
1 GB sync, process RSS, a real server/model/device or production behavior.
