# Unified sync incoming: independent Chromium validation

Authoritative checkout: `D:/VibeCoding/my zeta`, branch `codex/unified-app-integration`, starting HEAD `b9feb73b6e246cf473ef77c631a334d364d966b2`.

## Final result

**PASS: 40/40 results across 39 scenarios plus resumed reload**, installed Chromium `151.0.7922.34`, process exit code **0**. The final full run occurred after the parent's explicit product/unit freeze and after all case changes and the shared storage-failure correction. The earlier `frozen-20261101-001` remains valid only for its previous source and is superseded for current-source acceptance. Evidence directory: `.artifacts/sync-incoming-browser/frozen-20261101-002`.

- Actual current `--print-source-hash`, frozen CLI argument, before manifest and after manifest all match: `cbbc30646998d2f9fd59f5c178973243ba812fc5ebaddac9fe137796a796ce96`. **337 files fingerprinted; zero changed sources.**
- **284 complete entity/payload-event comparisons**, including the actual intermediate deletion-scrub entity; 13 source/output first/last body-hash pairs. Frozen old receiver/binder/event/schema oracle integrity checks passed.
- The only added intentional old-oracle difference is final A's local revision `3` in `delete-then-incoming`, documented below. Its old coalesced revision `2` is preserved separately. Other headers, payloads, IDs, provenance and event comparisons remain enforced.
- Collision inline/paged rejection, B deletion before A incoming, reload/orphan retry, late faults and both real-tab Web Locks cases passed. Zero external requests, browser errors or downloads.
- All **39 disposable contexts closed**; owned Chromium disconnected and owned Vite stopped.
- Complete stdout: **81 ASCII-safe JSON lines** in `stdout.jsonl`; the sibling `frozen-20261101-002.console.log` matches those lines exactly, with no truncated or missing output.
- `artifact-audit.json` verifies all **40 case directories** have original transport/oracle inputs and physical before/after snapshots, all **284 entity directories** have complete actual payload, header, old expected and actual/expected events, and exactly one revision-exception artifact exists.
- Only these new source paths belong to this validation task: `tests/e2e_sync_incoming.py`, `tests/fixtures/sync-incoming.html`, `docs/validation/2026-11-01-unified-sync-incoming-browser.md`.

Relevant frozen file hashes:

| Source | SHA-256 |
| --- | --- |
| `apps/web/src/lib/appSync.ts` | `8ac445ab7c03511551f5466793c599efc71fb94316c6869e60e544e1753e6614` |
| `apps/web/src/lib/appSyncIncoming.ts` | `3e1ae2dfff0ac2dcd16d0f086cdff963daecf6fe579c1605c9b106a2ecf0fcec` |
| `tests/e2e_sync_incoming.py` | `c4c9262857571345214ef62cea66582f365273d8e0ca1b00f3454e9132c6bd16` |
| `tests/fixtures/sync-incoming.html` | `0f423dde087f7f1f38514bfa1a6a56992a269e86d99257a00cf178d3d92d7ce6` |

All exploratory artifacts remain untouched. Earlier `explore-20261101-007` passed 37 browser assertions but correctly exited nonzero because parent product/unit files changed during execution; it is superseded by this immutable final run. Parent review subsequently found and fixed the two defects covered by the added cases; targeted `008`/`009` runs were preparation, not freeze acceptance.


Product, unit tests, CI, collector, dependencies and Git state are outside this task. Unrelated dirty files are retained. The initial sandbox launch stalled before artifact initialization; its owned session was interrupted. Actual browser runs use the authorized local-process escalation. No pre-existing background job was restarted.

## Parent review regressions (added before freeze)

The parent reported two independently reproduced product defects and owns their fixes. This worker added three cases without changing the existing assertions. Targeted real-browser run `.artifacts/sync-incoming-browser/explore-20261101-008` passed **3/3 cases**, with 23 complete entity/event comparisons, zero external network/errors/downloads, and unchanged before/after source hashes. Those targeted results were exploratory; the final frozen full run above now covers them. The driver has 39 scenarios plus resumed reload (40 results). Existing `incoming`, `delete-recovery` and `duplicate-id` assertions also passed 3/3 in `explore-20261101-009` with unchanged sources; their expectations were not relaxed.

