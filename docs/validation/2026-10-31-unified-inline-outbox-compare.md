# Inline outbox settlement comparison — 2026-10-31

The new branch-ACK settlement guards in `89f0f6e` applied `sameOutboxSource` to
legacy inline outboxes at both transaction boundaries. That helper used
`canonical` on both complete bodies, creating four full JSON strings. Ubuntu
PR/push CI caught this in the unchanged `e2e_outbox_guard.py` legacy case:
`wholeBatchWrites=4`; the other ten scenarios passed. A local rerun reproduced
the same result. This is a product regression, not a test-counting adjustment.

The shared helper now compares stored JSON trees recursively. Object property
order is irrelevant; array order, keys, values and every nested payload still
matter. It preserves JSON's omitted object values, null array holes, nonfinite
numbers and negative zero. It ignores only the existing mutable receipt and
withdrawn fields. Non-JSON object prototypes, bigint, cycles and excessive depth
fail closed, matching the transfer serializer's supported plain-data boundary.
Comparison retains existing inline trees and per-object key lists; it creates
no full serialized body or copied history. Initial and final consent/request/
revision/source checks remain enabled. Other call sites use the same helper.

## Evidence

The unchanged real Chromium guard matrix passes **11/11** after the fix.
Legacy `wholeBatchWrites` drops **4 → 0**, while exact bytes/SHA, three transmitted
parts, atomic settlement, retained foreign/private data, failed-account/hash/
withdrawal/replacement and invalid receive cases remain enforced. No fixture,
runner, timeout, data or assertion was changed.

Regression units reject complete-tree JSON serialization during equal and late
payload comparison; differential cases use the old canonical result for valid
JSON, including reordered keys, array holes/order, numeric normalization, unknown
fields and own `__proto__`. Mutated request/revision/payloads fail comparison;
mutable receipt/withdrawn changes remain excluded. Invalid trees fail closed.
Independent review also found that an own nonenumerable key could match a
different enumerable-key set. The added old-canonical differential case fails
before the correction; requiring an enumerable right-hand key makes it pass.
Normal persisted JSON cannot contain this descriptor, but the comparison now
rejects the misleading shape without relying on that assumption.

Final combined-source checks pass: **1,494 Web tests /93 files**, TypeScript,
unified build **9.95s**, and corresponding-source closure **3/3**. The unchanged
branch-ACK matrix passes **47/47** again across 46 scenarios with all 332 input
hashes unchanged, aggregate
`58147402fce3a4364dbd4fdf9569053d73868d574e30597ac9008d6ff82e31b2`.
The existing outbox-stream matrix passes **79 scenarios /81 executions**, all
321 input hashes unchanged, aggregate
`f93576e2fe33e510210556411ec57bb59b2d98d7f89f5a94d90d0ea237c8da7a`.
The parent rechecks current input hashes and all structured successes. This
follow-up changes no browser fixtures or deadlines. Hosted CI on the published
follow-up is a separate pending check.

Artifacts: `.artifacts/ci-89f0f6e-pr-ubuntu-failed.log`,
`ci-89f0f6e-outbox-guard-reproduced.{log,result.json}` and
`inline-outbox-compare-guard-final.{log,result.json}`. The old failing attempt is
preserved. Bounded fixture evidence does not establish 1 GB/RSS, physical-device,
provider, production or clean-OS acceptance; existing inline trees remain whole.
Final branch evidence is in
`.artifacts/sync-branch-ack-browser/20261031T144426226244Z/`; outbox-stream evidence
is copied from its owned temporary directory into
`.artifacts/inline-outbox-compare-stream-post-review-final/`. Final guard,
Web/typecheck/build/source-closure logs use the `inline-outbox-compare-` prefix.
