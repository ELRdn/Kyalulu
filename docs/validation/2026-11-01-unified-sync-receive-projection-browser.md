# Unified sync receive projection: independent Chromium validation

Authoritative checkout: `D:/VibeCoding/my zeta`, branch `codex/unified-app-integration`, starting HEAD `1a09d0509271505fdc74d76ee0d66dcf5ae5cec1`. This validation changes only its new browser driver, fixture and this report; product/unit changes belong to the main implementer. Existing unrelated working files remain outside this change.

## Final result

**PASS: 26/26 results across 25 scenarios plus resumed reload**, installed Chromium `151.0.7922.34`. The final artifact directory is `.artifacts/sync-receive-projection-browser/frozen-20261101-005`.

- Before/after aggregate: `c1af0e2a86309b40a50d7bead6355756b491becd6db80bf712dc0c27cd4d0b98`, 333 fingerprinted files, zero changed sources.
- Product `appSync.ts` SHA-256: `b6af6db620f272918889d51a73433bd9a81fcefef2a4775b899852d2d23258e2`, unchanged throughout final execution.
- 87 complete entities independently decoded and compared with the old full-path oracle; all applicable complete event arrays compared too.
- All account/generation/quota faults injected exactly once. Body guards fired at the selected source's final part; header guards fired with zero part reads.
- Zero external network requests, page errors or downloads. All 25 contexts closed, owned Chromium disconnected and Vite stopped.
- Complete stdout: 53 JSON lines, retained without truncation in `stdout.jsonl`. Tool display truncation does not affect the artifact.

The initial frozen candidates were superseded by final fixture tightening: deterministic tombstone time/recovery ID, exact recovery event comparison and final-source-part guard injection. All prior artifacts, including failed fixture-oracle attempts, remain untouched. No product defect was found or product patch made by this task.

## Reproduce and evidence

Use the installed `.venv` and Chromium; no dependency install or browser download is needed:

```powershell
.venv/Scripts/python.exe tests/e2e_sync_receive_projection.py --check-oracle
.venv/Scripts/python.exe tests/e2e_sync_receive_projection.py --print-source-hash
.venv/Scripts/python.exe tests/e2e_sync_receive_projection.py --frozen-source c1af0e2a86309b40a50d7bead6355756b491becd6db80bf712dc0c27cd4d0b98 --output .artifacts/sync-receive-projection-browser/frozen-20261101-005
```

The final run requires the current product **and fixture** hashes to match the supplied aggregate before starting. Sources are fingerprinted again after the run. `--accept-current-source` is available for exploratory runs. Each run creates a new artifact directory with `exist_ok=False`; an old failed or successful run cannot be overwritten. Choose another output directory when reproducing the command.

Fingerprint scope: all files in `apps/web/src` (including unit files), `packages/schemas/src`, `packages/ui/src`, Vite config, lockfile, browser server helper, related staging/branch drivers, shared history, frozen oracle fixtures and the new driver/fixture. Validation docs, CI and the collector script are excluded. The structured manifest includes the CLI arguments, scenario list, complete source file hashes and old-oracle hashes.

Artifacts include complete driver stdout in `stdout.jsonl`, `manifest.json`, `source-before.json`, `source-after.json`, `result.json` and `vite.log`. Each applicable scenario preserves physical before/after snapshots (original part keys, byte sizes and SHA), independently decoded actual payloads, expected old payloads, headers and both complete event arrays. Failed evidence is retained separately. Exploratory failures remain in earlier timestamped directories; they are not final acceptance evidence.

## Independent oracle and scope

The fixture imports the checksum-pinned old `receiveConversation`, `rebindConversation`, snapshot receivers and `conversationSettings` from the existing `sync-staging-oracle.ts`; it also reuses `oldMemoryEvents` from `sync-branch-ack-oracle.ts`. Existing driver integrity checks pin the frozen receiver/binder, helper, adapter and schema inputs. Expected receive results are composed from those old full-payload functions and independent fixture originals, never current product receive helpers.

