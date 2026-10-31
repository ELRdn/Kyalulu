# Fictional exact 1 GB Device branch diagnostic

The streamed branch implementation based on `6787167` was measured on a fresh
SHA-256-verified copy of the existing fictional capacity profile. The original
profile is never opened by the measured browser and its complete file hashes
remain unchanged. No model, provider, external API or production data is used.

The local fixture adds historical before/after snapshots, settings, one attributed
memory and a draft to the copy. It shortens only the last deterministic message
by the exact added 1,992 serialized bytes, keeping the prepared source at
**1,000,000,000 UTF-8 JSON bytes**, 954 parts and 15,240 messages. Preparation uses
the segmented writer in one transaction; it is distinct from the real branch
operation. Preparation is not an API or migration acceptance claim.

The actual `deviceFetch` POST branches at the middle assistant, preserving the
first **7,620** message UUIDs and independently allocating numeric/memory IDs.
The result is **500,022,155 bytes**, 477 parts. The independent verifier compares
every field and entire generated body of all 7,620 output messages and all 15,240
source messages, including selected snapshots, settings, memory sources, identity
maps and complete metadata. Output/source body digests are also compared against
the deterministic generator. The source header/manifest and real fixed outbox
logical contents/header/checksum remain unchanged by branching. One owner lease
admission is observed; the owner sequence advances past all source IDs.

| Phase | Observed milliseconds |
| --- | ---: |
| Fictional source preparation | 73,129.7 |
| Actual branch API | 67,706.1 |
| Independent complete branch verification | 37,699.4 |
| Independent complete source verification | 69,617.1 |
| Complete operation including initial source inspection | 283,474.0 |

All six complete parser scans retain zero root messages: initial metadata,
preparation, branch inspection, branch copy, output verification and source
verification. The implementation still retains identity maps, metadata, selected
snapshots and one message. It scans the full source even when copying a prefix;
this result does not establish interactive performance.

The existing owned Windows Job retains its **4 GiB** commit/working-set guard,
**480 s** deadline, **2 GiB** physical-memory floor and **8 GiB** free-disk floor.
Observed peak Job committed bytes: **615,759,872**; sampled aggregate process
working set: **1,157,529,600**; sampled JS used heap: **45,424,952**; backing storage:
**156,757,014** (327 heap samples). These distinct overlapping metrics must not
be added. No forced GC/snapshot is used; this is not a universal memory ceiling.

The final evidence records unchanged measured source hashes, no blocked requests,
WebSockets or page errors, browser exit 0, graceful owned-browser shutdown with no
remaining owned PIDs and exited owned Vite. Original and diagnostic profiles are
retained. Local evidence:
`%LOCALAPPDATA%/Temp/kyalulu-branch-1gb-20261031-174415-a679d83c/branch-copy-result.json`;
console `.artifacts/device-branches-1gb-audit.log`.

The private adapter
`.artifacts/unified-capacity-20261030/parser-memory-audit/branch_copy_audit.py`
reuses the previous owned-Job/memory-projection diagnostics, historical baseline
and public deterministic capacity generator. It is not a self-contained public
CI test. See the [bounded branch driver](2026-10-31-unified-device-branches.md)
for other branch points, failure rollback and world/shared/local/sync semantics.
This single local middle-branch result does not accept full actor generation,
sync transport, full-tree restoration, large shared domains or physical devices.
