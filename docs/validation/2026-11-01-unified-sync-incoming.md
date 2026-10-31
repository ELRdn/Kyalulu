# Paged conversation receive without a whole remote history tree

## Scope and behavior

The `payload_ref` conversation path now stores verified transfer chunks in a temporary IndexedDB namespace, then converts one message at a time inside the existing guarded receive transaction. `appTransfers.ts` exposes the existing reference/part/whole-size/SHA validation as an async generator; its legacy `downloadEntity` wrapper retains the full-object behavior for other callers. A generator yield is not acceptance: the receiver requires normal exhaustion, whole-source SHA, strict UTF-8/JSON completion and a final active check before marking a stage ready.

`appSyncIncoming.ts` retains root metadata, ID/UUID mappings and snapshot references instead of root messages. The apply pass revalidates staged bytes, runs the existing receiver/binder, streams output parts and checks target revision/kind, consent, pending memory domains and manifest before adopting the result. Remote JSON cannot forge the in-memory stage brand. Existing numeric IDs, stable UUIDs, memory provenance and old wire formats remain compatible.

Incoming bytes use `[owner, 'incoming', token, token, index]` and a purpose/owner/ref-checked metadata manifest. Public sync and hydration share the existing owner Web Lock. Cleanup runs under that lock at entry/exit and between successful pages, including recovery of recognized crash orphans. Entity/outbox namespaces, foreign owners and unknown or invalid manifests are preserved. Failure rolls back authored data, receipts and cursor; disposable staged bytes are recovered separately.

## Review fixes

- A Library/creator snapshot whose destination ID equals the conversation ID now rejects the page on both inline and paged paths. This prevents an asynchronous snapshot write replacing the conversation.
- Deletion cleanup may revise another conversation in the same page. After queued cleanup completes, subsequent entries refresh affected records and compare against the new revision. The regression deliberately records authored A revision `1`, deletion scrub revision `2`, then receive revision `3`; the old loop coalesced the final revision to `2`. Payloads, IDs, provenance and events remain compared with the frozen old oracle, with only that one explicitly documented header difference.

The existing sync matrix additionally exposed queued callbacks continuing after a nested storage failure. `storageStep` now remembers a failed transaction and stops its remaining callbacks/queue. The original missing/mismatched-snapshot assertions retained all authored data, but emitted two `InvalidStateError` page errors per case from a second abort. A regression unit failed before the fix; the same real Chromium cases now have no page errors. This changes neither successful transactions nor rollback requirements.

## Validation

- Focused transfer/sync tests: **142 passed / 3 files**.
- All Web tests: **1,527 passed / 94 files**; integrated build including TypeScript: **passed**.
- [Independent Chromium proof](2026-11-01-unified-sync-incoming-browser.md): **40/40** results, **284** complete entity/payload-event comparisons, **13** first/last message body-hash pairs and zero source changes over 337 fingerprinted files. Includes malformed input, quota after tentative output, two-source rollback, owner/consent/pending fences, deletion recovery, orphan reload and actual two-tab owner-lock contention.
- Existing Chromium sync matrix: **15/15**, no page/network errors and unchanged source fingerprints after the storage-failure correction.
- Corresponding-source module/fixture/Python-helper closure: **3/3** after all implementation, test, fixture and collector changes.
- CI registers the new browser runner. Corresponding-source collection includes its fixture, shared old oracles/decoder and both reports. Public CI results and fixed-commit source audit are separate evidence.

The local browser evidence was frozen at aggregate `cbbc30646998d2f9fd59f5c178973243ba812fc5ebaddac9fe137796a796ce96`; it identifies the tested working sources, not a Git commit. Existing unrelated dirty lockfile/source inputs are fingerprinted and preserved rather than included in this change.

## Limits and recovery

Temporary spooling requires additional disk capacity. Root metadata, ID/reference arrays and each individual message/string still materialize; inline/nonconversation receive, deletion recovery and the public hydration return retain whole-object paths. This does not establish 1 GB conversation capacity, peak heap/RSS, real-device parity, UI quality or release/production acceptance. A failed page retains the old authored data and cursor for retry; the next owner-locked sync/hydration cleans only recognized temporary incoming stages. Unknown manifests are intentionally not erased automatically.

No production account, provider, model download, database, balance, ledger or budget is used or changed by these fictional-data tests. Commercial, region/age and release gates remain closed until their independent prerequisites are met.