- `snapshot-collision-inline` and `snapshot-collision-paged`: the root character Library binding refers to the current conversation's own entity ID and includes a valid corresponding snapshot. Both public sync paths must reject the page atomically. Complete entity/meta/part snapshots and independently decoded originals/events remain exact, the actual pending outbox remains unchanged, and temporary incoming parts/manifests are cleaned. The fixture explicitly distinguishes the no-spool inline route from the paged spool route.
- `delete-then-incoming`: clean B (`retired`) is deleted before clean A's paged update in the same page. A starts at authored revision 1 with an actual `last_generation.memory` candidate whose `source_session_id` is B and contains `PRIVATE SOURCE B`, plus a separate candidate from A. The observer reads and retains actual intermediate revision-2 A part bytes inside the same IDB transaction after the scrub writes them. The existing Python decoder compares this complete intermediate A with the explicit fixture scrub expectation: B candidate/decision/injected/evidenced IDs and private diagnostics are erased, while A's candidate remains. Final B tombstone, B event scrub, both memory-domain erasures, A output, receipts, cursor and sequence are checked. Original A UUID/numeric message mappings remain exact; network/apply callback roots retain zero messages. The known deletion scrub also positively observes a whole local A parser root and is marked `whole_path`, rather than counted as elimination of all whole trees.

**Only the final A revision in `delete-then-incoming` intentionally differs from the old coalesced loop.** The frozen old receiver composition yields revision 2 (authored 1 plus receive). The required behavior first commits the deletion scrub as revision 2, then accepts A's update using that fresh header and advances to revision 3. The fixture explicitly asserts `1 -> 2 -> 3`, old expected `2`, and same-transaction intermediate/cursor writes. Python changes only this one final header field for the existing decoder; all other entity fields, complete payloads, numeric/UUID/memory identities and events still use the old oracle comparison. `entity-*/old-expected.json` preserves the actual old revision-2 expected output; `expected-intentional-revision.json` separately records the accepted revision-3 output, and `intentional_revision_difference` states the reason in structured results. No blanket revision normalization is applied.

## Reproduce

Use the existing `.venv` and installed Chromium. No installation or download:

```powershell
.venv/Scripts/python.exe tests/e2e_sync_incoming.py --check-oracle
.venv/Scripts/python.exe tests/e2e_sync_incoming.py --print-source-hash
.venv/Scripts/python.exe tests/e2e_sync_incoming.py --accept-current-source
# Final invocation (already completed; choose another NEW output directory to reproduce):
.venv/Scripts/python.exe tests/e2e_sync_incoming.py --frozen-source cbbc30646998d2f9fd59f5c178973243ba812fc5ebaddac9fe137796a796ce96 --output .artifacts/sync-incoming-browser/frozen-20261101-002
```

Every output directory must be new. `exist_ok=False` rejects overwrite. The source aggregate reuses the receive-projection driver's file closure and includes the new driver/fixture plus all current web sources, including `appSyncIncoming.ts`. Before/after fingerprints detect concurrent parent edits. Frozen CLI mode pins the supplied hash; parent coordination remains a separate requirement. `--accept-current-source` always labels evidence exploratory.

## Independence and evidence

The Python driver imports existing `check_oracle`, `decode_evidence`, `fingerprint` and `digest` from `e2e_sync_receive_projection.py`. It does not implement another receiver, binder, schema validator or decoder. The fixture reuses the shared `unified-history.json`, old full `receiveConversation`/`rebindConversation`/snapshot receivers from `sync-staging-oracle.ts`, and `oldMemoryEvents` from `sync-branch-ack-oracle.ts`. The old oracle's checksums and schema checks remain authoritative.

Evidence consists of complete ASCII-safe JSON stdout (`ensure_ascii=True`, including cp1252 consoles), `manifest.json`, `source-before.json`, `source-after.json`, `result.json`, `vite.log`, explicit first/last body-content SHA-256 comparisons, and per-case `browser-result.json`, physical before/after snapshots, transport originals, oracle inputs, complete decoded actual payloads, complete old expected payloads, actual/expected event arrays and headers. Bytes are independently reconstructed from actual IDB part data with strict base64/UTF-8/JSON and SHA/size verification. Only new memory IDs are normalized by stable memory UUID using the existing decoder; numeric IDs, retained memory IDs and stable UUIDs stay exact.

