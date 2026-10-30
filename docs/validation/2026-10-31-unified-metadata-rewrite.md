# Bounded Device settings and manual summaries

Settings saves and manual summary edits previously restored the complete Device
conversation before replacing metadata. They now inspect the existing maximum
50-message page and rewrite settings or summaries through the same message-stream
writer used for orphan recovery. Context GET also uses the bounded page. A page is
never passed to the complete-entity save API.

The write transaction rechecks the inspected owner, conversation identity, revision
and body token. Both memory-domain pending guards remain in force. Every original
piece, length, SHA-256, UTF-8 sequence and JSON structure must verify before adopting
the replacement. New pieces, refreshed selection/summary/reference hashes and old
piece removal commit together. Pending generation, complete message snapshots,
unknown fields, dirty/server revision and independent fixed outboxes are retained.
Inline legacy rows and settings creation for missing conversations remain supported.
Only settings and summaries can be changed through this metadata writer.

The adoption logic is shared with orphan recovery; its existing idempotence,
revision-bound legacy confirmation and domain/receipt atomicity are unchanged.
Summary edits retain extension fields and use the expected summary revision plus
the inspected conversation revision to reject stale changes.

Local checks:

- TypeScript and unified build pass using the documented explicit Relay origin.
- The existing complete Web suite passes: **1,321 tests / 84 files**. Three added
  manual-summary cases then pass with the **93-case** targeted Device read suite;
  all assertions on retained history, snapshots and unknown metadata remain.
- **48 real Chromium/IndexedDB scenarios** pass, including seven new metadata
  scenarios. Settings/context/summary operations retain at most 50 decoded history
  messages when inspecting and zero root messages while rewriting. All 120 fixture
  messages, snapshots and unknown fields survive two successive metadata updates.
- Failure after two tentative part writes, a missing final source part, owner
  change during writing and an intervening revision change retain canonical data
  and fixed outbox. Both memory policies block updates during domain generation.
  Existing orphan, proof, page, sync, migration and rollback scenarios still pass.
- External requests and page errors are zero. A focused independent diff review
  found no concrete defects; that static review is separate from runtime evidence.

The initial sandbox browser attempt failed on temporary-directory permissions;
the same fictional scenarios passed outside that sandbox in fresh contexts.
No production data, user browser storage or provider settings were changed.

Limits: each inspection scans the full body, and each update also rewrites it and
needs temporary storage. One message, metadata, scalar values and memory domains
remain whole. Legacy inline rows are cloned by IndexedDB. This change does not
accept 1 GB settings/summary operations, full-tree restoration, generation,
branching, sync/outbox, hydration/export, real inference or physical devices. The
earlier named 1 GB orphan diagnostic is separate evidence, not rerun acceptance of
this revision. Production cutover remains on hold and the integration PR stays Draft.