Python reconstructs every retained output from actual IndexedDB part bytes, checks keys/order/count, SHA-256, size, strict UTF-8 and JSON, then compares the complete entity and events with the old output. Numeric message IDs, stable UUIDs, pre-existing memory IDs, root/historical snapshots, summaries, draft, settings/state, provenance, extensions and generation sanitization remain exact. Only newly allocated memory UUID IDs are normalized by stable memory UUID; aliasing and inconsistent allocation are rejected. Fixture time and the first recovery allocation UUID are deterministic, so tombstone time and recovery identity are compared exactly as well. All other random allocations remain real.

This uses real installed Chromium and its native IndexedDB in disposable browser contexts, fictional accounts/data and synthetic fetch responses. HTTP traffic is restricted to the owned loopback Vite port, API/model/download paths are blocked, WebSockets and browser downloads are blocked, and service workers are disabled. No real API, provider, production account, model or download is used. Browser contexts, owned browser and Vite are closed after the run. An initial sandbox attempt stalled inside Python's loopback `socketpair` before starting the runner; the owned attempts were stopped, and browser execution used the approved local-process escalation. This did not require a product change.

## Coverage

| Cases | Assertions |
| --- | --- |
| `receive`, `two-sources`, `messages-first` | Local source is 3,141,012 bytes in three parts. A second independently selected history is included in `two-sources`. Parser finish observes an empty root messages array; the exact previous-message mapping consumed by the receiver contains only `id`/`uuid`, with no `content`. Full output matches the old receiver. |
| All receiving conversations | Existing UUIDs retain numeric IDs; new allocation is above an unselected same-owner message ID of 50,000, while foreign-owner ID 9,000,000 is excluded. Existing root memory UUID maps back to its local ID. Root and historical memories, summary source IDs/text, before/after snapshots and provenance are compared in full. |
| `required-snapshot`, `missing-required`, `conflicting-required` | Historical-only Library and state-only creator references differ from root references. Existing required snapshots are loaded; missing/conflicting snapshots reject the whole page without changing cursor, receipts, sequence, events, headers or parts. |
| `inline`, `nonconversation` | Legacy inline and segmented non-conversation paths retain complete old output. |
| `dirty`, `same-revision` | Local body still passes the selection read; authored source and physical parts remain unchanged while receipt/cursor semantics remain intact. |
| `delete-recovery`, `delete-after-skip`, `delete-after-update` | A deletion anywhere in the page forces the same source's earlier occurrence through the **old full-body path**. Full root messages/content are positively observed. Recovery payload/event remapping and tombstone output match old full processing, including the original event scrub. These are explicitly not projection/no-whole-body cases. |
| `corrupt-last`, `missing-last` | Final source part is corrupted (valid JSON/UTF-8, wrong SHA) or absent; rejection preserves the complete physical database snapshot. |
| `bad-json`, `bad-utf8` | Invalid final-part JSON or UTF-8 is paired with a recomputed correct whole-body SHA. Syntax/encoding rejection still rolls back atomically. |
| `quota` | A quota exception is injected only after a tentative output part has successfully been written. All tentative parts, metadata and cursor updates roll back. |
| `owner-body`, `busy-body`, `owner-header`, `busy-header` | Account/generation changes at the selected source's final part read or cached header callbacks reject with physical rollback. Fault counts prove injection occurred. |
| `skip-cached`, `skip-corrupt` | Already-received payload_ref conversations **and presets** use headers only: zero part reads, parser roots and virtual downloads. Cursor advances and original parts/headers remain unchanged. Corrupt-body skip does not claim local body health was validated. |
| `reload` and resumed navigation | Full saved payload, UUID/numeric/memory IDs and cursor survive page reload in the same disposable context. |

Unselected/foreign source headers and physical parts are protected; unchanged part keys may never be overwritten with different bytes. Required snapshot records are compared against complete old expected output rather than incorrectly requiring their rewritten physical tokens to stay identical. No whole `entities.getAll` or foreign cursor rows are allowed during measured product operations. Full restoration performed by the fixture after measurement is evidence extraction, not a product projection claim.

## Limits

The remote input payload and saved receive result remain fully materialized, as explicitly scoped. Individual message strings are still parsed transiently; root metadata and identity arrays are retained. Deletion recovery and inline/non-conversation routes deliberately retain full payloads. These bounded local browser checks do not establish 1GB capacity, peak heap/RSS, real-provider behavior, production release or device acceptance. No product, unit, CI, collector or Git state was changed by this independent validation task.