Physical snapshots include all entity headers, **all meta rows** (receipts, outbox, events, consent, cursor and sequence), and every physical part's full key, size and SHA. A valid own orphan removal is an explicit expected difference. Foreign owners, unknown purposes, mismatched manifest owners, invalid manifests, and same-token `entity`/`outbox` namespaces must remain exact. Successful snapshot receivers can rewrite semantically identical Library/creator records; their full oracle-decoded values are checked, while physically untouched records remain byte/key exact.

Chromium contexts are disposable. The network allowlist admits only the owned loopback Vite port and blocks API/model/download paths, WebSockets and browser downloads; service workers are disabled. Synthetic `globalThis.fetch` supplies fictional status, sync pages and transfer parts. No production API/account, model, provider or external download is involved.

## Scenarios

| Cases | Required observation |
| --- | --- |
| `incoming`, `messages-first`, `two-sources` | Remote and existing local history exceed 2 MiB across three parts. Network and apply parsers use message callbacks with zero retained root messages. Previous mapping contains only IDs/UUIDs. Own unselected ID floor 50,000 excludes foreign ID 9,000,000. Root/history memories and historic-only Library/creator snapshots match old full output. |
| `duplicate-id`, `multi-page` | Repeated source IDs inherit the previous accepted numeric and memory identity mapping, within a page and across pages. Temporary namespaces are cleared before the next page. |
| `inline`, `nonconversation`, `delete-recovery`, `hydrate` | Compatibility full paths and complete hydration return; these cases do not claim elimination of all whole payloads. |
| `dirty-schema`, `newer-schema`, `cached-header`, `forged-stage` | Skipped dirty/newer schema stays compatible; cached headers do not read/download bodies; JSON fields cannot manufacture the in-memory incoming brand. |
| `bad-json`, `bad-utf8` | Syntax/UTF-8 failure with recomputed correct whole-source SHA. |
| `bad-base64`, `bad-size`, `bad-part-sha`, `bad-overall-sha` | Transfer checks reject and clean temporary data without changing authored storage or receipts/cursor. |
| `second-download-fails` | First source ready, second source's final download fails; no apply occurs, full page rolls back and temporary namespaces disappear. |
| `quota`, `late-consent`, `manifest-mutation` | Injection after a tentative ENTITY part succeeds. Same receive transaction must roll back every authored row/part, receipt, event and cursor. Consent/manifest changes are made inside that transaction. |
| `owner-body`, `busy-body`, `consent-body`, `pending-local`, `pending-sync`, `local-collision` | Account, generation, consent, actual valid pending-domain records and local-only collisions fail closed. Explicit external consent revocation is the sole expected meta change in its case. |
| `required-snapshot`, `missing-required`, `conflicting-required` | Existing historic-only snapshot fallback succeeds; required snapshot absence/conflict rolls back the whole receive page. |
| `snapshot-collision-inline`, `snapshot-collision-paged` | Valid Library snapshot colliding with current conversation ID rejects atomically on both inline and paged paths. |
| `delete-then-incoming` | Actual B trace scrub writes A revision 2 before paged A receive writes revision 3 in the same transaction; full old-oracle payload/events remain exact. |
| `cleanup-isolation`, `reload-orphan` | Recognized own orphan purge only; reload interrupts a real partial spool, then retries without changing originals/outbox outside the accepted receive. |
| `lock-sync`, `lock-hydrate` | Same-context real tabs: A holds owner lock with a persisted incoming part; B's public sync/hydrate is pending, A's complete physical staged snapshot stays unchanged, and B runs after A releases. |

The reload retry intentionally stops the fixture at the subsequent outbox upload (`FICTIONAL_OUTBOX_UNCHANGED`) after receiving the remote page, so the original pending outbox remains exact. This is receive/retry acceptance, not a claim of successful upload or final saved sync state. The paused reload checkpoint also retains complete original decoded entities/events.

The fixture's source/output restoration for evidence is outside measured product behavior. Metadata, identity/reference arrays, individual messages/strings, inline/nonconversation/deletion recovery, and the public hydration return remain whole. These bounded checks do not establish 1 GB capacity, peak heap/RSS, UI correctness, actual-provider behavior or production/release acceptance.
