# Fictional 1 GB memory projection diagnostic

The memory-source implementation introduced at `072911f` was measured before any
further product changes, using the same source contents as `6bda649`. This is a
single-source memory projection result, not full-conversation generation, restore,
sync, a large shared domain or physical-device acceptance.

The existing fictional capacity profile was SHA-256 copied into a new disposable
profile. Its original manifest is exactly **1,000,000,000 UTF-8 JSON bytes**, 954
parts and 15,240 independently generated messages. The original profile was not
opened by the measured browser and its complete file hashes remained unchanged.

The real `readMemorySource`, `saveScopedMemory` and `scopedMemoryAddress` paths
read, bind, update and reload one attributed memory. The memory references the
first and last message IDs. No complete `AppEntity` is supplied as an update.
The output adds only the top-level memory projection: **1,000,000,298 bytes**.
The owner execution lease, revision/body-token advance, binding revision and
fixed outbox logical contents/header/token/checksum are checked. Old source-token
parts are absent after success.

An independent sequential verifier compares every decoded message's fields,
identity and entire content against the deterministic fixture generator. It also
checks all metadata and the full concatenated body digest:
`53c75390be6767d3ebfaa9fc800e89baa71e834e34c21c49688f10a368a7fe35`.
All five complete source scans report 15,240 total messages with zero retained
root messages: read, precommit source validation, rewrite, address reload and
independent body verification. A decoded message, metadata and scalar can still
remain whole.

| Operation | Observed milliseconds |
| --- | ---: |
| Metadata-only source read | 26,971.5 |
| Source validation and memory-only commit | 76,191.5 |
| Address context reload | 23,289.1 |
| Independent complete body verification | 32,720.7 |
| Complete browser operation | 159,183.4 |

The existing owned Windows Job keeps its **4 GiB** hard commit cap and sampled
working-set guard, **480 s** deadline, **2 GiB** physical-memory floor and **8 GiB**
disk floor. All are retained. Observed Job peak committed bytes: **547,901,440**;
sampled aggregate process working set: **1,084,858,368**; maximum sampled JS used
heap: **58,556,420**; maximum backing storage: **101,183,442** (298 heap samples).
These metrics overlap and have different meanings; they must not be added.
No forced GC or heap snapshot is used. A single result does not establish a
universal memory ceiling or performance guarantee.

Chromium **151.0.7922.34** uses loopback fixture modules, blocked external/API
requests/WebSockets and a worker-denying CSP. No inference/provider/production
call is made. The final result has no blocked attempts/page errors, unchanged
measured source hashes, unchanged original profile, no surviving owned browser
PIDs and an exited owned Vite process. The driver exits 0; cleanup does not delete
the original or diagnostic profiles.

## Local evidence and unsuccessful attempts

The final retained evidence directory is
`%LOCALAPPDATA%/Temp/kyalulu-memory-1gb-projection-20261031-062714-7914e2dc/`:
`memory-projection-result.json`, the phase `result.json`, memory JSONL, clone
provenance, original-profile before/after hashes and process logs. Console output
is `.artifacts/memory-projection-1gb-audit-verified.log`. The private one-shot
adapter is `.artifacts/unified-capacity-20261030/parser-memory-audit/memory_projection_audit.py`;
it reuses the existing owned-process capacity driver and deterministic public
`tests/fixtures/storage-capacity.html`. It depends on retained local baseline and
audit helpers and is not a self-contained public test or CI job.

Earlier attempts remain unsuccessful evidence: sandbox Chromium exited before
CDP; a probe hook incorrectly treated the fixed-outbox array as a conversation;
the D-drive run stopped at the unchanged 8 GiB floor; and a temporary-drive run
completed the product operations but lacked the verifier's `JsonStream` import.
Those probe errors were corrected without changing product code or weakening
the acceptance assertions. The final complete run uses a fresh copy on the
temporary drive with adequate headroom. Existing failed copies are retained.

No product change follows from this diagnostic. The original full-tree 1 GB
restore failure remains unaccepted. Full actor generation, history mutation,
transport/outbox processing, arbitrary metadata/scalars and large memory domains
still require separate work and evidence.
